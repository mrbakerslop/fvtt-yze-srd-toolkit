import {
  DICE_SYSTEMS,
  HARM_MODELS,
  PUSH_BANE_DAMAGE_MODES,
  STEP_MODIFIER_METHODS,
  SYSTEM_ID
} from "../constants.mjs";
import { openWorldSetupGuide } from "../srd-content/packs.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

const STEPS = Object.freeze(["overview", "dice", "damage", "pushing"]);
const SAVED_SETTING_KEYS = Object.freeze([
  "diceSystem",
  "stepModifierMethod",
  "harmModel",
  "pushBaneDamageMode",
  "useStressDice",
  "useDoomPoints",
  "useConditions"
]);

function selectedChoices(definitions, selected) {
  return definitions.map(([value, label]) => ({ value, label, selected: value === selected }));
}

export class YZEWorldSetup extends HandlebarsApplicationMixin(ApplicationV2) {
  #step = 0;
  #draft = null;

  static DEFAULT_OPTIONS = {
    id: "yze-world-setup",
    classes: ["yze", "world-setup"],
    tag: "form",
    position: { width: 720, height: 680 },
    window: {
      title: "YZE.WorldSetup.Title",
      icon: "fa-solid fa-wand-magic-sparkles",
      resizable: true
    },
    form: { handler: this._onSubmit }
  };

  static PARTS = {
    main: { template: "systems/fvtt-yze-srd/templates/world-setup.hbs" }
  };

  get draft() {
    this.#draft ??= Object.fromEntries([
      ...SAVED_SETTING_KEYS,
      "showWorldSetupOnStartup"
    ].map((key) => [key, game.settings.get(SYSTEM_ID, key)]));
    return this.#draft;
  }

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const key = STEPS[this.#step];
    return foundry.utils.mergeObject(context, {
      step: {
        key,
        title: game.i18n.localize(`YZE.WorldSetup.Steps.${key}.Title`),
        intro: game.i18n.localize(`YZE.WorldSetup.Steps.${key}.Intro`),
        number: this.#step + 1,
        total: STEPS.length,
        isOverview: key === "overview",
        isDice: key === "dice",
        isDamage: key === "damage",
        isPushing: key === "pushing",
        first: this.#step === 0,
        last: this.#step === STEPS.length - 1
      },
      diceSystems: selectedChoices([
        [DICE_SYSTEMS.POOL, "YZE.Settings.DiceSystem.Pool"],
        [DICE_SYSTEMS.STEP, "YZE.Settings.DiceSystem.Step"]
      ], this.draft.diceSystem),
      stepMethods: selectedChoices([
        [STEP_MODIFIER_METHODS.NUMERICAL, "YZE.Settings.StepModifierMethod.Numerical"],
        [STEP_MODIFIER_METHODS.ADVANTAGE, "YZE.Settings.StepModifierMethod.Advantage"]
      ], this.draft.stepModifierMethod),
      damageModels: selectedChoices([
        [HARM_MODELS.DAMAGE_STRESS, "YZE.Settings.HarmModel.DamageStress"],
        [HARM_MODELS.HEALTH_ONLY, "YZE.Settings.HarmModel.HealthOnly"],
        [HARM_MODELS.CONDITIONS, "YZE.Settings.HarmModel.Conditions"],
        [HARM_MODELS.ATTRIBUTE_DAMAGE, "YZE.Settings.HarmModel.AttributeDamage"]
      ], this.draft.harmModel),
      baneDamageModes: selectedChoices([
        [PUSH_BANE_DAMAGE_MODES.HARM_MODEL, "YZE.Settings.PushBaneDamageMode.HarmModel"],
        [PUSH_BANE_DAMAGE_MODES.NONE, "YZE.Settings.PushBaneDamageMode.None"]
      ], this.draft.pushBaneDamageMode),
      draft: this.draft
    }, { inplace: false });
  }

  _captureDraft() {
    for (const input of this.element.querySelectorAll("[name]")) {
      this.draft[input.name] = input.type === "checkbox" ? input.checked : input.value;
    }
  }

  async _onRender(context, options) {
    await super._onRender(context, options);
    this.element.querySelector('[data-action="previous"]')?.addEventListener("click", () => {
      this._captureDraft();
      this.#step = Math.max(0, this.#step - 1);
      this.render({ force: true });
    });
    this.element.querySelector('[data-action="next"]')?.addEventListener("click", () => {
      this._captureDraft();
      this.#step = Math.min(STEPS.length - 1, this.#step + 1);
      this.render({ force: true });
    });
    this.element.querySelector('[data-action="guide"]')?.addEventListener("click", (event) => {
      openWorldSetupGuide(event.currentTarget.dataset.page ?? STEPS[this.#step]);
    });

    const diceSystem = this.element.querySelector('[name="diceSystem"]');
    const stepMethod = this.element.querySelector('[name="stepModifierMethod"]');
    if (diceSystem && stepMethod) {
      const sync = () => {
        stepMethod.disabled = diceSystem.value !== DICE_SYSTEMS.STEP;
        stepMethod.closest(".form-group")?.classList.toggle("is-disabled", stepMethod.disabled);
      };
      diceSystem.addEventListener("change", sync);
      sync();
    }
  }

  static async _onSubmit(event, form) {
    event.preventDefault();
    this._captureDraft();
    let changed = false;
    for (const key of SAVED_SETTING_KEYS) {
      const value = this.draft[key];
      if (game.settings.get(SYSTEM_ID, key) === value) continue;
      await game.settings.set(SYSTEM_ID, key, value);
      changed = true;
    }
    const launchOnStartup = this.draft.showWorldSetupOnStartup === true;
    if (game.settings.get(SYSTEM_ID, "showWorldSetupOnStartup") !== launchOnStartup) {
      await game.settings.set(SYSTEM_ID, "showWorldSetupOnStartup", launchOnStartup);
    }
    ui.notifications.info(game.i18n.localize("YZE.WorldSetup.Saved"));
    await this.close();
    if (changed) foundry.applications.settings.SettingsConfig.reloadConfirm({ world: true });
  }
}

export function launchWorldSetup({ force = false } = {}) {
  if (!game.user?.isGM) return null;
  if (!force && !game.settings.get(SYSTEM_ID, "showWorldSetupOnStartup")) return null;
  const existing = foundry.applications.instances.get("yze-world-setup");
  if (existing) return existing;
  const application = new YZEWorldSetup();
  application.render({ force: true });
  return application;
}
