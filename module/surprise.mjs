import { SYSTEM_ID } from "./constants.mjs";
import { countStateSuccesses } from "./dice/successes.mjs";

const PUSH_FLAG = "push";
const RESOLVED_FLAG = "surpriseResolved";
const PENDING_FLAG = "pendingSneakAttack";

function escape(value) {
  return foundry.utils.escapeHTML(String(value));
}

function namedSkill(actor, name) {
  return actor?.items?.find((item) => item.type === "skill"
    && item.name.localeCompare(name, undefined, { sensitivity: "base" }) === 0) ?? null;
}

function combatantFor(actor, combat = game.combat) {
  if (!actor || !combat) return null;
  return combat.combatants.find((combatant) => (
    combatant.actor?.uuid === actor.uuid
    || (!actor.isToken && combatant.actorId === actor.id)
  )) ?? null;
}

function shuffle(values) {
  const result = [...values];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(Math.random() * (index + 1));
    [result[index], result[swap]] = [result[swap], result[index]];
  }
  return result;
}

async function chooseCard(actor, cards) {
  if (cards.length === 0) return null;
  const options = cards.map((card) => `<option value="${card}">${card}</option>`).join("");
  const { DialogV2 } = foundry.applications.api;
  return DialogV2.wait({
    window: { title: game.i18n.localize("YZE.Surprise.ChooseInitiativeTitle") },
    content: `<div class="yze"><p>${escape(game.i18n.format("YZE.Surprise.ChooseInitiativeHint", {
      actor: actor.name
    }))}</p><div class="form-group"><label>${escape(game.i18n.localize("YZE.Specialty.InitiativeCard"))}</label><select name="card">${options}</select></div></div>`,
    buttons: [{
      action: "choose",
      label: game.i18n.localize("YZE.Common.Continue"),
      icon: "fa-solid fa-hand-pointer",
      default: true,
      callback: (event, button, dialog) => Number(
        (button.form ?? dialog.element.querySelector("form")).elements.card?.value
      ) || cards[0]
    }, {
      action: "cancel",
      label: game.i18n.localize("YZE.Common.Cancel"),
      callback: () => null
    }],
    close: () => null,
    rejectClose: false,
    modal: true
  });
}

async function drawUnrolledInitiative(combat) {
  const ids = [...combat.combatants]
    .filter((combatant) => !Number.isInteger(Number(combatant.initiative)))
    .map((combatant) => combatant.id);
  if (ids.length > 0) await combat.rollInitiative(ids, { updateTurn: false });
}

export async function promptSurpriseInitiative(actor, { drawOthers = true } = {}) {
  const combat = game.combat;
  const combatant = combatantFor(actor, combat);
  if (!combat || !combatant) {
    ui.notifications.warn(game.i18n.localize("YZE.Surprise.CombatantRequired"));
    return null;
  }
  const occupied = new Set([...combat.combatants]
    .filter((entry) => entry.id !== combatant.id)
    .map((entry) => Number(entry.initiative))
    .filter((value) => Number.isInteger(value) && value >= 1 && value <= 10));
  const cards = Array.from({ length: 10 }, (_value, index) => index + 1)
    .filter((card) => !occupied.has(card));
  const card = await chooseCard(actor, cards);
  if (!card) return null;
  await combat.setInitiative(combatant.id, card);
  if (drawOthers && game.user?.isGM) await drawUnrolledInitiative(combat);
  else if (drawOthers) ui.notifications.info(game.i18n.localize("YZE.Surprise.GMDrawsOthers"));
  return card;
}

export function pendingSneakAttack(actor, target = null) {
  const pending = actor?.getFlag?.(SYSTEM_ID, PENDING_FLAG);
  if (!pending?.targetActorUuid) return null;
  if (target && pending.targetActorUuid !== target.uuid) return null;
  return pending;
}

export async function consumeSneakAttack(actor) {
  if (!actor?.getFlag?.(SYSTEM_ID, PENDING_FLAG)) return false;
  await actor.unsetFlag(SYSTEM_ID, PENDING_FLAG);
  return true;
}

export function renderSurpriseControl(state) {
  if (!state?.surprise || state.surprise.kind !== "sneak") return "";
  const successes = countStateSuccesses(state);
  return `<div class="yze-surprise-result${successes > 0 ? " is-success" : " is-failure"}">
    <p>${escape(game.i18n.format(
      successes > 0 ? "YZE.Surprise.SneakRollSucceeded" : "YZE.Surprise.SneakRollFailed",
      { target: state.surprise.targetName }
    ))}</p>
    <button type="button" data-action="resolveSurprise">
      <i class="fa-solid fa-user-secret" aria-hidden="true"></i>
      ${escape(game.i18n.localize("YZE.Surprise.ResolveSneak"))}
    </button>
  </div>`;
}

async function resolveSneakRoll(message, state) {
  if (!state?.surprise || state.superseded || message.getFlag(SYSTEM_ID, RESOLVED_FLAG)) return null;
  const actor = state.actorUuid ? await fromUuid(state.actorUuid) : null;
  if (!actor || (!game.user?.isGM && actor.isOwner === false)) {
    ui.notifications.warn(game.i18n.localize("YZE.Surprise.OwnerRequired"));
    return null;
  }
  const successes = countStateSuccesses(state);
  await message.setFlag(SYSTEM_ID, RESOLVED_FLAG, true);
  if (successes < 1) {
    if (game.combat && game.user?.isGM) await drawUnrolledInitiative(game.combat);
    else if (game.combat) ui.notifications.info(game.i18n.localize("YZE.Surprise.GMDrawsOthers"));
    await ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor }),
      content: `<div class="yze chat-card"><p>${escape(game.i18n.format(
        "YZE.Surprise.SneakDetected", { actor: actor.name, target: state.surprise.targetName }
      ))}</p></div>`
    });
    return false;
  }
  await actor.setFlag(SYSTEM_ID, PENDING_FLAG, {
    targetActorUuid: state.surprise.targetActorUuid,
    targetName: state.surprise.targetName,
    attackKind: state.surprise.attackKind,
    createdAt: Date.now()
  });
  const card = await promptSurpriseInitiative(actor);
  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    content: `<div class="yze chat-card"><p>${escape(game.i18n.format(
      "YZE.Surprise.SneakPrepared", {
        actor: actor.name,
        target: state.surprise.targetName,
        card: card ?? game.i18n.localize("YZE.Surprise.PendingInitiative")
      }
    ))}</p></div>`
  });
  actor.sheet?.render({ force: false });
  return true;
}

async function chooseSneakKind(actor, target) {
  const { DialogV2 } = foundry.applications.api;
  return DialogV2.wait({
    window: { title: game.i18n.localize("YZE.Surprise.SneakAttackTitle") },
    content: `<div class="yze"><p>${escape(game.i18n.format("YZE.Surprise.SneakAttackHint", {
      actor: actor.name, target: target.name
    }))}</p><div class="form-group"><label>${escape(game.i18n.localize("YZE.Combat.AttackType"))}</label><select name="kind"><option value="melee">${escape(game.i18n.localize("YZE.Combat.MeleeAttack"))} (−2)</option><option value="ranged">${escape(game.i18n.localize("YZE.Combat.RangedAttack"))}</option></select></div></div>`,
    buttons: [{
      action: "roll",
      label: game.i18n.localize("YZE.Surprise.RollStealth"),
      icon: "fa-solid fa-user-secret",
      default: true,
      callback: (event, button, dialog) => (
        (button.form ?? dialog.element.querySelector("form")).elements.kind?.value === "ranged"
          ? "ranged" : "melee"
      )
    }, { action: "cancel", label: game.i18n.localize("YZE.Common.Cancel"), callback: () => null }],
    close: () => null,
    rejectClose: false,
    modal: true
  });
}

export async function promptSneakAttack(actor) {
  const targets = [...(game.user?.targets ?? [])].filter((token) => token.actor);
  if (targets.length !== 1) {
    ui.notifications.warn(game.i18n.localize("YZE.Combat.SelectOneTarget"));
    return null;
  }
  const target = targets[0].actor;
  const stealth = namedSkill(actor, "Stealth");
  if (!stealth) {
    ui.notifications.warn(game.i18n.localize("YZE.Surprise.StealthMissing"));
    return null;
  }
  const attackKind = await chooseSneakKind(actor, target);
  if (!attackKind) return null;
  await consumeSneakAttack(actor);
  return actor.rollSkill(stealth.id, {
    canOppose: false,
    allowHelpers: false,
    allowAttemptTracking: false,
    fixedModifiers: attackKind === "melee"
      ? [[game.i18n.localize("YZE.Surprise.CloseApproach"), -2]]
      : [],
    surprise: {
      kind: "sneak",
      targetActorUuid: target.uuid,
      targetName: target.name,
      attackKind
    }
  });
}

async function chooseAmbushPreparation(targetCount) {
  const { DialogV2 } = foundry.applications.api;
  return DialogV2.wait({
    window: { title: game.i18n.localize("YZE.Surprise.AmbushTitle") },
    content: `<div class="yze"><p>${escape(game.i18n.format("YZE.Surprise.AmbushHint", { count: targetCount }))}</p><label class="checkbox-row"><input name="prepared" type="checkbox"><span>${escape(game.i18n.localize("YZE.Surprise.WellPrepared"))}</span></label></div>`,
    buttons: [{
      action: "resolve",
      label: game.i18n.localize("YZE.Surprise.ResolveAmbush"),
      icon: "fa-solid fa-people-arrows",
      default: true,
      callback: (event, button, dialog) => (
        (button.form ?? dialog.element.querySelector("form")).elements.prepared?.checked === true
      )
    }, { action: "cancel", label: game.i18n.localize("YZE.Common.Cancel"), callback: () => null }],
    close: () => null,
    rejectClose: false,
    modal: true
  });
}

export async function promptAmbush(actor) {
  if (!game.user?.isGM) {
    ui.notifications.warn(game.i18n.localize("YZE.Surprise.GMRequired"));
    return null;
  }
  const combat = game.combat;
  if (!combat) {
    ui.notifications.warn(game.i18n.localize("YZE.Surprise.CombatRequired"));
    return null;
  }
  if ([...combat.combatants].some((combatant) => Number.isInteger(Number(combatant.initiative)))) {
    ui.notifications.warn(game.i18n.localize("YZE.Surprise.AmbushNeedsFreshInitiative"));
    return null;
  }
  const targets = [...(game.user?.targets ?? [])]
    .map((token) => token.actor)
    .filter((target) => target && target.uuid !== actor.uuid);
  if (targets.length === 0) {
    ui.notifications.warn(game.i18n.localize("YZE.Surprise.SelectAmbushTargets"));
    return null;
  }
  const victims = targets.map((target) => ({
    actor: target,
    combatant: combatantFor(target, combat),
    skill: namedSkill(target, "Observation")
  }));
  if (victims.some((entry) => !entry.combatant || !entry.skill)) {
    ui.notifications.warn(game.i18n.localize("YZE.Surprise.AmbushTargetInvalid"));
    return null;
  }
  const prepared = await chooseAmbushPreparation(victims.length);
  if (prepared === null) return null;
  const failed = [];
  for (const victim of victims) {
    const message = await victim.actor.rollSkill(victim.skill.id, {
      canPush: false,
      canOppose: false,
      rollType: "passive",
      rollMode: "blindroll",
      forceRollMode: true,
      allowHelpers: false,
      allowAttemptTracking: false,
      fixedModifiers: prepared
        ? [[game.i18n.localize("YZE.Surprise.WellPreparedModifier"), -2]]
        : []
    });
    if (!message) return null;
    if (countStateSuccesses(message.getFlag(SYSTEM_ID, PUSH_FLAG)) < 1) failed.push(victim);
  }
  const bottomCards = shuffle(Array.from({ length: failed.length }, (_value, index) => 10 - index));
  if (failed.length > 0) {
    await combat.updateEmbeddedDocuments("Combatant", failed.map((victim, index) => ({
      _id: victim.combatant.id,
      initiative: bottomCards[index]
    })));
  }
  await drawUnrolledInitiative(combat);
  await ChatMessage.create({
    whisper: game.users.filter((user) => user.isGM).map((user) => user.id),
    content: `<div class="yze chat-card"><p>${escape(game.i18n.format("YZE.Surprise.AmbushResolved", {
      failed: failed.length,
      total: victims.length
    }))}</p></div>`
  });
  return { failed: failed.length, total: victims.length };
}

export function registerSurpriseHooks() {
  Hooks.on("renderChatMessageHTML", (message, html) => {
    const root = html?.querySelector ? html : html?.[0];
    const button = root?.querySelector?.('[data-action="resolveSurprise"]');
    if (!button) return;
    const state = message.getFlag(SYSTEM_ID, PUSH_FLAG);
    button.disabled = Boolean(state?.superseded || message.getFlag(SYSTEM_ID, RESOLVED_FLAG));
    button.addEventListener("click", () => {
      resolveSneakRoll(message, message.getFlag(SYSTEM_ID, PUSH_FLAG))
        .catch((error) => {
          console.error("YZE System Toolkit | Could not resolve surprise", error);
          ui.notifications.error(game.i18n.localize("YZE.Surprise.ResolveFailed"));
        });
    });
  });
}
