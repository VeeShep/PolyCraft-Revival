'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const ast = require('./runtime-ast.cjs');
const { campaignContext, validateCampaign, GuestCampaign } = require('../desktop/campaign.js');
const { HostActions } = require('../desktop/coop-actions.js');
function fixture() {
  const events = [], state = { enabled: true, banner: true, interactable: true, outpost: true, script: false, health: 50, building: false, active: null, phase: 'PlayStateNormal', screen: 'GamestatePlaying' };
  const game = { globals: { metricsManager: { sendGameMetric: (...args) => events.push(['metric', ...args]) } }, eventManager: { notify: (...args) => events.push(args) } };
  const runtime = ast.campaignRuntime({ create: () => ({ setPlayState: name => { events.push(['phase', name]); state.phase = name; } }) }, { get campaignsEnabled() { return state.enabled; } }, {});
  const source = { name: 'banner', shouldBeDestroyed: () => false, getEC: name => name === 'ECCampaignStarter' ? { isCampaignRegionEnabled: () => state.banner, getCampaignRegionName: () => 'N' } : name === 'ECInteractable' ? { getActive: () => state.interactable } : null };
  const war = { campaignRegionMap: { N: { campaignStarterEntity: source } }, getActiveCampaignRegionName: () => state.active, getCampaignArchetypeName: () => state.campaign || 'campaign_tutorial_01', getNumberOfBattlesInCampaign: () => 1, getNextBattleArchetypeQuantities: () => ({ a_melee: 4 }), beginCampaign: region => { state.active = region; events.push(['CampaignStarted', region]); } };
  const owner = { getEC: () => war };
  const hero = { shouldBeDestroyed: () => false, getEC: name => ({ ECHealth: { getHealth: () => state.health }, ECPlayerBuilder: { isBuilding: () => state.building, isThrowing: () => false } })[name], getGameSpace: () => assert.fail('Campaign ownership must not come from the guest space') };
  Object.assign(game, {
    getHero: () => ({ getGameSpace: () => ({ getEntitiesWithEC: () => [owner] }), getEC: () => ({ getLevel: () => 2, sendResourceRegisterMetric: () => events.push(['resource-metric']) }) }),
    getEntityFactory: () => ({ getArchetypeList: () => ['a_melee'] }), getGameEntityByName: id => id === 'banner' ? source : null,
    getActiveGameState: () => ({ name: state.screen }), getPlayState: () => ({ playStateName: state.phase }),
    getGameEntitiesByFamilyName: family => { assert.equal(family, 'outpost'); return state.outpost ? [{ shouldBeDestroyed: () => false }] : []; },
    getBuildingManager: () => ({ getBuildingCount: () => 1 }), isScriptLocked: () => state.script,
    setGameState: () => events.push(['set-state'])
  });
  const controls = { campaignMethods: runtime }, actions = new HostActions();
  const execute = (type, action = {}) => actions.execute(game, hero, {}, 'banner', controls, type, action);
  const preview = () => execute('target');
  return { game, hero, source, war, owner, controls, actions, execute, preview, state, events };
}
test('guest campaign preview uses native gates and the exact island banner without opening the global host menu or charging a level cost', () => {
  const f = fixture(), before = JSON.stringify(f.state), result = f.preview();
  assert.deepEqual(result.campaign, { source: 'banner', region: 'N', campaign: 'campaign_tutorial_01', battles: 1, enemies: [{ archetype: 'a_melee', count: 4 }] });
  assert.equal(f.events.length, 0); assert.equal(JSON.stringify(f.state), before);
  for (const [key, value] of [['enabled', false], ['banner', false], ['interactable', false], ['outpost', false], ['active', 'E'], ['phase', 'PlayStateBattle'], ['screen', 'GamestatePaused']]) {
    const old = f.state[key]; f.state[key] = value; assert.equal(campaignContext(f.game, f.source, f.controls), null, key); f.state[key] = old;
  }
  f.war.campaignRegionMap.N.campaignStarterEntity = {}; assert.equal(campaignContext(f.game, f.source, f.controls), null);
});
test('native confirmation preserves transition and metric ordering, consumes one offer and blocks two guests from starting twice', () => {
  const f = fixture(), other = new HostActions(); f.preview();
  other.execute(f.game, f.hero, {}, 'banner', f.controls, 'target');
  const result = f.execute('campaignStart', { campaign: 'campaign_tutorial_01' });
  assert.equal(result.save, true); assert.equal(f.state.active, 'N');
  assert.deepEqual(f.events.map(row => row[0]), ['CampaignStarted', 'phase', 'set-state', 'CampaignPrepareScreenExited', 'metric', 'resource-metric']);
  assert.match(f.execute('campaignStart', { campaign: 'campaign_tutorial_01' }), /preview changed/);
  assert.match(other.execute(f.game, f.hero, {}, 'banner', f.controls, 'campaignStart', { campaign: 'campaign_tutorial_01' }), /another player/);
  assert.equal(f.events.filter(row => row[0] === 'CampaignStarted').length, 1);
});
test('confirmation rechecks live eligibility, campaign rotation, identity and actor state; cancel only exits its own offered screen', () => {
  for (const [key, value] of [['enabled', false], ['banner', false], ['interactable', false], ['outpost', false], ['campaign', 'campaign_tutorial_02'], ['script', true], ['health', 0], ['building', true]]) {
    const f = fixture(); f.preview(); f.state[key] = value;
    const result = f.execute('campaignStart', { campaign: 'campaign_tutorial_01' }); assert.equal(typeof result, 'string', key); assert.equal(f.events.length, 0, key);
  }
  const f = fixture(); f.preview(); f.war.campaignRegionMap.N.campaignStarterEntity = {};
  assert.equal(typeof f.execute('campaignStart', { campaign: 'campaign_tutorial_01' }), 'string'); assert.equal(f.events.length, 0);
  const replaced = fixture(); replaced.preview(); const replacement = { ...replaced.source };
  replaced.game.getGameEntityByName = () => replacement; replaced.war.campaignRegionMap.N.campaignStarterEntity = replacement;
  assert.equal(typeof replaced.execute('campaignStart', { campaign: 'campaign_tutorial_01' }), 'string'); assert.equal(replaced.events.length, 0);
  const closed = fixture(); closed.preview(); assert.equal(closed.execute('campaignClose', { campaign: 'campaign_tutorial_01' }).save, true);
  assert.deepEqual(closed.events, [['CampaignPrepareScreenExited']]); assert.equal(closed.state.active, null);
  assert.equal(typeof closed.execute('campaignClose', { campaign: 'campaign_tutorial_01' }), 'string'); assert.equal(closed.events.length, 1);
});
test('campaign actions retain shared sequence/rate validation and refuse forged authority or malformed campaigns', () => {
  for (const type of ['campaignStart', 'campaignClose']) {
    const good = { type, sequence: 1, target: 'banner', campaign: 'campaign_tutorial_01' };
    for (const bad of [{ ...good, campaign: [] }, { ...good, campaign: '__proto__' }, { ...good, campaign: 'x'.repeat(101) }, { ...good, level: 0 }, { ...good, playerId: 'other' }]) assert.throws(() => new HostActions().receive(bad), /Invalid/);
    const actions = new HostActions(); actions.receive(good); assert.throws(() => actions.receive(good), /repeated/);
  }
  const f = fixture(); assert.match(f.execute('campaignStart', { campaign: 'campaign_tutorial_01' }), /preview changed/); assert.equal(f.events.length, 0);
});
test('campaign preview parsing refuses missing/sparse/unknown metadata before any guest state changes', () => {
  const f = fixture(), view = f.preview().campaign;
  for (const extra of [{ source: '' }, { region: [] }, { campaign: '__proto__' }, { campaign: 'unknown' }, { battles: 0 }, { battles: Infinity }, { enemies: Array(1) }, { enemies: [{ archetype: 'unknown', count: 1 }] }, { enemies: [{ archetype: 'a_melee', count: -1 }] }, { enemies: [view.enemies[0], view.enemies[0]] }, { rewards: [999] }]) assert.throws(() => validateCampaign({ ...view, ...extra }, f.controls, f.game), /Invalid campaign/);
});
function guestFixture() {
  const f = fixture(), sent = [], sounds = [], buttons = [], drawn = []; let choice = '';
  const panels = { getEnemyQuantityInfo: (game, language, quantities) => { assert.deepEqual(quantities, { a_melee: 4 }); return { enemySpritePathList: ['gui/native-enemy.svg'], enemyDisplayNameList: ['Melee x4'] }; },
    doInfoPanel: (game, globals, styles, args) => { drawn.push({ styles, args }); game.getIMGui().doButton({ id: 'bookend-confirm' }); return choice; } };
  const runtime = ast.campaignRuntime({}, {}, panels);
  const globals = Object.assign(f.game.globals, { currentLanguage: new Proxy({}, { get: (_, key) => String(key) }), guiRenderer: { getv2RenderLocation: (x, y) => [x, y] } });
  f.game.getIMGui = () => ({ doBackground() {}, doButton: options => { buttons.push(options); return false; } });
  f.game.getGuiManager = () => ({ addDrawGui: () => {} }); f.game.gameSoundManager = { playInternal: (...args) => sounds.push(args) };
  Object.assign(f.controls, { infoPanels: { doCampaignStartBookend: runtime.startPanel }, app: { globals } });
  const world = { game: f.game, controls: f.controls, scene: { entities: new Map([['banner', {}]]) }, movement: { nativeFocused: true, flush() {} }, connection: { state: 'connected', send: async (kind, payload) => sent.push({ kind, payload }) }, targetSequence: 0 };
  const guest = new GuestCampaign(world); world.campaign = guest; world.cancelLocalMenu = () => guest.cancel();
  return { ...f, world, guest, sent, sounds, drawn, buttons, choose: value => { choice = value; }, receive: (selected = true) => guest.receive({ type: 'target', sequence: 1, campaign: f.preview().campaign }, selected) };
}
test('guest uses the original campaign panel text, reward/flag/enemy artwork and local input without running host campaign logic', () => {
  const f = guestFixture(); f.receive(); const before = JSON.stringify(f.guest.menu);
  assert.deepEqual(f.sounds, [['aud_sting_prepare_battle', null, null]]); assert.equal(f.guest.update(), true);
  const row = f.drawn[0]; assert.equal(row.styles.topBackgroundArea, 'topBackgroundArea'); assert.equal(row.styles.closeButton, 'closeButton'); assert.equal(row.styles.upgradeButton, 'upgradeButton');
  assert.equal(row.args.titleText, 'CAMPAIGN_NAME_TUTORIAL_1'); assert.equal(row.args.maxPrimaryResourceRewardText, '0'); assert.equal(row.args.maxSecondaryResourceRewardText, '250'); assert.equal(row.args.maxXpRewardText, '50');
  assert.ok(row.args.flagGuiArchetype); assert.deepEqual(row.args.enemyArchetypeSpritePathList, ['gui/native-enemy.svg']);
  assert.equal(f.buttons[0].id, 'guest-campaign-bookend-confirm'); assert.equal(f.events.length, 0); assert.equal(f.sent.length, 0); assert.equal(JSON.stringify(f.guest.menu), before);
  f.choose('confirm'); f.guest.update(); assert.equal(f.guest.menu, null); assert.equal(f.sent.length, 1);
  assert.deepEqual(f.sent[0], { kind: 'action', payload: { type: 'campaignStart', sequence: 1, target: 'banner', campaign: 'campaign_tutorial_01' } });
  f.guest.update(); assert.equal(f.sent.length, 1); f.guest.receive({ type: 'campaignStart', sequence: 1 }); assert.equal(f.guest.pending, null); assert.equal(f.world.lastLifeQuery, -Infinity);
});
test('guest cancellation sends one close intent, while stale results, malformed metadata, resync and disconnect cannot reopen or send actions', () => {
  const f = guestFixture(); f.receive(false); assert.equal(f.guest.menu, undefined); assert.equal(f.sounds.length, 0);
  f.receive(); const before = JSON.stringify(f.guest.menu);
  assert.throws(() => f.guest.receive({ type: 'target', campaign: { ...f.guest.menu, enemies: Array(1) } }, true), /Invalid/); assert.equal(JSON.stringify(f.guest.menu), before);
  f.choose('close'); f.guest.update(); f.guest.cancel(); assert.equal(f.sent.length, 1); assert.equal(f.sent[0].payload.type, 'campaignClose');
  f.receive(); f.world.resyncing = true; f.guest.cancel(); assert.equal(f.sent.length, 1);
  f.world.resyncing = false; f.receive(); f.world.closed = true; f.guest.cancel(); assert.equal(f.sent.length, 1);
});
test('solo original preparation still uses the same confirm method and exit event without the guest callback', () => {
  const f = fixture(), runtime = ast.campaignRuntime({ create: () => ({ setPlayState: name => f.events.push(['phase', name]) }) }, {}, { doCampaignStartBookend: () => 'confirm' });
  const panel = runtime.create(f.game, f.game.globals); panel.warManager = f.owner; panel.setCampaignRegionName('N');
  f.game.getGameController = () => ({ update() {} }); f.game.getGameCamera = () => ({ update() {} });
  f.game.getIMGui = () => ({ doBackground() {} }); f.game.getGuiManager = () => ({ addDrawGui() {} }); f.game.globals.guiRenderer = { getv2RenderLocation: () => [0, 0] };
  f.game.setGameState = () => { panel.exitState(); f.events.push(['set-state']); }; f.game.exitPaused = () => f.events.push(['unpause']);
  panel.update();
  assert.deepEqual(f.events.map(row => row[0]), ['CampaignStarted', 'phase', 'unpause', 'CampaignPrepareScreenExited', 'set-state', 'metric', 'resource-metric']);
});
test('all 82 original campaign definitions produce finite original preview rewards, flags and battle counts', () => {
  let rendered;
  const panels = { getEnemyQuantityInfo: () => ({ enemySpritePathList: [], enemyDisplayNameList: [] }), doInfoPanel: (game, globals, styles, args) => { rendered = args; return ''; } };
  const runtime = ast.campaignRuntime({}, {}, panels), globals = { currentLanguage: new Proxy({}, { get: (_, key) => String(key) }) };
  assert.equal(Object.keys(runtime.archetypes).length, 82);
  for (const [name, definition] of Object.entries(runtime.archetypes)) {
    const war = { getCampaignArchetypeName: () => name, getNumberOfBattlesInCampaign: () => definition.battleList.length, getNextBattleArchetypeQuantities: () => ({}) };
    assert.equal(runtime.startPanel({}, globals, { getEC: () => war }, 'N'), '');
    assert.equal(typeof rendered.flagGuiArchetype, 'string', name); assert.ok(rendered.titleText.length > 0, name);
    assert.equal(rendered.maxPrimaryResourceRewardText, String(Math.round(definition.maxResourceBonusList[0])), name);
    assert.equal(rendered.maxSecondaryResourceRewardText, String(Math.round(definition.maxResourceBonusList[1])), name);
    assert.equal(rendered.maxXpRewardText, String(Math.round(definition.maxXpBonus)), name);
    assert.ok([rendered.maxPrimaryResourceRewardText, rendered.maxSecondaryResourceRewardText, rendered.maxXpRewardText].every(value => Number.isFinite(Number(value))), name);
    assert.ok(rendered.numberOfBattlesText.startsWith(definition.battleList.length + ' '), name);
  }
});

function preparationFixture() {
  const f = fixture();
  f.state.phase = 'PlayStatePrepareForBattle'; f.state.skip = true;
  let phase = { playStateName: f.state.phase };
  const playing = { name: 'GamestatePlaying', setPlayState: name => { f.events.push(['phase', name]); f.state.phase = name; phase = { playStateName: name }; } };
  f.game.getActiveGameState = () => ({ ...playing, name: f.state.screen }); f.game.getPlayState = () => phase; f.game.getPlayFlags = () => ({ displaySkipPrepareButton: f.state.skip });
  f.game.getGameEntityByName = id => id === 'guest' ? f.hero : f.source;
  const original = f.hero.getEC;
  f.hero.getEC = name => name === 'ECPlayerData' ? { getResource: () => 1, getResourceCap: () => 500, getSoftCurrency: () => 0, getXP: () => 0, getUpgradePoints: () => 0 } : name === 'ECPlayerLife' ? { state: f.state.dead ? 1 : 0, states: { NORMAL: 0, DYING: 1 }, respawnTime: undefined, deathTime: 0, globals: { gameCurrentTime: 0 }, getDeathAnimationDuration: () => 1 } : original(name);
  const view = () => f.actions.preparationView(f.game);
  const skip = (episode, target = 'guest') => f.actions.execute(f.game, f.hero, {}, target, f.controls, 'skipPrepare', { episode });
  return { ...f, view, skip, next: () => { phase = { playStateName: 'PlayStatePrepareForBattle' }; f.state.phase = phase.playStateName; } };
}
test('preparation commands require the assigned live actor and its exact issued host phase; duplicate or competing skips never start twice', () => {
  const f = preparationFixture(), other = new HostActions();
  assert.equal(typeof f.skip(1), 'string', 'No issued phase cannot be skipped');
  assert.equal(typeof f.skip(undefined), 'string', 'An omitted ID cannot match an unissued phase');
  const view = f.view(); assert.deepEqual(f.view(), view);
  const otherView = other.preparationView(f.game);
  assert.equal(typeof f.skip(view.episode, 'banner'), 'string');
  assert.equal(f.skip(view.episode).save, true); assert.deepEqual(f.events, [['phase', 'PlayStateBattle']]);
  assert.equal(typeof f.skip(view.episode), 'string');
  assert.equal(typeof other.execute(f.game, f.hero, {}, 'guest', f.controls, 'skipPrepare', otherView), 'string'); assert.equal(f.events.length, 1);
  f.next(); const next = f.view(); assert.notEqual(next.episode, view.episode); assert.equal(typeof f.skip(view.episode), 'string'); assert.equal(f.events.length, 1);
  assert.equal(f.skip(next.episode).save, true); assert.equal(f.events.length, 2);
});
test('phase replacement, hidden controls, host menus, script locks, death and disconnect invalidate stale preparation choices', () => {
  for (const [key, value] of [['skip', false], ['screen', 'GamestatePaused'], ['script', true], ['dead', true], ['health', 0]]) {
    const f = preparationFixture(), view = f.view(); f.state[key] = value;
    assert.equal(typeof f.skip(view.episode), 'string', key); assert.equal(f.events.length, 0, key);
  }
  const f = preparationFixture(), old = f.view(); f.next(); assert.equal(typeof f.skip(old.episode), 'string'); assert.equal(f.events.length, 0);
  const current = f.view(); f.actions.stop(f.hero); assert.equal(typeof f.skip(current.episode), 'string'); assert.ok(f.view().episode > current.episode);
  for (const episode of [undefined, null, 0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, '1']) assert.throws(() => new HostActions().receive({ type: 'skipPrepare', sequence: 1, target: 'guest', episode }), /Invalid/);
  const actions = new HostActions(); actions.receive({ type: 'skipPrepare', sequence: 1, target: 'guest', episode: 1 }); assert.throws(() => actions.receive({ type: 'skipPrepare', sequence: 1, target: 'guest', episode: 1 }), /repeated/);
});
test('guest preparation button matches original artwork, location and sizing and sends only one phase-bound intent', t => {
  let now = 1000; t.mock.method(performance, 'now', () => now);
  const f = guestFixture(), world = f.world, buttons = []; let clicked = true;
  world.hud = { state: { preparation: { episode: 7 } }, receivedAt: 1000 }; world.identity = { entity: 'guest' }; world.lifeState = { phase: 'normal' }; world.localMenu = () => false;
  world.controls.guiTypes = { BUTTON_IN_GAME: { width: 60, height: 60 } };
  world.game.getIMGui = () => ({ doButton: options => { buttons.push(options); return clicked; } });
  const original = ast.preparationButton(world.controls.app.globals.guiRenderer, world.controls.guiTypes);
  f.guest.drawPreparation(); const rendered = buttons[0];
  assert.equal(rendered.guiArchetype, original.guiArchetype); assert.equal(rendered.buttonType, original.buttonType); assert.deepEqual(rendered.v2ScreenLocation, Array.from(original.v2ScreenLocation)); assert.equal(rendered.id, 'guest-skip-prepare');
  assert.deepEqual(f.sent, [{ kind: 'action', payload: { type: 'skipPrepare', sequence: 1, target: 'guest', episode: 7 } }]);
  f.guest.drawPreparation(); assert.equal(f.sent.length, 1); assert.equal(buttons.length, 1);
  f.guest.receive({ type: 'skipPrepare', sequence: 99 }); assert.equal(f.guest.prepareRequest, 1);
  f.guest.receive({ type: 'skipPrepare', sequence: 1 }); assert.equal(f.guest.prepareRequest, null); assert.equal(world.lastLifeQuery, -Infinity);
  clicked = false; buttons.length = 0; now = 3001; f.guest.drawPreparation(); assert.equal(buttons.length, 0);
  now = 1000;
  for (const change of [() => { world.resyncing = true; }, () => { world.controls.paused = true; }, () => { world.movement.nativeFocused = false; }, () => { world.lifeState.phase = 'waiting'; }, () => { world.localMenu = () => true; }, () => { world.connection.closed = true; }, () => { world.connection.state = 'closed'; }, () => { world.closed = true; }]) {
    world.resyncing = world.controls.paused = false; world.movement.nativeFocused = true; world.lifeState.phase = 'normal'; world.localMenu = () => false; world.connection.closed = world.closed = false; world.connection.state = 'connected';
    change(); f.guest.drawPreparation(); assert.equal(buttons.length, 0);
  }
});

test('own-hero life queries issue preparation metadata only when controls and actor are available', () => {
  const f = preparationFixture(), life = () => f.actions.execute(f.game, f.hero, {}, 'guest', f.controls, 'life');
  const view = life(); assert.equal(view.life.phase, 'normal'); assert.deepEqual(view.hud.preparation, { episode: 1 });
  assert.equal(f.skip(view.hud.preparation.episode).save, true); assert.equal(life().hud.preparation, null);
  f.next(); const next = life(); assert.ok(next.hud.preparation.episode > view.hud.preparation.episode);
  for (const [key, value] of [['skip', false], ['screen', 'GamestatePaused'], ['script', true], ['dead', true], ['health', 0]]) {
    const old = f.state[key]; f.state[key] = value; assert.equal(life().hud.preparation, null, key); f.state[key] = old;
  }
});
