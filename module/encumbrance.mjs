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
import { carryCapacityMultiplierEffects } from "./item-effects.mjs";

const CARRYABLE_TYPES = Object.freeze(["gear", "weapon", "armor", "consumable"]);

function nonNegative(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, number) : 0;
}

function itemLoad(item, consumableMode) {
  if (item.type === "consumable" && consumableMode === CONSUMABLE_MODES.SUPPLY) {
    return 1;
  }
  return nonNegative(item.system.weight) * Math.trunc(nonNegative(item.system.quantity));
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

  const baseLimit = carryLimit(actor);
  const capacityEffects = carryCapacityMultiplierEffects(actor);
  const capacityMultiplier = capacityEffects.reduce((total, effect) => (
    total * Math.max(1, Math.trunc(Number(effect.value) || 1))
  ), 1);
  const limit = Math.max(0, baseLimit * capacityMultiplier);
  const capacityEffectsLabel = capacityEffects.map((effect) => (
    game.i18n.format("YZE.Encumbrance.CapacityMultiplierSource", {
      item: effect.item.name,
      multiplier: Math.max(1, Math.trunc(Number(effect.value) || 1))
    })
  )).join(", ");
  return {
    enabled: true,
    mode,
    load,
    loadLabel: Number.isInteger(load) ? String(load) : String(Number(load.toFixed(2))),
    limit,
    overLimit: load > limit,
    capacityEffects,
    capacityEffectsLabel,
    excluded,
    excludedLabel: excluded.join(", ")
  };
}
