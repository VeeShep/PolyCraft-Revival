# Preserved Beta 2 save reader

`saves.cjs` is the exact `desktop/saves.cjs` from commit `abf9fc0bd5061ab8a486d3cfcae44d6aa13d383c`, before adding co-op save format 3. Keep it and its SHA256 manifest unchanged. Regression checks execute this actual older reader to verify that it refuses newer primary and recovery files instead of overwriting them.

This reference is excluded from application packages. It does not replace exported island backups.
