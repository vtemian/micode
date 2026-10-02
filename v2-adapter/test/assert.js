/** Minimal assertions, so the tests stay dependency-free. */
export function check(finding, condition, detail) {
  findings.push({ ok: Boolean(condition), finding, detail: condition ? undefined : detail });
}

export const findings = [];

export function report() {
  const failed = findings.filter((f) => !f.ok);
  for (const f of findings) {
    console.log(`${f.ok ? "ok  " : "FAIL"}  ${f.finding}${f.detail ? ` (${f.detail})` : ""}`);
  }
  console.log(`\n${findings.length - failed.length}/${findings.length} passed`);
  process.exitCode = failed.length === 0 ? 0 : 1;
}
