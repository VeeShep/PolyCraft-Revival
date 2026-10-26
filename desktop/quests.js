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
  class QuestRewards {
    constructor(game, bridge, manager = game.getTaskManager()) {
      if (game.desktopQuestRewards || !manager) throw new Error('Quest rewards are already managed or not ready.');
      this.game = game; this.bridge = bridge; this.manager = manager;
      this.data = validateQuests(JSON.parse(bridge.state.userData[KEY] || '{"version":1,"pending":[]}'));
      for (const record of this.data.pending) this.info(record);
      this.original = { save: manager.saveCompletedTasks, award: manager.awardCompletedTaskList, collect: manager.getNewCompletedRenderInfoList, give: manager.giveTaskReward, destroy: manager.destroy };
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
      manager.destroy = () => { this.close(); this.original.destroy.call(manager); };
      game.desktopQuestRewards = this;
      this.persist();
    }
    info(record) {
      const match = /^taskId(crit|fill)_(\d+)$/.exec(record.id), group = match && (match[1] === 'crit' ? this.manager.criticalTaskGroup : this.manager.fillerTaskGroup);
      const archetype = this.manager.taskArchetypes?.[record.task];
      if (!archetype || group?.taskList[Number(match[2])] !== record.task) throw new Error('Unknown pending quest reward: ' + record.task);
      return { taskId: record.id, taskArchetypeName: record.task, taskArchetype: archetype, taskProgress: 1, displayDuration: 0 };
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
    award(id) {
      this.assertHealthy();
      const record = this.data.pending.find(item => item.id === id);
      if (!record) return false;
      try {
        const info = this.info(record);
        if (!this.game.getPlayerData().getTaskFlags()[record.task]) this.original.save.call(this.manager, [info]);
        this.original.give.call(this.manager, info.taskArchetype);
        this.data.pending.splice(this.data.pending.indexOf(record), 1); this.persist();
        this.restored = this.restored.filter(item => item.taskId !== id);
        if (this.manager.completedTaskRenderInfo?.taskId === id) this.manager.completedTaskRenderInfo = null;
        return true;
      } catch (error) { this.failure = error; throw error; }
    }
    assertHealthy() { if (this.failure) throw new Error('A quest reward did not finish. Reload the last saved checkpoint before saving again.', { cause: this.failure }); }
    close() {
      this.assertHealthy();
      const manager = this.manager;
      manager.saveCompletedTasks = this.original.save; manager.awardCompletedTaskList = this.original.award; manager.getNewCompletedRenderInfoList = this.original.collect; manager.destroy = this.original.destroy;
      delete this.game.desktopQuestRewards;
    }
  }
  const api = { KEY, validateQuests, QuestRewards };
  if (typeof module !== 'undefined') module.exports = api;
  else root.PolycraftQuests = api;
})(globalThis);
