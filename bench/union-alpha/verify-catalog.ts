// Re-check the live provider listings recorded in bench/union-alpha/catalog.md.
// Run: bun bench/union-alpha/verify-catalog.ts
// Writes bench/union-alpha/evidence/verify-output.txt and exits non-zero on any mismatch.

const lines: string[] = [];
let failures = 0;

function log(line: string) {
  lines.push(line);
  console.log(line);
}

function expect(ok: boolean, label: string, actual?: unknown) {
  log(`${ok ? "OK  " : "FAIL"} ${label}${ok ? "" : ` (actual: ${JSON.stringify(actual)})`}`);
  if (!ok) failures += 1;
}

log(`catalog verification - ${new Date().toISOString()} - bun ${Bun.version}`);

try {
  const openRouter = (await (await fetch("https://openrouter.ai/api/v1/models")).json()) as {
    data?: Array<Record<string, any>>;
  };
  const union = openRouter.data?.find((model) => model.id === "stealth/union-alpha");
  expect(Boolean(union), "openrouter lists id stealth/union-alpha");
  if (union) {
    expect(union.name === "Union Alpha", "openrouter name Union Alpha", union.name);
    expect(union.context_length === 262144, "openrouter context_length 262144", union.context_length);
    expect(
      union.top_provider?.max_completion_tokens === 131072,
      "openrouter max_completion_tokens 131072",
      union.top_provider?.max_completion_tokens,
    );
    expect(
      union.pricing?.prompt === "0" && union.pricing?.completion === "0",
      "openrouter prompt/completion price 0/0",
      union.pricing,
    );
  }

  const zen = (await (await fetch("https://opencode.ai/zen/v1/models")).json()) as {
    data?: Array<{ id?: string }>;
  };
  expect(
    Boolean(zen.data?.find((model) => model.id === "union-alpha")),
    "zen lists id union-alpha",
  );
} catch (error) {
  expect(false, `provider fetch or parse failed: ${String(error)}`);
}

log(`result=${failures === 0 ? "PASS" : `FAIL (${failures})`}`);
await Bun.write(new URL("./evidence/verify-output.txt", import.meta.url), lines.join("\n") + "\n");
process.exit(failures === 0 ? 0 : 1);
