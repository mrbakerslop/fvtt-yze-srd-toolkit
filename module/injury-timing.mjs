import { SYSTEM_ID } from "./constants.mjs";
import { effectiveHealingMultiplier } from "./specialties.mjs";

export const INJURY_TIME_SECONDS = Object.freeze({
  round: 6,
  stretch: 600,
  shift: 21600,
  day: 86400
});

const RECOVERY_DUE_FLAG = "injuryRecoveryDue";

function escape(value) {
  return foundry.utils.escapeHTML(String(value));
}

function worldTime() {
  return Math.max(0, Number(game.time?.worldTime) || 0);
}

function primaryActiveGM() {
  return game.users?.filter((user) => user.active && user.isGM)
    .sort((left, right) => Number(right.role) - Number(left.role) || left.id.localeCompare(right.id))[0] ?? null;
}

function isPrimaryActiveGM() {
  return primaryActiveGM()?.id === game.user?.id;
}

export function normalizeInjuryInterval(value) {
  const key = String(value ?? "").trim().toLowerCase();
  return Object.hasOwn(INJURY_TIME_SECONDS, key) ? key : "";
}

export function parseHealingTime(value) {
  const text = String(value ?? "").trim();
  if (!text || /^(?:—|-|none)$/i.test(text)) return { kind: "none", formula: "", text };
  if (/^permanent$/i.test(text)) return { kind: "permanent", formula: "", text };
  const match = text.replaceAll(" ", "").match(/^(\d*)D6$/i);
  if (!match) return { kind: "manual", formula: "", text };
  const dice = Math.max(1, Math.trunc(Number(match[1]) || 1));
  return { kind: "timed", formula: `${dice}d6`, text };
}

function actorCombatant(actor, combat = game.combat) {
  return combat?.combatants?.find((combatant) => combatant.actor?.uuid === actor?.uuid) ?? null;
}

function nextRoundForActor(actor) {
  const combat = game.combat;
  const combatant = actorCombatant(actor, combat);
  if (!combat || !combatant || !Number.isFinite(Number(combat.round))) return 0;
  const actorTurn = combat.turns.findIndex((entry) => entry.id === combatant.id);
  const currentTurn = Math.max(-1, Number(combat.turn) || 0);
  return Math.max(1, Number(combat.round) + (actorTurn > currentTurn ? 0 : 1));
}

function deathSchedule(actor, timeLimit, fromTime = worldTime()) {
  const interval = normalizeInjuryInterval(timeLimit);
  if (!interval) return { nextDeathSaveAt: 0, nextDeathSaveRound: 0 };
  if (interval === "round") {
    const round = nextRoundForActor(actor);
    return round > 0
      ? { nextDeathSaveAt: 0, nextDeathSaveRound: round }
      : { nextDeathSaveAt: fromTime + INJURY_TIME_SECONDS.round, nextDeathSaveRound: 0 };
  }
  return {
    nextDeathSaveAt: fromTime + INJURY_TIME_SECONDS[interval],
    nextDeathSaveRound: 0
  };
}

export async function initializeInjuryTiming(injury, { force = false } = {}) {
  const actor = injury?.parent;
  if (!injury || injury.type !== "criticalInjury" || actor?.documentName !== "Actor") return null;
  if (injury.system.recovery?.initialized === true && !force) return injury.system.recovery;

  const healing = parseHealingTime(injury.system.healingTime);
  let totalDays = 0;
  if (healing.kind === "timed") {
    const roll = await new Roll(healing.formula).evaluate();
    totalDays = Math.max(1, Math.trunc(Number(roll.total) || 1));
    totalDays = Math.max(1, Math.ceil(totalDays * effectiveHealingMultiplier(actor)));
  }
  const schedule = injury.system.lethal === true && injury.system.stabilized !== true
    && injury.system.instantDeath !== true
    ? deathSchedule(actor, injury.system.timeLimit)
    : { nextDeathSaveAt: 0, nextDeathSaveRound: 0 };
  const recovery = {
    initialized: true,
    totalDays,
    remainingDays: totalDays,
    lastProcessedAt: worldTime(),
    careCredits: 0,
    lastCareDay: -1,
    deathSaveDue: false,
    ...schedule,
    treatmentLocked: false
  };
  await injury.update({ "system.recovery": recovery });
  if (injury.system.instantDeath === true && actor.system?.dead !== true) {
    await actor.update({ "system.dead": true });
  }
  return recovery;
}

async function announceDeathSaveDue(actor, injury) {
  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    content: `<div class="yze chat-card yze-death-save-due" data-actor-uuid="${escape(actor.uuid)}" data-injury-id="${escape(injury.id)}">
      <h3>${escape(game.i18n.localize("YZE.InjuryTiming.DeathSaveDue"))}</h3>
      <p>${escape(game.i18n.format("YZE.InjuryTiming.DeathSaveDueHint", {
        actor: actor.name,
        injury: injury.name,
        interval: injury.system.timeLimit
      }))}</p>
      <button type="button" data-action="timedDeathSave"><i class="fa-solid fa-heart-pulse"></i> ${escape(game.i18n.localize("YZE.Actor.DeathSave"))}</button>
    </div>`,
    flags: { [SYSTEM_ID]: { [RECOVERY_DUE_FLAG]: { actorUuid: actor.uuid, injuryId: injury.id } } }
  });
}

async function markDeathSaveDue(injury) {
  if (injury.system.recovery?.deathSaveDue === true || injury.system.stabilized === true
    || injury.system.active !== true || injury.parent?.system?.dead === true) return false;
  await injury.update({
    "system.recovery.deathSaveDue": true,
    "system.recovery.nextDeathSaveAt": 0,
    "system.recovery.nextDeathSaveRound": 0
  });
  await announceDeathSaveDue(injury.parent, injury);
  return true;
}

export async function completeTimedDeathSave(injury, succeeded) {
  const actor = injury?.parent;
  if (!injury || injury.type !== "criticalInjury" || !actor) return false;
  if (!succeeded) {
    await injury.update({
      "system.recovery.deathSaveDue": false,
      "system.recovery.nextDeathSaveAt": 0,
      "system.recovery.nextDeathSaveRound": 0
    });
    return true;
  }
  const schedule = deathSchedule(actor, injury.system.timeLimit);
  await injury.update({
    "system.recovery.deathSaveDue": false,
    "system.recovery.treatmentLocked": false,
    "system.recovery.nextDeathSaveAt": schedule.nextDeathSaveAt,
    "system.recovery.nextDeathSaveRound": schedule.nextDeathSaveRound
  });
  return true;
}

export async function lockFailedTreatment(injury) {
  if (!injury || injury.type !== "criticalInjury") return false;
  await injury.update({ "system.recovery.treatmentLocked": true });
  return true;
}

export async function advanceLethalTreatment(injury) {
  if (!injury || injury.type !== "criticalInjury" || injury.system.lethal !== true
    || injury.system.stabilized === true || injury.system.instantDeath === true) return false;
  if (injury.system.recovery?.treatmentLocked === true) {
    ui.notifications.warn(game.i18n.localize("YZE.InjuryTiming.TreatmentLocked"));
    return false;
  }
  const current = normalizeInjuryInterval(injury.system.timeLimit);
  const next = current === "round" ? "Stretch" : current === "stretch" ? "Shift" : "";
  if (!next) {
    await injury.update({
      "system.stabilized": true,
      "system.recovery.deathSaveDue": false,
      "system.recovery.nextDeathSaveAt": 0,
      "system.recovery.nextDeathSaveRound": 0,
      "system.recovery.treatmentLocked": false
    });
    return { stabilized: true, timeLimit: injury.system.timeLimit };
  }
  const schedule = deathSchedule(injury.parent, next);
  await injury.update({
    "system.timeLimit": next,
    "system.recovery.deathSaveDue": false,
    "system.recovery.nextDeathSaveAt": schedule.nextDeathSaveAt,
    "system.recovery.nextDeathSaveRound": schedule.nextDeathSaveRound,
    "system.recovery.treatmentLocked": false
  });
  return { stabilized: false, timeLimit: next };
}

export function injuryRecoveryState(injury) {
  const recovery = injury?.system?.recovery ?? {};
  const healing = parseHealingTime(injury?.system?.healingTime);
  return {
    initialized: recovery.initialized === true,
    timed: healing.kind === "timed",
    permanent: injury?.system?.permanent === true || healing.kind === "permanent",
    totalDays: Math.max(0, Math.trunc(Number(recovery.totalDays) || 0)),
    remainingDays: Math.max(0, Math.trunc(Number(recovery.remainingDays) || 0)),
    deathSaveDue: recovery.deathSaveDue === true,
    treatmentLocked: recovery.treatmentLocked === true
  };
}

export async function addDailyCare(injury) {
  const state = injuryRecoveryState(injury);
  if (!state.timed || state.remainingDays < 1 || injury.system.active !== true) return false;
  const day = Math.floor(worldTime() / INJURY_TIME_SECONDS.day);
  if (Number(injury.system.recovery?.lastCareDay) === day) {
    ui.notifications.warn(game.i18n.localize("YZE.InjuryTiming.CareAlreadyApplied"));
    return false;
  }
  await injury.update({
    "system.recovery.careCredits": Math.max(0, Number(injury.system.recovery?.careCredits) || 0) + 1,
    "system.recovery.lastCareDay": day
  });
  return true;
}

export async function processTimedInjuries(now = worldTime()) {
  if (!isPrimaryActiveGM()) return { healed: 0, due: 0 };
  let healed = 0;
  let due = 0;
  for (const actor of game.actors ?? []) {
    for (const injury of actor.items.filter((item) => item.type === "criticalInjury")) {
      if (injury.system.recovery?.initialized !== true) await initializeInjuryTiming(injury);
      if (injury.system.active !== true) continue;
      const recovery = injury.system.recovery;
      if (injury.system.lethal === true && injury.system.stabilized !== true
        && injury.system.instantDeath !== true && recovery.deathSaveDue !== true
        && Number(recovery.nextDeathSaveAt) > 0 && now >= Number(recovery.nextDeathSaveAt)) {
        if (await markDeathSaveDue(injury)) due += 1;
      }
      const state = injuryRecoveryState(injury);
      if (!state.timed || state.remainingDays < 1) continue;
      const lastValue = Number(recovery.lastProcessedAt);
      const last = Number.isFinite(lastValue) ? Math.max(0, lastValue) : now;
      const elapsedDays = Math.floor((now - last) / INJURY_TIME_SECONDS.day);
      if (elapsedDays < 1) continue;
      const credits = Math.min(elapsedDays, Math.max(0, Math.trunc(Number(recovery.careCredits) || 0)));
      const remaining = Math.max(0, state.remainingDays - elapsedDays - credits);
      const update = {
        "system.recovery.remainingDays": remaining,
        "system.recovery.lastProcessedAt": last + elapsedDays * INJURY_TIME_SECONDS.day,
        "system.recovery.careCredits": Math.max(0, Number(recovery.careCredits) - credits)
      };
      if (remaining === 0) update["system.active"] = false;
      await injury.update(update);
      if (remaining === 0) {
        healed += 1;
        await ChatMessage.create({
          speaker: ChatMessage.getSpeaker({ actor }),
          content: `<div class="yze chat-card"><p>${escape(game.i18n.format("YZE.InjuryTiming.Healed", {
            actor: actor.name, injury: injury.name
          }))}</p></div>`
        });
      }
    }
  }
  return { healed, due };
}

async function processRoundDeathSaves(combat) {
  if (!isPrimaryActiveGM()) return;
  const combatant = combat?.combatant;
  const actor = combatant?.actor;
  if (!actor) return;
  const round = Math.max(0, Number(combat.round) || 0);
  for (const injury of actor.items.filter((item) => item.type === "criticalInjury"
    && item.system.active === true && item.system.lethal === true
    && item.system.stabilized !== true && item.system.recovery?.deathSaveDue !== true)) {
    if (Number(injury.system.recovery?.nextDeathSaveRound) > 0
      && round >= Number(injury.system.recovery.nextDeathSaveRound)) {
      await markDeathSaveDue(injury);
    }
  }
}

export function registerInjuryTimingHooks() {
  Hooks.on("createItem", async (item) => {
    if (item.type !== "criticalInjury" || item.parent?.documentName !== "Actor") return;
    initializeInjuryTiming(item).catch((error) => {
      console.error("YZE System Toolkit | Could not initialize Critical Injury timing", error);
    });
    if ((item.system.specialRule === "rupturedIntestines" || item.name === "Ruptured Intestines")
      && isPrimaryActiveGM() && item.getFlag(SYSTEM_ID, "rupturedExposureStarted") !== true) {
      try {
        await item.setFlag(SYSTEM_ID, "rupturedExposureStarted", true);
        const { rollSicknessExposure } = await import("./environmental-hazards.mjs");
        await rollSicknessExposure(item.parent, { poolRating: 6, stepRating: 2, name: item.name });
      } catch (error) {
        console.error("YZE System Toolkit | Could not apply injury disease", error);
      }
    }
  });
  Hooks.once("ready", () => {
    if (!isPrimaryActiveGM()) return;
    processTimedInjuries().catch((error) => {
      console.error("YZE System Toolkit | Could not process Critical Injury time", error);
    });
  });
  Hooks.on("updateWorldTime", (time) => {
    processTimedInjuries(Number(time)).catch((error) => {
      console.error("YZE System Toolkit | Could not advance Critical Injury time", error);
    });
  });
  Hooks.on("updateCombat", (combat, changed) => {
    if (!Object.hasOwn(changed, "turn") && !Object.hasOwn(changed, "round")) return;
    processRoundDeathSaves(combat).catch((error) => {
      console.error("YZE System Toolkit | Could not process round-based death saves", error);
    });
  });
  Hooks.on("renderChatMessageHTML", (message, html) => {
    const root = html?.querySelector ? html : html?.[0];
    const button = root?.querySelector?.('[data-action="timedDeathSave"]');
    if (!button) return;
    button.addEventListener("click", async () => {
      const state = message.getFlag(SYSTEM_ID, RECOVERY_DUE_FLAG);
      const actor = state?.actorUuid ? await fromUuid(state.actorUuid) : null;
      const injury = actor?.items?.get(state?.injuryId);
      if (!injury || (!game.user?.isGM && actor.isOwner === false)) return;
      button.disabled = true;
      await actor.rollDeathSave(injury.id);
    });
  });
}
