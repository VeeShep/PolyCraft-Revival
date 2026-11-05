'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');

module.exports = async function craftAcceptance(host, guests, focusGuest, saveFile) {
  const before = await host.evaluate(async () => window.hostWorld.atBoundary(() => {
    const controls = window.polycraft.controls, world = window.hostWorld, game = world.game;
    const amounts = controls.amounts(), amount = Math.round(amounts.woodCap * 0.1);
    if (amount <= 0) throw new Error('Craft acceptance requires a real, activated lumber storage on the disposable island.');
    const cost = controls.shopMethods.getCostForResourceAmount.call({ globals: game.globals }, amount);
    window.craftAcceptance = { simulations: 0, update: game.updateSimulation };
    game.updateSimulation = function (...args) { window.craftAcceptance.simulations++; return window.craftAcceptance.update.apply(this, args); };
    controls.setAmounts(cost * 4, 0, amounts.stone);
    return { amounts, amount, cost };
  }));
  const guest = guests[0];
  try {
    for (const page of guests) await page.evaluate(() => {
      window.craftAcceptance = { results: {}, receive: window.connection.onMessage };
      window.connection.onMessage = function (message, link) {
        const result = window.craftAcceptance.receive.call(this, message, link);
        if (message.kind === 'result' && ['craftMenu', 'craftResource'].includes(message.payload.type)) window.craftAcceptance.results[message.payload.sequence] = structuredClone(message.payload);
        return result;
      };
    });
    async function clickButton(id, art) {
      await guest.waitForFunction(({ id, art }) => {
        const world = window.guestWorld, row = world.game.getGuiManager().prevDrawGuiMap[id];
        return world.movement.nativeFocused && row?.scale > 0.95 && row.archetypeName === art;
      }, { id, art });
      const point = await guest.evaluate(id => {
        const world = window.guestWorld, globals = world.controls.app.globals;
        const position = world.game.getGuiManager().prevDrawGuiMap[id].argumentObject.v2ScreenLocation, bounds = world.movement.canvas.getBoundingClientRect();
        const x = bounds.left + position[0] * bounds.width / globals.graphicsDevice.width, y = bounds.top + position[1] * bounds.height / globals.graphicsDevice.height;
        if (x <= bounds.left || x >= bounds.right || y <= bounds.top || y >= bounds.bottom) throw new Error('Craft button is outside the visible canvas: ' + id);
        return { x, y };
      }, id);
      await guest.mouse.move(point.x, point.y);
      await guest.waitForFunction(id => window.guestWorld.movement.nativeFocused && window.guestWorld.game.getIMGui().isHot(id), id);
      await guest.mouse.click(point.x, point.y, { delay: 100 });
    }
    await focusGuest(); await clickButton('guest-shop', 'shop');
    await guest.waitForFunction(() => window.guestWorld.craft.menu && window.guestWorld.craft.view && !window.guestWorld.craft.pending);
    assert.deepEqual(await guest.evaluate(() => Array.from(window.guestWorld.craft.view.tabList, tab => tab.guiArchetype)), ['shopTabCraftUp']);
    const simulations = await host.evaluate(() => window.craftAcceptance.simulations);
    await host.waitForFunction(count => window.craftAcceptance.simulations > count + 2, simulations);
    await guest.keyboard.down('KeyW');
    assert.deepEqual(await guest.evaluate(() => window.guestWorld.movement.direction()), [0, 0], 'Craft menu blocks local movement without stopping host simulation');
    await guest.keyboard.up('KeyW');
    const button = await guest.evaluate(() => 'shop' + window.guestWorld.craft.view.getFillFractionText(0, 0.1).id);
    await guest.evaluate(() => { window.guestWorld.lastTargetResult = null; });
    await clickButton(button, 'shopLumber');
    await guest.waitForFunction(() => window.guestWorld.lastTargetResult?.type === 'craftResource');
    assert.equal(await guest.evaluate(() => window.guestWorld.lastTargetResult.message), 'Resources crafted and saved.');
    const after = await host.evaluate(() => window.polycraft.controls.amounts());
    assert.equal(after.amber, before.cost * 3); assert.equal(after.wood, before.amount);
    const saved = JSON.parse(JSON.parse(fs.readFileSync(saveFile)).state.userData.desktopCoop);
    assert.equal(saved.economy.softCurrency, after.amber); assert.equal(saved.economy.resource[0], after.wood, 'Craft acknowledgement follows the actual disk save');
    await clickButton('Shop Resume', 'shopClose');
    await guest.waitForFunction(() => !window.guestWorld.localMenu());
    await clickButton('guest-shop', 'shop');
    await guest.waitForFunction(() => window.guestWorld.craft.view && !window.guestWorld.craft.pending);
    await guest.keyboard.press('Escape'); await guest.waitForFunction(() => !window.guestWorld.localMenu());
    assert.deepEqual(await host.evaluate(() => window.polycraft.controls.amounts()), after, 'Close and Escape spend nothing');

    // Protocol race uses all connected guests; desktop focus allows only one visible menu at a time.
    await host.evaluate(async cost => window.hostWorld.atBoundary(() => {
      const controls = window.polycraft.controls; controls.setAmounts(cost, 0, controls.amounts().stone);
    }), before.cost);
    const queries = await Promise.all(guests.map(page => page.evaluate(() => window.guestWorld.sendTarget('craftMenu', window.guestWorld.identity.entity))));
    await Promise.all(guests.map((page, index) => page.waitForFunction(sequence => window.craftAcceptance.results[sequence]?.craft, queries[index])));
    const purchases = await Promise.all(guests.map((page, index) => page.evaluate(query => {
      const world = window.guestWorld, quote = window.craftAcceptance.results[query].craft.quote, sequence = ++world.targetSequence;
      return world.connection.send('action', { type: 'craftResource', target: world.identity.entity, quote, sequence, index: 3 }).then(() => sequence);
    }, queries[index])));
    await Promise.all(guests.map((page, index) => page.waitForFunction(sequence => window.craftAcceptance.results[sequence], purchases[index])));
    const results = await Promise.all(guests.map((page, index) => page.evaluate(sequence => window.craftAcceptance.results[sequence], purchases[index])));
    assert.equal(results.filter(result => result.message === 'Resources crafted and saved.').length, 1);
    assert.ok(results.every(result => ['Resources crafted and saved.', 'Not enough Amber.'].includes(result.message)), 'Every guest receives a valid result, without silently losing a request');
    const raced = await host.evaluate(() => window.polycraft.controls.amounts());
    assert.equal(raced.amber, 0); assert.equal(raced.wood, before.amount, 'Concurrent guests cannot duplicate resources or overspend');
    const raceSave = JSON.parse(JSON.parse(fs.readFileSync(saveFile)).state.userData.desktopCoop);
    assert.equal(raceSave.economy.softCurrency, 0); assert.equal(raceSave.economy.resource[0], before.amount);
    console.log('Original guest Craft Resource clicks, close/Escape, paid save-before-ack and multi-guest shared-budget race passed.', { guests: guests.length, cost: before.cost, amount: before.amount });
  } finally {
    for (const page of guests) await page.evaluate(() => {
      if (window.craftAcceptance) { window.connection.onMessage = window.craftAcceptance.receive; delete window.craftAcceptance; }
    }).catch(() => {});
    await host.evaluate(async amounts => {
      const proof = window.craftAcceptance;
      if (proof) { window.hostWorld.game.updateSimulation = proof.update; delete window.craftAcceptance; }
      await window.hostWorld.atBoundary(() => window.polycraft.controls.setAmounts(amounts.amber, amounts.wood, amounts.stone));
      await window.polycraft.checkpoint(true);
    }, before.amounts);
  }
};
