'use strict';
const { _electron: electron } = require('playwright-core');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), net = require('node:net');
const { once } = require('node:events');

(async () => {
  const fixture = fs.realpathSync(process.env.POLYCRAFT_CAMPAIGN_FIXTURE || '');
  assert.ok(fixture.startsWith(fs.realpathSync(os.tmpdir()) + path.sep) && path.basename(fixture).startsWith('polycraft-session-ui-'), 'Use a completed disposable session-UI fixture.');
  const originals = new Map(), names = {};
  for (const role of ['host', 'guest']) {
    const source = path.join(fixture, role, 'saves');
    for (const name of fs.readdirSync(source)) originals.set(path.join(source, name), fs.readFileSync(path.join(source, name)));
    const files = fs.readdirSync(source).filter(name => name.endsWith('.json')); assert.equal(files.length, 1); names[role] = files[0];
  }
  const initial = JSON.parse(originals.get(path.join(fixture, 'host/saves', names.host))).state;
  const party = JSON.parse(initial.userData.desktopCoop), pending = JSON.parse(initial.userData.desktopCampaignRewards).pending;
  assert.equal(initial.cheats.everEnabled, false); assert.equal(party.players.length, 2); assert.equal(pending.length, 1);
  const reward = pending[0], guestId = party.players.find(row => row.id !== party.host).id;
  assert.equal(reward.owner, party.host); assert.equal(reward.score.grade, 3); assert.equal(reward.score.xpBonus, 50); assert.deepEqual(reward.score.resourceBonusList, [0, 250]);
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'polycraft-campaign-claim-'));
  for (const role of ['host', 'guest']) fs.cpSync(path.join(fixture, role, 'saves'), path.join(directory, role, 'saves'), { recursive: true });
  console.log('Disposable campaign claim profile:', directory);
  const hostFile = path.join(directory, 'host/saves', names.host), guestFile = path.join(directory, 'guest/saves', names.guest);
  const applications = [], pages = [], errors = [], requests = [];
  const probe = net.createServer().listen(0, '127.0.0.1'); await once(probe, 'listening');
  const port = probe.address().port; await new Promise(resolve => probe.close(resolve));
  let stage = 'open', ownState, ownBytes;
  const saved = () => JSON.parse(fs.readFileSync(hostFile)).state;
  async function focus(index) {
    await applications[index].evaluate(({ app, BrowserWindow }) => { const window = BrowserWindow.getAllWindows()[0]; app.focus({ steal: true }); window.moveTop(); window.focus(); });
    await pages[index].bringToFront();
    await pages[index].waitForFunction(async () => document.hasFocus() && await window.desktop.windowFocused(), null, { timeout: 5000 });
  }
  async function click(index, selector) { await focus(index); await pages[index].locator(selector).click(); }
  async function connection(index, selector) {
    await click(index, selector); await pages[index].locator('#multiplayer-warning[open]').waitFor();
    await click(index, '#multiplayer-warning button[value="continue"]'); await pages[index].locator('#multiplayer-warning').waitFor({ state: 'hidden' });
  }
  async function open(index, recovered = false) {
    const role = index ? 'guest' : 'host';
    const app = applications[index] = await electron.launch({ ...(process.env.POLYCRAFT_EXECUTABLE ? { executablePath: process.env.POLYCRAFT_EXECUTABLE, args: [] } : { args: ['.'] }), env: { ...process.env, POLYCRAFT_TEST_DATA: path.join(directory, role) }, timeout: 90000 });
    const page = pages[index] = await app.firstWindow(); page.on('pageerror', error => errors.push(role + ': ' + error.message)); page.on('request', request => requests.push(request.url()));
    await app.evaluate(({ BrowserWindow }, role) => { const window = BrowserWindow.getAllWindows()[0]; if (!window.isVisible()) throw new Error('Campaign claim test must be visible.'); window.on('page-title-updated', event => event.preventDefault()); window.setTitle('PolyCraft temporary campaign reward — ' + role); }, role);
    await focus(index);
    await Promise.all([page.waitForEvent('domcontentloaded'), page.locator('#save-list article').first().getByRole('button', { name: 'Continue', exact: true }).click({ noWaitAfter: true })]);
    await page.waitForFunction(() => window.polycraft?.controls.ready(), null, { timeout: 60000 });
    if (recovered) await page.waitForFunction(() => document.getElementById('status').textContent.includes('recovery backup'));
    await focus(index); const canvas = page.locator('#turbulenz_game_engine_canvas'), bounds = await canvas.boundingBox(); await canvas.focus();
    const point = await page.evaluate(() => Array.from(window.polycraft.controls.app.globals.guiRenderer.getv2RenderLocation(-220, -70)));
    await page.mouse.move(10, 10); await page.mouse.move(bounds.x + point[0], bounds.y + point[1], { steps: 5 });
    await page.waitForFunction(() => window.polycraft.controls.manager().activeGameState.readyToPlay);
    await page.mouse.click(bounds.x + point[0], bounds.y + point[1], { delay: 100 });
    await page.waitForFunction(() => window.polycraft.controls.manager().activeGameState.name === 'GamestatePlaying');
    // This imported fixture already stages campaign prerequisites; keep scripts from changing it.
    await page.evaluate(() => { const game = window.polycraft.controls.manager(); game.runScripts = false; game.setScriptLocked(false); game.activeGameState.setPlayState('PlayStateNormal'); });
  }
  async function close(index) {
    const app = applications[index], closed = app.waitForEvent('close', { timeout: 20000 });
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close()); await closed; applications[index] = null;
  }
  async function startHost() {
    const host = pages[0];
    await click(0, '#multiplayer'); await host.locator('#connection-method').selectOption('direct');
    if (!await host.locator('#direct-settings').evaluate(node => node.open)) await click(0, '#direct-settings > summary');
    await host.locator('#direct-address').fill('127.0.0.1'); await host.locator('#direct-port').fill(String(port)); assert.equal(await host.locator('#direct-upnp').isChecked(), false);
    await connection(0, '#host-island'); await host.waitForFunction(() => !!window.polycraft.controls.onlineWorld?.players);
  }
  async function join() {
    const [host, guest] = pages; await startHost();
    await host.locator('#guest-hero').selectOption(guestId); await click(0, '#create-invitation');
    await host.waitForFunction(() => document.getElementById('connection-outgoing').value.startsWith('polycraft-direct1.'));
    const invitation = await host.locator('#connection-outgoing').inputValue();
    await guest.evaluate(() => window.polycraft.checkpoint(true)); ownState = await guest.evaluate(() => JSON.stringify(window.polycraft.bridge.state)); ownBytes = fs.readFileSync(guestFile);
    await click(1, '#multiplayer'); await guest.locator('#join-invitation').fill(invitation); await connection(1, '#join-island');
    await guest.waitForFunction(() => !!window.polycraft.controls.guestWorld?.identity && !!window.polycraft.controls.guestWorld.scene.snapshot, null, { timeout: 30000 });
    assert.equal(await guest.evaluate(() => window.polycraft.controls.guestWorld.identity.playerId), guestId);
    await click(0, '#close-multiplayer'); await click(1, '#close-multiplayer');
  }
  async function end() {
    await click(0, '#multiplayer'); await click(0, '#end-session');
    await pages[0].waitForFunction(() => !window.polycraft.controls.onlineWorld);
    await pages[1].waitForFunction(() => !window.polycraft.controls.guestWorld && window.polycraft.controls.ready());
    assert.equal(await pages[1].evaluate(() => JSON.stringify(window.polycraft.bridge.state)), ownState); assert.deepEqual(fs.readFileSync(guestFile), ownBytes);
  }
  const sample = () => pages[0].evaluate(() => window.polycraft.controls.onlineWorld.atRewardBoundary(() => {
    const w = window.polycraft.controls.onlineWorld, data = w.game.getPlayerData();
    return { xp: data.getXP(), resource: [data.getResource(0), data.getResource(1)], amber: data.getSoftCurrency(), pending: structuredClone(w.game.desktopCampaignRewards.data.pending), guestXP: [...w.players.active].find(([id]) => id !== w.players.registry.data.host)?.[1].hero.getEC('ECPlayerData').getXP(), guestSavedXP: w.players.registry.data.players.find(p => p.id !== w.players.registry.data.host).progress.xp, tick: w.game.gameClock.getFrameIndex() };
  }));
  try {
    await open(0); await open(1);
    assert.equal(await pages[0].evaluate(() => window.polycraft.controls.manager().desktopCampaignRewards.current()), undefined, 'The co-op reward cannot be claimed by the solo hero.');
    stage = 'host reward restored'; await join();
    await pages[0].waitForFunction(id => window.polycraft.controls.manager().activeGameState.name === 'GamestateCampaignScore' && window.polycraft.controls.manager().activeGameState.desktopCampaignRewardId === id, reward.id);
    const before = await sample(); assert.deepEqual(before.pending, [reward]);
    await pages[1].waitForFunction(tick => window.polycraft.controls.guestWorld.scene.tick > tick + 30, before.tick);
    assert.equal(await pages[0].evaluate(() => window.polycraft.controls.manager().activeGameState.name), 'GamestateCampaignScore');
    await pages[0].evaluate(() => {
      const ledger = window.polycraft.controls.manager().desktopCampaignRewards, award = ledger.award, own = Object.hasOwn(ledger, 'award');
      window.campaignClaimTrace = []; window.claimedCampaignPanel = window.polycraft.controls.manager().activeGameState;
      ledger.award = function (id, give) { const grants = [], result = award.call(this, id, (xp, resource) => { grants.push({ xp, resource: Array.from(resource) }); return give(xp, resource); }); window.campaignClaimTrace.push({ id, result, grants }); return result; };
      window.restoreCampaignClaim = () => { if (own) ledger.award = award; else delete ledger.award; delete window.restoreCampaignClaim; };
    });
    stage = 'original host reward button'; await focus(0); await pages[0].locator('#turbulenz_game_engine_canvas').focus();
    await pages[0].waitForFunction(() => Object.values(window.polycraft.controls.manager().getGuiManager().prevDrawGuiMap).some(row => row.archetypeName === 'infoPanelUpgradeButton' && row.scale > .95));
    const readButton = () => pages[0].evaluate(() => {
      const c = window.polycraft.controls, [id, row] = Object.entries(c.manager().getGuiManager().prevDrawGuiMap).find(([, row]) => row.archetypeName === 'infoPanelUpgradeButton' && row.scale > .95), p = row.argumentObject.v2ScreenLocation || [row.argumentObject.x, row.argumentObject.y], b = document.getElementById('turbulenz_game_engine_canvas').getBoundingClientRect(), d = c.app.globals.graphicsDevice;
      return { id, x: b.left + p[0] * b.width / d.width, y: b.top + p[1] * b.height / d.height };
    });
    let button = await readButton(), stable = 0; const deadline = Date.now() + 5000;
    while (stable < 3 && Date.now() < deadline) { await pages[0].waitForTimeout(100); const next = await readButton(); stable = Math.hypot(next.x - button.x, next.y - button.y) < .5 ? stable + 1 : 0; button = next; }
    assert.equal(stable, 3, 'The original reward button must settle before clicking.');
    await pages[0].mouse.move(button.x, button.y); await pages[0].waitForFunction(id => window.polycraft.controls.manager().getIMGui().isHot(id), button.id);
    await pages[0].screenshot({ path: path.join(directory, 'host-original-campaign-reward.png') }); await pages[0].mouse.click(button.x, button.y, { delay: 100 });
    await pages[0].waitForFunction(() => window.polycraft.controls.manager().desktopCampaignRewards.data.pending.length === 0 && window.polycraft.controls.manager().activeGameState.name === 'GamestatePlaying');
    const after = await sample(); assert.equal(after.xp, before.xp + 50); assert.deepEqual(after.resource, [before.resource[0], before.resource[1] + 250]); assert.equal(after.amber, before.amber); assert.equal(after.guestXP, before.guestXP);
    assert.deepEqual(await pages[0].evaluate(() => window.campaignClaimTrace), [{ id: reward.id, result: true, grants: [{ xp: 50, resource: [0, 250] }] }]);
    stage = 'stale panel refusal'; assert.equal(await pages[0].evaluate(() => window.claimedCampaignPanel.giveRewards(999, [999, 999])), false);
    const repeated = await sample(); assert.equal(repeated.xp, after.xp); assert.deepEqual(repeated.resource, after.resource); assert.equal(repeated.guestXP, after.guestXP);
    assert.deepEqual(await pages[0].evaluate(() => window.campaignClaimTrace[1]), { id: reward.id, result: false, grants: [] }); await pages[0].evaluate(() => window.restoreCampaignClaim());
    stage = 'focused guest reward HUD'; await focus(1); await pages[1].locator('#turbulenz_game_engine_canvas').focus();
    await pages[1].waitForFunction(resource => window.polycraft.controls.guestWorld.hud.state?.resources.every((amount, i) => amount === resource[i]), after.resource);
    await click(0, '#save-now'); await pages[0].waitForFunction(() => document.getElementById('status').textContent.startsWith('Saved locally at '));
    const firstDisk = saved(), firstParty = JSON.parse(firstDisk.userData.desktopCoop); assert.equal(firstDisk.cheats.everEnabled, false); assert.deepEqual(JSON.parse(firstDisk.userData.desktopCampaignRewards).pending, []); assert.equal(firstParty.players.find(p => p.id === party.host).progress.xp, after.xp); assert.deepEqual(firstParty.economy.resource, after.resource);
    await end(); await close(0); await close(1);
    stage = 'normal restart without reward'; await open(0); await open(1); assert.deepEqual(await pages[0].evaluate(() => window.polycraft.controls.manager().desktopCampaignRewards.data.pending), []); await join();
    const restored = await sample(); assert.equal(restored.xp, after.xp); assert.deepEqual(restored.resource, after.resource); assert.equal(restored.guestXP, after.guestXP); assert.deepEqual(restored.pending, []);
    assert.equal(await pages[0].evaluate(id => window.polycraft.controls.manager().desktopCampaignRewards.award(id, () => { throw new Error('A consumed reward must never execute its grant again.'); }), reward.id), false);
    assert.equal(await pages[0].evaluate(() => window.polycraft.controls.manager().activeGameState.name), 'GamestatePlaying');
    await end(); await close(0); await close(1);
    stage = 'recovery backup retains consumed reward';
    const backup = JSON.parse(fs.readFileSync(hostFile + '.bak')).state, backedParty = JSON.parse(backup.userData.desktopCoop);
    assert.deepEqual(JSON.parse(backup.userData.desktopCampaignRewards).pending, []); assert.equal(backedParty.players.find(p => p.id === party.host).progress.xp, after.xp); assert.deepEqual(backedParty.economy.resource, after.resource);
    fs.copyFileSync(hostFile, path.join(directory, 'host-valid-before-recovery.json')); fs.writeFileSync(hostFile, '{deliberate corruption of this disposable primary only');
    await open(0, true); await startHost(); await click(0, '#close-multiplayer');
    const recovered = await sample(); assert.equal(recovered.xp, after.xp); assert.deepEqual(recovered.resource, after.resource); assert.equal(recovered.guestSavedXP, after.guestXP); assert.deepEqual(recovered.pending, []);
    assert.equal(await pages[0].evaluate(id => window.polycraft.controls.manager().desktopCampaignRewards.award(id, () => { throw new Error('Recovery must not award a consumed campaign.'); }), reward.id), false);
    await click(0, '#multiplayer'); await click(0, '#end-session'); await pages[0].waitForFunction(() => !window.polycraft.controls.onlineWorld); await close(0);
    assert.deepEqual(errors, []); assert.equal(requests.filter(url => /^https?:/i.test(url)).length, 0);
    fs.writeFileSync(path.join(directory, 'campaign-claim-observation.json'), JSON.stringify({ reward, before, after, repeated, restored, recovered }, null, 2));
    console.log('PASS: original host campaign reward claims50XP/250stone once, advances the online world through its menu, replicates shared income, refuses stale panel/reloaded IDs and survives normal two-game exit/restart plus actual backup recovery while retaining guest progression/solo saves:', JSON.stringify({ before, after, restored, recovered }));
  } catch (error) {
    console.error('Campaign claim failure stage:', stage);
    console.log('Campaign host diagnostics:', JSON.stringify(await sample().catch(error => ({ unavailable: error.message }))));
    if (pages[1]) console.log('Campaign guest diagnostics:', JSON.stringify(await pages[1].evaluate(() => { const w = window.polycraft.controls.guestWorld; return w ? { tick: w.scene.tick, nativeFocused: w.movement.nativeFocused, paused: w.controls.paused, request: w.lifeRequest, hud: w.hud.state, connected: w.connection.state } : { online: false }; }).catch(error => ({ unavailable: error.message }))));
    for (let i = 0; i < pages.length; i++) await pages[i].screenshot({ path: path.join(directory, 'campaign-claim-failure-' + i + '.png'), mask: [pages[i].locator('#connection-outgoing'), pages[i].locator('#guest-reply'), pages[i].locator('#join-invitation')] }).catch(() => {});
    throw error;
  } finally {
    for (const app of applications.filter(Boolean)) { await app.evaluate(({ app }) => app.exit()).catch(() => {}); app.process().kill('SIGKILL'); }
    for (const [file, bytes] of originals) assert.deepEqual(fs.readFileSync(file), bytes, 'Original disposable campaign fixture must remain unchanged.');
    console.log('Source campaign fixture unchanged:', originals.size, 'files'); console.log('Disposable campaign claim profile:', directory);
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
