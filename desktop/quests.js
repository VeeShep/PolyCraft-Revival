'use strict';
(function (root) {
  const KEY = 'desktopQuests';
  const keys = (value, names) => value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === names.length && names.every(name => Object.hasOwn(value, name));
  function validateQuests(value) {
    if (value && Number.isInteger(value.version) && value.version > 1) { const error = new Error('These quest rewards need a newer PolyCraft version.'); error.code = 'UNSUPPORTED_SAVE'; throw error; }
    if (!keys(value, ['version', 'pending']) || value.version !== 1 || !Array.isArray(value.pending) || value.pending.length > 512) throw new Error('Invalid pending quest rewards.');
    const ids = new Set(), tasks = new Set();
    for (const item of value.pending) {
      if (!keys(item, ['id', 'task']) || typeof item.id !== 'string' || !/^taskId(?:crit|fill)_\d{1,4}$/.test(item.id) || typeof item.task !== 'string' || !/^[a-zA-Z][\w-]{0,99}$/.test(item.task) || ids.has(item.id) || tasks.has(item.task)) throw new Error('Invalid or duplicate pending quest reward.');
      ids.add(item.id); tasks.add(item.task);
    }
    return value;
  }
  function taskInfo(manager, record) {
    const match = /^taskId(crit|fill)_(\d+)$/.exec(record.id), group = match && (match[1] === 'crit' ? manager.criticalTaskGroup : manager.fillerTaskGroup);
    const archetype = manager.taskArchetypes?.[record.task];
    if (!archetype || group?.taskList[Number(match[2])] !== record.task) throw new Error('Unknown pending quest reward: ' + record.task);
    return { taskId: record.id, taskArchetypeName: record.task, taskArchetype: archetype, taskProgress: 1, displayDuration: 0 };
  }
  function validateQuestView(value, manager) {
    if (value === null) return value;
    if (!keys(value, ['revision', 'visible', 'offset', 'tasks', 'completed']) || !Number.isSafeInteger(value.revision) || value.revision < 1 || typeof value.visible !== 'boolean' || typeof value.offset !== 'boolean' || !Array.isArray(value.tasks) || value.tasks.length > 3 || !value.visible && (value.tasks.length || value.completed !== null)) throw new Error('Invalid quest view.');
    const ids = new Set();
    for (const [row, completed] of [...Array.from(value.tasks, row => [row, false]), ...(value.completed === null ? [] : [[value.completed, true]])]) {
      if (!keys(row, completed ? ['id', 'task'] : ['id', 'task', 'progress']) || typeof row.id !== 'string' || !/^taskId(?:crit|fill)_\d{1,4}$/.test(row.id) || typeof row.task !== 'string' || !/^[a-zA-Z][\w-]{0,99}$/.test(row.task) || ids.has(row.id) || !completed && (typeof row.progress !== 'number' || !Number.isFinite(row.progress) || row.progress < 0 || row.progress > 1)) throw new Error('Invalid quest view row.');
      taskInfo(manager, row); ids.add(row.id);
    }
    return value;
  }
  class QuestRewards {
    constructor(game, bridge, manager = game.getTaskManager()) {
      if (game.desktopQuestRewards || !manager) throw new Error('Quest rewards are already managed or not ready.');
      this.game = game; this.bridge = bridge; this.manager = manager;
      this.data = validateQuests(JSON.parse(bridge.state.userData[KEY] || '{"version":1,"pending":[]}'));
      for (const record of this.data.pending) this.info(record);
      this.original = { save: manager.saveCompletedTasks, award: manager.awardCompletedTaskList, collect: manager.getNewCompletedRenderInfoList, give: manager.giveTaskReward, destroy: manager.destroy, update: manager.update };
      const current = manager.completedTaskRenderInfo;
      if (current && !this.data.pending.some(item => item.id === current.taskId)) this.stage([current], true);
      this.restored = this.data.pending.map(record => this.info(record));
      manager.completedTaskRenderInfo = null;
      manager.saveCompletedTasks = list => { this.stage(list); this.original.save.call(manager, list); };
      manager.awardCompletedTaskList = list => {
        for (const item of list) {
          if (!this.data.pending.some(record => record.id === item.taskId) && !game.getPlayerData().getTaskFlags()[item.taskArchetypeName]) manager.saveCompletedTasks([item]);
          this.award(item.taskId);
        }
      };
      manager.getNewCompletedRenderInfoList = () => {
        const fresh = this.original.collect.call(manager);
        if (!this.restored.length) return fresh;
        const result = this.restored.concat(fresh); this.restored = []; return result;
      };
      manager.update = present => { this.assertHealthy(); this.frame = game.gameClock.getFrameIndex(); return this.original.update.call(manager, present); };
      manager.destroy = () => { this.close(); this.original.destroy.call(manager); };
      game.desktopQuestRewards = this;
      this.persist();
    }
    info(record) { return taskInfo(this.manager, record); }
    snapshot() {
      this.assertHealthy();
      const flags = this.game.getPlayFlags(), manager = this.manager, visible = !!flags.showTasks, completed = manager.completedTaskRenderInfo;
      this.game.desktopQuestRevision = (this.game.desktopQuestRevision || 0) + 1;
      return { revision: this.game.desktopQuestRevision, visible, offset: !!flags.offsetTasks,
        tasks: visible ? [...(manager.criticalRenderInfoList || []), ...(manager.fillerRenderInfoList || [])].map(item => ({ id: item.taskId, task: item.taskArchetypeName, progress: item.taskProgress })) : [],
        completed: visible && completed && this.data.pending.some(record => record.id === completed.taskId && record.task === completed.taskArchetypeName) ? { id: completed.taskId, task: completed.taskArchetypeName } : null };
    }
    persist() { validateQuests(this.data); this.bridge.state.userData[KEY] = JSON.stringify(this.data); }
    stage(list, legacy = false) {
      const records = list.map(item => ({ id: item.taskId, task: item.taskArchetypeName }));
      for (const record of records) this.info(record);
      const next = { version: 1, pending: [...this.data.pending] };
      for (const record of records) if (!next.pending.some(item => item.id === record.id) && (legacy || !this.game.getPlayerData().getTaskFlags()[record.task])) next.pending.push(record);
      this.data = validateQuests(next);
      this.persist();
    }
    award(id, hero) {
      this.assertHealthy();
      const record = this.data.pending.find(item => item.id === id);
      if (!record) return false;
      try {
        const info = this.info(record);
        if (!this.game.getPlayerData().getTaskFlags()[record.task]) this.original.save.call(this.manager, [info]);
        this.original.give.call(this.manager, info.taskArchetype, hero);
        this.data.pending.splice(this.data.pending.indexOf(record), 1); this.persist();
        this.restored = this.restored.filter(item => item.taskId !== id);
        if (this.manager.completedTaskRenderInfo?.taskId === id) this.manager.completedTaskRenderInfo = null;
        return true;
      } catch (error) { this.failure = error; throw error; }
    }
    assertHealthy() { if (this.failure) throw new Error('A quest reward did not finish. Reload the last saved checkpoint before saving again.', { cause: this.failure }); }
    updateWhileMenu() { if (this.frame !== this.game.gameClock.getFrameIndex()) this.manager.update(false); }
    close() {
      this.assertHealthy();
      const manager = this.manager;
      manager.saveCompletedTasks = this.original.save; manager.awardCompletedTaskList = this.original.award; manager.getNewCompletedRenderInfoList = this.original.collect; manager.destroy = this.original.destroy;
      manager.update = this.original.update;
      delete this.game.desktopQuestRewards;
    }
  }
  class GuestQuests {
    constructor(world) { this.world = world; this.items = new Map(); this.messages = new Set(); this.lastFrame = performance.now(); }
    cancel() { this.description = null; }
    receiveView(value) {
      validateQuestView(value, value ? this.world.game.getTaskManager() : null);
      if (value && value.revision <= (this.state?.revision || 0)) return;
      const items = new Map();
      if (value) for (const row of [...value.tasks, ...(value.completed ? [value.completed] : [])]) {
        const item = this.items.get(row.id) || taskInfo(this.world.game.getTaskManager(), row);
        item.taskProgress = row.progress ?? 1; items.set(row.id, item);
      }
      this.items = items; this.state = value ? structuredClone(value) : null; this.receivedAt = performance.now();
      if (!value?.visible || value.completed || this.description && !items.has(this.description.taskId)) this.cancel();
    }
    receive(value) {
      if (Object.hasOwn(value, 'quests')) {
        if (value.type !== 'questReward' || value.quests === null) throw new Error('Invalid quest result.');
        validateQuestView(value.quests, value.quests ? this.world.game.getTaskManager() : null);
        if (value.sequence === this.pending) this.receiveView(value.quests);
      }
      if (value.type === 'questReward' && value.sequence === this.pending) { this.pending = null; this.world.lastLifeQuery = -Infinity; }
      if (value.type === 'questOpen' && value.sequence === this.openRequest) { this.openRequest = null; this.world.lastLifeQuery = -Infinity; }
    }
    createRenderer() {
      const world = this.world, gui = world.game.getIMGui(), manager = world.game.getGuiManager();
      const viewManager = Object.assign(Object.create(manager), {
        addDrawGui: (name, args, id) => manager.addDrawGui(name, args, id ? 'guest-' + id : undefined),
        addGameMessage: (id, ...args) => { id = 'guest-' + id; this.messages.add(id); return manager.addGameMessage(id, ...args); }
      });
      const input = { doButtonFromGuiArchetype: (style, args, id) => {
        const close = style === this.renderer.taskDescriptionCloseButtonGuiArchetype;
        const ready = close || performance.now() - this.receivedAt <= 2000 && !this.pending && !this.openRequest;
        const clicked = gui.doButtonFromGuiArchetype(style, !ready && style === this.renderer.acceptRewardButtonGuiArchetype ? { ...args, text1: 'WAITING FOR HOST' } : args, 'guest-' + id);
        return ready && clicked;
      } };
      const game = Object.assign(Object.create(world.game), { getGuiManager: () => viewManager, getIMGui: () => input, getPlayFlags: () => ({ offsetTasks: this.state.offset }) });
      this.renderer = Object.assign(Object.create(world.game.getTaskManager().taskRenderer), { gameManager: game, globals: Object.create(world.controls.app.globals) });
    }
    update() {
      const world = this.world, now = performance.now(), elapsed = Math.min(0.25, Math.max(0, (now - this.lastFrame) / 1000)); this.lastFrame = now;
      if (!this.state?.visible || world.controls.paused || !world.movement.nativeFocused || world.resyncing) { this.cancel(); return false; }
      if (world.pauseMenu || world.selectedBuilding || world.demolition || world.construction?.menu || world.totem?.menu) return false;
      if (!this.renderer) this.createRenderer();
      this.renderer.globals.gameTimeStep = elapsed;
      const choice = this.renderer.doTaskUI({ descriptionTaskRenderInfo: this.description, completedTaskRenderInfo: this.state.completed ? this.items.get(this.state.completed.id) : null, taskRenderInfoList: this.state.tasks.map(row => this.items.get(row.id)), badgeTaskRenderInfoList: [] });
      if (choice?.buttonName === 'closeDescription') this.cancel();
      else if (choice?.buttonName === 'openTaskDescription' && !this.openRequest) {
        world.cancelLocalMenu(); this.description = choice.taskRenderInfo;
        this.openRequest = world.sendQuest('questOpen', choice.taskRenderInfo.taskId); world.movement.flush();
      } else if (choice?.buttonName === 'acceptReward' && !this.pending) {
        this.pending = world.sendQuest('questReward', choice.taskRenderInfo.taskId);
      }
      return !!this.description;
    }
    close() { for (const id of this.messages) this.world.game.getGuiManager().removeGameMessage(id); this.cancel(); this.state = null; this.items.clear(); }
  }
  const api = { KEY, validateQuests, QuestRewards, validateQuestView, GuestQuests };
  if (typeof module !== 'undefined') module.exports = api;
  else root.PolycraftQuests = api;
})(globalThis);
