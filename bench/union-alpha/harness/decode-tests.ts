// Read a LiveCodeBench task record's test cases. private_test_cases is resolved to plain JSON by
// decode-private-tests.py at cache time (the original field is base64+zlib+pickle for most
// records — resolved once, offline, in Python; see that script for why). Falls back to
// public-only when private cases are absent (empty array) or fail to decode, and the run records
// which source was used per task.

export interface TestCase {
  input: string;
  output: string;
  testtype: "stdin" | "functional";
}

export interface LiveCodeBenchTask {
  question_title: string;
  question_content: string;
  platform: string;
  question_id: string;
  difficulty: string;
  contest_date: string;
  starter_code: string;
  public_test_cases: string;
  private_test_cases: string;
  metadata: string;
}

export interface DecodedTask {
  task: LiveCodeBenchTask;
  cases: TestCase[];
  caseSource: "private" | "public-only";
  isFunctional: boolean;
  funcName?: string;
}

export function decodeTask(task: LiveCodeBenchTask): DecodedTask {
  const publicCases: TestCase[] = JSON.parse(task.public_test_cases);
  let cases = publicCases;
  let caseSource: "private" | "public-only" = "public-only";

  try {
    const privateCases: TestCase[] = JSON.parse(task.private_test_cases);
    if (Array.isArray(privateCases) && privateCases.length > 0) {
      cases = privateCases;
      caseSource = "private";
    }
  } catch {
    // fall back to public-only; recorded via caseSource
  }

  const metadata = task.metadata ? JSON.parse(task.metadata) : {};
  const isFunctional = Boolean(task.starter_code) || Boolean(metadata.func_name);

  return { task, cases, caseSource, isFunctional, funcName: metadata.func_name };
}
