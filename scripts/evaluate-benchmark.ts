import {measuredOutcomeRoutes} from "../models/measured-outcomes"
import { readFileSync } from "node:fs"
import { evaluateTrials } from "../usage/benchmark-evaluation"
import { readRequests } from "../usage/telemetry-store"
const file=process.argv[2];if(!file)throw new Error("Usage: bun scripts/evaluate-benchmark.ts <recorded-trials.json>")
const input=JSON.parse(readFileSync(file,"utf8"));const requests=input.requests??readRequests(input.requestFile).records;console.log(JSON.stringify(input.routes?measuredOutcomeRoutes(input.routes,{...input,requests}):evaluateTrials(input.trials,requests),null,2))
