// The exact "generic" prompt template LiveCodeBench's own harness uses for stdio problems
// (observed directly, lcb_runner/prompts/code_generation.py: get_generic_question_template_answer
// + PromptConstants.SYSTEM_MESSAGE_GENERIC / FORMATTING_WITHOUT_STARTER_CODE), reproduced here so
// every model in this run is scored against the same prompt the published leaderboard numbers use.
import type { LiveCodeBenchTask } from "./decode-tests";

const SYSTEM_MESSAGE_GENERIC =
  "You are an expert Python programmer. You will be given a question (problem specification) and will generate a correct Python program that matches the specification and passes all tests.";

const FORMATTING_WITHOUT_STARTER_CODE =
  "Read the inputs from stdin solve the problem and write the answer to stdout (do not directly test on the sample inputs). Enclose your code within delimiters as follows. Ensure that when the python program runs, it reads the inputs, runs the algorithm and writes output to STDOUT.";

export function buildPrompt(task: LiveCodeBenchTask): string {
  let prompt = `${SYSTEM_MESSAGE_GENERIC}\n\n`;
  prompt += `### Question:\n${task.question_content}\n\n`;
  prompt += `### Format: ${FORMATTING_WITHOUT_STARTER_CODE}\n`;
  prompt += "```python\n# YOUR CODE HERE\n```\n\n";
  prompt += "### Answer: (use the provided format with backticks)\n\n";
  return prompt;
}
