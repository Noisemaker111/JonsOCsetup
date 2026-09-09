# Normal OpenCode2 launch

Run the installed `opencode2` in the target project. It loads the personal configuration and plugins through the host's normal discovery. The global opencode.jsonc references plugin-bootstrap, which resolves plugin-activation.json without requiring the managed runtime or a generation environment override.

The added CLI wrapper was withdrawn on 2026-09-06 after the user clarified that the normal vendor command must remain unchanged. All three npm shims (opencode2.ps1, opencode2.cmd, opencode2) were restored byte-for-byte from run/runtime/cli-shims-1788714939061 and their hashes checked. PowerShell and CMD version checks both returned beta-19157 with exit 0. The vendor executable, plugin fixes, selected generation, Quests and existing processes were not changed by restoration.

Commits 9ebea15 and 73092b8 describe the now-withdrawn wrapper experiment; their managed-launch receipts do not prove a normal vendor launch. The wrapper installer, entry script and wrapper-specific test are removed to prevent accidental reinstallation. The older optional managed supervisor remains a maintenance tool for owned standalone restart tests, not the normal user entry point.

Isolated worktrees protected concurrent work during the earlier implementation. Cherry-picks integrated task-owned commits into the original checkout; they are development operations, not plugin loading or normal startup requirements. The extra documentation-only integration commits were unnecessary fragmentation.

The direct-host check exposed a real bootstrap mismatch: the server selected plugin-activation.json, while both TUI bootstraps fell back to checkout source without a managed environment override. Both TUI bootstraps now use selectedPluginRoot, which reads the same activation pointer and preserves explicit managed pins. No installed CLI wrapper is required.

New verification: `node scripts/verify-vendor-launch.mjs` exited 0. The installed vendor command `opencode2 --standalone` loaded server, tui:usage and tui:quests from gen-1788714021356 / de44b1c67b184088a41abb553798e7be269a803c with no config-directory or generation override. Standalone was used only to isolate the test from existing services. Receipt: `.visual-e2e/vendor-launch-1788715419844/report.json`. Its server and UI processes were absent afterward. `bun test test/runtime-workflow.test.ts test/plugin-loader.test.ts`: 9 pass, 0 fail, 30 assertions. An already-running shared host was deliberately not restarted; its loaded server configuration is not changed by this correction.

Rollback for this correction is a focused revert of the bootstrap changes, not restoring the unwanted CLI wrapper. The selected plugin build and its previous recovery fixes remain unchanged.
