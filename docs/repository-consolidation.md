# Repository consolidation

JonsOCsetup is the maintained repository for the setup and its plugin source.

| Retired repository | Maintained source |
|---|---|
| opencode-usage | usage/ |
| opencode-usage-plugin | usage/ |
| opencode-harness | harnesses/ |
| opencode-orchestration | orchestration/ and quest/ |
| opencode-models | models/ |
| opencode-quests | quest/ |
| opencode-papercuts | papercut/ |

The initial public revision starts a clean history. Previous private Git histories, repository metadata, issues and comments were backed up locally. They were not made public. Third-party forks and unrelated projects are not part of this retirement.

The cleanup removes service credentials, cached catalogs with secret-shaped examples, logs, runtime captures and unreleased recovery snapshots from the public tree. Secret scanning is performed on both the public tree and its new Git history before publication. External dependency versions and skill licenses remain represented in setup source.

Local plugin activation no longer invokes repository publishing. The old publish-plugin-repos command refuses to create or push repositories. Building a local plugin package remains supported.

Existing local checkouts, active sessions and plugin generations are preserved. A clean public repository does not silently replace a running local checkout. Future work should start from the clean public dev history; private-history branches must not be pushed to this public repository.
