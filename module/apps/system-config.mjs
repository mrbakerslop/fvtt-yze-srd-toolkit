import {
  AMMUNITION_MODES,
  ATTRIBUTE_KEYS,
  CONSUMABLE_MODES,
  CRITICAL_INJURY_TRIGGERS,
  ENCUMBRANCE_MODES,
  HARM_MODELS,
  INITIATIVE_MODES,
  ITEM_TYPES,
  PUSH_BANE_DAMAGE_MODES,
  currencyPriceSettingKey,
  SYSTEM_ID
} from "../constants.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

const ATTRIBUTE_SETTING_KEYS = Object.freeze({
  strength: "attributeLabelStrength",
  agility: "attributeLabelAgility",
  wits: "attributeLabelWits",
  empathy: "attributeLabelEmpathy"
});

const PUSHING_SETTINGS = Object.freeze([
  ["useStressDice", "YZE.Settings.StressDice.Name", "YZE.Settings.StressDice.Hint"],
  ["useDoomPoints", "YZE.Settings.DoomPoints.Name", "YZE.Settings.DoomPoints.Hint"],
  ["useConditions", "YZE.Settings.Conditions.Name", "YZE.Settings.Conditions.Hint"]
]);

const PUSHING_SELECT_SETTINGS = Object.freeze([
  ["pushBaneDamageMode", "YZE.Settings.PushBaneDamageMode.Name", "YZE.Settings.PushBaneDamageMode.Hint", [
    [PUSH_BANE_DAMAGE_MODES.HARM_MODEL, "YZE.Settings.PushBaneDamageMode.HarmModel"],
    [PUSH_BANE_DAMAGE_MODES.NONE, "YZE.Settings.PushBaneDamageMode.None"]
  ]]
]);

const DOOM_MANAGER_ROLE_KEY = "doomManagerRole";

const CHARACTER_FEATURE_SETTINGS = Object.freeze([
  ["trackSuccessfulSkillUse", "YZE.Settings.TrackSuccessfulSkillUse.Name", "YZE.Settings.TrackSuccessfulSkillUse.Hint"],
  ["useWillpower", "YZE.Settings.Willpower.Name", "YZE.Settings.Willpower.Hint"],
  ["useCriticalInjuries", "YZE.Settings.CriticalInjuries.Name", "YZE.Settings.CriticalInjuries.Hint"],
  ["useExperience", "YZE.Settings.Experience.Name", "YZE.Settings.Experience.Hint"]
]);

const CURRENCY_SETTINGS = Object.freeze([
  ["useCurrency", "YZE.Settings.Currency.Name", "YZE.Settings.Currency.Hint"]
]);

const CURRENCY_SETTING_KEYS = Object.freeze([
  "useCurrency",
  "currencyLabel",
  ...ITEM_TYPES.map(currencyPriceSettingKey)
]);

const OPTIONAL_SUBSYSTEM_SETTINGS = Object.freeze([
  ["useMagic", "YZE.Settings.Magic.Name", "YZE.Settings.Magic.Hint"],
  ["useVehicles", "YZE.Settings.Vehicles.Name", "YZE.Settings.Vehicles.Hint"],
  ["useTravel", "YZE.Settings.Travel.Name", "YZE.Settings.Travel.Hint"]
]);

const RULE_VARIANT_SETTINGS = Object.freeze([
  ["encumbranceMode", "YZE.Settings.EncumbranceMode.Name", "YZE.Settings.EncumbranceMode.Hint", [
    [ENCUMBRANCE_MODES.STANDARD, "YZE.Settings.EncumbranceMode.Standard"],
    [ENCUMBRANCE_MODES.WEAPONS_AT_HAND, "YZE.Settings.EncumbranceMode.WeaponsAtHand"],
    [ENCUMBRANCE_MODES.DISABLED, "YZE.Settings.EncumbranceMode.Disabled"]
  ]],
  ["consumableMode", "YZE.Settings.ConsumableMode.Name", "YZE.Settings.ConsumableMode.Hint", [
    [CONSUMABLE_MODES.TRACKING, "YZE.Settings.ConsumableMode.Tracking"],
    [CONSUMABLE_MODES.SUPPLY, "YZE.Settings.ConsumableMode.Supply"]
  ]],
  ["criticalInjuryTrigger", "YZE.Settings.CriticalInjuryTrigger.Name", "YZE.Settings.CriticalInjuryTrigger.Hint", [
    [CRITICAL_INJURY_TRIGGERS.HEALTH_RESOLVE_ZERO, "YZE.Settings.CriticalInjuryTrigger.HealthResolveZero"],
    [CRITICAL_INJURY_TRIGGERS.STRENGTH_WITS_ZERO, "YZE.Settings.CriticalInjuryTrigger.StrengthWitsZero"],
    [CRITICAL_INJURY_TRIGGERS.CONDITIONS_BROKEN, "YZE.Settings.CriticalInjuryTrigger.ConditionsBroken"],
    [CRITICAL_INJURY_TRIGGERS.DAMAGE_THRESHOLD, "YZE.Settings.CriticalInjuryTrigger.DamageThreshold"],
    [CRITICAL_INJURY_TRIGGERS.SUCCESS_THRESHOLD, "YZE.Settings.CriticalInjuryTrigger.SuccessThreshold"]
  ]],
  ["ammunitionMode", "YZE.Settings.AmmunitionMode.Name", "YZE.Settings.AmmunitionMode.Hint", [
    [AMMUNITION_MODES.UNTRACKED, "YZE.Settings.AmmunitionMode.Untracked"],
    [AMMUNITION_MODES.TRACKING, "YZE.Settings.AmmunitionMode.Tracking"],
    [AMMUNITION_MODES.SUPPLY, "YZE.Settings.AmmunitionMode.Supply"],
    [AMMUNITION_MODES.AMMO_DICE, "YZE.Settings.AmmunitionMode.AmmoDice"]
  ]],
  ["initiativeMode", "YZE.Settings.InitiativeMode.Name", "YZE.Settings.InitiativeMode.Hint", [
    [INITIATIVE_MODES.OPEN_CARDS, "YZE.Settings.InitiativeMode.OpenCards"],
    [INITIATIVE_MODES.HIDDEN_CARDS, "YZE.Settings.InitiativeMode.HiddenCards"]
  ]]
]);

const ATTRIBUTE_LABEL_SETTING_KEYS = Object.freeze(Object.values(ATTRIBUTE_SETTING_KEYS));
const HEADER_FIELD_SETTING_KEYS = Object.freeze(
  Array.from({ length: 6 }, (_value, index) => [
    `headerField${index + 1}Enabled`,
    `headerField${index + 1}Label`
  ]).flat()
);
const PERSONALITY_FIELDS = Object.freeze([
  "pride", "weakness", "darkSecret", "bigDream", "buddy", "relationships"
]);
const PERSONALITY_FIELD_SETTING_KEYS = Object.freeze(PERSONALITY_FIELDS.flatMap((key) => {
  const prefix = `personality${key[0].toUpperCase()}${key.slice(1)}`;
  return [`${prefix}Enabled`, `${prefix}Label`];
}));

export const SUBMENU_SETTING_KEYS = Object.freeze([
  ...PUSHING_SETTINGS.map(([key]) => key),
  ...PUSHING_SELECT_SETTINGS.map(([key]) => key),
  DOOM_MANAGER_ROLE_KEY,
  ...CHARACTER_FEATURE_SETTINGS.map(([key]) => key),
  ...CURRENCY_SETTING_KEYS,
  ...OPTIONAL_SUBSYSTEM_SETTINGS.map(([key]) => key),
  ...RULE_VARIANT_SETTINGS.map(([key]) => key),
  ...ATTRIBUTE_LABEL_SETTING_KEYS,
  ...HEADER_FIELD_SETTING_KEYS,
  ...PERSONALITY_FIELD_SETTING_KEYS
]);

function asBoolean(value) {
  return value === true || value === "true" || value === 1;
}

function booleanSetting([key, nameKey, hintKey]) {
  return {
    key,
    name: game.i18n.localize(nameKey),
    hint: game.i18n.localize(hintKey),
    checked: asBoolean(game.settings.get(SYSTEM_ID, key)),
    disabled: false
  };
}

function selectSetting([key, nameKey, hintKey, choices]) {
  let selected = String(game.settings.get(SYSTEM_ID, key));
  if (key === "criticalInjuryTrigger" && selected === CRITICAL_INJURY_TRIGGERS.BROKEN) {
    const harmModel = String(game.settings.get(SYSTEM_ID, "harmModel"));
    selected = harmModel === HARM_MODELS.ATTRIBUTE_DAMAGE
      ? CRITICAL_INJURY_TRIGGERS.STRENGTH_WITS_ZERO
      : harmModel === HARM_MODELS.CONDITIONS
        ? CRITICAL_INJURY_TRIGGERS.CONDITIONS_BROKEN
        : CRITICAL_INJURY_TRIGGERS.HEALTH_RESOLVE_ZERO;
  }
  return {
    key,
    name: game.i18n.localize(nameKey),
    hint: game.i18n.localize(hintKey),
    choices: choices.map(([value, labelKey]) => ({
      value,
      label: game.i18n.localize(labelKey),
      selected: selected === value
    }))
  };
}

class YZESettingsSection extends HandlebarsApplicationMixin(ApplicationV2) {
  static SETTING_KEYS = [];

  static DEFAULT_OPTIONS = {
    classes: ["yze", "system-config"],
    tag: "form",
    position: {
      width: 680,
      height: 620
    },
    window: {
      icon: "fa-solid fa-gears",
      resizable: true
    },
    form: {
      handler: this._onSubmit
    }
  };

  static PARTS = {
    main: {
      template: "systems/fvtt-yze-srd/templates/system-config.hbs"
    }
  };

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    context.sectionTitle = game.i18n.localize(this.constructor.SECTION_TITLE_KEY);
    context.intro = game.i18n.localize(this.constructor.INTRO_KEY);
    context.settings = (this.constructor.SETTING_DEFINITIONS ?? []).map(booleanSetting);
    context.selectSettings = (this.constructor.SELECT_DEFINITIONS ?? []).map(selectSetting);

    if (this.constructor.INCLUDE_DOOM_MANAGER_ROLE) {
      const selectedRole = String(game.settings.get(SYSTEM_ID, DOOM_MANAGER_ROLE_KEY));
      context.doomManagerRole = {
        key: DOOM_MANAGER_ROLE_KEY,
        name: game.i18n.localize("YZE.Settings.DoomManagerRole.Name"),
        hint: game.i18n.localize("YZE.Settings.DoomManagerRole.Hint"),
        choices: [
          [CONST.USER_ROLES.GAMEMASTER, "YZE.Settings.DoomManagerRole.GameMaster"],
          [CONST.USER_ROLES.ASSISTANT, "YZE.Settings.DoomManagerRole.Assistant"],
          [CONST.USER_ROLES.TRUSTED, "YZE.Settings.DoomManagerRole.Trusted"]
        ].map(([role, labelKey]) => ({
          value: String(role),
          label: game.i18n.localize(labelKey),
          selected: selectedRole === String(role)
        }))
      };
    }

    if (this.constructor.INCLUDE_ATTRIBUTE_LABELS) {
      context.attributeLabels = ATTRIBUTE_KEYS.map((key) => ({
        key: ATTRIBUTE_SETTING_KEYS[key],
        name: game.i18n.localize(`YZE.Settings.AttributeLabels.${key}.Name`),
        hint: game.i18n.localize(`YZE.Settings.AttributeLabels.${key}.Hint`),
        value: game.settings.get(SYSTEM_ID, ATTRIBUTE_SETTING_KEYS[key])
      }));
    }

    if (this.constructor.INCLUDE_HEADER_FIELDS) {
      context.headerFields = Array.from({ length: 6 }, (_value, index) => {
        const slot = index + 1;
        return {
          slot,
          enabledKey: `headerField${slot}Enabled`,
          labelKey: `headerField${slot}Label`,
          enabled: asBoolean(game.settings.get(SYSTEM_ID, `headerField${slot}Enabled`)),
          label: game.settings.get(SYSTEM_ID, `headerField${slot}Label`),
          enabledHint: game.i18n.localize(`YZE.Settings.HeaderFields.Field${slot}.EnabledHint`)
        };
      });
    }

    if (this.constructor.INCLUDE_PERSONALITY_FIELDS) {
      context.personalityFields = PERSONALITY_FIELDS.map((key) => {
        const prefix = `personality${key[0].toUpperCase()}${key.slice(1)}`;
        return {
          key,
          enabledKey: `${prefix}Enabled`,
          labelKey: `${prefix}Label`,
          enabled: asBoolean(game.settings.get(SYSTEM_ID, `${prefix}Enabled`)),
          label: game.settings.get(SYSTEM_ID, `${prefix}Label`),
          defaultName: game.i18n.localize(`YZE.Personality.Defaults.${key}`)
        };
      });
    }

    if (this.constructor.INCLUDE_CURRENCY) {
      context.currency = {
        labelKey: "currencyLabel",
        label: game.settings.get(SYSTEM_ID, "currencyLabel"),
        itemTypes: ITEM_TYPES.map((type) => ({
          type,
          key: currencyPriceSettingKey(type),
          name: game.i18n.localize(`YZE.Settings.Currency.ItemTypes.${type}`),
          checked: asBoolean(game.settings.get(SYSTEM_ID, currencyPriceSettingKey(type)))
        }))
      };
    }

    return context;
  }

  async _onRender(context, options) {
    await super._onRender(context, options);

    for (const row of this.element.querySelectorAll("[data-header-field], [data-personality-field]")) {
      const checkbox = row.querySelector("input[type='checkbox']");
      const labelInput = row.querySelector("input[type='text']");
      if (!checkbox || !labelInput) continue;

      const sync = () => {
        labelInput.disabled = !checkbox.checked;
        row.classList.toggle("is-disabled", !checkbox.checked);
      };
      checkbox.addEventListener("change", sync);
      sync();
    }

    const currency = this.element.querySelector("[data-currency-config]");
    const currencyToggle = this.element.querySelector('[name="useCurrency"]');
    if (currency && currencyToggle) {
      const sync = () => {
        const disabled = !currencyToggle.checked;
        currency.classList.toggle("is-disabled", disabled);
        for (const input of currency.querySelectorAll("input")) input.disabled = disabled;
      };
      currencyToggle.addEventListener("change", sync);
      sync();
    }
  }

  static async _onSubmit(event, form) {
    let changed = false;

    for (const key of this.constructor.SETTING_KEYS) {
      const input = form.elements.namedItem(key);
      if (!input || input.disabled) continue;

      const value = input.type === "checkbox" ? input.checked : input.value;
      if (game.settings.get(SYSTEM_ID, key) === value) continue;

      await game.settings.set(SYSTEM_ID, key, value);
      changed = true;
    }

    if (changed) {
      ui.notifications.info(game.i18n.localize("YZE.Settings.Config.Saved"));
    }
    await this.close();
  }
}

export class YZEPushingConfig extends YZESettingsSection {
  static SETTING_DEFINITIONS = PUSHING_SETTINGS;
  static SELECT_DEFINITIONS = PUSHING_SELECT_SETTINGS;
  static SETTING_KEYS = [
    ...PUSHING_SETTINGS.map(([key]) => key),
    ...PUSHING_SELECT_SETTINGS.map(([key]) => key),
    DOOM_MANAGER_ROLE_KEY
  ];
  static SECTION_TITLE_KEY = "YZE.Settings.Config.PushingConsequences";
  static INTRO_KEY = "YZE.Settings.Config.PushingIntro";
  static INCLUDE_DOOM_MANAGER_ROLE = true;

  static DEFAULT_OPTIONS = {
    id: "yze-pushing-config",
    position: { height: 640 },
    window: { title: "YZE.Settings.Config.PushingConsequences" }
  };
}

export class YZECharacterFeaturesConfig extends YZESettingsSection {
  static SETTING_DEFINITIONS = CHARACTER_FEATURE_SETTINGS;
  static SETTING_KEYS = CHARACTER_FEATURE_SETTINGS.map(([key]) => key);
  static SECTION_TITLE_KEY = "YZE.Settings.Config.CharacterFeatures";
  static INTRO_KEY = "YZE.Settings.Config.CharacterFeaturesIntro";

  static DEFAULT_OPTIONS = {
    id: "yze-character-features-config",
    position: { height: 590 },
    window: { title: "YZE.Settings.Config.CharacterFeatures" }
  };
}

export class YZECurrencyConfig extends YZESettingsSection {
  static SETTING_DEFINITIONS = CURRENCY_SETTINGS;
  static SETTING_KEYS = CURRENCY_SETTING_KEYS;
  static SECTION_TITLE_KEY = "YZE.Settings.Config.Currency";
  static INTRO_KEY = "YZE.Settings.Config.CurrencyIntro";
  static INCLUDE_CURRENCY = true;

  static DEFAULT_OPTIONS = {
    id: "yze-currency-config",
    position: { height: 760 },
    window: { title: "YZE.Settings.Config.Currency" }
  };
}

export class YZEOptionalSubsystemsConfig extends YZESettingsSection {
  static SETTING_DEFINITIONS = OPTIONAL_SUBSYSTEM_SETTINGS;
  static SETTING_KEYS = OPTIONAL_SUBSYSTEM_SETTINGS.map(([key]) => key);
  static SECTION_TITLE_KEY = "YZE.Settings.Config.OptionalSubsystems";
  static INTRO_KEY = "YZE.Settings.Config.OptionalSubsystemsIntro";

  static DEFAULT_OPTIONS = {
    id: "yze-optional-subsystems-config",
    position: { height: 470 },
    window: { title: "YZE.Settings.Config.OptionalSubsystems" }
  };
}

export class YZERuleVariantsConfig extends YZESettingsSection {
  static SELECT_DEFINITIONS = RULE_VARIANT_SETTINGS;
  static SETTING_KEYS = RULE_VARIANT_SETTINGS.map(([key]) => key);
  static SECTION_TITLE_KEY = "YZE.Settings.Config.RuleVariants";
  static INTRO_KEY = "YZE.Settings.Config.RuleVariantsIntro";

  static DEFAULT_OPTIONS = {
    id: "yze-rule-variants-config",
    position: { height: 690 },
    window: { title: "YZE.Settings.Config.RuleVariants" }
  };
}

export class YZEAttributeNamesConfig extends YZESettingsSection {
  static SETTING_KEYS = ATTRIBUTE_LABEL_SETTING_KEYS;
  static SECTION_TITLE_KEY = "YZE.Settings.Config.AttributeNames";
  static INTRO_KEY = "YZE.Settings.Config.AttributeNamesIntro";
  static INCLUDE_ATTRIBUTE_LABELS = true;

  static DEFAULT_OPTIONS = {
    id: "yze-attribute-names-config",
    position: { height: 540 },
    window: { title: "YZE.Settings.Config.AttributeNames" }
  };
}

export class YZEHeaderFieldsConfig extends YZESettingsSection {
  static SETTING_KEYS = HEADER_FIELD_SETTING_KEYS;
  static SECTION_TITLE_KEY = "YZE.Settings.Config.HeaderFields";
  static INTRO_KEY = "YZE.Settings.Config.HeaderFieldsHint";
  static INCLUDE_HEADER_FIELDS = true;

  static DEFAULT_OPTIONS = {
    id: "yze-header-fields-config",
    position: { height: 760 },
    window: { title: "YZE.Settings.Config.HeaderFields" }
  };
}

export class YZEPersonalityFieldsConfig extends YZESettingsSection {
  static SETTING_KEYS = PERSONALITY_FIELD_SETTING_KEYS;
  static SECTION_TITLE_KEY = "YZE.Settings.Config.PersonalityFields";
  static INTRO_KEY = "YZE.Settings.Config.PersonalityFieldsIntro";
  static INCLUDE_PERSONALITY_FIELDS = true;

  static DEFAULT_OPTIONS = {
    id: "yze-personality-fields-config",
    position: { height: 760 },
    window: { title: "YZE.Settings.Config.PersonalityFields" }
  };
}
