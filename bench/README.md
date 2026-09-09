# Accepted-result benchmark measurements

Evaluate recorded task trials without launching models:

```powershell
bun bench/runner.ts recorded-trials.json
```

The input contains `trials` and either `requests` or `requestFile` (the shared request JSONL). See `Trial` in evaluation.ts for the typed record: task and route identity, session IDs, start/end times, acceptance, verification command/exit/artifact, and prompting/execution/watching/handoff/review/retry phases. Missing observations remain unavailable.

Accepted results require successful verification artifacts. Rejected and unjudged trials remain in totals. Parent trials include worker requests recursively, with overlap rejected rather than double-counted. Rates, normalized tokens, cache counts, latency and API-equivalent valuation use the same calculation layer as usage_status and /usage. Actual charges remain separate. Report total time and cost per accepted result; throughput alone does not establish task suitability.

The old launcher used guessed cache prices, a separate database calculation, unbudgeted inference and destructive workspace cleanup. It is retired. Existing results and workspaces are preserved as historical evidence; their old estimated prices are not promoted into calibrated routing evidence. No live benchmark is authorized by running this evaluator. Collect ordinary task measurements first; any later live sweep needs explicit routes and a user-provided budget.
