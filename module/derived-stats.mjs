import { getStepRating } from "./constants.mjs";
import { specialtyDerivedBonuses } from "./specialties.mjs";

function numericRating(value) {
  const rating = Number(value);
  return Number.isFinite(rating) ? rating : 0;
}

function attributeValue(attributes, key, stepDice) {
  const attribute = attributes?.[key];
  if (!attribute) return 0;

  if (stepDice) {
    return getStepRating(numericRating(attribute.stepRating)).faces;
  }

  return numericRating(attribute.value);
}

export function calculateBaseHealthResolve(attributes, { stepDice = false } = {}) {
  const strength = attributeValue(attributes, "strength", stepDice);
  const agility = attributeValue(attributes, "agility", stepDice);
  const wits = attributeValue(attributes, "wits", stepDice);
  const empathy = attributeValue(attributes, "empathy", stepDice);

  if (stepDice) {
    return {
      health: Math.ceil((strength + agility) / 4),
      resolve: Math.ceil((wits + empathy) / 4)
    };
  }

  return {
    health: Math.ceil((strength + agility) / 2) + 1,
    resolve: Math.ceil((wits + empathy) / 2) + 1
  };
}

export function calculateHealthResolve(actor, { stepDice = false } = {}) {
  const base = calculateBaseHealthResolve(actor?.system?.attributes, { stepDice });
  const specialty = specialtyDerivedBonuses(actor);
  return {
    health: Math.max(0, base.health + specialty.health),
    resolve: Math.max(0, base.resolve + specialty.resolve),
    base,
    specialty
  };
}
