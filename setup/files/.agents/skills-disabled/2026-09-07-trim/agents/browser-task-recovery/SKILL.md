---
name: browser-task-recovery
description: Recover repeated browser automation failures, ambiguous selectors, or wrong tab/account targeting. Use when an operation fails twice or target identity is uncertain.
---

# Browser task recovery

Establish the intended browser, tab, URL and account from observed state before the next action. Keep the selected target explicit; a successful navigation in a different profile is not completion. Prefer an available purpose-built connector or authenticated CLI/API for the task. Use the supported browser API and its returned documentation when UI interaction is needed. If a browser authentication prompt blocks an operation, check whether existing supported CLI/API authentication can perform the authorized action before asking the user to intervene; never infer account-wide unavailability from one UI prompt.

After navigation or DOM changes, re-read state before using old locators. Resolve ambiguous matches against observed candidates and scope to the intended record. For product smoke tests, use the repository's synthetic fixture IDs and isolated account; repeated subjects or customer names are not unique identity.

After two failures of the same operation, classify the evidence: wrong target, stale state, ambiguous selector, missing authentication, unsupported API or environment failure. Change the relevant approach once or report that operation's precise blocker. Preserve independent progress; restarting the whole task, opening more profiles, and repeating the same command are not recovery.

Verify the requested outcome after the action: destination state, saved record after reload, or the complete capture. Record the tested environment and limit claims to observed evidence. Keep credentials, customer cookies and unrelated tabs out of artifacts.
