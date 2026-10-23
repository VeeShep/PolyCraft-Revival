'use strict';
(function (root) {
  const VERSION = 3;
  const LIMITS = Object.freeze({ spaces: 128, blocks: 20000, entities: 10000 });
  const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
  const number = value => typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= 1e9;
  const vector = (value, size) => Array.isArray(value) && value.length === size && value.every(number);
  const name = value => typeof value === 'string' && value.length > 0 && value.length <= 256;
  function requireValue(valid, message) { if (!valid) throw new Error('Invalid world snapshot: ' + message); }
  function keys(value, expected) {
    return object(value) && Object.keys(value).length === expected.length && expected.every(key => Object.hasOwn(value, key));
  }
  function validateSnapshot(snapshot, assets) {
    requireValue(keys(snapshot, ['version', 'tick', 'time', 'dayTime', 'hero', 'torch', 'spaces']), 'missing or unexpected fields.');
    requireValue(snapshot.version === VERSION, 'incompatible version.');
    requireValue(Number.isSafeInteger(snapshot.tick) && snapshot.tick >= 0 && number(snapshot.time) && snapshot.time >= 0, 'invalid simulation time.');
    requireValue(number(snapshot.dayTime) && snapshot.dayTime >= 0 && snapshot.dayTime <= 24 && name(snapshot.hero), 'invalid island clock or hero.');
    requireValue(snapshot.torch === null || (keys(snapshot.torch, ['transform', 'visible']) && vector(snapshot.torch.transform, 12) && typeof snapshot.torch.visible === 'boolean'), 'invalid hero light.');
    requireValue(Array.isArray(snapshot.spaces) && snapshot.spaces.length > 0 && snapshot.spaces.length <= LIMITS.spaces, 'invalid space count.');
    const ids = new Set();
    let blocks = 0, entities = 0;
    for (const space of snapshot.spaces) {
      requireValue(keys(space, ['extents', 'transform', 'blocks', 'entities']) && vector(space.extents, 6) && vector(space.transform, 12), 'invalid space transform.');
      requireValue(space.extents.slice(0, 3).every((low, index) => low <= space.extents[index + 3]), 'inverted space bounds.');
      requireValue(Array.isArray(space.blocks) && Array.isArray(space.entities), 'invalid space contents.');
      blocks += space.blocks.length; entities += space.entities.length;
      requireValue(blocks <= LIMITS.blocks && entities <= LIMITS.entities, 'too many world objects.');
      for (const block of space.blocks) {
        requireValue(keys(block, ['archetype', 'location', 'scale', 'rotation']) && name(block.archetype) && vector(block.location, 3) && vector(block.scale, 3) && number(block.rotation), 'invalid terrain block.');
        if (assets) requireValue(assets.hasBlock(block.archetype), 'unknown terrain block.');
      }
      for (const entity of space.entities) {
        requireValue(keys(entity, ['id', 'archetype', 'interactive', 'location', 'scale', 'rotation', 'mesh', 'health']) && name(entity.id) && (entity.archetype === null || name(entity.archetype)) && typeof entity.interactive === 'boolean' && vector(entity.location, 3) && vector(entity.scale, 3) && number(entity.rotation), 'invalid entity.');
        requireValue(!ids.has(entity.id), 'duplicate entity identity.'); ids.add(entity.id);
        if (entity.mesh !== null) {
          const mesh = entity.mesh;
          requireValue(keys(mesh, ['path', 'transform', 'visible', 'skin']) && typeof mesh.path === 'string' && mesh.path.length > 0 && mesh.path.length <= 512 && !mesh.path.includes('..') && !/[:\\\x00-\x1f]/.test(mesh.path) && !mesh.path.startsWith('/') && vector(mesh.transform, 12) && typeof mesh.visible === 'boolean', 'invalid entity mesh.');
          requireValue(mesh.skin === null || (Array.isArray(mesh.skin) && mesh.skin.length > 0 && mesh.skin.length <= 3072 && mesh.skin.length % 12 === 0 && mesh.skin.every(number)), 'invalid skin matrices.');
          if (assets) requireValue(assets.hasMesh(mesh.path), 'unknown mesh asset.');
        }
        if (entity.health !== null) requireValue(keys(entity.health, ['current', 'maximum']) && number(entity.health.current) && number(entity.health.maximum) && entity.health.maximum >= 0, 'invalid entity health.');
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
            interactive: !!(entity.getEC('ECResourceDispenser') || entity.getEC('ECTarget') || entity.getEC('ECBuilding') || entity.getEC('ECDispenser')),
            location: Array.from(entity.getv3Location()), scale: Array.from(entity.getV3Scale()), rotation: entity.getRotationY(),
            mesh: mesh?.node ? { path: mesh.getMeshPath(), transform: Array.from(mesh.getm43Transform()), visible: !mesh.node.disabled, skin: skin ? Array.from(skin.output) : null } : null,
            health: health ? { current: health.getHealth(), maximum: health.getMaxHealth() } : null
          };
        })
      }))
    };
    return validateSnapshot(snapshot);
  }
  const api = { VERSION, LIMITS, captureSnapshot, validateSnapshot };
  if (typeof module !== 'undefined') module.exports = api;
  else root.PolycraftWorldState = api;
})(globalThis);
