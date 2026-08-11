import {
  CONSUMABLE_MODES,
  ENCUMBRANCE_MODES,
  getStepRating
} from "./constants.mjs";
import {
  getConsumableMode,
  getEncumbranceMode,
  isStepDiceEnabled
} from "./settings.mjs";
import { specialtyDerivedBonuses } from "./specialties.mjs";

const CARRYABLE_TYPES = Object.freeze(["gear", "weapon", "armor", "consumable"]);

function nonNegative(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, number) : 0;
}

function itemLoad(item, consumableMode) {
  // The SRD Backpack expands capacity but does not itself consume capacity.
  if (item.type === "gear" && item.system.isBackpack === true) return 0;
  if (item.type === "consumable" && consumableMode === CONSUMABLE_MODES.SUPPLY) {
    return 1;
  }
  return nonNegative(item.system.weight) * Math.trunc(nonNegative(item.system.quantity));
}

export function activeBackpack(actor) {
  return actor?.items?.find((item) => (
    item.type === "gear"
    && item.system.isBackpack === true
    && item.system.equipped === true
    && Number(item.system.quantity) > 0
  )) ?? null;
}

function carryLimit(actor) {
  if (actor?.type === "mount") return nonNegative(actor.system?.carryCapacity);
  const strength = actor?.system?.attributes?.strength;
  if (!strength) return 0;
  const base = isStepDiceEnabled()
    ? getStepRating(strength.stepRating).faces
    : Math.max(0, Math.trunc(Number(strength.value) || 0) * 2);
  return Math.max(0, base + specialtyDerivedBonuses(actor).carry);
}

/** The carried Backpack doubles capacity and penalizes Mobility by two dice. */
export function backpackMobilityModifier(actor, skillName) {
  if (getEncumbranceMode() === ENCUMBRANCE_MODES.DISABLED) {
    return { value: 0, sources: [] };
  }
  const backpack = activeBackpack(actor);
  if (!backpack || String(skillName ?? "").localeCompare("Mobility", undefined, {
    sensitivity: "base"
  }) !== 0) return { value: 0, sources: [] };
  return {
    value: -2,
    sources: [{
      name: game.i18n.format("YZE.Encumbrance.BackpackModifier", { backpack: backpack.name }),
      value: -2
    }]
  };
}

/** Calculate current carried load under the world's selected SRD encumbrance variant. */
export function actorEncumbrance(actor) {
  const mode = getEncumbranceMode();
  if (mode === ENCUMBRANCE_MODES.DISABLED || !actor || actor.type === "vehicle") {
    return { enabled: false, mode, load: 0, limit: 0, overLimit: false, excluded: [] };
  }

  const items = actor.items?.filter((item) => CARRYABLE_TYPES.includes(item.type)) ?? [];
  const excluded = [];
  const consumableMode = getConsumableMode();
  const freeWeapons = mode === ENCUMBRANCE_MODES.WEAPONS_AT_HAND
    ? items
      .filter((item) => item.type === "weapon" && item.system.equipped)
      .filter((item) => itemLoad(item, consumableMode) > 0)
      .slice(0, 3)
    : [];
  const freeWeaponIds = new Set(freeWeapons.map((item) => item.id));
  let load = 0;

  for (const item of items) {
    const loadValue = itemLoad(item, consumableMode);
    const excludedByVariant = mode === ENCUMBRANCE_MODES.WEAPONS_AT_HAND
      && loadValue > 0
      && ((item.type === "armor" && item.system.equipped) || freeWeaponIds.has(item.id));
    if (excludedByVariant) {
      excluded.push(item.name);
      continue;
    }
    load += loadValue;
  }

  const backpack = activeBackpack(actor);
  const baseLimit = carryLimit(actor);
  const limit = backpack ? baseLimit * 2 : baseLimit;
  return {
    enabled: true,
    mode,
    load,
    loadLabel: Number.isInteger(load) ? String(load) : String(Number(load.toFixed(2))),
    limit,
    overLimit: load > limit,
    backpack: backpack?.name ?? null,
    excluded,
    excludedLabel: excluded.join(", ")
  };
}
