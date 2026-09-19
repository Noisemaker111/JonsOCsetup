# Windows sandbox startup recovery

A sandbox setup error and a workspace ownership conflict are different failures. `SetTokenInformation(TokenDefaultDacl) failed: 1344` occurs while the native Windows runner constructs the command's restricted token, before the requested command starts. It does not establish that the requested file is protected by a Quest or that agents are forbidden from working outside a repository.

## Observed boundary

On this machine on 2026-09-13, the installed public CLI reproduced the error with:

```powershell
codex sandbox -P :workspace -C C:/Users/Jk101 -- cmd /c echo SANDBOX_HOME_PROBE
```

The same probe with `-C C:/Users/Jk101/.agents` printed its marker successfully. The current session also read the actual instruction files through its supported reviewed execution path. These observations establish a home-root sandbox startup problem and a working approved path; they do not prove that every host, permissions profile, or read tool has the same limitation.

Earlier notes attributed the failure to accumulated capability SIDs expanding the token's default DACL. That is a recorded diagnosis, not a reason to delete capability records, edit ACLs, or disable the sandbox. A native runtime repair needs its own source-level verification.

## Continue the task

1. Distinguish sandbox startup failure from command failure and explicit approval rejection. Do not replay a mutation whose completion is uncertain.
2. Use a permitted read tool when it can perform the requested inspection. For an affected shell or patch operation, use the host's supported approval mechanism if available and allowed by the session. Keep the original task and ownership scope.
3. Respect the approval result. Continue independent authorized work if an operation is denied; report the specific blocked operation instead of declaring the whole session unusable.
4. Prefer a relevant project directory when starting a new coding session, but do not require a new chat for ordinary home-directory work. If all permitted paths fail, explain the concrete limitation and preserve the task for a user-controlled reopening.

Do not broaden global permissions, remove another session's ownership, or alter the installed host as an incidental workaround. This guidance changes agent recovery behavior; it does not claim the native token-construction defect is fixed.

Official references: [Windows sandbox](https://learn.chatgpt.com/docs/windows/windows-sandbox) and [permissions](https://learn.chatgpt.com/docs/permissions). The Windows sandbox implementation, session approval policy, and repository ownership guard have separate responsibilities.
