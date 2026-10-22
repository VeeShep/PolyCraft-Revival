# Linux graphics retest — 1.0.0-beta.2

Prepared October 22, 2026 for the Beta 1 report of surface/decal/shadow Z-fighting, camera jitter and repeated passive-listener warnings. The tester reported an RTX 2080 Super, proprietary Nvidia driver, AppImage and kernel string `7.1.13+deb13-amd64`. Surface artifacts persist with shadows off. The exact driver version and graphics backend have not yet been established.

**Retest result:** the user reports that Beta 2 fixes the Z-fighting on this tester's Linux/Nvidia machine. Camera jitter and complete Linux gameplay acceptance still need separate confirmation; the exact driver/backend diagnostics have not been supplied. The build uses high-precision default shader floats when supported in both stages, explicitly permits the game's input listeners to cancel browser events, and records GPU/ANGLE, shader precision and actual default-framebuffer depth in local diagnostics. Original assets, camera clip distances, depth formats and shadow bias are unchanged. Playable multiplayer is still unavailable.

## Run the candidate

Use `PolyCraft-Offline-1.0.0-beta.2-linux-x86_64.AppImage` from the separate Linux graphics retest folder. Mark it executable and open it. The `linux-x64.tar.gz` archive is an alternative: extract it and run `polycraft-offline` inside the extracted folder. Keep all extracted supporting files together. No Node.js installation is required.

**Start with a fresh named island.** Keep a Beta 1 export of any island you care about before testing an existing island in this build. Beta 2 writes save format 2, which Beta 1 rejects; first-checkpoint migration keeps untouched `.json.pre-v2` files. Importing an exported island creates a separate slot, while opening the original slot in Beta 2 migrates that slot. See the [save and recovery guide](https://github.com/VeeShep/PolyCraft-Revival#saves-and-backups) for details. Normal autosave remains enabled.

## What to compare

1. Move the hero, rotate the camera and watch terrain edges and surface textures. Report whether the jitter and surface fighting improve, disappear or remain.
2. Compare shadows on and off in the original pause menu. Check ground decals separately from cast shadows.
3. Scroll over the game canvas and inspect the console: the repeated “Unable to preventDefault inside passive event listener” warnings should stop.
4. Check normal shop/crafting, saving and reloading. Note any new missing objects, shader errors or performance change.

If the artifacts remain, send the latest `game.log` (and `game.log.previous` if it rotated), a short recording of camera movement, and the exact Nvidia driver version. Diagnostics stay local and are not uploaded automatically. Do not send the saves directory for this graphics check.

The usual Linux log path is `${XDG_CONFIG_HOME:-$HOME/.config}/PolyCraft Offline/logs/game.log`. A `POLYCRAFT_TEST_DATA` override puts `logs/` under that directory instead. The `graphics-info` entry identifies the actual renderer/backend, high/medium shader precision, depth bits and camera clip distances. The driver version can be read with:

```sh
nvidia-smi --query-gpu=driver_version --format=csv,noheader
```

## Verification scope

Unit/regression checks and a visible Apple Silicon graphics test pass. The test checks 119 compiled shaders (including 17 shadow-related programs), actual wheel cancellation, hero movement, camera changes, shadows toggling and local diagnostic logging. That Mac reports 24 depth bits and 23-bit high/medium shader precision. The Linux Z-fighting result comes from the tester's report, independently of those Mac checks. Broader native Linux acceptance remains open.

Original Beta 1 files and checksums are preserved. Candidate archives and their SHA256 manifest are local build output, excluded from Git; share them separately from source commits.
