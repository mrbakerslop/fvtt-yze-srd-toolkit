import {
  CRITICAL_INJURY_TRIGGERS,
  SPECIALTY_EFFECTS,
  SYSTEM_ID
} from "./constants.mjs";
import {
  getCriticalInjuryTrigger,
  isCriticalInjuriesEnabled
} from "./settings.mjs";
import {
  getCriticalInjuryWeaponRestriction,
  notifyCriticalInjuryRestriction,
  rollCriticalInjury
} from "./critical-injuries.mjs";
import {
  applyDamage,
  canUpdateActor,
  promptProtection,
  rollCover,
  rollArmor
} from "./harm.mjs";
import { countStateSuccesses } from "./dice/successes.mjs";
import { canSpendActorActions, spendActorActions } from "./combat.mjs";
import { linkOpposedRolls } from "./dice/opposed.mjs";
import { activeSpecialties, hasSpecialty } from "./specialties.mjs";
import { hitInterceptionEffects, ITEM_EFFECT_TYPES } from "./item-effects.mjs";
import { activeTokenForActor, rangeBetweenTokens } from "./zones.mjs";

const PUSH_FLAG = "push";
const APPLIED_FLAG = "attackApplied";
const INTERCEPTION_RESOLVED_FLAG = "interceptionResolved";

function escape(value) {
  return foundry.utils.escapeHTML(String(value));
}

function primaryActiveGM() {
  return game.users?.filter((user) => user.active && user.isGM)
    .sort((left, right) => Number(right.role) - Number(left.role) || left.id.localeCompare(right.id))[0] ?? null;
}

function sameActor(left, right) {
  if (!left || !right) return false;
  return left.uuid === right.uuid || (!left.isToken && !right.isToken && left.id === right.id);
}

function normalized(value) {
  return String(value ?? "").trim().toLocaleLowerCase();
}

function activeSceneActors() {
  const scene = globalThis.canvas?.scene ?? game.scenes?.current;
  if (!scene) return [];
  const actors = globalThis.canvas?.ready && globalThis.canvas?.scene?.id === scene.id
    ? globalThis.canvas.tokens?.placeables?.map((token) => token.actor) ?? []
    : [...(scene.tokens ?? [])].map((token) => token.actor);
  return actors.filter(Boolean);
}

function interceptionSkill(actor) {
  for (const effect of hitInterceptionEffects(actor)) {
    const skillName = normalized(effect.target);
    const skill = actor.items.find((item) => item.type === "skill"
      && normalized(item.name) === skillName);
    if (skill) return skill;
    const defaultSkill = actor.items.find((item) => item.type === "skill"
      && normalized(item.name) === "mobility");
    if (defaultSkill) return defaultSkill;
  }
  const legacyBodyguard = activeSpecialties(actor, SPECIALTY_EFFECTS.BODYGUARD).some((item) => (
    !(item.system.effects ?? []).some((effect) => effect.type === ITEM_EFFECT_TYPES.HIT_INTERCEPTION)
  ));
  return legacyBodyguard
    ? actor.items.find((item) => item.type === "skill" && normalized(item.name) === "mobility") ?? null
    : null;
}

function canInterceptHits(actor) {
  return Boolean(interceptionSkill(actor));
}

function bodyguardCandidates(target, attacker) {
  const unique = new Map();
  const targetToken = activeTokenForActor(target);
  for (const actor of activeSceneActors()) {
    if (!actor || !["character", "npc"].includes(actor.type)
      || sameActor(actor, target) || sameActor(actor, attacker)
      || actor.system?.dead === true
      || !canInterceptHits(actor)
      || (!game.user?.isGM && actor.isOwner === false)) continue;
    const skill = interceptionSkill(actor);
    if (!skill || unique.has(actor.uuid)) continue;
    const actorToken = targetToken ? activeTokenForActor(actor) : null;
    const spatial = actorToken && targetToken ? rangeBetweenTokens(actorToken, targetToken) : null;
    const rangeVerified = spatial?.configured
      ? ["engaged", "short"].includes(spatial.range) && spatial.visible && spatial.reachable
      : null;
    if (rangeVerified === false) continue;
    unique.set(actor.uuid, { actor, skill, rangeVerified });
  }
  return [...unique.values()].sort((left, right) => left.actor.name.localeCompare(right.actor.name));
}

async function chooseBodyguard(candidates, target) {
  if (candidates.length === 0) {
    ui.notifications.warn(game.i18n.localize("YZE.Bodyguard.NoneAvailable"));
    return null;
  }
  const options = candidates.map((entry) => (
    `<option value="${escape(entry.actor.uuid)}">${escape(entry.actor.name)}</option>`
  )).join("");
  const { DialogV2 } = foundry.applications.api;
  const selection = await DialogV2.wait({
    window: { title: game.i18n.localize("YZE.Bodyguard.Title") },
    content: `<div class="yze"><p>${escape(game.i18n.format("YZE.Bodyguard.Hint", {
      target: target.name
    }))}</p><div class="form-group"><label>${escape(game.i18n.localize("YZE.Bodyguard.Interceptor"))}</label><select name="actor">${options}</select></div>${candidates.some((entry) => entry.rangeVerified == null) ? `<label class="checkbox-row"><input name="withinRange" type="checkbox"><span>${escape(game.i18n.localize("YZE.Bodyguard.WithinShortRange"))}</span></label>` : ""}</div>`,
    buttons: [{
      action: "roll",
      label: game.i18n.localize("YZE.Bodyguard.RollMobility"),
      icon: "fa-solid fa-person-running",
      default: true,
      callback: (event, button, dialog) => {
        const form = button.form ?? dialog.element.querySelector("form");
        const candidate = candidates.find((entry) => entry.actor.uuid === form.elements.actor?.value) ?? null;
        if (candidate?.rangeVerified == null && form.elements.withinRange?.checked !== true) return false;
        return candidate;
      }
    }, { action: "cancel", label: game.i18n.localize("YZE.Common.Cancel"), callback: () => null }],
    close: () => null,
    rejectClose: false,
    modal: true
  });
  if (selection === false) {
    ui.notifications.warn(game.i18n.localize("YZE.Bodyguard.RangeRequired"));
    return null;
  }
  return selection;
}

async function setAttackInterception(message, update) {
  const state = message?.getFlag(SYSTEM_ID, PUSH_FLAG);
  if (!state?.attack || message.getFlag(SYSTEM_ID, APPLIED_FLAG)) return false;
  await message.setFlag(SYSTEM_ID, PUSH_FLAG, {
    ...state,
    canPush: false,
    attack: {
      ...state.attack,
      targetActorUuid: update.targetActorUuid ?? state.attack.targetActorUuid,
      targetName: update.targetName ?? state.attack.targetName,
      interception: {
        ...(state.attack.interception ?? {}),
        ...update.interception
      }
    }
  });
  return true;
}

async function chooseBlockingWeapon(actor, armedAttack) {
  if (!armedAttack) return null;
  const weapons = actor.items.filter((item) => ["weapon", "gear"].includes(item.type)
    && item.system.equipped === true && Number(item.system.quantity) > 0
    && (item.type === "gear" || String(item.system.grip || "").trim()));
  if (weapons.length === 0) return false;
  if (weapons.length === 1) return weapons[0];
  const options = weapons.map((weapon) => `<option value="${escape(weapon.id)}">${escape(weapon.name)}</option>`).join("");
  const { DialogV2 } = foundry.applications.api;
  const id = await DialogV2.wait({
    window: { title: game.i18n.localize("YZE.Combat.BlockAttack") },
    content: `<div class="yze"><div class="form-group"><label>${escape(game.i18n.localize("YZE.Combat.BlockingWeapon"))}</label><select name="weapon">${options}</select></div></div>`,
    buttons: [{
      action: "block", label: game.i18n.localize("YZE.Combat.BlockAttack"), default: true,
      callback: (event, button, dialog) => (button.form ?? dialog.element.querySelector("form")).elements.weapon?.value
    }, { action: "cancel", label: game.i18n.localize("YZE.Common.Cancel"), callback: () => null }],
    close: () => null, rejectClose: false, modal: true
  });
  return id ? actor.items.get(id) : null;
}

export async function blockAttack(message, state) {
  if (!state?.attack || state.attack.kind !== "melee" || state.attack.blockable === false
    || message.getFlag(SYSTEM_ID, "opposed")?.opponentMessageId) return false;
  const defender = await fromUuid(state.attack.targetActorUuid);
  if (!defender || (!game.user?.isGM && defender.isOwner === false)) {
    ui.notifications.warn(game.i18n.localize("YZE.Combat.TargetOwnerBlocks"));
    return false;
  }
  if (!game.user?.isGM && !message.isOwner && !primaryActiveGM()) {
    ui.notifications.warn(game.i18n.localize("YZE.Combat.GMRequiredToLinkBlock"));
    return false;
  }
  if (!canSpendActorActions(defender, { fast: 1 })) return false;
  const skill = defender.items.find((item) => item.type === "skill"
    && item.name.localeCompare("Melee", undefined, { sensitivity: "base" }) === 0);
  if (!skill) {
    ui.notifications.warn(game.i18n.localize("YZE.Combat.MeleeSkillMissing"));
    return false;
  }
  const blockingWeapon = await chooseBlockingWeapon(defender, state.attack.armed === true);
  if (blockingWeapon === false) {
    ui.notifications.warn(game.i18n.localize("YZE.Combat.ArmedBlockRequiresWeapon"));
    return false;
  }
  if (blockingWeapon) {
    const injuryRestriction = getCriticalInjuryWeaponRestriction(defender, blockingWeapon);
    if (injuryRestriction) {
      notifyCriticalInjuryRestriction(defender, injuryRestriction);
      return false;
    }
  }
  const flyweight = hasSpecialty(defender, SPECIALTY_EFFECTS.FLYWEIGHT);
  const opponentMessage = await defender.rollSkill(skill.id, {
    canPush: false,
    canOppose: false,
    helpAction: "fast",
    excludedHelperUuids: [state.attack.attackerActorUuid],
    attributeOverride: flyweight ? "agility" : null,
    fixedModifiers: flyweight
      ? [[game.i18n.localize("YZE.Specialty.Effects.flyweight"), 0]]
      : []
  });
  if (!opponentMessage) return false;
  if (!await spendActorActions(defender, { fast: 1 })) return false;
  const opponentState = opponentMessage.getFlag(SYSTEM_ID, PUSH_FLAG);
  if (game.user?.isGM || message.isOwner) {
    await linkOpposedRolls(message, state, opponentMessage, opponentState);
  } else {
    game.socket.emit(`system.${SYSTEM_ID}`, {
      action: "linkBlock",
      activeMessageId: message.id,
      opponentMessageId: opponentMessage.id,
      userId: game.user.id
    });
  }
  return true;
}

export function attackSuccesses(state) {
  return countStateSuccesses(state);
}

export function ammunitionSuccesses(state) {
  return (state?.dice ?? []).reduce((total, die) => {
    if (die.category !== "ammo") return total;
    return total + (Number(die.result) === 6 ? 1 : 0);
  }, 0);
}

export function attackDamage(state) {
  const successes = attackSuccesses(state);
  if (!state?.attack || successes < 1) return 0;
  return Math.max(0, Math.trunc(Number(state.attack.baseDamage) || 0))
    + successes - 1 + ammunitionSuccesses(state);
}

export function renderAttackControl(state) {
  if (state?.interception) {
    const successes = countStateSuccesses(state);
    return `<div class="yze-bodyguard-result${successes > 0 ? " is-success" : " is-failure"}">
      <p>${escape(game.i18n.format(
        successes > 0 ? "YZE.Bodyguard.RollSucceeded" : "YZE.Bodyguard.RollFailed",
        { bodyguard: state.actorName, target: state.interception.originalTargetName }
      ))}</p>
      <button type="button" data-action="resolveInterception">
        <i class="fa-solid fa-shield-heart" aria-hidden="true"></i>
        ${escape(game.i18n.localize("YZE.Bodyguard.Resolve"))}
      </button>
    </div>`;
  }
  if (!state?.attack) return "";
  const successes = attackSuccesses(state);
  const damage = attackDamage(state);
  const ammoSuccesses = ammunitionSuccesses(state);
  const special = String(state.attack.special || "damage");
  const result = successes > 0
    ? (!["damage", "grappleStrike"].includes(special)
      ? game.i18n.format("YZE.Combat.SpecialAttackHit", { target: state.attack.targetName })
      : game.i18n.format("YZE.Combat.AttackHit", {
        target: state.attack.targetName,
        weapon: state.attack.weaponName,
        damage
      }))
    : game.i18n.format("YZE.Combat.AttackMiss", { target: state.attack.targetName });
  return `
    <div class="yze-attack-result${successes > 0 ? " is-hit" : " is-miss"}">
      <p>${escape(result)}</p>
      ${successes > 0 ? `
        <button type="button" data-action="applyAttackDamage">
          <i class="fa-solid fa-heart-crack" aria-hidden="true"></i>
          ${escape(game.i18n.localize(special === "damage" || special === "grappleStrike"
            ? "YZE.Combat.ApplyDamage"
            : "YZE.Combat.ResolveSpecialAttack"))}
        </button>` : ""}
      ${successes > 0 && special === "damage"
        && !state.attack.interception ? `
        <button type="button" data-action="interceptAttack">
          <i class="fa-solid fa-shield-heart" aria-hidden="true"></i>
          ${escape(game.i18n.localize("YZE.Bodyguard.Intercept"))}
        </button>` : ""}
      ${state.attack.kind === "melee" && state.attack.blockable !== false && successes > 0 ? `
        <button type="button" data-action="blockAttack">
          <i class="fa-solid fa-shield" aria-hidden="true"></i>
          ${escape(game.i18n.localize("YZE.Combat.BlockAttack"))}
        </button>` : ""}
      ${ammoSuccesses > 0 ? `<p>${escape(game.i18n.format("YZE.Combat.AmmoSuccesses", { count: ammoSuccesses }))}</p>` : ""}
      ${["damage", "grappleStrike"].includes(special)
        ? `<p class="hint">${escape(game.i18n.localize("YZE.Combat.UnarmoredDamageHint"))}</p>`
        : ""}
    </div>`;
}

async function resolveSpecialAttack(state, attacker, target) {
  const special = String(state.attack.special || "damage");
  if (special === "trip") {
    await target.update({ "system.combat.prone": true });
  } else if (special === "disarm") {
    const held = target.items.filter((item) => item.type === "weapon"
      && item.system.equipped === true && String(item.system.grip || "").trim());
    if (held.length > 0) {
      let weapon = held[0];
      if (held.length > 1) {
        const options = held.map((item) => `<option value="${escape(item.id)}">${escape(item.name)}</option>`).join("");
        const { DialogV2 } = foundry.applications.api;
        const id = await DialogV2.wait({
          window: { title: game.i18n.localize("YZE.Combat.SpecialAttacks.disarm") },
          content: `<div class="yze"><select name="weapon">${options}</select></div>`,
          buttons: [{ action: "disarm", label: game.i18n.localize("YZE.Combat.ResolveSpecialAttack"), default: true,
            callback: (event, button, dialog) => (button.form ?? dialog.element.querySelector("form")).elements.weapon?.value }],
          close: () => null, rejectClose: false, modal: true
        });
        weapon = target.items.get(id) ?? null;
      }
      if (weapon) await weapon.update({ "system.equipped": false });
    }
  } else if (special === "grapple") {
    const targetWeapons = target.items.filter((item) => item.type === "weapon"
      && item.system.equipped === true && String(item.system.grip || "").trim());
    if (targetWeapons.length > 0) {
      await target.updateEmbeddedDocuments("Item", targetWeapons.map((item) => ({
        _id: item.id,
        "system.equipped": false
      })));
    }
    await target.update({
      "system.combat.prone": true,
      "system.combat.grappled": true,
      "system.combat.grapplerUuid": attacker?.uuid ?? ""
    });
    if (attacker && canUpdateActor(attacker)) {
      await attacker.update({
        "system.combat.prone": true,
        "system.combat.grappled": true,
        "system.combat.grapplingTargetUuid": target.uuid
      });
    }
  }
  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor: target }),
    content: `<div class="yze chat-card"><p>${escape(game.i18n.format(
      `YZE.Combat.SpecialAttackResults.${special}`,
      { attacker: attacker?.name ?? "", target: target.name }
    ))}</p></div>`
  });
}

async function promptAmmoAllocation(state, primaryTarget) {
  const successes = ammunitionSuccesses(state);
  if (successes < 1) return { primaryBonus: 0, additionalTarget: primaryTarget };
  const targets = new Map([[primaryTarget.uuid, primaryTarget]]);
  for (const token of game.user?.targets ?? []) {
    if (token.actor) targets.set(token.actor.uuid, token.actor);
  }
  const options = [...targets.values()].map((actor) => (
    `<option value="${escape(actor.uuid)}">${escape(actor.name)}</option>`
  )).join("");
  const { DialogV2 } = foundry.applications.api;
  const result = await DialogV2.wait({
    window: { title: game.i18n.localize("YZE.Combat.AllocateAmmoSuccesses") },
    content: `<div class="yze"><p>${escape(game.i18n.format("YZE.Combat.AllocateAmmoHint", { count: successes }))}</p><div class="form-group"><label>${escape(game.i18n.localize("YZE.Combat.PrimaryDamageBonus"))}</label><input name="bonus" type="number" value="${successes}" min="0" max="${successes}"></div><div class="form-group"><label>${escape(game.i18n.localize("YZE.Combat.AdditionalHitTarget"))}</label><select name="target">${options}</select></div></div>`,
    buttons: [{
      action: "allocate", label: game.i18n.localize("YZE.Common.Continue"), default: true,
      callback: (event, button, dialog) => {
        const form = button.form ?? dialog.element.querySelector("form");
        return {
          primaryBonus: Math.max(0, Math.min(successes, Math.trunc(Number(form.elements.bonus?.value) || 0))),
          targetUuid: form.elements.target?.value
        };
      }
    }],
    close: () => ({ primaryBonus: successes, targetUuid: primaryTarget.uuid }),
    rejectClose: false,
    modal: true
  });
  return {
    primaryBonus: result.primaryBonus,
    additionalTarget: targets.get(result.targetUuid) ?? primaryTarget
  };
}

export async function startBodyguardInterception(message, state) {
  if (!state?.attack || state.superseded || message.getFlag(SYSTEM_ID, APPLIED_FLAG)
    || state.attack.interception || (state.attack.special ?? "damage") !== "damage") {
    return false;
  }
  const opposed = message.getFlag(SYSTEM_ID, "opposed");
  const opponentMessage = opposed?.opponentMessageId
    ? game.messages?.get(opposed.opponentMessageId)
    : null;
  const netSuccesses = Math.max(
    0,
    attackSuccesses(state) - attackSuccesses(opponentMessage?.getFlag(SYSTEM_ID, PUSH_FLAG))
  );
  if (netSuccesses < 1) {
    ui.notifications.warn(game.i18n.localize("YZE.Bodyguard.NoHit"));
    return false;
  }
  const target = await fromUuid(state.attack.targetActorUuid);
  const attacker = state.attack.attackerActorUuid ? await fromUuid(state.attack.attackerActorUuid) : null;
  if (!target || ["vehicle", "mount"].includes(target.type)) return false;
  const selection = await chooseBodyguard(bodyguardCandidates(target, attacker), target);
  if (!selection) return false;
  const rollMessage = await selection.actor.rollSkill(selection.skill.id, {
    canOppose: false,
    allowHelpers: false,
    allowAttemptTracking: false,
    interception: {
      attackMessageId: message.id,
      originalTargetActorUuid: target.uuid,
      originalTargetName: target.name,
      attackerActorUuid: state.attack.attackerActorUuid
    }
  });
  if (!rollMessage) return false;
  const update = {
    interception: {
      status: "pending",
      bodyguardActorUuid: selection.actor.uuid,
      bodyguardName: selection.actor.name,
      rollMessageId: rollMessage.id,
      originalTargetActorUuid: target.uuid,
      originalTargetName: target.name
    }
  };
  if (game.user?.isGM || message.isOwner) {
    const linked = await setAttackInterception(message, update);
    if (linked) await rollMessage.setFlag(SYSTEM_ID, "interceptionLinked", true);
    return linked;
  }
  const gm = primaryActiveGM();
  if (!gm) {
    ui.notifications.warn(game.i18n.localize("YZE.Bodyguard.GMRequired"));
    return false;
  }
  game.socket.emit(`system.${SYSTEM_ID}`, {
    action: "startBodyguardInterception",
    attackMessageId: message.id,
    rollMessageId: rollMessage.id,
    bodyguardActorUuid: selection.actor.uuid,
    requesterId: game.user.id
  });
  return true;
}

async function finalizeInterception(attackMessage, rollMessage, rollState) {
  const attackState = attackMessage?.getFlag(SYSTEM_ID, PUSH_FLAG);
  const pending = attackState?.attack?.interception;
  if (!pending || pending.status !== "pending" || pending.rollMessageId !== rollMessage.id
    || pending.bodyguardActorUuid !== rollState.actorUuid) return false;
  const succeeded = countStateSuccesses(rollState) > 0;
  const update = {
    ...(succeeded ? {
      targetActorUuid: rollState.actorUuid,
      targetName: rollState.actorName
    } : {}),
    interception: {
      ...pending,
      status: succeeded ? "succeeded" : "failed",
      successes: countStateSuccesses(rollState)
    }
  };
  if (!await setAttackInterception(attackMessage, update)) return false;
  await rollMessage.setFlag(SYSTEM_ID, INTERCEPTION_RESOLVED_FLAG, true);
  const currentRollState = rollMessage.getFlag(SYSTEM_ID, PUSH_FLAG);
  if (currentRollState) {
    await rollMessage.setFlag(SYSTEM_ID, PUSH_FLAG, { ...currentRollState, canPush: false });
  }
  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor: await fromUuid(rollState.actorUuid) }),
    content: `<div class="yze chat-card"><p>${escape(game.i18n.format(
      succeeded ? "YZE.Bodyguard.Intercepted" : "YZE.Bodyguard.NotIntercepted",
      { bodyguard: rollState.actorName, target: pending.originalTargetName }
    ))}</p></div>`
  });
  return true;
}

export async function resolveBodyguardInterception(message, state) {
  if (!state?.interception || state.superseded
    || !message.getFlag(SYSTEM_ID, "interceptionLinked")
    || message.getFlag(SYSTEM_ID, INTERCEPTION_RESOLVED_FLAG)) return false;
  const bodyguard = state.actorUuid ? await fromUuid(state.actorUuid) : null;
  if (!bodyguard || (!game.user?.isGM && bodyguard.isOwner === false)) {
    ui.notifications.warn(game.i18n.localize("YZE.Bodyguard.OwnerRequired"));
    return false;
  }
  const attackMessage = game.messages?.get(state.interception.attackMessageId);
  if (!attackMessage) return false;
  if (game.user?.isGM || attackMessage.isOwner) {
    return finalizeInterception(attackMessage, message, state);
  }
  const gm = primaryActiveGM();
  if (!gm) {
    ui.notifications.warn(game.i18n.localize("YZE.Bodyguard.GMRequired"));
    return false;
  }
  await message.setFlag(SYSTEM_ID, INTERCEPTION_RESOLVED_FLAG, true);
  await message.setFlag(SYSTEM_ID, PUSH_FLAG, { ...state, canPush: false });
  game.socket.emit(`system.${SYSTEM_ID}`, {
    action: "resolveBodyguardInterception",
    attackMessageId: attackMessage.id,
    rollMessageId: message.id,
    requesterId: game.user.id
  });
  return true;
}

export async function refreshInterceptionAfterPush(originalMessage, pushedMessage, pushedState) {
  if (!pushedState?.interception) return null;
  const attackMessage = game.messages?.get(pushedState.interception.attackMessageId);
  const attackState = attackMessage?.getFlag(SYSTEM_ID, PUSH_FLAG);
  const pending = attackState?.attack?.interception;
  if (!pending || pending.status !== "pending" || pending.rollMessageId !== originalMessage.id) {
    return null;
  }
  const linked = await setAttackInterception(attackMessage, {
    interception: { ...pending, rollMessageId: pushedMessage.id }
  });
  if (linked) await pushedMessage.setFlag(SYSTEM_ID, "interceptionLinked", true);
  return linked ? pushedMessage : null;
}

async function applyAdditionalAmmoHits(state, target, count) {
  let applied = 0;
  const baseDamage = Math.max(0, Math.trunc(Number(state.attack.baseDamage) || 0));
  if (baseDamage < 1 || count < 1 || !canUpdateActor(target)) return applied;
  for (let index = 0; index < count; index += 1) {
    const protection = await promptProtection(target, baseDamage, { ranged: true });
    if (!protection) break;
    const cover = await rollCover(target, protection.damage, { useCover: protection.useCover });
    const armor = await rollArmor(target, cover.penetrating, protection.armorId);
    if (armor.penetrating > 0) {
      await applyDamage(target, armor.penetrating, {
        category: "physical",
        attributeKey: "strength",
        vehicleCriticalFaces: 12,
        sourceActorUuid: state.attack.attackerActorUuid
      });
    }
    applied += 1;
  }
  if (applied > 0) {
    await ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor: target }),
      content: `<div class="yze chat-card"><p>${escape(game.i18n.format("YZE.Combat.AdditionalHitsApplied", {
        count: applied, target: target.name
      }))}</p></div>`
    });
  }
  return applied;
}

export async function applyAttackDamage(message, state) {
  if (!state?.attack || state.superseded || message.getFlag(SYSTEM_ID, APPLIED_FLAG)) return false;
  if (state.attack.interception?.status === "pending") {
    ui.notifications.warn(game.i18n.localize("YZE.Bodyguard.Pending"));
    return false;
  }
  const opposed = message.getFlag(SYSTEM_ID, "opposed");
  const opponentMessage = opposed?.opponentMessageId
    ? game.messages?.get(opposed.opponentMessageId)
    : null;
  const opponentState = opponentMessage?.getFlag(SYSTEM_ID, PUSH_FLAG);
  const netSuccesses = Math.max(0, attackSuccesses(state) - attackSuccesses(opponentState));
  const ammoSuccesses = ammunitionSuccesses(state);
  const baseRawDamage = netSuccesses > 0
    ? Math.max(0, Math.trunc(Number(state.attack.baseDamage) || 0)) + netSuccesses - 1
    : 0;
  const special = String(state.attack.special || "damage");
  if (netSuccesses < 1) {
    ui.notifications.warn(game.i18n.localize("YZE.Combat.AttackNegated"));
    return false;
  }
  const target = await fromUuid(state.attack.targetActorUuid);
  if (!target?.system) {
    ui.notifications.error(game.i18n.localize("YZE.Combat.AttackTargetMissing"));
    return false;
  }
  if (!canUpdateActor(target)) {
    ui.notifications.warn(game.i18n.localize("YZE.Combat.GMApplyDamage"));
    return false;
  }
  if (state.attack.kind === "melee" && target.system?.combat?.overwatch?.active === true) {
    await target.update({
      "system.combat.overwatch.active": false,
      "system.combat.overwatch.direction": "",
      "system.combat.overwatch.weaponItemId": ""
    });
  }

  const attacker = state.attack.attackerActorUuid
    ? await fromUuid(state.attack.attackerActorUuid)
    : null;
  if (!["damage", "grappleStrike"].includes(special)) {
    await resolveSpecialAttack(state, attacker, target);
    await message.setFlag(SYSTEM_ID, APPLIED_FLAG, true);
    const current = message.getFlag(SYSTEM_ID, PUSH_FLAG);
    if (current) await message.setFlag(SYSTEM_ID, PUSH_FLAG, { ...current, canPush: false });
    return true;
  }
  const allocation = state.attack.kind === "ranged"
    ? await promptAmmoAllocation(state, target)
    : { primaryBonus: 0, additionalTarget: target };
  const rawDamage = baseRawDamage + allocation.primaryBonus;
  if (rawDamage < 1) return false;

  const protection = await promptProtection(target, rawDamage, {
    ranged: state.attack.kind === "ranged"
  });
  if (!protection) return false;
  const cover = await rollCover(target, protection.damage, {
    useCover: state.attack.kind === "ranged" && protection.useCover
  });
  const armor = await rollArmor(target, cover.penetrating, protection.armorId);
  const damage = armor.penetrating;
  if (damage > 0) {
    const applied = await applyDamage(target, damage, {
      category: "physical",
      attributeKey: "strength",
      vehicleCriticalFaces: state.attack.kind === "melee" ? 6 : 12,
      sourceActorUuid: state.attack.attackerActorUuid
    });
    if (applied === false) return false;
  }
  if (state.attack.divingBlow === true) {
    await target.update({ "system.combat.prone": true });
  }
  const additionalHits = Math.max(0, ammoSuccesses - allocation.primaryBonus);
  if (additionalHits > 0) {
    await applyAdditionalAmmoHits(state, allocation.additionalTarget, additionalHits);
  }
  let criticalInjury = false;
  if (!["vehicle", "mount"].includes(target.type) && isCriticalInjuriesEnabled()) {
    const trigger = getCriticalInjuryTrigger();
    const threshold = Math.max(0, Math.trunc(Number(state.attack.critThreshold) || 0));
    const triggeredByDamage = trigger === CRITICAL_INJURY_TRIGGERS.DAMAGE_THRESHOLD
      && threshold > 0 && damage >= threshold;
    const triggeredBySuccesses = trigger === CRITICAL_INJURY_TRIGGERS.SUCCESS_THRESHOLD
      && netSuccesses >= 2;
    if (triggeredByDamage || triggeredBySuccesses) {
      await rollCriticalInjury(target, "physical", {
        formula: state.attack.critFormula,
        sourceActor: attacker
      });
      criticalInjury = true;
    }
  }
  await message.setFlag(SYSTEM_ID, APPLIED_FLAG, true);
  const current = message.getFlag(SYSTEM_ID, PUSH_FLAG);
  if (current) await message.setFlag(SYSTEM_ID, PUSH_FLAG, { ...current, canPush: false });
  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor: target }),
    content: `<div class="yze chat-card yze-damage-card"><p>${escape(game.i18n.format("YZE.Combat.DamageApplied", {
      target: target.name,
      damage,
      weapon: state.attack.weaponName
    }))}</p>${armor.absorbed > 0
      ? `<p>${escape(game.i18n.format("YZE.Armor.Absorbed", { amount: armor.absorbed }))}</p>`
      : ""}${cover.absorbed > 0
      ? `<p>${escape(game.i18n.format("YZE.Cover.Absorbed", { amount: cover.absorbed }))}</p>`
      : ""}${criticalInjury
        ? `<p>${escape(game.i18n.localize("YZE.CriticalInjury.AttackTriggered"))}</p>`
        : ""}</div>`
  });
  return true;
}

export function registerAttackChatHook() {
  Hooks.once("ready", () => {
    game.socket.on(`system.${SYSTEM_ID}`, async (data) => {
      if (!data || primaryActiveGM()?.id !== game.user?.id) return;
      if (data.action === "linkBlock") {
        const activeMessage = game.messages?.get(data.activeMessageId);
        const opponentMessage = game.messages?.get(data.opponentMessageId);
        const activeState = activeMessage?.getFlag(SYSTEM_ID, PUSH_FLAG);
        const opponentState = opponentMessage?.getFlag(SYSTEM_ID, PUSH_FLAG);
        const user = game.users?.get(data.userId);
        const defender = activeState?.attack?.targetActorUuid
          ? await fromUuid(activeState.attack.targetActorUuid)
          : null;
        if (!activeMessage || !opponentMessage || !activeState || !opponentState || !user
          || !defender?.testUserPermission?.(user, "OWNER")) return;
        await linkOpposedRolls(activeMessage, activeState, opponentMessage, opponentState);
        return;
      }
      if (data.action === "startBodyguardInterception") {
        const attackMessage = game.messages?.get(data.attackMessageId);
        const rollMessage = game.messages?.get(data.rollMessageId);
        const attackState = attackMessage?.getFlag(SYSTEM_ID, PUSH_FLAG);
        const rollState = rollMessage?.getFlag(SYSTEM_ID, PUSH_FLAG);
        const user = game.users?.get(data.requesterId);
        const bodyguard = data.bodyguardActorUuid ? await fromUuid(data.bodyguardActorUuid) : null;
        const target = attackState?.attack?.targetActorUuid
          ? await fromUuid(attackState.attack.targetActorUuid) : null;
        if (!attackMessage || !rollMessage || !attackState?.attack || !rollState?.interception
          || !user?.active || !bodyguard?.testUserPermission?.(user, "OWNER")
          || rollState.actorUuid !== bodyguard.uuid
          || rollState.interception.attackMessageId !== attackMessage.id
          || !canInterceptHits(bodyguard)
          || !target || attackMessage.getFlag(SYSTEM_ID, APPLIED_FLAG)) return;
        const linked = await setAttackInterception(attackMessage, {
          interception: {
            status: "pending",
            bodyguardActorUuid: bodyguard.uuid,
            bodyguardName: bodyguard.name,
            rollMessageId: rollMessage.id,
            originalTargetActorUuid: target.uuid,
            originalTargetName: target.name
          }
        });
        if (linked) await rollMessage.setFlag(SYSTEM_ID, "interceptionLinked", true);
        return;
      }
      if (data.action === "resolveBodyguardInterception") {
        const attackMessage = game.messages?.get(data.attackMessageId);
        const rollMessage = game.messages?.get(data.rollMessageId);
        const rollState = rollMessage?.getFlag(SYSTEM_ID, PUSH_FLAG);
        const user = game.users?.get(data.requesterId);
        const bodyguard = rollState?.actorUuid ? await fromUuid(rollState.actorUuid) : null;
        if (!attackMessage || !rollMessage || !rollState?.interception || !user?.active
          || !bodyguard?.testUserPermission?.(user, "OWNER")) return;
        await finalizeInterception(attackMessage, rollMessage, rollState);
      }
    });
  });
  Hooks.on("renderChatMessageHTML", (message, html) => {
    const root = html?.querySelector ? html : html?.[0];
    const blockButton = root?.querySelector?.('[data-action="blockAttack"]');
    if (blockButton) {
      const state = message.getFlag(SYSTEM_ID, PUSH_FLAG);
      const applied = message.getFlag(SYSTEM_ID, APPLIED_FLAG);
      const opposed = message.getFlag(SYSTEM_ID, "opposed");
      const interceptionPending = state?.attack?.interception?.status === "pending";
      if (!state?.attack || state.superseded || applied || opposed?.opponentMessageId || interceptionPending) {
        blockButton.disabled = true;
        if (opposed?.opponentMessageId) blockButton.textContent = game.i18n.localize("YZE.Combat.BlockDeclared");
      } else {
        blockButton.addEventListener("click", async () => {
          blockButton.disabled = true;
          try {
            if (!await blockAttack(message, message.getFlag(SYSTEM_ID, PUSH_FLAG))) {
              blockButton.disabled = false;
            }
          } catch (error) {
            console.error("YZE System Toolkit | Could not block attack", error);
            ui.notifications.error(game.i18n.localize("YZE.Combat.BlockFailed"));
            blockButton.disabled = false;
          }
        });
      }
    }
    const interceptButton = root?.querySelector?.('[data-action="interceptAttack"]');
    if (interceptButton) {
      const state = message.getFlag(SYSTEM_ID, PUSH_FLAG);
      const applied = message.getFlag(SYSTEM_ID, APPLIED_FLAG);
      if (!state?.attack || state.superseded || applied || state.attack.interception) {
        interceptButton.disabled = true;
      } else {
        interceptButton.addEventListener("click", async () => {
          interceptButton.disabled = true;
          try {
            if (!await startBodyguardInterception(message, message.getFlag(SYSTEM_ID, PUSH_FLAG))) {
              interceptButton.disabled = false;
            }
          } catch (error) {
            console.error("YZE System Toolkit | Could not start Bodyguard interception", error);
            ui.notifications.error(game.i18n.localize("YZE.Bodyguard.Failed"));
            interceptButton.disabled = false;
          }
        });
      }
    }
    const resolveInterceptionButton = root?.querySelector?.('[data-action="resolveInterception"]');
    if (resolveInterceptionButton) {
      const state = message.getFlag(SYSTEM_ID, PUSH_FLAG);
      if (!state?.interception || state.superseded
        || !message.getFlag(SYSTEM_ID, "interceptionLinked")
        || message.getFlag(SYSTEM_ID, INTERCEPTION_RESOLVED_FLAG)) {
        resolveInterceptionButton.disabled = true;
      } else {
        resolveInterceptionButton.addEventListener("click", async () => {
          resolveInterceptionButton.disabled = true;
          try {
            if (!await resolveBodyguardInterception(message, message.getFlag(SYSTEM_ID, PUSH_FLAG))) {
              resolveInterceptionButton.disabled = false;
            }
          } catch (error) {
            console.error("YZE System Toolkit | Could not resolve Bodyguard interception", error);
            ui.notifications.error(game.i18n.localize("YZE.Bodyguard.Failed"));
            resolveInterceptionButton.disabled = false;
          }
        });
      }
    }
    const button = root?.querySelector?.('[data-action="applyAttackDamage"]');
    if (!button) return;
    const state = message.getFlag(SYSTEM_ID, PUSH_FLAG);
    const applied = message.getFlag(SYSTEM_ID, APPLIED_FLAG);
    if (!state?.attack || state.superseded || applied
      || state.attack.interception?.status === "pending") {
      button.disabled = true;
      button.textContent = game.i18n.localize(
        applied
          ? "YZE.Combat.DamageAlreadyApplied"
          : state?.attack?.interception?.status === "pending"
            ? "YZE.Bodyguard.Pending"
            : "YZE.Combat.UsePushedAttack"
      );
      return;
    }
    button.addEventListener("click", async () => {
      button.disabled = true;
      try {
        const current = message.getFlag(SYSTEM_ID, PUSH_FLAG);
        const success = await applyAttackDamage(message, current);
        if (!success) button.disabled = false;
      } catch (error) {
        console.error("YZE System Toolkit | Could not apply attack damage", error);
        ui.notifications.error(game.i18n.localize("YZE.Combat.DamageApplicationFailed"));
        button.disabled = false;
      }
    });
  });
}
