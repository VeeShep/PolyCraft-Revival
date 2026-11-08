# PolyCraft Revival auditor brief

Prepared 2026-11-07 for the upcoming code audit. PolyCraft Revival restores the original PolyCraft game for independent offline play and adds experimental host-authoritative co-op. Preservation of the original game, player saves and existing progression takes priority over new content.

This is an implementation and evidence handoff, not an independent security assessment. Review priorities below are areas to investigate, not a list of established vulnerabilities.

## Review baseline

- Application version: **1.0.0-beta.88**; package/application name: **PolyCraft Offline**.
- Working source has advanced to **Beta 89**: a shared native command-destination drawing helper, guest ground-marker correction and solo cursor restoration. Its 535 checks and all eight CI jobs pass; downloaded Mac packages pass static source/icon/architecture/signature checks. Visual/gameplay acceptance is pending. Treat that later engine/guest patch as a separate diff; the pinned Beta 88 baseline below remains unchanged.
- Pin application review to **`637dd2569ff479b0f3495c645c440837962ced6a`**. The subsequent checkpoint `f642d67` changes documentation only. Review later code changes as separate diffs rather than assuming this brief describes every future commit.
- [Build run 42443177035](https://github.com/VeeShep/PolyCraft-Revival/actions/runs/42443177035) completed successfully: **533 checks, eight jobs and eight artifacts**. Artifact suffix: **114.1**.
- [RESTORATION_STATUS.md](RESTORATION_STATUS.md) is the current roadmap and detailed acceptance record. Its historical sections preserve earlier failures and superseded checkpoints; they are not all current requirements or current failures.
- [MULTIPLAYER_AUDIT.md](MULTIPLAYER_AUDIT.md) records earlier networking investigations. [RUNTIME_READABILITY.md](RUNTIME_READABILITY.md) explains source recovery and its limits.

## What the application does

Solo play needs no game account, payment service or internet connection. The desktop launcher manages named local islands, autosave, normal-exit saving, recovery backups, import/export and local diagnostics. Original construction/crafting costs and progression remain. Optional cheats include resources, health, XP/level, hero points and the original totem upgrades; premium claims are free only while cheats are enabled. The hidden reveal phrase is `moreamberplease`; `moretips` exposes original loading-tip images.

Restoration additions include original-style menus/header, in-game demolition with protected structures, fullscreen quest support, input/focus fixes and achievement persistence. Additional progression/content ideas remain a backlog, not a completed expansion.

Experimental co-op supports **one host and up to three guests** on a host-owned island. Resources, buildings and quests are shared; individual hero progression is stored with that island. Solo and co-op heroes/inventories remain separate. Only the host controls cheats. PvP is off by default, fixed for a session, and limited to hero-versus-hero damage. Online menus must not pause simulation. Host departure saves and ends the session; automatic host migration is not implemented.

## Code origins and readability

The core is the recovered **PolyCraft 1.0.0.25 JavaScript bundle and original assets**, not a newly written game or a replacement engine. The repository retains an `upstream` remote to `burnedpopcorn/PolyCRACK`; restoration work is published to `VeeShep/PolyCraft-Revival`.

[game.canvas.js](game.canvas.js) contains the original Turbulenz-based entity/component engine, game systems, archetypes and UI. The whole running bundle is formatted; naming recovery is partial. Component/state definitions, matching pinned reference code and local factory/manager contracts support recovered or descriptive names. Descriptive names are not claims to know the lost original spellings. Short unresolved identifiers remain.

The scripts use scope-aware syntax transformations and record evidence/inverse proofs in [scripts/runtime-names.json](scripts/runtime-names.json). Public properties, component/archetype names, save keys, asset identifiers and execution order must remain stable. A naming-pass inverse proof does not certify that every subsequent gameplay patch preserved behavior: intentional co-op/game fixes have separate evidence.

Original notices remain in the recovered material. [desktop/TURBULENZ_REFERENCE_LICENSE.txt](desktop/TURBULENZ_REFERENCE_LICENSE.txt) and [reference/turbulenz-2cd2857/LICENSE](reference/turbulenz-2cd2857/LICENSE) concern the referenced material. **The repository does not assert a repository-wide license grant for all original game code and assets.** The benchmark reference is not the complete PolyCraft source release. Ownership, attribution and distribution scope deserve their own review.

## Active code map

| Area | Entry points and responsibility |
| --- | --- |
| Desktop boundary | [desktop/main.cjs](desktop/main.cjs), [desktop/preload.cjs](desktop/preload.cjs): BrowserWindow, local asset protocol, IPC, filesystem/dialog access, native networking, focus/fullscreen and close handling. |
| Launcher and offline integration | [desktop/index.html](desktop/index.html), [desktop/host.js](desktop/host.js), [desktop/bridge.js](desktop/bridge.js), [desktop/controls.js](desktop/controls.js): save selection, replacement service adapters, game integration, controls and checkpoint coordination. |
| Persistence | [desktop/saves.cjs](desktop/saves.cjs): validation, versions/migration, recovery, import/export and permanent cheat history. |
| Graphics compatibility | [desktop/graphics.js](desktop/graphics.js): runtime shader-precision/depth policy and graphics diagnostics; native GPU/driver coverage remains important. |
| Host world and player ownership | [desktop/online-world.js](desktop/online-world.js), [desktop/coop-players.js](desktop/coop-players.js), [desktop/coop-data.js](desktop/coop-data.js): authoritative simulation boundaries, assigned heroes, party/economy persistence and solo restoration. |
| Intent validation | [desktop/coop-actions.js](desktop/coop-actions.js), [desktop/coop-input.js](desktop/coop-input.js), [desktop/coop-construction.js](desktop/coop-construction.js): allowed actions, sequence/rate checks, movement, shared spending and native building rules. |
| Replication and guest presentation | [desktop/world-state.js](desktop/world-state.js), [desktop/guest-world.js](desktop/guest-world.js), [desktop/hud.js](desktop/hud.js), guest construction, quests, crafting, campaigns, audio and effects modules. |
| Peer transports | [desktop/multiplayer.js](desktop/multiplayer.js), [desktop/direct-network.cjs](desktop/direct-network.cjs), [desktop/direct-transport.js](desktop/direct-transport.js): WebRTC, bounded framing/transfers, native TLS sockets and invitations. |
| Connection coordination | [desktop/auto-transport.js](desktop/auto-transport.js), [desktop/auto-rooms.js](desktop/auto-rooms.js), [desktop/rooms.js](desktop/rooms.js), [desktop/room-socket.cjs](desktop/room-socket.cjs), [desktop/stun.cjs](desktop/stun.cjs), [desktop/relay-renewal.js](desktop/relay-renewal.js). |
| Optional server | [server/rooms.cjs](server/rooms.cjs), [server/turn-credentials.cjs](server/turn-credentials.cjs), [server/README.md](server/README.md): room authentication, bounded signaling and optional temporary coturn credentials. |
| Build and evidence | [package.json](package.json), [package-lock.json](package-lock.json), [.github/workflows/build.yml](.github/workflows/build.yml), package collectors/verifiers in [scripts/](scripts/), regression and visible acceptance scripts in [tests/](tests/). |

Some `.js` adapters run both as browser globals and CommonJS modules for tests; script load order matters. The old root browser/Chrome App shell is preserved but is not the packaged desktop entry point. Inspect `build.files` in `package.json` to distinguish shipped code from references, legacy shells and test tools. Original service URLs/scaffolding still present in recovered code need reachability analysis through the desktop adapters.

## Dependencies and packaging

The lockfile is the dependency inventory. Direct production dependencies are `@silentbot1/nat-api` **0.4.9** for UPnP, `selfsigned` **5.5.0** for native listener certificates and `ws` **8.22.0** for WebSockets. **Electron 45.0.0 ships with the app even though it is listed under devDependencies**; include its runtime in dependency review. Babel 8 supports source tooling, electron-builder **26.15.3** packages apps and playwright-core **1.64.1** drives tests. CI actions are pinned to commit IDs and the workflow declares read-only repository contents permission. These are configuration facts, not vulnerability or supply-chain clearance.

## Trust boundaries and data flow

**Renderer and operating system.** The BrowserWindow uses `contextIsolation: true`, `nodeIntegration: false` and `sandbox: true`. A limited preload bridge exposes operations rather than unrestricted Node or generic IPC. Main-process handlers check the calling WebContents/main frame/local desktop URL. The `polycraft://game/` protocol serves an allowlisted set of application assets; renderer requests and navigation are restricted. These controls are implementation facts to inspect, not a claim that renderer compromise is impossible. Native WebRTC, STUN, TLS and room networking remain intentional external communication paths.

**Host and guests.** Guests send actions, not authoritative edits to resources/world state. The host maps admitted connections to saved hero IDs, runs AI/combat/building/resource/quest logic, validates actions and coordinates saves/results. Identity forgery, replay/sequence gaps, invalid payloads, flooding and shared-budget races are key review paths. Host-authoritative does not mean the host is honest; this is not an adversarial anti-cheat service.

**Replication.** Guests render a full initial snapshot followed by deltas/interpolated presentation. Full snapshots are refreshed every five seconds; baseline mismatch recovery requests a fresh snapshot. Durable world serialization omits heroes and some transient entities: the co-op registry persists hero state separately, while replication must include live entities absent from save files. The snapshot/delta models, acknowledgement/backpressure, action/result ordering and coherent save boundaries need review together. HUD data arrives separately through matching hero-status replies; a visible world alone does not prove the HUD is current. Manual protocol limits include 16 KiB frames, 8 KiB chunks and 32 MiB transfers, with structural validation; verify enforcement on every transport and reassembly path.

**Connection setup and relay service.** Manual invitations support service-free LAN/direct operation. Room mode adds a self-hosted HTTPS/WebSocket service, room names/passwords and host approval of guest hero assignments. Preference is known/manual-forwarded native TCP/TLS, opt-in UPnP, direct WebRTC/STUN, then configured TURN fallback. STUN defaults to `stun:stun.l.google.com:19302` and is configurable; its UDP mapping is not a forwarded TCP port. No default hosted TURN service or embedded public TURN credentials are supplied.

Native direct TLS uses an invitation-pinned certificate fingerprint and a separate private access token. Review the complete pin/authentication flow: `rejectUnauthorized: false` is paired with explicit certificate pin checking, not ordinary public-CA authentication. LAN/private-address support is intentional and must survive any networking remediation.

The room service keeps expiring rooms in memory, derives password hashes with scrypt, and uses separate session/control capabilities plus host approval. It forwards connection information, not gameplay or saves. It can see connection metadata. Optional coturn credentials are short-lived, issued server-side and renewed; permanent shared secrets belong in server configuration, not app packages. WSS/reverse-proxy trust, quotas, credential lifecycle and cleanup are important audit areas. See the server README for deployment assumptions; no production service deployment is established by the local tests.

## Saves and player data

The save layer accepts envelopes through **version 8**, choosing a minimum format according to features used; untracked solo saves can remain version 2. Internal co-op schema is **4**, room protocol **4**, world snapshot/delta **15/2**, and the game compatibility identifier is **`polycraft-1.0.0.25-coop-39`**. Do not conflate these independent versions with the application beta number.

Save validation covers the outer state and nested JSON strings, known co-op/quest/campaign records, finite numbers, bounded sizes and unsafe object keys. Writes use a temporary file, file `fsync` and replacement, with recovery backups. Migration preserves original pre-migration bytes as `.pre-v*` files. Older readers must reject newer formats instead of overwriting them. Review actual failure/power-loss semantics and cross-platform filesystem behavior rather than assuming universal durability from an “atomic” label.

`cheats.everEnabled` is sticky history: `false` means tracked clean, `true` means known use, and `null` means unknown legacy history. Enabling cheats marks use even before a cheat action. Save/recovery/import/export/hosting must not erase known history. The recovery backup can deliberately inherit sticky history; pre-migration originals are a separate preservation mechanism. Resource amounts and hero level alone must not be treated as evidence of cheating. Users can edit their own files; this is not tamper-proof protection.

Personal saves live in Electron's user-data directory, outside the checkout/application. `POLYCRAFT_TEST_DATA` selects a disposable test directory. Logs are local, rotated, and designed not to break saving; crash upload is disabled. Audit diagnostic contents/redaction as well as permissions. Git history is not an island backup, and ignored `test-results/` evidence is not included in a clone.

## Review priorities

1. Trace imported saves, network data and room messages through validation into the recovered engine, DOM, filesystem and privileged IPC. Check nested JSON, prototype/property hazards, asset paths and resource-exhaustion limits.
2. Review connection-to-hero ownership, reconnect/rejoin authorization, session capabilities, host-only cheats, replay/rate controls and malformed/incompatible invitations. Room passwords alone must not grant an existing hero or host control.
3. Review spending/construction/reward acknowledgement against durable checkpoints: simultaneous purchases, save failure, interrupted transfer, disconnect, thrown/held buildings and rollback/backup behavior.
4. Check snapshot/delta consistency, interpolation versus canonical state, stale intents, resync and input/menu blocking without pausing online simulation. Distant guests must keep their native simulation region updating.
5. Review window/renderer/socket lifecycle and normal-exit saving. Beta 88 guards late focus/fullscreen IPC after destruction; preserve live events and the save-before-close handshake when changing teardown.
6. Review server/public deployment limits, TLS pinning, proxy headers, signaling metadata, UPnP opt-in/cleanup, TURN secrets/expiry/renewal and dependency/build supply chain. Pinned dependencies and passing tests are not a vulnerability assessment.
7. Keep licensing/provenance and inactive reference code distinct from runtime vulnerabilities. Preserve notices and establish scope before assigning findings to shipped paths.

## Current evidence and unresolved issues

**Proven to the recorded scope:** 533 in-memory checks; all eight CI jobs/artifacts; downloaded Apple Silicon and Intel Mac ZIP/source/icon/architecture/signature checks; native Apple Silicon four-player recovery/rehost, original wood gathering and exact task/party/world reload. Windows/Linux package workers verify source/icons/architecture. Separate Linux/Electron/coturn two/four-peer tests use loopback and stubbed worlds. Earlier controlled full-game local relay, mixed-route and credential-renewal cases are recorded separately.

**Still open:** native Intel Mac, Windows and Linux gameplay; actual cross-machine and WAN/forwarding/UPnP/NAT/provider deployment; endurance; broader original progression and recovery. Mac signatures are ad hoc, not notarized; Windows builds are unsigned. The latest source beta and experimental CI artifacts should not be confused with the older public Beta 2 offline prerelease.

The wood HUD wait now passes with explicit native focus checks, but the original timeout's cause is unproven. One later test completed tree depletion yet collected zero dropped wood. Two Beta 88 source runs and the GitHub Apple Silicon artifact subsequently passed without changing pickup rules. The earlier intermittent pickup failure remains unexplained; traces now capture movement/focus, and failure diagnostics include live pickup eligibility, animation and native paths. Do not describe it as fixed or infer cross-platform reliability from the passing repeats.

Later worker-progression tests reached the original combined wood/stone quest but timed out waiting for the first tree-click result; the cause remains unknown and later worker construction/production/reload checks are unverified. Test-only income accounting, screen framing and live failure diagnostics are recorded in the [current worker investigation](RESTORATION_STATUS.md#beta-88-worker-progression-investigation--incomplete-2026-11-07). The pinned application source remains unchanged.

The original cause of an earlier unexpected game closure is also not established. Latest Beta 88 source/package native logs are clean for the recorded cases; the previously observed destroyed-window focus callback has a reproduced regression and source fix. Keep these claims separate.

## Running checks and preserving evidence

CI uses Node 22; [server/README.md](server/README.md) records the supported source/server tool versions. `npm ci` installs the locked dependencies and `npm test` runs in-memory unit/regression checks without opening the game. `npm start`, `npm run test:game`, `npm run test:coop-sync` and the Electron smoke scripts **do open windows**. Announce graphical tests first; keep them visible and labelled; use disposable `POLYCRAFT_TEST_DATA`, never personal islands. Scripts can use `POLYCRAFT_EXECUTABLE` to test an extracted finished application; source execution alone is not packaged acceptance. Packaged players do not need a separate Node installation.

Each tester bundle includes `BUILD_INFO.json`, checksums and instructions. Match version, exact source commit, target architecture and CI run to the extracted executable before claiming a package passed. ASAR packaging is not a security boundary. Native logs and temporary captures are intentionally ignored by Git; ask for the recorded evidence bundle if a path in the status file is unavailable or a CI artifact has expired. Do not regenerate [reference/beta-1/](reference/beta-1/), other frozen readers/naming baselines, or the original `dist/beta-1` release/checksums to make a test pass.

For findings, provide the reviewed commit, affected file/line, reachable trigger, expected/actual behavior, impact and a minimal reproduction on disposable data. Distinguish a demonstrated bug from an inference, and note the OS/build/session/transport used. Preserve compatibility, original art/gameplay and recovery paths when proposing fixes.

## Upcoming Windows and Linux test machines

Remote machines are planned; **no acceptance results from those forthcoming machines are available yet**. At setup, record their OS/version, CPU architecture, GPU/driver, address/access method and available interactive desktop session. Keep credentials/keys outside this brief and the repository.

SSH is useful for builds, in-memory checks, logs and owned network fixtures. Graphics, focus/fullscreen, input and native gameplay need an observable desktop session; record whether evidence comes from RDP or console and capture the actual renderer/GPU. A successful remote connection is not graphical acceptance.

First test exact downloaded artifacts on disposable islands, including launch/graphics/shadows, crafting/demolition, fullscreen quests, WASD/arrows/focus return, saves/recovery/import/export and normal exit. Then exercise mixed-OS two/four-player join, late join/reconnect, shared spending, combat/PvP, menus, sync/resync and host exit. Separate LAN/direct, room/STUN, relay and configured forwarding/UPnP cases, preserving which path actually connected. Architecture-specific native acceptance remains open unless that architecture is actually exercised.
