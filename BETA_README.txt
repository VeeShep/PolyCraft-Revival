POLYCRAFT OFFLINE — BETA 1
Version 1.0.0-beta.1 · October 21, 2026

TEST STATUS
Apple Silicon Mac gameplay and save/reload checks passed. Native Intel Mac,
Windows and Linux gameplay still need testers. The Intel build's Rosetta test
was unusually slow and was stopped before full acceptance.

PLAY
No account, internet connection, Node.js or separate Electron install is needed.

Mac: Choose mac-arm64 for Apple Silicon (M1 or newer), or mac-x64 for Intel.
Extract the ZIP, move PolyCraft Offline.app to Applications, and open it.
This beta is ad-hoc signed, without Apple notarization. macOS may require
approval in System Settings > Privacy & Security for a trusted copy.

Windows: Extract the ENTIRE win-x64 ZIP into a folder, then open
PolyCraft Offline.exe. Keep its supporting files together. This beta is
unsigned, so Windows may warn about the publisher. Windows gameplay has
not yet been tested on an actual Windows computer.

Linux x64: Use the AppImage if available. Mark it executable in your file
manager's permissions, then open it. AppImage support may require FUSE on
your distribution. The tar.gz is a portable alternative: extract the entire
archive and run polycraft-offline from inside its folder. Keep all supporting
files together. Linux gameplay has not yet been tested on a Linux computer.

Create a named island, then choose Play in the original game menu.
Move with WASD or click-to-move; left/right arrows rotate the camera.
F toggles the game's fullscreen view; P pauses.

SAVES
Progress saves every 30 seconds and during normal exit. Save now creates
an immediate checkpoint. Use Saves > Export backup to keep a portable copy;
Import backup creates another island without replacing existing islands.

Mac saves: ~/Library/Application Support/PolyCraft Offline/saves/
Windows saves: %APPDATA%/PolyCraft Offline/saves/
Linux saves: normally ~/.config/PolyCraft Offline/saves/
Saves stay outside the application. No personal saves ship with this beta.
Back up islands before installing later betas. Force-quitting can lose
progress since the last successful save.

SHOP AND DEMOLITION
Craft Resource exchanges earned Amber for wood/stone when storage has room.
Free premium claims are disabled until cheat mode is enabled.
Select an eligible player building and choose Demolish in its action wheel.
The orange button confirms; X or Escape cancels. No resource refund;
removing storage lowers capacity and discards any excess resources.

OPTIONAL EASTER EGGS (SPOILERS)
moreamberplease — Type lowercase while the game canvas is focused to enable
Cheats. Its header button stays visible while enabled. Turn the master switch
off to hide it and lock free premium claims. Previously edited stats remain.
moretips — Type lowercase on save selection or while an island loads to view
all 15 original loading tips. Previous/Next or arrow keys browse; Escape closes.
Click outside text/number fields first. Avoid long pauses between letters.

REPORTING BUGS
Include the beta version, operating system, what happened, and approximate
time. Logs stay local in the saves folder's parent directory: logs/game.log.
The previous log is game.log.previous. Export a backup before experimenting.

This is a beta restoration using PolyCraft's original game engine and assets.
No cloud sync or multiplayer is included. Original progression and building
costs remain. Cheats, offline saves, demolition and desktop fixes are included.
