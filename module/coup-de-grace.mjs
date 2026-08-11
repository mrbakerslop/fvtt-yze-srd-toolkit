import { DICE_SYSTEMS, SPECIALTY_EFFECTS, SYSTEM_ID } from "./constants.mjs";
import { rollDicePool } from "./dice/dice-pool.mjs";
import { rollStepDice } from "./dice/step-dice.mjs";
import { countStateSuccesses } from "./dice/successes.mjs";
import { canSpendActorActions, spendActorActions } from "./combat.mjs";
import {
  getActorBrokenState,
  getCriticalInjuryRestrictions,
  notifyCriticalInjuryRestriction
} from "./critical-injuries.mjs";
import { applyDamage, canUpdateActor } from "./harm.mjs";
import { coupDeGraceEffects, ITEM_EFFECT_TYPES } from "./item-effects.mjs";
import { getAttributeLabels, getDiceSystem } from "./settings.mjs";
import { activeSpecialties } from "./specialties.mjs";

const SOCKET = `system.${SYSTEM_ID}`;
const PUSH_FLAG = "push";

function escape(value) {
  return foundry.utils.escapeHTML(String(value));
}

function primaryActiveGM() {
  return game.users?.filter((user) => user.active && user.isGM)
    .sort((left, right) => Number(right.role) - Number(left.role)
      || left.id.localeCompare(right.id))[0] ?? null;
}

export function canBypassCoupEmpathy(actor) {
  if (coupDeGraceEffects(actor).length > 0) return true;
  return activeSpecialties(actor, SPECIALTY_EFFECTS.MERCILESS).some((item) => (
    !(item.system.effects ?? []).some((effect) => effect.type === ITEM_EFFECT_TYPES.COUP_DE_GRACE)
  ));
}

function isMechanicallyDefenseless(actor) {
  return getActorBrokenState(actor).physical
    || (actor?.system?.combat?.grappled === true && !actor.system.combat.grapplingTargetUuid);
}

async function confirmGMDefenseless(actor, target) {
  const { DialogV2 } = foundry.applications.api;
  return DialogV2.confirm({
    window: { title: game.i18n.localize("YZE.Coup.GMConfirmTitle") },
    content: `<div class="yze"><p>${escape(game.i18n.format("YZE.Coup.GMConfirmHint", {
      actor: actor.name, target: target.name
    }))}</p></div>`,
    modal: true
  });
}

async function confirmCoup(actor, target, { bypass, mechanicallyDefenseless }) {
  const { DialogV2 } = foundry.applications.api;
  return DialogV2.wait({
    window: { title: game.i18n.localize("YZE.Coup.Title") },
    content: `<div class="yze"><p>${escape(game.i18n.format("YZE.Coup.Hint", {
      actor: actor.name,
      target: target.name
    }))}</p>${bypass
      ? `<p class="hint">${escape(game.i18n.localize("YZE.Coup.BypassHint"))}</p>`
      : `<p class="hint">${escape(game.i18n.localize("YZE.Coup.EmpathyHint"))}</p>`}
      ${mechanicallyDefenseless
        ? `<p>${escape(game.i18n.localize("YZE.Coup.MechanicallyDefenseless"))}</p>`
        : `<label class="checkbox-row"><input name="defenseless" type="checkbox"><span>${escape(
          game.i18n.localize("YZE.Coup.ConfirmDefenseless")
        )}</span></label>`}
      <label class="checkbox-row"><input name="confirmKill" type="checkbox"><span>${escape(
        game.i18n.localize("YZE.Coup.ConfirmKill")
      )}</span></label>
      <p class="hint">${escape(game.i18n.localize("YZE.Coup.ColdBloodCost"))}</p></div>`,
    buttons: [{
      action: "continue",
      label: game.i18n.localize("YZE.Coup.Continue"),
      icon: "fa-solid fa-skull",
      default: true,
      callback: (event, button, dialog) => {
        const form = button.form ?? dialog.element.querySelector("form");
        return {
          defenseless: mechanicallyDefenseless || form.elements.defenseless?.checked === true,
          confirmed: form.elements.confirmKill?.checked === true
        };
      }
    }, { action: "cancel", label: game.i18n.localize("YZE.Common.Cancel"), callback: () => null }],
    close: () => null,
    rejectClose: false,
    modal: true
  });
}

async function rollEmpathyOnly(actor) {
  const label = game.i18n.format("YZE.Coup.EmpathyRoll", {
    empathy: getAttributeLabels().empathy
  });
  if (getDiceSystem() === DICE_SYSTEMS.STEP) {
    return rollStepDice({
      actor,
      label,
      attributeKey: "empathy",
      canPush: false,
      canOppose: false,
      attributeRating: actor.system.attributes.empathy.stepRating
    });
  }
  return rollDicePool({
    actor,
    label,
    attributeKey: "empathy",
    canPush: false,
    canOppose: false,
    attributeDice: actor.system.attributes.empathy.value
  });
}

async function killTarget(target, actor) {
  await target.update({ "system.dead": true });
  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    content: `<div class="yze chat-card yze-coup-card"><p>${escape(game.i18n.format(
      "YZE.Coup.Killed", { actor: actor.name, target: target.name }
    ))}</p></div>`
  });
  return true;
}

async function requestGMKill(actor, target, { rollMessageId, bypass, confirmedDefenseless }) {
  const gm = primaryActiveGM();
  if (!gm) return false;
  game.socket.emit(SOCKET, {
    action: "coupDeGraceKill",
    requesterId: game.user.id,
    gmId: gm.id,
    actorUuid: actor.uuid,
    targetUuid: target.uuid,
    rollMessageId,
    bypass,
    confirmedDefenseless
  });
  return true;
}

export async function performCoupDeGrace(actor) {
  if (!actor || actor.type === "vehicle" || actor.system?.dead === true
    || getActorBrokenState(actor).broken) {
    ui.notifications.warn(game.i18n.localize("YZE.Coup.AttackerUnavailable"));
    return false;
  }
  const restrictions = getCriticalInjuryRestrictions(actor);
  if (restrictions.blocksActions) {
    notifyCriticalInjuryRestriction(actor, { kind: "actions", sources: restrictions.actionSources });
    return false;
  }
  const targets = [...(game.user?.targets ?? [])].filter((token) => token.actor);
  if (targets.length !== 1) {
    ui.notifications.warn(game.i18n.localize("YZE.Combat.SelectOneTarget"));
    return false;
  }
  const target = targets[0].actor;
  if (!["character", "npc"].includes(target.type) || target.uuid === actor.uuid
    || target.system?.dead === true) {
    ui.notifications.warn(game.i18n.localize("YZE.Coup.InvalidTarget"));
    return false;
  }
  const gm = primaryActiveGM();
  if (!canUpdateActor(target) && !gm) {
    ui.notifications.warn(game.i18n.localize("YZE.Coup.GMRequired"));
    return false;
  }
  const bypass = canBypassCoupEmpathy(actor);
  const mechanicallyDefenseless = isMechanicallyDefenseless(target);
  if (!mechanicallyDefenseless && !canUpdateActor(target)) {
    ui.notifications.warn(game.i18n.localize("YZE.Coup.GMFictionRequired"));
    return false;
  }
  const confirmation = await confirmCoup(actor, target, { bypass, mechanicallyDefenseless });
  if (!confirmation) return false;
  if (!confirmation.defenseless || !confirmation.confirmed) {
    ui.notifications.warn(game.i18n.localize("YZE.Coup.ConfirmationRequired"));
    return false;
  }
  if (!canSpendActorActions(actor, { slow: 1 })) {
    ui.notifications.warn(game.i18n.localize("YZE.Combat.NotEnoughActions"));
    return false;
  }
  if (!await spendActorActions(actor, { slow: 1 })) return false;

  let rollMessage = null;
  if (!bypass) {
    rollMessage = await rollEmpathyOnly(actor);
    if (!rollMessage) return false;
    const successes = countStateSuccesses(rollMessage.getFlag(SYSTEM_ID, PUSH_FLAG));
    if (successes > 0) {
      await ChatMessage.create({
        speaker: ChatMessage.getSpeaker({ actor }),
        content: `<div class="yze chat-card yze-coup-card"><p>${escape(game.i18n.format(
          "YZE.Coup.Refused", { actor: actor.name, target: target.name }
        ))}</p></div>`
      });
      return false;
    }
  }

  const costApplied = await applyDamage(actor, 1, {
    category: "mental",
    attributeKey: "empathy"
  });
  if (!costApplied) return false;
  if (canUpdateActor(target)) return killTarget(target, actor);
  if (await requestGMKill(actor, target, {
    rollMessageId: rollMessage?.id ?? null,
    bypass,
    confirmedDefenseless: confirmation.defenseless
  })) {
    ui.notifications.info(game.i18n.localize("YZE.Coup.GMRequested"));
    return true;
  }
  return false;
}

async function handleSocket(data) {
  if (data?.action !== "coupDeGraceKill" || !game.user?.isGM
    || primaryActiveGM()?.id !== game.user.id || data.gmId !== game.user.id) return;
  const requester = game.users?.get(data.requesterId);
  const actor = data.actorUuid ? await fromUuid(data.actorUuid) : null;
  const target = data.targetUuid ? await fromUuid(data.targetUuid) : null;
  if (!requester?.active || !actor?.testUserPermission?.(requester, "OWNER")
    || !["character", "npc"].includes(target?.type) || target.system?.dead === true) return;
  if (data.bypass) {
    if (!canBypassCoupEmpathy(actor)) return;
  } else {
    const rollMessage = game.messages?.get(data.rollMessageId);
    const state = rollMessage?.getFlag(SYSTEM_ID, PUSH_FLAG);
    if (!state || state.actorUuid !== actor.uuid || state.attributeKey !== "empathy"
      || countStateSuccesses(state) > 0) return;
  }
  if (!isMechanicallyDefenseless(target)) {
    if (data.confirmedDefenseless !== true || !await confirmGMDefenseless(actor, target)) return;
  }
  await killTarget(target, actor);
}

export function registerCoupDeGraceHooks() {
  Hooks.once("ready", () => game.socket?.on(SOCKET, (data) => {
    handleSocket(data).catch((error) => {
      console.error("YZE System Toolkit | Coup-de-grâce socket request failed", error);
    });
  }));
}
