import { SYSTEM_ID } from "./constants.mjs";
import { isVehicleSubsystemEnabled } from "./settings.mjs";
import { rollVehicleManeuver, vehicleDriverSkill, vehicleDrivingModifier } from "./vehicles.mjs";
import { mountMobilityRoll, resolveMountRider } from "./mounts.mjs";
import { applyDamage } from "./harm.mjs";
import { countStateSuccesses } from "./dice/successes.mjs";
import { linkOpposedRolls } from "./dice/opposed.mjs";
import { getCriticalInjuryRestrictions, notifyCriticalInjuryRestriction } from "./critical-injuries.mjs";
import { attackWithWeapon } from "./combat.mjs";
import { promptSneakAttack } from "./surprise.mjs";

const RANGE_ORDER = Object.freeze(["engaged", "short", "medium", "long", "extreme"]);
const MANEUVERS = Object.freeze(["pursueFlee", "hide", "block", "cutOff", "standShoot", "other"]);
const CHASE_SETTING = "chaseState";
const CHASE_APPLIED_FLAG = "chaseApplied";
const CHASE_SOCKET = `system.${SYSTEM_ID}`;

function escape(value) { return foundry.utils.escapeHTML(String(value)); }
function whole(value) { return Math.max(0, Math.trunc(Number(value) || 0)); }
function rollSuccesses(state) { return countStateSuccesses(state); }
function rangeAt(distance) { return RANGE_ORDER[Math.clamp(whole(distance), 0, RANGE_ORDER.length - 1)]; }
function userCanControl(actor) { return game.user?.isGM || actor?.isOwner !== false; }

function participantFromActor(actor, side, position) {
  return {
    uuid: actor.uuid,
    name: actor.name,
    type: actor.type,
    side,
    position,
    committed: false,
    commitmentMessageId: "",
    commitment: null,
    resolved: false,
    escaped: false
  };
}

function normalizeState(raw) {
  if (!raw?.active) return { active: false };
  if (Array.isArray(raw.participants)) return {
    version: 2,
    mode: raw.mode === "grouped" ? "grouped" : "individual",
    phase: ["commit", "reveal", "resolve"].includes(raw.phase) ? raw.phase : "commit",
    obstacle: raw.obstacle ?? null,
    ...foundry.utils.deepClone(raw)
  };
  const distance = Math.max(0, RANGE_ORDER.indexOf(raw.range));
  return {
    active: true,
    version: 2,
    id: `legacy-${whole(raw.round) || 1}-${raw.preyUuid || "prey"}-${raw.pursuerUuid || "pursuer"}`,
    round: whole(raw.round) || 1,
    mode: "individual",
    phase: "commit",
    obstacle: null,
    participants: [
      { uuid: raw.preyUuid, name: raw.preyName, type: game.actors?.get(String(raw.preyUuid || "").split(".").pop())?.type ?? "character", side: "prey", position: distance },
      { uuid: raw.pursuerUuid, name: raw.pursuerName, type: game.actors?.get(String(raw.pursuerUuid || "").split(".").pop())?.type ?? "character", side: "pursuer", position: 0 }
    ].filter((entry) => entry.uuid).map((entry) => ({
      ...entry, committed: false, commitmentMessageId: "", commitment: null, resolved: false, escaped: false
    }))
  };
}

export function getChaseState() {
  return normalizeState(game.settings.get(SYSTEM_ID, CHASE_SETTING));
}

function opponentsOf(state, participant) {
  return state.participants.filter((entry) => (
    !entry.escaped && entry.uuid !== participant.uuid && entry.side !== participant.side
  ));
}

function nearestOpponent(state, participant) {
  return opponentsOf(state, participant).sort((left, right) => (
    Math.abs(left.position - participant.position) - Math.abs(right.position - participant.position)
  ))[0] ?? null;
}

function relativeRole(participant, target) {
  if (!target) return participant.side || "prey";
  if (participant.position === target.position) return participant.side || "prey";
  return participant.position > target.position ? "prey" : "pursuer";
}

function trackerSummary(state) {
  const active = state.participants.filter((entry) => !entry.escaped);
  const prey = active.filter((entry) => entry.side === "prey").map((entry) => entry.name).join(", ") || "—";
  const pursuer = active.filter((entry) => entry.side === "pursuer").map((entry) => entry.name).join(", ") || "—";
  const distances = active.flatMap((entry, index) => active.slice(index + 1).map((other) => (
    Math.abs(entry.position - other.position)
  )));
  const range = rangeAt(distances.length ? Math.min(...distances) : 0);
  return game.i18n.format("YZE.Chase.TrackerSummary", {
    prey, pursuer, range: game.i18n.localize(`YZE.Range.${range}`), round: state.round
  });
}

export function chaseStateFor(actor) {
  const state = getChaseState();
  if (!state.active) return { active: false };
  const participant = state.participants.find((entry) => entry.uuid === actor?.uuid);
  const target = participant ? nearestOpponent(state, participant) : null;
  const range = participant && target ? rangeAt(Math.abs(participant.position - target.position)) : "engaged";
  return {
    ...state,
    participant: Boolean(participant),
    participantData: participant,
    role: participant ? relativeRole(participant, target) : "",
    range,
    rangeLabel: game.i18n.localize(`YZE.Range.${range}`),
    preyName: state.participants.filter((entry) => entry.side === "prey" && !entry.escaped).map((entry) => entry.name).join(", "),
    pursuerName: state.participants.filter((entry) => entry.side === "pursuer" && !entry.escaped).map((entry) => entry.name).join(", "),
    summary: trackerSummary(state)
  };
}

function actorOption(actor, selected = false) {
  return `<option value="${escape(actor.uuid)}"${selected ? " selected" : ""}>${escape(actor.name)} (${escape(actor.type)})</option>`;
}

export async function startChase(initiator) {
  if (!game.user?.isGM) {
    ui.notifications.warn(game.i18n.localize("YZE.Chase.GMOnlyTracker"));
    return null;
  }
  const candidates = game.actors.filter((actor) => ["character", "npc", "vehicle", "mount"].includes(actor.type));
  if (!initiator || candidates.length < 2) return null;
  const preyOptions = candidates.map((actor) => actorOption(actor, actor.uuid === initiator.uuid)).join("");
  const pursuerOptions = candidates.map((actor) => actorOption(actor, false)).join("");
  const { DialogV2 } = foundry.applications.api;
  const selection = await DialogV2.wait({
    window: { title: game.i18n.localize("YZE.Chase.StartTracker") },
    content: `<div class="yze yze-chase-dialog">
      <div class="form-group"><label>${escape(game.i18n.localize("YZE.Chase.PreyParticipants"))}</label><select name="prey" multiple size="6">${preyOptions}</select></div>
      <div class="form-group"><label>${escape(game.i18n.localize("YZE.Chase.PursuerParticipants"))}</label><select name="pursuers" multiple size="6">${pursuerOptions}</select></div>
      <div class="form-group"><label>${escape(game.i18n.localize("YZE.Chase.StartingRange"))}</label><select name="range">${RANGE_ORDER.slice(0, 4).map((range) => `<option value="${range}"${range === "medium" ? " selected" : ""}>${escape(game.i18n.localize(`YZE.Range.${range}`))}</option>`).join("")}</select></div>
      <div class="form-group"><label>${escape(game.i18n.localize("YZE.Chase.ResolutionMode"))}</label><select name="mode"><option value="individual">${escape(game.i18n.localize("YZE.Chase.IndividualMode"))}</option><option value="grouped">${escape(game.i18n.localize("YZE.Chase.GroupedMode"))}</option></select></div>
      <p class="hint">${escape(game.i18n.localize("YZE.Chase.MultiParticipantHint"))}</p>
    </div>`,
    buttons: [
      { action: "start", label: game.i18n.localize("YZE.Chase.StartTracker"), icon: "fa-solid fa-flag-checkered", default: true,
        callback: (event, button, dialog) => { const form = button.form ?? dialog.element.querySelector("form"); return {
          prey: [...form.elements.prey.selectedOptions].map((option) => option.value),
          pursuers: [...form.elements.pursuers.selectedOptions].map((option) => option.value),
          range: form.elements.range.value,
          mode: form.elements.mode.value
        }; } },
      { action: "cancel", label: game.i18n.localize("YZE.Common.Cancel"), callback: () => null }
    ], close: () => null, rejectClose: false, modal: true
  });
  if (!selection) return null;
  const prey = [...new Set(selection.prey)];
  const pursuers = [...new Set(selection.pursuers)].filter((uuid) => !prey.includes(uuid));
  if (!prey.length || !pursuers.length) {
    ui.notifications.warn(game.i18n.localize("YZE.Chase.NeedBothSides"));
    return null;
  }
  const distance = Math.max(0, RANGE_ORDER.indexOf(selection.range));
  const state = {
    active: true, version: 2, id: foundry.utils.randomID(), round: 1,
    mode: selection.mode, phase: "commit", obstacle: null,
    participants: [
      ...prey.map((uuid) => game.actors.get(uuid.split(".").pop())).filter(Boolean).map((actor) => participantFromActor(actor, "prey", distance)),
      ...pursuers.map((uuid) => game.actors.get(uuid.split(".").pop())).filter(Boolean).map((actor) => participantFromActor(actor, "pursuer", 0))
    ]
  };
  await game.settings.set(SYSTEM_ID, CHASE_SETTING, state);
  await ChatMessage.create({ content: `<div class="yze chat-card"><h3>${escape(game.i18n.localize("YZE.Chase.TrackerStarted"))}</h3><p>${escape(trackerSummary(state))}</p><p>${escape(game.i18n.localize("YZE.Chase.CommitPrompt"))}</p></div>` });
  return state;
}

export async function endChase(reason = "") {
  if (!game.user?.isGM) return false;
  const state = getChaseState();
  await game.settings.set(SYSTEM_ID, CHASE_SETTING, {});
  if (state.active) await ChatMessage.create({ content: `<div class="yze chat-card"><p>${escape(game.i18n.format("YZE.Chase.TrackerEnded", { reason: reason || game.i18n.localize("YZE.Chase.EndedManually") }))}</p></div>` });
  return true;
}

function chaseOutcome(chase, successes) {
  if (chase.cancelled) return game.i18n.localize("YZE.Chase.ManeuverCancelled");
  if (chase.maneuver === "pursueFlee") return game.i18n.format(chase.role === "prey" ? "YZE.Chase.FleeResult" : "YZE.Chase.PursueResult", { successes });
  const keys = { hide: successes > 0 ? "YZE.Chase.HideSuccess" : "YZE.Chase.HideFailure", block: successes > 0 ? "YZE.Chase.BlockSuccess" : "YZE.Chase.BlockFailure", cutOff: successes > 0 ? "YZE.Chase.CutOffSuccess" : "YZE.Chase.CutOffFailure", standShoot: "YZE.Chase.StandShootResult", other: "YZE.Chase.OtherResult" };
  return game.i18n.format(keys[chase.maneuver] ?? "YZE.Chase.OtherResult", { successes });
}

export function renderChaseControl(state) {
  if (!state?.chase) return "";
  const successes = rollSuccesses(state);
  return `<div class="yze-chase-result"><h4>${escape(game.i18n.localize("YZE.Chase.ManeuverResult"))}</h4><p>${escape(chaseOutcome(state.chase, successes))}</p>${state.chase.obstacleName ? `<p class="hint">${escape(game.i18n.format("YZE.Chase.ObstacleApplied", { obstacle: state.chase.obstacleName }))}</p>` : ""}${getChaseState().active ? `<button type="button" data-action="applyChaseOutcome"><i class="fa-solid fa-arrows-left-right"></i> ${escape(game.i18n.localize("YZE.Chase.ApplyOutcome"))}</button>` : ""}</div>`;
}

function skillOptions(actor, preferred) {
  return actor.items.filter((item) => item.type === "skill").sort((a, b) => a.name.localeCompare(b.name)).map((skill) => `<option value="${escape(skill.id)}"${skill.name.localeCompare(preferred, undefined, { sensitivity: "base" }) === 0 ? " selected" : ""}>${escape(skill.name)}</option>`).join("");
}

async function chaseParticipant(participant) {
  if (participant.type === "vehicle") {
    const { driver, skill } = await vehicleDriverSkill(participant);
    return { actor: driver, vehicle: participant, mount: null, fixed: vehicleDrivingModifier(participant), skill };
  }
  if (participant.type === "mount") {
    return { actor: await resolveMountRider(participant), vehicle: null, mount: participant, fixed: 0, skill: null };
  }
  return { actor: participant, vehicle: null, mount: null, fixed: 0, skill: null };
}

function obstacleRule(obstacle, role, maneuver) {
  if (!obstacle) return { modifier: 0 };
  const movement = ["pursueFlee", "hide", "block"];
  const rule = { modifier: 0, cancelled: false, prerequisite: "", failDamage: 0, failFaces: 0, wreckOnFail: false };
  const n = whole(obstacle.result);
  if (n === 1 && role === "prey" && movement.includes(maneuver)) rule.cancelled = true;
  if (obstacle.kind === "foot") {
    if (n === 2 && role === "prey" && movement.includes(maneuver)) { rule.prerequisite = "Force"; rule.failDamage = 1; rule.failFaces = 3; }
    if (n === 3) rule.modifier += ["pursueFlee", "standShoot"].includes(maneuver) ? 2 : maneuver === "cutOff" ? -2 : 0;
    if (n === 4) rule.modifier += maneuver === "hide" ? 2 : 0;
    if (n === 5 && role === "prey") rule.prerequisite = "Persuasion";
    if (n === 6 && ["pursueFlee", "hide", "standShoot"].includes(maneuver)) rule.modifier -= 2;
    if (n === 7 && role === "pursuer") rule.prerequisite = "Force";
    if (n === 8) rule.modifier += maneuver === "block" ? 2 : maneuver === "pursueFlee" ? -2 : 0;
    if (n === 9) rule.modifier += maneuver === "standShoot" ? 2 : maneuver === "hide" ? -2 : 0;
    if (n === 10 && role === "prey") { rule.prerequisite = "Persuasion"; rule.failDamage = 1; }
  } else {
    const positive = {
      2: ["hide"], 3: ["block"], 4: ["cutOff"], 6: ["pursueFlee", "standShoot"],
      7: ["hide", "block", "cutOff"], 8: ["block"], 9: ["cutOff"]
    };
    const negative = {
      2: ["pursueFlee"], 3: ["pursueFlee"], 4: ["pursueFlee", "standShoot"],
      5: ["pursueFlee", "hide", "standShoot"], 6: ["hide", "block"],
      7: ["pursueFlee", "standShoot"], 8: ["pursueFlee", "standShoot"], 9: ["pursueFlee"]
    };
    if (positive[n]?.includes(maneuver)) rule.modifier += 2;
    if (negative[n]?.includes(maneuver)) rule.modifier -= 2;
    if ([3, 7].includes(n) && maneuver === "pursueFlee") rule.failFaces = 3;
    if (n === 9 && maneuver === "pursueFlee") rule.failFaces = 6;
    if (n === 10) { rule.prerequisite = "Driving"; rule.wreckOnFail = true; }
  }
  return rule;
}

function rangeModifier(maneuver, range) {
  if (maneuver === "hide") return range === "medium" ? -2 : range === "extreme" ? 2 : 0;
  if (maneuver === "cutOff" && ["long", "extreme"].includes(range)) return -2;
  return 0;
}

async function commitManeuver(participant, selection) {
  const state = getChaseState();
  const tracked = state.participants.find((entry) => entry.uuid === participant.uuid);
  if (!tracked || tracked.committed) return null;
  if (!game.user.isGM && !game.users.some((user) => user.active && user.isGM)) {
    ui.notifications.warn(game.i18n.localize("YZE.Chase.ActiveGMRequired"));
    return null;
  }
  const whisper = [...new Set([game.user.id, ...game.users.filter((user) => user.isGM).map((user) => user.id)])];
  const message = await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor: participant }), whisper,
    content: `<div class="yze chat-card"><h3>${escape(game.i18n.localize("YZE.Chase.SecretCommitted"))}</h3><p>${escape(participant.name)}</p><p class="hint">${escape(game.i18n.localize("YZE.Chase.SecretCommitHint"))}</p></div>`,
    flags: { [SYSTEM_ID]: { chaseCommitment: { chaseId: state.id, round: state.round, participantUuid: participant.uuid, selection } } }
  });
  if (game.user.isGM) await acceptCommitment({ chaseId: state.id, round: state.round, participantUuid: participant.uuid, messageId: message.id });
  else game.socket.emit(CHASE_SOCKET, { action: "chaseCommit", chaseId: state.id, round: state.round, participantUuid: participant.uuid, messageId: message.id });
  return message;
}

async function acceptCommitment(request) {
  if (!game.user?.isGM) return false;
  const state = getChaseState();
  if (!state.active || state.id !== request.chaseId || state.round !== request.round || state.phase !== "commit") return false;
  const participant = state.participants.find((entry) => entry.uuid === request.participantUuid);
  const message = game.messages.get(request.messageId);
  const secret = message?.getFlag(SYSTEM_ID, "chaseCommitment");
  const actor = participant ? await fromUuid(participant.uuid) : null;
  if (!participant || !secret || secret.participantUuid !== participant.uuid
    || !actor?.testUserPermission?.(message.author, "OWNER")) return false;
  participant.committed = true;
  participant.commitmentMessageId = message.id;
  await game.settings.set(SYSTEM_ID, CHASE_SETTING, state);
  if (state.participants.filter((entry) => !entry.escaped).every((entry) => entry.committed)) await revealCommitments();
  return true;
}

async function revealCommitments() {
  if (!game.user?.isGM) return false;
  const state = getChaseState();
  if (!state.active || state.phase !== "commit") return false;
  const vehicle = state.participants.some((entry) => entry.type === "vehicle");
  const obstacle = await drawChaseObstacle({ vehicle, saveToTracker: false });
  for (const participant of state.participants.filter((entry) => !entry.escaped)) {
    const message = game.messages.get(participant.commitmentMessageId);
    participant.commitment = foundry.utils.deepClone(message?.getFlag(SYSTEM_ID, "chaseCommitment")?.selection ?? {});
    participant.resolved = false;
  }
  if (state.mode === "grouped") {
    for (const side of ["prey", "pursuer"]) {
      const members = state.participants.filter((entry) => !entry.escaped && entry.side === side);
      const paced = [];
      for (const entry of members) paced.push({ entry, pace: await participantPace(await fromUuid(entry.uuid)) });
      paced.sort((left, right) => left.pace - right.pace || left.entry.name.localeCompare(right.entry.name));
      for (const { entry } of paced) entry.groupRepresentative = entry.uuid === paced[0]?.entry.uuid;
    }
  }
  state.phase = "reveal";
  state.obstacle = obstacle?.obstacle ?? null;
  await game.settings.set(SYSTEM_ID, CHASE_SETTING, state);
  const entries = state.participants.filter((entry) => !entry.escaped).map((entry) => `<li><strong>${escape(entry.name)}</strong>: ${escape(game.i18n.localize(`YZE.Chase.Maneuvers.${entry.commitment?.maneuver || "other"}`))}</li>`).join("");
  await ChatMessage.create({ content: `<div class="yze chat-card"><h3>${escape(game.i18n.format("YZE.Chase.RevealTitle", { round: state.round }))}</h3><ul>${entries}</ul>${state.obstacle ? `<p><strong>${escape(game.i18n.localize("YZE.Chase.Obstacle"))}:</strong> ${escape(state.obstacle.name)}</p>` : ""}<p class="hint">${escape(game.i18n.localize("YZE.Chase.ResolvePreyFirst"))}</p></div>` });
  return true;
}

async function participantPace(participant) {
  const resolved = await chaseParticipant(participant);
  if (!resolved.actor) return -999;
  const preferred = resolved.vehicle?.system?.drivingSkillName || resolved.mount?.system?.mobilitySkillName || "Mobility";
  const skill = resolved.skill ?? resolved.actor.items.find((item) => item.type === "skill"
    && item.name.localeCompare(preferred, undefined, { sensitivity: "base" }) === 0);
  const skillRating = Number(skill?.system?.rating ?? skill?.system?.stepRating) || 0;
  const agility = Number((resolved.mount ?? resolved.actor).system?.attributes?.agility?.value
    ?? (resolved.mount ?? resolved.actor).system?.attributes?.agility?.stepRating) || 0;
  return agility + skillRating + resolved.fixed;
}

async function cancelledManeuverMessage(actor, chase, reason) {
  const state = { version: 1, mode: "pool", actorUuid: actor.uuid, actorName: actor.name, canPush: false, automaticSuccesses: 0, dice: [], chase: { ...chase, cancelled: true } };
  return ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    content: `<div class="yze chat-card"><h3>${escape(reason)}</h3>${renderChaseControl(state)}</div>`,
    flags: { [SYSTEM_ID]: { push: state } }
  });
}

async function resolveCommittedManeuver(participant, tracked, selection) {
  const resolved = await chaseParticipant(participant);
  if (!resolved.actor) {
    ui.notifications.warn(game.i18n.localize(resolved.mount ? "YZE.Mount.RiderMissing" : "YZE.Vehicle.DriverMissing"));
    return null;
  }
  const actor = resolved.actor;
  const currentState = getChaseState();
  const target = currentState.participants?.find((entry) => entry.uuid === selection.targetUuid)
    ?? (currentState.participants ? nearestOpponent(currentState, tracked) : null);
  const role = relativeRole(tracked, target);
  const range = rangeAt(Math.abs(tracked.position - (target?.position ?? 0)));
  const chase = { participantUuid: participant.uuid, participantName: participant.name, targetUuid: target?.uuid ?? "", role, range, maneuver: selection.maneuver, obstacleName: getChaseState().obstacle?.name ?? "" };
  if (currentState.mode === "grouped" && tracked.groupRepresentative !== true && selection.maneuver !== "standShoot") {
    return cancelledManeuverMessage(actor, chase, game.i18n.localize("YZE.Chase.GroupRepresentativeOnly"));
  }
  if (tracked.blocked === true) {
    const required = resolved.vehicle ? "Driving" : "Force";
    const skill = resolved.skill ?? actor.items.find((item) => item.type === "skill"
      && item.name.localeCompare(required, undefined, { sensitivity: "base" }) === 0);
    if (!skill) return cancelledManeuverMessage(actor, chase, game.i18n.format("YZE.Chase.PrerequisiteMissing", { skill: required }));
    const check = await actor.rollSkill(skill.id, { canPush: false, canOppose: false, allowAttemptTracking: false });
    if (!check || rollSuccesses(check.getFlag(SYSTEM_ID, "push")) < 1) {
      return cancelledManeuverMessage(actor, chase, game.i18n.localize("YZE.Chase.BlockedRouteFailed"));
    }
  }
  const rule = obstacleRule(currentState.obstacle, role, selection.maneuver);
  if (rule.cancelled) return cancelledManeuverMessage(actor, chase, game.i18n.localize("YZE.Chase.ObstacleCancelled"));
  if (rule.prerequisite) {
    const prerequisite = rule.prerequisite === "Driving" && resolved.vehicle
      ? resolved.skill
      : actor.items.find((item) => item.type === "skill" && item.name.localeCompare(rule.prerequisite, undefined, { sensitivity: "base" }) === 0);
    if (!prerequisite) return cancelledManeuverMessage(actor, chase, game.i18n.format("YZE.Chase.PrerequisiteMissing", { skill: rule.prerequisite }));
    const check = await actor.rollSkill(prerequisite.id, { canPush: false, canOppose: false, allowAttemptTracking: false });
    if (!check || rollSuccesses(check.getFlag(SYSTEM_ID, "push")) < 1) {
      if (rule.failDamage > 0) {
        const damage = rule.failFaces ? whole((await new Roll(`1d${rule.failFaces}`).evaluate()).total) : rule.failDamage;
        await applyDamage(participant, damage, { category: "physical", skipCriticalInjury: true });
      }
      if (rule.wreckOnFail && participant.type === "vehicle") {
        await participant.update({ "system.hull.value": 0, "system.wrecked": true });
      }
      return cancelledManeuverMessage(actor, chase, game.i18n.localize("YZE.Chase.PrerequisiteFailed"));
    }
  }
  const fixed = resolved.fixed + rangeModifier(selection.maneuver, range) + wholeSigned(selection.modifier) + rule.modifier;
  chase.obstacleFailFaces = rule.failFaces;
  if (selection.maneuver === "standShoot") {
    const weapons = actor.items.filter((item) => item.type === "weapon" && Number(item.system.quantity) > 0);
    if (weapons.length === 0) return cancelledManeuverMessage(actor, chase, game.i18n.localize("YZE.Combat.NoWeapons"));
    const { DialogV2 } = foundry.applications.api;
    const weaponId = await DialogV2.wait({
      window: { title: game.i18n.localize("YZE.Chase.StandShootWeapon") },
      content: `<div class="yze"><div class="form-group"><label>${escape(game.i18n.localize("YZE.Combat.Weapon"))}</label><select name="weapon">${weapons.map((item) => `<option value="${escape(item.id)}">${escape(item.name)}</option>`).join("")}</select></div><p class="hint">${escape(game.i18n.localize("YZE.Chase.TargetTokenHint"))}</p></div>`,
      buttons: [
        { action: "attack", label: game.i18n.localize("YZE.Chase.Maneuvers.standShoot"), icon: "fa-solid fa-crosshairs", default: true,
          callback: (event, button, dialog) => (button.form ?? dialog.element.querySelector("form")).elements.weapon?.value },
        { action: "cancel", label: game.i18n.localize("YZE.Common.Cancel"), callback: () => null }
      ], close: () => null, rejectClose: false, modal: true
    });
    if (!weaponId) return null;
    const containingVehicle = game.actors.find((entry) => entry.type === "vehicle"
      && (entry.system.driverUuid === actor.uuid || (entry.system.occupantUuids ?? []).includes(actor.uuid)));
    const driverCommitment = currentState.participants.find((entry) => entry.uuid === containingVehicle?.uuid)?.commitment;
    const stabilizedWeapon = containingVehicle?.items?.some((item) => item.type === "vehicleComponent"
      && item.system.componentType === "weapon" && item.system.active === true
      && item.system.damaged !== true && item.system.targetingSystem === true);
    const firingPenalty = containingVehicle && !stabilizedWeapon
      && driverCommitment?.maneuver !== "standShoot" ? -2 : 0;
    const message = await attackWithWeapon(actor, weaponId, {
      fixedModifiers: firingPenalty ? [[game.i18n.localize("YZE.Chase.VehicleFiringPenalty"), firingPenalty]] : [],
      targetActorUuid: target?.uuid ?? ""
    });
    if (!message) return null;
    const messageState = message.getFlag(SYSTEM_ID, "push");
    const nextState = { ...messageState, chase };
    await message.setFlag(SYSTEM_ID, "push", nextState);
    await message.update({ content: `${message.content}${renderChaseControl(nextState)}` });
    return message;
  }
  if (resolved.mount) return mountMobilityRoll(resolved.mount, {
    fixedModifiers: [[game.i18n.localize("YZE.Chase.ManeuverModifier"), fixed]], chase, purpose: "chase"
  });
  const skillId = selection.skillId && actor.items.get(selection.skillId)?.type === "skill"
    ? selection.skillId
    : resolved.skill?.id ?? actor.items.find((item) => item.type === "skill")?.id;
  if (!skillId) return null;
  return actor.rollSkill(skillId, { fixedModifiers: [[game.i18n.localize("YZE.Chase.ManeuverModifier"), fixed]], chase });
}

function wholeSigned(value) { const number = Number(value); return Number.isFinite(number) ? Math.trunc(number) : 0; }

export async function promptChaseManeuver(participant) {
  if (!isVehicleSubsystemEnabled() || !participant) return null;
  const tracker = chaseStateFor(participant);
  const tracked = tracker.participantData;
  if (tracker.active && !tracked) {
    ui.notifications.warn(game.i18n.localize("YZE.Chase.NotParticipant"));
    return null;
  }
  if (tracked?.resolved) {
    ui.notifications.warn(game.i18n.localize("YZE.Chase.AlreadyResolved"));
    return null;
  }
  if (tracker.active && tracker.phase === "reveal" && tracked?.commitment) {
    const unresolved = tracker.participants.filter((entry) => !entry.escaped && !entry.resolved)
      .sort((left, right) => {
        const position = right.position - left.position;
        if (position) return position;
        if (left.side !== right.side) return left.side === "prey" ? -1 : 1;
        return left.name.localeCompare(right.name);
      });
    if (unresolved[0]?.uuid !== tracked.uuid) {
      ui.notifications.warn(game.i18n.format("YZE.Chase.ResolveOrder", { participant: unresolved[0]?.name ?? "" }));
      return null;
    }
    const { DialogV2 } = foundry.applications.api;
    const choice = await DialogV2.wait({
      window: { title: game.i18n.localize("YZE.Chase.ResolveCommittedTitle") },
      content: `<div class="yze"><p>${escape(game.i18n.format("YZE.Chase.ResolveCommittedHint", { maneuver: game.i18n.localize(`YZE.Chase.Maneuvers.${tracked.commitment.maneuver}`) }))}</p></div>`,
      buttons: [
        { action: "resolve", label: game.i18n.localize("YZE.Chase.ResolveCommitted"), icon: "fa-solid fa-dice", default: true, callback: () => "resolve" },
        { action: "cancel", label: game.i18n.localize("YZE.Chase.CancelCommitted"), icon: "fa-solid fa-ban", callback: () => "cancel" },
        { action: "close", label: game.i18n.localize("YZE.Common.Close"), callback: () => null }
      ], close: () => null, rejectClose: false, modal: true
    });
    if (choice === "cancel") {
      const resolved = await chaseParticipant(participant);
      const target = tracker.participants.find((entry) => entry.uuid === tracked.commitment.targetUuid) ?? nearestOpponent(tracker, tracked);
      const role = relativeRole(tracked, target);
      return cancelledManeuverMessage(resolved.actor, {
        participantUuid: participant.uuid, participantName: participant.name,
        targetUuid: target?.uuid ?? "", role,
        range: rangeAt(Math.abs(tracked.position - (target?.position ?? 0))),
        maneuver: tracked.commitment.maneuver,
        obstacleName: tracker.obstacle?.name ?? ""
      }, game.i18n.localize("YZE.Chase.CommitmentCancelled"));
    }
    return choice === "resolve" ? resolveCommittedManeuver(participant, tracked, tracked.commitment) : null;
  }
  if (tracker.active && tracked?.committed) {
    ui.notifications.info(game.i18n.localize("YZE.Chase.WaitingReveal"));
    return null;
  }
  const resolved = await chaseParticipant(participant);
  if (!resolved.actor) {
    ui.notifications.warn(game.i18n.localize(resolved.mount ? "YZE.Mount.RiderMissing" : "YZE.Vehicle.DriverMissing"));
    return null;
  }
  const actor = resolved.actor;
  if (!userCanControl(actor) || !actor.items.some((item) => item.type === "skill")) return null;
  const targets = tracker.active ? opponentsOf(tracker, tracked) : [];
  const targetOptions = targets.map((entry) => `<option value="${escape(entry.uuid)}">${escape(entry.name)}</option>`).join("");
  const preferred = resolved.vehicle?.system?.drivingSkillName || resolved.mount?.system?.mobilitySkillName || "Mobility";
  const { DialogV2 } = foundry.applications.api;
  const selection = await DialogV2.wait({
    window: { title: game.i18n.localize("YZE.Chase.ManeuverTitle") },
    content: `<div class="yze yze-chase-dialog">
      ${tracker.active ? `<div class="form-group"><label>${escape(game.i18n.localize("YZE.Chase.TargetParticipant"))}</label><select name="target">${targetOptions}</select></div>` : ""}
      <div class="form-group"><label>${escape(game.i18n.localize("YZE.Chase.Maneuver"))}</label><select name="maneuver">${MANEUVERS.map((key) => `<option value="${key}">${escape(game.i18n.localize(`YZE.Chase.Maneuvers.${key}`))}</option>`).join("")}</select></div>
      <div class="form-group"><label>${escape(game.i18n.localize("YZE.Chase.Skill"))}</label><select name="skill">${skillOptions(actor, preferred)}</select></div>
      <div class="form-group"><label>${escape(game.i18n.localize("YZE.Roll.OtherModifier"))}</label><input type="number" name="modifier" value="0"></div>
      ${tracker.active ? `<p class="hint">${escape(game.i18n.localize("YZE.Chase.SecretSelectionHint"))}</p>` : ""}
    </div>`,
    buttons: [
      { action: "choose", label: game.i18n.localize(tracker.active ? "YZE.Chase.CommitSecretly" : "YZE.Roll.Roll"), icon: "fa-solid fa-user-secret", default: true,
        callback: (event, button, dialog) => { const form = button.form ?? dialog.element.querySelector("form"); return { targetUuid: form.elements.target?.value ?? "", maneuver: form.elements.maneuver.value, skillId: form.elements.skill.value, modifier: wholeSigned(form.elements.modifier.value) }; } },
      { action: "cancel", label: game.i18n.localize("YZE.Common.Cancel"), callback: () => null }
    ], close: () => null, rejectClose: false, modal: true
  });
  if (!selection) return null;
  const target = tracker.active ? tracker.participants.find((entry) => entry.uuid === selection.targetUuid) : null;
  const role = tracked ? relativeRole(tracked, target) : "prey";
  const range = tracked && target ? rangeAt(Math.abs(tracked.position - target.position)) : "medium";
  if (selection.maneuver === "hide" && (role !== "prey" || ["engaged", "short"].includes(range))) { ui.notifications.warn(game.i18n.localize("YZE.Chase.HideUnavailable")); return null; }
  if (selection.maneuver === "block" && role !== "prey") { ui.notifications.warn(game.i18n.localize("YZE.Chase.PreyOnly")); return null; }
  if (selection.maneuver === "cutOff" && role !== "pursuer") { ui.notifications.warn(game.i18n.localize("YZE.Chase.PursuerOnly")); return null; }
  const restrictions = getCriticalInjuryRestrictions(actor);
  if (!resolved.vehicle && restrictions.movement === "none" && ["pursueFlee", "hide", "block", "cutOff"].includes(selection.maneuver)) {
    notifyCriticalInjuryRestriction(actor, { kind: "movement", sources: restrictions.movementSources });
    return null;
  }
  if (tracker.active) return commitManeuver(participant, selection);
  return resolveCommittedManeuver(participant, { ...participantFromActor(participant, role, RANGE_ORDER.indexOf(range)) }, selection);
}

export async function applyChaseOutcome(message, state) {
  if (!game.user?.isGM || !state?.chase || state.superseded || message.getFlag(SYSTEM_ID, CHASE_APPLIED_FLAG)) return false;
  const tracker = getChaseState();
  const participant = tracker.participants.find((entry) => entry.uuid === state.chase.participantUuid);
  if (!tracker.active || !participant || participant.resolved) return false;
  const target = tracker.participants.find((entry) => entry.uuid === state.chase.targetUuid) ?? nearestOpponent(tracker, participant);
  const successes = rollSuccesses(state);
  const maneuver = state.chase.maneuver;
  let opposedSuccesses = null;
  if (!state.chase.cancelled && target && ["hide", "cutOff"].includes(maneuver)) {
    let link = message.getFlag(SYSTEM_ID, "opposed");
    let opponentMessage = link?.opponentMessageId ? game.messages.get(link.opponentMessageId) : null;
    if (!opponentMessage) {
      const targetActor = await fromUuid(target.uuid);
      const targetResolved = await chaseParticipant(targetActor);
      const opponent = targetResolved.actor;
      const preferred = maneuver === "hide"
        ? "Observation"
        : targetResolved.vehicle?.system?.drivingSkillName || targetResolved.mount?.system?.mobilitySkillName || "Mobility";
      const skill = maneuver === "cutOff" && targetResolved.skill
        ? targetResolved.skill
        : opponent?.items?.find((item) => item.type === "skill"
          && item.name.localeCompare(preferred, undefined, { sensitivity: "base" }) === 0);
      if (!opponent || !skill) {
        ui.notifications.warn(game.i18n.format("YZE.Chase.OppositionSkillMissing", {
          actor: opponent?.name ?? target.name, skill: preferred
        }));
        return false;
      }
      opponentMessage = targetResolved.mount && maneuver === "cutOff"
        ? await mountMobilityRoll(targetResolved.mount, { purpose: "chaseOpposition" })
        : await opponent.rollSkill(skill.id, {
          canPush: false, canOppose: false, allowHelpers: false,
          allowAttemptTracking: false,
          fixedModifiers: targetResolved.vehicle && maneuver === "cutOff"
            ? [[game.i18n.localize("YZE.Chase.ManeuverModifier"), targetResolved.fixed]]
            : []
        });
      const opponentState = opponentMessage?.getFlag(SYSTEM_ID, "push");
      if (!opponentState) return false;
      await linkOpposedRolls(message, state, opponentMessage, opponentState);
      link = message.getFlag(SYSTEM_ID, "opposed");
    }
    opposedSuccesses = rollSuccesses(opponentMessage.getFlag(SYSTEM_ID, "push"));
  }
  const wonOpposed = opposedSuccesses === null || successes > opposedSuccesses;
  let overtakingChoice = "";
  let hideChoice = "escape";
  if (!state.chase.cancelled && maneuver === "hide" && successes > 0 && wonOpposed && target) {
    const { DialogV2 } = foundry.applications.api;
    hideChoice = await DialogV2.wait({
      window: { title: game.i18n.localize("YZE.Chase.HideWon") },
      content: `<div class="yze"><p>${escape(game.i18n.localize("YZE.Chase.HideWonHint"))}</p></div>`,
      buttons: [
        { action: "escape", label: game.i18n.localize("YZE.Chase.EndByHiding"), default: true, callback: () => "escape" },
        { action: "sneak", label: game.i18n.localize("YZE.Chase.PrepareSneakAttack"), callback: () => "sneak" }
      ], close: () => "escape", rejectClose: false, modal: true
    });
  }
  if (!state.chase.cancelled && maneuver === "pursueFlee" && successes > 0 && target
    && relativeRole(participant, target) === "pursuer"
    && participant.position + successes >= target.position) {
    const excess = participant.position + successes - target.position;
    const { DialogV2 } = foundry.applications.api;
    overtakingChoice = await DialogV2.wait({
      window: { title: game.i18n.localize("YZE.Chase.CaughtTarget") },
      content: `<div class="yze"><p>${escape(game.i18n.format("YZE.Chase.CaughtTargetHint", { pursuer: participant.name, target: target.name }))}</p></div>`,
      buttons: [
        { action: "attack", label: game.i18n.localize("YZE.Chase.StopAndAttack"), icon: "fa-solid fa-burst", default: true, callback: () => "attack" },
        { action: "stay", label: game.i18n.localize("YZE.Chase.StayEngaged"), icon: "fa-solid fa-link", callback: () => "stay" },
        ...(excess > 0 ? [{ action: "overtake", label: game.i18n.localize("YZE.Chase.Overtake"), icon: "fa-solid fa-forward-fast", callback: () => "overtake" }] : [])
      ],
      close: () => "attack", rejectClose: false, modal: true
    });
  }
  if (!state.chase.cancelled) {
    if (maneuver === "pursueFlee") {
      if (["attack", "stay"].includes(overtakingChoice)) participant.position = target.position;
      else if (overtakingChoice === "overtake") {
        participant.position = target.position + Math.max(1, participant.position + successes - target.position);
        participant.side = "prey";
        target.side = "pursuer";
      } else participant.position += successes;
    }
    if (maneuver === "block" && successes > 0) participant.position += 1;
    if (maneuver === "block" && successes > 0 && target) target.blocked = true;
    if (maneuver === "hide" && successes > 0 && wonOpposed) participant.escaped = true;
    if (maneuver === "cutOff" && target) {
      if (successes > 0 && wonOpposed) participant.position = target.position;
      else if (Math.abs(participant.position - target.position) >= RANGE_ORDER.length - 1) target.escaped = true;
      else participant.position = target.position - (RANGE_ORDER.length - 1);
    }
    if (successes < 1 && whole(state.chase.obstacleFailFaces) > 0) {
      const damage = whole((await new Roll(`1d${state.chase.obstacleFailFaces}`).evaluate()).total);
      await applyDamage(await fromUuid(participant.uuid), damage, { category: "physical", skipCriticalInjury: true });
    }
  }
  participant.resolved = true;
  if (participant.side === "prey") {
    const pursuers = tracker.participants.filter((entry) => !entry.escaped && entry.side === "pursuer");
    if (pursuers.length > 0 && pursuers.every((entry) => Math.abs(participant.position - entry.position) >= RANGE_ORDER.length)) {
      participant.escaped = true;
    }
  }
  await message.setFlag(SYSTEM_ID, CHASE_APPLIED_FLAG, true);
  const active = tracker.participants.filter((entry) => !entry.escaped);
  const preyRemain = active.some((entry) => entry.side === "prey");
  const pursuersRemain = active.some((entry) => entry.side === "pursuer");
  if (!preyRemain || !pursuersRemain) {
    const ended = await endChase(game.i18n.localize(!preyRemain ? "YZE.Chase.PreyEscaped" : "YZE.Chase.PursuersLost"));
    if (maneuver === "hide" && hideChoice === "sneak") {
      const participantDocument = await fromUuid(participant.uuid);
      const resolved = await chaseParticipant(participantDocument);
      ui.notifications.info(game.i18n.localize("YZE.Chase.TargetSneakOpponent"));
      await promptSneakAttack(resolved.actor);
    }
    return ended;
  }
  const roundComplete = active.every((entry) => entry.resolved);
  if (roundComplete) {
    for (const entry of active) Object.assign(entry, { committed: false, commitmentMessageId: "", commitment: null, resolved: false, blocked: false });
    tracker.round += 1;
    tracker.phase = "commit";
    tracker.obstacle = null;
  }
  await game.settings.set(SYSTEM_ID, CHASE_SETTING, tracker);
  const immediateAttack = target && !participant.escaped && !target.escaped
    && ["pursueFlee", "cutOff"].includes(maneuver)
    && (maneuver === "cutOff" || overtakingChoice === "attack" || !overtakingChoice)
    && participant.position === target.position;
  await ChatMessage.create({
    content: `<div class="yze chat-card"><p>${escape(trackerSummary(tracker))}</p>${opposedSuccesses === null ? "" : `<p>${escape(game.i18n.format("YZE.Chase.OpposedSummary", { active: successes, opposition: opposedSuccesses }))}</p>`}${overtakingChoice === "overtake" ? `<p><strong>${escape(game.i18n.localize("YZE.Chase.OvertakeComplete"))}</strong></p>` : ""}${immediateAttack ? `<p><strong>${escape(game.i18n.localize("YZE.Chase.ImmediateAttackAvailable"))}</strong></p><button type="button" data-action="chaseImmediateAttack"><i class="fa-solid fa-burst"></i> ${escape(game.i18n.localize("YZE.Chase.MakeImmediateAttack"))}</button>` : ""}${roundComplete ? `<p>${escape(game.i18n.localize("YZE.Chase.CommitPrompt"))}</p>` : ""}</div>`,
    flags: immediateAttack ? { [SYSTEM_ID]: { chaseImmediateAttack: {
      participantUuid: participant.uuid,
      targetUuid: target.uuid
    } } } : {}
  });
  return true;
}

async function makeImmediateChaseAttack(message) {
  const data = message.getFlag(SYSTEM_ID, "chaseImmediateAttack");
  if (!data || message.getFlag(SYSTEM_ID, "chaseImmediateAttackUsed")) return false;
  const participant = await fromUuid(data.participantUuid);
  const target = await fromUuid(data.targetUuid);
  if (!participant?.system || !target?.system || (!game.user?.isGM && participant.isOwner === false)) return false;
  let attack = null;
  if (participant.type === "vehicle") {
    attack = await rollVehicleManeuver(participant, { ram: true, targetActorUuid: target.uuid });
  } else {
    const resolved = await chaseParticipant(participant);
    const weapons = resolved.actor?.items?.filter((item) => item.type === "weapon" && Number(item.system.quantity) > 0) ?? [];
    if (weapons.length === 0) {
      ui.notifications.warn(game.i18n.localize("YZE.Combat.NoWeapons"));
      return false;
    }
    const { DialogV2 } = foundry.applications.api;
    const weaponId = await DialogV2.wait({
      window: { title: game.i18n.localize("YZE.Chase.MakeImmediateAttack") },
      content: `<div class="yze"><div class="form-group"><label>${escape(game.i18n.localize("YZE.Combat.Weapon"))}</label><select name="weapon">${weapons.map((weapon) => `<option value="${escape(weapon.id)}">${escape(weapon.name)}</option>`).join("")}</select></div></div>`,
      buttons: [
        { action: "attack", label: game.i18n.localize("YZE.Chase.MakeImmediateAttack"), default: true,
          callback: (event, button, dialog) => (button.form ?? dialog.element.querySelector("form")).elements.weapon?.value },
        { action: "cancel", label: game.i18n.localize("YZE.Common.Cancel"), callback: () => null }
      ], close: () => null, rejectClose: false, modal: true
    });
    if (weaponId) attack = await attackWithWeapon(resolved.actor, weaponId, { targetActorUuid: target.uuid });
  }
  if (!attack) return false;
  await message.setFlag(SYSTEM_ID, "chaseImmediateAttackUsed", true);
  return true;
}

export async function drawChaseObstacle({ vehicle = false, saveToTracker = true } = {}) {
  if (!game.user?.isGM) {
    ui.notifications.warn(game.i18n.localize("YZE.Chase.GMOnlyObstacle"));
    return null;
  }
  const name = vehicle ? "YZE Vehicle Chase Obstacles" : "YZE Foot Chase Obstacles";
  const table = game.tables?.find((entry) => entry.name === name);
  if (!table) {
    ui.notifications.error(game.i18n.format("YZE.Chase.TableMissing", { table: name }));
    return null;
  }
  const roll = await new Roll("1d10").evaluate();
  const draw = await table.draw({ displayChat: true, roll });
  const result = whole(roll.total);
  const text = draw?.results?.[0]?.text ?? draw?.results?.[0]?.description ?? `${name} ${result}`;
  const obstacle = { kind: vehicle ? "vehicle" : "foot", result, name: String(text) };
  if (saveToTracker) {
    const state = getChaseState();
    if (state.active) { state.obstacle = obstacle; await game.settings.set(SYSTEM_ID, CHASE_SETTING, state); }
  }
  return { draw, obstacle };
}

export function registerChaseHooks() {
  game.socket.on(CHASE_SOCKET, async (request) => {
    const primaryGM = game.users.filter((user) => user.active && user.isGM)
      .sort((left, right) => left.id.localeCompare(right.id))[0];
    if (request?.action === "chaseCommit" && game.user?.id === primaryGM?.id) await acceptCommitment(request);
  });
  Hooks.on("renderChatMessageHTML", (message, html) => {
    const root = html?.querySelector ? html : html?.[0];
    const immediateButton = root?.querySelector?.('[data-action="chaseImmediateAttack"]');
    if (immediateButton) {
      if (message.getFlag(SYSTEM_ID, "chaseImmediateAttackUsed")) immediateButton.disabled = true;
      immediateButton.addEventListener("click", async () => {
        immediateButton.disabled = true;
        if (!await makeImmediateChaseAttack(message)) immediateButton.disabled = false;
      });
    }
    const button = root?.querySelector?.('[data-action="applyChaseOutcome"]');
    if (!button) return;
    if (!game.user?.isGM || message.getFlag(SYSTEM_ID, CHASE_APPLIED_FLAG)) { button.disabled = true; return; }
    button.addEventListener("click", async () => {
      button.disabled = true;
      if (!await applyChaseOutcome(message, message.getFlag(SYSTEM_ID, "push"))) button.disabled = false;
    });
  });
  Hooks.on("updateSetting", (setting) => {
    if (setting?.key !== `${SYSTEM_ID}.${CHASE_SETTING}`) return;
    for (const actor of game.actors ?? []) if (actor.sheet?.rendered) actor.sheet.render({ force: false });
  });
}
