'use strict';
const assert = require('node:assert/strict');

module.exports = function questAcceptance(host, guest, focusGuest, hero) {
  const id = 'taskIdcrit_0';
  let before;
  async function button(name, art) {
    await focusGuest();
    await guest.waitForFunction(({ name, art }) => {
      const world = window.polycraft.controls.guestWorld, row = world.game.getGuiManager().prevDrawGuiMap[name];
      return world.movement.nativeFocused && row?.scale > 0.95 && (art ? row.archetypeName === art : true);
    }, { name, art });
    const point = await guest.evaluate(name => {
      const world = window.polycraft.controls.guestWorld, args = world.game.getGuiManager().prevDrawGuiMap[name].argumentObject, position = args.v2ScreenLocation || [args.x, args.y];
      const bounds = world.movement.canvas.getBoundingClientRect(), device = world.controls.app.globals.graphicsDevice;
      const x = bounds.left + position[0] * bounds.width / device.width, y = bounds.top + position[1] * bounds.height / device.height;
      if (x <= bounds.left || x >= bounds.right || y <= bounds.top || y >= bounds.bottom) throw new Error('Quest button is outside the visible canvas.');
      return { x, y };
    }, name);
    await guest.mouse.move(point.x, point.y);
    await guest.waitForFunction(name => window.polycraft.controls.guestWorld.game.getIMGui().isHot(name), name);
    await guest.mouse.click(point.x, point.y, { delay: 100 });
  }
  async function state() {
    return host.evaluate(hero => {
      const controls = window.polycraft.controls, game = controls.manager();
      const registry = controls.onlineWorld?.players.registry.data || JSON.parse(window.polycraft.bridge.state.userData.desktopCoop);
      const player = registry.players.find(player => player.id === hero);
      return { pending: JSON.parse(window.polycraft.bridge.state.userData.desktopQuests).pending,
        flags: game.getPlayerData().getTaskFlags(), xp: controls.onlineWorld?.players.active.get(hero)?.model.getXP() ?? player.progress.xp,
        hostXP: controls.onlineWorld ? game.getHero().getEC('ECPlayerData').getXP() : registry.players.find(player => player.id === registry.host).progress.xp,
        amber: controls.onlineWorld ? controls.amounts().amber : registry.economy.softCurrency };
    }, hero);
  }
  return {
    async prepare() {
      await guest.waitForFunction(() => window.polycraft.controls.guestWorld.quests.state?.tasks.some(row => row.id === 'taskIdcrit_0' && row.task === 'wakeUp'));
      await guest.waitForFunction(() => { const row = window.polycraft.controls.guestWorld.game.getGuiManager().prevDrawGuiMap['guest-idTaskNewsFlashtaskIdcrit_0']; return row?.scale > 0.95 && row.archetypeName === 'taskNewsflash' && !!row.argumentObject.text1 && !!row.argumentObject.text2; });
      await guest.screenshot({ path: 'test-results/session-ui-quest-newsflash.png' });
      await button('guest-idTaskHelpButton' + id);
      await guest.waitForFunction(() => window.polycraft.controls.guestWorld.quests.description?.taskId === 'taskIdcrit_0' && !window.polycraft.controls.guestWorld.quests.openRequest);
      await button('guest-idDescriptionCloseTaskButton' + id, 'taskDescriptionCloseButton');
      await guest.waitForFunction(() => !window.polycraft.controls.guestWorld.quests.description);
      before = await state();
      assert.deepEqual(before.pending, []);
      // Stage the original completion event; this does not test natural tutorial progression.
      await host.evaluate(() => window.polycraft.controls.onlineWorld.atBoundary(() => window.polycraft.controls.manager().eventManager.notify('wakeUpTaskComplete', {})));
      await guest.waitForFunction(() => window.polycraft.controls.guestWorld.quests.state?.completed?.id === 'taskIdcrit_0');
      await host.evaluate(() => window.polycraft.checkpoint(true));
      assert.deepEqual((await state()).pending, [{ id, task: 'wakeUp' }]);
      console.log('Original guest quest description/close and staged native completion leave one saved, unclaimed reward.');
    },
    async pendingAfterReload() {
      const value = await state();
      assert.deepEqual(value.pending, [{ id, task: 'wakeUp' }]);
      assert.equal(value.flags.wakeUp, true); assert.equal(value.xp, before.xp); assert.equal(value.amber, before.amber);
    },
    async collect() {
      await guest.waitForFunction(() => window.polycraft.controls.guestWorld.quests.state?.completed?.id === 'taskIdcrit_0');
      // Isolate the collecting hero from the host; collection still uses native pickup updates.
      await host.evaluate(hero => window.polycraft.controls.onlineWorld.atBoundary(() => {
        const world = window.polycraft.controls.onlineWorld, game = world.game, entity = world.players.active.get(hero).hero;
        const totem = game.getGameSpaceList().flatMap(space => space.getEntitiesWithEC('ECHeroShrine')).find(entity => entity.getEC('ECHeroShrine').archetype.upgradeTypes[0].upgradeType === 'movementSpeed');
        const location = Array.from(totem.getv3Location()); location[0] += 3;
        entity.getEC('ECLocomotion').clearDestination(); entity.teleport(location, game.globals.mathDevice.v3Sub(location, entity.getv3Location()));
        window.questAcceptancePickupNames = game.getGameSpaceList().flatMap(space => space.getEntitiesWithEC('ECPickup')).map(entity => entity.getName());
      }), hero);
      await guest.evaluate(() => { window.polycraft.controls.guestWorld.lastTargetResult = null; });
      await button('guest-idAcceptTaskRewardButton' + id, 'taskAcceptRewardButton');
      await guest.waitForFunction(() => window.polycraft.controls.guestWorld.lastTargetResult?.type === 'questReward');
      assert.equal(await guest.evaluate(() => window.polycraft.controls.guestWorld.lastTargetResult.message), 'Quest reward dropped and saved.');
      const drops = await host.evaluate(() => window.polycraft.controls.manager().getGameSpaceList().flatMap(space => space.getEntitiesWithEC('ECPickup'))
        .filter(entity => !window.questAcceptancePickupNames.includes(entity.getName())).map(entity => entity.getName()));
      assert.ok(drops.length <= 2, 'Only the two expected quest drops may appear in this fixture.');
      // Native drops scatter over grid cells; standing still need not attract every pickup.
      for (const name of drops) {
        await host.waitForFunction(name => { const entity = window.polycraft.controls.manager().getGameEntityByName(name); return !entity || entity.shouldBeDestroyed() || entity.getEC('ECPickup').animatedIn; }, name);
        await host.evaluate(({ hero, name }) => window.polycraft.controls.onlineWorld.atBoundary(() => {
          const world = window.polycraft.controls.onlineWorld, drop = world.game.getGameEntityByName(name);
          if (!drop || drop.shouldBeDestroyed() || drop.getEC('ECPickup').hasBeenPickedUp()) return;
          const entity = world.players.active.get(hero).hero, location = Array.from(drop.getv3Location());
          entity.getEC('ECLocomotion').clearDestination(); entity.teleport(location, world.game.globals.mathDevice.v3Sub(location, entity.getv3Location()));
        }), { hero, name });
        await host.waitForFunction(name => { const entity = window.polycraft.controls.manager().getGameEntityByName(name); return !entity || entity.shouldBeDestroyed() || entity.getEC('ECPickup').hasBeenPickedUp(); }, name);
      }
      await host.waitForFunction(({ hero, xp, amber }) => {
        const controls = window.polycraft.controls;
        return controls.onlineWorld.players.active.get(hero).model.getXP() === xp + 20 && controls.amounts().amber === amber + 1;
      }, { hero, xp: before.xp, amber: before.amber }, { timeout: 15000 });
      const value = await state();
      assert.deepEqual(value.pending, []); assert.equal(value.hostXP, before.hostXP);
      await guest.waitForFunction(({ xp, amber }) => {
        const hud = window.polycraft.controls.guestWorld.hud;
        return hud.state?.xp === xp + 20 && hud.state.amber === amber + 1 && Math.abs(hud.data.getVisibleXP() - (xp + 20)) < 0.01;
      }, before);
      await guest.screenshot({ path: 'test-results/session-ui-quest-collected.png' });
      console.log('Original guest Accept reward click and native pickups grant that hero 20 XP and the shared island 1 Amber, leaving host XP unchanged.');
    },
    async collectedAfterReload() {
      const value = await state();
      assert.deepEqual(value.pending, []); assert.equal(value.flags.wakeUp, true);
      assert.equal(value.xp, before.xp + 20); assert.equal(value.hostXP, before.hostXP); assert.equal(value.amber, before.amber + 1);
    },
    async rejectRepeat() {
      await guest.evaluate(id => { const world = window.polycraft.controls.guestWorld; world.lastTargetResult = null; world.sendQuest('questReward', id); }, id);
      await guest.waitForFunction(() => window.polycraft.controls.guestWorld.lastTargetResult?.type === 'questReward');
      assert.equal(await guest.evaluate(() => window.polycraft.controls.guestWorld.lastTargetResult.message), 'That reward was already accepted or changed.');
      await this.collectedAfterReload();
      await guest.waitForFunction(({ xp, amber }) => { const hud = window.polycraft.controls.guestWorld.hud.state; return hud?.xp === xp + 20 && hud.amber === amber + 1; }, before);
      console.log('Unclaimed reward survives a real host reload; collected reward/progression survive a second reload/rejoin and a duplicate request is rejected.');
    }
  };
};
