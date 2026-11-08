'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');

module.exports = async function naturalWorkers({ host, guest, guests, focusGuest, focus, hostFile }) {
  const baseline = await host.evaluate(() => {
    const game = window.hostWorld.game;
    const workers = ['Lumberling Hut', 'Stoneling Hut'].map((type, resource) => {
      const house = game.getBuildingManager().getBuildingsAtMinLevel(type, 1, false).find(entity => !entity.getEC('ECScaffold'));
      const entity = house?.getEC('ECWildlingHouse')?.getWildling(), agent = entity?.getEC('ECWildlingAgent');
      if (!entity || entity.shouldBeDestroyed() || !agent) throw new Error('Missing original worker for ' + type);
      return { entity, agent, resource };
    });
    const state = window.nativeWorkerObservation = { workers: workers.map(({ entity, resource }) => ({ id: entity.getName(), resource })), harvests: [], deposits: [] };
    const restore = workers.map(({ agent, entity, resource }) => {
      const own = Object.hasOwn(agent, 'interactWithTargetResourceDispenser'), original = agent.interactWithTargetResourceDispenser;
      agent.interactWithTargetResourceDispenser = function (...args) {
        const target = this.getTargetResourceDispenser(), source = target?.getEC('ECResourceDispenser');
        const amount = original.apply(this, args);
        if (amount > 0 && source?.getResourceType() === resource) state.harvests.push({ id: entity.getName(), resource, amount, source: target.getName() });
        return amount;
      };
      return () => { if (own) agent.interactWithTargetResourceDispenser = original; else delete agent.interactWithTargetResourceDispenser; };
    });
    const deposit = event => state.deposits.push({ id: event.entity.getName(), resource: event.type, amount: event.amount });
    game.eventManager.subscribe('ResourceDeposited', deposit);
    window.restoreNativeWorkerObservation = () => { restore.forEach(fn => fn()); game.eventManager.unsubscribe('ResourceDeposited', deposit); delete window.nativeWorkerObservation; delete window.restoreNativeWorkerObservation; };
    return { resources: [0, 1].map(type => game.getPlayerData().getResource(type)), workers: state.workers };
  });
  console.log('Native worker productivity baseline:', JSON.stringify(baseline));
  try {
    let result;
    for (let poll = 0; poll < 24; poll++) {
      await guest.waitForTimeout(10000);
      result = await host.evaluate(() => {
        const game = window.hostWorld.game, state = window.nativeWorkerObservation;
        return { ...state, resources: [0, 1].map(type => game.getPlayerData().getResource(type)), scripts: game.runScripts,
          positions: state.workers.map(({ id }) => { const entity = game.getGameEntityByName(id); return { id, location: entity && Array.from(entity.getv3Location()) }; }) };
      });
      console.log('Native worker productivity:', JSON.stringify({ poll, ...result }));
      if (baseline.workers.every(worker => result.harvests.some(event => event.id === worker.id && event.resource === worker.resource && event.amount > 0) && result.deposits.some(event => event.id === worker.id && event.resource === worker.resource && event.amount > 0))) break;
    }
    assert.equal(result.scripts, true);
    for (const worker of baseline.workers) {
      assert.ok(result.harvests.some(event => event.id === worker.id && event.resource === worker.resource && event.amount > 0), 'Each native worker must harvest its own resource.');
      assert.ok(result.deposits.some(event => event.id === worker.id && event.resource === worker.resource && event.amount > 0), 'Each native worker must deliver a positive amount.');
    }
    for (const resource of [0, 1]) assert.equal(result.resources[resource], baseline.resources[resource] + result.deposits.filter(event => event.resource === resource).reduce((sum, event) => sum + event.amount, 0));
    // Workers keep running while HUDs are checked; compare against the observed balance floor.
    const huds = [];
    for (let index = 0; index < guests.length; index++) {
      await focusGuest(index);
      await guests[index].waitForFunction(resources => window.guestWorld.hud.state?.resources.every((amount, resource) => amount >= resources[resource]), result.resources);
      huds.push(await guests[index].evaluate(() => Array.from(window.guestWorld.hud.state.resources)));
    }
    const upper = await host.evaluate(() => [0, 1].map(type => window.hostWorld.game.getPlayerData().getResource(type)));
    for (const hud of huds) for (const resource of [0, 1]) assert.ok(hud[resource] >= result.resources[resource] && hud[resource] <= upper[resource], 'Guest HUD income must stay within observed host balances.');
    await host.evaluate(() => window.polycraft.checkpoint(true));
    const state = JSON.parse(fs.readFileSync(hostFile, 'utf8')).state, coop = JSON.parse(state.userData.desktopCoop);
    assert.equal(state.cheats.everEnabled, false);
    for (const resource of [0, 1]) assert.ok(coop.economy.resource[resource] >= result.resources[resource], 'The normal save must retain observed native worker income.');
    await focus();
    console.log('PASS: both native workers harvested and deposited their resources; shared accounting, all guest HUDs and the clean save retain income.');
  } catch (error) {
    await guest.screenshot({ path: path.join(path.dirname(hostFile), '..', 'worker-productivity-failure.png'), timeout: 5000 }).catch(() => {});
    throw error;
  } finally { await host.evaluate(() => window.restoreNativeWorkerObservation()).catch(() => {}); }
};
