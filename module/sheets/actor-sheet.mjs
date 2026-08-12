import {
  AMMUNITION_MODES,
  ATTRIBUTE_KEYS,
  ATTRIBUTE_GROUPS,
  CONSUMABLE_MODES,
  CONDITIONS,
  HARM_MODELS,
  SPECIALTY_EFFECTS,
  STEP_RATINGS
} from "../constants.mjs";
import {
  getAmmunitionMode,
  getConsumableMode,
  getCharacterHeaderFields,
  getCurrencyLabel,
  getPersonalityFields,
  getHarmModel,
  getAttributeLabels,
  formatStepRatingLabel,
  isCriticalInjuriesEnabled,
  isConditionsEnabled,
  isCurrencyEnabled,
  isExperienceEnabled,
  isMagicEnabled,
  isStepDiceEnabled,
  isStressDiceEnabled,
  isSuccessfulSkillUseEnabled,
  isTravelEnabled,
  isVehicleSubsystemEnabled,
  isWillpowerEnabled
} from "../settings.mjs";
import { actorEncumbrance } from "../encumbrance.mjs";
import {
  criticalInjurySleepSkill,
  criticalInjuryTriggerKind,
  getActorBrokenState,
  getCriticalInjuryRestrictions,
  rollCriticalInjury,
  triggerCriticalInjury
} from "../critical-injuries.mjs";
import {
  advanceActor,
  awardSessionExperience,
  promptExperienceAdjustment
} from "../advancement.mjs";
import {
  advancedCombatState,
  attackWithWeapon,
  assumeOverwatch,
  breakGrapple,
  cancelOverwatch,
  cancelPreparedAim,
  combatActionState,
  fireOverwatch,
  leaveCover,
  promptInitiativeExchange,
  prepareTelescopicAim,
  releaseGrapple,
  reloadWeapon,
  resetActorActions,
  retreat,
  takeCover,
  toggleProne,
  spendActorActions
} from "../combat.mjs";
import {
  promptManualDamage,
  promptManualRecovery,
  recoverShift,
  relieveStress
} from "../harm.mjs";
import {
  promptArmorRepair,
  promptGearRepair,
  promptHealingRoll,
  promptSecondWind
} from "../recovery-card.mjs";
import { rollConsumableSupply, transferConsumableSupply } from "../equipment.mjs";
import { consumeFood, foodStatusLabel, isFoodItem } from "../food.mjs";
import { panicSheetState, rollPanic } from "../panic.mjs";
import { promptWillpowerChange } from "../willpower.mjs";
import { castSpell, clearMagicEffect, magicEffects } from "../magic.mjs";
import { drawChaseObstacle, endChase, chaseStateFor, promptChaseManeuver, startChase } from "../chases.mjs";
import { advanceTravelShift, getTravelClock, performMountedTravel, performTravelActivity, travelLedger } from "../travel.mjs";
import { clearTravelRoute, configureTravelMap, planTravelRoute, travelMapState } from "../travel-map.mjs";
import { mountForRider, promptMountedMovement } from "../mounts.mjs";
import {
  activeSpecialties,
  effectiveHealingTime,
  specialtyEffectLabel
} from "../specialties.mjs";
import { injuryRecoveryState } from "../injury-timing.mjs";
import {
  environmentalHazardSheetState,
  extinguishEnvironmentalFire,
  promptEnvironmentalHazard,
  promptStressfulSituation,
  resolveEnvironmentalInterval
} from "../environmental-hazards.mjs";
import { clearEnvironmentalHazard } from "../hazard-state.mjs";
import { startCharacterCreation } from "../character-creation.mjs";
import { attemptLocks, clearAllAttemptLocks, clearAttemptLock } from "../attempts.mjs";
import {
  consumeSneakAttack,
  pendingSneakAttack,
  promptAmbush,
  promptSneakAttack,
  promptSurpriseInitiative
} from "../surprise.mjs";
import { canBypassCoupEmpathy, performCoupDeGrace } from "../coup-de-grace.mjs";
import { promptResourceEffect, resourceActivationEffects } from "../resource-effects.mjs";
import { ITEM_EFFECT_TYPES, itemEffects } from "../item-effects.mjs";

const { ActorSheetV2 } = foundry.applications.sheets;
const { HandlebarsApplicationMixin } = foundry.applications.api;

function stepOptions(selected, { includeNone = false } = {}) {
  return STEP_RATINGS
    .filter((rating) => includeNone || rating.value > 0)
    .map((rating) => ({
      value: rating.value,
      label: formatStepRatingLabel(rating.value),
      selected: Number(selected) === rating.value
    }));
}

function normalizedLabel(value) {
  return String(value ?? "").trim().toLocaleLowerCase();
}

function magicEffectSummary(effect) {
  const parts = [];
  const modifier = Number(effect.modifier) || 0;
  if (modifier) parts.push(game.i18n.format("YZE.Magic.EffectModifier", {
    value: modifier > 0 ? `+${modifier}` : String(modifier)
  }));
  if (Number(effect.automaticSuccesses) > 0) parts.push(game.i18n.format(
    effect.replaceRoll ? "YZE.Magic.EffectReplacementSuccesses" : "YZE.Magic.EffectAutomaticSuccesses",
    { value: effect.automaticSuccesses }
  ));
  if (Number(effect.armor) > 0 || Number(effect.armorStep) > 0) parts.push(game.i18n.format(
    "YZE.Magic.EffectArmor",
    { value: isStepDiceEnabled() ? `D${STEP_RATINGS.find((entry) => entry.value === Number(effect.armorStep))?.faces ?? 6}` : effect.armor }
  ));
  if (Number(effect.resourceGrant) > 0) parts.push(game.i18n.format("YZE.Magic.EffectTemporaryResource", {
    value: effect.resourceGrant,
    resource: effect.resource
  }));
  if (parts.length === 0 && effect.kind && effect.kind !== "spell") {
    parts.push(String(effect.kind).replaceAll("-", " "));
  }
  return parts.join(" · ");
}

function injuryRestrictionLabels(item, attributeLabels) {
  const labels = [];
  const effects = (type) => itemEffects(item, type);
  const movement = String(
    effects(ITEM_EFFECT_TYPES.INJURY_MOVEMENT)[0]?.mode
    || item.system.movementRestriction
    || ""
  );
  if (movement) labels.push(game.i18n.localize(`YZE.CriticalInjury.MovementOptions.${movement}`));
  const handEffects = effects(ITEM_EFFECT_TYPES.INJURY_HANDS);
  const disabledHands = handEffects.length > 0
    ? handEffects.reduce((total, effect) => total + Math.max(0, Number(effect.value) || 0), 0)
    : Math.max(0, Math.trunc(Number(item.system.disabledHands) || 0));
  if (disabledHands > 0) {
    labels.push(game.i18n.format("YZE.CriticalInjury.DisabledHands", { count: disabledHands }));
  }
  const blockEffects = effects(ITEM_EFFECT_TYPES.INJURY_BLOCK_ROLLS);
  const blocked = (blockEffects.length > 0
    ? blockEffects.map((effect) => effect.target)
    : String(item.system.blockedAttributes || "").split(","))
    .map((key) => String(key).trim().toLowerCase()).filter(Boolean)
    .map((key) => attributeLabels[key] ?? key);
  if (blocked.length > 0) {
    labels.push(game.i18n.format("YZE.CriticalInjury.BlockedAttributes", {
      attributes: blocked.join(", ")
    }));
  }
  if (item.system.blocksActions === true) {
    labels.push(game.i18n.localize("YZE.CriticalInjury.BlocksActions"));
  }
  const sleep = String(
    effects(ITEM_EFFECT_TYPES.INJURY_SLEEP)[0]?.mode
    || item.system.sleepRestriction
    || ""
  );
  if (sleep === "insight") {
    labels.push(game.i18n.format("YZE.CriticalInjury.SleepCheckRequired", {
      skill: criticalInjurySleepSkill(item)
    }));
  } else if (sleep) {
    labels.push(game.i18n.localize(`YZE.CriticalInjury.SleepOptions.${sleep}`));
  }
  return labels;
}

export class YZEActorSheet extends HandlebarsApplicationMixin(ActorSheetV2) {
  static DEFAULT_OPTIONS = {
    classes: ["yze", "actor-sheet"],
    position: {
      width: 850,
      height: 850
    },
    window: {
      resizable: true
    },
    form: {
      closeOnSubmit: false,
      submitOnChange: true
    },
    actions: {
      rollAttribute: this._onRollAttribute,
      rollSkill: this._onRollSkill,
      rollCriticalInjury: this._onRollCriticalInjury,
      rollDeathSave: this._onRollDeathSave,
      secondWind: this._onSecondWind,
      awardExperience: this._onAwardExperience,
      advanceCharacter: this._onAdvanceCharacter,
      adjustExperience: this._onAdjustExperience,
      attackWeapon: this._onAttackWeapon,
      reloadWeapon: this._onReloadWeapon,
      takeCover: this._onTakeCover,
      leaveCover: this._onLeaveCover,
      toggleProne: this._onToggleProne,
      assumeOverwatch: this._onAssumeOverwatch,
      fireOverwatch: this._onFireOverwatch,
      cancelOverwatch: this._onCancelOverwatch,
      prepareTelescopicAim: this._onPrepareTelescopicAim,
      cancelPreparedAim: this._onCancelPreparedAim,
      breakGrapple: this._onBreakGrapple,
      releaseGrapple: this._onReleaseGrapple,
      retreat: this._onRetreat,
      spendFastAction: this._onSpendFastAction,
      spendSlowAction: this._onSpendSlowAction,
      resetCombatActions: this._onResetCombatActions,
      clearAttempt: this._onClearAttempt,
      clearAllAttempts: this._onClearAllAttempts,
      sneakAttack: this._onSneakAttack,
      resolveAmbush: this._onResolveAmbush,
      surpriseInitiative: this._onSurpriseInitiative,
      cancelSneakAttack: this._onCancelSneakAttack,
      coupDeGrace: this._onCoupDeGrace,
      exchangeInitiative: this._onExchangeInitiative,
      applyDamage: this._onApplyDamage,
      manualRecovery: this._onManualRecovery,
      recoverShift: this._onRecoverShift,
      healingRoll: this._onHealingRoll,
      relieveStress: this._onRelieveStress,
      repairArmor: this._onRepairArmor,
      repairGear: this._onRepairGear,
      rollSupply: this._onRollSupply,
      transferSupply: this._onTransferSupply,
      consumeFood: this._onConsumeFood,
      rollPanic: this._onRollPanic,
      gainWillpower: this._onGainWillpower,
      spendWillpower: this._onSpendWillpower,
      activateResourceEffect: this._onActivateResourceEffect,
      castSpell: this._onCastSpell,
      clearMagicEffect: this._onClearMagicEffect,
      chaseManeuver: this._onChaseManeuver,
      chaseObstacle: this._onChaseObstacle,
      startChase: this._onStartChase,
      endChase: this._onEndChase,
      openMount: this._onOpenMount,
      mountedMove: this._onMountedMove,
      mountedTravel: this._onMountedTravel,
      travelActivity: this._onTravelActivity,
      advanceTravelShift: this._onAdvanceTravelShift,
      configureTravelMap: this._onConfigureTravelMap,
      planTravelRoute: this._onPlanTravelRoute,
      clearTravelRoute: this._onClearTravelRoute,
      environmentalHazard: this._onEnvironmentalHazard,
      stressfulSituation: this._onStressfulSituation,
      characterCreation: this._onCharacterCreation,
      resolveEnvironmentalHazard: this._onResolveEnvironmentalHazard,
      clearEnvironmentalHazard: this._onClearEnvironmentalHazard,
      extinguishEnvironmentalFire: this._onExtinguishEnvironmentalFire,
      addRelationship: this._onAddRelationship,
      removeRelationship: this._onRemoveRelationship,
      removeCriticalInjury: this._onRemoveCriticalInjury,
      triggerCriticalInjury: this._onTriggerCriticalInjury,
      editItem: this._onEditItem
    }
  };

  static TABS = {
    sheet: {
      tabs: [
        { id: "general", icon: "fa-solid fa-user", label: "YZE.Tabs.General" },
        { id: "state", icon: "fa-solid fa-heart-pulse", label: "YZE.Tabs.State" },
        { id: "inventory", icon: "fa-solid fa-box-open", label: "YZE.Tabs.Inventory" },
        { id: "specialties", icon: "fa-solid fa-star", label: "YZE.Tabs.Specialties" },
        { id: "personality", icon: "fa-solid fa-heart", label: "YZE.Tabs.Personality" },
        { id: "experience", icon: "fa-solid fa-book", label: "YZE.Tabs.Experience" },
        { id: "spells", icon: "fa-solid fa-wand-sparkles", label: "YZE.Tabs.Spells" },
        { id: "travel", icon: "fa-solid fa-route", label: "YZE.Tabs.Travel" },
        { id: "notes", icon: "fa-solid fa-note-sticky", label: "YZE.Tabs.Notes" }
      ],
      initial: "general"
    }
  };

  static PARTS = {
    main: {
      template: "systems/fvtt-yze-srd/templates/actor-sheet.hbs"
    }
  };

  /** Add initial character creation as a direct title-bar action. */
  _getFrameButtons(options) {
    const buttons = super._getFrameButtons(options);
    const canCreate = this.actor.type === "character"
      && this.actor.system.creation?.completed !== true
      && (this.actor.isOwner !== false || game.user?.isGM === true);
    if (canCreate) buttons.unshift({
      icon: "fa-solid fa-user-plus",
      label: "YZE.CharacterCreation.Start",
      action: "characterCreation"
    });
    return buttons;
  }

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const labels = getAttributeLabels();
    const useStepDice = isStepDiceEnabled();
    const harmModel = getHarmModel();
    const useAttributeDamage = harmModel === HARM_MODELS.ATTRIBUTE_DAMAGE;
    const useHealthOnly = harmModel === HARM_MODELS.HEALTH_ONLY;
    const useConditionDamage = harmModel === HARM_MODELS.CONDITIONS;
    const showSuccessfulUse = isSuccessfulSkillUseEnabled();
    const skills = this.actor.items
      .filter((item) => item.type === "skill")
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((item) => ({
        id: item.id,
        name: item.name,
        rating: item.system.rating,
        stepRating: item.system.stepRating,
        stepOptions: stepOptions(item.system.stepRating, { includeNone: true }),
        useStepDice,
        attribute: item.system.attribute,
        usedSuccessfully: item.system.usedSuccessfully,
        showSuccessfulUse,
        description: item.system.description
      }));

    context.actor = this.actor;
    context.system = this.actor.system;
    context.showCurrency = this.actor.type === "character" && isCurrencyEnabled();
    context.currencyLabel = getCurrencyLabel();
    context.showSuccessfulUse = showSuccessfulUse;
    const archetypeUuid = this.actor.system.creation?.archetypeUuid;
    const archetype = archetypeUuid
      ? game.items.find((item) => item.uuid === archetypeUuid)
      : null;
    const archetypeLabel = normalizedLabel(game.i18n.localize("YZE.CharacterCreation.Archetype"));
    context.useStepDice = useStepDice;
    context.headerFields = getCharacterHeaderFields().map((field) => {
      const isArchetype = this.actor.type === "character"
        && normalizedLabel(field.label) === archetypeLabel;
      return {
        ...field,
        isArchetype,
        value: isArchetype && archetype?.name
          ? archetype.name
          : this.actor.system.details?.[field.key] ?? ""
      };
    });
    const personalityFields = Object.fromEntries(
      getPersonalityFields().map((field) => [field.key, field])
    );
    context.showPersonality = this.actor.type === "character"
      && Object.values(personalityFields).some((field) => field.enabled);
    context.personalityFields = personalityFields;
    context.canViewSecrets = this.actor.isOwner !== false || game.user?.isGM === true;
    const relationshipActors = [...game.actors]
      .filter((actor) => actor.type === "character" && actor.id !== this.actor.id && actor.visible !== false)
      .sort((left, right) => left.name.localeCompare(right.name));
    const relationshipOptions = (selectedUuid, { includeNone = false } = {}) => {
      const options = [
        ...(includeNone ? [{ value: "", label: game.i18n.localize("YZE.Common.None"), selected: !selectedUuid }] : []),
        ...relationshipActors.map((actor) => ({
        value: actor.uuid,
        label: actor.name,
        selected: actor.uuid === selectedUuid
        }))
      ];
      if (selectedUuid && !options.some((option) => option.value === selectedUuid)) {
        options.push({
          value: selectedUuid,
          label: game.i18n.localize("YZE.Personality.UnknownCharacter"),
          selected: true
        });
      }
      return options;
    };
    if (personalityFields.buddy?.enabled) {
      context.buddyOptions = relationshipOptions(this.actor.system.personality?.buddyUuid, {
        includeNone: true
      });
    }
    context.relationships = (this.actor.system.personality?.relationships ?? []).map((relationship, index) => ({
      ...relationship,
      index,
      actorOptions: relationshipOptions(relationship.actorUuid, { includeNone: true })
    }));
    context.attributeRows = ATTRIBUTE_KEYS.map((key) => ({
      key,
      label: labels[key],
      group: ATTRIBUTE_GROUPS[key],
      value: this.actor.system.attributes[key].value,
      stepRating: this.actor.system.attributes[key].stepRating,
      maximum: useStepDice
        ? this.actor.system.attributes[key].maxStepRating
        : this.actor.system.attributes[key].maxValue,
      showMaximum: useAttributeDamage,
      minimum: useAttributeDamage ? 0 : 1,
      stepOptions: stepOptions(this.actor.system.attributes[key].stepRating, {
        includeNone: useAttributeDamage
      }),
      maximumStepOptions: stepOptions(this.actor.system.attributes[key].maxStepRating, {
        includeNone: true
      }),
      useStepDice,
      skills: skills.filter((skill) => skill.attribute === key)
    }));
    context.useAttributeDamage = useAttributeDamage;
    context.showHealth = !useAttributeDamage && !useConditionDamage;
    context.showResolve = !useAttributeDamage && !useHealthOnly && !useConditionDamage;
    context.showStress = isStressDiceEnabled();
    context.showConditions = isConditionsEnabled();
    context.showMagic = isMagicEnabled();
    context.showVehicleSubsystem = isVehicleSubsystemEnabled();
    context.chaseTracker = chaseStateFor(this.actor);
    context.currentMount = mountForRider(this.actor);
    context.showTravel = isTravelEnabled();
    context.showWillpower = isWillpowerEnabled() || context.showMagic;
    const ammunitionMode = getAmmunitionMode();
    context.showAmmunitionTracking = [
      AMMUNITION_MODES.TRACKING,
      AMMUNITION_MODES.SUPPLY,
      AMMUNITION_MODES.AMMO_DICE
    ].includes(ammunitionMode);
    context.showAmmunitionSupply = ammunitionMode === AMMUNITION_MODES.SUPPLY;
    context.showRateOfFire = ammunitionMode === AMMUNITION_MODES.AMMO_DICE;
    context.useSupplyConsumables = getConsumableMode() === CONSUMABLE_MODES.SUPPLY;
    context.encumbrance = actorEncumbrance(this.actor);
    context.isGM = game.user?.isGM === true;
    context.panic = panicSheetState(this.actor);
    context.showCriticalInjuries = isCriticalInjuriesEnabled();
    context.showExperience = isExperienceEnabled();
    context.canManageExperience = this.actor.isOwner !== false || game.user?.isGM === true;
    const experienceDate = new Intl.DateTimeFormat(game.i18n.lang, {
      dateStyle: "medium",
      timeStyle: "short"
    });
    const signedNumber = new Intl.NumberFormat(game.i18n.lang, { signDisplay: "always" });
    context.experienceLedger = [...(this.actor.system.experienceLedger ?? [])]
      .sort((left, right) => Number(right.timestamp) - Number(left.timestamp))
      .map((entry) => ({
        ...entry,
        typeLabel: game.i18n.localize(`YZE.Advancement.LedgerTypes.${entry.type}`),
        amountLabel: signedNumber.format(Number(entry.amount) || 0),
        amountClass: Number(entry.amount) >= 0 ? "is-award" : "is-spend",
        timestampLabel: Number(entry.timestamp) > 0
          ? experienceDate.format(new Date(Number(entry.timestamp)))
          : game.i18n.localize("YZE.Advancement.UnknownDate")
      }));
    if (!context.showExperience) {
      context.tabs = Object.fromEntries(
        Object.entries(context.tabs).filter(([id]) => id !== "experience")
      );
    }
    if (!context.showMagic) {
      context.tabs = Object.fromEntries(
        Object.entries(context.tabs).filter(([id]) => id !== "spells")
      );
    }
    if (!context.showTravel) {
      context.tabs = Object.fromEntries(
        Object.entries(context.tabs).filter(([id]) => id !== "travel")
      );
    } else {
      context.travelClock = getTravelClock();
      context.travelClock.summary = game.i18n.format("YZE.Travel.ClockSummary", {
        day: context.travelClock.day,
        shift: game.i18n.localize(`YZE.Travel.Shifts.${context.travelClock.shift}`),
        weather: game.i18n.localize(`YZE.Travel.Weather.${context.travelClock.weather}`)
      });
      context.travelTasks = travelLedger(this.actor).tasks?.[`${context.travelClock.day}:${context.travelClock.shift}`] ?? [];
      context.travelTaskSummary = context.travelTasks.map((key) => game.i18n.localize(`YZE.Travel.Activities.${key}`)).join(", ");
      context.canAdvanceTravel = game.user?.isGM === true;
      context.travelMap = travelMapState();
    }
    if (!context.showPersonality) {
      context.tabs = Object.fromEntries(
        Object.entries(context.tabs).filter(([id]) => id !== "personality")
      );
    }
    context.conditionGroups = Object.entries(CONDITIONS).map(([group, keys]) => ({
      group,
      label: game.i18n.localize(`YZE.Conditions.${group}.Label`),
      conditions: keys.map((key) => ({
        key,
        label: game.i18n.localize(`YZE.Conditions.${key}`),
        checked: this.actor.system.conditions?.[key] === true
      }))
    }));
    context.brokenState = getActorBrokenState(this.actor);
    const secondWind = activeSpecialties(this.actor, SPECIALTY_EFFECTS.SECOND_WIND)[0];
    context.secondWind = {
      show: context.brokenState.broken && Boolean(secondWind),
      used: secondWind?.system.used === true
    };
    context.allowManualBroken = context.showConditions
      || this.actor.system.broken?.physical === true
      || this.actor.system.broken?.mental === true;
    const injuryRestrictions = getCriticalInjuryRestrictions(this.actor);
    context.criticalInjuryRestrictionSummary = [];
    if (injuryRestrictions.blocksActions) {
      context.criticalInjuryRestrictionSummary.push(
        game.i18n.localize("YZE.CriticalInjury.BlocksActions")
      );
    }
    if (injuryRestrictions.movement) {
      context.criticalInjuryRestrictionSummary.push(
        game.i18n.localize(`YZE.CriticalInjury.MovementOptions.${injuryRestrictions.movement}`)
      );
    }
    if (injuryRestrictions.disabledHands > 0) {
      context.criticalInjuryRestrictionSummary.push(game.i18n.format(
        "YZE.CriticalInjury.UsableHands", { count: 2 - injuryRestrictions.disabledHands }
      ));
    }
    if (injuryRestrictions.blockedAttributes.size > 0) {
      const blocked = [...injuryRestrictions.blockedAttributes.keys()]
        .map((key) => labels[key] ?? key);
      context.criticalInjuryRestrictionSummary.push(game.i18n.format(
        "YZE.CriticalInjury.BlockedAttributes", { attributes: blocked.join(", ") }
      ));
    }
    if (injuryRestrictions.sleepInsight.length > 0) {
      const sleepSkills = [...new Set(injuryRestrictions.sleepInsight.map((item) => (
        criticalInjurySleepSkill(item)
      )))];
      context.criticalInjuryRestrictionSummary.push(game.i18n.format(
        "YZE.CriticalInjury.SleepCheckRequired", { skill: sleepSkills.join(" / ") }
      ));
    }
    if (injuryRestrictions.sleepDaylight.length > 0) {
      context.criticalInjuryRestrictionSummary.push(
        game.i18n.localize("YZE.CriticalInjury.SleepOptions.daylight")
      );
    }
    context.criticalInjuries = this.actor.items
      .filter((item) => item.type === "criticalInjury")
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((item) => {
        const recovery = injuryRecoveryState(item);
        return ({
        id: item.id,
        name: item.name,
        active: item.system.active,
        category: item.system.category,
        categoryLabel: game.i18n.localize(`YZE.CriticalInjury.${item.system.category}`),
        lethal: item.system.lethal,
        permanent: item.system.permanent,
        instantDeath: item.system.instantDeath,
        stabilized: item.system.stabilized,
        canRollDeathSave: item.system.active && item.system.lethal
          && !item.system.stabilized && !item.system.instantDeath
          && this.actor.system.dead !== true && recovery.deathSaveDue,
        deathSaveDue: recovery.deathSaveDue,
        treatmentLocked: recovery.treatmentLocked,
        timedRecovery: recovery.timed,
        recoveryRemaining: recovery.remainingDays,
        recoveryTotal: recovery.totalDays,
        timeLimit: item.system.timeLimit,
        healingTime: effectiveHealingTime(this.actor, item.system.healingTime),
        rollModifier: item.system.rollModifier,
        restrictionLabels: injuryRestrictionLabels(item, labels),
        locationLabel: game.i18n.localize(`YZE.CriticalInjury.Locations.${item.system.location || "none"}`),
        canTrigger: item.system.active === true && Boolean(criticalInjuryTriggerKind(item)),
        description: item.system.description
        });
      });
    context.specialties = this.actor.items
      .filter((item) => item.type === "specialty")
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((item) => {
        const activations = resourceActivationEffects(this.actor, item);
        return {
          id: item.id,
          name: item.name,
          system: item.system,
          effectLabel: specialtyEffectLabel(item),
          isMagicDiscipline: item.system.magicDiscipline === true,
          hasResourceActivations: activations.length > 0,
          resourceActivationCount: activations.length
        };
      });
    context.resourcePowers = [...this.actor.items]
      .flatMap((item) => resourceActivationEffects(this.actor, item).map((effect) => ({
        itemId: item.id,
        itemName: item.name,
        effectId: effect.id,
        name: String(effect.label || item.name),
        description: String(effect.description || ""),
        cost: Math.max(1, Math.min(99, Math.trunc(Number(effect.value) || 1))),
        resource: game.i18n.localize(
          effect.type === ITEM_EFFECT_TYPES.WILLPOWER_ACTIVATION
            ? "YZE.Actor.Willpower"
            : "YZE.Doom.Title"
        )
      })))
      .sort((left, right) => left.name.localeCompare(right.name));
    context.hasResourcePowers = context.resourcePowers.length > 0;
    context.gear = this.actor.items
      .filter((item) => item.type === "gear")
      .sort((a, b) => a.name.localeCompare(b.name));
    context.consumables = this.actor.items
      .filter((item) => item.type === "consumable")
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((item) => ({
        id: item.id,
        name: item.name,
        system: item.system,
        isFood: isFoodItem(item),
        foodStatus: foodStatusLabel(item)
      }));
    context.weapons = this.actor.items
      .filter((item) => item.type === "weapon")
      .sort((a, b) => a.name.localeCompare(b.name));
    context.armor = this.actor.items
      .filter((item) => item.type === "armor")
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((item) => ({
        id: item.id,
        name: item.name,
        system: item.system,
        rating: useStepDice ? item.system.stepRating : item.system.rating,
        maximum: useStepDice ? item.system.maxStepRating : item.system.maxRating,
        ratingOptions: stepOptions(item.system.stepRating, { includeNone: true }),
        maximumOptions: stepOptions(item.system.maxStepRating, { includeNone: true })
      }));
    context.spells = this.actor.items
      .filter((item) => item.type === "spell")
      .sort((a, b) => a.name.localeCompare(b.name));
    context.magicEffects = magicEffects(this.actor).map((effect) => ({
      ...effect,
      summary: magicEffectSummary(effect),
      expires: effect.combatId && Number(effect.endsCombatRound) > 0
        ? game.i18n.format("YZE.Magic.ExpiresCombatRound", { round: effect.endsCombatRound })
        : Number(effect.endsAt) > 0
          ? new Date(Number(effect.endsAt) * 1000).toLocaleString()
          : game.i18n.localize("YZE.Magic.ManualDuration")
    }));
    context.equippedItems = this.actor.items
      .filter((item) => ["gear", "weapon", "armor", "consumable"].includes(item.type))
      .filter((item) => item.system.equipped)
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((item) => ({
        id: item.id,
        name: item.name,
        quantity: item.system.quantity,
        typeLabel: game.i18n.localize(`YZE.Actor.ItemTypes.${item.type}`)
      }));
    context.showResources = context.showHealth || context.showResolve || context.showWillpower
      || context.showStress;
    context.combatActions = combatActionState(this.actor);
    context.combatActions.showReset = game.user?.isGM === true;
    context.advancedCombat = advancedCombatState(this.actor);
    context.surprise = {
      pending: pendingSneakAttack(this.actor),
      canManageAmbush: game.user?.isGM === true,
      canChooseInitiative: game.user?.isGM === true && Boolean(game.combat)
    };
    context.coupDeGrace = {
      bypassEmpathy: canBypassCoupEmpathy(this.actor)
    };
    context.attemptLocks = attemptLocks(this.actor).map((entry) => ({
      ...entry,
      createdLabel: entry.createdAt ? new Date(entry.createdAt).toLocaleString() : ""
    }));
    context.hasAttemptLocks = context.attemptLocks.length > 0;
    context.canClearAttempts = game.user?.isGM === true;
    context.environmentalHazards = environmentalHazardSheetState(this.actor);
    return context;
  }

  async _onRender(context, options) {
    await super._onRender(context, options);

    const generalAttributes = this.element.querySelector("[data-general-attributes]");
    const attributesBand = this.element.querySelector(".attributes-band");
    if (generalAttributes && attributesBand) generalAttributes.replaceWith(attributesBand);

    const stateGrid = this.element.querySelector("[data-state-grid]");
    if (stateGrid) {
      for (const selector of [
        ".character-state-panel",
        ".conditions-panel",
        ".critical-injuries-panel"
      ]) {
        const panel = this.element.querySelector(`.general-grid > ${selector}`);
        if (panel) stateGrid.append(panel);
      }
    }

    const showSuccessfulUse = isSuccessfulSkillUseEnabled();
    for (const element of this.element.querySelectorAll("[data-successful-use]")) {
      element.hidden = !showSuccessfulUse;
    }

    for (const input of this.element.querySelectorAll("[data-item-field]")) {
      input.addEventListener("change", (event) => this._onEmbeddedItemChange(event));
    }

    this._createContextMenu(
      () => [{
        label: game.i18n.localize("YZE.Actor.RemoveSkill"),
        icon: "fa-solid fa-trash",
        visible: this.isEditable,
        onClick: (_event, target) => this._confirmRemoveSkill(target)
      }],
      ".attribute-skills .skill-row",
      {
        container: this.element,
        hookName: "YZESkill"
      }
    );
  }

  async _onEmbeddedItemChange(event) {
    event.stopPropagation();

    const input = event.currentTarget;
    const item = this.actor.items.get(input.dataset.itemId);
    const field = input.dataset.itemField;
    if (!item || !field || !this.isEditable) return;

    let value;
    if (input.type === "checkbox") {
      value = input.checked;
    } else if (input.type === "number" || input.dataset.valueType === "number") {
      value = Number(input.value);
      if (!Number.isFinite(value)) return;
      if (input.min !== undefined && input.min !== "") value = Math.max(Number(input.min), value);
      if (input.max !== undefined && input.max !== "") value = Math.min(Number(input.max), value);
      input.value = value;
    } else {
      value = input.value;
    }

    await item.update({ [field]: value });
  }

  async _onDropItem(event, item) {
    const target = event.target instanceof Element ? event.target : null;
    const dropZone = target?.closest("[data-drop-zone]");
    const acceptedTypes = dropZone?.dataset.accepts?.split(/\s+/).filter(Boolean) ?? [];

    if (!dropZone || !acceptedTypes.includes(item.type)) {
      const section = dropZone?.dataset.dropZone;
      const message = section
        ? game.i18n.format("YZE.Drop.WrongSection", { itemType: item.type, section })
        : game.i18n.localize("YZE.Drop.ChooseSection");
      ui.notifications.warn(message);
      return null;
    }

    const targetAttribute = dropZone.dataset.attribute;
    if (item.type === "skill" && targetAttribute !== item.system.attribute) {
      const labels = getAttributeLabels();
      ui.notifications.warn(game.i18n.format("YZE.Drop.WrongAttribute", {
        skill: item.name,
        attribute: labels[item.system.attribute] ?? item.system.attribute
      }));
      return null;
    }

    return super._onDropItem(event, item);
  }

  static async _onRollAttribute(event, target) {
    await this.actor.rollAttribute(target.dataset.attribute);
  }

  static async _onRollSkill(event, target) {
    await this.actor.rollSkill(target.closest("[data-item-id]")?.dataset.itemId);
  }

  static async _onRollCriticalInjury(event, target) {
    await rollCriticalInjury(this.actor, target.dataset.category);
  }

  static async _onRollDeathSave(event, target) {
    await this.actor.rollDeathSave(target.closest("[data-item-id]")?.dataset.itemId);
  }

  static async _onStressfulSituation() {
    await promptStressfulSituation(this.actor);
  }

  static async _onSecondWind() {
    await promptSecondWind(this.actor);
  }

  static async _onAwardExperience() {
    await awardSessionExperience(this.actor);
  }

  static async _onAdvanceCharacter() {
    await advanceActor(this.actor);
  }

  static async _onAdjustExperience() {
    await promptExperienceAdjustment(this.actor);
  }

  static async _onCharacterCreation() {
    const created = await startCharacterCreation(this.actor);
    if (created) {
      this.element.querySelector('button[data-action="characterCreation"]')?.remove();
    }
  }

  static async _onAddRelationship() {
    if (!this.isEditable) return;
    const relationships = foundry.utils.deepClone(
      this.actor.toObject().system.personality?.relationships ?? []
    );
    const firstActor = [...game.actors]
      .filter((actor) => actor.type === "character" && actor.id !== this.actor.id && actor.visible !== false)
      .sort((left, right) => left.name.localeCompare(right.name))[0];
    relationships.push({
      id: foundry.utils.randomID(),
      actorUuid: firstActor?.uuid ?? "",
      description: ""
    });
    await this.actor.update({ "system.personality.relationships": relationships });
  }

  static async _onRemoveRelationship(event, target) {
    if (!this.isEditable) return;
    const index = Number(target.closest("[data-relationship-index]")?.dataset.relationshipIndex);
    if (!Number.isInteger(index)) return;
    const relationships = foundry.utils.deepClone(
      this.actor.toObject().system.personality?.relationships ?? []
    );
    relationships.splice(index, 1);
    await this.actor.update({ "system.personality.relationships": relationships });
  }

  static async _onAttackWeapon(event, target) {
    await attackWithWeapon(this.actor, target.closest("[data-item-id]")?.dataset.itemId);
  }

  static async _onReloadWeapon(event, target) {
    await reloadWeapon(this.actor, target.closest("[data-item-id]")?.dataset.itemId);
  }

  static async _onTakeCover() { await takeCover(this.actor); }
  static async _onLeaveCover() { await leaveCover(this.actor); }
  static async _onToggleProne() { await toggleProne(this.actor); }
  static async _onAssumeOverwatch() { await assumeOverwatch(this.actor); }
  static async _onFireOverwatch() { await fireOverwatch(this.actor); }
  static async _onCancelOverwatch() { await cancelOverwatch(this.actor); }
  static async _onPrepareTelescopicAim() { await prepareTelescopicAim(this.actor); }
  static async _onCancelPreparedAim() { await cancelPreparedAim(this.actor); }
  static async _onBreakGrapple() { await breakGrapple(this.actor); }
  static async _onReleaseGrapple() { await releaseGrapple(this.actor); }
  static async _onRetreat() { await retreat(this.actor); }

  static async _onSpendFastAction() {
    await spendActorActions(this.actor, { fast: 1 });
  }

  static async _onSpendSlowAction() {
    await spendActorActions(this.actor, { slow: 1 });
  }

  static async _onResetCombatActions() {
    await resetActorActions(this.actor);
  }

  static async _onClearAttempt(event, target) {
    await clearAttemptLock(this.actor, target.closest("[data-attempt-id]")?.dataset.attemptId);
    this.render({ force: false });
  }

  static async _onClearAllAttempts() {
    await clearAllAttemptLocks(this.actor);
    this.render({ force: false });
  }

  static async _onSneakAttack() {
    await promptSneakAttack(this.actor);
  }

  static async _onResolveAmbush() {
    await promptAmbush(this.actor);
  }

  static async _onSurpriseInitiative() {
    await promptSurpriseInitiative(this.actor);
  }

  static async _onCancelSneakAttack() {
    await consumeSneakAttack(this.actor);
    this.render({ force: false });
  }

  static async _onCoupDeGrace() {
    await performCoupDeGrace(this.actor);
  }

  static async _onExchangeInitiative() {
    await promptInitiativeExchange(this.actor);
  }

  static async _onApplyDamage() {
    await promptManualDamage(this.actor);
  }

  static async _onManualRecovery() {
    await promptManualRecovery(this.actor);
  }

  static async _onRecoverShift() {
    await recoverShift(this.actor);
  }

  static async _onHealingRoll() {
    await promptHealingRoll(this.actor);
  }

  static async _onRelieveStress() {
    await relieveStress(this.actor);
  }

  static async _onRepairArmor(event, target) {
    await promptArmorRepair(this.actor, target.closest("[data-item-id]")?.dataset.itemId);
  }

  static async _onRepairGear(event, target) {
    await promptGearRepair(this.actor, target.closest("[data-item-id]")?.dataset.itemId);
  }

  static async _onRollSupply(event, target) {
    await rollConsumableSupply(this.actor, target.closest("[data-item-id]")?.dataset.itemId);
  }

  static async _onTransferSupply(event, target) {
    await transferConsumableSupply(this.actor, target.closest("[data-item-id]")?.dataset.itemId);
  }

  static async _onConsumeFood(event, target) {
    await consumeFood(this.actor, target.closest("[data-item-id]")?.dataset.itemId);
  }

  static async _onRollPanic() {
    await rollPanic(this.actor, { reason: game.i18n.localize("YZE.Panic.ManualReason") });
  }

  static async _onGainWillpower() {
    await promptWillpowerChange(this.actor, "gain");
  }

  static async _onSpendWillpower() {
    await promptWillpowerChange(this.actor, "spend");
  }

  static async _onActivateResourceEffect(event, target) {
    const item = this.actor.items.get(target.closest("[data-item-id]")?.dataset.itemId);
    if (item) await promptResourceEffect(this.actor, item, {
      effectId: target.dataset.effectId || null
    });
  }

  static async _onCastSpell(event, target) {
    await castSpell(this.actor, target.closest("[data-item-id]")?.dataset.itemId);
  }
  static async _onClearMagicEffect(event, target) {
    await clearMagicEffect(this.actor, target.closest("[data-effect-id]")?.dataset.effectId);
  }

  static async _onChaseManeuver() { await promptChaseManeuver(this.actor); }
  static async _onChaseObstacle() { await drawChaseObstacle({ vehicle: false }); }
  static async _onStartChase() { await startChase(this.actor); }
  static async _onEndChase() { await endChase(); }
  static _onOpenMount() { mountForRider(this.actor)?.sheet.render({ force: true }); }
  static async _onMountedMove() { const mount = mountForRider(this.actor); if (mount) await promptMountedMovement(mount); }
  static async _onMountedTravel() { const mount = mountForRider(this.actor); if (mount) await performMountedTravel(mount); }
  static async _onTravelActivity() { await performTravelActivity(this.actor); }
  static async _onAdvanceTravelShift() { await advanceTravelShift(); }
  static async _onConfigureTravelMap() { await configureTravelMap(); }
  static async _onPlanTravelRoute() { await planTravelRoute(); }
  static async _onClearTravelRoute() { await clearTravelRoute(); }
  static async _onEnvironmentalHazard() { await promptEnvironmentalHazard(this.actor); }
  static async _onResolveEnvironmentalHazard(event, target) {
    await resolveEnvironmentalInterval(this.actor, target.closest("[data-hazard-key]")?.dataset.hazardKey);
  }
  static async _onClearEnvironmentalHazard(event, target) {
    await clearEnvironmentalHazard(this.actor, target.closest("[data-hazard-key]")?.dataset.hazardKey);
  }
  static async _onExtinguishEnvironmentalFire() { await extinguishEnvironmentalFire(this.actor); }

  async _confirmRemoveSkill(target) {
    const itemId = target.closest("[data-item-id]")?.dataset.itemId;
    const skill = this.actor.items.get(itemId);
    if (!skill || skill.type !== "skill" || !this.isEditable) return;

    const confirmed = await foundry.applications.api.DialogV2.confirm({
      window: {
        title: game.i18n.localize("YZE.Actor.RemoveSkillTitle")
      },
      content: `<div class="yze"><p>${game.i18n.format("YZE.Actor.RemoveSkillConfirm", {
        skill: foundry.utils.escapeHTML(skill.name)
      })}</p></div>`,
      yes: {
        label: game.i18n.localize("YZE.Common.Remove")
      },
      no: {
        label: game.i18n.localize("YZE.Common.Cancel")
      },
      rejectClose: false,
      modal: true
    });

    if (confirmed) {
      await this.actor.deleteEmbeddedDocuments("Item", [skill.id]);
    }
  }

  static async _onRemoveCriticalInjury(event, target) {
    const itemId = target.closest("[data-item-id]")?.dataset.itemId;
    const injury = this.actor.items.get(itemId);
    if (!injury || injury.type !== "criticalInjury" || !this.isEditable) return;

    const confirmed = await foundry.applications.api.DialogV2.confirm({
      window: { title: game.i18n.localize("YZE.Actor.RemoveCriticalInjuryTitle") },
      content: `<div class="yze"><p>${game.i18n.format("YZE.Actor.RemoveCriticalInjuryConfirm", {
        injury: foundry.utils.escapeHTML(injury.name)
      })}</p></div>`,
      yes: { label: game.i18n.localize("YZE.Common.Remove") },
      no: { label: game.i18n.localize("YZE.Common.Cancel") },
      rejectClose: false,
      modal: true
    });

    if (confirmed) await this.actor.deleteEmbeddedDocuments("Item", [injury.id]);
  }

  static async _onTriggerCriticalInjury(event, target) {
    const injury = this.actor.items.get(target.closest("[data-item-id]")?.dataset.itemId);
    await triggerCriticalInjury(this.actor, injury);
  }

  static _onEditItem(event, target) {
    const itemId = target.closest("[data-item-id]")?.dataset.itemId;
    const item = this.actor.items.get(itemId);
    item?.sheet.render({ force: true });
  }
}
