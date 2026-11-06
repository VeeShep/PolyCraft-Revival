'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');

module.exports = async function naturalBandits({ host, guest, focus, hero, hostFile }) {
  const enemies = await host.evaluate(() => {
    const world = window.hostWorld, game = world.game;
    window.naturalBanditKills = [];
    const observe = event => {
      const owner = event.aggressor?.getEC('ECAttach')?.getBaseEntity() || event.aggressor;
      if (event.victim.getName().startsWith('TutorialBandit')) window.naturalBanditKills.push({ victim: event.victim.getName(),
        player: [...world.players.active].find(([, entry]) => entry.hero === owner)?.[0],
        aggressor: event.aggressor?.getName(), owner: owner?.getName(), family: owner?.getFamilyName(), critical: event.isCritical });
    };
    game.eventManager.subscribe('EnemyKilled', observe);
    window.restoreNaturalBanditObserver = () => game.eventManager.unsubscribe('EnemyKilled', observe);
    return game.getGameSpaceList().flatMap(space => space.getEntitiesWithEC('ECAgent')).filter(entity => entity.getName().startsWith('TutorialBandit') && !entity.shouldBeDestroyed()).map(entity => entity.getName());
  });
  assert.equal(enemies.length, 5);
  try {
    await focus();
    await guest.waitForFunction(ids => ids.every(id => { const entry = window.guestWorld.scene.entities.get(id); return entry?.node && entry.record.mesh?.visible; }), enemies);
    const deadline = Date.now() + 60000;
    let clicks = 0;
    while (Date.now() < deadline) {
      if (await host.evaluate(() => window.hostWorld.game.getPlayerData().getTaskFlags().defeatWildlings === true)) break;
      const choice = await guest.evaluate(ids => {
        const world = window.guestWorld, scene = world.scene, actor = scene.entities.get(world.identity.entity);
        if (!actor) return null;
        const p = actor.record.location;
        const entry = ids.map(id => scene.entities.get(id)).filter(entry => entry?.record.health?.current > 0).sort((a, b) => Math.hypot(a.record.location[0] - p[0], a.record.location[2] - p[2]) - Math.hypot(b.record.location[0] - p[0], b.record.location[2] - p[2]))[0];
        if (!entry || !world.movement.available()) return null;
        const target = entry.record.location, dx = target[0] - p[0], dz = target[2] - p[2], m = world.controls.app.globals.camera.matrix;
        const right = (dx * m[0] + dz * m[2]) / Math.hypot(m[0], m[2]), forward = (-dx * m[6] - dz * m[8]) / Math.hypot(m[6], m[8]);
        const point = world.controls.app.globals.camera.worldToScreen(entry.displayLocation || target), b = world.movement.canvas.getBoundingClientRect(), d = world.controls.app.globals.graphicsDevice;
        const event = { clientX: b.left + point[0] * b.width / d.width, clientY: b.top + point[1] * b.height / d.height };
        const selected = window.PolycraftCoopActions.pickTarget(world, event);
        return { distance: Math.hypot(dx, dz), key: Math.abs(right) > Math.abs(forward) ? right > 0 ? 'd' : 'a' : forward > 0 ? 'w' : 's',
          click: ids.includes(selected) && event.clientX > b.left + 20 && event.clientX < b.right - 20 && event.clientY > b.top + 20 && event.clientY < b.bottom - 20 ? { x: event.clientX, y: event.clientY } : null };
      }, enemies);
      if (!choice) { await guest.waitForTimeout(150); continue; }
      if (choice.distance > 6 || !choice.click) {
        await guest.keyboard.down(choice.key);
        try { await guest.waitForTimeout(200); } finally { await guest.keyboard.up(choice.key); }
      } else {
        await guest.mouse.move(choice.click.x, choice.click.y); await guest.mouse.click(choice.click.x, choice.click.y, { delay: 100 }); clicks++;
        await guest.waitForTimeout(400);
      }
    }
    const result = await host.evaluate(async hero => {
      const world = window.hostWorld, game = world.game, actor = world.players.active.get(hero).hero;
      await window.polycraft.checkpoint(true);
      return { kills: window.naturalBanditKills, complete: game.getPlayerData().getTaskFlags().defeatWildlings === true, scripts: game.runScripts,
        health: actor.getEC('ECHealth').getHealth(), inventory: world.players.captureHero(actor).inventory };
    }, hero);
    console.log('Natural bridge combat result:', JSON.stringify({ clicks, result }));
    assert.equal(result.complete, true); assert.equal(result.scripts, true); assert.ok(clicks > 0);
    assert.equal(result.kills.length, 5); assert.equal(new Set(result.kills.map(kill => kill.victim)).size, 5);
    assert.ok(result.kills.some(kill => kill.player === hero), 'The guest must defeat an authored bandit through native combat.');
    assert.ok(result.kills.every(kill => kill.player === hero || kill.family === 'turret_tutorial'), 'Every kill must belong to the guest or the original tutorial turret.');
    await guest.waitForFunction(() => window.guestWorld.quests.state?.completed?.task === 'defeatWildlings');
    const state = JSON.parse(fs.readFileSync(hostFile, 'utf8')).state;
    assert.equal(state.cheats.everEnabled, false); assert.ok(JSON.parse(state.userData.desktopQuests).pending.some(task => task.task === 'defeatWildlings'));
    console.log('Original five-bandit encounter defeated through guest mouse/keyboard and native combat; shared quest and clean history saved.');
  } finally { await host.evaluate(() => window.restoreNaturalBanditObserver()).catch(() => {}); }
};
