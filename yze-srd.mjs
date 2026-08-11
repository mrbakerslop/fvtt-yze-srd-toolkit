import { YZEActor, YZEItem } from "./module/documents.mjs";
import {
  CharacterDataModel,
  NPCDataModel,
  ArchetypeDataModel,
  CriticalInjuryDataModel,
  ArmorDataModel,
  ConsumableDataModel,
  GearDataModel,
  SkillDataModel,
  SpellDataModel,
  MountDataModel,
  VehicleDataModel,
  WeaponDataModel,
  SpecialtyDataModel,
  VehicleComponentDataModel
} from "./module/data-models.mjs";
import {
  registerSystemSettings,
  registerSettingsConfigLayoutHook,
  getAmmunitionMode,
  getCharacterHeaderFields,
  getCurrencyLabel,
  getPersonalityFields,
  getConsumableMode,
  getCriticalInjuryTrigger,
  getEncumbranceMode,
  getAttributeLabels,
  getDiceSystem,
  getHarmModel,
  getInitiativeMode,
  getStepRatingLabelStyle,
  getWorldRuleOptions,
  getPushRules,
  getStepModifierMethod,
  formatStepRatingLabel,
  isMagicEnabled,
  isCurrencyEnabled,
  isItemPriceEnabled,
  isPersonalityEnabled,
  isTravelEnabled,
  isVehicleSubsystemEnabled
} from "./module/settings.mjs";
import { activeBackpack, actorEncumbrance, backpackMobilityModifier } from "./module/encumbrance.mjs";
import { rollConsumableSupply, transferConsumableSupply } from "./module/equipment.mjs";
import {
  addConsumableAmount,
  addFood,
  applyCookingOutcome,
  consumeFood,
  foodItemAmount,
  foodRisk,
  foodStatusLabel,
  isFoodItem
} from "./module/food.mjs";
import {
  actorItemEffects,
  alternateAttributeEffects,
  derivedStatBonus,
  effectTargetsAttribute,
  effectTargetsRoll,
  extraPushes,
  healingTimeMultiplier,
  hitInterceptionEffects,
  initiativeCardBonus,
  ITEM_EFFECT_TYPES,
  rollModifierEffects,
  skillEffectTarget,
  coupDeGraceEffects,
  doomExpenditureEffects,
  willpowerActivationEffects,
  worldDoomExpenditures
} from "./module/item-effects.mjs";
import { calculateHealthResolve } from "./module/derived-stats.mjs";
import {
  activeSpecialties,
  effectiveHealingMultiplier,
  hasSpecialty,
  initiativeCardsToDraw,
  maximumPushes,
  specialtyDerivedBonuses,
  specialtyEffect
} from "./module/specialties.mjs";
import { migrateWorldData } from "./module/srd-content/seed.mjs";
import { launchWorldSetup } from "./module/apps/world-setup.mjs";
import { openWorldSetupGuide } from "./module/srd-content/packs.mjs";
import { startCharacterCreation } from "./module/character-creation.mjs";
import { YZEActorSheet } from "./module/sheets/actor-sheet.mjs";
import { YZEVehicleSheet } from "./module/sheets/vehicle-sheet.mjs";
import { YZEMountSheet } from "./module/sheets/mount-sheet.mjs";
import { YZEItemSheet } from "./module/sheets/item-sheet.mjs";
import { rollDicePool } from "./module/dice/dice-pool.mjs";
import {
  registerStepDiceRoll,
  YZEStepRoll,
  rollStepDice
} from "./module/dice/step-dice.mjs";
import { registerPushChatHook } from "./module/dice/push.mjs";
import {
  refreshOpposedAfterPush,
  registerOpposedChatHook
} from "./module/dice/opposed.mjs";
import { HARM_MODELS } from "./module/constants.mjs";
import {
  getActorBrokenState,
  registerCriticalInjuryChatHook,
  rollCriticalInjury
} from "./module/critical-injuries.mjs";
import {
  advanceActor,
  awardSessionExperience,
  promptExperienceAdjustment,
  recordExperienceTransaction,
  skillAdvancementCost
} from "./module/advancement.mjs";
import {
  advancedCombatState,
  ammunitionSpent,
  attackWithWeapon,
  assumeOverwatch,
  breakGrapple,
  cancelOverwatch,
  cancelPreparedAim,
  canSpendActorActions,
  combatActionState,
  fireOverwatch,
  leaveCover,
  promptInitiativeExchange,
  prepareTelescopicAim,
  reconcilePushedAmmunition,
  refreshRetreatAfterPush,
  releaseGrapple,
  reloadWeapon,
  retreat,
  rollAmmunitionSupply,
  registerCombatHooks,
  resetActorActions,
  requestFailedRetreatFreeAttacks,
  resolveFailedRetreatFreeAttacks,
  spendActorActions,
  takeCover,
  toggleProne,
  YZECombat
} from "./module/combat.mjs";
import {
  applyAttackDamage,
  refreshInterceptionAfterPush,
  registerAttackChatHook,
  resolveBodyguardInterception,
  startBodyguardInterception
} from "./module/attack-card.mjs";
import {
  applyHealingRoll,
  promptArmorRepair,
  promptGearRepair,
  promptHealingRoll,
  promptSecondWind,
  promptVehicleRepair,
  registerHealingChatHook
} from "./module/recovery-card.mjs";
import {
  applyDamage,
  applyRecovery,
  promptManualDamage,
  promptManualRecovery,
  recoverShift,
  relieveStress,
  rollCover,
  rollArmor
} from "./module/harm.mjs";
import {
  adjustDoom,
  canManageDoom,
  getDoomManagerRole,
  getDoomPoints,
  openDoomPanel,
  promptDoomChange,
  registerDoomHooks,
  resetDoom,
  spendDoom
} from "./module/doom.mjs";
import {
  clearPanic,
  getPanicModifier,
  rollPanic
} from "./module/panic.mjs";
import { adjustWillpower, promptWillpowerChange } from "./module/willpower.mjs";
import {
  applySpellOutcome,
  castSpell,
  clearMagicEffect,
  configuredSpellEffects,
  consumeMagicAutomaticSuccesses,
  countMagicRoll,
  getMagicAutomaticSuccesses,
  getMagicRollModifier,
  magicDisciplines,
  magicEffects,
  registerMagicHooks,
  rollMagicMishap
} from "./module/magic.mjs";
import {
  applyAerialCrashOutcome,
  applyRicochetOutcome,
  applyVehicleManeuverOutcome,
  beginAerialCrash,
  controlledAerialLanding,
  registerVehicleHooks,
  rollVehicleCriticalDamage,
  rollVehicleManeuver,
  resolveVehicleOccupants,
  vehicleComponentModifier,
  vehicleDrivingModifier
} from "./module/vehicles.mjs";
import {
  mountForRider,
  mountMobilityRoll,
  registerMountHooks,
  resolveMountRider,
  restMount
} from "./module/mounts.mjs";
import {
  applyChaseOutcome,
  chaseStateFor,
  drawChaseObstacle,
  endChase,
  getChaseState,
  promptChaseManeuver,
  registerChaseHooks,
  startChase
} from "./module/chases.mjs";
import {
  advanceTravelShift,
  applyTravelOutcome,
  getTravelClock,
  performMountedTravel,
  performTravelActivity,
  performVehicleTravel,
  rollDrivingMishap,
  travelLedger,
  registerTravelHooks
} from "./module/travel.mjs";
import {
  advanceTravelRoute,
  clearTravelRoute,
  configureTravelMap,
  deviateTravelRoute,
  isHexTravelScene,
  planTravelRoute,
  registerTravelMapHooks,
  travelHexData,
  travelMapState,
  travelTerrainData
} from "./module/travel-map.mjs";
import {
  initializeInjuryTiming,
  injuryRecoveryState,
  parseHealingTime,
  processTimedInjuries,
  registerInjuryTimingHooks
} from "./module/injury-timing.mjs";
import {
  applyHazardRoll,
  environmentalHazardSheetState,
  extinguishEnvironmentalFire,
  promptEnvironmentalHazard,
  promptStressfulSituation,
  registerEnvironmentalHazardHooks,
  rollPoisonExposure,
  rollSicknessExposure,
  resolveEnvironmentalInterval
} from "./module/environmental-hazards.mjs";
import {
  clearEnvironmentalHazard,
  environmentalHazards
} from "./module/hazard-state.mjs";
import {
  helperCandidates,
  registerHelpingHooks,
  spendHelperActions
} from "./module/helping.mjs";
import {
  pendingSneakAttack,
  promptAmbush,
  promptSneakAttack,
  promptSurpriseInitiative,
  registerSurpriseHooks
} from "./module/surprise.mjs";
import {
  canBypassCoupEmpathy,
  performCoupDeGrace,
  registerCoupDeGraceHooks
} from "./module/coup-de-grace.mjs";
import {
  activateResourceEffect,
  promptResourceEffect,
  resourceActivationEffects
} from "./module/resource-effects.mjs";
import {
  activeTokenForActor,
  analyzeSelectedRange,
  isYZEZone,
  openZoneManager,
  rangeAllows,
  rangeBetweenTokens,
  registerZoneHooks,
  sceneZones,
  zoneAtPoint,
  zoneConnections,
  zoneCoverForActor,
  zoneData,
  zoneForToken,
  zonePath,
  zoneRollModifiers
} from "./module/zones.mjs";
import { registerWindowStylingHooks } from "./module/window-styling.mjs";

Hooks.once("init", () => {
  console.info("YZE System Toolkit | Initialising");

  registerSystemSettings();
  registerSettingsConfigLayoutHook();
  registerWindowStylingHooks();
  registerStepDiceRoll();
  registerPushChatHook({
    StepRollClass: YZEStepRoll,
    onPushed: async (originalMessage, pushedMessage, pushedState) => {
      await refreshOpposedAfterPush(originalMessage, pushedMessage, pushedState);
      await reconcilePushedAmmunition(originalMessage, pushedMessage, pushedState);
      await refreshInterceptionAfterPush(originalMessage, pushedMessage, pushedState);
      await refreshRetreatAfterPush(originalMessage, pushedMessage, pushedState);
    }
  });
  registerOpposedChatHook();
  registerCriticalInjuryChatHook();
  registerAttackChatHook();
  registerHealingChatHook();
  registerCombatHooks();
  registerVehicleHooks();
  registerDoomHooks();
  registerTravelHooks();
  registerTravelMapHooks();
  registerMagicHooks();
  registerChaseHooks();
  registerMountHooks();
  registerInjuryTimingHooks();
  registerEnvironmentalHazardHooks();
  registerHelpingHooks();
  registerSurpriseHooks();
  registerCoupDeGraceHooks();
  registerZoneHooks();

  CONFIG.Actor.documentClass = YZEActor;
  CONFIG.Item.documentClass = YZEItem;
  CONFIG.Combat.documentClass = YZECombat;

  CONFIG.Actor.dataModels = {
    character: CharacterDataModel,
    npc: NPCDataModel,
    vehicle: VehicleDataModel,
    mount: MountDataModel
  };

  CONFIG.Item.dataModels = {
    archetype: ArchetypeDataModel,
    skill: SkillDataModel,
    specialty: SpecialtyDataModel,
    gear: GearDataModel,
    weapon: WeaponDataModel,
    armor: ArmorDataModel,
    consumable: ConsumableDataModel,
    spell: SpellDataModel,
    criticalInjury: CriticalInjuryDataModel,
    vehicleComponent: VehicleComponentDataModel
  };

  const harmModel = getHarmModel();
  const personResourceBars = harmModel === HARM_MODELS.DAMAGE_STRESS
    ? ["resources.health", "resources.resolve"]
    : harmModel === HARM_MODELS.HEALTH_ONLY
      ? ["resources.health"]
      : [];
  CONFIG.Actor.trackableAttributes = {
    character: {
      bar: [...personResourceBars],
      value: ["resources.willpower.value", "resources.stress.value"]
    },
    npc: {
      bar: [...personResourceBars],
      value: ["resources.willpower.value", "resources.stress.value"]
    },
    vehicle: {
      bar: ["hull"],
      value: []
    },
    mount: {
      bar: ["resources.health"],
      value: []
    }
  };

  const { DocumentSheetConfig } = foundry.applications.apps;
  DocumentSheetConfig.registerSheet(
    foundry.documents.Actor,
    game.system.id,
    YZEVehicleSheet,
    { makeDefault: true, types: ["vehicle"] }
  );
  DocumentSheetConfig.registerSheet(
    foundry.documents.Actor,
    game.system.id,
    YZEMountSheet,
    { makeDefault: true, types: ["mount"] }
  );
  DocumentSheetConfig.registerSheet(
    foundry.documents.Actor,
    game.system.id,
    YZEActorSheet,
    { makeDefault: true, types: ["character", "npc"] }
  );
  DocumentSheetConfig.registerSheet(
    foundry.documents.Item,
    game.system.id,
    YZEItemSheet,
    {
      makeDefault: true,
      types: ["archetype", "skill", "specialty", "gear", "weapon", "armor", "consumable", "spell", "criticalInjury", "vehicleComponent"]
    }
  );
});

Hooks.once("ready", async () => {
  game.yze = {
    getAttributeLabels,
    getCharacterHeaderFields,
    getCurrencyLabel,
    isCurrencyEnabled,
    isItemPriceEnabled,
    getPersonalityFields,
    getEncumbranceMode,
    getConsumableMode,
    getCriticalInjuryTrigger,
    getAmmunitionMode,
    getInitiativeMode,
    getWorldRuleOptions,
    actorEncumbrance,
    activeBackpack,
    backpackMobilityModifier,
    rollConsumableSupply,
    transferConsumableSupply,
    addConsumableAmount,
    addFood,
    applyCookingOutcome,
    consumeFood,
    foodItemAmount,
    foodRisk,
    foodStatusLabel,
    isFoodItem,
    ITEM_EFFECT_TYPES,
    actorItemEffects,
    effectTargetsAttribute,
    effectTargetsRoll,
    rollModifierEffects,
    skillEffectTarget,
    extraPushes,
    alternateAttributeEffects,
    initiativeCardBonus,
    healingTimeMultiplier,
    hitInterceptionEffects,
    coupDeGraceEffects,
    doomExpenditureEffects,
    willpowerActivationEffects,
    worldDoomExpenditures,
    resourceActivationEffects,
    activateResourceEffect,
    promptResourceEffect,
    derivedStatBonus,
    calculateHealthResolve,
    specialtyEffect,
    activeSpecialties,
    effectiveHealingMultiplier,
    hasSpecialty,
    specialtyDerivedBonuses,
    maximumPushes,
    initiativeCardsToDraw,
    getDiceSystem,
    getHarmModel,
    getPushRules,
    getStepModifierMethod,
    getStepRatingLabelStyle,
    formatStepRatingLabel,
    isMagicEnabled,
    isPersonalityEnabled,
    isTravelEnabled,
    isVehicleSubsystemEnabled,
    rollDicePool,
    rollStepDice,
    getActorBrokenState,
    rollCriticalInjury,
    helperCandidates,
    spendHelperActions,
    pendingSneakAttack,
    promptSneakAttack,
    promptAmbush,
    promptSurpriseInitiative,
    awardSessionExperience,
    advanceActor,
    promptExperienceAdjustment,
    recordExperienceTransaction,
    skillAdvancementCost,
    attackWithWeapon,
    applyAttackDamage,
    startBodyguardInterception,
    resolveBodyguardInterception,
    refreshInterceptionAfterPush,
    canBypassCoupEmpathy,
    performCoupDeGrace,
    applyDamage,
    applyRecovery,
    rollArmor,
    rollCover,
    promptManualDamage,
    promptManualRecovery,
    recoverShift,
    relieveStress,
    promptHealingRoll,
    promptSecondWind,
    promptArmorRepair,
    promptGearRepair,
    promptVehicleRepair,
    applyHealingRoll,
    combatActionState,
    canSpendActorActions,
    spendActorActions,
    resetActorActions,
    promptInitiativeExchange,
    advancedCombatState,
    ammunitionSpent,
    takeCover,
    leaveCover,
    toggleProne,
    assumeOverwatch,
    fireOverwatch,
    cancelOverwatch,
    cancelPreparedAim,
    prepareTelescopicAim,
    reconcilePushedAmmunition,
    refreshRetreatAfterPush,
    breakGrapple,
    releaseGrapple,
    retreat,
    requestFailedRetreatFreeAttacks,
    resolveFailedRetreatFreeAttacks,
    reloadWeapon,
    rollAmmunitionSupply,
    getDoomPoints,
    getDoomManagerRole,
    canManageDoom,
    adjustDoom,
    openDoomPanel,
    promptDoomChange,
    resetDoom,
    spendDoom,
    rollPanic,
    clearPanic,
    getPanicModifier,
    adjustWillpower,
    promptWillpowerChange,
    castSpell,
    applySpellOutcome,
    configuredSpellEffects,
    magicEffects,
    clearMagicEffect,
    getMagicAutomaticSuccesses,
    consumeMagicAutomaticSuccesses,
    getMagicRollModifier,
    countMagicRoll,
    magicDisciplines,
    rollMagicMishap,
    rollVehicleCriticalDamage,
    applyRicochetOutcome,
    beginAerialCrash,
    applyAerialCrashOutcome,
    controlledAerialLanding,
    applyVehicleManeuverOutcome,
    mountForRider,
    resolveMountRider,
    mountMobilityRoll,
    restMount,
    rollVehicleManeuver,
    resolveVehicleOccupants,
    vehicleComponentModifier,
    vehicleDrivingModifier,
    promptChaseManeuver,
    getChaseState,
    chaseStateFor,
    startChase,
    endChase,
    applyChaseOutcome,
    drawChaseObstacle,
    getTravelClock,
    advanceTravelShift,
    performMountedTravel,
    performTravelActivity,
    performVehicleTravel,
    rollDrivingMishap,
    travelLedger,
    applyTravelOutcome,
    advanceTravelRoute,
    clearTravelRoute,
    configureTravelMap,
    deviateTravelRoute,
    isHexTravelScene,
    planTravelRoute,
    travelHexData,
    travelMapState,
    travelTerrainData,
    parseHealingTime,
    initializeInjuryTiming,
    injuryRecoveryState,
    processTimedInjuries,
    environmentalHazards,
    environmentalHazardSheetState,
    extinguishEnvironmentalFire,
    promptEnvironmentalHazard,
    promptStressfulSituation,
    rollPoisonExposure,
    rollSicknessExposure,
    resolveEnvironmentalInterval,
    clearEnvironmentalHazard,
    applyHazardRoll,
    startCharacterCreation,
    launchWorldSetup,
    openWorldSetupGuide,
    zoneData,
    isYZEZone,
    sceneZones,
    zoneConnections,
    zoneAtPoint,
    zoneForToken,
    zonePath,
    activeTokenForActor,
    rangeBetweenTokens,
    rangeAllows,
    zoneRollModifiers,
    zoneCoverForActor,
    analyzeSelectedRange,
    openZoneManager
  };

  const missingItemTypes = ["criticalInjury", "vehicleComponent"].filter(
    (type) => !game.documentTypes?.Item?.includes(type)
  );
  const missingActorTypes = ["mount"].filter(
    (type) => !game.documentTypes?.Actor?.includes(type)
  );
  if (missingItemTypes.length > 0 || missingActorTypes.length > 0) {
    const missingTypes = [...missingItemTypes, ...missingActorTypes];
    console.error(
      `YZE System Toolkit | Document types are missing from Foundry's cached document types: ${missingTypes.join(", ")}. `
      + "Restart the Foundry VTT server to reload system.json."
    );
    ui.notifications.error(
      game.i18n.format("YZE.Defaults.RestartRequired", { types: missingTypes.join(", ") }),
      { permanent: true }
    );
    return;
  }

  try {
    await migrateWorldData();
  } catch (error) {
    console.error("YZE System Toolkit | World data migration failed", error);
    ui.notifications.error(
      game.i18n.format("YZE.Defaults.SRDContentFailed", { error: error.message }),
      { permanent: true }
    );
  }

  launchWorldSetup();
});
