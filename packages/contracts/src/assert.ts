/**
 * Runtime guard: throws if `implementation` doesn't expose every method a
 * contract requires. TS interfaces are erased at compile time, so anything wired
 * up dynamically (an addon resolved by name, a stack choice picked at `forja new`
 * time) still needs a runtime check — this is that check. It makes the registries
 * / addon loader fail fast and loudly at boot, not with a silent undefined-is-not-
 * a-function deep inside a request.
 */
export function assertImplements(
  contractName: string,
  implementation: Record<string, unknown> | null | undefined,
  methods: readonly string[]
): void {
  const missing = methods.filter((method) => typeof implementation?.[method] !== "function");

  if (missing.length > 0) {
    throw new Error(
      `"${contractName}" contract violation: missing method(s) ${missing.join(", ")}`
    );
  }
}
