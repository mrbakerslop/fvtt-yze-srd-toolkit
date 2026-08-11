import {
  AMMUNITION_MODES,
  ATTRIBUTE_KEYS,
  CONSUMABLE_MODES,
  CRITICAL_INJURY_TRIGGERS,
  DEFAULT_ATTRIBUTE_LABELS,
  DICE_SYSTEMS,
  ENCUMBRANCE_MODES,
  HARM_MODELS,
  INITIATIVE_MODES,
  ITEM_TYPES,
  PUSH_BANE_DAMAGE_MODES,
  STEP_MODIFIER_METHODS,
  STEP_RATING_LABEL_STYLES,
  currencyPriceSettingKey,
  getStepRating,
  SYSTEM_ID
} from "./constants.mjs";
import {
  YZEAttributeNamesConfig,
  YZECharacterFeaturesConfig,
  YZECurrencyConfig,
  YZEHeaderFieldsConfig,
  YZEOptionalSubsystemsConfig,
  YZEPersonalityFieldsConfig,
  YZEPushingConfig,
  YZERuleVariantsConfig
} from "./apps/system-config.mjs";
import { YZEWorldSetup } from "./apps/world-setup.mjs";

const SETTING_KEYS = Object.freeze({
  strength: "attributeLabelStrength",
  agility: "attributeLabelAgility",
  wits: "attributeLabelWits",
  empathy: "attributeLabelEmpathy"
});

const HEADER_FIELD_DEFAULTS = Object.freeze([
  "Archetype",
  "Background",
  "Motivation",
  "Description",
  "Field 5",
  "Field 6"
]);

export const PERSONALITY_FIELD_DEFAULTS = Object.freeze({
  pride: "Pride",
  weakness: "Weakness",
  darkSecret: "Dark Secret",
  bigDream: "Big Dream",
  buddy: "Buddy",
  relationships: "Relationships"
});

const CORE_SETTING_KEYS = Object.freeze([
  "diceSystem",
  "stepModifierMethod",
  "stepRatingLabelStyle",
  "harmModel"
]);

const CONFIGURATION_MENU_KEYS = Object.freeze([
  "worldSetup",
  "pushingConsequences",
  "ruleVariants",
  "characterSheetFeatures",
  "currency",
  "personalityFields",
  "optionalSubsystems",
  "attributeNames",
  "characterHeaderFields"
]);

function createSettingsDivider(category, section, labelKey) {
  const heading = category.ownerDocument.createElement("h3");
  heading.classList.add("divider", "yze-settings-section-heading");
  heading.dataset.yzeSettingsSection = section;
  heading.textContent = game.i18n.localize(labelKey);
  return heading;
}

export function registerSettingsConfigLayoutHook() {
  Hooks.on("renderSettingsConfig", (_application, element) => {
    const category = element.querySelector('[data-category="system"]');
    if (!category) return;

    for (const heading of category.querySelectorAll("[data-yze-settings-section]")) {
      heading.remove();
    }

    const coreRows = CORE_SETTING_KEYS.map((key) =>
      category.querySelector(`[name="${SYSTEM_ID}.${key}"]`)?.closest(".form-group")
    ).filter(Boolean);
    if (!coreRows.length) return;

    for (const row of [...coreRows].reverse()) category.prepend(row);
    category.prepend(createSettingsDivider(category, "core", "YZE.Settings.Config.CoreMechanics"));

    const firstMenuRow = CONFIGURATION_MENU_KEYS.map((key) =>
      category.querySelector(`[data-key="${SYSTEM_ID}.${key}"]`)?.closest(".form-group")
    ).find(Boolean);
    if (firstMenuRow) {
      firstMenuRow.before(
        createSettingsDivider(category, "additional", "YZE.Settings.Config.AdditionalOptions")
      );
    }
  });
}

export function registerSystemSettings() {
  game.settings.registerMenu(SYSTEM_ID, "worldSetup", {
    name: "YZE.WorldSetup.MenuName",
    label: "YZE.WorldSetup.MenuButton",
    hint: "YZE.WorldSetup.MenuHint",
    icon: "fa-solid fa-wand-magic-sparkles",
    type: YZEWorldSetup,
    restricted: true
  });

  game.settings.register(SYSTEM_ID, "showWorldSetupOnStartup", {
    scope: "world",
    config: false,
    type: Boolean,
    default: true
  });

  game.settings.register(SYSTEM_ID, "diceSystem", {
    name: "YZE.Settings.DiceSystem.Name",
    hint: "YZE.Settings.DiceSystem.Hint",
    scope: "world",
    config: true,
    type: String,
    choices: {
      [DICE_SYSTEMS.POOL]: "YZE.Settings.DiceSystem.Pool",
      [DICE_SYSTEMS.STEP]: "YZE.Settings.DiceSystem.Step"
    },
    default: DICE_SYSTEMS.POOL,
    requiresReload: true
  });

  game.settings.register(SYSTEM_ID, "stepModifierMethod", {
    name: "YZE.Settings.StepModifierMethod.Name",
    hint: "YZE.Settings.StepModifierMethod.Hint",
    scope: "world",
    config: true,
    type: String,
    choices: {
      [STEP_MODIFIER_METHODS.NUMERICAL]: "YZE.Settings.StepModifierMethod.Numerical",
      [STEP_MODIFIER_METHODS.ADVANTAGE]: "YZE.Settings.StepModifierMethod.Advantage"
    },
    default: STEP_MODIFIER_METHODS.NUMERICAL,
    requiresReload: true
  });

  game.settings.register(SYSTEM_ID, "stepRatingLabelStyle", {
    name: "YZE.Settings.StepRatingLabelStyle.Name",
    hint: "YZE.Settings.StepRatingLabelStyle.Hint",
    scope: "world",
    config: true,
    type: String,
    choices: {
      [STEP_RATING_LABEL_STYLES.LETTER]: "YZE.Settings.StepRatingLabelStyle.Letter",
      [STEP_RATING_LABEL_STYLES.DIE_SIZE]: "YZE.Settings.StepRatingLabelStyle.DieSize"
    },
    default: STEP_RATING_LABEL_STYLES.LETTER,
    requiresReload: true
  });

  game.settings.register(SYSTEM_ID, "harmModel", {
    name: "YZE.Settings.HarmModel.Name",
    hint: "YZE.Settings.HarmModel.Hint",
    scope: "world",
    config: true,
    type: String,
    choices: {
      [HARM_MODELS.DAMAGE_STRESS]: "YZE.Settings.HarmModel.DamageStress",
      [HARM_MODELS.HEALTH_ONLY]: "YZE.Settings.HarmModel.HealthOnly",
      [HARM_MODELS.CONDITIONS]: "YZE.Settings.HarmModel.Conditions",
      [HARM_MODELS.ATTRIBUTE_DAMAGE]: "YZE.Settings.HarmModel.AttributeDamage"
    },
    default: HARM_MODELS.DAMAGE_STRESS,
    requiresReload: true
  });

  game.settings.register(SYSTEM_ID, "pushBaneDamageMode", {
    name: "YZE.Settings.PushBaneDamageMode.Name",
    hint: "YZE.Settings.PushBaneDamageMode.Hint",
    scope: "world",
    config: false,
    type: String,
    choices: {
      [PUSH_BANE_DAMAGE_MODES.HARM_MODEL]: "YZE.Settings.PushBaneDamageMode.HarmModel",
      [PUSH_BANE_DAMAGE_MODES.NONE]: "YZE.Settings.PushBaneDamageMode.None"
    },
    default: PUSH_BANE_DAMAGE_MODES.HARM_MODEL,
    requiresReload: true
  });

  for (const [key, name, hint, choices, fallback] of [
    ["encumbranceMode", "YZE.Settings.EncumbranceMode.Name", "YZE.Settings.EncumbranceMode.Hint", {
      [ENCUMBRANCE_MODES.STANDARD]: "YZE.Settings.EncumbranceMode.Standard",
      [ENCUMBRANCE_MODES.WEAPONS_AT_HAND]: "YZE.Settings.EncumbranceMode.WeaponsAtHand",
      [ENCUMBRANCE_MODES.DISABLED]: "YZE.Settings.EncumbranceMode.Disabled"
    }, ENCUMBRANCE_MODES.DISABLED],
    ["consumableMode", "YZE.Settings.ConsumableMode.Name", "YZE.Settings.ConsumableMode.Hint", {
      [CONSUMABLE_MODES.TRACKING]: "YZE.Settings.ConsumableMode.Tracking",
      [CONSUMABLE_MODES.SUPPLY]: "YZE.Settings.ConsumableMode.Supply"
    }, CONSUMABLE_MODES.TRACKING],
    ["criticalInjuryTrigger", "YZE.Settings.CriticalInjuryTrigger.Name", "YZE.Settings.CriticalInjuryTrigger.Hint", {
      [CRITICAL_INJURY_TRIGGERS.HEALTH_RESOLVE_ZERO]: "YZE.Settings.CriticalInjuryTrigger.HealthResolveZero",
      [CRITICAL_INJURY_TRIGGERS.STRENGTH_WITS_ZERO]: "YZE.Settings.CriticalInjuryTrigger.StrengthWitsZero",
      [CRITICAL_INJURY_TRIGGERS.CONDITIONS_BROKEN]: "YZE.Settings.CriticalInjuryTrigger.ConditionsBroken",
      [CRITICAL_INJURY_TRIGGERS.DAMAGE_THRESHOLD]: "YZE.Settings.CriticalInjuryTrigger.DamageThreshold",
      [CRITICAL_INJURY_TRIGGERS.SUCCESS_THRESHOLD]: "YZE.Settings.CriticalInjuryTrigger.SuccessThreshold"
    }, CRITICAL_INJURY_TRIGGERS.HEALTH_RESOLVE_ZERO],
    ["ammunitionMode", "YZE.Settings.AmmunitionMode.Name", "YZE.Settings.AmmunitionMode.Hint", {
      [AMMUNITION_MODES.UNTRACKED]: "YZE.Settings.AmmunitionMode.Untracked",
      [AMMUNITION_MODES.TRACKING]: "YZE.Settings.AmmunitionMode.Tracking",
      [AMMUNITION_MODES.SUPPLY]: "YZE.Settings.AmmunitionMode.Supply",
      [AMMUNITION_MODES.AMMO_DICE]: "YZE.Settings.AmmunitionMode.AmmoDice"
    }, AMMUNITION_MODES.UNTRACKED],
    ["initiativeMode", "YZE.Settings.InitiativeMode.Name", "YZE.Settings.InitiativeMode.Hint", {
      [INITIATIVE_MODES.OPEN_CARDS]: "YZE.Settings.InitiativeMode.OpenCards",
      [INITIATIVE_MODES.HIDDEN_CARDS]: "YZE.Settings.InitiativeMode.HiddenCards"
    }, INITIATIVE_MODES.OPEN_CARDS]
  ]) {
    game.settings.register(SYSTEM_ID, key, {
      name,
      hint,
      scope: "world",
      config: false,
      type: String,
      choices,
      default: fallback,
      requiresReload: true
    });
  }

  for (const [key, name, label, hint, type] of [
    ["pushingConsequences", "YZE.Settings.Config.PushingConsequences", "YZE.Settings.Config.PushingButton", "YZE.Settings.Config.PushingMenuHint", YZEPushingConfig],
    ["ruleVariants", "YZE.Settings.Config.RuleVariants", "YZE.Settings.Config.RuleVariantsButton", "YZE.Settings.Config.RuleVariantsMenuHint", YZERuleVariantsConfig],
    ["characterSheetFeatures", "YZE.Settings.Config.CharacterFeatures", "YZE.Settings.Config.CharacterFeaturesButton", "YZE.Settings.Config.CharacterFeaturesMenuHint", YZECharacterFeaturesConfig],
    ["currency", "YZE.Settings.Config.Currency", "YZE.Settings.Config.CurrencyButton", "YZE.Settings.Config.CurrencyMenuHint", YZECurrencyConfig],
    ["personalityFields", "YZE.Settings.Config.PersonalityFields", "YZE.Settings.Config.PersonalityFieldsButton", "YZE.Settings.Config.PersonalityFieldsMenuHint", YZEPersonalityFieldsConfig],
    ["optionalSubsystems", "YZE.Settings.Config.OptionalSubsystems", "YZE.Settings.Config.OptionalSubsystemsButton", "YZE.Settings.Config.OptionalSubsystemsMenuHint", YZEOptionalSubsystemsConfig],
    ["attributeNames", "YZE.Settings.Config.AttributeNames", "YZE.Settings.Config.AttributeNamesButton", "YZE.Settings.Config.AttributeNamesMenuHint", YZEAttributeNamesConfig],
    ["characterHeaderFields", "YZE.Settings.Config.HeaderFields", "YZE.Settings.Config.HeaderFieldsButton", "YZE.Settings.Config.HeaderFieldsMenuHint", YZEHeaderFieldsConfig]
  ]) {
    game.settings.registerMenu(SYSTEM_ID, key, {
      name,
      label,
      hint,
      icon: "fa-solid fa-gears",
      type,
      restricted: true
    });
  }

  game.settings.register(SYSTEM_ID, "coreSkillsCreated", {
    scope: "world",
    config: false,
    type: Boolean,
    default: false
  });

  game.settings.register(SYSTEM_ID, "srdContentCreated", {
    scope: "world",
    config: false,
    type: Boolean,
    default: false
  });

  game.settings.register(SYSTEM_ID, "srdContentVersion", {
    scope: "world",
    config: false,
    type: Number,
    default: 0
  });

  game.settings.register(SYSTEM_ID, "doomPoints", {
    scope: "world",
    config: false,
    type: Number,
    default: 0
  });

  game.settings.register(SYSTEM_ID, "doomManagerRole", {
    name: "YZE.Settings.DoomManagerRole.Name",
    hint: "YZE.Settings.DoomManagerRole.Hint",
    scope: "world",
    config: false,
    type: String,
    default: String(CONST.USER_ROLES.GAMEMASTER)
  });

  game.settings.register(SYSTEM_ID, "trackSuccessfulSkillUse", {
    name: "YZE.Settings.TrackSuccessfulSkillUse.Name",
    hint: "YZE.Settings.TrackSuccessfulSkillUse.Hint",
    scope: "world",
    config: false,
    type: Boolean,
    default: true,
    requiresReload: true
  });

  for (const [key, name, hint] of [
    ["useStressDice", "YZE.Settings.StressDice.Name", "YZE.Settings.StressDice.Hint"],
    ["useDoomPoints", "YZE.Settings.DoomPoints.Name", "YZE.Settings.DoomPoints.Hint"],
    ["useConditions", "YZE.Settings.Conditions.Name", "YZE.Settings.Conditions.Hint"],
    ["useWillpower", "YZE.Settings.Willpower.Name", "YZE.Settings.Willpower.Hint"],
    ["useCriticalInjuries", "YZE.Settings.CriticalInjuries.Name", "YZE.Settings.CriticalInjuries.Hint"],
    ["useExperience", "YZE.Settings.Experience.Name", "YZE.Settings.Experience.Hint"],
    ["useCurrency", "YZE.Settings.Currency.Name", "YZE.Settings.Currency.Hint"],
    ["useMagic", "YZE.Settings.Magic.Name", "YZE.Settings.Magic.Hint"],
    ["useVehicles", "YZE.Settings.Vehicles.Name", "YZE.Settings.Vehicles.Hint"],
    ["useTravel", "YZE.Settings.Travel.Name", "YZE.Settings.Travel.Hint"]
  ]) {
    game.settings.register(SYSTEM_ID, key, {
      name,
      hint,
      scope: "world",
      config: false,
      type: Boolean,
      default: !["useStressDice", "useDoomPoints", "useConditions", "useCurrency", "useVehicles", "useTravel"].includes(key),
      requiresReload: true
    });
  }

  game.settings.register(SYSTEM_ID, "currencyLabel", {
    name: "YZE.Settings.Currency.LabelName",
    hint: "YZE.Settings.Currency.LabelHint",
    scope: "world",
    config: false,
    type: String,
    default: "Cash",
    requiresReload: true
  });

  const defaultPricedItemTypes = new Set([
    "gear", "weapon", "armor", "consumable", "vehicleComponent"
  ]);
  for (const type of ITEM_TYPES) {
    game.settings.register(SYSTEM_ID, currencyPriceSettingKey(type), {
      name: "YZE.Settings.Currency.ItemTypeName",
      hint: "YZE.Settings.Currency.ItemTypeHint",
      scope: "world",
      config: false,
      type: Boolean,
      default: defaultPricedItemTypes.has(type),
      requiresReload: true
    });
  }

  game.settings.register(SYSTEM_ID, "travelDay", {
    scope: "world", config: false, type: Number, default: 1
  });
  game.settings.register(SYSTEM_ID, "travelShift", {
    scope: "world", config: false, type: String, default: "morning"
  });
  game.settings.register(SYSTEM_ID, "travelWeather", {
    scope: "world", config: false, type: String, default: "fair"
  });
  game.settings.register(SYSTEM_ID, "chaseState", {
    scope: "world", config: false, type: Object, default: {}
  });
  game.settings.register(SYSTEM_ID, "travelDistance", {
    scope: "world", config: false, type: Number, default: 0
  });

  for (let index = 0; index < HEADER_FIELD_DEFAULTS.length; index += 1) {
    const slot = index + 1;
    game.settings.register(SYSTEM_ID, `headerField${slot}Enabled`, {
      name: `YZE.Settings.HeaderFields.Field${slot}.EnabledName`,
      hint: `YZE.Settings.HeaderFields.Field${slot}.EnabledHint`,
      scope: "world",
      config: false,
      type: Boolean,
      default: slot <= 4,
      requiresReload: true
    });
    game.settings.register(SYSTEM_ID, `headerField${slot}Label`, {
      name: `YZE.Settings.HeaderFields.Field${slot}.LabelName`,
      hint: `YZE.Settings.HeaderFields.Field${slot}.LabelHint`,
      scope: "world",
      config: false,
      type: String,
      default: HEADER_FIELD_DEFAULTS[index],
      requiresReload: true
    });
  }

  for (const [key, defaultLabel] of Object.entries(PERSONALITY_FIELD_DEFAULTS)) {
    const prefix = `personality${key[0].toUpperCase()}${key.slice(1)}`;
    game.settings.register(SYSTEM_ID, `${prefix}Enabled`, {
      name: "YZE.Settings.PersonalityFields.EnabledName",
      hint: "YZE.Settings.PersonalityFields.EnabledHint",
      scope: "world",
      config: false,
      type: Boolean,
      default: true,
      requiresReload: true
    });
    game.settings.register(SYSTEM_ID, `${prefix}Label`, {
      name: "YZE.Settings.PersonalityFields.LabelName",
      hint: "YZE.Settings.PersonalityFields.LabelHint",
      scope: "world",
      config: false,
      type: String,
      default: defaultLabel,
      requiresReload: true
    });
  }

  for (const key of ATTRIBUTE_KEYS) {
    const settingKey = SETTING_KEYS[key];
    game.settings.register(SYSTEM_ID, settingKey, {
      name: `YZE.Settings.AttributeLabels.${key}.Name`,
      hint: `YZE.Settings.AttributeLabels.${key}.Hint`,
      scope: "world",
      config: false,
      type: String,
      default: DEFAULT_ATTRIBUTE_LABELS[key],
      requiresReload: true
    });
  }
}

export function getAttributeLabels() {
  return Object.fromEntries(
    ATTRIBUTE_KEYS.map((key) => [
      key,
      game.settings.get(SYSTEM_ID, SETTING_KEYS[key]) || DEFAULT_ATTRIBUTE_LABELS[key]
    ])
  );
}

export function getCharacterHeaderFields() {
  return HEADER_FIELD_DEFAULTS.map((defaultLabel, index) => {
    const slot = index + 1;
    return {
      key: `field${slot}`,
      label: game.settings.get(SYSTEM_ID, `headerField${slot}Label`) || defaultLabel,
      enabled: booleanSetting(`headerField${slot}Enabled`)
    };
  }).filter((field) => field.enabled);
}

export function getPersonalityFields() {
  return Object.entries(PERSONALITY_FIELD_DEFAULTS).map(([key, defaultLabel]) => {
    const prefix = `personality${key[0].toUpperCase()}${key.slice(1)}`;
    return {
      key,
      label: game.settings.get(SYSTEM_ID, `${prefix}Label`) || defaultLabel,
      enabled: booleanSetting(`${prefix}Enabled`)
    };
  });
}

export function isPersonalityEnabled() {
  return getPersonalityFields().some((field) => field.enabled);
}

export function isSuccessfulSkillUseEnabled() {
  const value = game.settings.get(SYSTEM_ID, "trackSuccessfulSkillUse");
  return value === true || value === "true" || value === 1;
}

export function getDiceSystem() {
  const value = game.settings.get(SYSTEM_ID, "diceSystem");
  return Object.values(DICE_SYSTEMS).includes(value) ? value : DICE_SYSTEMS.POOL;
}

export function isStepDiceEnabled() {
  return getDiceSystem() === DICE_SYSTEMS.STEP;
}

export function getStepModifierMethod() {
  const value = game.settings.get(SYSTEM_ID, "stepModifierMethod");
  return Object.values(STEP_MODIFIER_METHODS).includes(value)
    ? value
    : STEP_MODIFIER_METHODS.NUMERICAL;
}

export function getStepRatingLabelStyle() {
  const value = game.settings.get(SYSTEM_ID, "stepRatingLabelStyle");
  return Object.values(STEP_RATING_LABEL_STYLES).includes(value)
    ? value
    : STEP_RATING_LABEL_STYLES.LETTER;
}

/** Format one stepped rating using the world's compact letter or die-size style. */
export function formatStepRatingLabel(value, { none = null } = {}) {
  const rating = getStepRating(value);
  if (rating.value === 0) return none ?? game.i18n.localize("YZE.StepRating.None");
  return getStepRatingLabelStyle() === STEP_RATING_LABEL_STYLES.DIE_SIZE
    ? `D${rating.faces}`
    : rating.grade;
}

function booleanSetting(key) {
  const value = game.settings.get(SYSTEM_ID, key);
  return value === true || value === "true" || value === 1;
}

function choiceSetting(key, choices, fallback) {
  const value = game.settings.get(SYSTEM_ID, key);
  return Object.values(choices).includes(value) ? value : fallback;
}

export function getEncumbranceMode() {
  return choiceSetting("encumbranceMode", ENCUMBRANCE_MODES, ENCUMBRANCE_MODES.DISABLED);
}

export function getConsumableMode() {
  return choiceSetting("consumableMode", CONSUMABLE_MODES, CONSUMABLE_MODES.TRACKING);
}

export function getCriticalInjuryTrigger() {
  const trigger = choiceSetting(
    "criticalInjuryTrigger",
    CRITICAL_INJURY_TRIGGERS,
    CRITICAL_INJURY_TRIGGERS.HEALTH_RESOLVE_ZERO
  );
  if (trigger !== CRITICAL_INJURY_TRIGGERS.BROKEN) return trigger;

  // Worlds created before the explicit SRD trigger choices stored one generic
  // "broken" value. Preserve their intent by resolving it through the active
  // damage model instead of silently changing their rule variant.
  const harmModel = getHarmModel();
  if (harmModel === HARM_MODELS.ATTRIBUTE_DAMAGE) {
    return CRITICAL_INJURY_TRIGGERS.STRENGTH_WITS_ZERO;
  }
  if (harmModel === HARM_MODELS.CONDITIONS) {
    return CRITICAL_INJURY_TRIGGERS.CONDITIONS_BROKEN;
  }
  return CRITICAL_INJURY_TRIGGERS.HEALTH_RESOLVE_ZERO;
}

export function getAmmunitionMode() {
  return choiceSetting("ammunitionMode", AMMUNITION_MODES, AMMUNITION_MODES.UNTRACKED);
}

export function getInitiativeMode() {
  return choiceSetting("initiativeMode", INITIATIVE_MODES, INITIATIVE_MODES.OPEN_CARDS);
}

export function getWorldRuleOptions() {
  return {
    encumbrance: getEncumbranceMode(),
    consumables: getConsumableMode(),
    criticalInjuries: getCriticalInjuryTrigger(),
    ammunition: getAmmunitionMode(),
    initiative: getInitiativeMode()
  };
}

export function getHarmModel() {
  const value = game.settings.get(SYSTEM_ID, "harmModel");
  return Object.values(HARM_MODELS).includes(value)
    ? value
    : HARM_MODELS.DAMAGE_STRESS;
}

export function isStressDiceEnabled() {
  return booleanSetting("useStressDice");
}

export function getPushBaneDamageMode() {
  return choiceSetting(
    "pushBaneDamageMode",
    PUSH_BANE_DAMAGE_MODES,
    PUSH_BANE_DAMAGE_MODES.HARM_MODEL
  );
}

export function isDoomPointsEnabled() {
  return booleanSetting("useDoomPoints");
}

export function isConditionsEnabled() {
  return getHarmModel() === HARM_MODELS.CONDITIONS || booleanSetting("useConditions");
}

export function isPushConditionsEnabled() {
  return booleanSetting("useConditions");
}

export function isWillpowerEnabled() {
  return booleanSetting("useWillpower");
}

export function isCriticalInjuriesEnabled() {
  return booleanSetting("useCriticalInjuries");
}

export function isExperienceEnabled() {
  return booleanSetting("useExperience");
}

export function isCurrencyEnabled() {
  return booleanSetting("useCurrency");
}

export function getCurrencyLabel() {
  return String(game.settings.get(SYSTEM_ID, "currencyLabel") || "Cash").trim() || "Cash";
}

export function isItemPriceEnabled(itemType) {
  return isCurrencyEnabled()
    && ITEM_TYPES.includes(itemType)
    && booleanSetting(currencyPriceSettingKey(itemType));
}

export function isMagicEnabled() {
  return booleanSetting("useMagic");
}

export function isVehicleSubsystemEnabled() {
  return booleanSetting("useVehicles");
}

export function isTravelEnabled() {
  return booleanSetting("useTravel");
}

export function getPushRules() {
  const harmModel = getHarmModel();
  const baneDamage = getPushBaneDamageMode() === PUSH_BANE_DAMAGE_MODES.HARM_MODEL;
  return {
    harmModel,
    baneDamage,
    stressDice: isStressDiceEnabled(),
    doomPoints: isDoomPointsEnabled(),
    conditions: isPushConditionsEnabled(),
    conditionBaneDamage: baneDamage && harmModel === HARM_MODELS.CONDITIONS,
    willpower: isWillpowerEnabled()
  };
}
