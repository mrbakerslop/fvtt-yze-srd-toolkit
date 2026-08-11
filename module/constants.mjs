export const SYSTEM_ID = "fvtt-yze-srd";

export const DICE_SYSTEMS = Object.freeze({
  POOL: "pool",
  STEP: "step"
});

export const STEP_MODIFIER_METHODS = Object.freeze({
  NUMERICAL: "numerical",
  ADVANTAGE: "advantage"
});

export const STEP_RATING_LABEL_STYLES = Object.freeze({
  LETTER: "letter",
  DIE_SIZE: "dieSize"
});

export const ITEM_TYPES = Object.freeze([
  "archetype",
  "skill",
  "specialty",
  "gear",
  "weapon",
  "armor",
  "consumable",
  "spell",
  "criticalInjury",
  "vehicleComponent"
]);

export function currencyPriceSettingKey(itemType) {
  const type = String(itemType ?? "");
  return `currencyPrice${type.charAt(0).toUpperCase()}${type.slice(1)}`;
}

export const HARM_MODELS = Object.freeze({
  DAMAGE_STRESS: "damageStress",
  HEALTH_ONLY: "healthOnly",
  CONDITIONS: "conditions",
  ATTRIBUTE_DAMAGE: "attributeDamage"
});

export const PUSH_BANE_DAMAGE_MODES = Object.freeze({
  HARM_MODEL: "harmModel",
  NONE: "none"
});

export const ENCUMBRANCE_MODES = Object.freeze({
  STANDARD: "standard",
  WEAPONS_AT_HAND: "weaponsAtHand",
  DISABLED: "disabled"
});

export const CONSUMABLE_MODES = Object.freeze({
  TRACKING: "tracking",
  SUPPLY: "supply"
});

export const CRITICAL_INJURY_TRIGGERS = Object.freeze({
  HEALTH_RESOLVE_ZERO: "healthResolveZero",
  STRENGTH_WITS_ZERO: "strengthWitsZero",
  CONDITIONS_BROKEN: "conditionsBroken",
  BROKEN: "broken",
  DAMAGE_THRESHOLD: "damageThreshold",
  SUCCESS_THRESHOLD: "successThreshold"
});

export const AMMUNITION_MODES = Object.freeze({
  UNTRACKED: "untracked",
  TRACKING: "tracking",
  SUPPLY: "supply",
  AMMO_DICE: "ammoDice"
});

export const INITIATIVE_MODES = Object.freeze({
  OPEN_CARDS: "openCards",
  HIDDEN_CARDS: "hiddenCards"
});

export const SPECIALTY_EFFECTS = Object.freeze({
  BODYGUARD: "bodyguard",
  COMPASSION: "compassion",
  FAST_REFLEXES: "fastReflexes",
  FIELD_SURGEON: "fieldSurgeon",
  FLYWEIGHT: "flyweight",
  GUT_FEELING: "gutFeeling",
  HARDENED: "hardened",
  HARD_HITTER: "hardHitter",
  HEALER: "healer",
  INQUISITIVE: "inquisitive",
  KILLER: "killer",
  LUCKY: "lucky",
  MENACING: "menacing",
  MERCILESS: "merciless",
  MUSICIAN: "musician",
  PACK_MULE: "packMule",
  QUICK_DRAW: "quickDraw",
  RECKLESS: "reckless",
  SECOND_WIND: "secondWind",
  SNIPER: "sniper",
  TOUGH: "tough",
  TRUE_GRIT: "trueGrit",
  WEAPON_SPECIALIST: "weaponSpecialist"
});

export const CONDITIONS = Object.freeze({
  physical: Object.freeze(["exhausted", "battered", "wounded"]),
  mental: Object.freeze(["angry", "scared", "disheartened"])
});

export const STEP_RATINGS = Object.freeze([
  Object.freeze({ value: 0, grade: "none", faces: 0 }),
  Object.freeze({ value: 1, grade: "D", faces: 6 }),
  Object.freeze({ value: 2, grade: "C", faces: 8 }),
  Object.freeze({ value: 3, grade: "B", faces: 10 }),
  Object.freeze({ value: 4, grade: "A", faces: 12 })
]);

export function getStepRating(value) {
  const rating = Math.trunc(Number(value));
  return STEP_RATINGS[rating] ?? STEP_RATINGS[0];
}

export const ATTRIBUTE_KEYS = Object.freeze([
  "strength",
  "agility",
  "wits",
  "empathy"
]);

export const ATTRIBUTE_GROUPS = Object.freeze({
  strength: "physical",
  agility: "physical",
  wits: "mental",
  empathy: "mental"
});

export const DEFAULT_ATTRIBUTE_LABELS = Object.freeze({
  strength: "Strength",
  agility: "Agility",
  wits: "Wits",
  empathy: "Empathy"
});
