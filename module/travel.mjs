import { SYSTEM_ID } from "./constants.mjs";
import { getConsumableMode, isTravelEnabled } from "./settings.mjs";
import { vehicleDriverSkill, vehicleDrivingModifier } from "./vehicles.mjs";
import { clearEnvironmentalHazard, updateEnvironmentalHazards } from "./hazard-state.mjs";
import { applyDamage, recoverShift, relieveStress } from "./harm.mjs";
import { countStateSuccesses } from "./dice/successes.mjs";
import { rollColdExposure, rollFireExposure } from "./environmental-hazards.mjs";
import {
  criticalInjurySleepSkill,
  getCriticalInjuryRestrictions
} from "./critical-injuries.mjs";
import { mountMobilityRoll, resolveMountRider } from "./mounts.mjs";
import {
  addConsumableAmount,
  addFood,
  applyCookingOutcome,
  foodItemAmount,
  isFoodItem
} from "./food.mjs";
import {
  addTravelDetour,
  approveTravelNavigation,
  advanceTravelRoute,
  deviateTravelRoute,
  travelMapState
} from "./travel-map.mjs";
import { promptAmbush } from "./surprise.mjs";
import { getSRDRollTable } from "./srd-content/packs.mjs";

const APPLIED_FLAG = "travelApplied";
const SHIFTS = Object.freeze(["morning", "day", "evening", "night"]);
const WEATHER = Object.freeze(["heavy", "cloudy", "fair"]);
const ACTIVITIES = Object.freeze({
  march: "Survival",
  navigate: "Survival",
  keepWatch: "Observation",
  forageFood: "Survival",
  forageWater: "Survival",
  hunt: "Survival",
  fish: "Survival",
  camp: "Survival",
  cook: "Survival",
  forcedMarch: "Stamina",
  gatherFuel: "Survival",
  rest: "Stamina",
  sleep: "Stamina"
});

const TERRAIN = Object.freeze({
  road: { foraging: 0, hunting: 0, march: 2 },
  open: { foraging: -1, hunting: 1, march: 2 },
  woods: { foraging: 1, hunting: 1, march: 1 },
  hills: { foraging: 0, hunting: 0, march: 1 },
  mountains: { foraging: -2, hunting: -1, march: 1 },
  water: { foraging: 0, hunting: 0, march: 1 },
  swamp: { foraging: -1, hunting: 0, march: 1 },
  ruins: { foraging: -2, hunting: -1, march: 1 }
});
const ENCOUNTER_RANGES = Object.freeze({
  road: "Long", open: "Extreme", woods: "Medium", hills: "Long",
  mountains: "Long", water: "Extreme", swamp: "Long", ruins: "Medium"
});
const TRAVEL_LEDGER_FLAG = "travelLedger";
const HUNTING_FLAG = "huntingPrey";
const HUNTING_PREY = Object.freeze([
  Object.freeze({ key: "grouse", health: 1, trappable: false, foodFormula: "1" }),
  Object.freeze({ key: "rabbit", health: 1, trappable: true, foodFormula: "1" }),
  Object.freeze({ key: "fox", health: 1, trappable: true, foodFormula: "1d3" }),
  Object.freeze({ key: "deer", health: 2, trappable: false, foodFormula: "2d6" }),
  Object.freeze({ key: "boar", health: 3, trappable: false, foodFormula: "2d6 * 2" }),
  Object.freeze({ key: "moose", health: 5, trappable: false, foodFormula: "2d6 * 4" })
]);
const PARTY_TASK_RULES = Object.freeze({
  navigate: Object.freeze({ group: "navigate", locationScoped: false }),
  keepWatch: Object.freeze({ group: "keepWatch", locationScoped: false }),
  forageFood: Object.freeze({ group: "forage", locationScoped: true }),
  forageWater: Object.freeze({ group: "forage", locationScoped: true }),
  hunt: Object.freeze({ group: "hunt", locationScoped: true }),
  fish: Object.freeze({ group: "fish", locationScoped: true }),
  camp: Object.freeze({ group: "camp", locationScoped: false })
});

function escape(value) {
  return foundry.utils.escapeHTML(String(value));
}

function wholeNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.trunc(number)) : 0;
}

function rollSuccesses(state) {
  return countStateSuccesses(state);
}

async function advanceJourney(hexes, travel, mode) {
  const requested = wholeNumber(hexes);
  const route = await advanceTravelRoute(requested, {
    clock: travel.clock,
    mode,
    useTerrainCosts: travel.useTerrainCosts === true,
    maximumHexes: Number.isFinite(Number(travel.maximumHexes))
      ? Math.max(0, Math.trunc(Number(travel.maximumHexes)))
      : Number.POSITIVE_INFINITY
  });
  const moved = route.configured ? wholeNumber(route.moved) : requested;
  const current = Number(game.settings.get(SYSTEM_ID, "travelDistance")) || 0;
  if (moved > 0) await game.settings.set(SYSTEM_ID, "travelDistance", current + moved);
  if (route.alreadyMoved) {
    ui.notifications.warn(game.i18n.localize("YZE.TravelMap.AlreadyMoved"));
  }
  if (route.requiresNavigation) {
    ui.notifications.warn(game.i18n.localize("YZE.TravelMap.NavigationRequired"));
  } else if (route.requiresAdditionalRoll) {
    ui.notifications.warn(game.i18n.localize("YZE.TravelMap.TerrainRollRequired"));
  }
  return { moved, total: current + moved, route };
}

export function getTravelClock() {
  const shift = game.settings.get(SYSTEM_ID, "travelShift");
  const weather = game.settings.get(SYSTEM_ID, "travelWeather");
  return {
    day: Math.max(1, wholeNumber(game.settings.get(SYSTEM_ID, "travelDay")) || 1),
    shift: SHIFTS.includes(shift) ? shift : "morning",
    weather: WEATHER.includes(weather) ? weather : "fair",
    distance: Number(game.settings.get(SYSTEM_ID, "travelDistance")) || 0
  };
}

export function travelLedger(actor) {
  const ledger = actor?.getFlag?.(SYSTEM_ID, TRAVEL_LEDGER_FLAG);
  return ledger && typeof ledger === "object" ? foundry.utils.deepClone(ledger) : { tasks: {}, histories: {}, marches: {} };
}

function clockKey(clock = getTravelClock()) {
  return `${clock.day}:${clock.shift}`;
}

function sameClock(left, right) {
  return left && right && clockKey(left) === clockKey(right);
}

function normalizedLocation(value) {
  return String(value ?? "").trim().toLocaleLowerCase();
}

function samePartyTask(left, right) {
  const leftRule = PARTY_TASK_RULES[left?.activity];
  const rightRule = PARTY_TASK_RULES[right?.activity];
  if (!leftRule || !rightRule || leftRule.group !== rightRule.group) return false;
  if (!leftRule.locationScoped) return true;
  return normalizedLocation(left.location) === normalizedLocation(right.location);
}

function ledgerTaskDetails(actor, clock) {
  const ledger = travelLedger(actor);
  const key = clockKey(clock);
  const details = Array.isArray(ledger.taskDetails?.[key])
    ? ledger.taskDetails[key].filter((entry) => entry?.activity)
    : [];
  const detailedActivities = new Set(details.map((entry) => entry.activity));
  const legacyDetails = (ledger.tasks?.[key] ?? [])
    .filter((activity) => !detailedActivities.has(activity))
    .map((activity) => ({ activity, location: "" }));
  return [...details, ...legacyDetails];
}

function partyTaskClaims(travel, { excludeMessageId = null } = {}) {
  if (!PARTY_TASK_RULES[travel?.activity] || !travel.clock) return [];
  const claims = [];
  for (const message of game.messages ?? []) {
    if (message.id === excludeMessageId) continue;
    const state = message.getFlag?.(SYSTEM_ID, "push");
    if (!state?.travel || state.superseded || !sameClock(state.travel.clock, travel.clock)
      || !samePartyTask(state.travel, travel)) continue;
    claims.push({
      actorUuid: state.actorUuid,
      actorName: state.actorName || message.speaker?.alias || "Unknown Actor",
      activity: state.travel.activity,
      location: state.travel.location,
      messageId: message.id,
      timestamp: Number(message.timestamp) || 0
    });
  }
  return claims.sort((left, right) => left.timestamp - right.timestamp
    || left.messageId.localeCompare(right.messageId));
}

/** Return the completed or pending assignment which already owns a party-limited task. */
export function partyTravelTaskConflict(actor, travel, { currentMessage = null } = {}) {
  if (!PARTY_TASK_RULES[travel?.activity] || !travel.clock) return null;
  for (const partyActor of game.actors ?? []) {
    const existing = ledgerTaskDetails(partyActor, travel.clock)
      .find((entry) => samePartyTask(entry, travel));
    if (existing) return {
      actorUuid: partyActor.uuid,
      actorName: partyActor.name,
      activity: existing.activity,
      location: existing.location,
      completed: true
    };
  }

  const claims = partyTaskClaims(travel, { excludeMessageId: currentMessage?.id ?? null });
  if (!currentMessage) return claims[0] ?? null;
  const currentClaim = {
    messageId: currentMessage.id,
    timestamp: Number(currentMessage.timestamp) || 0
  };
  return claims.find((claim) => claim.timestamp < currentClaim.timestamp
    || (claim.timestamp === currentClaim.timestamp
      && claim.messageId.localeCompare(currentClaim.messageId) < 0)) ?? null;
}

function warnPartyTaskConflict(conflict) {
  ui.notifications.warn(game.i18n.format("YZE.Travel.PartyTaskTaken", {
    activity: activityLabel(conflict.activity),
    actor: conflict.actorName
  }));
}

function canTakeTravelTask(actor, activity) {
  if (activity === "navigate") return true;
  if (["march", "forcedMarch"].includes(activity)) {
    const progress = travelMapState().route?.progress?.[clockKey()];
    if (progress?.requiresNavigation === true || progress?.requiresAdditionalRoll === true) return true;
  }
  const existing = travelLedger(actor).tasks?.[clockKey()] ?? [];
  if (existing.length === 0) return true;
  const marching = (task) => ["march", "forcedMarch"].includes(task);
  return (activity === "keepWatch" && existing.every(marching))
    || (marching(activity) && existing.every((task) => task === "keepWatch"));
}

async function recordTravelTask(actor, travel) {
  const ledger = travelLedger(actor);
  const key = clockKey(travel.clock);
  ledger.tasks ??= {};
  ledger.tasks[key] = [...new Set([...(ledger.tasks[key] ?? []), travel.activity])];
  ledger.taskDetails ??= {};
  ledger.taskDetails[key] ??= [];
  if (!ledger.taskDetails[key].some((entry) => entry?.activity === travel.activity
    && normalizedLocation(entry.location) === normalizedLocation(travel.location))) {
    ledger.taskDetails[key].push({
      activity: travel.activity,
      location: String(travel.location ?? "").trim()
    });
  }
  if (["march", "forcedMarch"].includes(travel.activity)) {
    ledger.marches ??= {};
    ledger.marches[travel.clock.day] = wholeNumber(ledger.marches[travel.clock.day]) + 1;
  }
  if (["forageFood", "forageWater", "hunt", "fish"].includes(travel.activity) && travel.location) {
    ledger.histories ??= {};
    const historyKey = `${travel.activity}:${travel.location}`;
    const previous = ledger.histories[historyKey];
    const resetDays = travel.activity === "fish" ? 1 : 7;
    const continued = previous && travel.clock.day - wholeNumber(previous.day) < resetDays;
    ledger.histories[historyKey] = { day: travel.clock.day, count: continued ? wholeNumber(previous.count) + 1 : 1 };
  }
  await actor.setFlag(SYSTEM_ID, TRAVEL_LEDGER_FLAG, ledger);
}

export async function advanceTravelShift() {
  if (!isTravelEnabled() || !game.user?.isGM) {
    ui.notifications.warn(game.i18n.localize("YZE.Travel.GMOnlyClock"));
    return null;
  }
  const current = getTravelClock();
  const index = SHIFTS.indexOf(current.shift);
  const nextShift = SHIFTS[(index + 1) % SHIFTS.length];
  const nextDay = nextShift === "morning" ? current.day + 1 : current.day;
  if (typeof game.time?.advance === "function") await game.time.advance(21600);
  if (nextShift === "morning") {
    const worldTime = Number(game.time?.worldTime) || 0;
    for (const actor of game.actors?.filter((entry) => entry.type === "character") ?? []) {
      const ledger = travelLedger(actor);
      const slept = Object.entries(ledger.tasks ?? {}).some(([key, tasks]) => (
        key.startsWith(`${current.day}:`) && Array.isArray(tasks) && tasks.includes("sleep")
      ));
      if (slept) await clearEnvironmentalHazard(actor, "sleepDeprivation");
      else await updateEnvironmentalHazards(actor, {
        sleepDeprivation: { active: true, due: false, startedAt: worldTime }
      });
      const lastMealAt = Number(actor.getFlag(SYSTEM_ID, "lastMealAt"));
      if (!Number.isFinite(lastMealAt) || worldTime - lastMealAt >= 86400) {
        await updateEnvironmentalHazards(actor, {
          starvation: { active: true, due: false, nextAt: worldTime + 7 * 86400 }
        });
      }
    }
  }
  let nextWeather = current.weather;
  const roll = await new Roll("1d6").evaluate();
  const weatherRoll = wholeNumber(roll.total);
  const weatherIndex = WEATHER.indexOf(current.weather);
  if (weatherRoll === 1) nextWeather = WEATHER[Math.max(0, weatherIndex - 1)];
  if (weatherRoll === 6) nextWeather = WEATHER[Math.min(WEATHER.length - 1, weatherIndex + 1)];
  await game.settings.set(SYSTEM_ID, "travelDay", nextDay);
  await game.settings.set(SYSTEM_ID, "travelShift", nextShift);
  await game.settings.set(SYSTEM_ID, "travelWeather", nextWeather);
  await ChatMessage.create({
    content: `<div class="yze chat-card yze-travel-card"><h3>${escape(game.i18n.localize("YZE.Travel.ClockAdvanced"))}</h3><p>${escape(game.i18n.format("YZE.Travel.ClockSummary", {
      day: nextDay,
      shift: game.i18n.localize(`YZE.Travel.Shifts.${nextShift}`),
      weather: game.i18n.localize(`YZE.Travel.Weather.${nextWeather}`)
    }))}</p>${weatherRoll ? `<p class="hint">${escape(game.i18n.format("YZE.Travel.WeatherRoll", { result: weatherRoll }))}</p>` : ""}</div>`
  });
  return getTravelClock();
}

function activityLabel(key) {
  return game.i18n.localize(`YZE.Travel.Activities.${key}`);
}

export function renderTravelControl(state) {
  if (!state?.travel) return "";
  const successes = rollSuccesses(state);
  const applied = state.travel.applied === true;
  return `
    <div class="yze-travel-result">
      <h4>${escape(activityLabel(state.travel.activity))}</h4>
      <p>${escape(game.i18n.format(
        successes > 0 ? "YZE.Travel.RollSucceeded" : "YZE.Travel.RollFailed",
        { successes }
      ))}</p>
      <button type="button" data-action="applyTravelOutcome"${applied ? " disabled" : ""}>
        <i class="fa-solid fa-route" aria-hidden="true"></i>
        ${escape(game.i18n.localize(applied ? "YZE.Travel.OutcomeApplied" : "YZE.Travel.ApplyOutcome"))}
      </button>
    </div>`;
}

async function drawNamedTable(name, draws = 1, { messageMode = null } = {}) {
  const table = await getSRDRollTable(name);
  if (!table) {
    ui.notifications.error(game.i18n.format("YZE.Travel.TableMissing", { table: name }));
    return false;
  }
  const results = [];
  for (let index = 0; index < draws; index += 1) {
    results.push(await table.draw({ displayChat: true, ...(messageMode ? { messageMode } : {}) }));
  }
  return results;
}

function travelPartyActors(day) {
  return game.actors.filter((actor) => actor.type === "character"
    && Object.keys(travelLedger(actor).tasks ?? {}).some((key) => key.startsWith(`${day}:`)));
}

async function loseRandomCampGear(actor) {
  const gear = actor?.items?.filter((item) => ["gear", "weapon", "armor", "consumable"].includes(item.type)
    && wholeNumber(item.system.quantity) > 0) ?? [];
  const item = gear[Math.floor(Math.random() * gear.length)];
  if (!item) return null;
  await item.setFlag(SYSTEM_ID, "lostInCamp", true);
  await resultMessage(actor, "YZE.Travel.CampGearLost", { actor: actor.name, item: item.name });
  return item;
}

async function resolveCampMishap(clock) {
  const roll = await new Roll("1d10").evaluate();
  const result = wholeNumber(roll.total);
  const table = await getSRDRollTable("YZE Camp Mishaps");
  if (table) await table.draw({ displayChat: true, messageMode: "blindroll", roll });
  const party = travelPartyActors(clock.day);
  if (result === 1) {
    for (const actor of party) {
      for (const item of actor.items.filter(isFoodItem)) {
        const amount = foodItemAmount(item);
        if (amount > 0) await item.update({ [`system.${getConsumableMode() === "supply" ? "supply" : "quantity"}`]: Math.floor(amount / 2) });
      }
    }
  } else if (result === 2) {
    await game.settings.set(SYSTEM_ID, "travelWeather", "heavy");
    for (const actor of party) {
      await updateEnvironmentalHazards(actor, { sleepDeprivation: { active: true, due: false } });
      await rollColdExposure(actor, { name: game.i18n.localize("YZE.Travel.CampMishap") });
    }
  } else if (result === 3) {
    for (const actor of party) await rollColdExposure(actor, { name: game.i18n.localize("YZE.Travel.CampMishap") });
  } else if (result === 4) {
    for (const actor of party) {
      await rollFireExposure(actor, { poolRating: 3, stepRating: 1, name: game.i18n.localize("YZE.Travel.CampMishap") });
      const mobility = actor.items.find((item) => item.type === "skill"
        && item.name.localeCompare("Mobility", undefined, { sensitivity: "base" }) === 0);
      if (mobility) await actor.rollSkill(mobility.id, {
        canOppose: false,
        travel: { activity: "campFireSave", followup: true, clock }
      });
      else await loseRandomCampGear(actor);
    }
  } else if (result === 5) {
    for (const actor of party) {
      await applyDamage(actor, 1, { category: "mental", attributeKey: "empathy", skipCriticalInjury: true });
      await updateEnvironmentalHazards(actor, { sleepDeprivation: { active: true, due: false } });
    }
  } else if (result === 6 && party.length > 0) {
    const actor = party[Math.floor(Math.random() * party.length)];
    await applyDamage(actor, 1, { category: "mental", attributeKey: "empathy", skipCriticalInjury: true });
    await updateEnvironmentalHazards(actor, { lice: { active: true, due: false, nextAt: (Number(game.time?.worldTime) || 0) + 86400 } });
  } else if (result === 7) {
    for (const actor of party) {
      const stress = (await new Roll("2d6").evaluate()).dice.flatMap((die) => die.results).filter((entry) => entry.result === 6).length;
      if (stress > 0) await applyDamage(actor, stress, { category: "mental", attributeKey: "empathy", skipCriticalInjury: true });
    }
  } else if (result === 8) {
    await drawNamedTable("YZE Sample Hunting", 1, { messageMode: "blindroll" });
  } else if ([9, 10].includes(result)) {
    const gear = party.flatMap((actor) => actor.items.filter((item) => ["gear", "weapon"].includes(item.type))
      .map((item) => ({ actor, item })));
    const selected = gear[Math.floor(Math.random() * gear.length)];
    if (selected) {
      if (result === 9) await selected.item.setFlag(SYSTEM_ID, "lostInCamp", true);
      else if (selected.item.system.reliability) await selected.item.update({ "system.reliability.value": 0 });
      else await selected.item.update({ "system.bonus": 0 });
      await resultMessage(selected.actor, result === 9 ? "YZE.Travel.CampGearLost" : "YZE.Travel.CampGearBroken", { actor: selected.actor.name, item: selected.item.name });
    }
  }
  return result;
}

function preyName(prey) {
  return game.i18n.localize(`YZE.Travel.Prey.${prey.key}`);
}

function renderTrackedPrey(data) {
  const resolved = data.resolved === true;
  const pending = data.pending === true;
  const entries = data.prey.map((prey, index) => `<li>
    <strong>${escape(preyName(prey))}</strong> — ${escape(game.i18n.format("YZE.Travel.PreyDetails", {
      health: prey.health,
      food: prey.foodFormula
    }))}
    <button type="button" data-action="huntPrey" data-prey-index="${index}"${resolved || pending || data.awaitingShot ? " disabled" : ""}>
      <i class="fa-solid fa-crosshairs" aria-hidden="true"></i> ${escape(game.i18n.localize("YZE.Travel.HuntPrey"))}
    </button>
    ${data.awaitingShot === index ? `<button type="button" data-action="resolveHuntingShot" data-prey-index="${index}"><i class="fa-solid fa-bullseye"></i> ${escape(game.i18n.localize("YZE.Travel.ResolveHuntingShot"))}</button>` : ""}
    ${prey.trappable ? `<button type="button" data-action="trapPrey" data-prey-index="${index}"${resolved || pending || data.awaitingShot ? " disabled" : ""}>
      <i class="fa-solid fa-basket-shopping" aria-hidden="true"></i> ${escape(game.i18n.localize("YZE.Travel.TrapPrey"))}
    </button>` : `<span class="hint">${escape(game.i18n.localize("YZE.Travel.NotTrappable"))}</span>`}
  </li>`).join("");
  const status = resolved
    ? game.i18n.localize("YZE.Travel.HuntResolved")
    : pending ? game.i18n.localize("YZE.Travel.TrapPending") : game.i18n.localize("YZE.Travel.ChooseTrackedPrey");
  return `<div class="yze chat-card yze-hunting-card">
    <h3>${escape(game.i18n.localize("YZE.Travel.TrackedPrey"))}</h3>
    <p>${escape(status)}</p><ol>${entries}</ol>
    <p class="hint">${escape(game.i18n.localize("YZE.Travel.HuntingAttackHint"))}</p>
  </div>`;
}

async function startHuntingStalk(message, preyIndex) {
  const hunting = message.getFlag(SYSTEM_ID, HUNTING_FLAG);
  const actor = hunting?.actorUuid ? await fromUuid(hunting.actorUuid) : null;
  const prey = hunting?.prey?.[preyIndex];
  const observation = actor?.items?.find((item) => item.type === "skill"
    && item.name.localeCompare("Observation", undefined, { sensitivity: "base" }) === 0);
  if (message.author?.id !== game.user?.id && !game.user?.isGM
    || (actor?.isOwner === false && !game.user?.isGM)) {
    ui.notifications.warn(game.i18n.localize("YZE.Travel.NotAllowed"));
    return null;
  }
  if (!actor || !prey || !observation) {
    ui.notifications.warn(game.i18n.localize("YZE.Travel.HuntingObservationMissing"));
    return null;
  }
  return actor.rollSkill(observation.id, {
    canOppose: false,
    travel: {
      activity: "stalk", followup: true, sourceMessageId: message.id,
      preyIndex, preyName: preyName(prey), clock: hunting.clock
    }
  });
}

async function resolveHuntingShot(message, preyIndex) {
  const hunting = message.getFlag(SYSTEM_ID, HUNTING_FLAG);
  const actor = hunting?.actorUuid ? await fromUuid(hunting.actorUuid) : null;
  const prey = hunting?.prey?.[preyIndex];
  if (message.author?.id !== game.user?.id && !game.user?.isGM
    || (actor?.isOwner === false && !game.user?.isGM)) {
    ui.notifications.warn(game.i18n.localize("YZE.Travel.NotAllowed"));
    return false;
  }
  if (!actor || !prey || hunting.awaitingShot !== preyIndex || hunting.resolved) return false;
  const { DialogV2 } = foundry.applications.api;
  const result = await DialogV2.wait({
    window: { title: game.i18n.localize("YZE.Travel.ResolveHuntingShot") },
    content: `<div class="yze"><p>${escape(game.i18n.format("YZE.Travel.HuntingShotHint", { prey: preyName(prey), health: prey.health }))}</p><label>${escape(game.i18n.localize("YZE.Item.Damage"))}<input type="number" name="damage" value="0" min="0"></label><label class="checkbox-row"><input type="checkbox" name="critical"> ${escape(game.i18n.localize("YZE.Travel.CriticalHit"))}</label></div>`,
    buttons: [{ action: "resolve", label: game.i18n.localize("YZE.Common.Continue"), default: true,
      callback: (event, button, dialog) => { const form = button.form ?? dialog.element.querySelector("form"); return { damage: wholeNumber(form.elements.damage?.value), critical: form.elements.critical?.checked === true }; } },
    { action: "cancel", label: game.i18n.localize("YZE.Common.Cancel"), callback: () => null }],
    close: () => null, rejectClose: false, modal: true
  });
  if (!result) return false;
  let amount = 0;
  if (result.critical || result.damage >= prey.health) {
    amount = wholeNumber((await new Roll(prey.foodFormula).evaluate()).total);
    await addFood(actor, { type: "meat", state: "raw", amount });
    await resultMessage(actor, "YZE.Travel.HuntKilled", { actor: actor.name, prey: preyName(prey), amount });
  } else {
    await resultMessage(actor, "YZE.Travel.HuntEscaped", { actor: actor.name, prey: preyName(prey) });
  }
  const resolved = { ...hunting, awaitingShot: null, resolved: true, foodGained: amount };
  await message.setFlag(SYSTEM_ID, HUNTING_FLAG, resolved);
  await message.update({ content: renderTrackedPrey(resolved) });
  return true;
}

async function drawTrackedPrey(actor, successes, clock) {
  const table = await getSRDRollTable("YZE Sample Hunting");
  if (!table) {
    ui.notifications.error(game.i18n.format("YZE.Travel.TableMissing", { table: "YZE Sample Hunting" }));
    return null;
  }
  const prey = [];
  for (let index = 0; index < successes; index += 1) {
    const roll = await new Roll("1d6").evaluate();
    await table.draw({ displayChat: true, roll });
    prey.push(foundry.utils.deepClone(HUNTING_PREY[Math.max(0, Math.min(5, wholeNumber(roll.total) - 1))]));
  }
  const data = { actorUuid: actor.uuid, clock, prey, pending: false, resolved: false };
  return ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    content: renderTrackedPrey(data),
    flags: { [SYSTEM_ID]: { [HUNTING_FLAG]: data } }
  });
}

async function chooseTrapGear(actor) {
  const gear = actor.items.filter((item) => item.type === "gear" && wholeNumber(item.system.quantity) > 0);
  if (gear.length === 0) {
    ui.notifications.warn(game.i18n.localize("YZE.Travel.TrapGearMissing"));
    return null;
  }
  const options = gear.map((item) => `<option value="${escape(item.id)}">${escape(item.name)}</option>`).join("");
  const { DialogV2 } = foundry.applications.api;
  return DialogV2.wait({
    window: { title: game.i18n.localize("YZE.Travel.TrapPrey") },
    content: `<div class="yze yze-travel-dialog">
      <div class="form-group"><label>${escape(game.i18n.localize("YZE.Travel.TrapGear"))}</label><select name="gear">${options}</select></div>
      <p class="hint">${escape(game.i18n.localize("YZE.Travel.TrapGearHint"))}</p>
    </div>`,
    buttons: [
      { action: "trap", label: game.i18n.localize("YZE.Travel.TrapPrey"), icon: "fa-solid fa-basket-shopping", default: true,
        callback: (event, button, dialog) => (button.form ?? dialog.element.querySelector("form")).elements.gear?.value },
      { action: "cancel", label: game.i18n.localize("YZE.Common.Cancel"), callback: () => null }
    ],
    close: () => null, rejectClose: false, modal: true
  });
}

async function startTrapping(message, preyIndex) {
  const hunting = foundry.utils.deepClone(message.getFlag(SYSTEM_ID, HUNTING_FLAG));
  const prey = hunting?.prey?.[preyIndex];
  if (!hunting || hunting.resolved || hunting.pending || !prey?.trappable) return null;
  if (message.author?.id !== game.user?.id && !game.user?.isGM) {
    ui.notifications.warn(game.i18n.localize("YZE.Travel.NotAllowed"));
    return null;
  }
  const actor = await fromUuid(hunting.actorUuid);
  if (!actor?.system || (actor.isOwner === false && !game.user?.isGM)) {
    ui.notifications.warn(game.i18n.localize("YZE.Travel.NotAllowed"));
    return null;
  }
  const gearId = await chooseTrapGear(actor);
  if (!gearId) return null;
  const skill = actor.items.find((item) => item.type === "skill"
    && item.name.localeCompare("Survival", undefined, { sensitivity: "base" }) === 0);
  if (!skill) {
    ui.notifications.warn(game.i18n.format("YZE.Environment.SkillMissing", { skill: "Survival" }));
    return null;
  }
  const pending = { ...hunting, pending: true, selectedIndex: preyIndex, gearId };
  await message.setFlag(SYSTEM_ID, HUNTING_FLAG, pending);
  const rollMessage = await actor.rollSkill(skill.id, {
    travel: {
      activity: "trap",
      followup: true,
      sourceMessageId: message.id,
      preyIndex,
      gearId,
      clock: hunting.clock
    }
  });
  if (!rollMessage) {
    await message.setFlag(SYSTEM_ID, HUNTING_FLAG, { ...hunting, pending: false });
    return null;
  }
  await message.setFlag(SYSTEM_ID, HUNTING_FLAG, { ...pending, trapRollMessageId: rollMessage.id });
  return rollMessage;
}

async function applyTrappingOutcome(actor, travel, successes) {
  const source = game.messages?.get(travel.sourceMessageId);
  const hunting = foundry.utils.deepClone(source?.getFlag(SYSTEM_ID, HUNTING_FLAG));
  const prey = hunting?.prey?.[travel.preyIndex];
  if (!source || !hunting?.pending || hunting.resolved || !prey?.trappable) return false;
  let amount = 0;
  if (successes > 0) {
    const yieldRoll = await new Roll(prey.foodFormula).evaluate();
    amount = wholeNumber(yieldRoll.total);
    await yieldRoll.toMessage({
      speaker: ChatMessage.getSpeaker({ actor }),
      flavor: `<div class="yze chat-card yze-food-card"><p>${escape(game.i18n.format("YZE.Travel.TrapSucceeded", {
        actor: actor.name, prey: preyName(prey), amount
      }))}</p></div>`
    });
    await addFood(actor, { type: "meat", state: "raw", amount });
  } else {
    await resultMessage(actor, "YZE.Travel.TrapFailed", { actor: actor.name, prey: preyName(prey) });
  }
  const resolved = { ...hunting, pending: false, resolved: true, successes, foodGained: amount };
  await source.setFlag(SYSTEM_ID, HUNTING_FLAG, resolved);
  await source.update({ content: renderTrackedPrey(resolved) });
  return true;
}

async function resultMessage(actor, key, data = {}) {
  return ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    content: `<div class="yze chat-card yze-travel-card"><p>${escape(game.i18n.format(key, data))}</p></div>`
  });
}

export async function rollDrivingMishap(vehicle) {
  const roll = await new Roll("2d6").evaluate();
  const result = wholeNumber(roll.total);
  const table = await getSRDRollTable("YZE Driving Mishaps");
  if (table) await table.draw({ displayChat: true, roll });
  const conditionKeys = {
    2: "Broken Axle", 4: "Busted Gearbox", 5: "Dirty Fuel", 6: "Bogged Down",
    8: "Roadblock", 9: "Engine Overheated", 10: "Blown Tire"
  };
  const updates = {};
  if (conditionKeys[result]) updates["system.travelCondition"] = conditionKeys[result];
  if ([2, 4, 5, 6, 10].includes(result)) updates["system.engineDisabled"] = true;
  if (result === 5) updates["system.fuel.value"] = 0;
  if (result === 12) {
    updates["system.hull.value"] = 0;
    updates["system.wrecked"] = true;
    updates["system.travelCondition"] = "Engine Blown";
  }
  if (Object.keys(updates).length > 0) await vehicle.update(updates);
  if (result === 3) {
    await drawNamedTable("YZE Sample Hunting");
    await applyDamage(vehicle, Math.max(1, Math.ceil(wholeNumber(vehicle.system.hull?.max) / 2)), {
      category: "physical"
    });
  }
  if (result === 11) {
    const speed = Math.max(Number(vehicle.system.travelSpeedRoad) || 0, Number(vehicle.system.travelSpeedOffRoad) || 0);
    await applyDamage(vehicle, Math.max(1, Math.ceil(speed)), { category: "physical" });
  }
  return result;
}

export async function applyTravelOutcome(message, state) {
  if (!state?.travel || state.superseded || message.getFlag(SYSTEM_ID, APPLIED_FLAG)) return false;
  if (message.author?.id !== game.user?.id && !game.user?.isGM) {
    ui.notifications.warn(game.i18n.localize("YZE.Travel.NotAllowed"));
    return false;
  }
  const actor = state.actorUuid ? await fromUuid(state.actorUuid) : null;
  if (!actor?.system || (actor.isOwner === false && !game.user?.isGM)) {
    ui.notifications.warn(game.i18n.localize("YZE.Travel.NotAllowed"));
    return false;
  }
  const successes = rollSuccesses(state);
  const travel = state.travel;
  const mapNavigation = travel.activity === "navigate" && travelMapState().configured;
  if ((["march", "forcedMarch", "drive", "ride"].includes(travel.activity) || mapNavigation)
    && !game.user?.isGM) {
    ui.notifications.warn(game.i18n.localize("YZE.Travel.GMApplyProgress"));
    return false;
  }
  const partyConflict = partyTravelTaskConflict(actor, travel, { currentMessage: message });
  if (partyConflict) {
    warnPartyTaskConflict(partyConflict);
    return false;
  }
  const movementActivity = ["march", "forcedMarch", "drive", "ride"].includes(travel.activity);
  const mapState = movementActivity ? travelMapState() : null;
  const mapShiftKey = travel.clock ? `${travel.clock.day}:${travel.clock.shift}` : "";
  const existingMapProgress = mapState?.route?.progress?.[mapShiftKey];
  if (mapState?.configured && mapShiftKey && existingMapProgress
    && existingMapProgress.requiresNavigation !== true
    && existingMapProgress.requiresAdditionalRoll !== true) {
    await recordTravelTask(actor, travel);
    await resultMessage(actor, "YZE.TravelMap.AlreadyMovedResult", {
      actor: actor.name,
      hexes: mapState.route.progress[mapShiftKey].moved
    });
    await message.setFlag(SYSTEM_ID, APPLIED_FLAG, true);
    const duplicateState = message.getFlag(SYSTEM_ID, "push");
    if (duplicateState) await message.setFlag(SYSTEM_ID, "push", {
      ...duplicateState, canPush: false, travel: { ...duplicateState.travel, applied: true }
    });
    return true;
  }
  if (travel.activity === "trap" && travel.followup === true) {
    if (!await applyTrappingOutcome(actor, travel, successes)) return false;
    await message.setFlag(SYSTEM_ID, APPLIED_FLAG, true);
    const trapState = message.getFlag(SYSTEM_ID, "push");
    if (trapState) await message.setFlag(SYSTEM_ID, "push", {
      ...trapState, canPush: false, travel: { ...trapState.travel, applied: true }
    });
    return true;
  }
  if (travel.activity === "campFireSave" && travel.followup === true) {
    if (successes < 1) await loseRandomCampGear(actor);
    else await resultMessage(actor, "YZE.Travel.CampGearSaved", { actor: actor.name });
    await message.setFlag(SYSTEM_ID, APPLIED_FLAG, true);
    const fireState = message.getFlag(SYSTEM_ID, "push");
    if (fireState) await message.setFlag(SYSTEM_ID, "push", {
      ...fireState, canPush: false, travel: { ...fireState.travel, applied: true }
    });
    return true;
  }
  if (travel.activity === "stalk" && travel.followup === true) {
    const source = game.messages.get(travel.sourceMessageId);
    const hunting = source?.getFlag(SYSTEM_ID, HUNTING_FLAG);
    if (!source || !hunting || hunting.resolved) return false;
    const resolved = successes > 0
      ? { ...hunting, pending: false, awaitingShot: wholeNumber(travel.preyIndex) }
      : { ...hunting, pending: false, resolved: true };
    await source.setFlag(SYSTEM_ID, HUNTING_FLAG, resolved);
    await source.update({ content: renderTrackedPrey(resolved) });
    if (successes < 1) await resultMessage(actor, "YZE.Travel.HuntStalkFailed", { actor: actor.name, prey: travel.preyName });
    await message.setFlag(SYSTEM_ID, APPLIED_FLAG, true);
    return true;
  }
  await recordTravelTask(actor, travel);
  if (travel.activity === "forageFood" && successes > 0) {
    const item = await addFood(actor, { type: "plants", state: "raw", amount: successes });
    await resultMessage(actor, "YZE.Travel.RawFoodGained", {
      actor: actor.name, amount: successes, food: item?.name ?? game.i18n.localize("YZE.Food.Types.plants")
    });
  } else if (travel.activity === "forageWater" && successes > 0) {
    const item = await addConsumableAmount(
      actor,
      travel.supplyItemId,
      successes,
      game.i18n.localize("YZE.Travel.Water")
    );
    await resultMessage(actor, "YZE.Travel.SuppliesGained", {
      actor: actor.name, amount: successes, supply: item?.name ?? game.i18n.localize("YZE.Travel.Water")
    });
  } else if (travel.activity === "fish" && successes > 0) {
    const item = await addFood(actor, { type: "fish", state: "raw", amount: successes });
    await resultMessage(actor, "YZE.Travel.RawFoodGained", {
      actor: actor.name, amount: successes, food: item?.name ?? game.i18n.localize("YZE.Food.Types.fish")
    });
  } else if (travel.activity === "hunt" && successes > 0) {
    await drawTrackedPrey(actor, successes, travel.clock);
  } else if (travel.activity === "cook") {
    await applyCookingOutcome(actor, travel.foodItemId, travel.foodAmount, successes);
  } else if (travel.activity === "camp" && successes === 0) {
    const mishap = await resolveCampMishap(travel.clock);
    await (globalThis.canvas?.scene ?? game.scenes?.current)?.setFlag(SYSTEM_ID, "travelCamp", {
      day: travel.clock.day, location: travel.location, sheltered: false,
      fire: travel.heatSource === true && mishap !== 3, guardUuid: travel.guardUuid || "", failed: true
    });
    const guard = travel.guardUuid ? await fromUuid(travel.guardUuid) : null;
    if (guard?.system) await recordTravelTask(guard, {
      activity: "keepWatch", location: travel.location,
      clock: { ...travel.clock, shift: "night" }
    });
  } else if (travel.activity === "camp") {
    await (globalThis.canvas?.scene ?? game.scenes?.current)?.setFlag(SYSTEM_ID, "travelCamp", {
      day: travel.clock.day, location: travel.location, sheltered: true,
      fire: travel.heatSource === true, guardUuid: travel.guardUuid || "", failed: false
    });
    const guard = travel.guardUuid ? await fromUuid(travel.guardUuid) : null;
    if (guard?.system) await recordTravelTask(guard, {
      activity: "keepWatch", location: travel.location,
      clock: { ...travel.clock, shift: "night" }
    });
    await resultMessage(actor, "YZE.Travel.CampEstablished", {
      actor: actor.name,
      fire: game.i18n.localize(travel.heatSource ? "YZE.Common.Yes" : "YZE.Common.No")
    });
  } else if (travel.activity === "keepWatch") {
    const detected = successes > 0;
    if (detected) {
      await ChatMessage.create({
        speaker: ChatMessage.getSpeaker({ actor }),
        content: `<div class="yze chat-card yze-travel-card"><p>${escape(game.i18n.format("YZE.Travel.EncounterDetected", {
          actor: actor.name,
          range: travel.encounterRange || game.i18n.localize("YZE.Common.None")
        }))}</p><div class="recovery-actions"><button type="button" data-action="travelEncounter" data-choice="approach">${escape(game.i18n.localize("YZE.Travel.ApproachEncounter"))}</button><button type="button" data-action="travelEncounter" data-choice="backOff">${escape(game.i18n.localize("YZE.Travel.BackOffEncounter"))}</button><button type="button" data-action="travelEncounter" data-choice="ambush">${escape(game.i18n.localize("YZE.Travel.AmbushEncounter"))}</button></div></div>`,
        flags: { [SYSTEM_ID]: { travelEncounter: { actorUuid: actor.uuid, resolved: false } } }
      });
    } else {
      await resultMessage(actor, "YZE.Travel.EncounterUndetected", {
        actor: actor.name,
        range: travel.encounterRange || game.i18n.localize("YZE.Common.None")
      });
    }
  } else if (travel.activity === "navigate" && successes > 0 && travelMapState().configured) {
    const approved = await approveTravelNavigation();
    await resultMessage(actor, "YZE.TravelMap.NavigationApproved", {
      actor: actor.name,
      hex: approved?.label ?? ""
    });
  } else if (travel.activity === "navigate" && successes === 0) {
    const direction = wholeNumber((await new Roll("1d6").evaluate()).total) % 2 === 0 ? "right" : "left";
    const wrongHex = await deviateTravelRoute(direction);
    await resultMessage(actor,
      wrongHex ? "YZE.TravelMap.NavigationFailedMapped" : "YZE.Travel.NavigationFailed",
      {
        direction: game.i18n.localize(`YZE.Travel.Directions.${direction}`),
        hex: wrongHex?.label ?? ""
      }
    );
  } else if (travel.activity === "drive") {
    const vehicle = await fromUuid(travel.vehicleUuid);
    if (vehicle?.type === "vehicle") {
      const mishap = successes === 0 ? await rollDrivingMishap(vehicle) : 0;
      let hexes = successes > 0 ? wholeNumber(travel.hexes) : Math.ceil(wholeNumber(travel.hexes) / 2);
      if (mishap === 7) hexes = Math.max(0, hexes - 1);
      const progress = await advanceJourney(hexes, travel, "drive");
      const fuel = wholeNumber(vehicle.system.fuel?.value);
      const plannedFuel = successes > 0
        ? wholeNumber(travel.fuelCost)
        : Math.ceil(wholeNumber(travel.fuelCost) / 2);
      const fuelSpent = progress.route.configured
        ? Math.ceil(progress.moved * (Number(travel.fuelPerHex) || 0) * (travel.offRoad ? 2 : 1))
        : plannedFuel;
      if (wholeNumber(vehicle.system.fuel?.max) > 0) {
        await vehicle.update({ "system.fuel.value": Math.max(0, fuel - fuelSpent) });
      }
      await resultMessage(vehicle, successes > 0 ? "YZE.Travel.VehicleProgress" : "YZE.Travel.VehicleMishapProgress", {
        vehicle: vehicle.name, hexes: progress.moved, planned: travel.hexes, fuel: fuelSpent, total: progress.total
      });
    }
  } else if (travel.activity === "ride") {
    const mount = await fromUuid(travel.mountUuid);
    if (mount?.type === "mount") {
      const currentDay = getTravelClock().day;
      const previous = foundry.utils.deepClone(mount.getFlag(SYSTEM_ID, "mountedTravel") ?? {});
      const mountedState = Number(previous.day) === currentDay
        ? previous
        : { day: currentDay, ridden: 0, rested: false, needsRest: false };
      mountedState.ridden = wholeNumber(mountedState.ridden) + 1;
      if (travel.requiresRoll && successes < 1) {
        mountedState.lamedOnDay = currentDay;
        await mount.update({ "system.lame": true });
      }
      mountedState.needsRest = mountedState.rested !== true;
      await mount.setFlag(SYSTEM_ID, "mountedTravel", mountedState);
      const hexes = successes > 0 ? wholeNumber(travel.hexes) : 0;
      const progress = await advanceJourney(hexes, travel, "ride");
      await resultMessage(mount,
        successes > 0 ? "YZE.Mount.TravelProgress" : "YZE.Mount.TravelLame",
        { mount: mount.name, rider: actor.name, hexes: progress.moved, total: progress.total }
      );
    }
  } else if (["march", "forcedMarch"].includes(travel.activity)) {
    const mappedRoute = travelMapState().configured && Boolean(travelMapState().route);
    const base = mappedRoute ? 2 : wholeNumber(TERRAIN[travel.terrain]?.march || 1);
    let hexes = base;
    if (successes === 0 && travel.heavy) hexes = Math.max(0, hexes - 1);
    if (successes === 0 && (travel.nightOffRoad || travel.activity === "forcedMarch")) hexes = 0;
    const progress = await advanceJourney(hexes, {
      ...travel,
      useTerrainCosts: mappedRoute
    }, travel.activity);
    await resultMessage(actor, "YZE.Travel.MarchProgress", {
      actor: actor.name, hexes: progress.moved, total: progress.total
    });
  } else if (travel.activity === "gatherFuel" && successes > 0) {
    const vehicle = travel.vehicleUuid ? await fromUuid(travel.vehicleUuid) : null;
    if (vehicle?.type === "vehicle") {
      const current = Number(vehicle.system.fuel?.value) || 0;
      const maximum = Number(vehicle.system.fuel?.max) || current + successes;
      await vehicle.update({ "system.fuel.value": Math.min(maximum, current + successes) });
      await resultMessage(actor, "YZE.Travel.FuelGathered", { actor: actor.name, vehicle: vehicle.name, amount: successes });
    }
  } else if (travel.activity === "rest") {
    await recoverShift(actor);
  } else if (travel.activity === "sleep") {
    const effects = actor.getFlag(SYSTEM_ID, "magicEffects");
    if (Array.isArray(effects) && effects.some((effect) => effect.kind === "sleepless")) {
      await resultMessage(actor, "YZE.Travel.SleepPrevented", { actor: actor.name });
    } else if (travel.bareGround === true && successes < 1) {
      await updateEnvironmentalHazards(actor, { sleepDeprivation: { active: true, due: false } });
      await resultMessage(actor, "YZE.Travel.BareGroundSleepFailed", { actor: actor.name });
      await rollColdExposure(actor, { name: game.i18n.localize("YZE.Travel.BareGround") });
    } else if (travel.sleepInjuryCheck === true && successes < 1) {
      await resultMessage(actor, "YZE.CriticalInjury.NightmareSleepFailed", {
        actor: actor.name,
        skill: travel.sleepSkill || "Insight",
        injuries: travel.sleepInjuries || game.i18n.localize("YZE.CriticalInjury.SleepOptions.insight")
      });
    } else {
      await clearEnvironmentalHazard(actor, "sleepDeprivation");
      if (Number(actor.system?.resources?.stress?.value) > 0) await relieveStress(actor);
      const camp = (globalThis.canvas?.scene ?? game.scenes?.current)?.getFlag(SYSTEM_ID, "travelCamp");
      if (camp && Number(camp.day) === Number(travel.clock.day) && camp.fire !== true
        && travel.clock.weather !== "fair") {
        await rollColdExposure(actor, { name: game.i18n.localize("YZE.Travel.ColdCamp") });
      }
      if (travel.bareGround === true) {
        await rollColdExposure(actor, { name: game.i18n.localize("YZE.Travel.BareGround") });
      }
      if (travel.sleepInjuryCheck === true) {
        await resultMessage(actor, "YZE.CriticalInjury.NightmareSleepSucceeded", {
          actor: actor.name,
          skill: travel.sleepSkill || "Insight"
        });
      }
    }
  } else {
    await resultMessage(actor, successes > 0 ? "YZE.Travel.ActivitySucceeded" : "YZE.Travel.ActivityFailed", {
      actor: actor.name, activity: activityLabel(travel.activity)
    });
  }
  await message.setFlag(SYSTEM_ID, APPLIED_FLAG, true);
  const current = message.getFlag(SYSTEM_ID, "push");
  if (current) await message.setFlag(SYSTEM_ID, "push", {
    ...current, canPush: false, travel: { ...current.travel, applied: true }
  });
  return true;
}

function actorSkillOptions(actor, preferred) {
  return actor.items.filter((item) => item.type === "skill")
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((skill) => `<option value="${escape(skill.id)}"${skill.name.localeCompare(
      preferred, undefined, { sensitivity: "base" }
    ) === 0 ? " selected" : ""}>${escape(skill.name)}</option>`).join("");
}

export async function performTravelActivity(actor) {
  if (!isTravelEnabled() || !actor || actor.type === "vehicle") return null;
  if (!actor.items.some((item) => item.type === "skill")) {
    ui.notifications.warn(game.i18n.localize("YZE.Travel.NoSkills"));
    return null;
  }
  const supplies = actor.items.filter((item) => item.type === "consumable")
    .map((item) => `<option value="${escape(item.id)}">${escape(item.name)}</option>`).join("");
  const gear = actor.items.filter((item) => item.type === "gear" && wholeNumber(item.system.quantity) > 0)
    .map((item) => `<option value="${escape(item.id)}">${escape(item.name)}</option>`).join("");
  const rawFoods = actor.items.filter((item) => isFoodItem(item)
    && item.system.foodState === "raw" && foodItemAmount(item) > 0)
    .map((item) => `<option value="${escape(item.id)}">${escape(item.name)} (${foodItemAmount(item)})</option>`).join("");
  const mapState = travelMapState();
  const mappedHex = mapState.configured ? mapState.next ?? mapState.current : null;
  const activityOptions = Object.keys(ACTIVITIES).map((key) => (
    `<option value="${key}">${escape(activityLabel(key))}</option>`
  )).join("");
  const allSkills = actorSkillOptions(actor, "Survival");
  const terrainOptions = Object.keys(TERRAIN).map((key) => `<option value="${key}"${mappedHex?.terrain === key ? " selected" : ""}>${escape(game.i18n.localize(`YZE.Travel.TerrainTypes.${key}`))}</option>`).join("");
  const vehicleOptions = game.actors.filter((entry) => entry.type === "vehicle")
    .map((entry) => `<option value="${escape(entry.uuid)}">${escape(entry.name)}</option>`).join("");
  const guardOptions = game.actors.filter((entry) => ["character", "npc"].includes(entry.type))
    .sort((left, right) => left.name.localeCompare(right.name))
    .map((entry) => `<option value="${escape(entry.uuid)}">${escape(entry.name)}</option>`).join("");
  const { DialogV2 } = foundry.applications.api;
  const selection = await DialogV2.wait({
    window: { title: game.i18n.localize("YZE.Travel.ActivityTitle") },
    content: `<div class="yze yze-travel-dialog">
      <div class="form-group"><label>${escape(game.i18n.localize("YZE.Travel.Activity"))}</label><select name="activity">${activityOptions}</select></div>
      <div class="form-group"><label>${escape(game.i18n.localize("YZE.Travel.Skill"))}</label><select name="skill">${allSkills}</select></div>
      <div class="form-group"><label>${escape(game.i18n.localize("YZE.Travel.SupplyItem"))}</label><select name="supply"><option value="">${escape(game.i18n.localize("YZE.Common.None"))}</option>${supplies}</select></div>
      <div class="form-group"><label>${escape(game.i18n.localize("YZE.Travel.FishingGear"))}</label><select name="fishingGear"><option value="">${escape(game.i18n.localize("YZE.Common.None"))}</option>${gear}</select></div>
      <div class="form-group"><label>${escape(game.i18n.localize("YZE.Travel.Terrain"))}</label><select name="terrain">${terrainOptions}</select></div>
      <div class="form-group"><label>${escape(game.i18n.localize("YZE.Travel.LocationKey"))}</label><input type="text" name="location" value="${escape(mappedHex?.key ?? "")}"></div>
      <div class="form-group"><label>${escape(game.i18n.localize("YZE.Travel.FuelVehicle"))}</label><select name="vehicle"><option value="">${escape(game.i18n.localize("YZE.Common.None"))}</option>${vehicleOptions}</select></div>
      <div class="form-group"><label>${escape(game.i18n.localize("YZE.Food.RawFood"))}</label><select name="foodItem"><option value="">${escape(game.i18n.localize("YZE.Common.None"))}</option>${rawFoods}</select></div>
      <div class="form-group"><label>${escape(game.i18n.localize("YZE.Food.CookAmount"))}</label><input type="number" name="foodAmount" value="1" min="1" max="12" step="1"></div>
      <label class="checkbox-row"><input type="checkbox" name="heatSource"> ${escape(game.i18n.localize("YZE.Food.HeatSource"))}</label>
      <div class="form-group"><label>${escape(game.i18n.localize("YZE.Travel.CampGuard"))}</label><select name="guard"><option value="">${escape(game.i18n.localize("YZE.Common.None"))}</option>${guardOptions}</select></div>
      <label class="checkbox-row"><input type="checkbox" name="partyVehicle"> ${escape(game.i18n.localize("YZE.Travel.PartyMotorized"))}</label>
      <label class="checkbox-row"><input type="checkbox" name="encounterVehicle"> ${escape(game.i18n.localize("YZE.Travel.EncounterMotorized"))}</label>
      <label class="checkbox-row"><input type="checkbox" name="offRoad"${mappedHex && mappedHex.terrain !== "road" ? " checked" : ""}> ${escape(game.i18n.localize("YZE.Travel.OffRoad"))}</label>
      <label class="checkbox-row"><input type="checkbox" name="bareGround"> ${escape(game.i18n.localize("YZE.Travel.BareGround"))}</label>
      <div class="form-group"><label>${escape(game.i18n.localize("YZE.Roll.OtherModifier"))}</label><input type="number" name="modifier" value="0"></div>
      <p class="hint">${escape(game.i18n.localize("YZE.Travel.ActivityHint"))}</p>
      ${mapState.configured ? `<p class="hint">${escape(game.i18n.format("YZE.TravelMap.ActivityContext", {
        current: mapState.current?.label ?? "—",
        next: mapState.next?.label ?? "—",
        terrain: mappedHex?.terrainLabel ?? "—",
        remaining: mapState.remaining
      }))}</p>` : ""}
      <p class="hint">${escape(game.i18n.localize("YZE.Travel.PartyTaskHint"))}</p>
    </div>`,
    buttons: [
      { action: "roll", label: game.i18n.localize("YZE.Roll.Roll"), icon: "fa-solid fa-route", default: true,
        callback: (event, button, dialog) => { const form = button.form ?? dialog.element.querySelector("form"); return {
          activity: form.elements.activity?.value,
          skillId: form.elements.skill?.value,
          supplyItemId: form.elements.supply?.value || null,
          fishingGearId: form.elements.fishingGear?.value || null,
          terrain: form.elements.terrain?.value,
          location: String(form.elements.location?.value ?? "").trim(),
          vehicleUuid: form.elements.vehicle?.value || null,
          foodItemId: form.elements.foodItem?.value || null,
          foodAmount: Math.max(1, Math.min(12, Math.trunc(Number(form.elements.foodAmount?.value) || 1))),
          heatSource: form.elements.heatSource?.checked === true,
          guardUuid: form.elements.guard?.value || null,
          partyVehicle: form.elements.partyVehicle?.checked === true,
          encounterVehicle: form.elements.encounterVehicle?.checked === true,
          offRoad: form.elements.offRoad?.checked === true,
          bareGround: form.elements.bareGround?.checked === true,
          modifier: Math.trunc(Number(form.elements.modifier?.value) || 0)
        }; } },
      { action: "cancel", label: game.i18n.localize("YZE.Common.Cancel"), callback: () => null }
    ], close: () => null, rejectClose: false, modal: true
  });
  if (!selection) return null;
  if (selection.activity === "fish" && !actor.items.get(selection.fishingGearId)) {
    ui.notifications.warn(game.i18n.localize("YZE.Travel.FishingGearRequired"));
    return null;
  }
  const clock = getTravelClock();
  if (selection.activity === "cook") {
    const rawFood = actor.items.get(selection.foodItemId);
    if (!isFoodItem(rawFood) || rawFood.system.foodState !== "raw" || foodItemAmount(rawFood) < 1) {
      ui.notifications.warn(game.i18n.localize("YZE.Food.RawFoodRequired"));
      return null;
    }
    const campAssignment = partyTravelTaskConflict(actor, { activity: "camp", clock });
    if (!selection.heatSource && !campAssignment) {
      ui.notifications.warn(game.i18n.localize("YZE.Food.HeatSourceRequired"));
      return null;
    }
    selection.foodAmount = Math.min(selection.foodAmount, foodItemAmount(rawFood), 12);
  }
  const restrictions = getCriticalInjuryRestrictions(actor);
  let sleepInjuryCheck = false;
  let sleepInjuries = "";
  let sleepSkill = "";
  if (["march", "forcedMarch"].includes(selection.activity)
    && restrictions.movement === "none") {
    ui.notifications.warn(game.i18n.format("YZE.CriticalInjury.MovementRestricted", {
      actor: actor.name,
      injuries: restrictions.movementSources.map((item) => item.name).join(", ")
    }));
    return null;
  }
  if (selection.activity === "sleep") {
    if (selection.bareGround) {
      const survival = actor.items.find((item) => item.type === "skill"
        && item.name.localeCompare("Survival", undefined, { sensitivity: "base" }) === 0);
      if (!survival) {
        ui.notifications.warn(game.i18n.format("YZE.CriticalInjury.SleepSkillMissing", { actor: actor.name, skill: "Survival" }));
        return null;
      }
      selection.skillId = survival.id;
    }
    if (restrictions.sleepDaylight.length > 0 && !["morning", "day"].includes(clock.shift)) {
      ui.notifications.warn(game.i18n.format("YZE.CriticalInjury.DaylightSleepRestricted", {
        actor: actor.name,
        injuries: restrictions.sleepDaylight.map((item) => item.name).join(", ")
      }));
      return null;
    }
    if (restrictions.sleepInsight.length > 0) {
      sleepSkill = criticalInjurySleepSkill(restrictions.sleepInsight[0]).trim();
      const sleepSkillItem = actor.items.find((item) => item.type === "skill"
        && item.name.localeCompare(sleepSkill, undefined, { sensitivity: "base" }) === 0);
      if (!sleepSkillItem) {
        ui.notifications.warn(game.i18n.format("YZE.CriticalInjury.SleepSkillMissing", {
          actor: actor.name,
          skill: sleepSkill
        }));
        return null;
      }
      selection.skillId = sleepSkillItem.id;
      sleepInjuryCheck = true;
      sleepInjuries = restrictions.sleepInsight.map((item) => item.name).join(", ");
    }
  }
  if (!canTakeTravelTask(actor, selection.activity)) {
    ui.notifications.warn(game.i18n.localize("YZE.Travel.TaskAlreadyChosen"));
    return null;
  }
  const partyConflict = partyTravelTaskConflict(actor, {
    activity: selection.activity,
    location: selection.location,
    clock
  });
  if (partyConflict) {
    warnPartyTaskConflict(partyConflict);
    return null;
  }
  const ledger = travelLedger(actor);
  const terrainData = TERRAIN[selection.terrain] ?? TERRAIN.open;
  let automaticModifier = 0;
  if (["forageFood", "forageWater"].includes(selection.activity)) automaticModifier += terrainData.foraging;
  if (selection.activity === "hunt") automaticModifier += terrainData.hunting;
  if (["forageFood", "forageWater", "hunt", "fish"].includes(selection.activity) && selection.location) {
    const history = ledger.histories?.[`${selection.activity}:${selection.location}`];
    const resetDays = selection.activity === "fish" ? 1 : 7;
    if (history && clock.day - wholeNumber(history.day) < resetDays) automaticModifier -= wholeNumber(history.count);
  }
  if (selection.activity === "forcedMarch" && wholeNumber(ledger.marches?.[clock.day]) >= 3) automaticModifier -= 2;
  if (selection.activity === "keepWatch") {
    if (selection.partyVehicle && !selection.encounterVehicle) automaticModifier -= 2;
    if (!selection.partyVehicle && selection.encounterVehicle) automaticModifier += 2;
  }
  const nightOffRoad = selection.offRoad && ["evening", "night"].includes(clock.shift);
  const heavy = clock.weather === "heavy";
  return actor.rollSkill(selection.skillId, {
    canPush: selection.activity === "keepWatch" ? false : null,
    rollType: selection.activity === "keepWatch" ? "passive" : null,
    rollMode: selection.activity === "keepWatch" ? "blindroll" : "publicroll",
    forceRollMode: selection.activity === "keepWatch",
    allowHelpers: selection.activity !== "keepWatch",
    fixedModifiers: [[activityLabel(selection.activity), selection.modifier + automaticModifier]],
    travel: {
      activity: selection.activity,
      supplyItemId: selection.supplyItemId,
      vehicleUuid: selection.vehicleUuid,
      terrain: selection.terrain,
      location: selection.location,
      heavy,
      nightOffRoad,
      sleepInjuryCheck,
      sleepInjuries,
      sleepSkill,
      bareGround: selection.bareGround,
      foodItemId: selection.foodItemId,
      foodAmount: selection.foodAmount,
      heatSource: selection.heatSource,
      guardUuid: selection.guardUuid,
      partyVehicle: selection.partyVehicle,
      encounterVehicle: selection.encounterVehicle,
      encounterRange: ENCOUNTER_RANGES[selection.terrain] ?? "Long",
      clock
    }
  });
}

export async function performVehicleTravel(vehicle) {
  if (!isTravelEnabled() || vehicle?.type !== "vehicle") return null;
  if (vehicle.system.wrecked || vehicle.system.engineDisabled || vehicle.system.destroyed) {
    ui.notifications.warn(game.i18n.localize("YZE.Vehicle.Inoperable"));
    return null;
  }
  if (vehicle.system.engineRunning === false) {
    ui.notifications.warn(game.i18n.localize("YZE.Vehicle.EngineNotRunning"));
    return null;
  }
  const { driver, skill } = await vehicleDriverSkill(vehicle);
  if (!driver || !skill) {
    ui.notifications.warn(game.i18n.localize("YZE.Vehicle.DriverOrSkillMissing"));
    return null;
  }
  const terrain = {
    road: { driving: 3, factor: 1 }, open: { driving: 1, factor: 1 }, woods: { driving: -1, factor: 0.5 },
    hills: { driving: 0, factor: 0.5 }, mountains: { driving: -1, factor: 1 / 3 }, water: { driving: 2, factor: 1 },
    swamp: { driving: -1, factor: 0.25 }, ruins: { driving: 0, factor: 0.5 }
  };
  const mapState = travelMapState();
  const mappedRoute = mapState.configured && Boolean(mapState.route);
  const mappedHex = mapState.configured ? mapState.next ?? mapState.current : null;
  const mappedRoad = mappedHex?.terrain === "road" || mappedHex?.road === true;
  const { DialogV2 } = foundry.applications.api;
  const selection = await DialogV2.wait({
    window: { title: game.i18n.localize("YZE.Travel.VehicleShiftTitle") },
    content: `<div class="yze yze-travel-dialog">
      <div class="form-group"><label>${escape(game.i18n.localize("YZE.Travel.Route"))}</label><select name="route"><option value="road"${mappedRoad ? " selected" : ""}>${escape(game.i18n.localize("YZE.Travel.OnRoad"))}</option><option value="offRoad"${mappedHex && !mappedRoad ? " selected" : ""}>${escape(game.i18n.localize("YZE.Travel.OffRoad"))}</option></select></div>
      <div class="form-group"><label>${escape(game.i18n.localize("YZE.Travel.Terrain"))}</label><select name="terrain">${Object.keys(terrain).map((key) => `<option value="${key}"${mappedHex?.terrain === key ? " selected" : ""}>${escape(game.i18n.localize(`YZE.Travel.TerrainTypes.${key}`))}</option>`).join("")}</select></div>
      <label class="checkbox-row"><input type="checkbox" name="night"> ${escape(game.i18n.localize("YZE.Travel.DrivingAtNight"))}</label>
      <label class="checkbox-row"><input type="checkbox" name="heavy"${getTravelClock().weather === "heavy" ? " checked" : ""}> ${escape(game.i18n.localize("YZE.Travel.HeavyWeather"))}</label>
      ${mapState.configured ? `<p class="hint">${escape(game.i18n.format("YZE.TravelMap.VehicleContext", {
        next: mapState.next?.label ?? "—", terrain: mappedHex?.terrainLabel ?? "—", remaining: mapState.remaining
      }))}</p>` : ""}
    </div>`,
    buttons: [
      { action: "roll", label: game.i18n.localize("YZE.Roll.Roll"), icon: "fa-solid fa-car", default: true,
        callback: (event, button, dialog) => { const form = button.form ?? dialog.element.querySelector("form"); return {
          route: form.elements.route?.value,
          terrain: form.elements.terrain?.value,
          night: form.elements.night?.checked === true,
          heavy: form.elements.heavy?.checked === true
        }; } },
      { action: "cancel", label: game.i18n.localize("YZE.Common.Cancel"), callback: () => null }
    ], close: () => null, rejectClose: false, modal: true
  });
  if (!selection) return null;
  const offRoad = selection.route === "offRoad";
  const terrainKey = offRoad ? selection.terrain : "road";
  if (terrainKey === "water" && vehicle.system.isWatercraft !== true
    && vehicle.system.isAerial !== true) {
    ui.notifications.warn(game.i18n.localize("YZE.Vehicle.WaterTravelRequiresWatercraft"));
    return null;
  }
  const terrainData = terrain[terrainKey] ?? terrain.open;
  let speed = Number(offRoad ? vehicle.system.travelSpeedOffRoad : vehicle.system.travelSpeedRoad) || 0;
  // A mapped route spends fractional movement against each hex's terrain cost,
  // so applying the factor here as well would count difficult terrain twice.
  if (offRoad && !mappedRoute) speed *= terrainData.factor;
  if (offRoad && selection.night) speed /= 2;
  const hexes = Math.max(0, Math.ceil(speed));
  const fuelRate = Number(vehicle.system.fuelPerHex) || 0;
  const fuelCost = Math.ceil(hexes * fuelRate * (offRoad ? 2 : 1));
  const availableFuel = wholeNumber(vehicle.system.fuel?.value);
  const perHexFuel = fuelRate * (offRoad ? 2 : 1);
  const maximumHexes = perHexFuel > 0 ? Math.floor(availableFuel / perHexFuel) : Number.POSITIVE_INFINITY;
  if (wholeNumber(vehicle.system.fuel?.max) > 0 && mappedRoute && maximumHexes < 1) {
    ui.notifications.warn(game.i18n.localize("YZE.Travel.NotEnoughFuel"));
    return null;
  }
  if (wholeNumber(vehicle.system.fuel?.max) > 0 && !mappedRoute && fuelCost > availableFuel) {
    ui.notifications.warn(game.i18n.localize("YZE.Travel.NotEnoughFuel"));
    return null;
  }
  const modifier = vehicleDrivingModifier(vehicle) + terrainData.driving + (selection.heavy ? -2 : 0);
  return driver.rollSkill(skill.id, {
    fixedModifiers: [[game.i18n.format("YZE.Travel.VehicleTravelModifier", { vehicle: vehicle.name }), modifier]],
    travel: {
      activity: "drive", vehicleUuid: vehicle.uuid, hexes, fuelCost, fuelPerHex: fuelRate,
      ...(Number.isFinite(maximumHexes) ? { maximumHexes } : {}),
      offRoad, useTerrainCosts: Boolean(mappedRoute),
      terrain: terrainKey, clock: getTravelClock()
    }
  });
}

export async function performMountedTravel(mount) {
  if (!isTravelEnabled() || mount?.type !== "mount") return null;
  if (mount.system.perished || mount.system.lame) {
    ui.notifications.warn(game.i18n.localize("YZE.Mount.Unavailable"));
    return null;
  }
  const rider = await resolveMountRider(mount);
  if (!rider) {
    ui.notifications.warn(game.i18n.localize("YZE.Mount.RiderMissing"));
    return null;
  }
  const clock = getTravelClock();
  const previous = foundry.utils.deepClone(mount.getFlag(SYSTEM_ID, "mountedTravel") ?? {});
  if (Number(previous.day) !== clock.day && previous.needsRest === true && previous.rested !== true) {
    ui.notifications.warn(game.i18n.format("YZE.Mount.MustRest", { mount: mount.name }));
    return null;
  }
  const ridden = Number(previous.day) === clock.day ? wholeNumber(previous.ridden) : 0;
  const requiresRoll = ridden >= 2;
  const travel = {
    activity: "ride",
    mountUuid: mount.uuid,
    hexes: Math.max(0, Number(mount.system.travelSpeed) || 0),
    requiresRoll,
    clock
  };
  if (requiresRoll) return mountMobilityRoll(mount, { travel, purpose: "forcedRide" });

  const state = {
    version: 1,
    mode: "pool",
    actorUuid: rider.uuid,
    actorName: rider.name,
    canPush: false,
    automaticSuccesses: 1,
    dice: [],
    travel
  };
  return ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor: rider }),
    content: `<div class="yze chat-card yze-travel-card"><h3>${escape(game.i18n.format("YZE.Mount.RideShiftTitle", { rider: rider.name, mount: mount.name }))}</h3>${renderTravelControl(state)}</div>`,
    flags: { [SYSTEM_ID]: { push: state } }
  });
}

export function registerTravelHooks() {
  Hooks.on("renderChatMessageHTML", (message, html) => {
    const root = html?.querySelector ? html : html?.[0];
    for (const encounterButton of root?.querySelectorAll?.('[data-action="travelEncounter"]') ?? []) {
      const encounter = message.getFlag(SYSTEM_ID, "travelEncounter");
      if (!game.user?.isGM || encounter?.resolved === true) {
        encounterButton.disabled = true;
        continue;
      }
      encounterButton.addEventListener("click", async () => {
        encounterButton.disabled = true;
        const actor = encounter.actorUuid ? await fromUuid(encounter.actorUuid) : null;
        const choice = encounterButton.dataset.choice;
        if (choice === "backOff") {
          const detour = await addTravelDetour();
          await resultMessage(actor, "YZE.Travel.BackedOffEncounter", {
            cost: detour?.cost ?? 1,
            terrain: detour ? game.i18n.localize(`YZE.Travel.TerrainTypes.${detour.terrain}`) : "—"
          });
        } else if (choice === "ambush") {
          if (!await promptAmbush(actor)) {
            encounterButton.disabled = false;
            return;
          }
        } else {
          await resultMessage(actor, "YZE.Travel.ApproachedEncounter", { actor: actor?.name ?? "" });
        }
        await message.setFlag(SYSTEM_ID, "travelEncounter", { ...encounter, resolved: true, choice });
        for (const button of root.querySelectorAll('[data-action="travelEncounter"]')) button.disabled = true;
      });
    }
    for (const huntButton of root?.querySelectorAll?.('[data-action="huntPrey"]') ?? []) {
      huntButton.addEventListener("click", async () => {
        huntButton.disabled = true;
        if (!await startHuntingStalk(message, wholeNumber(huntButton.dataset.preyIndex))) huntButton.disabled = false;
      });
    }
    for (const shotButton of root?.querySelectorAll?.('[data-action="resolveHuntingShot"]') ?? []) {
      shotButton.addEventListener("click", async () => {
        shotButton.disabled = true;
        if (!await resolveHuntingShot(message, wholeNumber(shotButton.dataset.preyIndex))) shotButton.disabled = false;
      });
    }
    for (const trapButton of root?.querySelectorAll?.('[data-action="trapPrey"]') ?? []) {
      const hunting = message.getFlag(SYSTEM_ID, HUNTING_FLAG);
      if (!hunting || hunting.resolved || hunting.pending
        || (message.author?.id !== game.user?.id && !game.user?.isGM)) {
        trapButton.disabled = true;
        continue;
      }
      trapButton.addEventListener("click", async () => {
        trapButton.disabled = true;
        try {
          const result = await startTrapping(message, wholeNumber(trapButton.dataset.preyIndex));
          if (!result) trapButton.disabled = false;
        } catch (error) {
          console.error("YZE System Toolkit | Trapping roll failed", error);
          ui.notifications.error(game.i18n.localize("YZE.Travel.OutcomeFailed"));
          trapButton.disabled = false;
        }
      });
    }
    const button = root?.querySelector?.('[data-action="applyTravelOutcome"]');
    if (!button) return;
    const state = message.getFlag(SYSTEM_ID, "push");
    if (!state?.travel || state.superseded || message.getFlag(SYSTEM_ID, APPLIED_FLAG)) {
      button.disabled = true;
      return;
    }
    if (message.author?.id !== game.user?.id && !game.user?.isGM) {
      button.disabled = true;
      return;
    }
    const mapNavigation = state.travel.activity === "navigate" && travelMapState().configured;
    if ((["march", "forcedMarch", "drive", "ride"].includes(state.travel.activity) || mapNavigation)
      && !game.user?.isGM) {
      button.disabled = true;
      button.title = game.i18n.localize("YZE.Travel.GMApplyProgress");
      return;
    }
    button.addEventListener("click", async () => {
      button.disabled = true;
      try {
        const applied = await applyTravelOutcome(message, message.getFlag(SYSTEM_ID, "push"));
        if (!applied) button.disabled = false;
      } catch (error) {
        console.error("YZE System Toolkit | Travel outcome failed", error);
        ui.notifications.error(game.i18n.localize("YZE.Travel.OutcomeFailed"));
        button.disabled = false;
      }
    });
  });
  Hooks.on("updateSetting", (setting) => {
    if (!["travelDay", "travelShift", "travelWeather"].some((key) => setting?.key === `${SYSTEM_ID}.${key}`)) return;
    for (const actor of game.actors ?? []) {
      const sheet = actor.sheet;
      if (sheet?.rendered) sheet.render({ force: false });
    }
  });
}
