# Repository working instructions

## GitHub checkpoints

The user authorizes automatically committing and pushing completed major revisions to `origin` (`https://github.com/VeeShep/PolyCraft-Revival.git`). Use the connected GitHub tools when practical. A major revision is a completed feature, substantial fix or documented milestone; do not push every intermediate edit.

Before pushing, review the complete change, run relevant checks, and update `RESTORATION_STATUS.md` with results and remaining acceptance gates. Include only intended project files; exclude personal saves, logs, credentials, dependencies and build output. Do not silently include unrelated user changes.

Check the current branch and remote head before publishing. Preserve existing history and other contributors' work. Never force-push, rewrite published history, or push to `upstream` (`burnedpopcorn/PolyCRACK`). If a protected branch requires a pull request, use that workflow. Report the commit or pull-request link and any checks not performed.

This authorization applies during active project work; it does not create an unattended watcher or scheduled task. GitHub source history does not replace exported island backups.

## Testing and continuation

Announce each game test before launching it. Game tests must use visible, clearly labelled temporary-island windows and disposable `POLYCRAFT_TEST_DATA`, never personal islands. Do not hide game tests in the background.

Read the current sections of `RESTORATION_STATUS.md` before continuing restoration work. Preserve `dist/beta-1` and its checksums unchanged; future releases use new versions and folders. Keep multiplayer and native-platform acceptance gates open until actually verified.

## Subagent budget

Delegate only when a bounded, independent task will save more time than its context and coordination cost. Good candidates are a focused review of a finished change, investigation of a separate platform build failure, or a repetitive batch across independent files. Keep routine searches, test commands, version bumps and tightly connected implementation with the main agent.

Before spawning, state the specific task and why parallel work helps. Start with one subagent; add another only for a separate useful task. Give each a narrow scope, clear completion criteria and concise reporting instructions. Prefer read-only investigations; assign exclusive files for edits and avoid overlapping work. Reuse an existing agent when its context is relevant, stop redundant work promptly, and have the main agent review and integrate results. All agents follow the same game-testing and save-protection rules.
