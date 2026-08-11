import { CONSUMABLE_MODES, SYSTEM_ID } from "./constants.mjs";
import { rollConsumableSupply } from "./equipment.mjs";
import { rollPoisonExposure, rollSicknessExposure } from "./environmental-hazards.mjs";
import { clearEnvironmentalHazard } from "./hazard-state.mjs";
import { getConsumableMode } from "./settings.mjs";

export const FOOD_TYPES = Object.freeze(["none", "prepared", "plants", "meat", "fish"]);
export const FOOD_STATES = Object.freeze(["safe", "raw", "unsafe"]);

function escape(value) {
  return foundry.utils.escapeHTML(String(value));
}

function whole(value) {
  const number = Math.trunc(Number(value));
  return Number.isFinite(number) ? Math.max(0, number) : 0;
}

function canUpdate(actor) {
  return Boolean(actor) && (actor.isOwner !== false || game.user?.isGM === true);
}

function amountField() {
  return getConsumableMode() === CONSUMABLE_MODES.SUPPLY ? "supply" : "quantity";
}

export function foodItemAmount(item) {
  return item?.type === "consumable" ? whole(item.system?.[amountField()]) : 0;
}

export function isFoodItem(item) {
  return item?.type === "consumable" && FOOD_TYPES.includes(item.system?.foodType)
    && item.system.foodType !== "none";
}

export function foodRisk(item) {
  if (!isFoodItem(item) || item.system.foodState === "safe") return null;
  return item.system.foodType === "plants"
    ? { poolRating: 3, stepRating: 1 }
    : { poolRating: 6, stepRating: 2 };
}

export function foodStatusLabel(item) {
  if (!isFoodItem(item)) return "";
  return game.i18n.format("YZE.Food.Status", {
    type: game.i18n.localize(`YZE.Food.Types.${item.system.foodType}`),
    state: game.i18n.localize(`YZE.Food.States.${item.system.foodState}`)
  });
}

function provisionName(type, state) {
  if (type === "prepared") return game.i18n.localize("YZE.Food.PreparedFood");
  const key = state === "raw" ? "YZE.Food.RawName"
    : state === "safe" ? "YZE.Food.CookedName"
      : "YZE.Food.UnsafeName";
  return game.i18n.format(key, {
    type: game.i18n.localize(`YZE.Food.Types.${type}`)
  });
}

async function setItemAmount(item, amount) {
  const field = amountField();
  const value = whole(amount);
  await item.update({
    [`system.${field}`]: value,
    ...(field === "quantity" ? { "system.equipped": value > 0 && item.system.equipped === true } : {})
  });
}

/** Add raw, cooked, or unsafe rations to a matching embedded Consumable. */
export async function addFood(actor, { type, state = "raw", amount = 1 } = {}) {
  if (!canUpdate(actor) || !FOOD_TYPES.includes(type) || type === "none") return null;
  const gained = whole(amount);
  if (gained < 1) return null;
  let item = actor.items.find((candidate) => isFoodItem(candidate)
    && candidate.system.foodType === type && candidate.system.foodState === state);
  if (!item) {
    const field = amountField();
    [item] = await actor.createEmbeddedDocuments("Item", [{
      name: provisionName(type, state),
      type: "consumable",
      img: "icons/consumables/food/bowl-stew-brown.webp",
      system: {
        quantity: field === "quantity" ? 0 : 1,
        weight: 0.25,
        equipped: false,
        supply: 0,
        foodType: type,
        foodState: state,
        description: `<p>${escape(game.i18n.localize("YZE.Food.GeneratedDescription"))}</p>`
      }
    }]);
  }
  await setItemAmount(item, foodItemAmount(item) + gained);
  return item;
}

/** Increase a selected Consumable, creating the named fallback when none was selected. */
export async function addConsumableAmount(actor, itemId, amount, fallbackName) {
  if (!canUpdate(actor) || whole(amount) < 1) return null;
  let item = actor.items.get(itemId);
  if (item?.type !== "consumable") {
    item = actor.items.find((candidate) => candidate.type === "consumable"
      && candidate.name.localeCompare(fallbackName, undefined, { sensitivity: "base" }) === 0);
  }
  if (!item) {
    const field = amountField();
    [item] = await actor.createEmbeddedDocuments("Item", [{
      name: fallbackName,
      type: "consumable",
      img: "icons/consumables/drinks/water-jug.webp",
      system: {
        quantity: field === "quantity" ? 0 : 1,
        weight: 1,
        equipped: false,
        supply: 0,
        foodType: "none",
        foodState: "safe",
        description: ""
      }
    }]);
  }
  await setItemAmount(item, foodItemAmount(item) + whole(amount));
  return item;
}

/** Convert up to twelve raw rations into safe or badly cooked food. */
export async function applyCookingOutcome(actor, itemId, requestedAmount, successes) {
  const source = actor?.items?.get(itemId);
  if (!canUpdate(actor) || !isFoodItem(source) || source.system.foodState !== "raw") return false;
  const amount = Math.min(12, whole(requestedAmount), foodItemAmount(source));
  if (amount < 1) {
    ui.notifications.warn(game.i18n.localize("YZE.Food.NoneAvailable"));
    return false;
  }
  const state = Number(successes) > 0 ? "safe" : "unsafe";
  const cooked = await addFood(actor, { type: source.system.foodType, state, amount });
  if (!cooked) return false;
  await setItemAmount(source, foodItemAmount(source) - amount);
  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    content: `<div class="yze chat-card yze-food-card"><p>${escape(game.i18n.format(
      state === "safe" ? "YZE.Food.CookedSafely" : "YZE.Food.CookedUnsafely",
      { actor: actor.name, amount, food: cooked.name }
    ))}</p></div>`
  });
  return true;
}

/** Consume one ration or make a Supply roll, clear starvation, and resolve contamination. */
export async function consumeFood(actor, itemId) {
  const item = actor?.items?.get(itemId);
  if (!canUpdate(actor) || !isFoodItem(item)) return null;
  if (foodItemAmount(item) < 1) {
    ui.notifications.warn(game.i18n.format("YZE.Food.Empty", { food: item.name }));
    return null;
  }

  if (getConsumableMode() === CONSUMABLE_MODES.SUPPLY) {
    if (!await rollConsumableSupply(actor, item.id)) return null;
  } else {
    await setItemAmount(item, foodItemAmount(item) - 1);
  }
  await clearEnvironmentalHazard(actor, "starvation");
  await actor.setFlag(SYSTEM_ID, "lastMealAt", Number(game.time?.worldTime) || 0);
  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    content: `<div class="yze chat-card yze-food-card"><p>${escape(game.i18n.format("YZE.Food.Consumed", {
      actor: actor.name,
      food: item.name
    }))}</p></div>`
  });

  const magicalPoison = item.getFlag(SYSTEM_ID, "poison");
  if (magicalPoison) {
    return rollPoisonExposure(actor, {
      poolRating: whole(magicalPoison.toxicityPool) || 3,
      stepRating: whole(magicalPoison.toxicityStep) || 1,
      effect: magicalPoison.effect || "lethal"
    });
  }
  const risk = foodRisk(item);
  if (!risk) return true;
  return rollSicknessExposure(actor, {
    ...risk,
    name: game.i18n.localize("YZE.Food.FoodPoisoning")
  });
}
