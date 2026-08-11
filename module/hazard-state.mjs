import { SYSTEM_ID } from "./constants.mjs";

export const HAZARD_FLAG = "environmentalHazards";

export function environmentalHazards(actor) {
  const state = actor?.getFlag?.(SYSTEM_ID, HAZARD_FLAG);
  return foundry.utils.deepClone(state && typeof state === "object" ? state : {});
}

export async function updateEnvironmentalHazards(actor, changes = {}) {
  if (!actor?.setFlag || (!game.user?.isGM && actor.isOwner === false)) return false;
  const current = environmentalHazards(actor);
  const next = foundry.utils.mergeObject(current, changes, {
    inplace: false,
    insertKeys: true,
    insertValues: true,
    overwrite: true
  });
  await actor.setFlag(SYSTEM_ID, HAZARD_FLAG, next);
  return next;
}

export async function clearEnvironmentalHazard(actor, key) {
  const current = environmentalHazards(actor);
  if (!Object.hasOwn(current, key)) return false;
  delete current[key];
  await actor.setFlag(SYSTEM_ID, HAZARD_FLAG, current);
  return true;
}

/** Natural recovery restrictions imposed by persistent SRD hazards. */
export function environmentalRecoveryRestrictions(actor) {
  const hazards = environmentalHazards(actor);
  const cold = hazards.cold?.active === true;
  const magicEffects = actor?.getFlag?.(SYSTEM_ID, "magicEffects");
  const sleepless = Array.isArray(magicEffects)
    && magicEffects.some((effect) => effect.kind === "sleepless");
  const bloodCursed = Array.isArray(magicEffects)
    && magicEffects.some((effect) => effect.kind === "blood-curse");
  return {
    physical: !(bloodCursed || cold || hazards.disease?.active === true || hazards.starvation?.active === true),
    mental: !(bloodCursed || cold || hazards.sleepDeprivation?.active === true || sleepless),
    stress: !(bloodCursed || cold || hazards.sleepDeprivation?.active === true || sleepless)
  };
}
