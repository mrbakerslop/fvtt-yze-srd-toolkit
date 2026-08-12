import {
  AMMUNITION_MODES,
  ATTRIBUTE_KEYS,
  CONSUMABLE_MODES,
  CRITICAL_INJURY_TRIGGERS,
  SPECIALTY_EFFECTS,
  STEP_RATINGS
} from "../constants.mjs";
import {
  getAmmunitionMode,
  getAttributeLabels,
  getConsumableMode,
  getCriticalInjuryTrigger,
  getCurrencyLabel,
  formatStepRatingLabel,
  isCriticalInjuriesEnabled,
  isMagicEnabled,
  isItemPriceEnabled,
  isStepDiceEnabled,
  isSuccessfulSkillUseEnabled
} from "../settings.mjs";
import { ITEM_EFFECT_TYPES, SPELL_EFFECT_TYPES, skillEffectTarget } from "../item-effects.mjs";

const { ItemSheetV2 } = foundry.applications.sheets;
const { HandlebarsApplicationMixin } = foundry.applications.api;

export class YZEItemSheet extends HandlebarsApplicationMixin(ItemSheetV2) {
  static DEFAULT_OPTIONS = {
    classes: ["yze", "item-sheet"],
    position: {
      width: 560,
      height: 520
    },
    window: {
      resizable: true
    },
    form: {
      closeOnSubmit: false,
      submitOnChange: true
    },
    actions: {
      addItemEffect: this._onAddItemEffect,
      removeItemEffect: this._onRemoveItemEffect,
      addArchetypeEntry: this._onAddArchetypeEntry,
      removeArchetypeEntry: this._onRemoveArchetypeEntry
    }
  };

  static PARTS = {
    main: {
      template: "systems/fvtt-yze-srd/templates/item-sheet.hbs"
    }
  };

  static TABS = {
    sheet: {
      tabs: [
        { id: "attributes", icon: "fa-solid fa-sliders", label: "YZE.Tabs.ItemAttributes" },
        { id: "description", icon: "fa-solid fa-align-left", label: "YZE.Tabs.Description" },
        { id: "effects", icon: "fa-solid fa-bolt", label: "YZE.Tabs.ItemEffects" }
      ],
      initial: "attributes"
    }
  };

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const labels = getAttributeLabels();

    context.item = this.item;
    context.system = this.item.system;
    context.showPrice = isItemPriceEnabled(this.item.type);
    context.priceLabel = game.i18n.format("YZE.Currency.ItemPriceLabel", {
      currency: getCurrencyLabel()
    });
    context.isArchetype = this.item.type === "archetype";
    context.showItemEffects = !context.isArchetype;
    if (!context.showItemEffects) {
      context.tabs = Object.fromEntries(
        Object.entries(context.tabs).filter(([id]) => id !== "effects")
      );
    }
    context.isSkill = this.item.type === "skill";
    context.useStepDice = isStepDiceEnabled();
    context.stepRatingOptions = STEP_RATINGS.map((rating) => ({
      value: rating.value,
      label: formatStepRatingLabel(rating.value),
      selected: Number(this.item.system.stepRating) === rating.value
    }));
    context.showSuccessfulUse = isSuccessfulSkillUseEnabled();
    context.isSpecialty = this.item.type === "specialty";
    context.specialtyEffectOptions = [
      { value: "", label: game.i18n.localize("YZE.Specialty.Effects.custom") },
      ...Object.values(SPECIALTY_EFFECTS).map((value) => ({
        value,
        label: game.i18n.localize(`YZE.Specialty.Effects.${value}`),
        selected: this.item.system.effect === value
      }))
    ];
    context.specialtyEffectOptions[0].selected = !this.item.system.effect;
    context.showSpecialtyTarget = this.item.system.effect === SPECIALTY_EFFECTS.WEAPON_SPECIALIST;
    context.showMagicFields = context.isSpecialty && isMagicEnabled();
    context.isVehicleComponent = this.item.type === "vehicleComponent";
    context.isGear = this.item.type === "gear";
    context.isWeapon = this.item.type === "weapon";
    context.artifactDieOptions = [0, 8, 10, 12].map((faces) => ({
      value: faces,
      label: faces === 0 ? game.i18n.localize("YZE.Item.NoArtifactDie") : `D${faces}`,
      selected: Number(this.item.system.artifactDie) === faces
    }));
    const ammunitionMode = getAmmunitionMode();
    const criticalTrigger = getCriticalInjuryTrigger();
    context.showAmmunitionTracking = context.isWeapon
      && [
        AMMUNITION_MODES.TRACKING,
        AMMUNITION_MODES.SUPPLY,
        AMMUNITION_MODES.AMMO_DICE
      ].includes(ammunitionMode);
    context.showAmmunitionSupply = context.isWeapon && ammunitionMode === AMMUNITION_MODES.SUPPLY;
    context.showRateOfFire = context.isWeapon && ammunitionMode === AMMUNITION_MODES.AMMO_DICE;
    context.showBasicAutofire = context.isWeapon && ammunitionMode !== AMMUNITION_MODES.AMMO_DICE;
    context.reloadActionOptions = ["slow", "fast"].map((value) => ({
      value,
      label: game.i18n.localize(`YZE.Combat.ReloadActions.${value}`),
      selected: this.item.system.reloadAction === value
    }));
    context.showCriticalWeaponFields = context.isWeapon && isCriticalInjuriesEnabled()
      && [
        CRITICAL_INJURY_TRIGGERS.DAMAGE_THRESHOLD,
        CRITICAL_INJURY_TRIGGERS.SUCCESS_THRESHOLD
      ].includes(criticalTrigger);
    context.showCriticalThreshold = context.showCriticalWeaponFields
      && criticalTrigger === CRITICAL_INJURY_TRIGGERS.DAMAGE_THRESHOLD;
    context.usesReliability = context.useStepDice && (context.isGear || context.isWeapon);
    context.isArmor = this.item.type === "armor";
    context.armorRatingOptions = STEP_RATINGS.map((rating) => ({
      value: rating.value,
      label: formatStepRatingLabel(rating.value),
      selected: Number(this.item.system.stepRating) === rating.value
    }));
    context.armorMaximumOptions = STEP_RATINGS.map((rating) => ({
      value: rating.value,
      label: formatStepRatingLabel(rating.value),
      selected: Number(this.item.system.maxStepRating) === rating.value
    }));
    context.isConsumable = this.item.type === "consumable";
    context.useSupplyConsumables = context.isConsumable
      && getConsumableMode() === CONSUMABLE_MODES.SUPPLY;
    context.isFood = context.isConsumable && this.item.system.foodType !== "none";
    context.foodTypeOptions = ["none", "prepared", "plants", "meat", "fish"].map((value) => ({
      value,
      label: game.i18n.localize(`YZE.Food.Types.${value}`),
      selected: this.item.system.foodType === value
    }));
    context.foodStateOptions = ["safe", "raw", "unsafe"].map((value) => ({
      value,
      label: game.i18n.localize(`YZE.Food.States.${value}`),
      selected: this.item.system.foodState === value
    }));
    context.showQuantity = !context.useSupplyConsumables;
    context.showWeight = !context.useSupplyConsumables;
    context.isSpell = this.item.type === "spell";
    context.isCriticalInjury = this.item.type === "criticalInjury";
    context.canStabilizeInjury = context.isCriticalInjury
      && this.item.system.lethal === true && this.item.system.instantDeath !== true;
    context.showInjuryDeathSaveFields = context.canStabilizeInjury;
    context.canSetInjuryHealing = context.isCriticalInjury && this.item.system.permanent !== true;
    context.isCarryable = ["gear", "weapon", "armor", "consumable"].includes(this.item.type);
    context.componentTypeOptions = ["engine", "mobility", "weapon", "utility"].map((key) => ({
      key,
      label: game.i18n.localize(`YZE.Vehicle.ComponentTypes.${key}`),
      selected: this.item.system.componentType === key
    }));
    context.rangeOptions = ["engaged", "short", "medium", "long", "extreme"].map((key) => ({
      key,
      label: game.i18n.localize(`YZE.Range.${key}`),
      selected: this.item.system.range === key
    }));
    context.attributeOptions = ATTRIBUTE_KEYS.map((key) => ({
      key,
      label: labels[key],
      selected: this.item.system.attribute === key
    }));
    context.injuryCategoryOptions = ["physical", "mental"].map((key) => ({
      key,
      label: game.i18n.localize(`YZE.CriticalInjury.${key}`),
      selected: this.item.system.category === key
    }));
    context.injuryLocationOptions = ["", "head", "arms", "torso", "legs"].map((value) => ({
      value,
      label: game.i18n.localize(`YZE.CriticalInjury.Locations.${value || "none"}`),
      selected: this.item.system.location === value
    }));
    context.injuryHealingOptions = ["", "D6", "2D6", "3D6"].map((value) => ({
      value,
      label: game.i18n.localize(`YZE.CriticalInjury.HealingOptions.${value || "none"}`),
      selected: this.item.system.healingTime === value
    }));
    context.injuryDeathIntervalOptions = ["", "Round", "Stretch", "Shift", "Day"].map((value) => ({
      value,
      label: game.i18n.localize(`YZE.CriticalInjury.DeathIntervals.${value || "none"}`),
      selected: String(this.item.system.timeLimit).toLowerCase() === value.toLowerCase()
    }));
    context.injuryMovementOptions = ["", "slow", "none"].map((value) => ({
      value,
      label: game.i18n.localize(`YZE.CriticalInjury.MovementOptions.${value || "normal"}`),
      selected: this.item.system.movementRestriction === value
    }));
    context.injurySleepOptions = ["", "insight", "daylight"].map((value) => ({
      value,
      label: game.i18n.localize(`YZE.CriticalInjury.SleepOptions.${value || "normal"}`),
      selected: this.item.system.sleepRestriction === value
    }));
    context.injuryTriggerOptions = ["", "phobia", "alcohol", "claustrophobia", "hallucinations"].map((value) => ({
      value,
      label: game.i18n.localize(`YZE.CriticalInjury.TriggerOptions.${value || "none"}`),
      selected: this.item.system.triggerKind === value
    }));
    context.injurySpecialRuleOptions = ["", "rupturedIntestines", "crackedSpine", "healingRollEnds"].map((value) => ({
      value,
      label: game.i18n.localize(`YZE.CriticalInjury.SpecialRules.${value || "none"}`),
      selected: this.item.system.specialRule === value
    }));
    if (context.isArchetype) {
      const visibleItems = [...game.items].filter((item) => item.visible !== false);
      const skills = visibleItems.filter((item) => item.type === "skill")
        .sort((left, right) => left.name.localeCompare(right.name));
      const specialties = visibleItems.filter((item) => item.type === "specialty")
        .sort((left, right) => left.name.localeCompare(right.name));
      const equipment = visibleItems.filter((item) => (
        ["gear", "weapon", "armor", "consumable"].includes(item.type)
      )).sort((left, right) => left.name.localeCompare(right.name));
      const entryRows = (field, sources) => (this.item.system[field] ?? []).map((uuid, index) => ({
        index,
        options: sources.map((source) => ({
          value: source.uuid,
          label: source.name,
          selected: source.uuid === uuid
        }))
      }));
      context.archetypeAttributeOptions = ATTRIBUTE_KEYS.map((key) => ({
        value: key,
        label: labels[key],
        selected: this.item.system.keyAttribute === key
      }));
      context.archetypeKeySkills = entryRows("keySkills", skills);
      context.archetypeSpecialties = entryRows("availableSpecialties", specialties);
      context.archetypeGrantedItems = entryRows("grantedItems", equipment);
      context.archetypeEquipment = entryRows("availableEquipment", equipment);
      context.archetypeSpecialtyMaximum = context.archetypeSpecialties.length;
      context.archetypeEquipmentMaximum = context.archetypeEquipment.length;
    }
    const attributeTargets = ATTRIBUTE_KEYS.map((key) => ({ value: key, label: labels[key] }));
    const skillDocuments = [
      ...game.items.filter((item) => item.type === "skill"),
      ...(this.item.parent?.documentName === "Actor"
        ? this.item.parent.items.filter((item) => item.type === "skill")
        : [])
    ];
    const skillNames = [...new Map(skillDocuments.map((item) => [
      item.name.trim().toLocaleLowerCase(), item.name
    ])).entries()];
    const injuryEffectTypes = [
      ITEM_EFFECT_TYPES.AUTOMATIC_ROLL_MODIFIER,
      ITEM_EFFECT_TYPES.INJURY_MOVEMENT,
      ITEM_EFFECT_TYPES.INJURY_HANDS,
      ITEM_EFFECT_TYPES.INJURY_BLOCK_ROLLS,
      ITEM_EFFECT_TYPES.INJURY_ROLL_DAMAGE,
      ITEM_EFFECT_TYPES.INJURY_SLEEP,
      ITEM_EFFECT_TYPES.INJURY_TRIGGER,
      ITEM_EFFECT_TYPES.INJURY_SPECIAL_RULE
    ];
    const effectTypes = this.item.type === "spell"
      ? SPELL_EFFECT_TYPES
      : this.item.type === "criticalInjury"
        ? injuryEffectTypes
        : Object.values(ITEM_EFFECT_TYPES).filter((value) => (
          !SPELL_EFFECT_TYPES.includes(value) && !injuryEffectTypes.includes(value)
        ));
    const effects = this.item.toObject().system.effects ?? [];
    for (const effect of effects) {
      const skillTarget = effect.type === ITEM_EFFECT_TYPES.ALTERNATE_ATTRIBUTE
        ? effect.target
        : String(effect.target ?? "").startsWith("skill:")
          ? String(effect.target).slice(6)
          : "";
      if (!skillTarget || skillNames.some(([value]) => value === skillTarget)) continue;
      skillNames.push([skillTarget, skillTarget]);
    }
    skillNames.sort((left, right) => left[1].localeCompare(right[1]));
    context.itemEffects = effects.map((effect, index) => ({
      ...effect,
      index,
      isRollModifier: [
        ITEM_EFFECT_TYPES.ROLL_MODIFIER,
        ITEM_EFFECT_TYPES.AUTOMATIC_ROLL_MODIFIER
      ].includes(effect.type),
      isCarryCapacityMultiplier: effect.type === ITEM_EFFECT_TYPES.CARRY_CAPACITY_MULTIPLIER,
      isExtraPush: effect.type === ITEM_EFFECT_TYPES.EXTRA_PUSH,
      isAlternateAttribute: effect.type === ITEM_EFFECT_TYPES.ALTERNATE_ATTRIBUTE,
      isInitiativeCards: effect.type === ITEM_EFFECT_TYPES.INITIATIVE_CARDS,
      isHealingTime: effect.type === ITEM_EFFECT_TYPES.HEALING_TIME,
      isDerivedStat: effect.type === ITEM_EFFECT_TYPES.DERIVED_STAT,
      isHitInterception: effect.type === ITEM_EFFECT_TYPES.HIT_INTERCEPTION,
      usesDefaultInterceptionSkill: effect.type === ITEM_EFFECT_TYPES.HIT_INTERCEPTION
        && !skillNames.some(([value]) => value === effect.target),
      isCoupDeGrace: effect.type === ITEM_EFFECT_TYPES.COUP_DE_GRACE,
      isWillpowerActivation: effect.type === ITEM_EFFECT_TYPES.WILLPOWER_ACTIVATION,
      isDoomExpenditure: effect.type === ITEM_EFFECT_TYPES.DOOM_EXPENDITURE,
      isInjuryMovement: effect.type === ITEM_EFFECT_TYPES.INJURY_MOVEMENT,
      isInjuryHands: effect.type === ITEM_EFFECT_TYPES.INJURY_HANDS,
      isInjuryBlockRolls: effect.type === ITEM_EFFECT_TYPES.INJURY_BLOCK_ROLLS,
      isInjuryRollDamage: effect.type === ITEM_EFFECT_TYPES.INJURY_ROLL_DAMAGE,
      isInjurySleep: effect.type === ITEM_EFFECT_TYPES.INJURY_SLEEP,
      injurySleepNeedsSkill: effect.type === ITEM_EFFECT_TYPES.INJURY_SLEEP && effect.mode === "insight",
      isInjuryTrigger: effect.type === ITEM_EFFECT_TYPES.INJURY_TRIGGER,
      isInjurySpecialRule: effect.type === ITEM_EFFECT_TYPES.INJURY_SPECIAL_RULE,
      isResourceActivation: [
        ITEM_EFFECT_TYPES.WILLPOWER_ACTIVATION,
        ITEM_EFFECT_TYPES.DOOM_EXPENDITURE
      ].includes(effect.type),
      isSpellEffect: SPELL_EFFECT_TYPES.includes(effect.type),
      isSpellDamage: effect.type === ITEM_EFFECT_TYPES.SPELL_DAMAGE,
      isSpellRecovery: effect.type === ITEM_EFFECT_TYPES.SPELL_RECOVERY,
      isSpellModifier: effect.type === ITEM_EFFECT_TYPES.SPELL_MODIFIER,
      isSpellResource: effect.type === ITEM_EFFECT_TYPES.SPELL_RESOURCE,
      isSpellStatus: effect.type === ITEM_EFFECT_TYPES.SPELL_STATUS,
      isSpellArmor: effect.type === ITEM_EFFECT_TYPES.SPELL_ARMOR,
      isSpellAutomaticSuccess: effect.type === ITEM_EFFECT_TYPES.SPELL_AUTOMATIC_SUCCESS,
      isSpellItemDamage: effect.type === ITEM_EFFECT_TYPES.SPELL_ITEM_DAMAGE,
      isSpellCriticalInjury: effect.type === ITEM_EFFECT_TYPES.SPELL_CRITICAL_INJURY,
      isSpellHazard: effect.type === ITEM_EFFECT_TYPES.SPELL_HAZARD,
      isSpellWorkflow: effect.type === ITEM_EFFECT_TYPES.SPELL_WORKFLOW,
      isSpellOpposedWorkflow: effect.type === ITEM_EFFECT_TYPES.SPELL_WORKFLOW
        && effect.handler === "opposedTest",
      spellHasAmount: [
        ITEM_EFFECT_TYPES.SPELL_DAMAGE,
        ITEM_EFFECT_TYPES.SPELL_RECOVERY,
        ITEM_EFFECT_TYPES.SPELL_MODIFIER,
        ITEM_EFFECT_TYPES.SPELL_RESOURCE,
        ITEM_EFFECT_TYPES.SPELL_ARMOR,
        ITEM_EFFECT_TYPES.SPELL_AUTOMATIC_SUCCESS,
        ITEM_EFFECT_TYPES.SPELL_ITEM_DAMAGE,
        ITEM_EFFECT_TYPES.SPELL_HAZARD
      ].includes(effect.type),
      spellHasDuration: [
        ITEM_EFFECT_TYPES.SPELL_MODIFIER,
        ITEM_EFFECT_TYPES.SPELL_RESOURCE,
        ITEM_EFFECT_TYPES.SPELL_STATUS,
        ITEM_EFFECT_TYPES.SPELL_ARMOR,
        ITEM_EFFECT_TYPES.SPELL_AUTOMATIC_SUCCESS,
        ITEM_EFFECT_TYPES.SPELL_HAZARD
      ].includes(effect.type),
      typeOptions: effectTypes.map((value) => ({
        value, label: game.i18n.localize(`YZE.ItemEffects.Types.${value}`), selected: effect.type === value
      })),
      allRollsSelected: effect.target === "all",
      attributeTargetOptions: attributeTargets.map((option) => ({
        ...option, selected: effect.target === option.value
      })),
      skillTargetOptions: skillNames.map(([value, label]) => ({
        value: skillEffectTarget(value), label, selected: effect.target === skillEffectTarget(value)
      })),
      replacementAttributeOptions: ATTRIBUTE_KEYS.map((key) => ({
        value: key, label: labels[key], selected: effect.attribute === key
      })),
      skillOptions: skillNames.map(([value, label]) => ({
        value, label, selected: effect.target === value
      })),
      injurySkillOptions: skillNames.map(([value, label]) => ({
        value, label, selected: effect.target === value
      })),
      injuryAttributeOptions: attributeTargets.map((option) => ({
        ...option, selected: effect.target === option.value
      })),
      injuryMovementOptions: ["slow", "none"].map((value) => ({
        value,
        label: game.i18n.localize(`YZE.CriticalInjury.MovementOptions.${value}`),
        selected: effect.mode === value
      })),
      injuryHandOptions: [1, 2].map((value) => ({
        value,
        label: game.i18n.format("YZE.CriticalInjury.DisabledHands", { count: value }),
        selected: Number(effect.value) === value
      })),
      injurySleepOptions: ["insight", "daylight"].map((value) => ({
        value,
        label: game.i18n.localize(`YZE.CriticalInjury.SleepOptions.${value}`),
        selected: effect.mode === value
      })),
      injuryTriggerOptions: ["phobia", "alcohol", "claustrophobia", "hallucinations"].map((value) => ({
        value,
        label: game.i18n.localize(`YZE.CriticalInjury.TriggerOptions.${value}`),
        selected: effect.mode === value
      })),
      injurySpecialRuleOptions: ["rupturedIntestines", "crackedSpine", "healingRollEnds"].map((value) => ({
        value,
        label: game.i18n.localize(`YZE.CriticalInjury.SpecialRules.${value}`),
        selected: effect.mode === value
      })),
      modifierOptions: Array.from({ length: 11 }, (_, offset) => offset - 5)
        .filter((value) => value !== 0)
        .map((value) => ({ value, label: value > 0 ? `+${value}` : String(value), selected: Number(effect.value) === value })),
      countOptions: Array.from({ length: 5 }, (_, offset) => offset + 1)
        .map((value) => ({ value, label: `+${value}`, selected: Number(effect.value) === value })),
      healingOptions: [25, 50, 75, 100, 125, 150, 200].map((value) => ({
        value, label: `${value}%`, selected: Number(effect.value) === value
      })),
      derivedOptions: Array.from({ length: 21 }, (_, offset) => offset - 10)
        .filter((value) => value !== 0)
        .map((value) => ({ value, label: value > 0 ? `+${value}` : String(value), selected: Number(effect.value) === value })),
      derivedTargetOptions: ["health", "resolve", "carry"].map((value) => ({
        value, label: game.i18n.localize(`YZE.ItemEffects.Derived.${value}`), selected: effect.target === value
      })),
      spellTargetOptions: ["self", "firstSelected", "selected", "casterAndSelected"].map((value) => ({
        value, label: game.i18n.localize(`YZE.SpellEffects.Targets.${value}`), selected: effect.targetMode === value
      })),
      spellCategoryOptions: ["physical", "mental", "stress"].map((value) => ({
        value, label: value === "stress"
          ? game.i18n.localize("YZE.SpellEffects.Stress")
          : game.i18n.localize(`YZE.CriticalInjury.${value}`), selected: effect.category === value
      })),
      spellResourceOptions: [
        "health", "resolve", "willpower", "stress", "strength", "agility", "wits", "empathy"
      ].map((value) => ({
        value,
        label: labels[value] ?? game.i18n.localize(`YZE.SpellEffects.Resources.${value}`),
        selected: effect.resource === value
      })),
      spellResourceModeOptions: ["gain", "lose", "transfer", "store"].map((value) => ({
        value, label: game.i18n.localize(`YZE.SpellEffects.ResourceModes.${value}`), selected: effect.mode === value
      })),
      spellAutomaticModeOptions: ["add", "replace"].map((value) => ({
        value, label: game.i18n.localize(`YZE.SpellEffects.AutomaticModes.${value}`), selected: (effect.mode || "add") === value
      })),
      spellOpposedModeOptions: ["resistance", "opposed"].map((value) => ({
        value, label: game.i18n.localize(`YZE.SpellEffects.OpposedModes.${value}`), selected: (effect.mode || "resistance") === value
      })),
      spellItemModeOptions: ["gearBonus", "reliability", "destroy", "food"].map((value) => ({
        value, label: game.i18n.localize(`YZE.SpellEffects.ItemModes.${value}`), selected: effect.mode === value
      })),
      spellInjuryModeOptions: ["heal", "resurrect"].map((value) => ({
        value, label: game.i18n.localize(`YZE.SpellEffects.InjuryModes.${value}`), selected: effect.mode === value
      })),
      spellHazardOptions: ["fire", "disease", "poison", "chill", "suffocation", "bloodCurse", "weather"].map((value) => ({
        value, label: game.i18n.localize(`YZE.SpellEffects.Hazards.${value}`), selected: effect.handler === value
      })),
      spellWorkflowOptions: [
        "narrative", "gmQuestion", "yesNoQuestion", "opposedTest", "resourceTransfer",
        "powerRequirement", "cureHazard", "distributeDamage", "forceStanding", "transform", "summon", "dispel", "bindMagic", "storeWillpower"
      ].map((value) => ({
        value, label: game.i18n.localize(`YZE.SpellEffects.Workflows.${value}`), selected: effect.handler === value
      }))
    }));

    return context;
  }

  async _onRender(context, options) {
    await super._onRender(context, options);

    const showSuccessfulUse = isSuccessfulSkillUseEnabled();
    for (const element of this.element.querySelectorAll("[data-successful-use]")) {
      element.hidden = !showSuccessfulUse;
    }
  }

  static async _onAddItemEffect() {
    const effects = foundry.utils.deepClone(this.item.toObject().system.effects ?? []);
    effects.push({
      id: foundry.utils.randomID(),
      active: true,
      type: this.item.type === "spell"
        ? ITEM_EFFECT_TYPES.SPELL_WORKFLOW
        : this.item.type === "criticalInjury"
          ? ITEM_EFFECT_TYPES.AUTOMATIC_ROLL_MODIFIER
          : ITEM_EFFECT_TYPES.ROLL_MODIFIER,
      application: this.item.type === "spell" ? "spell" : "passive",
      target: "all",
      attribute: "",
      label: "",
      description: "",
      targetMode: this.item.type === "spell" ? "selected" : "",
      scaling: "",
      category: "physical",
      resource: "",
      mode: "",
      duration: "",
      handler: this.item.type === "spell" ? "narrative" : "",
      filter: "",
      status: "",
      affectedAttributes: "",
      affectedSkills: "",
      armorApplies: false,
      multiplier: 0,
      value: 1
    });
    await this.item.update({ "system.effects": effects });
  }

  static async _onRemoveItemEffect(event, target) {
    const index = Number(target.closest("[data-effect-index]")?.dataset.effectIndex);
    if (!Number.isInteger(index)) return;
    const effects = foundry.utils.deepClone(this.item.toObject().system.effects ?? []);
    effects.splice(index, 1);
    await this.item.update({ "system.effects": effects });
  }

  static async _onAddArchetypeEntry(event, target) {
    const field = target.dataset.field;
    const types = {
      keySkills: ["skill"],
      availableSpecialties: ["specialty"],
      grantedItems: ["gear", "weapon", "armor", "consumable"],
      availableEquipment: ["gear", "weapon", "armor", "consumable"]
    }[field];
    if (!types || this.item.type !== "archetype") return;
    const source = [...game.items]
      .filter((item) => types.includes(item.type) && item.visible !== false)
      .find((item) => !(this.item.system[field] ?? []).includes(item.uuid));
    if (!source) {
      ui.notifications.warn(game.i18n.localize("YZE.CharacterCreation.NoAvailableEntry"));
      return;
    }
    await this.item.update({ [`system.${field}`]: [...this.item.system[field], source.uuid] });
  }

  static async _onRemoveArchetypeEntry(event, target) {
    const row = target.closest("[data-archetype-field]");
    const field = row?.dataset.archetypeField;
    const index = Number(row?.dataset.entryIndex);
    if (!field || !Number.isInteger(index) || !Array.isArray(this.item.system[field])) return;
    const entries = [...this.item.system[field]];
    entries.splice(index, 1);
    await this.item.update({ [`system.${field}`]: entries });
  }
}
