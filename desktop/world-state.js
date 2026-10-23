'use strict';
(function (root) {
  const VERSION = 3;
  const LIMITS = Object.freeze({ spaces: 128, blocks: 20000, entities: 10000 });
  const entityFields = ['archetype', 'interactive', 'location', 'scale', 'rotation', 'mesh', 'health'];
  const meshFields = ['path', 'transform', 'visible', 'skin'];
  const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
  const number = value => typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= 1e9;
  const vector = (value, size) => Array.isArray(value) && value.length === size && Array.from(value).every(number);
  const name = value => typeof value === 'string' && value.length > 0 && value.length <= 256;
  function requireValue(valid, message) { if (!valid) throw new Error('Invalid world snapshot: ' + message); }
  function keys(value, expected) {
    return object(value) && Object.keys(value).length === expected.length && expected.every(key => Object.hasOwn(value, key));
  }
  function validateHeader(value) {
    requireValue(Number.isSafeInteger(value.tick) && value.tick >= 0 && number(value.time) && value.time >= 0, 'invalid simulation time.');
    requireValue(number(value.dayTime) && value.dayTime >= 0 && value.dayTime <= 24 && name(value.hero), 'invalid island clock or hero.');
    requireValue(value.torch === null || (keys(value.torch, ['transform', 'visible']) && vector(value.torch.transform, 12) && typeof value.torch.visible === 'boolean'), 'invalid hero light.');
  }
  function validateBlock(block, assets) {
    requireValue(keys(block, ['archetype', 'location', 'scale', 'rotation']) && name(block.archetype) && vector(block.location, 3) && vector(block.scale, 3) && number(block.rotation), 'invalid terrain block.');
    if (assets) requireValue(assets.hasBlock(block.archetype), 'unknown terrain block.');
  }
  function validateEntity(entity, assets, partial = false) {
    requireValue(object(entity) && Object.hasOwn(entity, 'id') && name(entity.id) && (partial ? Object.keys(entity).length > 1 && Object.keys(entity).every(key => key === 'id' || entityFields.includes(key)) : keys(entity, ['id', ...entityFields])), 'invalid entity.');
    const has = key => !partial || Object.hasOwn(entity, key);
    if (has('archetype')) requireValue(entity.archetype === null || name(entity.archetype), 'invalid entity archetype.');
    if (has('interactive')) requireValue(typeof entity.interactive === 'boolean', 'invalid interaction flag.');
    for (const key of ['location', 'scale']) if (has(key)) requireValue(vector(entity[key], 3), 'invalid entity vector.');
    if (has('rotation')) requireValue(number(entity.rotation), 'invalid entity rotation.');
    if (has('mesh') && entity.mesh !== null) {
      const mesh = entity.mesh;
      requireValue(object(mesh) && (partial ? Object.keys(mesh).length > 0 && Object.keys(mesh).every(key => meshFields.includes(key)) : keys(mesh, meshFields)), 'invalid entity mesh.');
      if (!partial || Object.hasOwn(mesh, 'path')) {
        requireValue(typeof mesh.path === 'string' && mesh.path.length > 0 && mesh.path.length <= 512 && !mesh.path.includes('..') && !/[:\\\x00-\x1f]/.test(mesh.path) && !mesh.path.startsWith('/'), 'invalid entity mesh.');
        if (assets) requireValue(assets.hasMesh(mesh.path), 'unknown mesh asset.');
      }
      if (!partial || Object.hasOwn(mesh, 'transform')) requireValue(vector(mesh.transform, 12), 'invalid mesh transform.');
      if (!partial || Object.hasOwn(mesh, 'visible')) requireValue(typeof mesh.visible === 'boolean', 'invalid mesh visibility.');
      if (!partial || Object.hasOwn(mesh, 'skin')) requireValue(mesh.skin === null || (Array.isArray(mesh.skin) && mesh.skin.length > 0 && mesh.skin.length <= 3072 && mesh.skin.length % 12 === 0 && Array.from(mesh.skin).every(number)), 'invalid skin matrices.');
    }
    if (has('health') && entity.health !== null) requireValue(keys(entity.health, ['current', 'maximum']) && number(entity.health.current) && number(entity.health.maximum) && entity.health.maximum >= 0, 'invalid entity health.');
  }
  function validateSnapshot(snapshot, assets) {
    requireValue(keys(snapshot, ['version', 'tick', 'time', 'dayTime', 'hero', 'torch', 'spaces']), 'missing or unexpected fields.');
    requireValue(snapshot.version === VERSION, 'incompatible version.');
    validateHeader(snapshot);
    requireValue(Array.isArray(snapshot.spaces) && snapshot.spaces.length > 0 && snapshot.spaces.length <= LIMITS.spaces, 'invalid space count.');
    const ids = new Set();
    let blocks = 0, entities = 0;
    for (const space of snapshot.spaces) {
      requireValue(keys(space, ['extents', 'transform', 'blocks', 'entities']) && vector(space.extents, 6) && vector(space.transform, 12), 'invalid space transform.');
      requireValue(space.extents.slice(0, 3).every((low, index) => low <= space.extents[index + 3]), 'inverted space bounds.');
      requireValue(Array.isArray(space.blocks) && Array.isArray(space.entities), 'invalid space contents.');
      blocks += space.blocks.length; entities += space.entities.length;
      requireValue(blocks <= LIMITS.blocks && entities <= LIMITS.entities, 'too many world objects.');
      for (const block of space.blocks) validateBlock(block, assets);
      for (const entity of space.entities) {
        validateEntity(entity, assets);
        requireValue(!ids.has(entity.id), 'duplicate entity identity.'); ids.add(entity.id);
      }
    }
    requireValue(ids.has(snapshot.hero), 'the selected hero is missing.');
    return snapshot;
  }
  function captureSnapshot(game) {
    const snapshot = {
      version: VERSION,
      tick: game.gameClock.getFrameIndex(),
      time: game.globals.gameCurrentTime,
      dayTime: game.getGameDayTime(),
      hero: game.getHero().name,
      torch: game.gameLighting?.heroLightNode ? { transform: Array.from(game.gameLighting.heroLightNode.getLocalTransform()), visible: !game.gameLighting.heroLightNode.disabled } : null,
      spaces: game.getGameSpaceList().map(space => ({
        extents: Array.from(space.calculateExtents()), transform: Array.from(space.getM43FullTransform()),
        blocks: space.getBlockList().map(block => ({
          archetype: block.getArchetypeName(), location: Array.from(block.getv3Location()),
          scale: Array.from(block.getV3Scale()), rotation: block.getRotationY()
        })),
        // Save files omit heroes and other transient entities; replication must include them.
        entities: space.getEntityList().filter(entity => !entity.shouldBeDestroyed()).map(entity => {
          const mesh = entity.getEC('ECMesh'), health = entity.getEC('ECHealth');
          const skin = mesh?.node?.skinController;
          skin?.update();
          return {
            id: entity.name, archetype: entity.archetypeName || null,
            interactive: !!(entity.getEC('ECResourceDispenser') || entity.getEC('ECTarget') || entity.getEC('ECBuilding') || entity.getEC('ECDispenser') || entity.getEC('ECHeroShrine')),
            location: Array.from(entity.getv3Location()), scale: Array.from(entity.getV3Scale()), rotation: entity.getRotationY(),
            mesh: mesh?.node ? { path: mesh.getMeshPath(), transform: Array.from(mesh.getm43Transform()), visible: !mesh.node.disabled, skin: skin ? Array.from(skin.output) : null } : null,
            health: health ? { current: health.getHealth(), maximum: health.getMaxHealth() } : null
          };
        })
      }))
    };
    return validateSnapshot(snapshot);
  }
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  function createDelta(previous, next) {
    validateSnapshot(previous); validateSnapshot(next);
    requireValue(next.tick > previous.tick, 'updates must advance the tick.');
    if (previous.spaces.length !== next.spaces.length) return null;
    const spaces = next.spaces.flatMap((space, index) => {
      const before = previous.spaces[index], patch = { index, remove: [], entities: [] };
      for (const key of ['extents', 'transform', 'blocks']) if (!same(before[key], space[key])) patch[key] = space[key];
      const old = new Map(before.entities.map(entity => [entity.id, entity])), ids = space.entities.map(entity => entity.id);
      const live = new Set(ids);
      patch.remove = before.entities.filter(entity => !live.has(entity.id)).map(entity => entity.id);
      if (!same(before.entities.map(entity => entity.id), ids)) patch.order = ids;
      for (const entity of space.entities) {
        const prior = old.get(entity.id);
        if (!prior) { patch.entities.push(entity); continue; }
        const changed = { id: entity.id };
        for (const key of entityFields) if (!same(prior[key], entity[key])) {
          if (key === 'mesh' && prior.mesh && entity.mesh) changed.mesh = Object.fromEntries(meshFields.filter(field => !same(prior.mesh[field], entity.mesh[field])).map(field => [field, entity.mesh[field]]));
          else changed[key] = entity[key];
        }
        if (Object.keys(changed).length > 1) patch.entities.push(changed);
      }
      return patch.remove.length || patch.entities.length || Object.keys(patch).length > 3 ? [patch] : [];
    });
    return structuredClone({ version: 1, baseTick: previous.tick, tick: next.tick, time: next.time, dayTime: next.dayTime, hero: next.hero, torch: next.torch, spaces });
  }
  function validateDelta(delta, assets) {
    requireValue(keys(delta, ['version', 'baseTick', 'tick', 'time', 'dayTime', 'hero', 'torch', 'spaces']) && delta.version === 1, 'invalid world update.');
    validateHeader(delta);
    requireValue(Number.isSafeInteger(delta.baseTick) && delta.baseTick >= 0 && delta.tick > delta.baseTick, 'invalid update base.');
    requireValue(Array.isArray(delta.spaces) && delta.spaces.length <= LIMITS.spaces, 'invalid changed spaces.');
    const seen = new Set(); let changes = 0, blocks = 0;
    for (const patch of delta.spaces) {
      requireValue(object(patch) && ['index', 'remove', 'entities'].every(key => Object.hasOwn(patch, key)) && Object.keys(patch).every(key => ['index', 'remove', 'entities', 'extents', 'transform', 'blocks', 'order'].includes(key)), 'invalid space update fields.');
      requireValue(Number.isInteger(patch.index) && patch.index >= 0 && patch.index < LIMITS.spaces && !seen.has(patch.index), 'invalid or repeated space update.'); seen.add(patch.index);
      requireValue(Array.isArray(patch.remove) && Array.isArray(patch.entities) && (changes += patch.remove.length + patch.entities.length) <= 2 * LIMITS.entities, 'too many entity updates.');
      const touched = new Set();
      for (const id of patch.remove) { requireValue(name(id) && !touched.has(id), 'invalid or repeated entity removal.'); touched.add(id); }
      for (const entity of patch.entities) { validateEntity(entity, assets, true); requireValue(!touched.has(entity.id), 'repeated entity update.'); touched.add(entity.id); }
      if (Object.hasOwn(patch, 'order')) requireValue(Array.isArray(patch.order) && patch.order.length <= LIMITS.entities && Array.from(patch.order).every(name) && new Set(patch.order).size === patch.order.length, 'invalid entity ordering.');
      if (Object.hasOwn(patch, 'extents')) requireValue(vector(patch.extents, 6) && patch.extents.slice(0, 3).every((low, index) => low <= patch.extents[index + 3]), 'invalid space bounds.');
      if (Object.hasOwn(patch, 'transform')) requireValue(vector(patch.transform, 12), 'invalid space transform.');
      if (Object.hasOwn(patch, 'blocks')) {
        requireValue(Array.isArray(patch.blocks) && (blocks += patch.blocks.length) <= LIMITS.blocks, 'too many terrain blocks.');
        for (const block of patch.blocks) validateBlock(block, assets);
      }
    }
    return delta;
  }
  function applyDelta(previous, delta, assets) {
    validateDelta(delta, assets);
    requireValue(previous, 'a world snapshot is required before updates.');
    if (delta.baseTick !== previous.tick) {
      const error = new Error('World update lost synchronization; requesting a fresh snapshot.'); error.code = 'WORLD_BASE_MISMATCH'; throw error;
    }
    const result = structuredClone(previous);
    for (const key of ['tick', 'time', 'dayTime', 'hero', 'torch']) result[key] = structuredClone(delta[key]);
    for (const patch of delta.spaces) {
      requireValue(patch.index < result.spaces.length, 'unknown space update.');
      const space = result.spaces[patch.index], entities = new Map(space.entities.map(entity => [entity.id, entity]));
      for (const id of patch.remove) { requireValue(entities.has(id), 'unknown entity removal.'); entities.delete(id); }
      for (const change of patch.entities) {
        const entity = entities.get(change.id) || { id: change.id };
        for (const key of entityFields) if (Object.hasOwn(change, key)) {
          if (key === 'mesh' && change.mesh !== null) entity.mesh = { ...entity.mesh, ...structuredClone(change.mesh) };
          else entity[key] = structuredClone(change[key]);
        }
        entities.set(change.id, entity);
      }
      if (Object.hasOwn(patch, 'order')) {
        requireValue(patch.order.length === entities.size && patch.order.every(id => entities.has(id)), 'invalid entity ordering.');
        space.entities = patch.order.map(id => entities.get(id));
      } else space.entities = [...entities.values()];
      for (const key of ['extents', 'transform', 'blocks']) if (Object.hasOwn(patch, key)) space[key] = structuredClone(patch[key]);
    }
    return validateSnapshot(result, assets);
  }
  const api = { VERSION, LIMITS, captureSnapshot, validateSnapshot, createDelta, validateDelta, applyDelta };
  if (typeof module !== 'undefined') module.exports = api;
  else root.PolycraftWorldState = api;
})(globalThis);
