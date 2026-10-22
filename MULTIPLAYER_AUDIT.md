# Multiplayer boundary audit: initial findings

Inspected after the complete runtime formatting pass on 2026-10-21. This is an implementation checkpoint, not working co-op. The goal remains active.

## What exists and why it cannot simply be enabled

- The manager currently aliased `Ib` has one selected `heroEntity`, plus a `heroList` and add/remove/get helpers (`game.canvas.js` around lines 67467–67575). Multiple hero objects alone do not establish individual progression or player input routing.
- Legacy manager `Kf` uses old Turbulenz session services and trust in peer-supplied JSON. Its joining model calls `destroyNonCamp`, appends unique suffixes and teleports spaces. That model does not implement the approved single host-owned island with shared economy and separate co-op progression.
- `Ib.deserialize` is an empty function (around 67773), despite `Kf.onUpdateMessage` calling it. The network reconstruction path is incomplete.
- `Kf.update` (around 68398) assigns `needToSend` from `serializeDelta` but only sends when its separate full-send flag is true. Presence of delta serializers is not evidence that working updates are sent.
- Legacy code includes host election/migration and peer ownership checks; those conflict with the approved fixed host and guest action model. Do not reuse that authority or host-migration logic.

## Save and pause boundaries

- `desktop/controls.js` currently wraps the whole application update when its local `paused` flag is set. Its checkpoint temporarily pauses, waits for bridge callbacks, invokes the existing save routines, waits again and copies bridge state. This is valid solo behavior and must remain so.
- The original manager's `startPaused` also stops its `gameClock` (around 68060). Its world update skips action manager, navigation and space simulation while that clock is stopped (around 68029). Merely unblocking the desktop wrapper would therefore still leave online menus freezing the island.
- Offline save serialization (`ua.Serialize`, around 36535) captures level/player entities and ECS save data, with script state. It is useful persistence evidence, not automatically a complete live-world replication format. Network game-space serializers use different fields and lifecycle paths. Audit per-component transient state and entity identity before using either for snapshots.
- `getPlayerData`, `Controls.data()` and resource/hero cheat actions currently assume the local selected hero. Co-op requires shared world economy plus host-island records for each player's progression, separate from solo data. Do not let a guest write world state or reuse a solo island as its co-op record.

## Implementation progress

`desktop/multiplayer.js` now provides the separate WebRTC transport and invitation boundary. Four real Electron processes passed direct same-machine transport checks; this does not establish playable co-op or real-network acceptance. `desktop/online-world.js` and small manager hooks now separate online host simulation from local menu/input blocking and capture checkpoints at simulation boundaries. Solo call order remains as before. Both paths are covered by unit tests; full live menu/save and post-extraction solo regression checks are recorded in RESTORATION_STATUS.md.

The old `Kf` session manager remains inactive. No legacy authority, election or broken receive path was enabled. Guest-visible reconstruction is now implemented in the checkpoint below; validated actions and separate co-op heroes/progression remain next. Do not add a visible Host/Join workflow until it can actually enter a playable shared island.

On 2026-10-22, `desktop/world-state.js` adds a separate live replication view: versioned, bounded terrain/entity records with stable names, copied transforms, mesh path/matrix/visibility and health. Ordinary save serialization filters out the hero and transient pickups, so it cannot serve as the complete live snapshot. `HostWorld.snapshot()` captures this view at the existing synchronous simulation boundary without invoking a save or mutating save formats. Validation rejects duplicate IDs, missing hero, invalid transforms/paths and extra fields; optional receive-side asset predicates reject unknown local mesh/block identifiers before reconstruction. These predicates must be supplied by the eventual guest installer.

The visible host acceptance repeat captured a real 2,208-block / 352-entity island, including its unsaved hero. All 51 unit checks and the complete visible host menu/checkpoint test passed. This does not yet deliver the snapshot into a guest world. Mesh records describe current geometry transforms, not every animation, particle, decal or custom shader state. Complete guest presentation and gameplay metadata still require audited reconstruction and updates; avoid claiming visual/gameplay parity from this capture alone. Post-extraction visible solo regression also passed; evidence is in RESTORATION_STATUS.md.

## Next implementation slice

### Guest presentation checkpoint — 2026-10-22

`desktop/guest-world.js` now reconstructs host terrain and entity geometry using the existing scene loader, without activating gameplay components. Installed asset names and snapshot schema are validated before reconstruction; incomplete asset loads are rejected. Stable entities reuse nodes across updates; mesh changes, deletion, visibility and terrain replacement are reconciled, with staged nodes cleaned up on load failure. Snapshot version 2 adds bounded skin matrices and the selected hero's torch transform/visibility; the invitation runtime tag is now `polycraft-1.0.0.25-coop-2`, so older development peers are rejected. Save formats remain unchanged.

`GuestWorld` suspends local simulation, scripts, menu drawing and engine saves, detaches the local island geometry and retains original world/hero lighting. It displays host time, geometry, skin poses and torchlight. Desktop checkpoints are skipped while receiving; controls cannot reveal cheats or edit local player data through their normal ready path. Disconnect removes guest nodes and restores local scene roots, update/save hooks, clock timing and pause state. `HostWorld.streamTo()` sends an initial complete snapshot, then complete state updates; it waits for every transfer before capturing another, stops on disconnect/host exit and allows explicit cancellation without removing a newer stream. Delta compression and interpolation are not implemented.

Visible two-game acceptance passed on disposable `polycraft-guest-world-jp0Jj9`: separate manual WebRTC invitation/reply, 2,208 terrain blocks, 352 entities, 52 actual posed tree meshes, host keyboard movement, existing-node reuse, attached directional/torch lighting, automatic updates through a local pause, unchanged guest save bytes and bridge state, no guest simulation, no outside HTTP(S) game requests and scene restoration on host exit. Screenshots were reviewed. This establishes a guest view of the host's selected hero, not independent player control or playable co-op. Guest input/HUD, independent heroes, shared actions/progression, local point lights/particles/decals and presentation parity still need work. Four rendered clients, native OS gameplay and real-network acceptance remain open.

Earlier repeat attempts timed out at Play; the test now moves across the canvas boundary and waits for the real passive Play button to be hovered before clicking, capturing input diagnostics on failure. One subsequent run reached the guest view but its test incorrectly assumed the rigid hero had a skeletal controller; the corrected check verifies actual animated tree meshes. Those incomplete runs are not counted as passes. A shared input regression was also reproduced with a failing unit test: a focused-canvas return could omit re-registering the root mouse-down listener after blur. Registration now uses the existing deduplicating listener helper regardless of focus. This does not establish physical operator Alt-Tab acceptance on every platform.

**Next:** bind validated guest actions to separate host-owned heroes and island-owned progression. Finish the guest HUD/input and presentation gaps, then expose Host/Join only when the user can enter a playable shared island. Preserve host-only cheats, shared economy, fixed session PvP, solo isolation and non-pausing online menus.

Final verification for this checkpoint: 64 unit/regression checks pass; visible solo regression passed on `polycraft-game-M7IdEI`. Disconnect restoration now immediately restores original camera vectors/FOV and light transforms as well as scene roots/hooks, retaining an originally paused solo island. The final visible two-game repeat `polycraft-guest-world-KtaApU` passed after that correction. These are Apple Silicon Mac checks; native and real-network acceptance gates remain open.

1. Introduce an explicit session boundary; solo remains the default. Keep WebRTC invitation exchange/transport separate from engine state and action validation. Validate protocol, session, peer and transfer limits before installing any state.
2. Implement authoritative host snapshots and guest action routing with stable entity/player identities. Reconstruct real visible entities through audited engine hooks; do not claim success from data-channel connectivity alone.
3. Split local input/menu blocking from simulation. Online host AI/world/network updates must continue under every menu and while taking coherent save snapshots. Preserve solo pauses and existing tests.
4. Add shared spending/build/demolish/combat validation, replay rejection, per-player co-op progression, reconnect and host-exit saving; host-only cheats and fixed session PvP rules.
5. Test two and four real game clients on disposable islands, then pursue the native OS and real-network acceptance matrix in RESTORATION_STATUS.md.

No legacy multiplayer code was activated during this audit. No personal saves were used.
