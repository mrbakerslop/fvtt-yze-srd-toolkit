import { DICE_SYSTEMS, SYSTEM_ID } from "./constants.mjs";
import { getDiceSystem } from "./settings.mjs";
import { countStateSuccesses } from "./dice/successes.mjs";

function escape(value) {
  return foundry.utils.escapeHTML(String(value));
}

function rating(actor, key) {
  const attribute = actor?.system?.attributes?.[key];
  return getDiceSystem() === DICE_SYSTEMS.STEP
    ? Number(attribute?.stepRating) || 0
    : Number(attribute?.value) || 0;
}

export async function resolveMountRider(mount) {
  if (mount?.type !== "mount" || !mount.system?.riderUuid) return null;
  const rider = await fromUuid(mount.system.riderUuid);
  return ["character", "npc"].includes(rider?.type) ? rider : null;
}

export function mountForRider(rider) {
  if (!rider) return null;
  return game.actors?.find((actor) => (
    actor.type === "mount"
    && actor.system?.riderUuid === rider.uuid
    && actor.system?.perished !== true
  )) ?? null;
}

export async function assignMountRider(mount, riderUuid = "") {
  if (mount?.type !== "mount" || (mount.isOwner === false && !game.user?.isGM)) return false;
  if (riderUuid) {
    for (const other of game.actors?.filter((actor) => (
      actor.type === "mount" && actor.id !== mount.id && actor.system?.riderUuid === riderUuid
    )) ?? []) {
      if (other.isOwner !== false || game.user?.isGM) await other.update({ "system.riderUuid": "" });
    }
  }
  await mount.update({ "system.riderUuid": riderUuid });
  return true;
}

export function mountedRollModifier(rider, mount, attributeKey = "agility") {
  return rating(mount, "agility") - rating(rider, attributeKey);
}

export async function mountMobilityRoll(mount, {
  fixedModifiers = [],
  canPush = true,
  chase = null,
  travel = null,
  purpose = "movement"
} = {}) {
  if (mount?.type !== "mount" || mount.system?.perished === true || mount.system?.lame === true) {
    ui.notifications.warn(game.i18n.localize("YZE.Mount.Unavailable"));
    return null;
  }
  const rider = await resolveMountRider(mount);
  if (!rider) {
    ui.notifications.warn(game.i18n.localize("YZE.Mount.RiderMissing"));
    return null;
  }
  const preferred = String(mount.system.mobilitySkillName || "Mobility");
  const skill = rider.items.find((item) => item.type === "skill"
    && item.name.localeCompare(preferred, undefined, { sensitivity: "base" }) === 0)
    ?? rider.items.find((item) => item.type === "skill");
  if (!skill) {
    ui.notifications.warn(game.i18n.format("YZE.Mount.SkillMissing", { rider: rider.name }));
    return null;
  }
  return rider.rollSkill(skill.id, {
    canPush,
    labelOverride: `${skill.name} (${game.i18n.format("YZE.Mount.UsingAgility", { mount: mount.name })})`,
    attributeOverride: "agility",
    attributeRatingOverride: rating(mount, "agility"),
    fixedModifiers,
    chase,
    travel,
    mount: { mountUuid: mount.uuid, purpose }
  });
}

export async function promptMountedMovement(mount) {
  const rider = await resolveMountRider(mount);
  if (!rider) return mountMobilityRoll(mount);
  const { DialogV2 } = foundry.applications.api;
  const selection = await DialogV2.wait({
    window: { title: game.i18n.localize("YZE.Mount.Movement") },
    content: `<div class="yze"><div class="form-group"><label>${escape(game.i18n.localize("YZE.Mount.ZoneFeature"))}</label><select name="zone"><option value="normal">${escape(game.i18n.localize("YZE.Mount.NormalZone"))}</option><option value="cluttered">${escape(game.i18n.localize("YZE.Mount.ClutteredZone"))}</option><option value="cramped">${escape(game.i18n.localize("YZE.Mount.CrampedZone"))}</option></select></div></div>`,
    buttons: [
      { action: "roll", label: game.i18n.localize("YZE.Roll.Roll"), icon: "fa-solid fa-horse", default: true,
        callback: (event, button, dialog) => (button.form ?? dialog.element.querySelector("form")).elements.zone?.value },
      { action: "cancel", label: game.i18n.localize("YZE.Common.Cancel"), callback: () => null }
    ],
    close: () => null, rejectClose: false, modal: true
  });
  if (!selection) return null;
  if (selection === "cramped") {
    ui.notifications.warn(game.i18n.localize("YZE.Mount.CannotEnterCramped"));
    return null;
  }
  const { canSpendActorActions, spendActorActions } = await import("./combat.mjs");
  if (!canSpendActorActions(rider, { fast: 1 })) {
    ui.notifications.warn(game.i18n.localize("YZE.Combat.NotEnoughActions"));
    return null;
  }
  const message = await mountMobilityRoll(mount, { purpose: selection });
  if (message) {
    await spendActorActions(rider, { fast: 1 });
    const successes = countStateSuccesses(message.getFlag(SYSTEM_ID, "push"));
    const allowedZones = selection === "cluttered" ? 1 : 1 + successes;
    await rider.setFlag(SYSTEM_ID, "mountedMovement", {
      mountUuid: mount.uuid,
      combatId: game.combat?.id ?? "",
      round: Number(game.combat?.round) || 0,
      sceneId: canvas?.scene?.id ?? "",
      allowedZones
    });
    ui.notifications.info(game.i18n.format("YZE.Mount.ExtraMovePrepared", {
      rider: rider.name, zones: allowedZones
    }));
  }
  if (message && selection === "cluttered") {
    ui.notifications.info(game.i18n.localize("YZE.Mount.ClutteredLimit"));
  }
  return message;
}

export async function restMount(mount) {
  if (mount?.type !== "mount" || (mount.isOwner === false && !game.user?.isGM)) return false;
  const day = Math.max(1, Number(game.settings.get(SYSTEM_ID, "travelDay")) || 1);
  const state = foundry.utils.deepClone(mount.getFlag(SYSTEM_ID, "mountedTravel") ?? {});
  state.day = day;
  state.rested = true;
  state.needsRest = false;
  await mount.setFlag(SYSTEM_ID, "mountedTravel", state);
  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor: mount }),
    content: `<div class="yze chat-card"><p>${escape(game.i18n.format("YZE.Mount.RestComplete", { mount: mount.name }))}</p></div>`
  });
  return true;
}

export function registerMountHooks() {
  Hooks.on("createChatMessage", async (message) => {
    const state = message.getFlag?.(SYSTEM_ID, "push");
    if (message.author?.id !== game.user?.id || state?.pushed !== true
      || !["normal", "cluttered"].includes(state.mount?.purpose)) return;
    const rider = state.actorUuid ? await fromUuid(state.actorUuid) : null;
    const mount = state.mount?.mountUuid ? await fromUuid(state.mount.mountUuid) : null;
    if (!rider || mountForRider(rider)?.uuid !== mount?.uuid || rider.isOwner === false) return;
    const successes = countStateSuccesses(state);
    const allowedZones = state.mount.purpose === "cluttered" ? 1 : 1 + successes;
    await rider.setFlag(SYSTEM_ID, "mountedMovement", {
      mountUuid: mount.uuid,
      combatId: game.combat?.id ?? "",
      round: Number(game.combat?.round) || 0,
      sceneId: canvas?.scene?.id ?? "",
      allowedZones
    });
    ui.notifications.info(game.i18n.format("YZE.Mount.ExtraMoveUpdated", { zones: allowedZones }));
  });
}
