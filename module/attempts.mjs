import { SYSTEM_ID } from "./constants.mjs";

const ATTEMPT_FLAG = "oneAttemptLocks";

function normalizeGoal(value) {
  return String(value ?? "")
    .trim()
    .replace(/\s+/g, " ")
    .toLocaleLowerCase();
}

export function attemptLocks(actor) {
  const stored = actor?.getFlag?.(SYSTEM_ID, ATTEMPT_FLAG);
  if (!Array.isArray(stored)) return [];
  return stored
    .filter((entry) => entry && normalizeGoal(entry.goal))
    .map((entry) => ({ ...entry, key: normalizeGoal(entry.goal) }));
}

export function findAttemptLock(actor, goal) {
  const key = normalizeGoal(goal);
  if (!key) return null;
  return attemptLocks(actor).find((entry) => entry.key === key) ?? null;
}

export async function recordAttemptLock(actor, { goal, rollLabel, messageId = null } = {}) {
  const normalized = normalizeGoal(goal);
  const label = String(goal ?? "").trim().replace(/\s+/g, " ");
  if (!actor || !normalized || findAttemptLock(actor, normalized)) return null;
  const entry = {
    id: foundry.utils.randomID(),
    goal: label,
    rollLabel: String(rollLabel ?? ""),
    messageId,
    userId: game.user?.id ?? null,
    createdAt: Date.now()
  };
  const current = attemptLocks(actor).map(({ key: _key, ...stored }) => stored);
  await actor.setFlag(SYSTEM_ID, ATTEMPT_FLAG, [...current, entry]);
  return entry;
}

export async function clearAttemptLock(actor, id) {
  if (!game.user?.isGM || !actor) return false;
  const next = attemptLocks(actor)
    .filter((entry) => entry.id !== id)
    .map(({ key: _key, ...stored }) => stored);
  if (next.length === 0) await actor.unsetFlag(SYSTEM_ID, ATTEMPT_FLAG);
  else await actor.setFlag(SYSTEM_ID, ATTEMPT_FLAG, next);
  return true;
}

export async function clearAllAttemptLocks(actor) {
  if (!game.user?.isGM || !actor) return false;
  await actor.unsetFlag(SYSTEM_ID, ATTEMPT_FLAG);
  return true;
}
