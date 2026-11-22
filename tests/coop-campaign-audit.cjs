'use strict';

module.exports = function campaignAudit(root = globalThis.window) {
  if (root.nativeCampaignAudit) throw new Error('Campaign observation is already active.');
  const world = root.hostWorld, game = world.game, audit = { quests: [], claims: [], events: [], kills: [], waves: [], errors: [], overflow: false }, hooks = [], listeners = [];
  const push = (list, row) => { if (list.length < 512) list.push(row); else audit.overflow = true; };
  const read = callback => { try { return callback(); } catch (error) { push(audit.errors, String(error?.message ?? error)); return null; } };
  const pickups = () => game.getGameSpaceList().flatMap(space => space.getEntitiesWithEC('ECPickup'));
  const player = id => { const model = world.players.active.get(id).model; return { xp: model.getXP(), amber: model.getSoftCurrency(), resource: [model.getResource(0), model.getResource(1)], cap: [model.getResourceCap(0), model.getResourceCap(1)] }; };
  const hook = (owner, key, make) => {
    const original = owner[key], own = Object.hasOwn(owner, key), wrapped = make(original);
    hooks.push({ owner, key, original, own, wrapped }); owner[key] = wrapped;
  };
  hook(game.desktopQuestRewards, 'award', original => function (id, hero) {
    const before = read(() => new Set(pickups().map(entity => entity.getName())));
    const record = read(() => this.data.pending.find(row => row.id === id)), result = original.apply(this, arguments);
    if (!result || !record || !before) return result;
    read(() => {
      const definition = this.manager.taskArchetypes[record.task], quest = { id, task: record.task, xp: definition.xpReward, amber: definition.amberReward, drops: [] };
      push(audit.quests, quest);
      for (const entity of pickups().filter(entity => !before.has(entity.getName()))) {
        const pickup = entity.getEC('ECPickup'), drop = { id: entity.getName(), xp: pickup.xp || 0, amber: pickup.archetype.softCurrency || 0, grants: [] };
        if (!drop.xp && !drop.amber) continue;
        quest.drops.push(drop);
        hook(pickup, 'giveToCollector', give => function (collector) {
          const id = read(() => [...world.players.active].find(([, entry]) => entry.hero === collector)?.[0]), before = read(() => player(id));
          try { return give.apply(this, arguments); }
          finally { read(() => { push(drop.grants, { player: id, before, after: player(id) }); }); }
        });
      }
    });
    return result;
  });
  hook(game.desktopCampaignRewards, 'award', original => function (id) {
    const reward = read(() => this.data.pending.find(row => row.id === id)), owner = reward?.owner, before = owner && read(() => player(owner));
    const result = original.apply(this, arguments);
    if (result && reward) read(() => { push(audit.claims, { id, owner, score: JSON.parse(JSON.stringify(reward.score)), before, after: player(owner) }); });
    return result;
  });
  for (const event of ['CampaignStarted', 'CampaignPrepareScreenExited', 'InvasionStarted', 'CampaignScoreScreenExited', 'EnemyKilled']) {
    const callback = value => read(() => { if (event === 'EnemyKilled') push(audit.kills, { victim: value.victim.getName(), aggressor: value.aggressor?.getName(), critical: value.isCritical }); else push(audit.events, { event, tick: game.gameClock.getFrameIndex() }); });
    game.eventManager.subscribe(event, callback); listeners.push({ event, callback });
  }
  const observedWaves = new WeakSet();
  const observeWave = wave => {
    if (!wave || observedWaves.has(wave)) return;
    observedWaves.add(wave);
    const record = { spawned: [], completed: false, remaining: null, nextWave: null, waveCount: wave.archetype.waves.length };
    push(audit.waves, record);
    const sample = () => read(() => { for (const entity of wave.spawnedEntityList) { const id = entity.getName(); if (!record.spawned.includes(id)) push(record.spawned, id); } });
    sample();
    hook(wave, 'spawnWave', original => function () { const result = original.apply(this, arguments); sample(); return result; });
    hook(wave, 'isComplete', original => function () {
      const result = original.apply(this, arguments);
      read(() => { if (result) { record.completed = true; record.remaining = this.getNumberOfAliveSpawnedEnemies(); record.nextWave = this.nextWaveIndex; } });
      return result;
    });
  };
  const restore = () => {
    for (const { event, callback } of listeners) game.eventManager.unsubscribe(event, callback);
    for (const { owner, key, original, own, wrapped } of hooks) if (owner[key] === wrapped) { if (own) owner[key] = original; else delete owner[key]; }
    if (root.observeNativeCampaignWave === observeWave) delete root.observeNativeCampaignWave;
    if (root.nativeCampaignAudit === audit) delete root.nativeCampaignAudit;
    if (root.restoreNativeCampaignAudit === restore) delete root.restoreNativeCampaignAudit;
  };
  root.observeNativeCampaignWave = observeWave;
  root.nativeCampaignAudit = audit; root.restoreNativeCampaignAudit = restore;
};
