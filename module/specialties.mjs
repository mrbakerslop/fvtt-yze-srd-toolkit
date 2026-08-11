import { SPECIALTY_EFFECTS } from "./constants.mjs";
import {
  alternateAttributeEffects,
  derivedStatBonus,
  effectTargetsRoll,
  extraPushes,
  healingTimeMultiplier,
  initiativeCardBonus,
  ITEM_EFFECT_TYPES
} from "./item-effects.mjs";

const NAME_EFFECTS = new Map([
  ["bodyguard", SPECIALTY_EFFECTS.BODYGUARD],
  ["compassion", SPECIALTY_EFFECTS.COMPASSION],
  ["fast reflexes", SPECIALTY_EFFECTS.FAST_REFLEXES],
  ["field surgeon", SPECIALTY_EFFECTS.FIELD_SURGEON],
  ["flyweight", SPECIALTY_EFFECTS.FLYWEIGHT],
  ["gut feeling", SPECIALTY_EFFECTS.GUT_FEELING],
  ["hardened", SPECIALTY_EFFECTS.HARDENED],
  ["hard hitter", SPECIALTY_EFFECTS.HARD_HITTER],
  ["healer", SPECIALTY_EFFECTS.HEALER],
  ["inquisitive", SPECIALTY_EFFECTS.INQUISITIVE],
  ["killer", SPECIALTY_EFFECTS.KILLER],
  ["lucky", SPECIALTY_EFFECTS.LUCKY],
  ["menacing", SPECIALTY_EFFECTS.MENACING],
  ["merciless", SPECIALTY_EFFECTS.MERCILESS],
  ["musician", SPECIALTY_EFFECTS.MUSICIAN],
  ["pack mule", SPECIALTY_EFFECTS.PACK_MULE],
  ["quick draw", SPECIALTY_EFFECTS.QUICK_DRAW],
  ["reckless", SPECIALTY_EFFECTS.RECKLESS],
  ["second wind", SPECIALTY_EFFECTS.SECOND_WIND],
  ["sniper", SPECIALTY_EFFECTS.SNIPER],
  ["tough", SPECIALTY_EFFECTS.TOUGH],
  ["true grit", SPECIALTY_EFFECTS.TRUE_GRIT],
  ["weapon specialist", SPECIALTY_EFFECTS.WEAPON_SPECIALIST]
]);

const STACK_LIMITS = Object.freeze({
  [SPECIALTY_EFFECTS.HARDENED]: 3,
  [SPECIALTY_EFFECTS.TOUGH]: 3,
  [SPECIALTY_EFFECTS.WEAPON_SPECIALIST]: Number.POSITIVE_INFINITY
});

function normalized(value) {
  return String(value ?? "").trim().toLocaleLowerCase();
}

export function specialtyEffect(item) {
  if (!item || item.type !== "specialty") return "";
  return String(item.system?.effect || NAME_EFFECTS.get(normalized(item.name)) || "");
}

export function activeSpecialties(actor, effect = null) {
  return actor?.items
    ?.filter((item) => item.type === "specialty" && item.system.active === true)
    .filter((item) => !effect || specialtyEffect(item) === effect) ?? [];
}

export function hasSpecialty(actor, effect) {
  return activeSpecialties(actor, effect).length > 0;
}

export function specialtyCount(actor, effect, { capped = true } = {}) {
  const count = activeSpecialties(actor, effect).length;
  return capped ? Math.min(STACK_LIMITS[effect] ?? 1, count) : count;
}

export function specialtyStackLimit(effect) {
  return STACK_LIMITS[effect] ?? 1;
}

export function specialtyTarget(item) {
  return normalized(item?.system?.effectTarget);
}

export function hasWeaponSpecialty(actor, weapon) {
  const weaponName = normalized(weapon?.name);
  if (!weaponName) return false;
  return activeSpecialties(actor, SPECIALTY_EFFECTS.WEAPON_SPECIALIST)
    .some((item) => specialtyTarget(item) === weaponName);
}

export function specialtyDerivedBonuses(actor) {
  const legacyWithout = (effect, type, target) => activeSpecialties(actor, effect)
    .filter((item) => !(item.system.effects ?? []).some((entry) => (
      entry.active !== false && entry.type === type && (!target || entry.target === target)
    ))).length;
  return {
    health: derivedStatBonus(actor, "health")
      + Math.min(3, legacyWithout(SPECIALTY_EFFECTS.TOUGH, ITEM_EFFECT_TYPES.DERIVED_STAT, "health")),
    resolve: derivedStatBonus(actor, "resolve")
      + Math.min(3, legacyWithout(SPECIALTY_EFFECTS.HARDENED, ITEM_EFFECT_TYPES.DERIVED_STAT, "resolve")),
    carry: derivedStatBonus(actor, "carry")
      + legacyWithout(SPECIALTY_EFFECTS.PACK_MULE, ITEM_EFFECT_TYPES.DERIVED_STAT, "carry") * 2
  };
}

export function maximumPushes(actor, attributeKey, { skillRoll = false, skillName = null } = {}) {
  const generic = extraPushes(actor, attributeKey, skillName);
  if (!skillRoll) return 1 + generic;
  const effect = {
    strength: SPECIALTY_EFFECTS.TRUE_GRIT,
    agility: SPECIALTY_EFFECTS.RECKLESS,
    wits: SPECIALTY_EFFECTS.INQUISITIVE,
    empathy: SPECIALTY_EFFECTS.COMPASSION
  }[attributeKey];
  const legacy = effect && activeSpecialties(actor, effect).some((item) => (
    !(item.system.effects ?? []).some((entry) => (
      entry.active !== false && entry.type === ITEM_EFFECT_TYPES.EXTRA_PUSH
      && effectTargetsRoll(entry, attributeKey, skillName)
    ))
  )) ? 1 : 0;
  return 1 + generic + legacy;
}

export async function promptSpecialtyAttribute(actor, skill, defaultAttribute) {
  const skillName = normalized(skill?.name);
  const alternatives = alternateAttributeEffects(actor, skillName).map((entry) => ({
    attribute: entry.attribute,
    effect: entry.item.name,
    generic: true
  }));
  if (skillName === "observation" && hasSpecialty(actor, SPECIALTY_EFFECTS.GUT_FEELING)) {
    if (!alternatives.some((entry) => entry.attribute === "empathy")) {
      alternatives.push({ attribute: "empathy", effect: SPECIALTY_EFFECTS.GUT_FEELING });
    }
  }
  if (skillName === "persuasion" && hasSpecialty(actor, SPECIALTY_EFFECTS.MENACING)) {
    if (!alternatives.some((entry) => entry.attribute === "strength")) {
      alternatives.push({ attribute: "strength", effect: SPECIALTY_EFFECTS.MENACING });
    }
  }
  const choices = alternatives.filter((entry) => entry.attribute !== defaultAttribute);
  if (choices.length === 0) return defaultAttribute;

  const labels = game.yze?.getAttributeLabels?.() ?? {};
  const options = [
    `<option value="${defaultAttribute}">${foundry.utils.escapeHTML(
      game.i18n.format("YZE.Specialty.NormalAttribute", {
        attribute: labels[defaultAttribute] ?? defaultAttribute
      })
    )}</option>`,
    ...choices.map((entry) => `<option value="${entry.attribute}">${foundry.utils.escapeHTML(
      game.i18n.format("YZE.Specialty.UseEffectAttribute", {
        effect: entry.generic ? entry.effect : game.i18n.localize(`YZE.Specialty.Effects.${entry.effect}`),
        attribute: labels[entry.attribute] ?? entry.attribute
      })
    )}</option>`)
  ].join("");
  const { DialogV2 } = foundry.applications.api;
  const selected = await DialogV2.wait({
    window: { title: game.i18n.localize("YZE.Specialty.AttributeChoiceTitle") },
    content: `<div class="yze"><p>${foundry.utils.escapeHTML(game.i18n.format(
      "YZE.Specialty.AttributeChoiceHint", { skill: skill.name }
    ))}</p><div class="form-group"><label>${foundry.utils.escapeHTML(
      game.i18n.localize("YZE.Item.LinkedAttribute")
    )}</label><select name="attribute">${options}</select></div></div>`,
    buttons: [
      {
        action: "continue",
        label: game.i18n.localize("YZE.Common.Continue"),
        icon: "fa-solid fa-arrow-right",
        default: true,
        callback: (event, button, dialog) => {
          const form = button.form ?? dialog.element.querySelector("form");
          return form.elements.attribute?.value ?? defaultAttribute;
        }
      },
      {
        action: "cancel",
        label: game.i18n.localize("YZE.Common.Cancel"),
        icon: "fa-solid fa-xmark",
        callback: () => false
      }
    ],
    close: () => null,
    rejectClose: false,
    modal: true
  });
  return selected;
}

export function effectiveHealingTime(actor, healingTime) {
  const value = String(healingTime ?? "").trim();
  if (!value || /^(none|permanent)$/i.test(value)) return value;
  const multiplier = effectiveHealingMultiplier(actor);
  if (multiplier === 1) return value;
  return game.i18n.format("YZE.ItemEffects.AdjustedHealingTime", {
    percent: Math.round(multiplier * 100), time: value
  });
}

export function effectiveHealingMultiplier(actor) {
  let multiplier = healingTimeMultiplier(actor);
  const legacy = activeSpecialties(actor, SPECIALTY_EFFECTS.HEALER).some((item) => (
    !(item.system.effects ?? []).some((entry) => (
      entry.active !== false && entry.type === ITEM_EFFECT_TYPES.HEALING_TIME
    ))
  ));
  if (legacy) multiplier *= 0.5;
  return multiplier;
}

export function initiativeCardsToDraw(actor) {
  const generic = initiativeCardBonus(actor);
  const legacy = activeSpecialties(actor, SPECIALTY_EFFECTS.FAST_REFLEXES).some((item) => (
    !(item.system.effects ?? []).some((entry) => (
      entry.active !== false && entry.type === ITEM_EFFECT_TYPES.INITIATIVE_CARDS
    ))
  )) ? 1 : 0;
  return Math.max(1, 1 + generic + legacy);
}

export function specialtyEffectLabel(item) {
  const effect = specialtyEffect(item);
  return effect ? game.i18n.localize(`YZE.Specialty.Effects.${effect}`) : "";
}
