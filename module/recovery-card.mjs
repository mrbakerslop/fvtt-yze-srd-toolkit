import {
  DICE_SYSTEMS,
  HARM_MODELS,
  SPECIALTY_EFFECTS,
  SYSTEM_ID
} from "./constants.mjs";
import { combatActionState, spendActorActions } from "./combat.mjs";
import {
  getActorBrokenState,
  hasCriticalInjurySpecialRule
} from "./critical-injuries.mjs";
import {
  applyRecovery,
  canUpdateActor,
  damageTracks
} from "./harm.mjs";
import { getDiceSystem, getHarmModel } from "./settings.mjs";
import { activeSpecialties, hasSpecialty } from "./specialties.mjs";
import {
  addDailyCare,
  advanceLethalTreatment,
  INJURY_TIME_SECONDS,
  injuryRecoveryState,
  lockFailedTreatment,
  normalizeInjuryInterval
} from "./injury-timing.mjs";
import { vehicleDriverSkill } from "./vehicles.mjs";
import { countStateSuccesses } from "./dice/successes.mjs";

const PUSH_FLAG = "push";
const APPLIED_FLAG = "healingApplied";

function escape(value) {
  return foundry.utils.escapeHTML(String(value));
}

function stateSuccesses(state) {
  return countStateSuccesses(state);
}

function worldTime() {
  return Math.max(0, Number(game.time?.worldTime) || 0);
}

function treatmentWaitSeconds(state) {
  const readyAt = Number(state?.recovery?.treatmentReadyAt) || 0;
  return readyAt > 0 ? Math.max(0, readyAt - worldTime()) : 0;
}

function treatmentReady(state) {
  return treatmentWaitSeconds(state) === 0;
}

function healingResultLabel(state, successes) {
  if (state.recovery.kind === "repairGear") {
    return game.i18n.format("YZE.Recovery.GearRepairResult", {
      gear: state.recovery.gearName,
      successes
    });
  }
  if (state.recovery.kind === "repairVehicle") {
    return game.i18n.format("YZE.Vehicle.RepairResult", {
      vehicle: state.recovery.targetName,
      repair: state.recovery.repairName,
      successes
    });
  }
  if (state.recovery.kind === "repairArmor") {
    return game.i18n.format("YZE.Recovery.ArmorRepairResult", {
      armor: state.recovery.armorName,
      successes
    });
  }
  if (state.recovery.kind === "stabilize") {
    return game.i18n.format("YZE.Recovery.StabilizeResult", {
      target: state.recovery.targetName,
      injury: state.recovery.injuryName,
      successes
    });
  }
  if (state.recovery.kind === "care") {
    return game.i18n.format("YZE.InjuryTiming.CareResult", {
      target: state.recovery.targetName,
      injury: state.recovery.injuryName,
      successes
    });
  }
  if (state.recovery.kind === "injuryTreatment") {
    return game.i18n.format("YZE.Recovery.InjuryTreatmentResult", {
      target: state.recovery.targetName,
      injury: state.recovery.injuryName,
      successes
    });
  }
  if (state.recovery.kind === "secondWind") {
    return game.i18n.format("YZE.Specialty.SecondWindResult", {
      target: state.recovery.targetName,
      successes
    });
  }
  return game.i18n.format("YZE.Recovery.HealingResult", {
    target: state.recovery.targetName,
    successes
  });
}

export function renderHealingControl(state) {
  if (!state?.recovery) return "";
  const successes = stateSuccesses(state);
  return `
    <div class="yze-healing-result${successes > 0 ? " is-success" : " is-failure"}">
      <p>${escape(healingResultLabel(state, successes))}</p>
      ${state.recovery.treatmentInterval ? `<p class="hint">${escape(game.i18n.format(
        treatmentReady(state)
          ? "YZE.InjuryTiming.TreatmentDurationComplete"
          : "YZE.InjuryTiming.TreatmentDurationPending",
        {
          interval: state.recovery.treatmentInterval,
          seconds: Math.ceil(treatmentWaitSeconds(state))
        }
      ))}</p>` : ""}
      ${successes > 0 || ["repairGear", "injuryTreatment", "spine"].includes(state.recovery.kind) ? `
        <button type="button" data-action="applyHealing">
          <i class="fa-solid fa-heart-pulse" aria-hidden="true"></i>
          ${escape(game.i18n.localize(
            state.recovery.kind === "repairGear"
              ? (successes > 0 ? "YZE.Recovery.ApplyGearRepair" : "YZE.Recovery.ApplyFailedGearRepair")
              : state.recovery.kind === "stabilize"
              ? "YZE.Recovery.ApplyStabilization"
              : state.recovery.kind === "care"
                ? "YZE.InjuryTiming.ApplyCare"
              : ["injuryTreatment", "spine"].includes(state.recovery.kind)
                ? "YZE.Recovery.ApplyInjuryTreatment"
              : state.recovery.kind === "repairArmor"
                ? "YZE.Recovery.ApplyArmorRepair"
                : state.recovery.kind === "repairVehicle"
                  ? "YZE.Vehicle.ApplyRepair"
                : state.recovery.kind === "secondWind"
                  ? "YZE.Specialty.ApplySecondWind"
                  : "YZE.Recovery.ApplyHealing"
          ))}
        </button>` : state.recovery.kind === "stabilize" ? `
        <button type="button" data-action="recordFailedTreatment">
          <i class="fa-solid fa-ban" aria-hidden="true"></i>
          ${escape(game.i18n.localize("YZE.InjuryTiming.RecordFailedTreatment"))}
        </button>` : ""}
    </div>`;
}

function damagedAttributeTracks(actor, category) {
  if (getHarmModel() !== HARM_MODELS.ATTRIBUTE_DAMAGE) return [];
  const field = getDiceSystem() === DICE_SYSTEMS.STEP ? "stepRating" : "value";
  return damageTracks(actor).filter((track) => (
    track.category === category
    && track.attributeKey
    && Number(actor.system?.attributes?.[track.attributeKey]?.[field]) <= 0
  ));
}

function healingChoices(target) {
  const choices = [];
  const broken = getActorBrokenState(target);
  for (const category of broken.categories) {
    const attributeTracks = damagedAttributeTracks(target, category);
    if (attributeTracks.length > 0) {
      for (const track of attributeTracks) {
        choices.push({
          id: `broken:${track.value}`,
          kind: "broken",
          category,
          attributeKey: track.attributeKey,
          label: game.i18n.format("YZE.Recovery.RecoverBrokenTrack", { track: track.label })
        });
      }
    } else {
      choices.push({
        id: `broken:${category}`,
        kind: "broken",
        category,
        attributeKey: null,
        label: game.i18n.format("YZE.Recovery.RecoverBrokenCategory", {
          category: game.i18n.localize(`YZE.CriticalInjury.${category}`)
        })
      });
    }
  }

  for (const injury of target.items.filter((item) => (
    item.type === "criticalInjury"
    && item.system.active === true
    && item.system.lethal === true
    && item.system.stabilized !== true
    && item.system.instantDeath !== true
    && item.system.recovery?.treatmentLocked !== true
    && item.system.recovery?.deathSaveDue !== true
  ))) {
    choices.push({
      id: `stabilize:${injury.id}`,
      kind: "stabilize",
      injuryItemId: injury.id,
      injuryName: injury.name,
      category: injury.system.category,
      attributeKey: null,
      label: game.i18n.format("YZE.Recovery.StabilizeChoice", { injury: injury.name })
    });
  }
  for (const injury of target.items.filter((item) => {
    const recovery = injuryRecoveryState(item);
    return item.type === "criticalInjury" && item.system.active === true
      && recovery.timed && recovery.remainingDays > 0;
  })) {
    choices.push({
      id: `care:${injury.id}`,
      kind: "care",
      injuryItemId: injury.id,
      injuryName: injury.name,
      category: injury.system.category,
      attributeKey: null,
      label: game.i18n.format("YZE.InjuryTiming.CareChoice", { injury: injury.name })
    });
  }
  for (const injury of target.items.filter((item) => (
    item.type === "criticalInjury"
    && item.system.active === true
    && hasCriticalInjurySpecialRule(item, "healingRollEnds")
  ))) {
    choices.push({
      id: `injuryTreatment:${injury.id}`,
      kind: "injuryTreatment",
      injuryItemId: injury.id,
      injuryName: injury.name,
      category: injury.system.category,
      attributeKey: null,
      label: game.i18n.format("YZE.Recovery.InjuryTreatmentChoice", { injury: injury.name })
    });
  }
  for (const injury of target.items.filter((item) => item.type === "criticalInjury"
    && item.system.active === true
    && (hasCriticalInjurySpecialRule(item, "crackedSpine") || item.name === "Cracked Spine")
    && item.getFlag(SYSTEM_ID, "spineTreatmentResolved") !== true)) {
    choices.push({
      id: `spine:${injury.id}`,
      kind: "spine",
      injuryItemId: injury.id,
      injuryName: injury.name,
      category: "physical",
      attributeKey: null,
      label: game.i18n.format("YZE.InjuryTiming.UrgentSpineChoice", { injury: injury.name })
    });
  }
  return choices;
}

async function chooseHealingPurpose(target, choices) {
  if (choices.length === 1) return choices[0];
  const options = choices.map((choice) => (
    `<option value="${escape(choice.id)}">${escape(choice.label)}</option>`
  )).join("");
  const { DialogV2 } = foundry.applications.api;
  const selected = await DialogV2.wait({
    window: { title: game.i18n.localize("YZE.Recovery.HealingPurposeTitle") },
    content: `
      <div class="yze yze-damage-dialog">
        <p>${escape(game.i18n.format("YZE.Recovery.HealingPurposeHint", { target: target.name }))}</p>
        <div class="form-group">
          <label>${escape(game.i18n.localize("YZE.Recovery.HealingPurpose"))}</label>
          <select name="purpose">${options}</select>
        </div>
      </div>`,
    buttons: [
      {
        action: "continue",
        label: game.i18n.localize("YZE.Common.Continue"),
        icon: "fa-solid fa-arrow-right",
        default: true,
        callback: (event, button, dialog) => {
          const form = button.form ?? dialog.element.querySelector("form");
          return form.elements.purpose?.value ?? null;
        }
      },
      {
        action: "cancel",
        label: game.i18n.localize("YZE.Common.Cancel"),
        icon: "fa-solid fa-xmark",
        callback: () => null
      }
    ],
    close: () => null,
    rejectClose: false,
    modal: true
  });
  return choices.find((choice) => choice.id === selected) ?? null;
}

export async function promptHealingRoll(healer) {
  const targets = [...(game.user?.targets ?? [])].filter((token) => token.actor);
  if (targets.length !== 1) {
    ui.notifications.warn(game.i18n.localize("YZE.Recovery.SelectOneTarget"));
    return null;
  }
  const target = targets[0].actor;
  if (target.type === "vehicle") {
    ui.notifications.warn(game.i18n.localize("YZE.Recovery.CannotHealVehicle"));
    return null;
  }
  if (target.system?.dead === true) {
    ui.notifications.warn(game.i18n.localize("YZE.Recovery.CannotHealDead"));
    return null;
  }
  const choices = healingChoices(target);
  if (choices.length === 0) {
    ui.notifications.warn(game.i18n.format("YZE.Recovery.NoHealingNeed", { target: target.name }));
    return null;
  }
  const purpose = await chooseHealingPurpose(target, choices);
  if (!purpose) return null;

  const healing = healer.items.find((item) => (
    item.type === "skill"
    && item.name.localeCompare("Healing", undefined, { sensitivity: "base" }) === 0
  ));
  if (!healing) {
    ui.notifications.error(game.i18n.localize("YZE.Recovery.HealingSkillMissing"));
    return null;
  }
  const actions = combatActionState(healer);
  const interval = purpose.kind === "care"
    ? "shift"
    : purpose.kind === "stabilize"
      ? normalizeInjuryInterval(target.items.get(purpose.injuryItemId)?.system?.timeLimit)
      : "";
  const usesSlowAction = purpose.kind !== "care"
    && (purpose.kind !== "stabilize" || interval === "round");
  if (usesSlowAction && actions.active && !actions.canSlow) {
    ui.notifications.warn(game.i18n.localize("YZE.Combat.NotEnoughActions"));
    return null;
  }

  const treatmentStartedAt = worldTime();
  const treatmentDuration = interval ? INJURY_TIME_SECONDS[interval] : 0;

  const message = await healer.rollSkill(healing.id, {
    canOppose: false,
    helpAction: usesSlowAction ? "slow" : null,
    fixedModifiers: purpose.kind === "stabilize"
      && hasSpecialty(healer, SPECIALTY_EFFECTS.FIELD_SURGEON)
      ? [[game.i18n.localize("YZE.Specialty.Effects.fieldSurgeon"), 1]]
      : [],
    recovery: {
      ...purpose,
      targetActorUuid: target.uuid,
      targetName: target.name,
      treatmentInterval: interval
        ? interval[0].toUpperCase() + interval.slice(1)
        : "",
      treatmentStartedAt,
      treatmentReadyAt: treatmentStartedAt + treatmentDuration
    }
  });
  if (!message) return null;
  if (usesSlowAction) await spendActorActions(healer, { slow: 1 });
  return message;
}

export async function promptSecondWind(actor) {
  const specialty = activeSpecialties(actor, SPECIALTY_EFFECTS.SECOND_WIND)[0];
  const brokenChoices = healingChoices(actor).filter((choice) => choice.kind === "broken");
  if (!specialty || brokenChoices.length === 0) return null;
  if (specialty.system.used === true) {
    ui.notifications.warn(game.i18n.localize("YZE.Specialty.SecondWindUsed"));
    return null;
  }
  const purpose = await chooseHealingPurpose(actor, brokenChoices);
  if (!purpose) return null;
  const stamina = actor.items.find((item) => (
    item.type === "skill"
    && item.name.localeCompare("Stamina", undefined, { sensitivity: "base" }) === 0
  ));
  if (!stamina) {
    ui.notifications.error(game.i18n.localize("YZE.Specialty.StaminaMissing"));
    return null;
  }
  const message = await actor.rollSkill(stamina.id, {
    allowBroken: true,
    canPush: false,
    canOppose: false,
    allowHelpers: false,
    applyInjuryDamage: false,
    recovery: {
      ...purpose,
      kind: "secondWind",
      targetActorUuid: actor.uuid,
      targetName: actor.name
    }
  });
  if (message) await specialty.update({ "system.used": true });
  return message;
}

export async function promptArmorRepair(actor, armorId) {
  const armor = actor?.items?.get(armorId);
  if (!armor || armor.type !== "armor") return null;
  const stepDice = getDiceSystem() === DICE_SYSTEMS.STEP;
  const currentField = stepDice ? "stepRating" : "rating";
  const maximumField = stepDice ? "maxStepRating" : "maxRating";
  const current = Number(armor.system?.[currentField]) || 0;
  const maximum = Number(armor.system?.[maximumField]) || 0;
  if (current >= maximum) {
    ui.notifications.info(game.i18n.format("YZE.Recovery.ArmorUndamaged", { armor: armor.name }));
    return null;
  }
  const crafting = actor.items.find((item) => (
    item.type === "skill"
    && item.name.localeCompare("Crafting", undefined, { sensitivity: "base" }) === 0
  ));
  if (!crafting) {
    ui.notifications.error(game.i18n.localize("YZE.Recovery.CraftingSkillMissing"));
    return null;
  }
  return actor.rollSkill(crafting.id, {
    canOppose: false,
    recovery: {
      kind: "repairArmor",
      targetActorUuid: actor.uuid,
      targetName: actor.name,
      armorItemId: armor.id,
      armorName: armor.name
    }
  });
}

/** Spend a Shift attempting to restore a Gear or Weapon's lost rating. */
export async function promptGearRepair(actor, gearId) {
  const gear = actor?.items?.get(gearId);
  if (!gear || !["gear", "weapon"].includes(gear.type) || !canUpdateActor(actor)) return null;
  const stepDice = getDiceSystem() === DICE_SYSTEMS.STEP;
  const current = stepDice
    ? Number(gear.system.reliability?.value) || 0
    : Number(gear.system.bonus) || 0;
  const maximum = stepDice
    ? Number(gear.system.reliability?.max) || 0
    : Number(gear.system.maxBonus) || 0;
  if (current >= maximum) {
    ui.notifications.info(game.i18n.format("YZE.Recovery.GearUndamaged", { gear: gear.name }));
    return null;
  }
  const crafting = actor.items.find((item) => (
    item.type === "skill"
    && item.name.localeCompare("Crafting", undefined, { sensitivity: "base" }) === 0
  ));
  if (!crafting) {
    ui.notifications.error(game.i18n.localize("YZE.Recovery.CraftingSkillMissing"));
    return null;
  }
  const shift = Math.floor((Number(game.time?.worldTime) || 0) / 21600);
  if (Number(gear.getFlag(SYSTEM_ID, "lastRepairShift")) === shift) {
    ui.notifications.warn(game.i18n.localize("YZE.Recovery.GearRepairAlreadyAttempted"));
    return null;
  }
  const message = await actor.rollSkill(crafting.id, {
    canOppose: false,
    recovery: {
      kind: "repairGear",
      targetActorUuid: actor.uuid,
      targetName: actor.name,
      gearItemId: gear.id,
      gearName: gear.name
    }
  });
  if (message) await gear.setFlag(SYSTEM_ID, "lastRepairShift", shift);
  return message;
}

export async function promptVehicleRepair(vehicle) {
  if (vehicle?.type !== "vehicle" || !canUpdateActor(vehicle)) return null;
  const shift = Math.floor((Number(game.time?.worldTime) || 0) / 21600);
  const { driver } = await vehicleDriverSkill(vehicle);
  const crafting = driver?.items?.find((item) => item.type === "skill"
    && item.name.localeCompare("Crafting", undefined, { sensitivity: "base" }) === 0);
  if (!driver || !crafting) {
    ui.notifications.warn(game.i18n.localize("YZE.Vehicle.RepairSkillMissing"));
    return null;
  }
  const choices = [];
  if (Number(vehicle.system.hull.value) < Number(vehicle.system.hull.max)) {
    choices.push({ id: "hull", name: game.i18n.localize("YZE.Vehicle.Hull") });
  }
  if (vehicle.system.engineDisabled || vehicle.system.travelCondition) {
    choices.push({ id: "engine", name: vehicle.system.travelCondition || game.i18n.localize("YZE.Vehicle.EngineDisabled") });
  }
  for (const component of vehicle.items.filter((item) => item.type === "vehicleComponent" && item.system.damaged)) {
    choices.push({ id: `component:${component.id}`, name: component.name });
  }
  if (choices.length === 0) {
    ui.notifications.info(game.i18n.localize("YZE.Vehicle.NoRepairsNeeded"));
    return null;
  }
  const options = choices.map((choice) => `<option value="${escape(choice.id)}">${escape(choice.name)}</option>`).join("");
  const { DialogV2 } = foundry.applications.api;
  const selected = await DialogV2.wait({
    window: { title: game.i18n.localize("YZE.Vehicle.RepairTitle") },
    content: `<div class="yze yze-damage-dialog"><div class="form-group"><label>${escape(game.i18n.localize("YZE.Vehicle.RepairTarget"))}</label><select name="repair">${options}</select></div><p class="hint">${escape(game.i18n.localize("YZE.Vehicle.RepairShiftHint"))}</p></div>`,
    buttons: [
      { action: "roll", label: game.i18n.localize("YZE.Roll.Roll"), icon: "fa-solid fa-screwdriver-wrench", default: true, callback: (event, button, dialog) => (button.form ?? dialog.element.querySelector("form")).elements.repair?.value },
      { action: "cancel", label: game.i18n.localize("YZE.Common.Cancel"), callback: () => null }
    ], close: () => null, rejectClose: false, modal: true
  });
  const choice = choices.find((entry) => entry.id === selected);
  if (!choice) return null;
  const repairShifts = foundry.utils.deepClone(
    vehicle.getFlag(SYSTEM_ID, "repairShifts") ?? {}
  );
  if (Number(repairShifts[choice.id]) === shift) {
    ui.notifications.warn(game.i18n.localize("YZE.Vehicle.RepairAlreadyAttempted"));
    return null;
  }
  const message = await driver.rollSkill(crafting.id, {
    canOppose: false,
    recovery: {
      kind: "repairVehicle",
      targetActorUuid: vehicle.uuid,
      targetName: vehicle.name,
      repairId: choice.id,
      repairName: choice.name
    }
  });
  if (message) {
    repairShifts[choice.id] = shift;
    await vehicle.setFlag(SYSTEM_ID, "repairShifts", repairShifts);
  }
  return message;
}

export async function applyHealingRoll(message, state) {
  if (!state?.recovery || state.superseded || message.getFlag(SYSTEM_ID, APPLIED_FLAG)) return false;
  if (!treatmentReady(state)) {
    ui.notifications.warn(game.i18n.format("YZE.InjuryTiming.TreatmentNotReady", {
      interval: state.recovery.treatmentInterval,
      seconds: Math.ceil(treatmentWaitSeconds(state))
    }));
    return false;
  }
  const successes = stateSuccesses(state);
  if (successes < 1 && !["repairGear", "spine", "injuryTreatment"].includes(state.recovery.kind)) {
    ui.notifications.warn(game.i18n.localize("YZE.Recovery.HealingFailed"));
    return false;
  }
  const target = await fromUuid(state.recovery.targetActorUuid);
  if (!target?.system) {
    ui.notifications.error(game.i18n.localize("YZE.Combat.AttackTargetMissing"));
    return false;
  }
  if (target.system.dead === true && !["repairArmor", "repairVehicle", "repairGear"].includes(state.recovery.kind)) {
    ui.notifications.warn(game.i18n.localize("YZE.Recovery.CannotHealDead"));
    return false;
  }
  if (!canUpdateActor(target)) {
    ui.notifications.warn(game.i18n.localize("YZE.Recovery.GMApplyHealing"));
    return false;
  }
  let treatmentResult = null;

  let gearRepairOutcome = null;
  if (state.recovery.kind === "repairGear") {
    const gear = target.items.get(state.recovery.gearItemId);
    if (!gear || !["gear", "weapon"].includes(gear.type)) {
      ui.notifications.warn(game.i18n.localize("YZE.Recovery.GearUnavailable"));
      return false;
    }
    const stepDice = getDiceSystem() === DICE_SYSTEMS.STEP;
    const currentField = stepDice ? "reliability.value" : "bonus";
    const maximumField = stepDice ? "reliability.max" : "maxBonus";
    const current = Number(foundry.utils.getProperty(gear.system, currentField)) || 0;
    const maximum = Number(foundry.utils.getProperty(gear.system, maximumField)) || 0;
    if (successes > 0) {
      const next = Math.min(maximum, current + successes);
      await gear.update({ [`system.${currentField}`]: next });
      gearRepairOutcome = { key: "YZE.Recovery.GearRepairApplied", amount: next - current };
    } else if (current <= 0) {
      await target.deleteEmbeddedDocuments("Item", [gear.id]);
      gearRepairOutcome = { key: "YZE.Recovery.GearDestroyed", amount: 0 };
    } else {
      await gear.update({ [`system.${maximumField}`]: current });
      gearRepairOutcome = { key: "YZE.Recovery.GearMaximumReduced", amount: current };
    }
  } else if (state.recovery.kind === "repairArmor") {
    const armor = target.items.get(state.recovery.armorItemId);
    if (!armor || armor.type !== "armor") {
      ui.notifications.warn(game.i18n.localize("YZE.Recovery.ArmorUnavailable"));
      return false;
    }
    const stepDice = getDiceSystem() === DICE_SYSTEMS.STEP;
    const currentField = stepDice ? "stepRating" : "rating";
    const maximumField = stepDice ? "maxStepRating" : "maxRating";
    const current = Number(armor.system?.[currentField]) || 0;
    const maximum = Number(armor.system?.[maximumField]) || 0;
    await armor.update({
      [`system.${currentField}`]: Math.min(maximum, current + successes)
    });
  } else if (state.recovery.kind === "repairVehicle") {
    if (target.type !== "vehicle") return false;
    if (state.recovery.repairId === "hull") {
      const current = Number(target.system.hull.value) || 0;
      const maximum = Number(target.system.hull.max) || 0;
      await target.update({
        "system.hull.value": Math.min(maximum, current + successes),
        "system.wrecked": Math.min(maximum, current + successes) <= 0
      });
      if (current <= 0 && current + successes > 0) {
        await target.unsetFlag(SYSTEM_ID, "aerialCrashStarted");
      }
    } else if (state.recovery.repairId === "engine") {
      await target.update({ "system.engineDisabled": false, "system.travelCondition": "" });
    } else if (state.recovery.repairId.startsWith("component:")) {
      const component = target.items.get(state.recovery.repairId.split(":")[1]);
      if (!component) return false;
      await component.update({ "system.damaged": false });
    }
  } else if (state.recovery.kind === "stabilize") {
    const injury = target.items.get(state.recovery.injuryItemId);
    if (!injury || injury.type !== "criticalInjury" || injury.system.active !== true
      || injury.system.lethal !== true || injury.system.instantDeath === true) {
      ui.notifications.warn(game.i18n.localize("YZE.Recovery.InjuryUnavailable"));
      return false;
    }
    treatmentResult = await advanceLethalTreatment(injury);
    if (!treatmentResult) return false;
  } else if (state.recovery.kind === "care") {
    const injury = target.items.get(state.recovery.injuryItemId);
    if (!injury || injury.type !== "criticalInjury" || injury.system.active !== true) {
      ui.notifications.warn(game.i18n.localize("YZE.Recovery.InjuryUnavailable"));
      return false;
    }
    if (!await addDailyCare(injury)) return false;
  } else if (state.recovery.kind === "injuryTreatment") {
    const injury = target.items.get(state.recovery.injuryItemId);
    if (!injury || injury.type !== "criticalInjury" || injury.system.active !== true
      || !hasCriticalInjurySpecialRule(injury, "healingRollEnds")) {
      ui.notifications.warn(game.i18n.localize("YZE.Recovery.InjuryUnavailable"));
      return false;
    }
    await injury.update({ "system.active": false });
    await injury.setFlag(SYSTEM_ID, "treatmentResolved", true);
  } else if (state.recovery.kind === "spine") {
    const injury = target.items.get(state.recovery.injuryItemId);
    if (!injury || injury.type !== "criticalInjury" || injury.system.active !== true) return false;
    await injury.setFlag(SYSTEM_ID, "spineTreatmentResolved", true);
  } else {
    const broken = getActorBrokenState(target);
    if (!broken[state.recovery.category]) {
      ui.notifications.warn(game.i18n.localize("YZE.Recovery.TargetNoLongerBroken"));
      return false;
    }
    const applied = await applyRecovery(target, successes, {
      category: state.recovery.category,
      attributeKey: state.recovery.attributeKey
    });
    if (!applied) return false;
  }

  await message.setFlag(SYSTEM_ID, APPLIED_FLAG, true);
  const current = message.getFlag(SYSTEM_ID, PUSH_FLAG);
  if (current) await message.setFlag(SYSTEM_ID, PUSH_FLAG, { ...current, canPush: false });
  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor: target }),
    content: `<div class="yze chat-card yze-recovery-card"><p>${escape(game.i18n.format(
      state.recovery.kind === "repairGear"
        ? gearRepairOutcome.key
        : state.recovery.kind === "stabilize"
        ? (treatmentResult?.stabilized
          ? "YZE.Recovery.StabilizationApplied"
          : "YZE.InjuryTiming.TreatmentAdvanced")
        : state.recovery.kind === "repairVehicle"
          ? "YZE.Vehicle.RepairApplied"
        : state.recovery.kind === "care"
          ? "YZE.InjuryTiming.CareApplied"
        : state.recovery.kind === "injuryTreatment"
          ? "YZE.Recovery.InjuryTreatmentApplied"
        : state.recovery.kind === "repairArmor"
          ? "YZE.Recovery.ArmorRepairApplied"
          : state.recovery.kind === "secondWind"
            ? "YZE.Specialty.SecondWindApplied"
            : "YZE.Recovery.HealingApplied",
      {
        target: target.name,
        injury: state.recovery.injuryName ?? "",
        interval: treatmentResult?.timeLimit ?? "",
        amount: gearRepairOutcome?.amount ?? successes,
        armor: state.recovery.armorName ?? "",
        gear: state.recovery.gearName ?? ""
      }
    ))}</p></div>`
  });
  return true;
}

export function registerHealingChatHook() {
  Hooks.on("renderChatMessageHTML", (message, html) => {
    const root = html?.querySelector ? html : html?.[0];
    const button = root?.querySelector?.('[data-action="applyHealing"]');
    const failedButton = root?.querySelector?.('[data-action="recordFailedTreatment"]');
    if (!button && !failedButton) return;
    const state = message.getFlag(SYSTEM_ID, PUSH_FLAG);
    const applied = message.getFlag(SYSTEM_ID, APPLIED_FLAG);
    if (!state?.recovery || state.superseded || applied) {
      for (const control of [button, failedButton].filter(Boolean)) {
        control.disabled = true;
        control.textContent = game.i18n.localize(
          applied ? "YZE.Recovery.HealingAlreadyApplied" : "YZE.Combat.UsePushedAttack"
        );
      }
      return;
    }
    button?.addEventListener("click", async () => {
      button.disabled = true;
      try {
        const current = message.getFlag(SYSTEM_ID, PUSH_FLAG);
        const success = await applyHealingRoll(message, current);
        if (!success) button.disabled = false;
      } catch (error) {
        console.error("YZE System Toolkit | Could not apply Healing roll", error);
        ui.notifications.error(game.i18n.localize("YZE.Recovery.HealingApplicationFailed"));
        button.disabled = false;
      }
    });
    failedButton?.addEventListener("click", async () => {
      failedButton.disabled = true;
      try {
        const current = message.getFlag(SYSTEM_ID, PUSH_FLAG);
        if (!current?.recovery || stateSuccesses(current) > 0) return;
        if (!treatmentReady(current)) {
          ui.notifications.warn(game.i18n.format("YZE.InjuryTiming.TreatmentNotReady", {
            interval: current.recovery.treatmentInterval,
            seconds: Math.ceil(treatmentWaitSeconds(current))
          }));
          failedButton.disabled = false;
          return;
        }
        const target = await fromUuid(current.recovery.targetActorUuid);
        const injury = target?.items?.get(current.recovery.injuryItemId);
        if (!injury || !canUpdateActor(target)) {
          ui.notifications.warn(game.i18n.localize("YZE.Recovery.GMApplyHealing"));
          failedButton.disabled = false;
          return;
        }
        await lockFailedTreatment(injury);
        await message.setFlag(SYSTEM_ID, APPLIED_FLAG, true);
        await message.setFlag(SYSTEM_ID, PUSH_FLAG, { ...current, canPush: false });
        ui.notifications.info(game.i18n.localize("YZE.InjuryTiming.FailedTreatmentRecorded"));
      } catch (error) {
        console.error("YZE System Toolkit | Could not record failed treatment", error);
        failedButton.disabled = false;
      }
    });
  });
}
