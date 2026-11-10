# PolyCraft test reference

This is the test map and runbook, not a blanket claim that every platform or scenario passes. Read the current section of [RESTORATION_STATUS.md](RESTORATION_STATUS.md) before continuing work; it owns the dated success/failure ledger, exact source/package identities, evidence paths and open acceptance gates. [README.md](README.md#checks) describes player-facing setup and the main acceptance commands. [AGENTS.md](AGENTS.md) defines repository safety and publication rules.

Inventory/checkpoint date: **2026-11-10**, latest application work **1.0.0-beta.101** (664source checks and scoped native XP/worker/save case pass; broader gates remain open). There are **73 `tests/*.test.cjs` suite files**. A suite file can contain several tests or parameterized cases; 73 is not the test-result count.

## Current evidence and its limits

| Checkpoint | Recorded result | What it does and does not establish |
| --- | --- | --- |
| Published Beta99 source `a29f794118278e11531b736d06e84516fa597c9e` | [CI run42515816607](https://github.com/VeeShep/PolyCraft-Revival/actions/runs/42515816607) **all8jobs pass /630checks /eight artifacts132.1** | Native package static checks and Linux stub-world transport pass. Artifacts not independently downloaded/launched; local finished-package gameplay is separate. No public release. |
| Beta101 simulation-boundary refresh | **Red0/2;3initial /62focused /664full pass; native74337 exit0** | Original XP-only batch retains its collector until both grants finish. Actual wrapper scopes/clears simulation and restores solo hooks. Finished local ARM64: staged230→600→620 XP, actor alive in both grants/replaced afterward, assigned guest HUD/disk; two/four-player workers/menus/fresh1wood+1stone/all HUDs/host reload/guest solo isolation. All12helper/8source hashes match; owned apps closed. No normal-acquisition or generic interruption claim. |
| Published incoming harness `24dab6961f5ff1dd8dca15f13ee29f2f6ca49d6d` | [CI run42764661498](https://github.com/VeeShep/PolyCraft-Revival/actions/runs/42764661498) **all8jobs /661checks /eight artifacts134.1** | All decoded logs inspected; static packages and Linux stub-world direct/relay/renewal pass. Artifacts not independently downloaded/launched; prior native34098 is separate. No public release. |
| Beta100 incoming acceptance | **Native34098 exit0; final full661/0;37focused/0** | Actual5wood incoming at close4339/capture4340 settles once and restores natively at4355. Two ordinary10wood deposits, two/four-player workers, fresh2wood+2stone/all HUDs, non-pausing menus, host save/reload and guest solo isolation pass. All11helper/8source hashes match; owned apps closed. First-restore guard and cleanup regression pass in final local full8020 (661checks/zero failures). Native evidence uses its exact earlier pinned helpers. |
| Published Beta100 source `8c66f751ee9a2e9d34a512e46c26bb4d4f92dcbf` | [CI run42763109500](https://github.com/VeeShep/PolyCraft-Revival/actions/runs/42763109500) **all8jobs /640checks /eight artifacts133.1** | Static native packages and Linux stub-world transport pass. All decoded logs inspected. Artifacts not independently downloaded/launched; local finished-app gameplay remains separate. No public release. |
| Beta100 incoming production checks | **28 focused /639 full local /640 CI pass**, initial red0/3 | Native pickup/tween/action-manager/capture phases, original variants/owners/caps/order, partial-failure refusal and pending-resource level-up deferral. Generic XP/coin/item/health interruptions remain open. |
| Beta99 resource-ready selection | **115 focused production /23 route-harness /630 full checks pass** | Native growth/strict full-delta flag/runtime compatibility and all five actual original mesh definitions pass. First full628/1 loopback failure is retained; isolated9/0, full629/0 and final630/0 pass. Cause remains unproven. Native30847exit0 covers actual rock04 ring/depletion, normal stone deposit and full two/four-player worker/menu/income/save/reload/solo-restoration follow-through. Native35389remains an overall worker-route failure despite its ring/deposit subsection passing. |
| Last completed Beta97 local source/harness | **623 checks / zero failures**, including **23 focused flight-observer/diagnostic/reward-order checks** | Non-graphical local regression evidence; no new CI or native-platform claim follows from this number. |
| Beta98 disconnect classification | **39 focused /624 full checks pass**; local ARM64 build/source/icons/14MachO/signature pass | Only a closed data channel with native `sctp-failure` and numeric cause 12 uses the existing remote-disconnect path. Other errors retain failure behavior. Source checks alone do not establish gameplay; see the separate69014finished-package row. |
| Local approach diagnostics | **5 focused /626 full checks pass**, including the prior624 | Bounded movement/focus/screen samples and pre-cleanup failure capture; original assertions preserved on observation errors. Visible retry69014 passes with the625-check diagnostic helper. Two later real-focus restoration guards are unit checked; their actual native branch awaits the next visible case. |
| Published native/harness source `3659fbfa06ae896f09a030f9f87897173c2c805e` | [CI run42513164819](https://github.com/VeeShep/PolyCraft-Revival/actions/runs/42513164819) **all8jobs pass /626checks /eight artifacts131.1** | Six native package static checks and Linux stub-world native transport pass. Artifacts not independently downloaded/launched; local finished-package gameplay is separate. Application is Beta98. |
| Published Beta98 source `f019ed2461dc991c4110690e3af0282f638dfb63` | [CI run42512214489](https://github.com/VeeShep/PolyCraft-Revival/actions/runs/42512214489) **all8jobs pass /624checks /eight artifacts130.1** | Six native package static checks and Linux stub-world native transport pass. Artifacts not independently downloaded/launched; local finished-package gameplay is separate. |
| Published timed-save source `cbca6f49c421b2aa1a7d9a39388d00da245f4191` | [CI run 42509810346](https://github.com/VeeShep/PolyCraft-Revival/actions/runs/42509810346): **613 unit checks**, all eight jobs successful, tester artifacts **129.1** | Six native package targets plus the separate Linux network-only job; those CI artifacts were not independently downloaded/launched at this checkpoint. These CI results belong to earlier source; current local results are recorded separately. |
| Finished local ARM64 worker regression, session **19022** | **exit 0** | Ordinary two/four-player worker acknowledgements, pause/HUD behavior, fresh income, all guest HUDs, solo isolation and normal host close/reopen; not a timed in-flight interruption. |
| Finished local ARM64 Save Now case, session **26083** | **exit 0** | A first completed 10-wood payment, then a later 15-wood flight on the same carrier; actual Save Now clicked with active flights, coherent capture clears them, bank **16→31** without repaying the first delivery. Four-player worker/save/isolation follow-through and normal host close/reopen pass. |
| Finished local ARM64 Beta98 close/rejoin, session **69014** | **exit0** | Natural first15wood6→21, same carrier later10wood21→31 once; actual close5887/capture5889 clears2/2→0/0; assigned saved hero rejoins. Two/four-player worker/pause/AI/HUD, fresh shared156/68→158/70 income, all guest solo restoration and normal host save/reopen pass. All8source/10helper hashes match; owned apps closed. Intentional outbound close only; other interruption/WAN/platform gates remain. |
| Finished local ARM64 intentional close/rejoin case, session **65750** | **exit 1 overall** | Core outbound-flight close/rejoin passed: frame **5501→5502**, flight counts/entries **2/2→0/0**, bank **16→26** once, saved hero inventory/health restored. Later workers **151/68→153/70**, all HUDs, coherent save and guest solo restoration passed. Final zero-host-connection-error assertion at `coop-worker-acknowledgement.cjs:211` failed with a generic channel error. **Normal host close/reopen was not reached. The separate diagnostic below identifies a native close signal that explains this error class; do not reclassify this historical failed run as a pass.** All eight source fixture files and ten pinned helpers remained unchanged; owned apps closed. |

The separate short, visible, no-island native PeerLink diagnostic **87542 exit 0** reproduced a host error in two of three intentional-close cycles: `User-Initiated Abort`, reason `Close called`, `sctp-failure`, cause **12**, channel already closed. The third cycle closed normally. Diagnostic 10840 failed during initial setup before measurement; both attempts remain retained. This evidence motivates the narrow Beta98 classification, not ignoring all channel errors. Fixed network-only rerun21038 passes three close cycles without link errors. Local package verification52678 passes. Full-game Beta98 retest91749 exits1 at the first resource-framing guard (`coop-natural-resources.cjs:52`), before any deposit/disconnect. The screenshot was captured after guest solo restoration, so it does not establish the earlier framing/focus cause. All8source/10helper hashes match and owned apps are closed. No guard was relaxed; that failed run provides no full-game acceptance. The separate69014retry passes its recorded scope.

For exact logs, hashes and earlier failed attempts, use the [current ledger](RESTORATION_STATUS.md#current-source-beta-98-peer-close-handling-and-test-reference--2026-11-08) and its historical Beta97 section. Earlier success does not erase a later failure, and a passing subsection does not make a failed run successful.

## Safety and evidence rules

1. **Announce every game test before launching.** Use visible, clearly labelled temporary-island windows. Do not hide game tests or run duplicates while a case is live.
2. Every game process must receive disposable **`POLYCRAFT_TEST_DATA`**. Most standalone drivers allocate it themselves and print its location. Never substitute a personal island/profile. Fixture-driven drivers validate an existing temporary checkpoint and copy its saves before use.
3. Preserve personal saves, immutable `dist/beta-1` and its checksums, reference baselines, source fixtures and previous release artifacts. Git history is not an exported island backup.
4. **Pin executed inputs before a long run:** exact app/source identity, fixture hashes, driver and recursively used helper bytes, command, environment *names* and permitted non-secret values. Do not edit those helpers until the run is terminal. Record fresh pins for a later retry.
5. Retain successes **and failures**: exit code, phase reached, error, logs/screenshots, source/helper hashes before/after, output saves, process cleanup and acceptance limits. Keep bulky evidence under ignored `test-results/`; link it from `RESTORATION_STATUS.md`. Do not commit saves, logs, credentials, dependencies or build output.
6. Temporary setup and observation are different from natural play. Label direct fixture grants, positions, task completion, equipment and simulated time. A native-method fixture proves that method's contract, not acquisition/unlock, visible behavior or hardware acceptance.
7. Cleanup only owned test apps/processes/services. On failure, preserve the original error even if diagnostics/cleanup also fail. Confirm no owned windows/processes remain and source fixture bytes match.
8. Before publishing a completed milestone, review intended changes, run appropriate checks, update the status ledger and compare branch/remote head. Follow `AGENTS.md`; never rewrite published history or push to upstream.

## Fast local checks

Run from the repository root with locked dependencies installed. These commands do not launch the game:

```sh
npm test
node --test tests/in-flight-save.test.cjs tests/in-flight-disconnect.test.cjs tests/natural-deposit-diagnostics.test.cjs tests/resource-reward-order.test.cjs
node --test tests/multiplayer.test.cjs tests/in-flight-save.test.cjs tests/in-flight-disconnect.test.cjs tests/natural-deposit-diagnostics.test.cjs tests/resource-reward-order.test.cjs
node --test tests/resource-pickup.test.cjs tests/resource-flight.test.cjs tests/coop-players.test.cjs
node --test tests/incoming-disconnect.test.cjs tests/in-flight-disconnect.test.cjs tests/natural-deposit-diagnostics.test.cjs tests/resource-reward-order.test.cjs
node --test tests/world-state.test.cjs tests/guest-world.test.cjs tests/online-world.test.cjs tests/multiplayer.test.cjs
node --test tests/natural-deposit-diagnostics.test.cjs tests/resource-reward-order.test.cjs tests/ground-click.test.cjs
```

`npm test` expands to `node --test tests/*.test.cjs`. The second command groups flight-observer, diagnostic and reward-order checks. Adding the transport suite also checks native disconnect classification. The carrier/player command targets production carrier completion/capture plus player preservation; use the current output rather than assuming a historical count. Some local suites open bounded loopback sockets or create disposable files; “non-graphical” does not mean every test is a pure mock.

There is no catch-all acceptance flag: choose a driver below for the behavior actually being changed. Run the relevant source checks first, then announce the visible case. Do not repeatedly rerun unrelated suites after successful checks unless new changes or failures justify it.

## Non-graphical suite inventory — all 73 files

All paths in this section are under `tests/`. Descriptions summarize assertions in the source, not claims of full-game coverage.

### Save protection, local controls and diagnostics (11)

| Suite | Checks |
| --- | --- |
| [saves.test.cjs](tests/saves.test.cjs) | Slot isolation, export/import, atomic-write/recovery failures, malformed/future input rejection, exact migration backups and sticky cheat history. |
| [coop-saves.test.cjs](tests/coop-saves.test.cjs) | Co-op envelope migrations, frozen-reader refusal, exact preserved bytes, recovery/import/export and future-format protection. |
| [coop-data.test.cjs](tests/coop-data.test.cjs) | Four distinct saved identities, shared economy versus individual progression, schema validation/migration and held-building records. |
| [bridge.test.cjs](tests/bridge.test.cjs) | Engine bridge/store responses, separate solo/shared ownership, claim/consumption replay guards and cheat-policy boundaries. |
| [controls.test.cjs](tests/controls.test.cjs) | Capacity/currency/progression edits, native totem limits, demolition protection/dialogs, secret-code focus, pause/fullscreen behavior. |
| [desktop-regressions.test.cjs](tests/desktop-regressions.test.cjs) | Desktop fullscreen/events, original shop behavior, mouse/touch handling, camera-relative WASD and targeted engine regressions. |
| [logging.test.cjs](tests/logging.test.cjs) | Append/rotation and nonfatal logging failures. |
| [graphics.test.cjs](tests/graphics.test.cjs) | Shader precision promotion, framebuffer diagnostic restoration and cancellable/deduplicated input listeners. |
| [host-checkpoint.test.cjs](tests/host-checkpoint.test.cjs) | Fresh checkpoint requests wait for older writes and capture again rather than acknowledge stale data. |
| [achievements.test.cjs](tests/achievements.test.cjs) | Original partial/awarded badge restoration without awarding twice. |
| [script-proximity.test.cjs](tests/script-proximity.test.cjs) | Native scripted proximity includes eligible guests, excludes unavailable heroes, preserves strict 3-D distance and solo behavior. |

### Networking, admission and session ownership (11)

| Suite | Checks |
| --- | --- |
| [multiplayer.test.cjs](tests/multiplayer.test.cjs) | Invitation/framing validation, bounded Unicode snapshot assembly/order, guest authority restrictions, peer capacity, ICE grace and full-resync requests. |
| [direct-network.test.cjs](tests/direct-network.test.cjs) | Real encrypted loopback framing, certificate/token validation, invitation limits/expiry and opt-in UPnP lifecycle. |
| [stun.test.cjs](tests/stun.test.cjs) | RFC vector/parser validation, correlated loopback UDP discovery, bounded cancellation/timeouts and no UDP-port reuse as TCP port. |
| [rooms.test.cjs](tests/rooms.test.cjs) | Room/password approval/isolation, real local signaling, bounded routing, safe endpoint/TLS handling and controlled TURN issuance. |
| [auto-rooms.test.cjs](tests/auto-rooms.test.cjs) | Direct-first route ordering/fallback, cancellation, stale-attempt fencing, redacted setup history and service-issued renewal coordination. |
| [ice-renewal.test.cjs](tests/ice-renewal.test.cjs) | Same-transport ICE restart, fresh-generation evidence, certificate/media invariants, timeout and cancellation cleanup. |
| [relay-renewal-client.test.cjs](tests/relay-renewal-client.test.cjs) | Client credential-renewal state, bounded transactions, expiry/failure/cancellation and existing-channel preservation. |
| [relay-renewal-server.test.cjs](tests/relay-renewal-server.test.cjs) | Server renewal ownership, lifetime/rate/replay bounds and credential issuance rules. |
| [coturn-observer.test.cjs](tests/coturn-observer.test.cjs) | Retirement evidence requires final TURN-session teardown and parses split log chunks. |
| [session-panel.test.cjs](tests/session-panel.test.cjs) | UI session lifecycle/cancellation, saved hero assignment, service-free direct setup, failed-init cleanup and redacted reports. |
| [online-world.test.cjs](tests/online-world.test.cjs) | Coherent tick-boundary captures, action-save acknowledgements/failures, guest slot ownership, menu-independent simulation and orderly final saves; original simulation-scope/return/error/teardown contract. |

### Assigned heroes, actions, construction and progression (18)

| Suite | Checks |
| --- | --- |
| [coop-players.test.cjs](tests/coop-players.test.cjs) | Real native player capture/restore, weapon reconciliation, held inventory/claims, solo preservation, PvP policy and safe replacement/exit. |
| [coop-input.test.cjs](tests/coop-input.test.cjs) | Assigned-hero movement, sequence/rate/authority guards, native paths/collision, drag/held timing, neutral/focus/menu cancellation. |
| [coop-actions.test.cjs](tests/coop-actions.test.cjs) | Host-checked gathering/combat/build/demolition/worker intents, actor/range/quote validation, phase ordering, replay/rate rejection and guest picking. |
| [coop-hero-events.test.cjs](tests/coop-hero-events.test.cjs) | Hero-attributed progression/statistics/events, projectile/PvP protection, native creation/preload and local versus shared callbacks. |
| [coop-life.test.cjs](tests/coop-life.test.cjs) | Saved death/wait phases and timing, legacy migration preservation and unavailable-actor action blocking. |
| [coop-respawn.test.cjs](tests/coop-respawn.test.cjs) | Per-hero death/respawn, environmental damage, absent attackers and once-only scheduled restoration. |
| [coop-update-areas.test.cjs](tests/coop-update-areas.test.cjs) | Every active hero's update area, once-only entity updates, destroyed/foreign exclusions and unchanged solo fallback. |
| [coop-construction.test.cjs](tests/coop-construction.test.cjs) | Original dry-run menus/previews, payment/refunds, in-flight shared capacity, source ownership and save barriers. |
| [coop-building-upgrade.test.cjs](tests/coop-building-upgrade.test.cjs) | Native upgrade payment/progress/cancellation, exact quotes/prerequisites, once-only competing requests and source claims. |
| [coop-move.test.cjs](tests/coop-move.test.cjs) | Native building pickup/move references, active/offline claims, territory/movement restrictions and non-resurrection cleanup. |
| [coop-repair.test.cjs](tests/coop-repair.test.cjs) | Original costs/healing/broken-building restoration, changed quotes, shared-budget races and move/source restrictions. |
| [held-construction.test.cjs](tests/held-construction.test.cjs) | Restored prepaid/infinite/moved held objects, original cancellation/refunds, protected objects and per-segment capacity. |
| [totems.test.cjs](tests/totems.test.cjs) | Original point/Amber upgrades and replacement heroes, prerequisite/max locks, shared-budget/quote validation and native artwork. |
| [crafting.test.cjs](tests/crafting.test.cjs) | Original conversion prices/slots, capacity/stale quotes, shared spending races, local guest menu and paid acknowledgement. |
| [quests.test.cjs](tests/quests.test.cjs) | Original task/reward bookkeeping, ownership, validation and once-only pending reward persistence. |
| [campaign.test.cjs](tests/campaign.test.cjs) | Original campaign preview/confirm gates and artwork, all native definitions, phase-bound preparation and stale/duplicate intent refusal. |
| [campaign-results.test.cjs](tests/campaign-results.test.cjs) | Original scores/star roles and victory/defeat presentation, once-only retained results, validation and local dismissal. |
| [campaign-rewards.test.cjs](tests/campaign-rewards.test.cjs) | Pending reward ledger, host ownership, partial/reentrant-grant refusal, original panel recovery and exact migration preservation. |

### Guest presentation, input diagnostics and acceptance observers (18)

| Suite | Checks |
| --- | --- |
| [world-state.test.cjs](tests/world-state.test.cjs) | Owned/bounded full snapshots and deltas, live identities/assets/poses, assigned camera/combat, sparse journal repair, native worker cues and strict native resource-ready state (snapshot18). |
| [guest-world.test.cjs](tests/guest-world.test.cjs) | Render-only terrain/entity reconciliation, interpolation/teleports, original-style menus/cursors/highlights, worker cue drawing and solo restoration. |
| [guest-camera.test.cjs](tests/guest-camera.test.cjs) | Original camera algorithms with guest-local state/aspect, actor proxies, resync/teleport handling and rotation input. |
| [guest-construction.test.cjs](tests/guest-construction.test.cjs) | Native cursor unprojection, bounded host metadata, original product/preview rendering, pending/stale placement and restored held state. |
| [guest-quests.test.cjs](tests/guest-quests.test.cjs) | Original cards/descriptions/reward input, revision/acknowledgement fencing, menu/focus/resync gates and canonical-row validation. |
| [guest-revive.test.cjs](tests/guest-revive.test.cjs) | Original messages/countdowns/buttons, fixed native prices, current death episode and stale/duplicate charge refusal. |
| [hud.test.cjs](tests/hud.test.cjs) | Assigned native getters/renderers, shared resources versus individual rank/points, number animation, preparation/crafting/pause visibility and validation. |
| [lighting.test.cjs](tests/lighting.test.cjs) | Assigned-hero original torch transform/cutoffs, guest interpolation and host-light independence. |
| [world-audio.test.cjs](tests/world-audio.test.cjs) | Original sound whitelist/spatial gain, bounded event/loop history, late join/resync, fades/stops, native pool/music ownership and local GUI separation. |
| [world-effects.test.cjs](tests/world-effects.test.cjs) | Original effect whitelist/factory, bounded guest-owned tweens, persistent decal lifetimes, late join/resync and no solo scheduler advancement. |
| [coop-input-trace.test.cjs](tests/coop-input-trace.test.cjs) | Passive bounded input/cursor diagnostics, exact native delegation/exception preservation and safe wrapper restoration. |
| [ground-click.test.cjs](tests/ground-click.test.cjs) | Normal mouse ground-click projection, CSS scaling/native ray round-trip, HUD/entity/input guards and behind-camera rejection. |
| [native-pause.test.cjs](tests/native-pause.test.cjs) | Acceptance-helper checks for keyboard-opened rendered pause menus, hidden gameplay HUD, advancing host/worker updates and cleanup failures. |
| [worker-productivity.test.cjs](tests/worker-productivity.test.cjs) | Observer rejects harvest-only/unrelated/pre-harvest deposits, checks exact accounting, solo/shared save bank, guest HUD bounds and wrapper cleanup. |
| [in-flight-save.test.cjs](tests/in-flight-save.test.cjs) | Save-observer rejects missed flights/capture boundaries, uncleared queues/failed UI saves and restores own/inherited capture hooks. |
| [incoming-disconnect.test.cjs](tests/incoming-disconnect.test.cjs) | Incoming-flight observer requires actual inbound resources at removal, cap-respecting exactly-once grants and immediate native inventory/health restoration. Rejects missed flights, incomplete settlement, duplicate grants and bad restore; restores owned/inherited wrappers. |
| [in-flight-disconnect.test.cjs](tests/in-flight-disconnect.test.cjs) | Close/rejoin observer requires active-flight removal, cleared queues, matching saved hero and hook cleanup; rejects expired/stuck/invalid cases. |
| [natural-deposit-diagnostics.test.cjs](tests/natural-deposit-diagnostics.test.cjs) | Bounded deposit/resource-approach screenshots preserve the original failure; resource walking restores real focus before more input, and worker walking delegates guarded native ground clicks while preserving range/focus/input failures. |

### Resource accounting and helper ordering (4)

| Suite | Checks |
| --- | --- |
| [resource-pickup.test.cjs](tests/resource-pickup.test.cjs) | Original wood/stone pickup reservation/flight/queued grant capture, exact once-only credit, other owners/unclaimed objects/queue order, native caps, partial-failure no replay/removal, stopped-flight no restart/requeue, native resource/XP-only batch refresh deferral and mixed-reward normal completion. |
| [resource-flight.test.cjs](tests/resource-flight.test.cjs) | Actual original tween/carrier/destination/co-op-capture methods: completed entry removal, later-flight capture/destruction, no duplicate payments and zero counters. |
| [resource-reward-order.test.cjs](tests/resource-reward-order.test.cjs) | Natural wood/stone helpers collect original completed rewards before navigation/deposit/building continues. |
| [projectile-collision.test.cjs](tests/projectile-collision.test.cjs) | Original projectile collision behavior and relevant collision/protection regression boundaries. |

### Runtime readability and immutable inverse proofs (8)

| Suite | Checks |
| --- | --- |
| [runtime-readability.test.cjs](tests/runtime-readability.test.cjs) | Scope-aware controller/data/play-state naming, exact inverse proof, ambiguity/capture/reassignment rejection and immutable/repeat CLI guards. |
| [camera-naming.test.cjs](tests/camera-naming.test.cjs) | Camera matching/projection/factory behavior, shadowed bindings and baseline/provenance protection. |
| [scene-node-naming.test.cjs](tests/scene-node-naming.test.cjs) | Pinned SceneNode methods/body provenance, inverse restoration and conflicting/incomplete inventory refusal. |
| [world-cube-naming.test.cjs](tests/world-cube-naming.test.cjs) | WorldCube role matching, sphere/step/collision behavior, inverse proof and baseline guards. |
| [world-model-naming.test.cjs](tests/world-model-naming.test.cjs) | World/clock/persistence model naming, native save filters/keys/geometry, scope safety and immutable provenance. |
| [world-factory-naming.test.cjs](tests/world-factory-naming.test.cjs) | Entity/block factory roles, native component/default forwarding, owner/product validation and inverse proof. |
| [ui-model-naming.test.cjs](tests/ui-model-naming.test.cjs) | Event/GUI/game-camera model roles, original queue/event behavior, scope safety and append-only provenance. |
| [presentation-model-naming.test.cjs](tests/presentation-model-naming.test.cjs) | Lighting/audio/effect role matching, call/public-key preservation, conflicting bindings and exact inverse restoration. |

### Packaging and runtime acquisition (3)

| Suite | Checks |
| --- | --- |
| [build-artifacts.test.cjs](tests/build-artifacts.test.cjs) | Tester bundle contents/provenance/hashes, overwrite refusal and Mac architecture/source/icon/signature verifier refusal cases. |
| [desktop-artifacts.test.cjs](tests/desktop-artifacts.test.cjs) | Windows PE and Linux ELF/AppImage architectures, installed source/version, approved icons, desktop associations and malformed/stale packages. |
| [electron-download.test.cjs](tests/electron-download.test.cjs) | Official installed-runtime reuse, exact target/version refusal, safe default-file cleanup, explicit verified installation/cache workflow and download-free unit job. |

## Visible standalone drivers

These `.cjs` files launch themselves. Run them individually after announcing them; do not invoke every file in `tests/` with a wildcard. They are **not** part of `npm test`. Use source execution unless a driver supports `POLYCRAFT_EXECUTABLE`; a finished-package claim requires the verified executable, not an assumed equivalent source checkout.

| Driver / command | Purpose and scope |
| --- | --- |
| `npm run test:game` (`game-smoke.cjs`) | Launcher/Play, original Craft close behavior, controls, coordinated checkpoint/autosave, independent islands and reload. Includes direct setup/control edits; not natural progression. |
| `npm run test:coop-movement` | `coop-identities-smoke.cjs --movement-only`: four visible games, real keyboard movement, same-tick authoritative records/world hashes, rendered interpolation, local pause/native blur stops, terrain repair and deliberately dropped-delta resync. |
| `npm run test:coop-sync` | `coop-identities-smoke.cjs`: movement plus original totem/crafting/build/demolition/weapon/PvP/reconnect/save cases. Baseline fixtures fund/equip/position/unlock temporary heroes; do not label all of it natural acquisition. |
| `node tests/worker-reload-smoke.cjs` | Fixture-driven solo worker restart; detailed commands below. |
| `node tests/hq-recovery-smoke.cjs` | Copies a validated temporary completed-HQ backup, deliberately corrupts its copy's primary, uses original recovery launcher and checks retained backup/world/party/history. Optional natural continuation below. |
| `node tests/campaign-recovery-ui.cjs` | Copies a temporary host checkpoint with pending reward; original panel/claim/save/reload/rehost and stale-claim refusal. `--backup` uses its backup case. Requires `POLYCRAFT_REWARD_FIXTURE`. |
| `node tests/session-ui-smoke.cjs` | Two-game actual connection menu, manual/direct and local room/password admission, approval, saved identity, signaling-service outage, lifecycle/held/campaign/crafting helper flows and solo restoration. Several scenarios stage lifecycle/progression fixtures. |
| `node tests/room-game-renewal-smoke.cjs` | Full-game automatic room/TURN renewal with two players, or `--four-players`; owned loopback TURN secret fixture required. Separate from CI stub worlds. |
| `node tests/graphics-smoke.cjs` | Actual shader compilation/rendering, movement/rotation, wheel cancellation and graphics-log diagnostics. |
| `node tests/fullscreen-shop.cjs` | Actual desktop fullscreen/icon/quest event and F/Escape behavior. |
| `node tests/tips-smoke.cjs` | Secret tip viewer, text-field exclusion, original images/navigation, close/pause restoration and unchanged history. |
| `node tests/history-migration-smoke.cjs` | Legacy UI/history classification, first-checkpoint exact migration backup and sticky enable-only cheat history. |
| `node tests/save-lifecycle.cjs` | Native rename/export/import, normal-close save/reload and active-slot deletion on disposable saves. |
| `node tests/shutdown-smoke.cjs` | Deliberately destroys its own BrowserWindow while a temporary loopback room socket exists; checks cleanup/late-callback behavior. Not ordinary exit/save acceptance. |
| `node tests/progression-smoke.cjs` | Editable progression, actual totem purchases/movement and persistence, with staged controls/progression. |
| `node tests/demolition-smoke.cjs` | Original radial/dialog Cancel/Confirm, storage/capacity cleanup and reload without resurrection; staged disposable structures. |
| `node tests/coop-data-smoke.cjs` | Real engine shared versus personal data models, migration/checkpoint and solo preservation; fixture-level state case. |
| `node tests/coop-players-smoke.cjs` | Real bound heroes, attributed events, inventory/health reconnect and solo restoration; fixture-level actor state case. |
| `node tests/guest-world-smoke.cjs` | Two-game replicated scene/lighting/skin poses, moving host, node reuse and suspended/unchanged guest solo world. |
| `node tests/online-world-smoke.cjs` | Real host simulation continues once per tick across original menus/focus/save/error paths while local input is suppressed. |
| `node tests/multiplayer-transport-smoke.cjs` | Four native Electron peers, manual offer/reply, bounded ordered frames, malformed-peer isolation/reconnect/close. Transport-focused, not gameplay acceptance. |

The separate `webrtc-renewal-smoke.cjs` is **Linux CI network-only**, not a desktop game driver; see below.

### Main finished-package commands

For supported drivers, the executable must be a verified package's actual binary. On macOS:

```sh
POLYCRAFT_EXECUTABLE="/absolute/path/PolyCraft Offline.app/Contents/MacOS/PolyCraft Offline" npm run test:coop-sync
```

`POLYCRAFT_EXECUTABLE` support is explicit in `game-smoke`, `coop-identities-smoke`, `coop-data-smoke`, `hq-recovery-smoke`, `worker-reload-smoke`, `campaign-recovery-ui`, `session-ui-smoke`, `room-game-renewal-smoke`, `graphics-smoke`, `fullscreen-shop`, `tips-smoke`, `history-migration-smoke`, `save-lifecycle` and `shutdown-smoke`. Other standalone drivers currently launch the checkout directly; setting that variable does not make them packaged tests.

Worker fixture: `POLYCRAFT_WORKER_FIXTURE` must point to a retained disposable `polycraft-hq-recovery-*` root with both completed worker huts, four saved party records and pending Stoneling reward. Co-op mode also needs its retained `rejoin-0`, `rejoin-1`, `rejoin-2` guest saves. The driver copies sources and checks their bytes afterward.

```sh
POLYCRAFT_WORKER_FIXTURE="/absolute/temporary/polycraft-hq-recovery-EXAMPLE" node tests/worker-reload-smoke.cjs
POLYCRAFT_WORKER_FIXTURE="/absolute/temporary/polycraft-hq-recovery-EXAMPLE" node tests/worker-reload-smoke.cjs --coop
POLYCRAFT_WORKER_FIXTURE="/absolute/temporary/polycraft-hq-recovery-EXAMPLE" node tests/worker-reload-smoke.cjs --coop --save-in-flight
POLYCRAFT_WORKER_FIXTURE="/absolute/temporary/polycraft-hq-recovery-EXAMPLE" node tests/worker-reload-smoke.cjs --coop --disconnect-in-flight
POLYCRAFT_WORKER_FIXTURE="/absolute/temporary/polycraft-hq-recovery-EXAMPLE" node tests/worker-reload-smoke.cjs --coop --resource-highlights
POLYCRAFT_WORKER_FIXTURE="/absolute/temporary/polycraft-hq-recovery-EXAMPLE" node tests/worker-reload-smoke.cjs --coop --disconnect-incoming
POLYCRAFT_WORKER_FIXTURE="/absolute/temporary/polycraft-hq-recovery-EXAMPLE" node tests/worker-reload-smoke.cjs --coop --xp-batch
```

Use **one** command per announced run. All five optional phase flags require `--coop`; the four special save/interruption/XP flags are mutually exclusive. Solo acknowledgement uses ordinary approach/input and original smart selection. Co-op acknowledgement uses assigned guest input and host-native callbacks. Offline credits/animations settle before productivity baseline; fresh harvest must precede qualifying delivery, while all deposits count toward exact bank accounting. Save mode clicks the real host Save Now UI during the later outbound transfer; close mode deliberately calls the real guest link's close operation, waits for host removal and rejoins the saved hero. Missing the active-flight timing window fails, rather than silently accepting an ordinary completed deposit. `--resource-highlights` approaches an original intact rock by normal input, requires the native selection ring with the shared growing/mature mesh, mines it and requires the depleted ring to disappear before a normal stone deposit. Its closer approach limit is a test setup requirement for original smart-range drawing; it does not change game interaction range. The incoming mode requires a Beta100 host; use matching builds for acceptance (runtimecoop42/snapshot18). `--disconnect-incoming` performs an ordinary first deposit, then closes the actual link after keyboard release during a later incoming pickup. It requires positive reservations at actual removal, exact capped credit, one native grant per captured pickup ID and immediate native restore before later pickups can change the bag. It rejoins the assigned saved hero, finishes normal gathering/deposit and continues the four-player worker/save/isolation case. No animation slowdown or assigned resource values.

`--xp-batch` stages two original XP pickups on the assigned guest at a coherent boundary, queues their native grants and lets the next normal simulation update deliver them. It requires exact XP from both grants before a single hero replacement, owner isolation, the updated assigned guest entity/HUD and disk progress, then continues the existing worker/save/isolation case. The first amount uses native setXP to cross the next rank threshold; this is a controlled reward-delivery fixture, not acquisition or input acceptance. It requires a Beta101 host.

HQ recovery fixture: `POLYCRAFT_HQ_FIXTURE` must identify the `host` profile under a retained disposable `polycraft-coop-identities-*` root. It checks fixture shape/history and copies the backup. `--lumbermill` selects the matching saved progression; `--rehost` rejoins saved heroes. `--resources` requires `--rehost`; `--stonemill` requires `--lumbermill --rehost --resources`; `--workers` additionally requires `--stonemill`.

```sh
POLYCRAFT_HQ_FIXTURE="/absolute/temporary/polycraft-coop-identities-EXAMPLE/host" node tests/hq-recovery-smoke.cjs --lumbermill --rehost --resources --stonemill --workers
POLYCRAFT_REWARD_FIXTURE="/absolute/temporary/session-fixture/host" node tests/campaign-recovery-ui.cjs
```

Do not manufacture a lookalike fixture path from a personal island. Refer to its creating driver's output and ledger for provenance.

Natural continuation flags on `coop-identities-smoke.cjs` are `--early-host`, `--natural-spawn`, `--natural-weapon`, `--natural-crate`, `--natural-bridge`, `--natural-bandits`, `--natural-village`, `--natural-hq`, `--natural-resources`, `--natural-lumbermill`, `--natural-gear`, plus `--movement-only`. They select related progression steps and have dependency assertions in the driver; use the recorded matching invocation rather than combining arbitrary flags. Natural helpers observe original drops, approach/input, costs, rewards and saves. A later-game `gatherOnly` helper mode deliberately skips tutorial sequencing; its result does not prove the skipped tutorial.

Route variants on the identities driver use `POLYCRAFT_TEST_TURN` (JSON owned TURN fixture) and `POLYCRAFT_TEST_MIXED=1` for two relayed guests plus one direct guest. The full-game renewal driver requires `POLYCRAFT_TEST_TURN_RENEWAL` JSON `{ "urls": "turn:127.0.0.1:PORT?transport=udp", "secret": "OWNED_TEMPORARY_SECRET_AT_LEAST_32_CHARACTERS" }` and optionally `--four-players`. Use only the owned loopback service; do not put a production secret in documentation, screenshots or committed logs. Route assertions are same-machine evidence, not WAN/provider deployment acceptance.

### Exported helpers: call through their driver

Running these files with `node` alone does not run an acceptance case. They export functions expecting already-loaded pages, assigned heroes, fixture directories and cleanup ownership.

| Helpers | Driver role |
| --- | --- |
| `coop-worker-acknowledgement`, `coop-native-pause`, `coop-natural-workers`, `coop-xp-batch` | Worker two/four-player acknowledgement, original pause/HUD and fresh productivity; invoked by worker/recovery drivers. |
| `coop-save-in-flight`, `coop-disconnect-in-flight`, `coop-incoming-disconnect`, `coop-natural-deposit` | Native incoming/outbound transfer observation, real UI save or intentional link close/rejoin, exact actor/shared-bank/save/HUD accounting. Wrappers observe/delegate and restore native methods. |
| `coop-natural-weapon`, `coop-natural-crate`, `coop-natural-bridge`, `coop-natural-bandits`, `coop-natural-village`, `coop-natural-building`, `coop-natural-resources`, `coop-natural-gear` | Original gameplay progression phases; driver orders dependencies/rewards and owns windows. |
| `coop-recovered-party` | Recovery driver's saved-party rejoin and optional resource/stonemill/worker continuation. |
| `coop-quest-acceptance`, `coop-restoration-acceptance`, `coop-campaign-acceptance`, `coop-campaign-victory`, `coop-crafting-acceptance` | Connection/session driver's staged and natural UI/lifecycle/held/campaign/crafting subcases. |
| `coop-ground-click`, `coop-input-trace` | Guarded normal mouse navigation and passive bounded native-input diagnostics. |
| `native-room-renewal` | Shared native room/ICE/TURN renewal and retirement observations for appropriate network/full-game drivers. |
| `runtime-ast`, `world-model-fixture` | Non-graphical fixtures extracting real native methods or supplying bounded model dependencies; not gameplay entry points. |

## Linux CI transport check: no island or game

[The build workflow](.github/workflows/build.yml) runs:

```sh
xvfb-run -a node tests/webrtc-renewal-smoke.cjs
```

This driver explicitly requires **Linux and `CI=true`**. CI installs `coturn`, `xvfb`, locked dependencies and the verified official native Electron runtime. It uses temporary loopback TURN/signaling plus Electron peers and **stub worlds**; no game bundle, bridge, personal island or production service is loaded. This is the specific network-only exception to visible desktop game windows, not permission to hide full-game tests.

Assertions include two/four participants, direct and forced relay, three renewals per guest, same channels/fresh ICE generations, continued ordered frames, old credential expiry and final TURN allocation/session retirement. The current successful CI ledger records **8/8** and **24/24** retirement sets. These counts are not four-player full-game, WAN, router, mixed-machine or endurance evidence. Do not remove the CI guard or run it on the user's desktop to replace visible acceptance.

## Package and provenance verification

The workflow has six native package targets: **macOS ARM64/x64, Windows x64/ARM64, Linux x64/ARM64**. Linux emits separate tar and AppImage artifacts, producing eight tester downloads across six targets. Unit checks and the native-network job are separate jobs. Pull requests run checks/network but skip packaging; push/manual builds use the committed workflow.

1. Confirm intended source commit, application version, locked Electron version, runner architecture and platform. Explicit official Electron installation precedes native consumers; matching installed runtimes are reused. Do not bypass archive checksums/TLS or silently substitute another build.
2. Build into a new/versioned output location. Preserve `dist/beta-1` and prior artifacts. CI uses `scripts/ci-builder-config.cjs`, official runtime/archive verification and existing `afterPack` rules.
3. Extract the finished archive to a disposable location; validate the *packaged* source/assets/version, not just checkout files.
4. Run the platform verifier against the extracted package:

```sh
node scripts/verify-mac.cjs "/absolute/extracted/PolyCraft Offline.app" arm64
node scripts/verify-desktop.cjs "/absolute/extracted/windows-package" win32 x64
node scripts/verify-desktop.cjs "/absolute/extracted/linux-package" linux arm64
node scripts/verify-desktop.cjs "/absolute/extracted/squashfs-root" appimage x64
```

Mac verification checks all Mach-O executables/libraries (currently 14), expected architecture, exact packaged source/approved original hero icons and deep/strict signature. The signature is ad-hoc; this is not notarization. Windows verifies PE architectures (currently seven files), source/version and executable icon resources; it does not prove native Windows launch or trusted signing. Linux verifies ELF architecture/source/window icon and AppImage desktop entry/icon/launcher associations (currently six files in tar, 12 x64 or six ARM64 in AppImage); AppImage extraction is not gameplay.

`scripts/collect-build.cjs` creates a new tester directory containing expected packages, `BUILD_INFO.json`, `START HERE.txt`, `SHA256SUMS.txt`; it rejects incomplete/unknown/overwriting bundles. Linux collection uses separate `linux-ARCH-appimage` / `linux-ARCH-tar.gz` IDs. Provenance records source/run identity and distinguishes CI artifacts from local calibration.

For downloaded artifacts retain API/run/job/artifact metadata, outer artifact SHA-256 and ZIP integrity, inner bundle checksums and package integrity, then the extracted platform verifier result. Verify the exact executable before any announced native acceptance. A local byte-equivalence proof can explain relationship to another package but is not that package's CI provenance. Archive expiry and endpoint failures are recorded failures, not reasons to weaken verification.

## Immutable runtime/readability proofs

[RUNTIME_READABILITY.md](RUNTIME_READABILITY.md), `scripts/runtime-names.json` and the eight naming suites describe the accumulated scope-aware transformations. `tests/runtime-ast.cjs` extracts actual engine functions for many host checks, with controlled rendering/math/platform dependencies where needed.

Naming passes must preserve public/save/network keys, strings/assets, evaluation order, shadowed bindings and prior provenance. They reject ambiguous bodies/factories, capture, reassignment, unsupported forms, repeated application and damaged immutable baselines. The inverse proof must restore **every previous engine byte**, not merely parse equivalent code. Keep original references and prior reports unchanged. Do not rerun mutation CLIs casually as a “test.”

For semantic runtime fixes such as Beta97, record the localized inverse separately: reversing the three intentional flight edits restores every Beta96 engine byte. That bounds the change; it is not a proof that gameplay is unchanged, which would contradict the intended fix. Source regressions and native acceptance provide separate behavior evidence.

## Recording a result and choosing the next gate

For each run record: intended claim, exact source/package and checksum/provenance, pinned driver/helper set, input fixture and untouched-source hashes, visible labels/profiles, command/flags, start/end/process identity, exit code, assertions reached, logs/screenshots/output saves, cleanup and missing acceptance. Preserve the original failed run before a diagnostic retry. Never reclassify a timing failure as a persistence bug without evidence, and never count a source fixture or subsection as overall native success.

Current open gates include the **new harness focus-restoration branch in a visible case**, physical loss/grace/recovery during transfers, inbound/carried/other interruption cases, broader worker orders/upgrades/combat, exact unidentified user mining-popup parity, other native platforms/mixed machines, real WAN/router/provider deployment and endurance. The intact-rock highlight issue is fixed with native rock04 acceptance; other rocks/Stone Seed/regrowth retain source/native-renderer coverage only. This is distinct from identifying that popup. Refer to the current status ledger before selecting work; historical notes do not reopen a completed gate or close an unverified one.

When adding or changing a check, update this inventory and its limits; record the exact dated run in `RESTORATION_STATUS.md`. Do not mark every catalog entry passed because a different suite or older package passed.
