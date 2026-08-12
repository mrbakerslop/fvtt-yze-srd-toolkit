import { ATTRIBUTE_KEYS } from "./constants.mjs";

export const ITEM_EFFECT_TYPES = Object.freeze({
  ROLL_MODIFIER: "rollModifier",
  AUTOMATIC_ROLL_MODIFIER: "automaticRollModifier",
  EXTRA_PUSH: "extraPush",
  ALTERNATE_ATTRIBUTE: "alternateAttribute",
  INITIATIVE_CARDS: "initiativeCards",
  HEALING_TIME: "healingTime",
  DERIVED_STAT: "derivedStat",
  CARRY_CAPACITY_MULTIPLIER: "carryCapacityMultiplier",
  HIT_INTERCEPTION: "hitInterception",
  COUP_DE_GRACE: "coupDeGrace",
  WILLPOWER_ACTIVATION: "willpowerActivation",
  DOOM_EXPENDITURE: "doomExpenditure",
  INJURY_MOVEMENT: "injuryMovement",
  INJURY_HANDS: "injuryHands",
  INJURY_BLOCK_ROLLS: "injuryBlockRolls",
  INJURY_ROLL_DAMAGE: "injuryRollDamage",
  INJURY_SLEEP: "injurySleep",
  INJURY_TRIGGER: "injuryTrigger",
  INJURY_SPECIAL_RULE: "injurySpecialRule",
  SPELL_DAMAGE: "spellDamage",
  SPELL_RECOVERY: "spellRecovery",
  SPELL_MODIFIER: "spellModifier",
  SPELL_RESOURCE: "spellResource",
  SPELL_STATUS: "spellStatus",
  SPELL_ARMOR: "spellArmor",
  SPELL_AUTOMATIC_SUCCESS: "spellAutomaticSuccess",
  SPELL_ITEM_DAMAGE: "spellItemDamage",
  SPELL_CRITICAL_INJURY: "spellCriticalInjury",
  SPELL_HAZARD: "spellHazard",
  SPELL_WORKFLOW: "spellWorkflow"
});

export const SPELL_EFFECT_TYPES = Object.freeze([
  ITEM_EFFECT_TYPES.SPELL_DAMAGE,
  ITEM_EFFECT_TYPES.SPELL_RECOVERY,
  ITEM_EFFECT_TYPES.SPELL_MODIFIER,
  ITEM_EFFECT_TYPES.SPELL_RESOURCE,
  ITEM_EFFECT_TYPES.SPELL_STATUS,
  ITEM_EFFECT_TYPES.SPELL_ARMOR,
  ITEM_EFFECT_TYPES.SPELL_AUTOMATIC_SUCCESS,
  ITEM_EFFECT_TYPES.SPELL_ITEM_DAMAGE,
  ITEM_EFFECT_TYPES.SPELL_CRITICAL_INJURY,
  ITEM_EFFECT_TYPES.SPELL_HAZARD,
  ITEM_EFFECT_TYPES.SPELL_WORKFLOW
]);

function normalized(value) {
  return String(value ?? "").trim().toLocaleLowerCase();
}

export function skillEffectTarget(skillName) {
  const name = normalized(skillName);
  return name ? `skill:${name}` : "";
}

export function itemEffectsActive(item) {
  if (!item?.parent || item.parent.documentName !== "Actor") return false;
  if (["gear", "weapon", "armor", "consumable"].includes(item.type)) {
    return item.system.equipped === true && Number(item.system.quantity) > 0;
  }
  if (["specialty", "criticalInjury"].includes(item.type)) {
    return item.system.active === true;
  }
  return true;
}

export function itemEffects(item, type = null) {
  if (!itemEffectsActive(item)) return [];
  return (item.system.effects ?? [])
    .filter((effect) => effect.active !== false)
    .filter((effect) => String(effect.application || "passive") === "passive")
    .filter((effect) => !type || effect.type === type)
    .map((effect, index) => ({ ...effect, id: effect.id || `${item.id}-${index}`, item }));
}

export function spellItemEffects(spell) {
  if (!spell || spell.type !== "spell") return [];
  return (spell.system.effects ?? [])
    .filter((effect) => effect.active !== false)
    .filter((effect) => String(effect.application || "") === "spell"
      || SPELL_EFFECT_TYPES.includes(effect.type))
    .map((effect, index) => ({
      ...effect,
      id: effect.id || `${spell.id}-${index}`,
      item: spell
    }));
}

export function actorItemEffects(actor, type = null) {
  return actor?.items ? [...actor.items].flatMap((item) => itemEffects(item, type)) : [];
}

export function effectTargetsAttribute(effect, attributeKey) {
  return effectTargetsRoll(effect, attributeKey);
}

export function effectTargetsRoll(effect, attributeKey, skillName = null) {
  return effect.target === "all"
    || effect.target === attributeKey
    || (skillName && effect.target === skillEffectTarget(skillName));
}

export function rollModifierEffects(actor, attributeKey, skillName = null) {
  return actorItemEffects(actor, ITEM_EFFECT_TYPES.ROLL_MODIFIER)
    .filter((effect) => effectTargetsRoll(effect, attributeKey, skillName))
    .filter((effect) => Number(effect.value) !== 0);
}

export function automaticRollModifierEffects(actor, attributeKey, skillName = null) {
  return actorItemEffects(actor, ITEM_EFFECT_TYPES.AUTOMATIC_ROLL_MODIFIER)
    .filter((effect) => effectTargetsRoll(effect, attributeKey, skillName))
    .filter((effect) => Number(effect.value) !== 0);
}

export function extraPushes(actor, attributeKey, skillName = null) {
  return actorItemEffects(actor, ITEM_EFFECT_TYPES.EXTRA_PUSH)
    .filter((effect) => effectTargetsRoll(effect, attributeKey, skillName))
    .reduce((total, effect) => total + Math.max(0, Math.trunc(Number(effect.value) || 0)), 0);
}

export function alternateAttributeEffects(actor, skillName) {
  const target = normalized(skillName);
  return actorItemEffects(actor, ITEM_EFFECT_TYPES.ALTERNATE_ATTRIBUTE)
    .filter((effect) => normalized(effect.target) === target)
    .filter((effect) => ATTRIBUTE_KEYS.includes(effect.attribute));
}

export function initiativeCardBonus(actor) {
  return actorItemEffects(actor, ITEM_EFFECT_TYPES.INITIATIVE_CARDS)
    .reduce((total, effect) => total + Math.max(0, Math.trunc(Number(effect.value) || 0)), 0);
}

export function healingTimeMultiplier(actor) {
  return actorItemEffects(actor, ITEM_EFFECT_TYPES.HEALING_TIME)
    .reduce((multiplier, effect) => multiplier * Math.max(0, Number(effect.value) || 100) / 100, 1);
}

export function derivedStatBonus(actor, target) {
  return actorItemEffects(actor, ITEM_EFFECT_TYPES.DERIVED_STAT)
    .filter((effect) => effect.target === target)
    .reduce((total, effect) => total + Math.trunc(Number(effect.value) || 0), 0);
}

export function carryCapacityMultiplierEffects(actor) {
  return actorItemEffects(actor, ITEM_EFFECT_TYPES.CARRY_CAPACITY_MULTIPLIER)
    .filter((effect) => Number(effect.value) > 0);
}

export function hitInterceptionEffects(actor) {
  return actorItemEffects(actor, ITEM_EFFECT_TYPES.HIT_INTERCEPTION);
}

export function coupDeGraceEffects(actor) {
  return actorItemEffects(actor, ITEM_EFFECT_TYPES.COUP_DE_GRACE);
}

export function willpowerActivationEffects(actor) {
  return actorItemEffects(actor, ITEM_EFFECT_TYPES.WILLPOWER_ACTIVATION);
}

export function doomExpenditureEffects(actor) {
  return actorItemEffects(actor, ITEM_EFFECT_TYPES.DOOM_EXPENDITURE);
}

export function worldDoomExpenditures() {
  return [...(game.items ?? [])]
    .flatMap((item) => (item.system.effects ?? [])
      .filter((effect) => effect.active !== false
        && effect.type === ITEM_EFFECT_TYPES.DOOM_EXPENDITURE)
      .map((effect, index) => ({
        ...effect,
        id: effect.id || `${item.id}-${index}`,
        item
      })))
    .sort((left, right) => {
      const leftName = String(left.label || left.item.name);
      const rightName = String(right.label || right.item.name);
      return leftName.localeCompare(rightName);
    });
}
