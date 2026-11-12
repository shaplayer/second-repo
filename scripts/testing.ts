/** A very small test runner: named checks, a count at the end, a non-zero exit when any fail. */

let passed = 0;
const failures: { name: string; error: unknown }[] = [];

export async function test(name: string, fn: () => void | Promise<void>): Promise<void> {
  try {
    await fn();
    passed++;
    console.log(`  ok    ${name}`);
  } catch (error) {
    failures.push({ name, error });
    console.log(`  FAIL  ${name}`);
    console.log(`        ${(error as Error)?.message ?? error}`.split("\n").slice(0, 12).join("\n        "));
  }
}

/** Prints the totals and returns true when everything passed. */
export function finish(label: string): boolean {
  console.log(`${label}: ${passed} passed, ${failures.length} failed`);
  return failures.length === 0;
}
