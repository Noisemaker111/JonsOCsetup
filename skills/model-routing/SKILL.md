---
name: model-routing
description: Use when selecting or diagnosing a worker model or account route. Apply the user's configured policy; do not assume a preferred provider or payment method.
---

# Model routing

This skill applies across projects. It is hand-maintained policy guidance,
not a generated model catalog. Model inventory refresh must not overwrite it.

- Honor the user's explicit model and account choice. A fixed paid API route, subscription route or free-only configuration is valid. Automatic selection is optional.
- Use only routes allowed by the user's configuration. Credentials and catalog availability alone are not permission to select a route or spend from another account.
- Fallbacks require a configured policy. Without one, report the selected route's error. Do not silently switch provider, model or payment method.
- Read available runtime tools for route availability and usage_status for current quota/reset information. Missing prices or entitlement information are unknown, not free or available. Do not run config-repository scripts from an unrelated project.
- When the user enables capacity-aware routing, preserve their configured reserve for demanding work and distribute suitable steps across allowed routes using live capacity and task evidence. Cheapest-first is not the objective. Use deterministic runtime execution for known commands and waiting; delegate bounded work only when handoff and verification costs make it worthwhile. Do not promise equal quality or speedups without measurements.
- Keep price, quota and model-capability facts out of this skill. Evaluate task suitability using available evidence and explain uncertainty; do not assume a universal IQ ranking or a branded default.
- Use exact provider/model and recorded reasoning/thinking level in worker reports. Say unknown when unknown. Never label a plain/default variant fast; fast requires a recorded fast variant. Prefer session links over raw ses_ IDs and do not duplicate metadata already visible in the terminal.
- Runtime restrictions can still reject an authorized choice. Report that limitation without inventing a substitute or claiming that the user's payment preference is invalid.

When maintaining the config repository, see docs/account-aware-routing.md for
the planner's integration status and docs/quest-cleanup-review.md for the
user-owned routing design. Neither document proves that planned routing is live.
