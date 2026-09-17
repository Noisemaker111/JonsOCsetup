// Route table for the benchmark runner: which CLI invocation reaches which model.
// This is a bench-only lookup, not production routing. No production file imports this.
// A user adds a new route here (or on the command line, see run.ts --route) the same way any
// other model becomes selectable for this tool: nothing in quest/, usage/, or scripts/ reads it.
//
// Only OpenCode Go (v2) routes: Jon decided only the v2 host matters for this benchmark.

export type RouteKind = "go-v2";

export interface Route {
  id: string; // stable short name used in result files
  kind: RouteKind;
  model: string; // the -m argument
  reasoningEffort?: string; // appended as #<effort> to the -m argument when set
  label: string; // human label for reports
}

export const ROUTES: Route[] = [
  { id: "union-alpha-go", kind: "go-v2", model: "opencode-go/union-alpha", label: "Union Alpha (opencode-go)" },
  {
    id: "deepseek-v4.1-flash-high",
    kind: "go-v2",
    model: "opencode-go/deepseek-v4.1-flash",
    reasoningEffort: "high",
    label: "DeepSeek v4.1 Flash #high",
  },
  { id: "kimi-k3", kind: "go-v2", model: "opencode-go/kimi-k3", label: "Kimi K3" },
  { id: "glm-5.3", kind: "go-v2", model: "opencode-go/glm-5.3", label: "GLM 5.3" },
  { id: "qwen3.8-max", kind: "go-v2", model: "opencode-go/qwen3.8-max", label: "Qwen3.8 Max" },
];

export function findRoute(id: string): Route {
  const route = ROUTES.find((r) => r.id === id);
  if (!route) {
    throw new Error(`unknown route id "${id}"; known ids: ${ROUTES.map((r) => r.id).join(", ")}`);
  }
  return route;
}
