import { DICE_SYSTEMS, SYSTEM_ID, getStepRating } from "./constants.mjs";
import { getDiceSystem, isVehicleSubsystemEnabled } from "./settings.mjs";
import { canSpendActorActions, combatActionState, spendActorActions } from "./combat.mjs";
import { rollCriticalInjury } from "./critical-injuries.mjs";
import { countStateSuccesses } from "./dice/successes.mjs";
import { zoneForToken } from "./zones.mjs";

const VEHICLE_MANEUVER_APPLIED_FLAG = "vehicleManeuverApplied";
const RICOCHET_FLAG = "ricochet";
const RICOCHET_APPLIED_FLAG = "ricochetApplied";
const AERIAL_CRASH_FLAG = "aerialCrash";
const AERIAL_CRASH_APPLIED_FLAG = "aerialCrashApplied";

export const VEHICLE_CRITICALS = Object.freeze([
  { result: 1, name: "Ricochet", effect: "The attack strikes another random target in the same zone for the same damage." },
  { result: 2, name: "Skid", effect: "The driver must make an immediate driving roll; failure costs their next turn." },
  { result: 3, name: "Windshield Shattered", effect: "Reduce Manoeuvrability by one." },
  { result: 4, name: "Driver Hit", effect: "The driver suffers damage equal to that inflicted on the vehicle." },
  { result: 5, name: "Passenger Hit", effect: "A random passenger suffers the vehicle damage and a critical injury." },
  { result: 6, name: "Wheel Blown", effect: "All driving rolls suffer −2." },
  { result: 7, name: "Severe Spin", effect: "The driver must roll immediately; failure wrecks the vehicle and harms its passengers." },
  { result: 8, name: "Fuel Fire", effect: "The vehicle and everyone inside are exposed to intensity 6/C fire." },
  { result: 9, name: "Weapon Disabled", effect: "A random mounted weapon is disabled." },
  { result: 10, name: "Massive Crash", effect: "The vehicle is wrecked and its passengers suffer crash damage." },
  { result: 11, name: "Engine Disabled", effect: "The engine is disabled and the vehicle cannot continue." },
  { result: 12, name: "Explosion", effect: "The vehicle is destroyed beyond repair and everyone inside suffers a power 9/B blast." }
]);

function escape(value) {
  return foundry.utils.escapeHTML(String(value));
}

function wholeNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.trunc(number)) : 0;
}

async function harmApi() {
  return import("./harm.mjs");
}

function rollSuccesses(state) {
  return countStateSuccesses(state);
}

export function renderVehicleManeuverControl(state) {
  if (!state?.vehicleManeuver) return "";
  const successes = rollSuccesses(state);
  const axis = state.vehicleManeuver.axis
    ? game.i18n.localize(`YZE.Vehicle.AerialAxes.${state.vehicleManeuver.axis}`)
    : "";
  return `
    <div class="yze-vehicle-maneuver-result">
      <h4>${escape(game.i18n.localize("YZE.Vehicle.Maneuver"))}</h4>
      <p>${escape(game.i18n.format("YZE.Vehicle.ManeuverResult", {
        vehicle: state.vehicleManeuver.vehicleName,
        zones: 1 + successes,
        successes
      }))}</p>
      ${axis ? `<p>${escape(game.i18n.format("YZE.Vehicle.AerialAxisResult", { axis }))}</p>` : ""}
      <button type="button" data-action="applyVehicleManeuver">
        <i class="fa-solid fa-route" aria-hidden="true"></i>
        ${escape(game.i18n.localize("YZE.Vehicle.ApplyManeuver"))}
      </button>
    </div>`;
}

export function renderAerialCrashControl(state) {
  if (!state?.aerialCrash) return "";
  const brace = rollSuccesses(state);
  return `<div class="yze-aerial-crash-result">
    <h4>${escape(game.i18n.localize("YZE.Vehicle.BraceForCrash"))}</h4>
    <p>${escape(game.i18n.format("YZE.Vehicle.BraceResult", {
      occupant: state.aerialCrash.occupantName,
      successes: brace,
      damage: Math.max(0, wholeNumber(state.aerialCrash.rawDamage) - brace)
    }))}</p>
    <button type="button" data-action="applyAerialCrash">
      <i class="fa-solid fa-shield-halved" aria-hidden="true"></i>
      ${escape(game.i18n.localize("YZE.Vehicle.ApplyCrashDamage"))}
    </button>
  </div>`;
}

export function vehicleComponentModifier(vehicle) {
  return vehicle?.items
    ?.filter((item) => item.type === "vehicleComponent" && item.system.active && !item.system.damaged)
    .reduce((total, item) => total + Math.trunc(Number(item.system.modifier) || 0), 0) ?? 0;
}

export async function resolveVehicleDriver(vehicle) {
  if (!vehicle || vehicle.type !== "vehicle" || !vehicle.system.driverUuid) return null;
  const actor = await fromUuid(vehicle.system.driverUuid);
  return actor?.documentName === "Actor" || actor?.system ? actor : null;
}

export async function resolveVehicleOccupants(vehicle, { includeDriver = true } = {}) {
  const driverUuid = vehicle?.system?.driverUuid;
  const uuids = [...new Set(vehicle?.system?.occupantUuids ?? [])]
    .filter((uuid) => includeDriver || uuid !== driverUuid);
  if (includeDriver && vehicle?.system?.driverUuid) uuids.push(vehicle.system.driverUuid);
  const actors = (await Promise.all([...new Set(uuids)].map((uuid) => fromUuid(uuid))))
    .filter((actor) => actor?.system && ["character", "npc"].includes(actor.type));
  return actors;
}

async function chooseCrewActor(actors, title) {
  if (actors.length === 0) return null;
  if (actors.length === 1) return actors[0];
  const options = actors.map((actor) => `<option value="${escape(actor.uuid)}">${escape(actor.name)}</option>`).join("");
  const { DialogV2 } = foundry.applications.api;
  const uuid = await DialogV2.wait({
    window: { title },
    content: `<div class="yze"><select name="actor">${options}</select></div>`,
    buttons: [
      { action: "choose", label: game.i18n.localize("YZE.Common.Continue"), default: true,
        callback: (event, button, dialog) => (button.form ?? dialog.element.querySelector("form")).elements.actor?.value },
      { action: "cancel", label: game.i18n.localize("YZE.Common.Cancel"), callback: () => null }
    ], close: () => null, rejectClose: false, modal: true
  });
  return uuid ? fromUuid(uuid) : null;
}

/** Spend the SRD action cost to enter/exit, start, or take control of a vehicle. */
export async function vehicleCrewAction(vehicle, action) {
  if (!vehicle || vehicle.type !== "vehicle" || !["enter", "exit", "start", "grabWheel"].includes(action)) return false;
  const occupants = await resolveVehicleOccupants(vehicle, { includeDriver: true });
  const candidates = action === "enter"
    ? game.actors.filter((actor) => ["character", "npc"].includes(actor.type)
      && !occupants.some((entry) => entry.uuid === actor.uuid))
    : action === "start"
      ? [await resolveVehicleDriver(vehicle)].filter(Boolean)
      : occupants;
  const actor = await chooseCrewActor(candidates, game.i18n.localize(`YZE.Vehicle.CrewActions.${action}`));
  if (!actor || (!game.user?.isGM && actor.isOwner === false)) return false;
  const actionCost = ["enter", "exit"].includes(action) && vehicle.system.quickAccess !== true
    ? { slow: 1 } : { fast: 1 };
  if (!canSpendActorActions(actor, actionCost)) {
    ui.notifications.warn(game.i18n.localize("YZE.Combat.NotEnoughActions"));
    return false;
  }
  if (!await spendActorActions(actor, actionCost)) return false;
  const occupantUuids = new Set(vehicle.system.occupantUuids ?? []);
  if (action === "enter") occupantUuids.add(actor.uuid);
  if (action === "exit") {
    occupantUuids.delete(actor.uuid);
    if (vehicle.system.driverUuid === actor.uuid) await vehicle.update({ "system.driverUuid": "" });
  }
  if (action === "grabWheel") {
    const previous = vehicle.system.driverUuid;
    if (previous && previous !== actor.uuid) occupantUuids.add(previous);
    occupantUuids.delete(actor.uuid);
    await vehicle.update({ "system.driverUuid": actor.uuid });
  }
  if (action === "start") await vehicle.update({ "system.engineRunning": true });
  if (["enter", "exit", "grabWheel"].includes(action)) {
    await vehicle.update({ "system.occupantUuids": [...occupantUuids] });
  }
  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    content: `<div class="yze chat-card"><p>${escape(game.i18n.format("YZE.Vehicle.CrewActionResult", {
      actor: actor.name, vehicle: vehicle.name, action: game.i18n.localize(`YZE.Vehicle.CrewActions.${action}`)
    }))}</p></div>`
  });
  return true;
}

function activeTokenDocument(actor) {
  const tokens = actor?.getActiveTokens?.(true, true) ?? [];
  const current = tokens.find((token) => (
    (token.document ?? token).parent?.id === canvas?.scene?.id
  )) ?? tokens[0] ?? actor?.getActiveTokens?.()?.[0];
  return current?.document ?? current ?? null;
}

async function ricochetCandidates(vehicle) {
  const candidates = new Map();
  const add = (actor) => {
    if (!actor?.system || actor.uuid === vehicle.uuid || actor.system.dead === true
      || actor.system.perished === true || actor.system.destroyed === true) return;
    candidates.set(actor.uuid, actor);
  };
  for (const occupant of await resolveVehicleOccupants(vehicle)) {
    add(occupant);
  }
  const sourceToken = activeTokenDocument(vehicle);
  const sourceZone = sourceToken ? zoneForToken(sourceToken) : null;
  if (sourceZone) {
    for (const token of canvas?.scene?.tokens ?? []) {
      if (!token.actor || token.actor.uuid === vehicle.uuid) continue;
      if (zoneForToken(token)?.id !== sourceZone.id) continue;
      add(token.actor);
    }
  }
  return [...candidates.values()];
}

async function createRicochetConsequence(vehicle, damage) {
  const candidates = await ricochetCandidates(vehicle);
  if (candidates.length === 0) {
    await ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor: vehicle }),
      content: `<div class="yze chat-card"><h3>${escape(game.i18n.localize("YZE.Vehicle.Ricochet"))}</h3><p>${escape(game.i18n.localize("YZE.Vehicle.RicochetNoTarget"))}</p></div>`
    });
    return null;
  }
  const selectionRoll = await new Roll(`1d${candidates.length}`).evaluate();
  const target = candidates[Math.max(0, wholeNumber(selectionRoll.total) - 1)];
  return ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor: vehicle }),
    content: `<div class="yze chat-card yze-ricochet-card">
      <h3>${escape(game.i18n.localize("YZE.Vehicle.Ricochet"))}</h3>
      <p>${escape(game.i18n.format("YZE.Vehicle.RicochetTarget", {
        target: target.name, damage, result: selectionRoll.total, count: candidates.length
      }))}</p>
      <button type="button" data-action="applyRicochet"><i class="fa-solid fa-arrows-turn-to-dots"></i> ${escape(game.i18n.localize("YZE.Vehicle.ApplyRicochet"))}</button>
    </div>`,
    flags: { [SYSTEM_ID]: { [RICOCHET_FLAG]: {
      vehicleUuid: vehicle.uuid,
      targetUuid: target.uuid,
      targetName: target.name,
      damage: wholeNumber(damage)
    } } }
  });
}

export async function applyRicochetOutcome(message) {
  const ricochet = message?.getFlag?.(SYSTEM_ID, RICOCHET_FLAG);
  if (!ricochet || message.getFlag(SYSTEM_ID, RICOCHET_APPLIED_FLAG)) return false;
  const target = await fromUuid(ricochet.targetUuid);
  if (!target?.system || (target.isOwner === false && !game.user?.isGM)) {
    ui.notifications.warn(game.i18n.localize("YZE.Vehicle.RicochetPermission"));
    return false;
  }
  const { applyDamage } = await harmApi();
  const applied = await applyDamage(target, ricochet.damage, {
    category: "physical",
    attributeKey: "strength",
    skipCriticalInjury: true
  });
  if (!applied) return false;
  await message.setFlag(SYSTEM_ID, RICOCHET_APPLIED_FLAG, true);
  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor: target }),
    content: `<div class="yze chat-card"><p>${escape(game.i18n.format("YZE.Vehicle.RicochetApplied", {
      target: target.name, damage: ricochet.damage
    }))}</p></div>`
  });
  return true;
}

export async function beginAerialCrash(vehicle, { formula = "1d3", reason = "wrecked" } = {}) {
  if (vehicle?.type !== "vehicle" || vehicle.system.isAerial !== true
    || vehicle.system.destroyed === true || vehicle.getFlag(SYSTEM_ID, "aerialCrashStarted")) return false;
  const altitude = wholeNumber(vehicle.system.altitude);
  await vehicle.setFlag(SYSTEM_ID, "aerialCrashStarted", {
    altitude, formula, reason, startedAt: Number(game.time?.worldTime) || 0
  });
  if (altitude > 0) await vehicle.update({ "system.altitude": 0 });
  const occupants = await resolveVehicleOccupants(vehicle, { includeDriver: true });
  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor: vehicle }),
    content: `<div class="yze chat-card"><h3>${escape(game.i18n.format("YZE.Vehicle.AerialCrashTitle", { vehicle: vehicle.name }))}</h3><p>${escape(game.i18n.format("YZE.Vehicle.AerialCrashStarted", { altitude, occupants: occupants.length }))}</p></div>`
  });
  for (const occupant of occupants) {
    const fallingRoll = await new Roll(formula).evaluate();
    const rawDamage = wholeNumber(fallingRoll.total) + altitude;
    await ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor: occupant }),
      content: `<div class="yze chat-card yze-aerial-crash-card">
        <h3>${escape(game.i18n.format("YZE.Vehicle.AerialCrashOccupant", { occupant: occupant.name }))}</h3>
        <p>${escape(game.i18n.format("YZE.Vehicle.AerialCrashRaw", {
          roll: fallingRoll.total, altitude, damage: rawDamage
        }))}</p>
        <button type="button" data-action="braceAerialCrash"><i class="fa-solid fa-person-falling"></i> ${escape(game.i18n.localize("YZE.Vehicle.BraceForCrash"))}</button>
        <button type="button" data-action="applyAerialCrashUnbraced"><i class="fa-solid fa-heart-crack"></i> ${escape(game.i18n.localize("YZE.Vehicle.ApplyUnbraced"))}</button>
      </div>`,
      flags: { [SYSTEM_ID]: { [AERIAL_CRASH_FLAG]: {
        vehicleUuid: vehicle.uuid,
        vehicleName: vehicle.name,
        occupantUuid: occupant.uuid,
        occupantName: occupant.name,
        rawDamage,
        altitude,
        formula
      } } }
    });
  }
  return true;
}

async function applyAerialCrashDamage(message, crash, braceSuccesses = 0) {
  const sourceMessage = crash?.sourceMessageId ? game.messages?.get(crash.sourceMessageId) : null;
  if (!crash || message.getFlag(SYSTEM_ID, AERIAL_CRASH_APPLIED_FLAG)
    || sourceMessage?.getFlag(SYSTEM_ID, AERIAL_CRASH_APPLIED_FLAG)) return false;
  const vehicle = await fromUuid(crash.vehicleUuid);
  const occupant = await fromUuid(crash.occupantUuid);
  if (!vehicle?.system || !occupant?.system
    || (!game.user?.isGM && (occupant.isOwner === false || vehicle.isOwner === false))) {
    ui.notifications.warn(game.i18n.localize("YZE.Vehicle.CrashPermission"));
    return false;
  }
  const bracedDamage = Math.max(0, wholeNumber(crash.rawDamage) - wholeNumber(braceSuccesses));
  const { applyDamage, rollArmor } = await harmApi();
  const armor = await rollArmor(vehicle, bracedDamage, "vehicle");
  if (armor.penetrating > 0) await applyDamage(occupant, armor.penetrating, {
    category: "physical",
    skipCriticalInjury: true,
    environmental: true
  });
  await message.setFlag(SYSTEM_ID, AERIAL_CRASH_APPLIED_FLAG, true);
  const pushState = message.getFlag(SYSTEM_ID, "push");
  if (pushState) await message.setFlag(SYSTEM_ID, "push", { ...pushState, canPush: false });
  if (sourceMessage && sourceMessage.id !== message.id) {
    await sourceMessage.setFlag(SYSTEM_ID, AERIAL_CRASH_APPLIED_FLAG, true);
  }
  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor: occupant }),
    content: `<div class="yze chat-card"><p>${escape(game.i18n.format("YZE.Vehicle.AerialCrashApplied", {
      occupant: occupant.name,
      brace: wholeNumber(braceSuccesses),
      armor: armor.absorbed,
      damage: armor.penetrating
    }))}</p></div>`
  });
  return true;
}

export async function applyAerialCrashOutcome(message, state) {
  if (state?.superseded) return false;
  return applyAerialCrashDamage(message, state?.aerialCrash, rollSuccesses(state));
}

export function vehicleDrivingModifier(vehicle) {
  return Math.trunc(Number(vehicle?.system?.maneuverability) || 0)
    + Math.trunc(Number(vehicle?.system?.drivingPenalty) || 0)
    + vehicleComponentModifier(vehicle);
}

export async function vehicleDriverSkill(vehicle) {
  const driver = await resolveVehicleDriver(vehicle);
  if (!driver) return { driver: null, skill: null };
  const requested = String(vehicle.system.drivingSkillName || "Mobility");
  const skill = driver.items.find((item) => item.type === "skill" && item.name.localeCompare(
    requested, undefined, { sensitivity: "base" }
  ) === 0) ?? null;
  return { driver, skill };
}

async function applyVehicleCritical(vehicle, result) {
  const updates = {};
  if (result === 3) updates["system.maneuverability"] = Number(vehicle.system.maneuverability) - 1;
  if (result === 6) updates["system.drivingPenalty"] = Math.min(-2, Number(vehicle.system.drivingPenalty) || 0);
  if ([10, 12].includes(result)) {
    updates["system.hull.value"] = 0;
    updates["system.wrecked"] = true;
  }
  if ([11, 12].includes(result)) updates["system.engineDisabled"] = true;
  if (result === 12) updates["system.destroyed"] = true;
  if (result === 9) {
    const weapons = vehicle.items.filter((item) => (
      item.type === "vehicleComponent" && item.system.componentType === "weapon"
      && item.system.active && !item.system.damaged
    ));
    const weapon = weapons[Math.floor(Math.random() * weapons.length)];
    if (weapon) await weapon.update({ "system.damaged": true });
  }
  if (Object.keys(updates).length > 0) await vehicle.update(updates);
}

async function rollExposure(rating) {
  const step = getDiceSystem() === DICE_SYSTEMS.STEP;
  const formula = step ? `2d${getStepRating(rating).faces}` : `${rating}d6`;
  const roll = await new Roll(formula).evaluate();
  const successes = (roll.dice ?? []).flatMap((die) => die.results ?? [])
    .filter((entry) => entry.active !== false)
    .reduce((total, entry) => total + (step
      ? Number(entry.result) >= 10 ? 2 : Number(entry.result) >= 6 ? 1 : 0
      : Number(entry.result) === 6 ? 1 : 0), 0);
  return { roll, successes };
}

async function applyCrashToOccupants(vehicle, formula) {
  const occupants = await resolveVehicleOccupants(vehicle, { includeDriver: false });
  for (const occupant of occupants) {
    const roll = await new Roll(formula).evaluate();
    const raw = wholeNumber(roll.total) + wholeNumber(vehicle.system.altitude);
    const { applyDamage, rollArmor } = await harmApi();
    const protectedDamage = (await rollArmor(vehicle, raw, "vehicle")).penetrating;
    if (protectedDamage > 0) {
      await applyDamage(occupant, protectedDamage, {
        category: "physical",
        skipCriticalInjury: true,
        environmental: true
      });
    }
  }
}

async function resolveCriticalDrivingTest(vehicle, { crashFormula = null } = {}) {
  const { driver, skill } = await vehicleDriverSkill(vehicle);
  if (!driver || !skill) return false;
  const message = await driver.rollSkill(skill.id, {
    canPush: false,
    canOppose: false,
    allowHelpers: false,
    applyInjuryDamage: false,
    fixedModifiers: [[game.i18n.format("YZE.Vehicle.VehicleModifier", { vehicle: vehicle.name }), vehicleDrivingModifier(vehicle)]]
  });
  const succeeded = rollSuccesses(message?.getFlag(SYSTEM_ID, "push")) > 0;
  if (!succeeded && !crashFormula) {
    const actions = combatActionState(driver);
    if (actions.active) await actions.combatant.setFlag(SYSTEM_ID, "skipNextTurn", true);
    await ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor: driver }),
      content: `<div class="yze chat-card"><p>${escape(game.i18n.format("YZE.Vehicle.SkidTurnLost", { driver: driver.name }))}</p></div>`
    });
  }
  if (!succeeded && crashFormula) {
    await vehicle.update({ "system.hull.value": 0, "system.wrecked": true });
    if (vehicle.system.isAerial) await beginAerialCrash(vehicle, {
      formula: crashFormula,
      reason: "critical"
    });
    else await applyCrashToOccupants(vehicle, crashFormula);
  }
  return succeeded;
}

async function applyVehicleCriticalConsequences(vehicle, result, damage) {
  const { applyDamage } = await harmApi();
  const driver = await resolveVehicleDriver(vehicle);
  const passengers = await resolveVehicleOccupants(vehicle, { includeDriver: false });
  if (result === 1 && damage > 0) await createRicochetConsequence(vehicle, damage);
  if (result === 2) await resolveCriticalDrivingTest(vehicle);
  if (result === 4 && driver && damage > 0) {
    await applyDamage(driver, damage, { category: "physical" });
  }
  if (result === 5 && passengers.length > 0) {
    const passenger = passengers[Math.floor(Math.random() * passengers.length)];
    if (damage > 0) await applyDamage(passenger, damage, {
      category: "physical", skipCriticalInjury: true
    });
    await rollCriticalInjury(passenger, "physical");
  }
  if (result === 7) await resolveCriticalDrivingTest(vehicle, { crashFormula: "1d3" });
  if (result === 10) {
    if (vehicle.system.isAerial) await beginAerialCrash(vehicle, {
      formula: "1d6",
      reason: "massiveCrash"
    });
    else await applyCrashToOccupants(vehicle, "1d6");
  }
  if (result === 8 || result === 12) {
    const actors = [vehicle, ...await resolveVehicleOccupants(vehicle)];
    for (const actor of actors) {
      const exposure = await rollExposure(result === 8
        ? (getDiceSystem() === DICE_SYSTEMS.STEP ? 2 : 6)
        : (getDiceSystem() === DICE_SYSTEMS.STEP ? 3 : 9));
      const raw = result === 8
        ? exposure.successes
        : exposure.successes > 0 ? 3 + exposure.successes - 1 : 0;
      if (raw > 0) await applyDamage(actor, raw, {
        category: "physical",
        skipCriticalInjury: true,
        environmental: true
      });
    }
  }
}

export async function rollVehicleCriticalDamage(vehicle, { faces = 12, damage = 0 } = {}) {
  if (!isVehicleSubsystemEnabled() || vehicle?.type !== "vehicle") return null;
  const dieFaces = Number(faces) === 6 ? 6 : 12;
  let roll;
  let result;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    roll = await new Roll(`1d${dieFaces}`).evaluate();
    result = Math.min(dieFaces, Math.max(1, wholeNumber(roll.total)));
    const hasPassengers = (await resolveVehicleOccupants(vehicle, { includeDriver: false })).length > 0;
    const hasWeapons = vehicle.items.some((item) => item.type === "vehicleComponent"
      && item.system.componentType === "weapon" && item.system.active && !item.system.damaged);
    if (result !== 5 || hasPassengers) {
      if (result !== 9 || hasWeapons) break;
    }
  }
  const critical = VEHICLE_CRITICALS[result - 1];
  await applyVehicleCritical(vehicle, result);
  await applyVehicleCriticalConsequences(vehicle, result, wholeNumber(damage));
  await roll.toMessage({
    speaker: ChatMessage.getSpeaker({ actor: vehicle }),
    flavor: `
      <div class="yze chat-card yze-vehicle-critical-card">
        <h3>${escape(game.i18n.format("YZE.Vehicle.CriticalTitle", { vehicle: vehicle.name }))}</h3>
        <h4>${result}: ${escape(critical.name)}</h4>
        <p>${escape(critical.effect)}</p>
        ${damage ? `<p class="hint">${escape(game.i18n.format("YZE.Vehicle.TriggeringDamage", { damage }))}</p>` : ""}
      </div>`,
    flags: { [SYSTEM_ID]: { vehicleCritical: { vehicleUuid: vehicle.uuid, result, damage } } }
  });
  return critical;
}

export async function applyVehicleManeuverOutcome(message, state) {
  if (!state?.vehicleManeuver || state.superseded
    || message.getFlag(SYSTEM_ID, VEHICLE_MANEUVER_APPLIED_FLAG)) return false;
  const maneuver = state.vehicleManeuver;
  const vehicle = await fromUuid(maneuver.vehicleUuid);
  if (vehicle?.type !== "vehicle" || (vehicle.isOwner === false && !game.user?.isGM)) {
    ui.notifications.warn(game.i18n.localize("YZE.Vehicle.ManeuverPermission"));
    return false;
  }
  const zones = 1 + rollSuccesses(state);
  let appliedZones = zones;
  if (vehicle.system.isAerial && maneuver.axis === "ascend") {
    await vehicle.update({ "system.altitude": wholeNumber(vehicle.system.altitude) + zones });
  } else if (vehicle.system.isAerial && maneuver.axis === "descend") {
    const altitude = wholeNumber(vehicle.system.altitude);
    appliedZones = Math.min(altitude, zones);
    await vehicle.update({ "system.altitude": altitude - appliedZones });
  } else {
    await vehicle.setFlag(SYSTEM_ID, "vehicleMovement", {
      allowedZones: zones,
      altitude: wholeNumber(vehicle.system.altitude),
      combatId: game.combat?.id ?? "",
      round: Number(game.combat?.round) || 0,
      sceneId: canvas?.scene?.id ?? ""
    });
  }
  await message.setFlag(SYSTEM_ID, VEHICLE_MANEUVER_APPLIED_FLAG, true);
  const current = message.getFlag(SYSTEM_ID, "push");
  if (current) await message.setFlag(SYSTEM_ID, "push", {
    ...current,
    canPush: false,
    vehicleManeuver: { ...current.vehicleManeuver, applied: true }
  });
  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor: vehicle }),
    content: `<div class="yze chat-card"><p>${escape(game.i18n.format("YZE.Vehicle.ManeuverApplied", {
      vehicle: vehicle.name,
      axis: maneuver.axis
        ? game.i18n.localize(`YZE.Vehicle.AerialAxes.${maneuver.axis}`)
        : game.i18n.localize("YZE.Vehicle.AerialAxes.horizontal"),
      zones: appliedZones,
      altitude: wholeNumber(vehicle.system.altitude)
    }))}</p></div>`
  });
  return true;
}

export async function controlledAerialLanding(vehicle) {
  if (vehicle?.type !== "vehicle" || vehicle.system.isAerial !== true
    || vehicle.system.engineDisabled !== true || vehicle.system.destroyed === true
    || vehicle.system.wrecked === true || wholeNumber(vehicle.system.altitude) < 1) {
    ui.notifications.warn(game.i18n.localize("YZE.Vehicle.ControlledLandingUnavailable"));
    return false;
  }
  if (vehicle.isOwner === false && !game.user?.isGM) return false;
  const combat = game.combat;
  const previous = vehicle.getFlag(SYSTEM_ID, "controlledLanding");
  if (combat && previous?.combatId === combat.id
    && Number(previous.round) === (Number(combat.round) || 0)) {
    ui.notifications.warn(game.i18n.localize("YZE.Vehicle.ControlledLandingOnce"));
    return false;
  }
  const altitude = Math.max(0, wholeNumber(vehicle.system.altitude) - 1);
  await vehicle.update({ "system.altitude": altitude });
  await vehicle.setFlag(SYSTEM_ID, "controlledLanding", {
    combatId: combat?.id ?? "",
    round: Number(combat?.round) || 0,
    worldTime: Number(game.time?.worldTime) || 0
  });
  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor: vehicle }),
    content: `<div class="yze chat-card"><p>${escape(game.i18n.format(
      altitude > 0 ? "YZE.Vehicle.ControlledLandingProgress" : "YZE.Vehicle.ControlledLandingComplete",
      { vehicle: vehicle.name, altitude }
    ))}</p></div>`
  });
  return true;
}

export async function rollVehicleManeuver(vehicle, { ram = false, targetActorUuid = "" } = {}) {
  if (!isVehicleSubsystemEnabled()) return null;
  if (vehicle?.system?.wrecked || vehicle?.system?.engineDisabled || vehicle?.system?.destroyed) {
    ui.notifications.warn(game.i18n.localize("YZE.Vehicle.Inoperable"));
    return null;
  }
  if (vehicle.system.engineRunning === false) {
    ui.notifications.warn(game.i18n.localize("YZE.Vehicle.EngineNotRunning"));
    return null;
  }
  const { driver, skill } = await vehicleDriverSkill(vehicle);
  if (!driver) {
    ui.notifications.warn(game.i18n.localize("YZE.Vehicle.DriverMissing"));
    return null;
  }
  if (!skill) {
    ui.notifications.warn(game.i18n.format("YZE.Vehicle.DrivingSkillMissing", {
      actor: driver.name, skill: vehicle.system.drivingSkillName
    }));
    return null;
  }
  let axis = null;
  if (!ram && vehicle.system.isAerial) {
    const { DialogV2 } = foundry.applications.api;
    axis = await DialogV2.wait({
      window: { title: game.i18n.localize("YZE.Vehicle.AerialManeuverTitle") },
      content: `<div class="yze"><p>${escape(game.i18n.localize("YZE.Vehicle.AerialManeuverHint"))}</p><div class="form-group"><label>${escape(game.i18n.localize("YZE.Vehicle.MovementAxis"))}</label><select name="axis"><option value="horizontal">${escape(game.i18n.localize("YZE.Vehicle.AerialAxes.horizontal"))}</option><option value="ascend">${escape(game.i18n.localize("YZE.Vehicle.AerialAxes.ascend"))}</option><option value="descend">${escape(game.i18n.localize("YZE.Vehicle.AerialAxes.descend"))}</option></select></div></div>`,
      buttons: [
        { action: "continue", label: game.i18n.localize("YZE.Common.Continue"), icon: "fa-solid fa-plane", default: true,
          callback: (event, button, dialog) => (button.form ?? dialog.element.querySelector("form")).elements.axis?.value },
        { action: "cancel", label: game.i18n.localize("YZE.Common.Cancel"), callback: () => null }
      ], close: () => null, rejectClose: false, modal: true
    });
    if (!axis) return null;
    if (axis === "descend" && wholeNumber(vehicle.system.altitude) < 1) {
      ui.notifications.warn(game.i18n.localize("YZE.Vehicle.AlreadyGrounded"));
      return null;
    }
  }
  const actionCost = ram ? { slow: 1 } : { fast: 1 };
  if (!canSpendActorActions(driver, actionCost)) {
    ui.notifications.warn(game.i18n.localize("YZE.Combat.NotEnoughActions"));
    return null;
  }
  let attack = null;
  if (ram) {
    const targets = [...(game.user?.targets ?? [])].filter((token) => token.actor);
    const forcedTarget = targetActorUuid ? await fromUuid(targetActorUuid) : null;
    if (!forcedTarget?.system && targets.length !== 1) {
      ui.notifications.warn(game.i18n.localize("YZE.Combat.SelectOneTarget"));
      return null;
    }
    const target = forcedTarget?.system ? forcedTarget : targets[0].actor;
    attack = {
      attackerActorUuid: vehicle.uuid,
      targetActorUuid: target.uuid,
      targetName: target.name,
      weaponItemId: null,
      weaponName: game.i18n.format("YZE.Vehicle.RammingWith", { vehicle: vehicle.name }),
      baseDamage: Math.ceil(wholeNumber(vehicle.system.hull.max) / 2),
      kind: "melee",
      range: "engaged"
    };
  }
  const modifier = vehicleDrivingModifier(vehicle);
  const message = await driver.rollSkill(skill.id, {
    fixedModifiers: [[game.i18n.format("YZE.Vehicle.VehicleModifier", { vehicle: vehicle.name }), modifier]],
    canOppose: ram,
    helpAction: actionCost.slow ? "slow" : "fast",
    attack,
    vehicleManeuver: ram ? null : {
      vehicleUuid: vehicle.uuid,
      vehicleName: vehicle.name,
      axis,
      altitudeBefore: wholeNumber(vehicle.system.altitude)
    }
  });
  if (!message) return null;
  await spendActorActions(driver, actionCost);
  return message;
}

export function registerVehicleHooks() {
  Hooks.on("renderChatMessageHTML", (message, html) => {
    const root = html?.querySelector ? html : html?.[0];
    const bind = (selector, callback, appliedFlag = null) => {
      const button = root?.querySelector?.(selector);
      if (!button) return;
      if (appliedFlag && message.getFlag(SYSTEM_ID, appliedFlag)) { button.disabled = true; return; }
      button.addEventListener("click", async () => {
        button.disabled = true;
        try {
          if (!await callback()) button.disabled = false;
        } catch (error) {
          console.error("YZE System Toolkit | Vehicle chat action failed", error);
          button.disabled = false;
        }
      });
    };
    bind('[data-action="applyVehicleManeuver"]', () => (
      applyVehicleManeuverOutcome(message, message.getFlag(SYSTEM_ID, "push"))
    ), VEHICLE_MANEUVER_APPLIED_FLAG);
    bind('[data-action="applyRicochet"]', () => applyRicochetOutcome(message), RICOCHET_APPLIED_FLAG);
    bind('[data-action="applyAerialCrash"]', () => (
      applyAerialCrashOutcome(message, message.getFlag(SYSTEM_ID, "push"))
    ), AERIAL_CRASH_APPLIED_FLAG);
    bind('[data-action="applyAerialCrashUnbraced"]', () => (
      message.getFlag(SYSTEM_ID, "aerialCrashBraceStarted")
        ? false
        : applyAerialCrashDamage(message, message.getFlag(SYSTEM_ID, AERIAL_CRASH_FLAG), 0)
    ), AERIAL_CRASH_APPLIED_FLAG);
    bind('[data-action="braceAerialCrash"]', async () => {
      if (message.getFlag(SYSTEM_ID, "aerialCrashBraceStarted")
        || message.getFlag(SYSTEM_ID, AERIAL_CRASH_APPLIED_FLAG)) return false;
      const crash = message.getFlag(SYSTEM_ID, AERIAL_CRASH_FLAG);
      const occupant = crash?.occupantUuid ? await fromUuid(crash.occupantUuid) : null;
      if (!occupant?.system || (occupant.isOwner === false && !game.user?.isGM)) return false;
      const mobility = occupant.items.find((item) => item.type === "skill"
        && item.name.localeCompare("Mobility", undefined, { sensitivity: "base" }) === 0);
      if (!mobility) {
        ui.notifications.warn(game.i18n.format("YZE.Vehicle.BraceSkillMissing", { occupant: occupant.name }));
        return false;
      }
      const braceMessage = await occupant.rollSkill(mobility.id, {
        canOppose: false,
        allowHelpers: false,
        applyInjuryDamage: false,
        aerialCrash: { ...crash, sourceMessageId: message.id }
      });
      if (!braceMessage) return false;
      await message.setFlag(SYSTEM_ID, "aerialCrashBraceStarted", true);
      return true;
    });
    if (message.getFlag(SYSTEM_ID, "aerialCrashBraceStarted")
      || message.getFlag(SYSTEM_ID, AERIAL_CRASH_APPLIED_FLAG)) {
      for (const button of root?.querySelectorAll?.(
        '[data-action="braceAerialCrash"], [data-action="applyAerialCrashUnbraced"]'
      ) ?? []) button.disabled = true;
    }
  });
}
