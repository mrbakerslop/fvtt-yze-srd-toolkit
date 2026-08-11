import {
  ATTRIBUTE_GROUPS,
  ATTRIBUTE_KEYS,
  CONDITIONS,
  DICE_SYSTEMS,
  HARM_MODELS,
  SYSTEM_ID,
  getStepRating
} from "./constants.mjs";
import {
  formatStepRatingLabel,
  getAttributeLabels,
  getDiceSystem,
  getHarmModel
} from "./settings.mjs";
import { beginAerialCrash, rollVehicleCriticalDamage } from "./vehicles.mjs";
import { environmentalRecoveryRestrictions } from "./hazard-state.mjs";

const NO_ARMOR = "none";
const VEHICLE_ARMOR = "vehicle";
const MAGIC_ARMOR_PREFIX = "magic:";

function escape(value) {
  return foundry.utils.escapeHTML(String(value));
}

export function canUpdateActor(actor) {
  return Boolean(actor) && (actor.isOwner !== false || game.user?.isGM === true);
}

function wholeNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.trunc(number)) : 0;
}

function stepLabel(value) {
  return formatStepRatingLabel(value, { none: "—" });
}

function armorFields() {
  return getDiceSystem() === DICE_SYSTEMS.STEP
    ? { current: "stepRating", maximum: "maxStepRating" }
    : { current: "rating", maximum: "maxRating" };
}

function vehicleArmorFields() {
  return getDiceSystem() === DICE_SYSTEMS.STEP
    ? { current: "armorStepRating", maximum: "armorStepMax" }
    : { current: "armor", maximum: "armorMax" };
}

function armorRatingLabel(rating) {
  return getDiceSystem() === DICE_SYSTEMS.STEP ? stepLabel(rating) : String(rating);
}

export function availableArmor(actor) {
  if (actor?.type === "mount") {
    const step = getDiceSystem() === DICE_SYSTEMS.STEP;
    const rating = wholeNumber(step ? actor.system?.armorStepRating : actor.system?.armor);
    return rating > 0 ? [{
      id: VEHICLE_ARMOR,
      name: actor.name,
      rating,
      label: game.i18n.format("YZE.Armor.VehicleArmorOption", {
        rating: armorRatingLabel(rating)
      })
    }] : [];
  }
  if (actor?.type === "vehicle") {
    const fields = vehicleArmorFields();
    const rating = wholeNumber(actor.system?.[fields.current]);
    return rating > 0 ? [{
      id: VEHICLE_ARMOR,
      name: actor.name,
      rating,
      label: game.i18n.format("YZE.Armor.VehicleArmorOption", {
        rating: armorRatingLabel(rating)
      })
    }] : [];
  }

  const fields = armorFields();
  const worn = actor?.items
    ?.filter((item) => (
      item.type === "armor"
      && item.system.equipped === true
      && wholeNumber(item.system.quantity) > 0
    ))
    .map((item) => ({
      id: item.id,
      name: item.name,
      rating: wholeNumber(item.system?.[fields.current]),
      label: game.i18n.format("YZE.Armor.ArmorOption", {
        armor: item.name,
        rating: armorRatingLabel(wholeNumber(item.system?.[fields.current]))
      })
    }))
    .filter((armor) => armor.rating > 0) ?? [];
  const step = getDiceSystem() === DICE_SYSTEMS.STEP;
  const magic = (actor?.getFlag?.(SYSTEM_ID, "magicEffects") ?? [])
    .map((effect) => ({
      id: `${MAGIC_ARMOR_PREFIX}${effect.id}`,
      name: effect.name,
      rating: wholeNumber(step ? effect.armorStep : effect.armor),
      label: game.i18n.format("YZE.Armor.ArmorOption", {
        armor: effect.name,
        rating: armorRatingLabel(wholeNumber(step ? effect.armorStep : effect.armor))
      })
    }))
    .filter((armor) => armor.rating > 0);
  return [...worn, ...magic];
}

export function countArmorResults(results = [], { stepDice = false } = {}) {
  return results.reduce((summary, entry) => {
    const result = Number(entry);
    if (!Number.isFinite(result)) return summary;
    if (result === 1) summary.banes += 1;
    if (stepDice) {
      summary.successes += result >= 10 ? 2 : result >= 6 ? 1 : 0;
    } else if (result === 6) {
      summary.successes += 1;
    }
    return summary;
  }, { successes: 0, banes: 0 });
}

function armorSource(actor, armorId) {
  if (String(armorId).startsWith(MAGIC_ARMOR_PREFIX)) {
    const id = String(armorId).slice(MAGIC_ARMOR_PREFIX.length);
    const effect = (actor?.getFlag?.(SYSTEM_ID, "magicEffects") ?? [])
      .find((entry) => entry.id === id);
    const step = getDiceSystem() === DICE_SYSTEMS.STEP;
    const rating = wholeNumber(step ? effect?.armorStep : effect?.armor);
    return effect && rating > 0 ? {
      name: effect.name,
      rating,
      degrades: false,
      update: async () => true
    } : null;
  }
  if (armorId === VEHICLE_ARMOR && actor?.type === "mount") {
    const step = getDiceSystem() === DICE_SYSTEMS.STEP;
    const field = step ? "armorStepRating" : "armor";
    return {
      name: actor.name,
      rating: wholeNumber(actor.system?.[field]),
      degrades: false,
      update: async () => true
    };
  }
  if (armorId === VEHICLE_ARMOR && actor?.type === "vehicle") {
    const fields = vehicleArmorFields();
    return {
      name: actor.name,
      rating: wholeNumber(actor.system?.[fields.current]),
      update: async (value) => actor.update({ [`system.${fields.current}`]: value })
    };
  }

  const item = actor?.items?.get(armorId);
  if (!item || item.type !== "armor" || item.system.equipped !== true
    || wholeNumber(item.system.quantity) < 1) return null;
  const fields = armorFields();
  return {
    name: item.name,
    rating: wholeNumber(item.system?.[fields.current]),
    update: async (value) => item.update({ [`system.${fields.current}`]: value })
  };
}

function activeRollResults(roll) {
  return (roll.dice ?? []).flatMap((die) => die.results ?? [])
    .filter((result) => result.active !== false)
    .map((result) => Number(result.result));
}

export async function rollArmor(actor, incomingDamage, armorId) {
  const damage = wholeNumber(incomingDamage);
  const source = armorSource(actor, armorId);
  if (!source || source.rating < 1 || damage < 1) {
    return {
      incoming: damage,
      absorbed: 0,
      penetrating: damage,
      successes: 0,
      banes: 0,
      degraded: 0,
      armorName: null
    };
  }

  const stepDice = getDiceSystem() === DICE_SYSTEMS.STEP;
  const rating = stepDice ? getStepRating(source.rating) : null;
  const formula = stepDice ? `2d${rating.faces}` : `${source.rating}d6`;
  const roll = await new Roll(formula).evaluate();
  const summary = countArmorResults(activeRollResults(roll), { stepDice });
  const absorbed = Math.min(damage, summary.successes);
  const penetrating = Math.max(0, damage - absorbed);
  const degraded = penetrating > 0 && source.degrades !== false
    ? Math.min(source.rating, summary.banes)
    : 0;
  const nextRating = source.rating - degraded;
  if (degraded > 0) await source.update(nextRating);

  const result = game.i18n.format("YZE.Armor.RollResult", {
    armor: source.name,
    absorbed,
    incoming: damage,
    penetrating,
    banes: summary.banes
  });
  const degradation = degraded > 0
    ? `<p class="yze-armor-degradation">${escape(game.i18n.format("YZE.Armor.Degraded", {
      armor: source.name,
      amount: degraded,
      rating: armorRatingLabel(nextRating)
    }))}</p>`
    : penetrating === 0 && summary.banes > 0
      ? `<p class="hint">${escape(game.i18n.localize("YZE.Armor.BanesIgnored"))}</p>`
      : "";
  await roll.toMessage({
    speaker: ChatMessage.getSpeaker({ actor }),
    flavor: `
      <div class="yze chat-card yze-armor-card">
        <h3>${escape(game.i18n.format("YZE.Armor.RollTitle", { actor: actor.name }))}</h3>
        <p>${escape(result)}</p>
        ${degradation}
      </div>`
  });

  return {
    incoming: damage,
    absorbed,
    penetrating,
    successes: summary.successes,
    banes: summary.banes,
    degraded,
    armorName: source.name
  };
}

export function activeCover(actor) {
  const cover = actor?.system?.combat?.cover;
  const stepDice = getDiceSystem() === DICE_SYSTEMS.STEP;
  if (!cover?.active) {
    const vehicle = game.actors?.find((entry) => entry.type === "vehicle"
      && (entry.system.driverUuid === actor?.uuid || (entry.system.occupantUuids ?? []).includes(actor?.uuid)));
    if (!vehicle) return null;
    const vehicleField = stepDice ? "armorStepRating" : "armor";
    const vehicleRating = wholeNumber(vehicle.system?.[vehicleField]);
    if (vehicleRating < 1) return null;
    return {
      label: game.i18n.format("YZE.Vehicle.OccupantCover", { vehicle: vehicle.name }),
      rating: vehicleRating,
      field: vehicleField,
      vehicle,
      update: async (value) => vehicle.update({ [`system.${vehicleField}`]: value })
    };
  }
  const field = stepDice ? "stepRating" : "rating";
  const rating = wholeNumber(cover[field]);
  if (rating < 1) return null;
  return {
    label: String(cover.label || game.i18n.localize("YZE.Combat.Cover")),
    rating,
    field,
    update: async (value) => {
      const updates = { [`system.combat.cover.${field}`]: value };
      if (value === 0) updates["system.combat.cover.active"] = false;
      return actor.update(updates);
    }
  };
}

/** Roll the target's current cover before worn armour and degrade it on penetration. */
export async function rollCover(actor, incomingDamage, { useCover = true } = {}) {
  const damage = wholeNumber(incomingDamage);
  const cover = useCover ? activeCover(actor) : null;
  if (!cover || damage < 1) return {
    incoming: damage,
    absorbed: 0,
    penetrating: damage,
    successes: 0,
    banes: 0,
    degraded: 0,
    coverName: null
  };

  const stepDice = getDiceSystem() === DICE_SYSTEMS.STEP;
  const step = stepDice ? getStepRating(cover.rating) : null;
  const roll = await new Roll(stepDice ? `2d${step.faces}` : `${cover.rating}d6`).evaluate();
  const summary = countArmorResults(activeRollResults(roll), { stepDice });
  const absorbed = Math.min(damage, summary.successes);
  const penetrating = Math.max(0, damage - absorbed);
  const degraded = penetrating > 0 ? Math.min(cover.rating, summary.banes) : 0;
  const nextRating = cover.rating - degraded;
  if (degraded > 0) {
    await cover.update(nextRating);
  }

  await roll.toMessage({
    speaker: ChatMessage.getSpeaker({ actor }),
    flavor: `<div class="yze chat-card yze-armor-card">
      <h3>${escape(game.i18n.format("YZE.Cover.RollTitle", { cover: cover.label }))}</h3>
      <p>${escape(game.i18n.format("YZE.Cover.RollResult", {
        cover: cover.label,
        absorbed,
        incoming: damage,
        penetrating,
        banes: summary.banes
      }))}</p>
      ${degraded > 0 ? `<p class="yze-armor-degradation">${escape(game.i18n.format(
        "YZE.Cover.Degraded", { cover: cover.label, amount: degraded, rating: armorRatingLabel(nextRating) }
      ))}</p>` : ""}
    </div>`
  });
  return {
    incoming: damage,
    absorbed,
    penetrating,
    successes: summary.successes,
    banes: summary.banes,
    degraded,
    coverName: cover.label
  };
}

export async function promptProtection(actor, rawDamage, { ranged = false } = {}) {
  const damage = wholeNumber(rawDamage);
  const armor = availableArmor(actor);
  const cover = ranged ? activeCover(actor) : null;
  const options = [
    `<option value="${NO_ARMOR}">${escape(game.i18n.localize("YZE.Armor.NoArmor"))}</option>`,
    ...armor.map((entry) => `<option value="${escape(entry.id)}"${armor.length === 1 ? " selected" : ""}>${escape(entry.label)}</option>`)
  ].join("");
  const { DialogV2 } = foundry.applications.api;
  return DialogV2.wait({
    window: { title: game.i18n.localize("YZE.Armor.ProtectionTitle") },
    content: `
      <div class="yze yze-damage-dialog">
        <p>${escape(game.i18n.format("YZE.Armor.ProtectionHint", {
          actor: actor.name,
          damage
        }))}</p>
        <div class="form-group">
          <label>${escape(game.i18n.localize("YZE.Combat.IncomingDamage"))}</label>
          <input type="number" name="damage" value="${damage}" min="0" max="${damage}" step="1">
        </div>
        ${cover ? `<label class="checkbox-row"><input type="checkbox" name="cover" checked>
          <span>${escape(game.i18n.format("YZE.Cover.Use", {
            cover: cover.label,
            rating: armorRatingLabel(cover.rating)
          }))}</span></label>` : ""}
        <div class="form-group">
          <label>${escape(game.i18n.localize("YZE.Actor.Armor"))}</label>
          <select name="armor">${options}</select>
        </div>
        <p class="hint">${escape(game.i18n.localize("YZE.Armor.ManualProtectionHint"))}</p>
      </div>`,
    buttons: [
      {
        action: "continue",
        label: game.i18n.localize("YZE.Combat.ContinueDamage"),
        icon: "fa-solid fa-shield-halved",
        default: true,
        callback: (event, button, dialog) => {
          const form = button.form ?? dialog.element.querySelector("form");
          const value = Math.trunc(Number(form.elements.damage?.value));
          return {
            damage: Number.isFinite(value) ? Math.min(damage, Math.max(0, value)) : damage,
            armorId: form.elements.armor?.value ?? NO_ARMOR,
            useCover: cover ? form.elements.cover?.checked === true : false
          };
        }
      },
      {
        action: "cancel",
        label: game.i18n.localize("YZE.Common.Cancel"),
        icon: "fa-solid fa-xmark",
        callback: () => null
      }
    ],
    close: () => null,
    rejectClose: false,
    modal: true
  });
}

async function chooseConditions(actor, category, count, { removing = false } = {}) {
  const keys = CONDITIONS[category] ?? [];
  const candidates = keys.filter((key) => (
    removing
      ? actor.system?.conditions?.[key] === true
      : actor.system?.conditions?.[key] !== true
  ));
  const required = Math.min(wholeNumber(count), candidates.length);
  if (required === 0) return [];
  const choices = candidates.map((key) => `
    <label class="checkbox-row">
      <input type="checkbox" name="condition" value="${key}">
      <span>${escape(game.i18n.localize(`YZE.Conditions.${key}`))}</span>
    </label>`).join("");
  const { DialogV2 } = foundry.applications.api;
  const buttons = [{
    action: "apply",
    label: game.i18n.localize(removing ? "YZE.Recovery.ApplyRecovery" : "YZE.Combat.ApplyDamage"),
    icon: removing ? "fa-solid fa-heart-pulse" : "fa-solid fa-heart-crack",
    default: true,
    callback: (event, button, dialog) => {
      const form = button.form ?? dialog.element.querySelector("form");
      return [...form.querySelectorAll('input[name="condition"]:checked')]
        .map((input) => input.value)
        .filter((key) => candidates.includes(key));
    }
  }];
  if (removing) {
    buttons.push({
        action: "cancel",
        label: game.i18n.localize("YZE.Common.Cancel"),
        icon: "fa-solid fa-xmark",
        callback: () => null
    });
  }

  while (true) {
    const selected = await DialogV2.wait({
      window: {
        title: game.i18n.localize(removing
          ? "YZE.Recovery.ChooseRecoveryConditions"
          : "YZE.Combat.ChooseDamageConditions")
      },
      content: `
        <div class="yze yze-damage-dialog">
          <p>${escape(game.i18n.format(
            removing ? "YZE.Recovery.ChooseConditionsHint" : "YZE.Combat.ChooseConditionsHint",
            { actor: actor.name, count: required }
          ))}</p>
          <div class="condition-choices">${choices}</div>
        </div>`,
      buttons,
      close: () => removing ? null : [],
      rejectClose: false,
      modal: true
    });
    if (selected === null) return null;
    const unique = [...new Set(selected)];
    if (unique.length === required) return unique;
    ui.notifications.warn(game.i18n.format("YZE.Combat.SelectConditionsCount", { count: required }));
  }
}

function defaultAttribute(category) {
  return category === "mental" ? "wits" : "strength";
}

export function damageTracks(actor) {
  if (actor?.type === "mount") {
    return [{ value: "health", category: "physical", label: game.i18n.localize("YZE.Actor.Health") }];
  }
  if (actor?.type === "vehicle") {
    return [{ value: "hull", category: "physical", label: game.i18n.localize("YZE.Vehicle.Hull") }];
  }
  const harmModel = getHarmModel();
  if (harmModel === HARM_MODELS.DAMAGE_STRESS) {
    return [
      { value: "physical", category: "physical", label: game.i18n.localize("YZE.Actor.Health") },
      { value: "mental", category: "mental", label: game.i18n.localize("YZE.Actor.Resolve") }
    ];
  }
  if (harmModel === HARM_MODELS.HEALTH_ONLY) {
    return [{ value: "physical", category: "physical", label: game.i18n.localize("YZE.Actor.Health") }];
  }
  if (harmModel === HARM_MODELS.CONDITIONS) {
    return ["physical", "mental"].map((category) => ({
      value: category,
      category,
      label: game.i18n.localize(`YZE.Conditions.${category}.Label`)
    }));
  }
  const labels = getAttributeLabels();
  return ATTRIBUTE_KEYS.map((key) => ({
    value: key,
    attributeKey: key,
    category: ATTRIBUTE_GROUPS[key],
    label: labels[key]
  }));
}

export async function applyDamage(actor, amount, {
  category = "physical",
  attributeKey = null,
  vehicleCriticalFaces = 12,
  sourceActorUuid = null,
  skipCriticalInjury = false,
  environmental = false
} = {}) {
  const damage = wholeNumber(amount);
  if (!actor?.system || !canUpdateActor(actor) || damage < 1) return false;

  if (actor.system?.combat?.overwatch?.active === true) {
    await actor.update({
      "system.combat.overwatch.active": false,
      "system.combat.overwatch.direction": "",
      "system.combat.overwatch.weaponItemId": ""
    });
  }
  if (actor.system?.combat?.aim?.active === true) {
    await actor.update({
      "system.combat.aim.active": false,
      "system.combat.aim.weaponItemId": "",
      "system.combat.aim.preparedRound": 0
    });
  }

  if (actor.type === "vehicle") {
    const current = wholeNumber(actor.system?.hull?.value);
    const maximum = wholeNumber(actor.system?.hull?.max);
    const next = Math.max(0, current - damage);
    await actor.update({
      "system.hull.value": next,
      "system.wrecked": next === 0 || actor.system.destroyed === true
    }, { yzeSkipCriticalInjury: skipCriticalInjury, yzeEnvironmentalDamage: environmental });
    if (!skipCriticalInjury && damage >= Math.ceil(maximum / 2) && maximum > 0) {
      await rollVehicleCriticalDamage(actor, { faces: vehicleCriticalFaces, damage });
    }
    if (actor.system.isAerial === true && current > 0 && next === 0
      && actor.system.destroyed !== true) {
      await beginAerialCrash(actor, { formula: "1d3", reason: "wrecked" });
    }
    return true;
  }

  if (actor.type === "mount") {
    const current = wholeNumber(actor.system?.resources?.health?.value);
    const next = Math.max(0, current - damage);
    await actor.update({
      "system.resources.health.value": next,
      "system.perished": next === 0
    }, { yzeSkipCriticalInjury: true, yzeEnvironmentalDamage: environmental });
    return true;
  }

  const harmModel = getHarmModel();
  if (harmModel === HARM_MODELS.ATTRIBUTE_DAMAGE) {
    const key = ATTRIBUTE_KEYS.includes(attributeKey) ? attributeKey : defaultAttribute(category);
    const field = getDiceSystem() === DICE_SYSTEMS.STEP ? "stepRating" : "value";
    const current = wholeNumber(actor.system?.attributes?.[key]?.[field]);
    await actor.update(
      { [`system.attributes.${key}.${field}`]: Math.max(0, current - damage) },
      {
        yzeCriticalSourceUuid: sourceActorUuid,
        yzeSkipCriticalInjury: skipCriticalInjury,
        yzeEnvironmentalDamage: environmental
      }
    );
    return true;
  }

  if (harmModel === HARM_MODELS.CONDITIONS) {
    const group = category === "mental" ? "mental" : "physical";
    const available = CONDITIONS[group].filter((key) => actor.system?.conditions?.[key] !== true);
    const selected = await chooseConditions(actor, group, damage);
    if (selected === null) return false;
    const updates = Object.fromEntries(selected.map((key) => [`system.conditions.${key}`, true]));
    if (damage > available.length) updates[`system.broken.${group}`] = true;
    if (Object.keys(updates).length > 0) {
      await actor.update(updates, {
        yzeCriticalSourceUuid: sourceActorUuid,
        yzeSkipCriticalInjury: skipCriticalInjury,
        yzeEnvironmentalDamage: environmental
      });
    }
    return true;
  }

  const resource = harmModel === HARM_MODELS.DAMAGE_STRESS && category === "mental"
    ? "resolve"
    : "health";
  const current = wholeNumber(actor.system?.resources?.[resource]?.value);
  await actor.update(
    { [`system.resources.${resource}.value`]: Math.max(0, current - damage) },
    {
      yzeCriticalSourceUuid: sourceActorUuid,
      yzeSkipCriticalInjury: skipCriticalInjury,
      yzeEnvironmentalDamage: environmental
    }
  );
  return true;
}

export async function applyRecovery(actor, amount, {
  category = "physical",
  attributeKey = null
} = {}) {
  let recovery = wholeNumber(amount);
  if (!actor?.system || !canUpdateActor(actor) || recovery < 1) return false;

  if (actor.type === "vehicle") {
    const current = wholeNumber(actor.system?.hull?.value);
    const maximum = wholeNumber(actor.system?.hull?.max);
    const next = Math.min(maximum, current + recovery);
    await actor.update({
      "system.hull.value": next,
      "system.wrecked": next === 0 || actor.system.destroyed === true
    });
    if (current <= 0 && next > 0) await actor.unsetFlag(SYSTEM_ID, "aerialCrashStarted");
    return true;
  }

  if (actor.type === "mount") {
    const current = wholeNumber(actor.system?.resources?.health?.value);
    const maximum = wholeNumber(actor.system?.resources?.health?.max);
    const next = Math.min(maximum, current + recovery);
    await actor.update({
      "system.resources.health.value": next,
      "system.perished": next === 0
    });
    return true;
  }

  const harmModel = getHarmModel();
  if (harmModel === HARM_MODELS.CONDITIONS) {
    const group = category === "mental" ? "mental" : "physical";
    const updates = {};
    if (actor.system?.broken?.[group] === true && recovery > 0) {
      updates[`system.broken.${group}`] = false;
      recovery -= 1;
    }
    const selected = await chooseConditions(actor, group, recovery, { removing: true });
    if (selected === null) return false;
    for (const key of selected) updates[`system.conditions.${key}`] = false;
    if (Object.keys(updates).length > 0) await actor.update(updates);
    return true;
  }

  if (harmModel === HARM_MODELS.ATTRIBUTE_DAMAGE) {
    const key = ATTRIBUTE_KEYS.includes(attributeKey) ? attributeKey : defaultAttribute(category);
    const field = getDiceSystem() === DICE_SYSTEMS.STEP ? "stepRating" : "value";
    const current = wholeNumber(actor.system?.attributes?.[key]?.[field]);
    const maximumField = getDiceSystem() === DICE_SYSTEMS.STEP ? "maxStepRating" : "maxValue";
    const maximum = wholeNumber(actor.system?.attributes?.[key]?.[maximumField]);
    await actor.update({
      [`system.attributes.${key}.${field}`]: Math.min(maximum, current + recovery),
      [`system.broken.${category === "mental" ? "mental" : "physical"}`]: false
    });
    return true;
  }

  const resource = harmModel === HARM_MODELS.DAMAGE_STRESS && category === "mental"
    ? "resolve"
    : "health";
  const current = wholeNumber(actor.system?.resources?.[resource]?.value);
  const maximum = wholeNumber(actor.system?.resources?.[resource]?.max);
  await actor.update({
    [`system.resources.${resource}.value`]: Math.min(maximum, current + recovery),
    [`system.broken.${category === "mental" ? "mental" : "physical"}`]: false
  });
  return true;
}

export async function promptManualDamage(actor) {
  if (!canUpdateActor(actor)) {
    ui.notifications.warn(game.i18n.localize("YZE.Combat.GMApplyDamage"));
    return false;
  }
  const tracks = damageTracks(actor);
  const options = tracks.map((track) => (
    `<option value="${escape(track.value)}">${escape(track.label)}</option>`
  )).join("");
  const { DialogV2 } = foundry.applications.api;
  const selection = await DialogV2.wait({
    window: { title: game.i18n.localize("YZE.Combat.ApplyDamageTitle") },
    content: `
      <div class="yze yze-damage-dialog">
        <div class="form-group">
          <label>${escape(game.i18n.localize("YZE.Combat.DamageTrack"))}</label>
          <select name="track">${options}</select>
        </div>
        <div class="form-group">
          <label>${escape(game.i18n.localize("YZE.Combat.IncomingDamage"))}</label>
          <input type="number" name="damage" value="1" min="1" step="1">
        </div>
      </div>`,
    buttons: [
      {
        action: "continue",
        label: game.i18n.localize("YZE.Combat.ContinueDamage"),
        icon: "fa-solid fa-heart-crack",
        default: true,
        callback: (event, button, dialog) => {
          const form = button.form ?? dialog.element.querySelector("form");
          return {
            track: form.elements.track?.value,
            damage: wholeNumber(form.elements.damage?.value)
          };
        }
      },
      {
        action: "cancel",
        label: game.i18n.localize("YZE.Common.Cancel"),
        icon: "fa-solid fa-xmark",
        callback: () => null
      }
    ],
    close: () => null,
    rejectClose: false,
    modal: true
  });
  if (!selection || selection.damage < 1) return false;
  const track = tracks.find((entry) => entry.value === selection.track) ?? tracks[0];
  let finalDamage = selection.damage;
  let armor = null;
  if (track.category === "physical") {
    const protection = await promptProtection(actor, selection.damage);
    if (!protection) return false;
    armor = await rollArmor(actor, protection.damage, protection.armorId);
    finalDamage = armor.penetrating;
  }
  if (finalDamage > 0) {
    const applied = await applyDamage(actor, finalDamage, track);
    if (!applied) return false;
  }
  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    content: `<div class="yze chat-card yze-damage-card"><p>${escape(game.i18n.format("YZE.Combat.ManualDamageApplied", {
      target: actor.name,
      damage: finalDamage
    }))}</p>${armor?.absorbed > 0 ? `<p>${escape(game.i18n.format("YZE.Armor.Absorbed", { amount: armor.absorbed }))}</p>` : ""}</div>`
  });
  return true;
}

export async function promptManualRecovery(actor) {
  if (!canUpdateActor(actor)) return false;
  const tracks = damageTracks(actor);
  const options = tracks.map((track) => (
    `<option value="${escape(track.value)}">${escape(track.label)}</option>`
  )).join("");
  const { DialogV2 } = foundry.applications.api;
  const selection = await DialogV2.wait({
    window: { title: game.i18n.localize("YZE.Recovery.ManualTitle") },
    content: `
      <div class="yze yze-damage-dialog">
        <div class="form-group">
          <label>${escape(game.i18n.localize("YZE.Recovery.RecoveryTrack"))}</label>
          <select name="track">${options}</select>
        </div>
        <div class="form-group">
          <label>${escape(game.i18n.localize("YZE.Recovery.Amount"))}</label>
          <input type="number" name="amount" value="1" min="1" step="1">
        </div>
      </div>`,
    buttons: [
      {
        action: "recover",
        label: game.i18n.localize("YZE.Recovery.ApplyRecovery"),
        icon: "fa-solid fa-heart-pulse",
        default: true,
        callback: (event, button, dialog) => {
          const form = button.form ?? dialog.element.querySelector("form");
          return {
            track: form.elements.track?.value,
            amount: wholeNumber(form.elements.amount?.value)
          };
        }
      },
      {
        action: "cancel",
        label: game.i18n.localize("YZE.Common.Cancel"),
        icon: "fa-solid fa-xmark",
        callback: () => null
      }
    ],
    close: () => null,
    rejectClose: false,
    modal: true
  });
  if (!selection || selection.amount < 1) return false;
  const track = tracks.find((entry) => entry.value === selection.track) ?? tracks[0];
  const applied = await applyRecovery(actor, selection.amount, track);
  if (!applied) return false;
  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    content: `<div class="yze chat-card yze-recovery-card"><p>${escape(game.i18n.format("YZE.Recovery.ManualApplied", {
      actor: actor.name,
      amount: selection.amount,
      track: track.label
    }))}</p></div>`
  });
  return true;
}

export async function recoverShift(actor) {
  if (!canUpdateActor(actor) || actor?.type === "vehicle") return false;
  if (actor.system?.dead === true) {
    ui.notifications.warn(game.i18n.localize("YZE.Recovery.CannotRecoverDead"));
    return false;
  }
  const restrictions = environmentalRecoveryRestrictions(actor);
  const tracks = damageTracks(actor).filter((track) => restrictions[track.category] !== false);
  if (tracks.length === 0) {
    ui.notifications.warn(game.i18n.localize("YZE.Environment.NoNaturalHealing"));
    return false;
  }
  const broken = actor.system?.broken ?? {};
  const currentlyBroken = tracks.filter((track) => {
    if (track.category === "physical" && broken.physical) return true;
    if (track.category === "mental" && broken.mental) return true;
    if (getHarmModel() === HARM_MODELS.DAMAGE_STRESS) {
      const resource = track.category === "mental" ? "resolve" : "health";
      return Number(actor.system?.resources?.[resource]?.value) <= 0;
    }
    if (getHarmModel() === HARM_MODELS.ATTRIBUTE_DAMAGE && track.attributeKey) {
      const field = getDiceSystem() === DICE_SYSTEMS.STEP ? "stepRating" : "value";
      return Number(actor.system?.attributes?.[track.attributeKey]?.[field]) <= 0;
    }
    return false;
  });

  let recoveryTracks = tracks;
  if (currentlyBroken.length > 0) {
    recoveryTracks = currentlyBroken.length === 1
      ? currentlyBroken
      : [await chooseRecoveryTrack(currentlyBroken)];
  } else if (getHarmModel() === HARM_MODELS.ATTRIBUTE_DAMAGE) {
    const field = getDiceSystem() === DICE_SYSTEMS.STEP ? "stepRating" : "value";
    const maximumField = getDiceSystem() === DICE_SYSTEMS.STEP ? "maxStepRating" : "maxValue";
    const damaged = tracks.filter((track) => (
      track.attributeKey
      && Number(actor.system?.attributes?.[track.attributeKey]?.[field])
        < Number(actor.system?.attributes?.[track.attributeKey]?.[maximumField])
    ));
    if (damaged.length === 0) {
      ui.notifications.info(game.i18n.localize("YZE.Recovery.FullyRecovered"));
      return false;
    }
    recoveryTracks = damaged.length === 1 ? damaged : [await chooseRecoveryTrack(damaged)];
  } else if (getHarmModel() !== HARM_MODELS.CONDITIONS) {
    const damaged = tracks.filter((track) => {
      const resource = getHarmModel() === HARM_MODELS.DAMAGE_STRESS && track.category === "mental"
        ? "resolve"
        : "health";
      return Number(actor.system?.resources?.[resource]?.value)
        < Number(actor.system?.resources?.[resource]?.max);
    });
    if (damaged.length === 0) {
      ui.notifications.info(game.i18n.localize("YZE.Recovery.FullyRecovered"));
      return false;
    }
    // A non-Broken character recovers one physical and one mental point
    // simultaneously. Health-only worlds naturally have just one track.
    recoveryTracks = damaged;
  }
  recoveryTracks = recoveryTracks.filter(Boolean);
  if (recoveryTracks.length === 0) return false;
  for (const track of recoveryTracks) {
    const applied = await applyRecovery(actor, 1, track);
    if (!applied) return false;
  }
  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    content: `<div class="yze chat-card yze-recovery-card"><p>${escape(game.i18n.format("YZE.Recovery.ShiftApplied", { actor: actor.name }))}</p></div>`
  });
  return true;
}

async function chooseRecoveryTrack(tracks) {
  const options = tracks.map((track) => (
    `<option value="${escape(track.value)}">${escape(track.label)}</option>`
  )).join("");
  const { DialogV2 } = foundry.applications.api;
  const selected = await DialogV2.wait({
    window: { title: game.i18n.localize("YZE.Recovery.ChooseTrack") },
    content: `<div class="yze yze-damage-dialog"><div class="form-group"><label>${escape(game.i18n.localize("YZE.Recovery.RecoveryTrack"))}</label><select name="track">${options}</select></div></div>`,
    buttons: [
      {
        action: "choose",
        label: game.i18n.localize("YZE.Common.Continue"),
        icon: "fa-solid fa-arrow-right",
        default: true,
        callback: (event, button, dialog) => {
          const form = button.form ?? dialog.element.querySelector("form");
          return form.elements.track?.value ?? null;
        }
      },
      {
        action: "cancel",
        label: game.i18n.localize("YZE.Common.Cancel"),
        icon: "fa-solid fa-xmark",
        callback: () => null
      }
    ],
    close: () => null,
    rejectClose: false,
    modal: true
  });
  return tracks.find((track) => track.value === selected) ?? null;
}

export async function relieveStress(actor) {
  if (!canUpdateActor(actor) || actor?.type === "vehicle") return false;
  if (!environmentalRecoveryRestrictions(actor).stress) {
    ui.notifications.warn(game.i18n.localize("YZE.Environment.NoStressHealing"));
    return false;
  }
  const current = wholeNumber(actor.system?.resources?.stress?.value);
  if (current === 0) {
    ui.notifications.info(game.i18n.localize("YZE.Recovery.NoStress"));
    return false;
  }
  await actor.update({
    "system.resources.stress.value": 0,
    "system.panic.active": false,
    "system.panic.total": 0,
    "system.panic.key": "",
    "system.panic.title": "",
    "system.panic.effect": "",
    "system.panic.effects": []
  });
  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    content: `<div class="yze chat-card yze-recovery-card"><p>${escape(game.i18n.format("YZE.Recovery.StressRelieved", { actor: actor.name }))}</p></div>`
  });
  return true;
}

export { NO_ARMOR };
