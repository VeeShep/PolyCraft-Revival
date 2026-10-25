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

The working source is **1.0.0-beta.3 in development**; the published downloads above remain Beta 2.

Offline solo play is implemented. Permanent cheat history, original hero badge icons and the first runtime readability pass are implemented in the development source. Multiplayer transport and host simulation work are in progress; **playable co-op is not available yet**. Gameplay expansions remain planned.

Start with [RESTORATION_STATUS.md](RESTORATION_STATUS.md) for the current roadmap, verification evidence, remaining acceptance checks and continuation instructions. Earlier entries in its historical appendix describe older checkpoints, not the current release state.

## Play

The project is **PolyCraft Revival**; current packages and save folders use the application name **PolyCraft Offline**.

Extract the package for your computer. On Mac, move **PolyCraft Offline.app** to Applications and open it. On Windows, keep the extracted folder together and open **PolyCraft Offline.exe**.

Linux x64 has an **AppImage** (mark it executable, then open it) and a portable **tar.gz** alternative (extract and run `polycraft-offline` inside its folder). Read **START_HERE.txt** from the Beta 2 release before sharing. Use `mac-arm64` for Apple Silicon and `mac-x64` for Intel. No Node.js or separate Electron installation is needed for packaged builds.

Create a named save slot, then click **Play** in the original game menu. Creating a slot replaces the old account step; PolyCraft still handles the island and tutorial itself.

The top bar provides **Save now**, **Saves** and **Fullscreen**. Move with **W/A/S/D** or click-to-move; **left/right arrows** rotate the camera. The original controls remain available, including **P** to pause and **F** for the game's fullscreen view.

## Multiplayer: can I join a friend's game?

**There is no player-facing Host/Join screen yet.** Published Beta 2 is for offline solo play. Current development builds contain co-op systems and automated development fixtures, but installing one does not give you a supported way to host or join from the launcher. There is no public lobby, room code or multiplayer address to enter.

The planned flow is to host a co-op island and exchange a separate invitation and reply with each guest. The host owns the island save; guests keep separate co-op heroes on that island. Menus stop local input while the online world keeps running. Internet connections may need STUN or an optional TURN relay; a relay-free connection cannot be promised for every network.

Contributors can use the experimental developer-console procedure below or the disposable automated checks described later. Host/Join UI, remaining gameplay integration and cross-platform/real-network acceptance are still required before public co-op. See [the current roadmap](RESTORATION_STATUS.md) and [multiplayer audit](MULTIPLAYER_AUDIT.md).

### Experimental quick start: two players on the same LAN

This is a developer-only workaround for current **Beta 3 development builds**, not published Beta 2. Matching packages are available under **Artifacts** in [successful build run 40152131783](https://github.com/VeeShep/PolyCraft-Revival/actions/runs/40152131783); choose the appropriate package for each computer and follow its included instructions. Both computers should use the **same source revision/build run**, be on the same local network and keep their games open. Cross-computer/platform acceptance is still pending. These commands follow the existing co-op fixture; this manual guide has not been exercised across two computers.

1. **Both players:** create a fresh, disposable named island and enter it through **Play**. Finish the introductory tutorial before starting co-op. Close game menus and finish placing any held building. Avoid personal islands: the host's co-op save migrates to format 5, which older apps cannot open.
2. **Host:** open **View → Toggle Developer Tools**, select **Console**, and run this once. It starts hosting with PvP off and no outside connection services:

   ```js
   window.hostSession = new window.PolycraftMultiplayer.HostSession();
   window.hostWorld = await window.PolycraftOnlineWorld.startHostingWorld(window.polycraft.controls, window.hostSession);
   await window.hostWorld.enablePlayers(window.polycraft.bridge);
   window.coopGuestId = window.hostWorld.players.registry.addPlayer('Player 2').id;
   window.coopOffer = await window.hostWorld.createPlayerInvitation(window.coopGuestId);
   window.coopOffer.invitation;
   ```

   Copy the complete returned string beginning `polycraft1.` and send it to the guest. Copy the string contents without the surrounding console quotes.
3. **Guest:** open the same developer console. Replace `PASTE_HOST_INVITATION_HERE` with the host's complete invitation, then run:

   ```js
   window.coopJoined = await window.PolycraftMultiplayer.PeerLink.join('PASTE_HOST_INVITATION_HERE');
   window.guestWorld = new window.PolycraftGuestWorld.GuestWorld(window.polycraft.controls, window.coopJoined.connection);
   window.coopJoined.reply;
   ```

   Copy the returned `polycraft1.` reply without surrounding quotes and send it back to the host promptly.
4. **Host:** replace the placeholder with the guest's reply and run:

   ```js
   await window.hostSession.acceptReply('PASTE_GUEST_REPLY_HERE');
   ```

5. **Both players:** close Developer Tools and click the game canvas. The guest should receive the host's island and their assigned hero. Move with **WASD/arrows** on the guest; the host keeps the original controls. Guest Pause/Resume blocks local input while the shared world runs. Co-op resources are shared, and guest hero progression is saved on the host's island; the guest's solo island is separate.
6. **End the session:** the host opens Console and runs the following, waits for it to finish, then closes the game normally. Host departure ends the session; there is no host migration.

   ```js
   await window.hostWorld.close();
   ```

If you disconnect and want the **same guest hero** back during that hosting session, the host creates a fresh invitation with the existing ID, then repeats steps 3–5:

```js
window.coopOffer = await window.hostWorld.createPlayerInvitation(window.coopGuestId);
window.coopOffer.invitation;
```

Do not rerun the host-start block to reconnect: that creates a new session/guest record. To preserve identities after restarting hosting, the host needs to select the existing saved guest record; that selection UI is unfinished.

**If it fails:** keep the exact console error. An incompatible-version error requires matching builds; damaged/expired invitations or a reply timeout require a fresh invitation and reply. An older app may lack these APIs entirely. Default settings use LAN candidates only, so internet joining may fail without explicitly configured STUN/TURN. Do not disable the firewall wholesale; check whether the app is allowed on your private network. No account, room code or central lobby is involved in these steps.

## Shop and cheats

- Cheats are hidden until enabled. Click the game canvas and type **`moreamberplease`**, all lowercase, without pausing more than three seconds between letters. This opens Cheats and enables cheat mode for that island. A **Cheats** button then stays in the header while cheat mode is enabled, including after reloading that island. Turning cheats off hides it again. Typing in name or number fields does not trigger the code.
- Premium claims are **disabled by default**. While cheat mode is enabled, the Amber Shop becomes available: Amber packs, the Amber Crown and the Amber Well are free to claim. Packs can be claimed repeatedly. Owned items remain unique.
- Uncheck **Cheats enabled** to disable premium claims, invincibility and instant building. The setting saves per island. Previously edited stats, resources and owned items remain. Type the code again to reopen and enable Cheats.
- Normal building costs, progression and unlock requirements remain.
- **Cheats** pauses the game and lets you heal the hero, set Amber/wood/stone, fill storage, enable hero invincibility, or finish construction/upgrades without waiting.
- **Hero level**, **XP in this level** and **Unspent hero points** are editable in Cheats. Levels follow the original 0–40 curve. Spend points at the map’s totems; each upgrade consumes one point. Setting level/XP also sets the unspent points shown in the form. Quests and upgrade prerequisites still apply, and lowering a level keeps purchased upgrades.
- **Totem stats** expands inside Cheats and lets you set all eight totem upgrade levels directly from 0–5. These edits bypass totem visits, level/prerequisite gates and point spending; unspent points stay unchanged. Applying saves immediately and refreshes the hero’s actual abilities. Set a field to 0 to remove that upgrade.
- Wood and stone still require storage capacity. Cheat switches are saved separately for each island.
- **Craft Resource** exchanges Amber for wood or stone. Offers appear when there is storage space to fill; the tab explains when storage is missing or full.

## Demolishing buildings

Select a player-built building on the island and choose **Demolish** in its existing action wheel, alongside Move and Upgrade. The confirmation matches the original **Not enough resources** screen, with its turquoise frame and wide orange action button inside. Choose the **X** or press **Escape** to keep the building; choose **Demolish** to remove it. The game pauses during confirmation and saves the removal immediately. There is no resource refund; removing storage lowers capacity and discards resources above the remaining capacity.

The action is unavailable on original map structures, HQs/territory anchors, unfinished or moving structures, and buildings with structures above them. Remove stacked buildings from the top down. The game’s normal cleanup updates building limits, worker housing and storage. In the Beta 3 development source, workshops and critical structures are also protected, with additional HQ/workshop archetype checks at every tier.

## Hidden loading-tip viewer

Type **`moretips`**, all lowercase, on the save-selection screen or while your island loads. Click outside text fields first. The viewer shows all original loading-tip images; use **Previous / Next** or the **left / right arrow keys** to browse, and **Close** or **Escape** to return. It does not enable cheats or change your island. If loading finishes while the viewer is open, gameplay waits until you close it.

## Saves and backups

Each named island has its own world, progress, resources, premium ownership and cheat settings. The game saves every 30 seconds, before switching slots, and during normal exit. **Save now** creates an immediate checkpoint. Wait for the saved status before treating a checkpoint as complete.

Open **Saves** to continue, rename, delete or export an island. **Import backup** creates a new slot without replacing an existing one. Backup files are versioned JSON files from this restored version; original Chrome App saves are not supported.

Saves are stored outside the application folder. On Mac they are in `~/Library/Application Support/PolyCraft Offline/saves/`; on Windows the default is `%APPDATA%/PolyCraft Offline/saves/`. Updating the app does not replace that folder. Every successful checkpoint keeps the previous valid checkpoint as a `.bak` recovery file. If the main save is damaged or missing, the app loads the recovery file and tells you it did so. If both files are unreadable, import an exported backup as a new island.

**Cheat history:** save selection shows **Clean**, **Cheats used** or **Unknown history**. Enabling Cheats permanently marks the island, even without using an action. Turning Cheats off does not clear that history. Older saves are Unknown unless saved cheat switches or the desktop hero-point edit marker prove use; resource amounts and hero levels are not evidence. This history is informational, not tamper-proof.

Ordinary solo saves use format 2. On the first checkpoint of a Beta 1 save, the app keeps the exact original file as `.json.pre-v2` and migrates both the current save and recovery file. Imported Beta 1 files also retain this untouched copy. Beta 1 cannot open migrated saves; keep that original backup if you need to return to Beta 1. The original file can be copied outside the managed folder to a `.json` filename for importing into Beta 1. Deleting an island deletes its managed backups too.

Co-op remains a development feature without a Host/Join screen. The current source uses co-op schema 3 / save format 5 to retain held-building quantities, placement/payment flags, building references and the host's pending placement queue, alongside hero rotation and weapon/ammo state. Only co-op-bearing islands migrate; ordinary solo saves remain format 2. Earlier co-op schemas remain readable and migrate when activated and saved. The first migration preserves exact earlier bytes as `.json.pre-v5`; imported older co-op files retain their original bytes too. Earlier applications, including published Beta 2, reject format 5 and its recovery files. Rename, recovery and export/import preserve the format and cheat history. Export important islands and keep original backups before using development builds. Missing held items or weapon details from older schemas cannot be reconstructed. These post-release changes are not in the published Beta 2 downloads, and visible held-building acceptance is still open.

If a write fails, the app reports it. Keep the game open and retry after resolving the disk problem. Normal exit offers a choice if the latest progress cannot be saved. Force-quitting can lose progress since the last successful checkpoint. Export backups of islands you want to keep.

## Debug logs

Local diagnostic logs are in the save folder’s parent directory under `logs/game.log` (Mac: `~/Library/Application Support/PolyCraft Offline/logs/`; Linux normally `~/.config/PolyCraft Offline/logs/`, or under `XDG_CONFIG_HOME`). The previous log is retained as `game.log.previous`; each rotates at about 1 MB. Logs include starts/exits, save operations/failures, renderer errors and child-process crashes. The development version also records a `graphics-info` entry after the island loads: GPU/ANGLE renderer, shader precision, context settings, actual default-framebuffer depth and camera clip distances. Logs do not include whole save contents and are not uploaded. Native crash dumps, when available, stay in Electron’s local Crashpad directory. If the game closes unexpectedly, note what you were doing and the approximate time so the log can be matched to it. A forced termination may leave no final log entry.

Linux Beta 1 testers reported severe terrain/decal/shadow flickering and camera jitter on an Nvidia system, including with shadows disabled. The tester now reports that **Beta 2 fixes the Z-fighting** on that machine following the shader precision change. Camera jitter and broader Linux gameplay acceptance still need separate confirmation. See [Linux graphics retest instructions](LINUX_GRAPHICS_RETEST.md).

## Development

### Run from source

Use Node.js 22 or newer compatible with the locked dependencies; Node.js 22 was used for development. From the repository root:

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
| `scripts/` | Icon generation and the guarded, one-time readability transformation |
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

The running bundle is formatted, with 107 component/state names recovered from its own definitions using scoped syntax tools. Unresolved local names remain; see [RUNTIME_READABILITY.md](RUNTIME_READABILITY.md). The immutable Beta 1 reference and hashes are in `reference/beta-1` and are excluded from packages. Original hero badge platform icons are generated with `python3 scripts/generate-icons.py` (requires Pillow).

Unit/regression checks do not launch the game. The gameplay acceptance command opens a visible window and performs automated actions:

```sh
npm test
npm run test:game
```

The game acceptance test opens a temporary game window and automates gameplay actions. Run it when it will not interrupt a manual play session. It uses its own temporary save folder. To test a packaged app, set `POLYCRAFT_EXECUTABLE` to its executable path. `POLYCRAFT_TEST_DATA` explicitly overrides the save location for test launches.

Additional acceptance scripts under `tests/` cover save migration/lifecycle, achievements, progression, demolition, loading tips, fullscreen, transport and online simulation boundaries. Transport checks alone do not establish working multiplayer. Consult the status document before choosing a run; test results are evidence for that source/build and platform only.

`npm run test:coop-movement` runs only the visible four-player movement check: keyboard movement using WASD/arrows, every guest observing all four heroes moving, exact authoritative host position/rotation agreement at matching simulation ticks, finite rendered poses and moving display frames between updates, menu/focus input stops, and unchanged guest saves after host exit. It also compares decoded whole-world hashes against independent host captures, measures delta traffic, verifies periodic full terrain repair, and deliberately drops an update to verify automatic resync without disconnecting. It uses disposable islands and closes only its own test windows. Real-network latency and cross-platform acceptance remain separate.

`npm run test:coop-sync` opens four visible disposable games. It joins three assigned heroes, moves all four through keyboard input, compares every guest's positions/rotations with the host at matching simulation ticks, checks rendered mesh poses and moving display frames between network updates, then exercises original guest totem point/75-Amber purchases and restored speed effects after reconnect, gathering, a real original wall build/cost/throw/scaffold/disk acknowledgement, PvP-off protection, original-style guest demolition/cancel with capacity updates and overlapping-save ordering, a forged identity, reconnect and host exit. A second two-player session checks a real PvP pistol hit and replicated health. It also checks guest local-pause and native-window blur stops, plus movement while the host's local input is paused. Playwright emulates document focus, so the blur assertion uses Electron's native window signal. Fixtures place temporary heroes near targets, fund an original HQ/Wall-unlocked settlement, create eligible storage and equip the test pistol. Building uses actual original-style product-menu and placement-preview clicks, checks no spending before placement, and compares the saved scaffold with the confirmed footprint. Normal unlock/progression, weapon acquisition and click-to-approach remain separate checks. This tests same-machine networking, not internet latency or cross-platform acceptance.

### Packaging

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

Co-op progress is saved separately from solo progression on the host island. Current schema 3 / save format 5 includes held construction; in-flight throws and pending consumption must settle before capture. Guest controls for restored held items, death/respawn, full HUD/camera, Host/Join and complete gameplay integration remain open. Use matching development invitations; older invitations must be recreated. Cloud saves and original-account migration are not implemented.

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
