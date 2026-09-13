# Launch OpenCode

After [setup](../setup/README.md), run `oc`. It opens the native OpenCode2 terminal at the OpenCode hub. The default is the latest merged `agents` revision unless you have saved a different launch preference.

```powershell
oc
oc --here
oc --cwd C:/Projects/example
oc agents
```

`oc <branch>` selects that branch for this launch. `--here` uses the current directory; `--cwd` names a project. Within OpenCode, project selection changes the Quest worker destination while keeping the same giver conversation.

`oc --gated` opens the saved version that passed the acceptance gate. `oc --default gated` makes that the default for future plain `oc` launches; `oc --default branch` restores the latest merged `agents` behavior. The launcher shows which source it selected. A first launch of a new revision may need preparation; later launches reuse it.

Existing terminals keep their loaded code. The terminal's reload command reloads its selected configuration; it does not move every other terminal to a new revision.

The vendor `opencode2` command is unchanged and follows the host's own configuration discovery. It does not select this setup's branch or saved launch preference. Use `oc` for this setup's managed selection.

Launcher source: [shortcut installation](../scripts/install-channel-shortcuts.mjs), [native console launch](../scripts/start-direct-channel.ps1), and [revision preparation](../scripts/try-ref.mjs). Maintainers should follow the [development workflow](development-workflow.md).
