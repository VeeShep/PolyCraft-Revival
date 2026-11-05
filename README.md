# PolyCraft Revival

An unofficial, community-driven restoration of PolyCraft 1.0.0.25. The aim is to keep the original game playable after its online services disappeared, preserve its distinctive art and progression, and give players control over their islands. It uses the original game engine and assets inside a desktop app.

## Why this project exists

- **Preserve the original experience.** Keep the artwork, menus, mechanics and progression recognizable while repairing bugs and making the recovered code maintainable.
- **Make the game independent.** Solo play needs no account, payment service, Chrome extension or internet connection. There are no paid purchases; premium claims are available only as optional cheats, while normal crafting and building costs remain.
- **Keep saves in players' hands.** Named local islands, autosave, recovery backups and import/export let players keep their progress without a hosted account.
- **Bring friends back to the island.** Build two-to-four-player co-op around one host-owned island, with shared resources and individual hero progression. Multiplayer is still in development.
- **Expand after restoration is stable.** Extra totem upgrades, sprint, armor and concept-art-inspired content belong after the original game and multiplayer pass acceptance.

Work follows **foundations → multiplayer → gameplay expansion**. Playtester reports help determine what is ready; producing a package alone does not establish that a platform plays correctly.

## Current downloads and status

Download **[PolyCraft Offline 1.0.0-beta.2](https://github.com/VeeShep/PolyCraft-Revival/releases/tag/v1.0.0-beta.2)** for Apple Silicon or Intel Mac, Windows x64 or ARM64, and Linux x64 (AppImage or tar.gz). Read the attached `START_HERE.txt`; `SHA256SUMS.txt` and `BUILD_INFO.json` provide checksums and build provenance. This is a beta prerelease for offline solo play. Mac builds are not notarized; Windows builds are unsigned. Native platform acceptance remains open. Build output in `dist/` is excluded from Git, so cloning the repository does not download a playable package. The original Beta 1 packages remain unchanged.

The working source is **1.0.0-beta.78 in development**. Offline solo play, permanent cheat history, original hero-badge icons and partial runtime readability are implemented. Experimental co-op includes host-controlled movement/combat, construction, paid Craft Resource exchanges, progression, quests, campaign controls, replicated original effects/audio and non-pausing online menus. It has not passed full-game, audible, cross-platform or internet gameplay acceptance. Expansion features remain deferred.

Native Linux/Electron/coturn checks have verified direct and relayed links, repeated short-lifetime room-service credential renewal on the same data channels, and allocation teardown after peer closure with two/four participants. They use loopback services and stubbed game/world behavior; they do not prove WAN or long-session gameplay. See [verification evidence and current build results](RESTORATION_STATUS.md).

**Saves with campaign reward tracking use format 8 and require Beta 54 or newer.** The untouched previous file is preserved as `.pre-v8`. Quest-only tracking uses format 7 (Beta 18 or newer), with `.pre-v7` preservation. Untracked solo saves remain format 2. Co-op campaign rewards stay with the saved host and reappear when hosting that island again; solo play cannot collect them. Beta 78 uses game runtime coop-39/world snapshot 15 and delta format 2. **Beta 74–78 game peers remain compatible**; Beta 51–73 peers cannot join. Room-name play still uses a protocol-4 room service; this update does not change the service protocol. Older room protocols remain incompatible. Island save formats are unchanged. Guest quest controls and island status displays are implemented for testing; live acceptance remains open.

**Latest complete CI artifact set: Beta 76.** [Build run 42112629653](https://github.com/VeeShep/PolyCraft-Revival/actions/runs/42112629653) passed all eight jobs and has eight downloads for Mac ARM64/Intel, Windows x64/ARM64 and Linux x64/ARM64 (separate AppImage/tar.gz). Unit/native-loopback networking and every package job passed. Windows/Linux packages pass binary/icon/selected-source checks; both Mac packages pass expanded icon/selected-source/architecture/deep-signature checks. These are experimental tester builds; native gameplay and physical-network acceptance remain open. Artifacts require GitHub sign-in and expire after seven days.

**Newer experimental Windows/Linux builds: Beta 78.** [Run 42125622720](https://github.com/VeeShep/PolyCraft-Revival/actions/runs/42125622720) has six downloads (suffix **104.1**) for Windows x64/ARM64 and Linux x64/ARM64, with separate AppImage and tar.gz archives. All four platform jobs, 519 unit checks and native loopback networking passed. Both Mac jobs remain queued. Full-game and real-internet acceptance remain open.

Local Mac Beta 78 tester ZIPs are available in this checkout’s ignored `dist/beta-78-local/` for Apple Silicon and Intel, with finished-archive source/icon/architecture/signature/checksum verification recorded in [RESTORATION_STATUS.md](RESTORATION_STATUS.md). They include the host drag and room retry fixes. Older local packages remain preserved. These local files are not GitHub uploads; cloning Git does not download any app package. Mac notarization and graphical/native-platform gameplay acceptance remain open.

Start with [RESTORATION_STATUS.md](RESTORATION_STATUS.md) for the current roadmap, package provenance, remaining acceptance gates and continuation instructions. Its earlier checkpoints are historical, not the current release state.

## Play

The project is **PolyCraft Revival**; current packages and save folders use the application name **PolyCraft Offline**.

Extract the package for your computer. On Mac, move **PolyCraft Offline.app** to Applications and open it. On Windows, keep the extracted folder together and open **PolyCraft Offline.exe**.

Linux x64 has an **AppImage** (mark it executable, then open it) and a portable **tar.gz** alternative (extract and run `polycraft-offline` inside its folder). Read **START_HERE.txt** from the Beta 2 release before sharing. Use `mac-arm64` for Apple Silicon and `mac-x64` for Intel. No Node.js or separate Electron installation is needed for packaged builds.

Create a named save slot, then click **Play** in the original game menu. Creating a slot replaces the old account step; PolyCraft still handles the island and tutorial itself.

The top bar provides **Save now**, **Saves** and **Fullscreen**. Move with **W/A/S/D** or click-to-move; **left/right arrows** rotate the camera. The original controls remain available, including **P** to pause and **F** for the game's fullscreen view.

In co-op, click empty ground to walk, hold or drag to steer using the original faster movement, then release to follow a path; or use **W/A/S/D** to move your hero; **up/down arrows** remain forward/back aliases, and **left/right arrows** rotate your own camera. Release a resource or building target to gather or open its menu; hold a target longer than half a second to move instead. Ranged attacks start on press. Turning can complete the shared rotation quest through the host. Menus, focus loss and resync stop camera input.

## Multiplayer: can I join a friend's game?

Multiplayer is available in development builds through the **Multiplayer** header button. Published Beta 2 is offline solo. Use matching development packages, fresh named test islands, and enter the game through **Play** after the introduction. Finish placing any held building before hosting. Each player must accept the major-development warning.

The host owns one island for two to four players. Resources, buildings and quests are shared; each player has a separate hero saved on that island. Solo progression stays separate. Only the host controls cheats, and enabling them permanently marks the island's cheat history. Hero PvP is off by default and fixed when hosting; friendly workers/buildings stay protected. Menus stop local input while the online world continues. Host departure saves and ends the session; there is no automatic host migration.

### Join by room name and password

Use this option when your group has a room-server address. **No public project room service is deployed.** The operator's [room-service setup and player guide](server/README.md) explains hosting it. The app remembers the server URL, not passwords.

1. Both players open **Multiplayer** and enter the same **Room server** address.
2. The host chooses a **Room name** such as `poopedpants123`, a password such as `giggle shits`, and the desired PvP setting. Click **Host room** and accept the warning.
3. The guest enters that room name/password and their guest name, clicks **Join room**, and accepts the warning. Password spaces/capitals count; room names are case-insensitive. The examples are not built-in credentials.
4. The host selects the incoming **Room guest**, assigns **Create a new guest hero** or an existing saved hero, and clicks **Approve guest**. For reconnects, assign the same saved hero. Repeat for up to three guests.
5. Connection information exchanges automatically. Once connected, choose **Return to game** and click the canvas. No invitation/reply text needs copying.

Room hosting tries **forwarded direct → opt-in UPnP → STUN-direct → TURN fallback**. Under **Direct connection and router settings**, enter a reachable host address and TCP port if you already have a forward, or explicitly allow UPnP. A blank host address tries STUN discovery; discovering an IP does not open a port. The default STUN server is `stun:stun.l.google.com:19302`, editable under **Internet connection settings → STUN URLs**.

Leave manual TURN fields blank if your room-service operator supplies temporary coturn credentials. The service requests them only after earlier direct routes fail and renews admitted relay connections near expiry. Otherwise, either player can enter their own TURN URLs/username/password. No TURN allocation is requested by the initial direct WebRTC attempt. A working direct route avoids gameplay relay traffic; some networks still require TURN. Games and islands do not pass through the room service, which handles connection metadata. An established game can continue if signaling disappears, but new joins and service-issued credential renewal then remain unavailable.

### Join with a manual WebRTC invitation

This option works without a room service. For LAN, leave internet settings blank. For internet, configure STUN and optional TURN settings on both computers. Manual blank settings try LAN only; the room-mode default STUN server is not inserted here. Manual TURN credentials stay in memory and are not automatically renewed.

1. The host selects **Manual hosting connection → WebRTC · LAN or STUN/TURN**, chooses PvP, clicks **Host this test island**, and accepts the warning.
2. Select a saved **Guest hero**, or enter a name and click **Add guest hero**. Click **Create invitation** and privately send its complete text to that guest.
3. The guest pastes it into **Host invitation**, clicks **Join invitation**, and accepts the warning. Privately send the generated reply back to the host; keep the game open.
4. The host pastes the reply into **Guest reply** and clicks **Accept guest reply**. Return to the game. Repeat with a separate hero/invitation/reply for every guest.

After disconnecting, create a fresh invitation for the same saved guest hero. **Cancel selected connection** cancels or disconnects that guest while retaining their saved hero.

### Direct hosting with port forwarding or UPnP

Manual direct invitations use encrypted TCP/TLS and need no guest reply. They work without a room service or TURN relay.

1. The host selects **Manual hosting connection → Direct · TCP forwarding or UPnP**. Expand **Direct connection and router settings**. Enter the host's local IPv4 address for LAN, or a reachable public IPv4 address/hostname for internet guests.
2. Choose a TCP port (default **37841**) and allow it through the host firewall. For internet guests, forward the same external TCP port to that port on the host's local IPv4 address. Guests need no incoming forward. **Detect public IP with STUN** can fill an address candidate; it does not create or verify the forward and does not change the TCP port.
3. Alternatively, explicitly enable **Ask my router to open this port using UPnP**. Only TCP is mapped. Mapping may fail, and it does not open the computer's firewall or bypass CGNAT/double NAT. No router changes happen merely by opening the menu.
4. Host the island, add/select a guest hero, and create its invitation. The guest pastes it into **Host invitation**, clicks **Join invitation**, and accepts the warning. No reply is needed. Repeat with a different saved hero/invitation for each guest.

Direct invitations expire after 30 minutes, are single-use, and contain private access to the assigned hero. Keep them private. LAN guests should use the local address; a public address may fail on the same LAN without router NAT loopback. End hosting normally to save and remove automatic mappings. Remove manual forwards yourself when no longer needed; a crash can leave an automatic mapping until its finite lease expires. Direct mode is IPv4 only. Its path label is **direct TCP/TLS**, with RTT unavailable. Physical forwarding/router and cross-platform gameplay acceptance remain open.

### Playing and reconnecting

Guests can use **SHOP → Craft Resource** to exchange shared Amber for wood or stone at the original prices. Storage must have room; changed offers refresh instead of silently changing the charge. Free premium claims remain host-only cheats.

Use a **Beta 76 or newer host** for the restored held-drag movement and original bump-attack charging.

Guests can construct eligible buildings, place or cancel eligible held items, repair, upgrade, use totems and demolish eligible structures through the host. Normal costs/unlocks apply, and HQ/workshop remain protected. On reconnect, use the same saved hero to restore progression and saved held construction. Closing a menu or losing focus stops input without discarding an actual held item. Original death/respawn and eligible paid-revive controls run on the host; their visible reload/reconnect acceptance remains open.

Guests can use campaign banners, preparation skip and result panels through the host. Pending campaign rewards stay with their saved solo/co-op owner and are protected against repeated collection. **Campaign XP distribution and exact midbattle continuation remain unresolved design decisions.** Broader original-gameplay parity and visible HUD/camera/audio/quest/combat/save restoration still need playtesting; implemented controls are not a claim of stable co-op.

### Connection reports and troubleshooting

Open **Multiplayer** to inspect each connection's actual **path**, **RTT** when available, and queued bytes. Browser statistics have a two-second wait limit and fall back to unknown/unavailable. Use **End / leave session** when finished; the host saves before ending. Guests cannot switch islands or control host saves/cheats.

If joining fails, keep the exact error and choose **Copy connection report** before ending the session. A text box permits manual copying if the clipboard is unavailable. Reports exclude player/room names, addresses, passwords, invitations and island data; nothing is uploaded automatically. They contain local stage outcomes/timings plus separate framed-game/signaling byte/message totals. These totals exclude retransmission/provider overhead and are not TURN billing measurements. The actual path determines whether gameplay is relayed; a TURN-enabled attempt may still connect directly.

Use complete fresh invitations/replies and matching development builds. Room-name play requires protocol 4 and matching current clients; game compatibility is listed above. Check your room-service address, host approval, firewall and STUN/TURN configuration. If direct routes fail and no relay is configured, a room code alone cannot make the connection reachable. Deployment, physical LAN/WAN, cross-platform and multi-hour acceptance remain open; [RESTORATION_STATUS.md](RESTORATION_STATUS.md) records verified evidence separately. Historical developer-console procedures and earlier build limitations remain in Git history and the restoration checkpoints.

### Disposable playtest checklist

These are **pending manual checks**, not passed tests. Run once with two players and again with four, using separate computers where possible. Start fresh named test islands and matching Beta 78 packages; record each package’s version and source from `BUILD_INFO.json`. Use the joining steps above. Give reconnecting guests their same saved hero. Keep personal islands out of the test.

| Check | What to do and compare |
| --- | --- |
| Movement and resync | Have every player walk, hold/drag, release, use WASD, rotate their own camera and attack while others move. Compare hero positions, facing and hits on all screens. Note stutter, snapping, duplicate heroes or actions, and whether a reconnect restores agreement. |
| Online menus | Open pause, Craft Resource and other available menus on host and guests in turn. Confirm the menu opens, local movement stops, and AI/countdowns/other heroes continue. Close with the original button or Escape; test alt-tab and return. Host Cheats must also leave the online world running. |
| Shared spending | With limited shared Amber and available storage, have guests attempt Craft Resource purchases together. Compare balances and storage on every screen; successful purchases must be charged once at normal prices, without overspending. Check full storage, changed offers and the close button. |
| Buildings | Construct, place/cancel, repair, upgrade and demolish eligible buildings as different players. Check costs/capacity everywhere. Try HQ and workshop demolition: both must remain protected. |
| Hero progression and quests | Give different heroes different levels/totem upgrades, complete a shared quest, and collect its reward. After reconnect and host save/reload, compare each assigned hero’s progress and shared quest state; rewards must not repeat. Campaign XP allocation and exact midbattle continuation remain design questions, so report observations without assuming a new policy. |
| PvP | Start a session with PvP off and verify heroes cannot damage each other. End it normally, host with PvP on, and verify hero damage works while friendly workers/buildings remain protected. The setting must stay fixed during each session. |
| Disconnect and host exit | Disconnect one guest while the others continue; rejoin as that saved hero. Then end hosting normally and confirm guests leave. Host the saved island again and check resources, buildings, quests and each guest’s progression. Compare a guest’s separate solo island before/after. |
| Cheat history | On a separate fresh test island, confirm **Clean**, enable host Cheats, disable them, and save/reload. Save selection must still say **Cheats used**. Repeat through rename and export/import. Guests must not control host cheats or free premium claims. Leave legacy migration/recovery checks untested unless using a designated disposable fixture. |

Repeat the joining/reconnect checks on a real LAN and across separate internet connections. Record the **actual selected path** for every guest, not just the settings entered: manual forwarding, opted-in UPnP, STUN-direct, or TURN fallback. Include a mixed direct/relayed group when the operator has a relay configured. A missing public room/TURN service is an unavailable test setup, not proof that a route passed or failed. Do not claim UPnP success from STUN address discovery alone.

For endurance, keep an active two/four-player session going for two to four hours, moving, gathering and building periodically. Record disconnects, drift, recovery and resource/progression consistency. A service-issued relay session must remain usable beyond its initial credential expiry; manually entered credentials do not automatically renew. Opening menus must keep the world advancing throughout. These runs and native Windows/Linux/Intel Mac gameplay remain unverified until a tester supplies results.

For each failure, copy connection reports from host and affected guest **before ending the session**, note the approximate time and exact actions, and include relevant local log excerpts. Record **Pass / Fail / Not tested** per check; package success alone is not a gameplay pass. Do not include room passwords, invitations, replies or relay credentials.

```text
Build/version and source:
Players and host OS/CPU; guest OS/CPU:
GPU/driver (for graphics issues):
LAN or separate internet networks; selected path per guest:
Check and exact steps:
Expected / observed; approximate time:
Reconnect and save/reload result:
Duration; Pass / Fail / Not tested:
Host/guest connection reports and relevant log excerpts:
```

## Shop and cheats

- Cheats are hidden until enabled. Click the game canvas and type **`moreamberplease`**, all lowercase, without pausing more than three seconds between letters. This opens Cheats and enables cheat mode for that island. A **Cheats** button then stays in the header while cheat mode is enabled, including after reloading that island. Turning cheats off hides it again. Typing in name or number fields does not trigger the code.
- Premium claims are **disabled by default**. While cheat mode is enabled, the Amber Shop becomes available: Amber packs, the Amber Crown and the Amber Well are free to claim. Packs can be claimed repeatedly. Owned items remain unique.
- Uncheck **Cheats enabled** to disable premium claims, invincibility and instant building. The setting saves per island. Previously edited stats, resources and owned items remain. Type the code again to reopen and enable Cheats.
- Normal building costs, progression and unlock requirements remain.
- **Cheats** pauses solo play; the online world continues. It lets the host heal the hero, set Amber/wood/stone, fill storage, enable hero invincibility, or finish construction/upgrades without waiting.
- **Hero level**, **XP in this level** and **Unspent hero points** are editable in Cheats. Levels follow the original 0–40 curve. Spend points at the map’s totems; each upgrade consumes one point. Setting level/XP also sets the unspent points shown in the form. Quests and upgrade prerequisites still apply, and lowering a level keeps purchased upgrades.
- **Totem stats** expands inside Cheats and lets you set all eight totem upgrade levels directly from 0–5. These edits bypass totem visits, level/prerequisite gates and point spending; unspent points stay unchanged. Applying saves immediately and refreshes the hero’s actual abilities. Set a field to 0 to remove that upgrade.
- Wood and stone still require storage capacity. Cheat switches are saved separately for each island.
- **Craft Resource** exchanges Amber for wood or stone. Offers appear when there is storage space to fill; the tab explains when storage is missing or full.

## Demolishing buildings

Select a player-built building on the island and choose **Demolish** in its existing action wheel, alongside Move and Upgrade. The confirmation matches the original **Not enough resources** screen, with its turquoise frame and wide orange action button inside. Choose the **X** or press **Escape** to keep the building; choose **Demolish** to remove it. The game pauses during confirmation and saves the removal immediately. There is no resource refund; removing storage lowers capacity and discards resources above the remaining capacity.

The action is unavailable on original map structures, HQs/territory anchors, unfinished or moving structures, and buildings with structures above them. Remove stacked buildings from the top down. The game’s normal cleanup updates building limits, worker housing and storage. Development builds also protect workshops and critical structures, with HQ/workshop checks at every tier.

## Hidden loading-tip viewer

Type **`moretips`**, all lowercase, on the save-selection screen or while your island loads. Click outside text fields first. The viewer shows all original loading-tip images; use **Previous / Next** or the **left / right arrow keys** to browse, and **Close** or **Escape** to return. It does not enable cheats or change your island. If loading finishes while the viewer is open, gameplay waits until you close it.

## Saves and backups

Each named island has its own world, progress, resources, premium ownership and cheat settings. The game saves every 30 seconds, before switching slots, and during normal exit. **Save now** creates an immediate checkpoint. Wait for the saved status before treating a checkpoint as complete.

Open **Saves** to continue, rename, delete or export an island. **Import backup** creates a new slot without replacing an existing one. Backup files are versioned JSON files from this restored version; original Chrome App saves are not supported.

Saves are stored outside the application folder. On Mac they are in `~/Library/Application Support/PolyCraft Offline/saves/`; on Windows the default is `%APPDATA%/PolyCraft Offline/saves/`. Updating the app does not replace that folder. Every successful checkpoint keeps the previous valid checkpoint as a `.bak` recovery file. If the main save is damaged or missing, the app loads the recovery file and tells you it did so. If both files are unreadable, import an exported backup as a new island.

**Cheat history:** save selection shows **Clean**, **Cheats used** or **Unknown history**. Enabling Cheats permanently marks the island, even without using an action. Turning Cheats off does not clear that history. Older saves are Unknown unless saved cheat switches or the desktop hero-point edit marker prove use; resource amounts and hero levels are not evidence. This history is informational, not tamper-proof.

Ordinary solo saves use format 2. On the first checkpoint of a Beta 1 save, the app keeps the exact original file as `.json.pre-v2` and migrates both the current save and recovery file. Imported Beta 1 files also retain this untouched copy. Beta 1 cannot open migrated saves; keep that original backup if you need to return to Beta 1. The original file can be copied outside the managed folder to a `.json` filename for importing into Beta 1. Deleting an island deletes its managed backups too.

Co-op remains experimental, with menu and room-name joining. Hero data uses co-op schema 4; tracked quest history uses ledger 1 and save format 7. Co-op files without tracked quests may still use format 6 until quest tracking activates. Current saves retain death timing/lives, held-building quantities and placement/payment flags, building references, pending placement, rotation, weapons and ammunition. Older supported schemas migrate when activated and saved. Migration to format 7 preserves the exact earlier file as `.pre-v7`; original import bytes and earlier migration backups are retained too. Older applications reject unsupported formats rather than overwrite them. Rename, recovery and export/import preserve cheat history. Export important islands before development testing; missing details from old schemas cannot be reconstructed. These changes are not in the published Beta 2 release, and visible multiplayer save acceptance remains open.

If a write fails, the app reports it. Keep the game open and retry after resolving the disk problem. Normal exit offers a choice if the latest progress cannot be saved. Force-quitting can lose progress since the last successful checkpoint. Export backups of islands you want to keep.

## Debug logs

Local diagnostic logs are in the save folder’s parent directory under `logs/game.log` (Mac: `~/Library/Application Support/PolyCraft Offline/logs/`; Linux normally `~/.config/PolyCraft Offline/logs/`, or under `XDG_CONFIG_HOME`). The previous log is retained as `game.log.previous`; each rotates at about 1 MB. Logs include starts/exits, save operations/failures, renderer errors and child-process crashes. The development version also records a `graphics-info` entry after the island loads: GPU/ANGLE renderer, shader precision, context settings, actual default-framebuffer depth and camera clip distances. Logs do not include whole save contents and are not uploaded. Native crash dumps, when available, stay in Electron’s local Crashpad directory. If the game closes unexpectedly, note what you were doing and the approximate time so the log can be matched to it. A forced termination may leave no final log entry.

Linux Beta 1 testers reported severe terrain/decal/shadow flickering and camera jitter on an Nvidia system, including with shadows disabled. The tester now reports that **Beta 2 fixes the Z-fighting** on that machine following the shader precision change. Camera jitter and broader Linux gameplay acceptance still need separate confirmation. See [Linux graphics retest instructions](LINUX_GRAPHICS_RETEST.md).

## Development

### Run from source

Use Node.js 22.18+ within the 22.x line, or Node.js 24.11+, compatible with the locked dependencies. Development checks here use Node.js 22.18. From the repository root:

```sh
npm ci
npm start
```

The first install needs internet access to download dependencies and Electron. Installed solo gameplay runs offline. Open the game through `npm start`; the root HTML and Chrome App manifest are preserved legacy files, not the desktop entry point. Do not run the game through a generic web server.

### Repository layout

| Path | Purpose |
| --- | --- |
| `desktop/` | Electron launcher, local protocol, save storage, controls, UI and multiplayer work |
| `game.canvas.js` | Running game bundle, formatted with verified names partially restored |
| `staticmax/`, `assets/`, `img/`, `mapping_table.json`, root data JSON files | Original game assets/data and restoration UI assets; required in source control |
| `js/`, `index.html`, `main.html`, `manifest.json` | Preserved original browser/Chrome App shell |
| `tests/` | Unit/regression checks and visible Electron acceptance scripts |
| `scripts/` | Icon generation, package verification and guarded readability/naming passes |
| `reference/beta-1/` | Immutable original runtime/save-reader baseline and hashes; tracked, excluded from app packages |
| `reference/beta-2-save-reader/` | Preserved format-2 reader and hash used to verify that older apps reject co-op saves; excluded from packages |
| `reference/coop-schema-1/` | Preserved development format-3 reader and co-op schema used to verify migration and older-reader refusal; excluded from packages |
| `reference/coop-schema-2/` | Preserved format-4 reader/schema and hashes used to verify refusal of newer held-building saves; excluded from packages |
| `package.json`, `package-lock.json` | Launch/build commands and pinned dependency graph; track both |
| `RESTORATION_STATUS.md` | Authoritative roadmap, evidence and historical checkpoints |
| `MULTIPLAYER_AUDIT.md`, `RUNTIME_READABILITY.md` | Networking audit and source-recovery details |
| `BETA_README.txt` | Player installation guide for the unchanged Beta 1 packages |
| `dist/`, `test-results/`, `node_modules/` | Local build output, test captures and installed dependencies; ignored |

### Checks

Automated test profiles (`POLYCRAFT_TEST_DATA`) use visible windows clearly labelled as temporary tests and never use personal islands. Announce a run before starting it so the user can observe issues. A finished or failed check closes its own test process. The user explicitly requested visible tests; do not hide them in the background.

The running bundle is formatted, with 107 component/state names recovered from its own definitions using scoped syntax tools. Later passes recover SceneNode and Camera names from pinned upstream evidence, and add descriptive GameManager, GameSpace, GameClock, LevelPersistence, EntityFactory, BlockFactory, GameEntity and GameBlock role names from local definitions. The game implementations remain intact. Unresolved local names remain; see [RUNTIME_READABILITY.md](RUNTIME_READABILITY.md). The immutable Beta 1 reference and hashes are in `reference/beta-1` and are excluded from packages. Original hero badge platform icons are generated with `python3 scripts/generate-icons.py` (requires Pillow).

Unit/regression checks do not launch the game. The gameplay acceptance command opens a visible window and performs automated actions:

```sh
npm test
npm run test:game
```

The game acceptance test opens a temporary game window and automates gameplay actions. Run it when it will not interrupt a manual play session. It uses its own temporary save folder. To test a packaged app, set `POLYCRAFT_EXECUTABLE` to its executable path. `POLYCRAFT_TEST_DATA` explicitly overrides the save location for test launches.

Additional acceptance scripts under `tests/` cover save migration/lifecycle, achievements, progression, demolition, loading tips, fullscreen, transport and online simulation boundaries. Transport checks alone do not establish working multiplayer. Consult the status document before choosing a run; test results are evidence for that source/build and platform only.

`npm run test:coop-movement` runs only the visible four-player movement check: keyboard movement using WASD/arrows, every guest observing all four heroes moving, exact authoritative host position/rotation agreement at matching simulation ticks, finite rendered poses and moving display frames between updates, menu/focus input stops, and unchanged guest saves after host exit. It also compares decoded whole-world hashes against independent host captures, measures delta traffic, verifies periodic full terrain repair, and deliberately drops an update to verify automatic resync without disconnecting. It uses disposable islands and closes only its own test windows. Real-network latency and cross-platform acceptance remain separate.

`npm run test:coop-sync` opens four visible disposable games. It joins three assigned heroes, moves all four through keyboard input, compares every guest's positions/rotations with the host at matching simulation ticks, checks rendered mesh poses and moving display frames between network updates, then exercises original guest totem point/75-Amber purchases and restored speed effects after reconnect, gathering, a real original wall build/cost/throw/scaffold/disk acknowledgement, original Shop/Craft Resource pointer clicks and close/Escape, paid crafting saved before acknowledgement, a three-guest shared-budget race in the four-player room, PvP-off protection, original-style guest demolition/cancel with capacity updates and overlapping-save ordering, a forged identity, reconnect and host exit. A second two-player session checks a real PvP pistol hit and replicated health. It also checks guest local-pause and native-window blur stops, plus movement while the host's local input is paused. Playwright emulates document focus, so the blur assertion uses Electron's native window signal. Fixtures place temporary heroes near targets, fund an original HQ/Wall-unlocked settlement, create eligible storage and equip the test pistol. Building uses actual original-style product-menu and placement-preview clicks, checks no spending before placement, and compares the saved scaffold with the confirmed footprint. Normal unlock/progression, weapon acquisition and click-to-approach remain separate checks. This tests same-machine networking, not internet latency or cross-platform acceptance.

### Packaging

CI verifies extracted Windows ZIPs and both Linux archive formats before collecting downloads. It checks every bundled PE/ELF binary against the target architecture, the original Windows icon resources, AppImage desktop association/icons, and selected packaged source/version/window-icon bytes. Mac ZIPs additionally validate the bundle-selected ICNS, packaged window/Dock PNG, selected source/version bytes, every Mach-O architecture and the deep signature. These checks do not open the game or prove native desktop appearance/gameplay. `.gitattributes` keeps packaged source LF on Windows too, while original reference/game-asset bytes are excluded from conversion.

```sh
npm run build:mac
npm run build:win
npm run build:linux
```

Builds go to `dist/` by default. macOS targets Apple Silicon and Intel ZIPs; Windows targets separate x64 and ARM64 ZIPs; Linux targets separate x64 and ARM64 AppImage and tar.gz archives. Choose `linux-arm64` for ARM64 Linux computers and `linux-x64` for Intel/AMD. Linux ARM64 is a development build target pending native gameplay acceptance; published Beta 2 has Linux x64 only. Choose `win-arm64` for Windows on Arm, or `win-x64` for Intel/AMD computers. Cross-building may require additional platform tools or downloads. Build completion does not establish native gameplay compatibility.

The application includes Electron's browser engine, so most download size comes from the runtime rather than the game. A measured Beta 2 Intel Mac ZIP contains about 120 MiB of Electron, 33 MiB of game/app assets and 2 MiB of other shell files. Development packaging keeps only English Electron UI locale packs and excludes duplicate platform icon source files from `app.asar`; the required runtime PNG, platform application icons and all original game content remain. The local Apple Silicon package measured 142.35 MiB versus Beta 2's 148.58 MiB (different source revisions, same runtime version). This is a modest reduction, not a new runtime or a playable Beta 3 release.

Keep existing `dist/beta-1` files and checksums unchanged. New shared releases need a new version and output folder. Publish packages and their checksums as release attachments, rather than committing executables to the source repository.

Mac builds are ad-hoc signed, without notarization or a paid developer certificate. Windows builds are unsigned. Windows and Linux gameplay need testing on those operating systems; archive checks do not establish runtime acceptance.

If macOS adds Finder metadata to bundles while building inside Documents or a synced folder, stage the build in a temporary directory instead:

```sh
npm run build:mac -- --config.directories.output=/private/tmp/polycraft-build
```

### Co-op development status

The development adapters cover host-authoritative simulation, assigned guest heroes, movement, gathering/combat, original-style construction/demolition and totem purchases. Guests render interpolated world updates between full snapshots every five seconds, with automatic full recovery after a baseline mismatch. Guest Pause/Resume is local; online menus do not pause the host world. Only the host controls cheats, and the session's PvP setting permits hero-versus-hero damage while protecting friendly workers/buildings.

Co-op progress is saved separately from solo progression on the host island. Co-op schema 4 retains held construction and death lifecycle timing; quest tracking uses envelope 7 and campaign-reward tracking uses envelope 8; in-flight throws and pending consumption must settle before capture. Visible restored-item/death/reconnect acceptance, visible guest revive presentation, full HUD/camera, visible connection-menu acceptance and complete gameplay integration remain open. Use matching development invitations; older invitations must be recreated. Cloud saves and original-account migration are not implemented.

Same-machine checks are evidence for those tested paths, not complete co-op acceptance. The latest all-totem/four-player regression remains incomplete after focus-related failures, and visible tests are currently deferred at the user's request. Consult [RESTORATION_STATUS.md](RESTORATION_STATUS.md) for the exact source/checkpoint and [MULTIPLAYER_AUDIT.md](MULTIPLAYER_AUDIT.md) for technical details.

### Builds on GitHub

The [Desktop builds workflow](.github/workflows/build.yml) runs unit/regression checks, then builds packages on six native runners: Apple Silicon Mac, Intel Mac, Windows x64, Windows ARM64, Linux x64 and Linux ARM64. Linux ARM64 uses the native [`ubuntu-24.04-arm` runner](https://docs.github.com/en/actions/reference/runners/github-hosted-runners). Windows ARM64 uses GitHub's [`windows-11-arm` runner](https://docs.github.com/en/actions/reference/runners/github-hosted-runners). Relevant source, asset, dependency, test or workflow changes pushed to `main` trigger a build. Pull requests run checks only. To request packages manually, open [Actions → Desktop builds](https://github.com/VeeShep/PolyCraft-Revival/actions/workflows/build.yml), choose **Run workflow**, and select the branch.

Open a successful run and download your platform under **Artifacts**. Linux provides separate `.AppImage.zip` and `.tar.gz.zip` artifact downloads for each architecture; choose one format rather than downloading both. Each bundle includes its application archive, `START HERE.txt`, `BUILD_INFO.json` with its source commit/run, and `SHA256SUMS.txt`. Unzip the downloaded GitHub artifact first, then follow the included package instructions. Artifact names include the platform and build run/attempt, so development builds with the same app version remain distinguishable. They are retained for **seven days**; download and keep any build you want to preserve. GitHub requires sign-in to [download workflow artifacts](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/download-workflow-artifacts); you can forward the downloaded package to testers.

CI runs no game windows or hidden gameplay tests. A successful native package job proves a build, not playtester acceptance. Mac packages remain ad-hoc signed and unnotarized; Windows packages remain unsigned. The workflow uses read-only repository contents permission, does not automatically publish GitHub Releases, and never changes `dist/beta-1` or player saves.

### GitHub backup and continuation

Commit the source, original assets, documentation, tests, platform icons, lockfile and immutable reference baseline together so a fresh clone can reproduce the working setup. `.gitignore` excludes dependencies, build archives, test captures, local saves/recovery files, logs, crash dumps, environment files and common signing-key formats. Normal player data is stored outside this repository; GitHub source history does not back up your islands. Use the game's export feature and store those backups separately.

Before each push, review `git status --short` and the staged changes. Ignore rules do not remove files already tracked by Git, and they do not detect secrets inside source files. Keep TURN credentials, signing material and personal island exports out of commits.

To continue work in another clone or chat, read the current sections of `RESTORATION_STATUS.md`, then the relevant audit, and install with `npm ci`. The chat's resumable goal is separate from Git; the tracked roadmap is the portable continuation record.

## Original material and notices

This restoration preserves original game code, artwork, audio and embedded third-party notices. No repository-wide license grant for that original material is asserted here. Preserve existing notices and establish the applicable rights before redistributing original material publicly. The [Turbulenz benchmark reference](https://github.com/turbulenz/webgl_benchmark) is not a release of the complete PolyCraft source; its license does not automatically cover this repository's assets.
