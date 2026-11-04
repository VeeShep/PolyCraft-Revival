'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const ast = require('./runtime-ast.cjs');
const { HostCampaignResults, GuestCampaign, validateCampaignResult } = require('../desktop/campaign.js');
const { HostActions } = require('../desktop/coop-actions.js');
const { GuestHud } = require('../desktop/hud.js');
function fixture() {
  const runtime = ast.campaignRuntime({}, {}, {}), events = [];
  const globals = { gameManager: { eventManager: { subscribe: (...args) => events.push(['subscribe', ...args]), unsubscribe: (...args) => events.push(['unsubscribe', ...args]) } } };
  let manager = ast.campaignScore(globals);
  manager.getHQHealthFactor = () => 1;
  const controls = { campaignMethods: runtime, infoPanels: { starGuiArchetypeMap: ast.assignedObject('starGuiArchetypeMap') } };
  const game = { getScoreInfo: () => manager }, results = new HostCampaignResults(game, controls);
  function begin(name = 'campaign_tutorial_01') {
    const definition = runtime.archetypes[name];
    manager.onCampaignStarted({ maxResourceBonusList: definition.maxResourceBonusList, maxXpBonus: definition.maxXpBonus, starCriteriaList: definition.starCriteriaList });
    Object.assign(manager.campaignStats, { numberOfEnemiesKilled: 100000, numberOfEnemiesKilledByHero: 100000 });
  }
  function end(victory = true) { manager.campaignStats.numberOfHQsDestroyed = victory ? 0 : 1; manager.onCampaignEnded(); results.update(); return results.latest; }
  return { game, controls, results, events, begin, end, manager: () => manager, replace: () => { manager = ast.campaignScore(globals); manager.getHQHealthFactor = () => 1; } };
}
test('native completed scoring is captured after calculation and retained after quick host dismissal, without replaying pre-host history', () => {
  const f = fixture(); f.begin(); f.results.update(); assert.equal(f.results.latest, null);
  const score = f.end(), before = JSON.stringify(score);
  assert.equal(score.id, 1); assert.equal(score.campaign, 'campaign_tutorial_01'); assert.equal(score.score.wasVictory, true); assert.equal(score.score.xpBonus, 50);
  assert.equal(score.score.grade, score.score.starStatusList.length); assert.equal(f.manager().campaignActive, false);
  f.game.getActiveGameState = () => assert.fail('Capture must not depend on the host keeping the result screen open');
  f.results.update(); assert.equal(f.results.sequence, 1); assert.equal(JSON.stringify(f.results.latest), before);
  f.manager().campaignResourceBonusList[1] = 999; f.manager().campaignStarStatusList[0].displayText = 'Changed'; assert.equal(JSON.stringify(f.results.latest), before);
  const joinedLater = new HostCampaignResults(f.game, f.controls); joinedLater.update(); assert.equal(joinedLater.latest, null);
  f.begin(); f.end(false); assert.equal(f.results.sequence, 2); assert.equal(f.results.latest.score.wasVictory, false); assert.deepEqual(f.results.latest.score.resourceBonusList, [0, 0]); assert.equal(f.results.latest.score.xpBonus, 0);
  f.replace(); f.results.update(); assert.equal(f.results.latest, null); assert.equal(f.results.sequence, 2);
  f.begin(); f.end(); assert.equal(f.results.latest.id, 3); f.results.close(); assert.equal(f.results.latest, null); f.begin(); f.end(); assert.equal(f.results.latest, null);
});
test('all 82 native score definitions associate by criteria identity and produce valid victory and defeat result panels', () => {
  const f = fixture(), definitions = Object.entries(f.controls.campaignMethods.archetypes);
  assert.equal(new Set(definitions.map(([, definition]) => definition.starCriteriaList)).size, 82);
  let rendered;
  const panels = { doInfoPanel: (game, globals, styles, args) => { rendered = { styles, args }; return ''; } };
  const runtime = ast.campaignRuntime({}, {}, panels), globals = { currentLanguage: new Proxy({}, { get: (_, key) => String(key) }) };
  for (const [name] of definitions) for (const victory of [true, false]) {
    f.begin(name); const result = f.end(victory); assert.equal(result.campaign, name);
    assert.equal(validateCampaignResult(result, f.controls), result);
    assert.equal(runtime.endPanel({}, globals, runtime.archetypes[name], result.score), '');
    assert.equal(rendered.styles.topBackgroundArea, 'topBackgroundAreaCampaignEnd'); assert.equal(typeof rendered.args.flagGuiArchetype, 'string');
    assert.equal(rendered.args.maxGradePossible, result.score.starStatusList.length); assert.equal(rendered.args.grade, result.score.grade);
    assert.equal(rendered.args.buttonText, 'INFO_PANEL_END_CAMPAIGN_BUTTON');
    assert.equal(rendered.styles.contentList.includes('rewardBars'), victory);
  }
});
test('result validation bounds identity, rewards, grade and exact native star roles before changing guest state', () => {
  const f = fixture(); f.begin(); const result = f.end();
  for (const change of [value => { value.id = 0; }, value => { value.id = Infinity; }, value => { value.campaign = '__proto__'; }, value => { value.campaign = []; }, value => { value.score = {}; }, value => { value.score.resourceBonusList = Array(2); }, value => { value.score.resourceBonusList = [-1, 0]; }, value => { value.score.xpBonus = NaN; }, value => { value.score.grade = 999; }, value => { value.score.starStatusList = Array(3); }, value => { value.score.starStatusList[0].starName = 'arbitrary'; }, value => { value.score.starStatusList[0].displayText = 'x'.repeat(257); }, value => { value.score.starStatusList[0].value = {}; }, value => { value.score.starStatusList[0].achieved = 1; }, value => { value.score.starStatusList[0].image = 'arbitrary'; }, value => { value.score.wasVictory = false; }]) {
    const value = structuredClone(result); change(value); assert.throws(() => validateCampaignResult(value, f.controls), /Invalid campaign/);
  }
  const guest = new GuestCampaign({ controls: f.controls });
  assert.throws(() => guest.receiveResult({ ...result, score: {} }), /Invalid/); assert.equal(guest.pendingResult, undefined);
  guest.receiveResult(result); result.score.xpBonus = 999; assert.equal(guest.pendingResult.score.xpBonus, 50);
});
test('invalid native result is logged once without interrupting host gameplay or emitting malformed UI data', t => {
  const f = fixture(), logged = []; t.mock.method(console, 'error', (...args) => logged.push(args));
  f.begin(); f.manager().onCampaignEnded(); f.manager().campaignXpBonus = NaN;
  f.results.update(); f.results.update(); assert.equal(logged.length, 1); assert.match(logged[0][0], /could not be displayed/); assert.equal(f.results.latest, null); assert.equal(f.results.sequence, 0);
});
function guestFixture() {
  const f = fixture(); f.begin(); const result = f.end(), drawn = [], buttons = [], sent = []; let choice = '';
  const panels = { doInfoPanel: (game, globals, styles, args) => { drawn.push({ styles, args }); game.getIMGui().doButton({ id: 'result-close' }); return choice; } };
  const runtime = ast.campaignRuntime({}, {}, panels);
  f.controls.infoPanels.doCampaignEndBookend = runtime.endPanel;
  f.controls.app = { globals: { currentLanguage: new Proxy({}, { get: (_, key) => String(key) }), guiRenderer: { getv2RenderLocation: (x, y) => [x, y] } } };
  const world = { controls: f.controls, scene: { entities: new Map() }, movement: { nativeFocused: true, flush() {} }, connection: { state: 'connected', send: async (...args) => sent.push(args) }, game: { getIMGui: () => ({ doBackground() {}, doButton: args => buttons.push(args) }), getGuiManager: () => ({ addDrawGui() {} }) } };
  const guest = new GuestCampaign(world); world.campaign = guest; world.cancelLocalMenu = () => guest.cancel();
  return { ...f, world, guest, result, drawn, buttons, sent, choose: value => { choice = value; } };
}
test('guest native result panel dismisses locally once, preserves a newer pending result and never awards or sends a claim', () => {
  const f = guestFixture(); f.guest.receiveResult(f.result); assert.equal(f.guest.update(), true);
  assert.equal(f.drawn[0].args.xpRewardText, '50'); assert.equal(f.buttons[0].id, 'guest-campaign-result-close');
  const newer = { ...structuredClone(f.result), id: 2 }; f.guest.receiveResult(newer); assert.equal(f.guest.result.id, 1); assert.equal(f.guest.pendingResult.id, 2);
  f.choose('confirm'); f.guest.update(); assert.equal(f.guest.result, null); assert.equal(f.guest.dismissedResult, 1);
  f.choose(''); f.guest.update(); assert.equal(f.guest.result.id, 2); f.choose('close'); f.guest.update(); assert.equal(f.guest.dismissedResult, 2);
  f.guest.receiveResult(newer); f.guest.receiveResult(f.result); assert.equal(f.guest.update(), false); assert.equal(f.sent.length, 0);
  assert.equal(f.manager().campaignXpBonus, 50); assert.equal(f.results.sequence, 1);
});
test('results wait behind menus and held placement, survive focus/resync pauses and clear on disconnect or score-scope reset', () => {
  for (const [field, value] of [['pauseMenu', true], ['selectedBuilding', {}], ['demolition', {}], ['construction', { placement: {} }], ['totem', { menu: {} }], ['quests', { description: {} }]]) {
    const f = guestFixture(); f.world[field] = value; f.guest.receiveResult(f.result); assert.equal(f.guest.update(), false); assert.equal(f.guest.pendingResult.id, 1);
  }
  const f = guestFixture(); f.guest.receiveResult(f.result); f.guest.update();
  f.world.movement.nativeFocused = false; assert.equal(f.guest.update(), false); assert.equal(f.guest.result.id, 1);
  f.world.movement.nativeFocused = true; f.world.resyncing = true; assert.equal(f.guest.update(), false); f.world.resyncing = false; assert.equal(f.guest.update(), true);
  f.guest.receiveResult(null); assert.equal(f.guest.update(), false); f.guest.receiveResult(f.result); f.guest.close(); assert.equal(f.guest.result, null); assert.equal(f.guest.pendingResult, null); assert.equal(f.sent.length, 0);
});

test('host life/HUD results respect the admission baseline and expected query without duplicating native rewards', () => {
  const f = guestFixture(), actions = new HostActions();
  const data = { getResource: () => 10, getResourceCap: () => 500, getSoftCurrency: () => 0, getXP: () => 0, getUpgradePoints: () => 0 };
  const life = { state: 0, states: { NORMAL: 0, DYING: 1 } }, hero = { shouldBeDestroyed: () => false, getEC: name => ({ ECPlayerData: data, ECPlayerLife: life })[name] };
  const game = { desktopCampaignResults: f.results, getGameEntityByName: () => hero, getPlayFlags: () => ({}) };
  const query = () => actions.execute(game, hero, {}, 'self', f.controls, 'life');
  const result = query(); assert.equal(result.hud.campaignResult.id, 1);
  actions.resultFloor = 1; assert.equal(query().hud.campaignResult, null, 'New admission cannot replay pre-join results');
  f.begin(); f.end(); assert.equal(query().hud.campaignResult.id, 2);
  f.world.controls.xpTable = [0, 1]; f.world.controls.playerDataMethods = {}; f.world.controls.app.globals.appCurrentTime = 1;
  const hud = new GuestHud(f.world);
  const invalid = query(); invalid.hud.campaignResult = { ...invalid.hud.campaignResult, score: {} };
  assert.throws(() => hud.receive({ ...invalid, type: 'life', sequence: 1 }, 1), /Invalid/); assert.equal(hud.state, undefined); assert.equal(f.guest.pendingResult, undefined);
  hud.receive({ ...query(), type: 'life', sequence: 1 }, 2); assert.equal(f.guest.pendingResult, undefined);
  hud.receive({ ...query(), type: 'life', sequence: 1 }, 1); assert.equal(f.guest.pendingResult.id, 2);
  f.guest.update(); f.choose('confirm'); f.guest.update(); assert.equal(f.sent.length, 0);
  const awarded = [];
  ast.campaignRewards().call({ gameManager: { getHero: () => ({ getEC: () => ({ adjustXP: value => awarded.push(['xp', value]), adjustResource: (...args) => awarded.push(['resource', ...args]) }) }) } }, f.result.score.xpBonus, f.result.score.resourceBonusList);
  assert.deepEqual(awarded, [['xp', 50], ['resource', 0, 0, true], ['resource', 1, 250, true]]);
  f.guest.receiveResult(f.result); f.guest.update(); assert.equal(awarded.length, 3, 'Repeated guest display/dismiss cannot call native reward collection');
});
