type HighCostAuthEnvironment = Readonly<Record<string, string | undefined>>;

/**
 * High-cost guest access is fail-safe by default. Only an explicit `false`
 * disables the paper-host login gate for a deployment window.
 */
export function paperHostHighCostAuthRequired(
  env: HighCostAuthEnvironment = process.env,
): boolean {
  return env.PAPER_HOST_REQUIRE_HIGH_COST_AUTH?.trim().toLowerCase() !== 'false';
}
