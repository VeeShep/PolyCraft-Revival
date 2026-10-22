# PolyCraft restoration: current roadmap and status

Updated 2026-10-22. **Resumable goal: active.** The goal record belongs to this chat (`01a1601b-422f-7f80-8849-3ecc3571969c`). Ask to pause or resume the goal as needed. Do not mark it complete while implementation or required acceptance remains open.

Preserve the original appearance and progression while making the game independently playable, maintainable, and shareable. Order: **foundations → multiplayer → gameplay expansion**. The historical appendix below records earlier work; its old instructions and status statements do not override this roadmap.

## Current checkpoint: Beta 1

Implemented: offline play without accounts/payment services; named islands, autosave, exit saving, backup recovery, import/export and diagnostics; hidden cheats for health, resources, level, XP, hero points and all eight original totem upgrades; original-style in-game demolition; fullscreen quest, WASD, mouse focus and achievement persistence fixes; original-style launcher/header and background option 3. Normal Craft Resource exchanges and building costs remain. Free premium claims require cheats.

Documented Easter eggs:

- `moreamberplease`: enable Cheats and show its header button, while the game canvas is focused.
- `moretips`: browse all 15 original loading-tip images from the launcher/loading screen, outside text fields.

Version **1.0.0-beta.1** packages exist for Apple Silicon Mac, Intel Mac, Windows x64 and Linux x64 in `dist/beta-1`. **Keep that folder and its checksums unchanged.** Future releases use new versions and folders.

Recorded verification: 28 passing unit checks; Apple Silicon packaged gameplay, save/reload, exit saving and backup workflows passed; package contents, architectures, integrity and Mac ad-hoc signatures checked. Native Intel Mac, Windows and Linux gameplay remain **unverified**. Rosetta was exceptionally slow and stopped before acceptance. Mac builds are not notarized; Windows builds are unsigned. The earlier unexpected closure's cause remains unknown.

## Milestone 1: foundations — implementation checkpoint

**Working source: 1.0.0-beta.2 (development, not a shared release).** Cheat history and platform icon wiring are implemented. The complete runtime has its initial formatting and verified naming pass; save/network boundary extraction remains next. Personal saves and the personal game session were not opened or changed by automated work. `dist/beta-1` was rechecked against its original manifest: all six entries pass.

Current evidence:

- **36 unit checks pass**, including permanent history, unknown legacy history, exact pre-migration bytes, recovery, rename/import/export, failed writes and retry, future-version refusal and rejection by the actual preserved Beta 1 save reader. History recorded in a recovery file survives an interrupted primary replacement. Wealth and XP do not imply cheating; the restoration's explicit `desktopUpgradePoints` edit marker does.
- **Formatted source game smoke passed** on disposable `polycraft-game-WN4ur3`; temporary Apple Silicon package game smoke passed on `polycraft-game-Gy9UvK`: original Play/shop/cheats, Clean/Cheats used labels, world/player checkpoint, autosave, independent slots, reload, no external requests. One earlier shop click timed out; a diagnostic screenshot/state capture was added and the next complete source and packaged runs passed. Do not represent that first run as a pass.
- **Source regression acceptance passed:** progression/totems/WASD/focus/logs (`polycraft-progression-3HZyM3`), demolition/capacity/save/reload (`polycraft-demolition-l1zErO`), all 15 loading tips (`polycraft-tips-YMHDRk`), fullscreen/native icon/F/Escape and quest (`polycraft-fullscreen-ZOkpWz`).
- **Packaged migration acceptance passed** (`polycraft-history-BV4Src`): Unknown history shown, real first-checkpoint migration, untouched original bytes, enabling without an action marks use, disabling stays marked. Packaged normal-exit/rename/export/import/delete acceptance passed (`polycraft-lifecycle-9ri6Pw`). Final rebuilt migration acceptance also passed (`polycraft-history-iEQ3yT`) after the interrupted-write and future-backup safeguards.
- Temporary validation builds are under `/private/tmp/polycraft-foundations.fYtFL9` (Mac arm64, Windows x64, Linux x64/AppImage). Mac ICNS matches the approved original; all seven Windows executable icon image payloads match the ICO; Linux AppImage desktop identity, icon association and all nine PNG sizes verified. Mac deep/strict ad-hoc signature check passed. Developer references, tests and Babel are excluded. These are validation builds, not new shared release archives; Windows/Linux icon builds preceded final persistence hardening and are not final release candidates.
- Native Windows/Linux/Intel Mac gameplay and native desktop icon appearance remain open. Current Mac builds remain ad-hoc signed and unnotarized; Windows unsigned.

**Next action:** complete the foundation save/network boundary audit and implement the new host-authoritative multiplayer path. See [MULTIPLAYER_AUDIT.md](MULTIPLAYER_AUDIT.md) and [RUNTIME_READABILITY.md](RUNTIME_READABILITY.md). Do not enable legacy multiplayer merely by increasing its player limit.

### Permanent cheat history

- Add `cheats.everEnabled`: `false` for tracked clean saves, `true` for known use, `null` for unknown history. New islands start clean. Enabling cheats itself permanently records use.
- Legacy saves with enabled cheats or saved cheat effects become Cheats used; otherwise Unknown. Do not infer use from wealth or hero level.
- Enforce sticky history in persistence across save, recovery, rename, import/export and hosting. Show **Clean / Cheats used / Unknown history** on save selection.
- Use a versioned migration and preserve an untouched pre-migration backup. Older applications must reject newer formats rather than fall back and overwrite them. This is useful history, not tamper-proof protection.

### Original application icon

Reuse the approved original hero badge (`128.png`). Generate platform formats and configure the window, Dock/taskbar, executable and Linux desktop entry. Retain unsigned Windows builds while permitting executable icon/resource editing.

### Readable runtime

Preserve an immutable Beta 1 source baseline before transforming the bundle. Format the entire running bundle; recover verified names from component definitions and matching upstream code with scope-aware syntax tools. Preserve public properties, save keys, assets and execution order. Extract only save/multiplayer systems initially; no complete engine rewrite or upstream engine replacement. Replace tests coupled to minified spelling with structural/behavioral checks. Record unresolved names honestly.

Use the [benchmark repository](https://github.com/turbulenz/webgl_benchmark) and readable Turbulenz libraries as references, retaining applicable [license notices](https://github.com/turbulenz/webgl_benchmark/blob/master/LICENSE). The benchmark is a graphics reference, not proof of a complete game-source release.

## Milestone 2: multiplayer — in progress

Implementation checkpoint (2026-10-21):

- `desktop/multiplayer.js` implements one manual invitation/reply per guest, three guest slots including pending invitations, fixed session PvP metadata, optional local STUN/TURN configuration with no default outside service, direct/relayed/unknown path reporting and bounded ordered data-channel transfers. TURN credentials are not placed in invitations. Version/session/nonce validation, malformed-frame isolation, guest message-direction checks and incomplete snapshot rejection are in place. Domain action validation and saved player identity still need implementation.
- **Four actual Electron processes passed transport acceptance on this Mac** (`polycraft-peers-5YeVLq`): separate invitation/reply exchanges, direct selected paths, two-megabyte Unicode snapshots and subsequent updates delivered in order, malformed peer isolation, fresh invitation after disconnect, incomplete snapshot discarded and host-close termination. This is same-machine transport evidence, not physical LAN, internet NAT/TURN, cross-platform or co-op gameplay acceptance.
- Extracted `beginWorldUpdate` and `updateSimulation` from the original manager while retaining solo call order. `desktop/online-world.js` introduces host simulation boundaries, local input blocking, coherent checkpoint capture and background-throttling control. The original update wrapper still freezes solo menus; online host menus continue the simulation. No visible multiplayer controls are exposed yet.
- **47 unit checks pass** (foundation plus transport and online-world tests). Host simulation boundary acceptance passed on disposable `polycraft-online-world-hApwMH`: actual clock, entity and action updates ran once per tick through Cheats, Pause, Craft Resource, demolition confirmation (cancelled with the original X), save selection, loading tips, error modal and checkpoint capture; solo pause restored. This run was hidden before the user changed that preference, so native physical keyboard/focus behavior is not established by it. One prior hidden startup hung before window creation; it was sampled and its confirmed test process stopped. Startup milestone logs now distinguish crash reporter, save-store, Dock-icon and window initialization. A visible repeat is still appropriate for supervised UI acceptance.
- The user clicked Demolish in an automated window during a cancellation check; the test then closed its disposable process. Test islands are separate from personal saves. **Latest user preference: run tests visibly, never hidden in the background, and announce each run.** Test windows have a distinct temporary-island title. The hidden-default change has been removed. Hidden native keyboard/focus checks are not physical keyboard acceptance.
- **Post-extraction visible solo smoke passed** on disposable `polycraft-game-XSZMDd`: original Play, Craft Resource close in both modes, cheat controls/premium gating, coherent world/player save, autosave, independent slots and reload. This closes the previously pending source solo repeat, not native Windows/Linux/Intel acceptance.
- **Live replication snapshot boundary implemented (2026-10-22):** `desktop/world-state.js` captures owned JSON arrays for terrain, stable entity names, transforms, current mesh paths/matrices/visibility and health. It includes live heroes and pickups that persistence serializers omit, excluding pending deletions. `HostWorld.snapshot()` captures only at the end of a simulation tick. The versioned schema rejects duplicate identities, missing hero, invalid/non-finite transforms, excessive object counts, unexpected fields and unsafe mesh paths; receive-side asset checks support installed block/mesh whitelists. This is a replication view, not a replacement save format or complete component/progression serialization.
- **51 unit checks pass. Visible host simulation/snapshot acceptance passed** on disposable `polycraft-online-world-d28k4J`: one real island captured 2,208 terrain blocks and 352 live entities (350,803 JSON bytes), including the non-persisted hero and its mesh/health. Successive snapshots advance by simulation tick and retain independent vectors. All tested menus (Cheats, Pause, Craft Resource, demolition cancellation, save selection, loading tips, error modal), online checkpoints and background focus keep simulation running; solo pause restores on close. No personal saves were used. This does not establish guest rendering, live replication delivery, physical keyboard acceptance or playable co-op.

**Next:** implement guest terrain/entity reconstruction using the validated snapshot, send snapshots/updates through the established transport, then route validated guest actions and persist island-owned co-op progression. Preserve local save isolation during guest sessions. Announce each visible test before starting it. Transport and host capture alone are not playable multiplayer. See [MULTIPLAYER_AUDIT.md](MULTIPLAYER_AUDIT.md).

Two to four players, each with a hero on one host-owned island. Shared resources, buildings and quests; individual hero progression saved with that island. Solo heroes/inventories stay separate. Guests may construct and demolish eligible buildings with host validation. Only the host controls cheats, which mark island history.

Hosting offers PvP, off by default and fixed for that session: hero-versus-hero damage only; friendly workers/buildings stay protected. No online menu pauses the simulation, including host menus. Solo pause behavior remains. No automatic host migration: host departure saves and ends the session.

Use Electron's built-in WebRTC data channels. The host owns AI, combat, resources, construction, quests and saves; guests send validated actions. Audit existing serializers/network hooks before reuse. Use a full initial snapshot followed by state updates; validate protocol/session versions, sizes and messages, reject repeated actions and prevent duplicated resources. Preserve guest progress across disconnect/reconnect. Snapshot saves at coherent simulation boundaries without stopping the online world.

Join with a separate copy/paste invitation and reply for each guest. LAN must work without outside services. Internet may use STUN and optionally configured TURN credentials; no hosted relay is assumed. Show direct/relayed connection status and useful failure explanations. Connection information still needs exchange; see the [WebRTC connection model](https://webrtc.org/getting-started/peer-connections). Defer short room codes until a signaling service is available; keep invitation handling separate.

## Milestone 3: later gameplay expansion — deferred

Begin only after original gameplay and multiplayer pass acceptance. Inventory existing assets/mechanics first. Concept artwork is inspiration, not evidence of finished features. Keep balance/unlock values in a separate expansion plan.

Backlog: late-game resource abundance/regrowth and environment upgrades; larger carrying capacity; stronger shots and improved rage/charged attacks; upgradeable sprint/stamina; health/armor progression; concept-inspired buildings and creatures.

## Acceptance and continuation gates

- Preserve existing gameplay, saves, achievements, fullscreen, input, demolition and Easter egg checks. Test only disposable islands; preserve personal saves.
- Test cheat-history migration, permanent marking, unknown legacy history, recovery and export/import; verify original backups and newer-format rejection.
- Verify packaged icons on each operating system. Native Intel Mac, Windows and Linux acceptance stays open until tested there.
- Test two and four players across Mac/Windows/Linux: late join, reconnect, host exit, shared spending, construction, combat, PvP and saved restoration. Confirm every online menu leaves AI/simulation running.
- Exercise LAN, direct internet, relay, incompatible invitations, malformed messages and interrupted transfers.
- Keep this current section updated with completed work, evidence and the next step. Preserve superseded records as history. README links here. The goal remains active until explicitly paused or actually complete.

---

## Historical appendix: superseded checkpoints

The following text is retained verbatim as historical evidence. References to a paused/missing goal, stale packages, old next steps, and multiplayer not being requested describe earlier checkpoints and are superseded above. Recorded personal-session observations are historical, not a current live-state check.

# PolyCraft restoration checkpoint

Updated 2026-10-21. Execution is enabled. The goal tool still reported paused on resume; the user explicitly requested resumption. Do not mark complete while acceptance gates remain.

## Current user activity

**Latest checkpoint (supersedes older activity below):** User requested a quick shareable beta for Windows/macOS, then Linux. Beta1 packages are in `dist/beta-1/`; see current beta validation below. All final SHA256 checks pass; release folder opened in Finder and source launcher restored through macOS `open`. Personal VeeTest1 was last saved at8:54:59 PM America/Chicago and was not changed by package testing. Leave the launcher/user session alone. Automated checks never target the personal save.

## Shareable Beta 1 — October 21, 2026

- Version **1.0.0-beta.1** in package.json/package-lock. Added consistent artifact filenames and `build:linux` (AppImage + tar.gz, x64). Product/app identity and save locations retained. Includes all latest UI, shop lock, hidden/header Cheats, demolition, persistence/input/fullscreen fixes and **moretips**.
- Deliverables: `dist/beta-1/PolyCraft-Offline-1.0.0-beta.1-mac-arm64.zip`, `...-mac-x64.zip`, `...-win-x64.zip`, `...-linux-x86_64.AppImage`, `...-linux-x64.tar.gz`, `START HERE - BETA.txt`, `SHA256SUMS.txt`. Approx143/150/174/150/148 MiB. Both Mac architectures included; Windows/Linux are x64 only. ZIPs/tar also contain the guide; AppImage has the guide alongside it in release folder. No personal saves, test islands, logs or developer dependencies ship.
- Build stage `/private/tmp/polycraft-beta.nnmxku`. Used existing caches `/private/tmp/polycraft-builder-cache` and `/private/tmp/polycraft-electron-cache`; staging outside Documents avoids Finder metadata signing failures. Current release ZIPs contain ad-hoc signed Mac apps, not notarized. Windows unsigned. Old dist root ZIPs and older temp release stage remain **stale**, not deliverables.
- All28 unit tests pass. Both Mac ZIPs extracted into stage verify-arm64/verify-x64 and pass deep/strict codesign verification. All1840 source/assets match in each platform's packaged app.asar. Versions verified. ZIP CRC checks pass; Linux AppImage SquashFS passes7za integrity test (expected trailing embedded block map). AppImage and tar app.asar match Linux packaged source. Windows executable PE32+ x86-64; Linux ELF x86-64. Final release checksums supplied.
- **Apple Silicon packaged gameplay PASSED** (`polycraft-game-0gFgqT`): original Play, Craft Resource X both cheat modes, secret reveal/header button and lock, cheat effects/free items, coordinated checkpoint, autosave, slot independence, saved reload and no external requests. **Packaged save lifecycle PASSED** (`polycraft-lifecycle-VVaohU`): rename, export/import, normal-close saving, reload and active-slot deletion; native dialog results predetermined in disposable test.
- **Intel Mac native gameplay UNVERIFIED.** Rosetta runtime starts and reaches original start screen, but is unusually slow here. First launch timed out; second exposed a test navigation race. Test now waits explicitly for initial reload and allows90-second launch. Final Rosetta attempt reached GamestateStartScreen but timed out while trying Play and was stopped per user steering. Do not call Intel acceptance passed or infer native Intel failure from emulation slowness. User observed slowness too.
- **Windows and Linux runtime UNVERIFIED** on their operating systems. User accepted beta sharing scope; guides clearly state tester gates, signing limitations, backup/export instructions and secret codes. No claim of notarization or Windows publisher signing. Need reports from friends on native systems.
- Original restoration goal remains unfinished beyond beta packaging. Next iteration should be beta2 with a new output folder, retaining beta1 checksums and user save compatibility. Do not overwrite shared beta1 silently.

## Hidden loading-tip viewer

- User requested Easter egg **`moretips`** on loading screen. Type it on save selection or while the island loads, outside editable fields, to view all15 original `textures/loading-*.jpg` images. Original local mapping table supplies filenames; no copies, generated images or network services. Reuses the existing secret-code matcher with a code argument.
- Previous/Next buttons and left/right arrows wrap through images. Close and Escape return. Viewer does not enable cheats or edit saves. If island loading finishes while open, Controls pauses until close and restores prior pause state. Existing modal/bitmap lettering styles retained; image uses contain to keep its embedded instructions visible.
- `tests/tips-smoke.cjs` PASSED on disposable `polycraft-tips-zu1fIu`: code ignored in name field, actual launcher and loading reveal, all15 unique images decode, navigation/wrap, Escape/button close, ready-while-open pause and restore, cheats remain disabled, no renderer errors. `test-results/loading-tips.png` visually checked. All28 unit checks and syntax/whitespace checks pass. README documents both secret codes. Packages remain stale.

## Selected background and Craft Resource close fix

- User selected preview **#3**, the subdued original PolyCraft splash artwork. Applied its exact tinted background in `desktop/style.css`, replacing the marketplace loading-tip card.
- With cheats disabled, only Craft Resource remains in the shop tab list. Original tab placement divided by `(count - 1)`, yielding NaN for a single tab. This invalid hit area could catch clicks and replace the close action with the tab action, producing repeated menu sounds. Fixed the shared layout to center a single tab at x=0, retaining original multiple-tab placement.
- Extended existing regression to reject non-finite tab/button coordinates and exercise the close callback. It failed before the change and passes after it. All28 unit checks and syntax/whitespace checks pass.
- Extended live game acceptance to click the original X with cheats disabled and enabled and verify return to `GamestatePlaying`; both passed. Full acceptance also checks hidden-code/shop lock, resources/cheats, free claims, save/reload and slot independence. Audio itself has not been listened to; the erroneous tab interception is fixed. Packages remain stale.

## Demolition modal and conditional header follow-up

- User requested demolition match the original **Not enough resources** screen. Now uses `modalMessageFrame` directly and a clone of the original wide orange `modalMessageBuy` button with DEMOLISH text. X at original shop-close position and Escape cancel. Removed the earlier custom frame and detached white buttons. The orange button's hit rectangle matches its existing SVG geometry.
- User approved the screen, then reported warning overflow. Shortened warning to **No refund. Capacity may drop.**, retaining original type size. Title and warning stay in the frame's original two-line text slot.
- User requested Cheats remain in the header once enabled. `#cheats` is hidden by default, appears with enabled island state, opens the same paused dialog, and hides when the master switch is disabled. Startup restores visibility, with a null-safe game-state lookup before the asynchronous engine is ready. Secret code remains `moreamberplease`.
- README updated for conditional header and original orange demolition action. All28 unit tests and syntax/whitespace checks pass. Final demolition test passed on `polycraft-demolition-JIo6E4`: original X/Confirm, capacity cleanup and immediate saved reload. Screenshot visually confirms warning fits. Full game smoke passed on `polycraft-game-NUHIFA`, including hidden header by default, visible after code, hidden on disabling, header-click reopening and visibility restored after reload, plus prior save/progression/shop checks. Packages remain stale.
- Personal VeeTest1 saved through CUA and normal close verified at8:48:52 PM America/Chicago. No personal building or stat edits. Resume it after disposable checks.

## Original-style UI, hidden Cheats and shop lock

- Launcher and top bar now reuse the original PolyCraft logo and bitmap lettering, turquoise/white palette and original loading artwork. `desktop/retro-ui.js` draws the existing font atlas onto accessible labels; real text remains available to assistive technology. Only the actual engine canvas receives game sizing/input rules. Fixed missing logo by serving SVGs with `image/svg+xml` in the local protocol.
- **Secret code: `moreamberplease`**, exactly lowercase while the game canvas is focused. Maximum three-second gap between letters. Typing in input fields does not reveal Cheats. No visible Cheats toolbar button. Matching letters consume game shortcuts so P/WASD do not interfere. Opening enables cheat mode and checkpoints before showing its dialog.
- New/legacy islands default to cheats disabled. Free premium claims require `state.cheats.enabled` at the bridge boundary; hiding tabs alone is not relied upon. Normal Shop opens **Craft Resource**, keeps normal Amber-to-resource conversion, and exposes premium tabs only with cheat mode enabled. Master checkbox disables premium claims and cheat effects; prior edited stats/resources/ownership remain. Mode persists per island and is documented in README.
- Demolition now uses original canvas menu graphics: clone of `modalMessageFrame` with title/warnings, original Cancel/Demolish buttons and Escape cancellation. Removed HTML and NPC-dialogue confirmations. Game clock pauses while native menu input continues; original play/pause state is restored. Actual engine cleanup and immediate checkpoint remain. The radial label retains extra padding.
- **28 unit tests pass**, with new coverage for secret code/focus/timeout, shop gating including normal convert panel, default/disabled claims and native demolition confirmation. Syntax and whitespace checks pass.
- **Live demolition test PASSED:** original radial clicks, native Cancel/Confirm, storage capacity cleanup, immediate save and reload without resurrection. Disposable data `polycraft-demolition-6sah5W` under system temp. Visually checked warning text and original menu art in `test-results/demolition-confirmation.png`.
- **Full source game smoke PASSED:** logo loads, original font renders, secret code ignored in name field, default Craft Resource/premium lock, secret reveal from Shop, master disable/re-enable, original Play, healing/resources/invincibility/build cheats, free claims, coordinated checkpoint,30-second autosave, slot independence and reload without external requests. Disposable data `polycraft-game-QXy4Im` under system temp. Launcher screenshot `test-results/launcher.png` visually checked. Packages remain stale and Windows runtime untested.

## Earlier activity

User reported WASD did not work, requested editable hero points/level/XP, and said the game closed suddenly while sending chat. The old terminal launch 25911 no longer exists. Their `VeeTest1` save was verified readable, with timestamp **2026-10-21 5:30:18 PM America/Chicago** (22:30:18 UTC), progress XP 3663. No new macOS crash report was found; the earlier Electron report at 15:35 predates this closure. Cause of sudden closure is **unknown**.

User’s game has been reopened using macOS `open -n -a /Users/vee/Documents/PolyCraft/node_modules/electron/dist/Electron.app --args /Users/vee/Documents/PolyCraft`, independently of a live terminal command. CUA clicked Continue on the actual `VeeTest1` card and verified **Island ready. Autosave is on.** Startup/load events are present in the normal persistent diagnostic log. Leave the user’s window alone for playtesting. This does not prove or fix the earlier close cause.

Original game had WASD disabled. Desktop now supports WASD, click-to-move and left/right arrow camera rotation. Returning from Cheats needed canvas focus/blur hooks in the original input layer, also fixed.

## Implemented

- Electron host in `desktop/`, retaining the original game engine/assets and service bridge protocol. Local assets only; external requests/navigation blocked; no login/payment dependencies loaded.
- Free premium shop, repeatable Amber packs, unique Crown/Well ownership, consumable rewards and deferred Well delivery when the hero's hands become free.
- Pausing cheats dialog: heal, exact Amber/wood/stone values, fill storage, hero invincibility, instant construction/upgrades. Normal costs and prerequisites remain. Wood/stone respect capacity.
- Named save slots, coordinated 30-second autosave, Save Now, save before switching and normal exit, native import/export dialogs, rename/delete. Atomic file replacement, last valid recovery backup, strict import shape/version checks and write-error handling.
- Save files live under Electron's user-data directory in `saves/`; original Chrome App data is untouched. Mac packages use ad-hoc signing, without notarization or paid certificates.

## Evidence

- `npm test`: 24 passing unit tests for saves, corrupt/missing primary recovery, failed replacement, interrupted temporary files, backup round trip, invalid imports, independent slots, premium inventory and resource limits.
- `node tests/game-smoke.cjs` passed against development Electron: Create island, original Play screen, cheats UI/heal/resources, actual invincibility check, original scaffold timing with/without instant construction, repeated free packs, Crown/Well ownership, coordinated island/player checkpoint, resource-depletion restoration, 30-second autosave, independent slot switching, reload with no external HTTP(S) requests.
- Latest passing full source acceptance run used `/private/var/folders/rc/kvswdcx12wd0_10snqlnhy5c0000gn/T/polycraft-game-CmwGKs`.
- `tests/fullscreen-shop.cjs` passed against source: native desktop toggle, original in-game fullscreen icon, F and Escape. It activates the ORIGINAL `goFullScreen` quest on a disposable island, clicks the actual icon, and confirms the original quest is satisfied. Temp run: `/var/folders/rc/kvswdcx12wd0_10snqlnhy5c0000gn/T/polycraft-fullscreen-HFeySx`.
- Root fullscreen/input fix: modern mouse PointerEvents now pass through to the original mouse handlers; true touch and pen retain their path. Fullscreen permission is limited to the local game. Quest notification now follows actual entry rather than a click attempt. Temporary production tracing removed.
- Craft Resource now explains missing storage/full capacity, while retaining original offer rules; unit checks cover both empty states and offers when room exists.
- `tests/save-lifecycle.cjs` passed on the rebuilt Apple Silicon package: rename, export/import through renderer and IPC, normal-close saves latest changes, reload, active-slot deletion and independent remaining slot. Native dialog results were predetermined in this isolated test; OS dialog interaction itself was not tested. Temp data `/var/folders/rc/kvswdcx12wd0_10snqlnhy5c0000gn/T/polycraft-lifecycle-XpDDk4`.
- Screenshots are in ignored `test-results/`. Unit tests exercise disk failures through injected filesystem errors; no physical power-loss test performed.

## Latest requested changes (2026-10-21)

- Cheats now has Hero level (original range 0–40), XP in this level and Unspent hero points. Uses original XP table via Controls attachment, not a duplicate curve. Editable points are a signed offset `progress.desktopUpgradePoints`; original total spent upgrades is preserved. Normal level gains still grant points, and original totem purchases consume one each. HUD and totem eligibility share `getUpgradePoints()`. Lowering levels retains purchased upgrades; other quests/prerequisites remain.
- Progress imports/saves validate integer XP and signed point offset, retaining compatibility with old progress without offset.
- Desktop WASD path only writes destinations while a key is held, stops on release, and preserves mouse destinations otherwise. Canvas focus/blur now restores the old engine’s keyboard listeners when returning from host dialogs.
- Local rotating diagnostics added in `desktop/logging.cjs`: `<userData>/logs/game.log` plus `game.log.previous`, ~1 MB each, bounded entries. Main lifecycle, renderer errors, save operations/errors and renderer/child-process termination are recorded; diagnostics write failure cannot fail saving. Electron crash reporting is local-only (`uploadToServer: false`). No logs existed to explain the earlier sudden close.
- `tests/progression-smoke.cjs` passed: actual progression form sets level 10/123 XP/50 points, original island totem buys an upgrade and leaves49 points, actual W key moves the hero after closing Cheats, release stops input, save/reload keeps progression AND purchased upgrade, persistent renderer diagnostic reaches disk. Disposable data `/var/folders/rc/kvswdcx12wd0_10snqlnhy5c0000gn/T/polycraft-progression-cH4RPL`.
- Unit suite19 tests passed (adds invalid progression/import checks, point spending, WASD directions/release/mouse preservation, logging rotation and write-failure safety). Source syntax/diff whitespace checks passed.
- Fullscreen regression passed after canvas focus fix: original icon, fullscreen quest, native toolbar, F and Escape. Test now waits for the macOS fullscreen animation before Escape. Temp data `/var/folders/rc/kvswdcx12wd0_10snqlnhy5c0000gn/T/polycraft-fullscreen-0o4Lq2`.
- Full source `tests/game-smoke.cjs` passed after all latest changes: original Play, cheats, invincibility/construction, free rewards, coordinated checkpoint, 30-second autosave, slot independence and reload without external requests. Temp data `/var/folders/rc/kvswdcx12wd0_10snqlnhy5c0000gn/T/polycraft-game-HyeyVf`.

## Direct totem stats follow-up

- User requested editing totem stats directly in Cheats. Added expandable **Totem stats** with the eight original upgrade types, names and level limits derived from live shrine definitions. Fields currently range0–5. Apply validates the whole form before mutation, calls the original player upgrade setter and hero stat refresh, refreshes shrine menus, preserves unspent points via the existing progress offset, fires the original HeroUpgraded event and immediately checkpoints to disk. Zero removes an upgrade. These cheats bypass level/prerequisite/visit gates intentionally.
- No game engine edits required for this feature. Source files: `desktop/controls.js`, `desktop/host.js`, `desktop/index.html`, `desktop/style.css`.
-21 unit checks pass, including invalid-form atomicity, max/reset, points preservation and original engine component application of all8 stats using its real factor tables. Syntax/diff checks passed.
- Extended `tests/progression-smoke.cjs` to use the real totem form, apply all-max/reset/max, check actual health scaling, preserve points and verify saved reload. **Extended live test passed** on disposable island `/var/folders/rc/kvswdcx12wd0_10snqlnhy5c0000gn/T/polycraft-progression-v4CWos`: all8 fields max/reset/max, actual health scaling, points unchanged, saved reload and existing progression/WASD/log checks. User explicitly authorized save/restart; CUA saved VeeTest1, and normal-close logs confirm a final save and clean app-quit at2026-10-21 5:57:13 PM America/Chicago. Current source was reopened using macOS open, Continue on VeeTest1 was clicked via CUA, and Island ready / Autosave on was verified. Cheats → Totem stats is open and the game is paused for the user; all8 actual fields were verified visible. No stats were changed on the user’s island. Leave their window alone for further playtesting.
- README updated. Restart was authorized and performed for the source version; packages are still stale.

## Achievement replay fix

- User reported achievements awarded repeatedly. Read-only inspection of VeeTest1 confirmed badges ARE persisted (e.g. hero-level-5=5, win-a-campaign=1, walls-built-10=10). No user save mutation needed.
- Root cause: `badge.read` returned `key`, but original `Ta.onListUserBadgesSuccess` reads `badge_key`, so awarded flags and partial scores restored under undefined. Bridge now returns both names plus the original `total` (including null for binary badges). Original `Ta.setAwarded` now ignores repeated award callbacks.
- `tests/achievements.test.cjs` reproduces the old failure using the real original badge manager and disk save/reload. After the fix it confirms earned and partial badges restore, no reaward requests/notifications occur for existing achievements, new awards fire once, duplicate callbacks do not replay and a second disk reload stays quiet. All22 unit tests pass; whitespace checks passed.
- User’s running session was left untouched. **The subsequent focus-fix restart loads this achievement fix too.** No GUI gameplay window was opened for the achievement check. Packages remain stale.

## App-switch input focus follow-up

- User reported cursor input stops working after switching away and back. Reproduced in the original input-handler regression test: window blur removes mouse/key listeners, `onWindowFocus` only reinstalls a mouse listener when stale hover AND active canvas match, and canvas mousedown does nothing when hover is already true.
- Fixed `fa.onWindowFocus` to call the original focus restoration when the canvas is the active DOM element, without stealing focus from cheat fields. Fixed `canvasOnMouseDown` to always deliver the actual canvas click after establishing hover if needed. Original stopPropagation prevents duplicate window click handling.
- All23 unit tests pass; new regression fails before the fix and covers stale hover true/false, immediate keyboard restoration and preserving text-field focus. Syntax/whitespace checks pass.
- User’s island was saved through CUA and closed cleanly with final save/app-quit confirmed at2026-10-21 7:22:39 PM America/Chicago. This restart also loads the prior achievement fix. Live focus-event recovery integration PASSED on disposable island `/var/folders/rc/kvswdcx12wd0_10snqlnhy5c0000gn/T/polycraft-progression-h1FZds`: three blur/focus cycles, exactly one delivered canvas click, real W movement, totem stats and reload. User session reopened independently of the terminal, Continue on VeeTest1 selected through CUA, and Island ready / Autosave on verified. Both achievement restore and app-return input fixes are loaded. Leave their window alone for playtesting; no tests target the user save. Attempts to use BrowserWindow hide/show or a second native window did not cause Chromium blur notifications under this automation setup, so physical Alt-Tab remains a manual acceptance check. The live check replays browser blur/focus events, then uses real mouse/keyboard input.

## In-game building demolition

- User clarified demolition must be **in the game**, not a separate list. Removed the Buildings toolbar button and list dialog. Final implementation adds **Demolish** directly to the original building action wheel alongside Move/Upgrade, using the existing radial graphics with a cross icon and label.
- The engine radial menu calls Controls.canDemolish for eligibility and Controls.requestDemolition to open a pausing confirmation. Existing cleanup `setToBeDestroyed` and `destroyDeadEntities` removes the object, updates caps/counts/children and checkpoints immediately. No refund. Protected: map structures, HQ/territory anchors, scaffolds/moves and buildings with structures above. Final helper is `demolitionInfo(entity)`; the obsolete buildingList method is removed.
-24 unit checks pass, including ownership and protected-target checks. Source syntax/whitespace checks pass. Final `tests/demolition-smoke.cjs` PASSED with actual in-game radial clicks, cancellation, real storage cleanup/capacity/resource checks and save/reload without resurrection. Disposable data `/var/folders/rc/kvswdcx12wd0_10snqlnhy5c0000gn/T/polycraft-demolition-IThzTP`. Fixture now spawns after original Play/camera startup. Currency comparison uses the value at confirmation because normal game quest awards can occur while playing.
- VeeTest1 saved through CUA at8:09:13 PM and closed for the final radial version. No user buildings were removed. The final action-wheel test passed. Game reopened independently of the terminal, Continue on VeeTest1 selected using CUA, and Island ready / Autosave on verified. No separate Buildings toolbar/list exists in the final version. Leave the user’s window alone for playtesting.
- README now documents the original in-game action wheel, not a list. Packages remain stale; rebuild after playtest changes settle.

## Packaging status

- Current build command: `ELECTRON_BUILDER_CACHE=/private/tmp/polycraft-builder-cache npm run build:mac -- --config.electronDownload.cache=/private/tmp/polycraft-electron-cache --config.directories.output=/private/tmp/polycraft-release.sQVhpr`
- **These staged packages predate the hero/WASD/logging changes above.** Latest Mac rebuild terminal session 93589 completed successfully: ad-hoc signed Intel and Apple Silicon ZIPs containing fullscreen and shop fixes are present under `/private/tmp/polycraft-release.sQVhpr`. Deep/strict signature verification passed both. Apple Silicon save lifecycle passed; full gameplay acceptance on both architectures remains outstanding.
- Earlier `dist/` ZIPs are **stale, unsigned artifacts**, not validated deliverables. Do not distribute them. After a successful build/signature check and packaged acceptance, replace these exact ZIPs with verified output.
- Signing in the Documents folder failed because Finder metadata reappeared on bundles. `desktop/after-pack.cjs` strips FinderInfo; the current build also stages outside Documents. mac.timestamp is `none` for local ad-hoc signing.
- Electron 45's installer uses `electron_config_cache`; builder needs `--config.electronDownload.cache=...` in this restricted environment. Npm cache override: `--cache /private/tmp/polycraft-npm-cache`.
- Apple Silicon and Intel ZIPs are required. Rosetta is available (`arch -x86_64 uname -m` returned x86_64). Test both packaged apps using `POLYCRAFT_EXECUTABLE` with the acceptance script after the user finishes manual play. `POLYCRAFT_TEST_DATA` isolates both development and packaged tests.
- Windows x64 rebuild terminal session 46003 was still archiving at the last check. The extracted executable was verified PE32+ x86-64. Windows runtime has not been tested. UTM is installed, but `utmctl list` failed with macOS automation error -1743. Do not claim Windows runtime acceptance.

## Next work

1. Source checks passed and normal user game is reopened on VeeTest1. Wait for their next playtest findings; do not open automated test windows while they play.
2. Prior Windows build session46003 may no longer be available; inspect staged artifacts. Rebuild all platforms after current playtest fixes settle. Rebuilt archives are staged in `/private/tmp/polycraft-release.sQVhpr`; repo `dist/` still contains stale ZIPs. Replace exact archives only after build completion and final acceptance.
3. After manual play ends, run full `game-smoke.cjs` and fullscreen quest acceptance against packaged Mac apps using `POLYCRAFT_EXECUTABLE`. Apple Silicon save lifecycle already passed. Intel Rosetta gameplay remains untested.
4. Windows gameplay is an explicit unverified gate. Native OS dialog interaction and physical power-loss are also untested; disk/import/recovery logic has unit coverage.
5. README already documents install/play/save/recovery/build steps; keep it and this checkpoint accurate. Full agreed goal remains unfinished. No multiplayer/cloud sync, old-save migration, paid signing or notarization is requested.

No commits have been created. Preserve existing files and user progress; all changes are in the working tree.

## Demolish label spacing

User approved the in-game action and requested more padding around DEMOLISH. Widened only its label rectangle from0.7 to0.95 (retaining the original radial width adjustment) and increased height from0.7 to0.8. Text/icon unchanged. Syntax/whitespace checks passed; no gameplay test needed for this visual-only tweak. The running user game was left untouched; new spacing takes effect on next restart.
