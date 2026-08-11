/** Return successes for one die under the roll mode and die category. */
export function dieSuccesses(mode, result, category = "") {
  const value = Number(result);
  if (!Number.isFinite(value)) return 0;
  if (mode === "step" || category === "artifact") {
    if (value >= 10) return 2;
    return value >= 6 ? 1 : 0;
  }
  return value === 6 ? 1 : 0;
}

/** Count a stored roll state, ignoring ammunition successes by default. */
export function countStateSuccesses(state, { exclude = ["ammo"] } = {}) {
  const excluded = new Set(exclude);
  return Math.max(0, Math.trunc(Number(state?.automaticSuccesses) || 0))
    + (state?.dice ?? []).reduce((total, die) => (
    total + (excluded.has(die.category) ? 0 : dieSuccesses(state.mode, die.result, die.category))
  ), 0);
}
