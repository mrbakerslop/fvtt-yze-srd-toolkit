import {
  AMMUNITION_MODES,
  DICE_SYSTEMS,
  INITIATIVE_MODES,
  SPECIALTY_EFFECTS,
  SYSTEM_ID
} from "./constants.mjs";
import { getAmmunitionMode, getDiceSystem, getInitiativeMode, isTravelEnabled } from "./settings.mjs";
import { hasSpecialty, hasWeaponSpecialty, initiativeCardsToDraw } from "./specialties.mjs";
import { countStateSuccesses } from "./dice/successes.mjs";
import {
  getCriticalInjuryRestrictions,
  getCriticalInjuryWeaponRestriction,
  notifyCriticalInjuryRestriction
} from "./critical-injuries.mjs";
import { consumeSneakAttack, pendingSneakAttack } from "./surprise.mjs";
import {
  activeTokenForActor,
  engagedHostileTokens,
  rangeAllows,
  rangeBetweenTokens,
  zoneCoverForActor
} from "./zones.mjs";
import { mountForRider } from "./mounts.mjs";

const RANGE_ORDER = Object.freeze(["engaged", "short", "medium", "long", "extreme"]);
const RANGE_MODIFIERS = Object.freeze({ engaged: -3, short: 0, medium: -1, long: -2, extreme: -3 });
const AMMO_SPENT_FLAG = "ammunitionSpent";
const COMBAT_SOCKET = `system.${SYSTEM_ID}`;

function escape(value) {
  return foundry.utils.escapeHTML(String(value));
}

function combatRollSuccesses(state) {
  return countStateSuccesses(state);
}

function shuffled(values) {
  const result = [...values];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(Math.random() * (index + 1));
    [result[index], result[swap]] = [result[swap], result[index]];
  }
  return result;
}

async function chooseInitiativeCard(combatant, cards) {
  if (cards.length < 2) return cards[0];
  const options = cards.map((card) => `<option value="${card}">${card}</option>`).join("");
  const { DialogV2 } = foundry.applications.api;
  return DialogV2.wait({
    window: { title: game.i18n.localize("YZE.ItemEffects.InitiativeChoiceTitle") },
    content: `<div class="yze"><p>${escape(game.i18n.format(
      "YZE.ItemEffects.InitiativeChoiceHint", { actor: combatant.name }
    ))}</p><div class="form-group"><label>${escape(
      game.i18n.localize("YZE.Specialty.InitiativeCard")
    )}</label><select name="card">${options}</select></div></div>`,
    buttons: [{
      action: "choose",
      label: game.i18n.localize("YZE.Common.Continue"),
      icon: "fa-solid fa-hand-pointer",
      default: true,
      callback: (event, button, dialog) => {
        const form = button.form ?? dialog.element.querySelector("form");
        return Number(form.elements.card?.value) || cards[0];
      }
    }],
    close: () => Math.min(...cards),
    rejectClose: false,
    modal: true
  });
}

export class YZECombat extends Combat {
  _sortCombatants(left, right) {
    const leftInitiative = Number.isFinite(Number(left.initiative))
      ? Number(left.initiative)
      : Number.POSITIVE_INFINITY;
    const rightInitiative = Number.isFinite(Number(right.initiative))
      ? Number(right.initiative)
      : Number.POSITIVE_INFINITY;
    if (leftInitiative !== rightInitiative) return leftInitiative - rightInitiative;
    return String(left.name).localeCompare(String(right.name));
  }

  async rollInitiative(ids, { updateTurn = true, messageOptions = {} } = {}) {
    const requested = new Set(Array.isArray(ids) ? ids : [ids]);
    const combatants = [...this.combatants].filter((combatant) => requested.has(combatant.id));
    if (combatants.length === 0) return this;

    const occupied = new Set(
      [...this.combatants]
        .filter((combatant) => !requested.has(combatant.id))
        .map((combatant) => Number(combatant.initiative))
        .filter((initiative) => Number.isInteger(initiative) && initiative >= 1 && initiative <= 10)
    );
    const available = shuffled(
      Array.from({ length: 10 }, (_value, index) => index + 1)
        .filter((card) => !occupied.has(card))
    );
    const cardsRequired = combatants.reduce((total, combatant) => (
      total + initiativeCardsToDraw(combatant.actor)
    ), 0);
    if (cardsRequired > available.length) {
      ui.notifications.error(game.i18n.localize("YZE.Combat.NotEnoughInitiativeCards"));
      return this;
    }

    const currentId = this.combatant?.id ?? null;
    const updates = [];
    for (const combatant of combatants) {
      const drawCount = initiativeCardsToDraw(combatant.actor);
      const cards = available.splice(0, drawCount);
      updates.push({
        _id: combatant.id,
        initiative: await chooseInitiativeCard(combatant, cards)
      });
    }
    await this.updateEmbeddedDocuments("Combatant", updates);

    const entries = updates.map((update) => {
      const combatant = this.combatants.get(update._id);
      return `<li><span>${escape(combatant?.name ?? "")}</span><strong>${update.initiative}</strong></li>`;
    }).join("");
    const hidden = getInitiativeMode() === INITIATIVE_MODES.HIDDEN_CARDS;
    const chatData = {
      ...messageOptions,
      content: `
        <div class="yze chat-card yze-initiative-card">
          <h3>${escape(game.i18n.localize(
            hidden ? "YZE.Combat.HiddenInitiativeDrawn" : "YZE.Combat.InitiativeDrawn"
          ))}</h3>
          <ol>${entries}</ol>
        </div>`
    };
    if (hidden) {
      chatData.whisper = game.users.filter((user) => user.isGM).map((user) => user.id);
    }
    await ChatMessage.create(chatData);

    if (updateTurn && currentId) {
      const turn = this.turns.findIndex((combatant) => combatant.id === currentId);
      if (turn >= 0 && turn !== this.turn) await this.update({ turn });
    }
    return this;
  }
}

export function actorCombatant(actor, combat = game.combat) {
  if (!actor || !combat) return null;
  return combat.combatants.find((combatant) => (
    combatant.actor?.uuid === actor.uuid
    || (!actor.isToken && combatant.actorId === actor.id)
  )) ?? null;
}

export function combatActionState(actor, combat = game.combat) {
  const combatant = actorCombatant(actor, combat);
  if (!combatant) return {
    active: false,
    combatant: null,
    fastUsed: 0,
    slowUsed: false,
    fastRemaining: 2,
    slowRemaining: 1,
    canFast: true,
    canSlow: true,
    isTurn: false,
    canExchange: false
  };

  const stored = combatant.getFlag(SYSTEM_ID, "actions") ?? {};
  const currentRound = Number(combat?.round) || 0;
  const current = Number(stored.round) === currentRound ? stored : {};
  const fastUsed = Math.min(2, Math.max(0, Math.trunc(Number(current.fast) || 0)));
  const slowUsed = current.slow === true;
  const isTurn = combat?.combatant?.id === combatant.id;
  const exchangeLocked = Number(current.exchangeLockedRound) === currentRound;
  const activeMagic = actor?.getFlag?.(SYSTEM_ID, "magicEffects");
  const paralyzedPower = Array.isArray(activeMagic)
    ? activeMagic.filter((effect) => effect.kind === "paralyzed"
      && (Number(effect.startsCombatRound) || 0) <= currentRound)
      .reduce((maximum, effect) => Math.max(maximum, Math.trunc(Number(effect.powerLevel) || 0)), 0)
    : 0;
  const baseFastRemaining = slowUsed ? Math.max(0, 1 - fastUsed) : Math.max(0, 2 - fastUsed);
  const baseSlowRemaining = slowUsed ? 0 : 1;
  const fastRemaining = paralyzedPower >= 3
    ? 0
    : Math.max(0, baseFastRemaining - (paralyzedPower === 1 ? 1 : 0));
  const slowRemaining = paralyzedPower >= 2 ? 0 : baseSlowRemaining;
  return {
    active: true,
    combatant,
    fastUsed,
    slowUsed,
    fastRemaining,
    slowRemaining,
    canFast: fastRemaining > 0,
    canSlow: slowRemaining > 0 && fastUsed < 2,
    isTurn,
    canExchange: isTurn && !exchangeLocked && !slowUsed && fastUsed === 0 && paralyzedPower === 0,
    paralyzedPower
  };
}

export function canSpendActorActions(actor, { fast = 0, slow = 0 } = {}) {
  const state = combatActionState(actor);
  if (!state.active) return true;
  if (Math.max(0, Math.trunc(fast)) > state.fastRemaining
    || Math.max(0, Math.trunc(slow)) > state.slowRemaining) return false;
  const nextFast = state.fastUsed + Math.max(0, Math.trunc(fast));
  const nextSlow = state.slowUsed || slow > 0;
  if (slow > 1) return false;
  if (nextSlow && nextFast > 1) return false;
  return !nextSlow ? nextFast <= 2 : nextFast <= 1;
}

export async function spendActorActions(actor, {
  fast = 0,
  slow = 0,
  preserveOverwatch = false,
  preserveAim = false,
  preservePreparedWeapon = false
} = {}) {
  const restrictions = getCriticalInjuryRestrictions(actor);
  if (restrictions.blocksActions) {
    notifyCriticalInjuryRestriction(actor, {
      kind: "actions",
      sources: restrictions.actionSources
    });
    return false;
  }
  const state = combatActionState(actor);
  if (!state.active) return true;
  if (!canSpendActorActions(actor, { fast, slow })) {
    ui.notifications.warn(game.i18n.localize("YZE.Combat.NotEnoughActions"));
    return false;
  }
  const actions = {
    round: Number(game.combat?.round) || 0,
    fast: state.fastUsed + Math.max(0, Math.trunc(fast)),
    slow: state.slowUsed || slow > 0,
    exchangeLockedRound: state.combatant.getFlag(SYSTEM_ID, "actions")?.exchangeLockedRound ?? null
  };
  await state.combatant.setFlag(SYSTEM_ID, "actions", actions);
  if (!preserveOverwatch && actor.system?.combat?.overwatch?.active === true) {
    await actor.update({
      "system.combat.overwatch.active": false,
      "system.combat.overwatch.direction": "",
      "system.combat.overwatch.weaponItemId": ""
    });
  }
  if (!preserveAim && actor.system?.combat?.aim?.active === true) {
    await actor.update({
      "system.combat.aim.active": false,
      "system.combat.aim.weaponItemId": "",
      "system.combat.aim.preparedRound": 0
    });
  }
  if (!preservePreparedWeapon && actor.getFlag(SYSTEM_ID, "preparedRangedWeaponId")) {
    await actor.unsetFlag(SYSTEM_ID, "preparedRangedWeaponId");
  }
  return true;
}

export async function resetActorActions(actor) {
  const combatant = actorCombatant(actor);
  if (!combatant || (!game.user?.isGM && combatant.actor?.isOwner === false)) return false;
  await combatant.setFlag(SYSTEM_ID, "actions", {
    round: Number(game.combat?.round) || 0,
    fast: 0,
    slow: false,
    exchangeLockedRound: null
  });
  return true;
}

async function resetRoundActions(combat) {
  const round = Number(combat.round) || 0;
  const updates = [...combat.combatants].map((combatant) => ({
    _id: combatant.id,
    [`flags.${SYSTEM_ID}.actions`]: {
      round,
      fast: 0,
      slow: false,
      exchangeLockedRound: null
    }
  }));
  if (updates.length > 0) await combat.updateEmbeddedDocuments("Combatant", updates);
}

function primaryActiveGM() {
  return game.users
    ?.filter((user) => user.active && user.isGM)
    .sort((left, right) => Number(right.role) - Number(left.role) || left.id.localeCompare(right.id))[0]
    ?? null;
}

function isPrimaryActiveGM() {
  return primaryActiveGM()?.id === game.user?.id;
}

export async function promptInitiativeExchange(actor) {
  const combat = game.combat;
  const state = combatActionState(actor, combat);
  if (!state.canExchange) {
    ui.notifications.warn(game.i18n.localize("YZE.Combat.CannotExchangeInitiative"));
    return false;
  }
  const eligible = combat.turns.slice(combat.turn + 1).filter((combatant) => (
    combatant.id !== state.combatant.id && Number.isFinite(Number(combatant.initiative))
  ));
  if (eligible.length === 0) {
    ui.notifications.warn(game.i18n.localize("YZE.Combat.NoExchangeTargets"));
    return false;
  }
  const options = eligible.map((combatant) => (
    `<option value="${escape(combatant.id)}">${escape(combatant.name)} — ${escape(combatant.initiative)}</option>`
  )).join("");
  const { DialogV2 } = foundry.applications.api;
  const targetId = await DialogV2.wait({
    window: { title: game.i18n.localize("YZE.Combat.ExchangeInitiative") },
    content: `
      <div class="yze yze-initiative-dialog">
        <p>${escape(game.i18n.localize("YZE.Combat.ExchangeHint"))}</p>
        <div class="form-group">
          <label>${escape(game.i18n.localize("YZE.Combat.ExchangeWith"))}</label>
          <select name="combatant">${options}</select>
        </div>
      </div>`,
    buttons: [
      {
        action: "exchange",
        label: game.i18n.localize("YZE.Combat.Exchange"),
        icon: "fa-solid fa-right-left",
        default: true,
        callback: (event, button, dialog) => {
          const form = button.form ?? dialog.element.querySelector("form");
          return form.elements.combatant?.value ?? null;
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
  if (!targetId) return false;

  const target = combat.combatants.get(targetId);
  if (!target || !eligible.some((combatant) => combatant.id === target.id)) return false;
  const round = Number(combat.round) || 0;
  const rawTargetActions = target.getFlag(SYSTEM_ID, "actions") ?? {};
  const targetActions = Number(rawTargetActions.round) === round ? rawTargetActions : {};
  const targetFastUsed = Math.min(2, Math.max(0, Math.trunc(Number(targetActions.fast) || 0)));
  const targetSlowUsed = targetActions.slow === true;
  await combat.updateEmbeddedDocuments("Combatant", [
    {
      _id: state.combatant.id,
      initiative: target.initiative,
      [`flags.${SYSTEM_ID}.actions`]: {
        round,
        fast: state.fastUsed,
        slow: state.slowUsed,
        exchangeLockedRound: round
      }
    },
    {
      _id: target.id,
      initiative: state.combatant.initiative,
      [`flags.${SYSTEM_ID}.actions`]: {
        round,
        fast: targetFastUsed,
        slow: targetSlowUsed,
        exchangeLockedRound: round
      }
    }
  ]);
  const nextTurn = combat.turns.findIndex((combatant) => combatant.id === target.id);
  if (nextTurn >= 0) await combat.update({ turn: nextTurn });
  await ChatMessage.create({
    content: `<div class="yze chat-card"><p>${escape(game.i18n.format("YZE.Combat.ExchangeResult", {
      source: state.combatant.name,
      target: target.name
    }))}</p></div>`
  });
  return true;
}

function attackSkillOptions(actor, ranged) {
  const skills = actor.items
    .filter((item) => item.type === "skill")
    .sort((a, b) => a.name.localeCompare(b.name));
  const preferred = ranged ? "Marksmanship" : "Melee";
  return skills.map((skill) => ({
    id: skill.id,
    name: skill.name,
    selected: skill.name.localeCompare(preferred, undefined, { sensitivity: "base" }) === 0
  }));
}

function weaponUsesAmmunition(weapon) {
  return weapon?.system?.usesAmmunition === true && weapon.system.range !== "engaged";
}

export function ammunitionOptions(weapon) {
  const mode = getAmmunitionMode();
  const uses = weaponUsesAmmunition(weapon);
  const rounds = Math.max(0, Math.trunc(Number(weapon?.system?.ammunition?.value) || 0));
  const rateOfFire = Math.max(0, Math.trunc(Number(weapon?.system?.rateOfFire) || 0));
  return {
    mode,
    uses,
    rounds,
    rateOfFire,
    maximumAmmoDice: uses && mode === AMMUNITION_MODES.AMMO_DICE
      ? Math.max(0, Math.min(rateOfFire, rounds - 1))
      : 0,
    showAmmoDice: uses && mode === AMMUNITION_MODES.AMMO_DICE && rounds > 1 && rateOfFire > 0,
    showBasicAutofire: weapon?.system?.fullAuto === true && mode !== AMMUNITION_MODES.AMMO_DICE
  };
}

function hasAttackAmmunition(weapon) {
  const ammunition = ammunitionOptions(weapon);
  if (!ammunition.uses || ammunition.mode === AMMUNITION_MODES.UNTRACKED) return true;
  return ammunition.rounds > 0;
}

export function ammunitionSpent(results = []) {
  const faces = results.map((result) => Math.max(0, Math.trunc(Number(result) || 0)));
  return faces.length > 0 ? faces.reduce((total, result) => total + result, 1) : 1;
}

async function spendAttackAmmunition(weapon, message) {
  const ammunition = ammunitionOptions(weapon);
  if (!ammunition.uses || ammunition.mode === AMMUNITION_MODES.UNTRACKED
    || ammunition.mode === AMMUNITION_MODES.SUPPLY) return 0;
  const state = message?.getFlag(SYSTEM_ID, "push");
  const ammoResults = (state?.dice ?? [])
    .filter((die) => die.category === "ammo")
    .map((die) => Math.max(0, Math.trunc(Number(die.result) || 0)));
  const spent = ammunition.mode === AMMUNITION_MODES.AMMO_DICE
    ? ammunitionSpent(ammoResults)
    : 1;
  const next = spent >= ammunition.rounds ? 0 : ammunition.rounds - spent;
  await weapon.update({ "system.ammunition.value": next });
  const applied = ammunition.rounds - next;
  if (message) await message.setFlag(SYSTEM_ID, AMMO_SPENT_FLAG, applied);
  return applied;
}

/** Reconcile magazine expenditure when pushed Ammo Dice replace their earlier faces. */
export async function reconcilePushedAmmunition(originalMessage, pushedMessage, pushedState) {
  if (pushedState?.attack?.ammunitionMode !== AMMUNITION_MODES.AMMO_DICE) return null;
  const actor = pushedState.actorUuid ? await fromUuid(pushedState.actorUuid) : null;
  const weapon = actor?.items?.get(pushedState.attack.weaponItemId);
  if (!weapon || !weaponUsesAmmunition(weapon)) return null;
  const prior = Math.max(0, Math.trunc(Number(
    originalMessage.getFlag(SYSTEM_ID, AMMO_SPENT_FLAG)
  ) || 0));
  const desired = ammunitionSpent((pushedState.dice ?? [])
    .filter((die) => die.category === "ammo")
    .map((die) => die.result));
  const current = Math.max(0, Math.trunc(Number(weapon.system.ammunition?.value) || 0));
  const maximum = Math.max(current, Math.trunc(Number(weapon.system.ammunition?.max) || 0));
  let applied = desired;
  let next = current;
  if (desired > prior) {
    const additional = Math.min(current, desired - prior);
    next = current - additional;
    applied = prior + additional;
  } else if (desired < prior) {
    const refund = prior - desired;
    next = Math.min(maximum, current + refund);
  }
  if (next !== current) await weapon.update({ "system.ammunition.value": next });
  await pushedMessage.setFlag(SYSTEM_ID, AMMO_SPENT_FLAG, applied);
  return { prior, desired, applied, rounds: next };
}

export async function rollAmmunitionSupply(actor, weapon) {
  const rating = Math.max(0, Math.min(6, Math.trunc(Number(weapon?.system?.ammunition?.value) || 0)));
  if (!weaponUsesAmmunition(weapon) || getAmmunitionMode() !== AMMUNITION_MODES.SUPPLY
    || rating < 1) return null;
  const roll = await new Roll(`${rating}d6`).evaluate();
  const banes = (roll.dice ?? []).flatMap((die) => die.results ?? [])
    .filter((result) => result.active !== false && Number(result.result) === 1).length;
  const next = Math.max(0, rating - banes);
  if (banes > 0) await weapon.update({ "system.ammunition.value": next });
  await roll.toMessage({
    speaker: ChatMessage.getSpeaker({ actor }),
    flavor: `<div class="yze chat-card"><h3>${escape(game.i18n.localize("YZE.Combat.AmmunitionSupplyRoll"))}</h3><p>${escape(game.i18n.format("YZE.Combat.AmmunitionSupplyResult", {
      weapon: weapon.name,
      banes,
      rating: next
    }))}</p></div>`
  });
  return { banes, rating: next };
}

export async function reloadWeapon(actor, weaponId) {
  const weapon = actor?.items?.get(weaponId);
  if (!weapon || weapon.type !== "weapon" || !weaponUsesAmmunition(weapon)) return false;
  const injuryRestriction = getCriticalInjuryWeaponRestriction(actor, weapon);
  if (injuryRestriction) {
    notifyCriticalInjuryRestriction(actor, injuryRestriction);
    return false;
  }
  if (weapon.system.requiresPreparation === true) {
    if (!hasAttackAmmunition(weapon)) {
      ui.notifications.warn(game.i18n.localize("YZE.Combat.OutOfAmmunition"));
      return false;
    }
    if (!canSpendActorActions(actor, { fast: 1 })) {
      ui.notifications.warn(game.i18n.localize("YZE.Combat.NotEnoughActions"));
      return false;
    }
    await spendActorActions(actor, { fast: 1, preservePreparedWeapon: true });
    await actor.setFlag(SYSTEM_ID, "preparedRangedWeaponId", weapon.id);
    await ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor }),
      content: `<div class="yze chat-card"><p>${escape(game.i18n.format("YZE.Combat.WeaponPrepared", { actor: actor.name, weapon: weapon.name }))}</p></div>`
    });
    return true;
  }
  const mode = getAmmunitionMode();
  if (![AMMUNITION_MODES.TRACKING, AMMUNITION_MODES.AMMO_DICE].includes(mode)) {
    return rollAmmunitionSupply(actor, weapon);
  }
  const maximum = Math.max(0, Math.trunc(Number(weapon.system.ammunition?.max) || 0));
  if (maximum < 1 || Number(weapon.system.ammunition.value) >= maximum) {
    ui.notifications.info(game.i18n.localize("YZE.Combat.ReloadNotNeeded"));
    return false;
  }
  const actionCost = weapon.system.reloadAction === "fast" ? { fast: 1 } : { slow: 1 };
  if (!canSpendActorActions(actor, actionCost)) return false;
  if (!await spendActorActions(actor, actionCost)) return false;
  await weapon.update({ "system.ammunition.value": maximum });
  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    content: `<div class="yze chat-card"><p>${escape(game.i18n.format("YZE.Combat.Reloaded", {
      actor: actor.name, weapon: weapon.name, rounds: maximum
    }))}</p></div>`
  });
  return true;
}

function attackDialogContent(actor, target, weapon, rangedCapable, skills, specialty, ammunition, {
  overwatch = false,
  preparedAim = false,
  surprise = null,
  spatial = null
} = {}) {
  const maximumRange = Math.max(0, RANGE_ORDER.indexOf(weapon.system.range));
  const selectedRange = spatial?.configured ? spatial.range : (rangedCapable ? "short" : "engaged");
  const ranges = RANGE_ORDER.slice(0, maximumRange + 1).map((range) => (
    `<option value="${range}"${range === selectedRange ? " selected" : ""}>${escape(game.i18n.localize(`YZE.Range.${range}`))}</option>`
  )).join("");
  const skillOptions = skills.map((skill) => (
    `<option value="${escape(skill.id)}"${skill.selected ? " selected" : ""}>${escape(skill.name)}</option>`
  )).join("");
  const unarmed = !String(weapon.system.grip || "").trim()
    || weapon.name.localeCompare("Unarmed", undefined, { sensitivity: "base" }) === 0;
  const specialAttacks = ["damage", "disarm", "trip", "shove", "grapple"];
  if (actor.system?.combat?.grapplingTargetUuid === target.uuid) specialAttacks.push("grappleStrike");
  const specialOptions = specialAttacks
    .map((value) => `<option value="${value}">${escape(game.i18n.localize(`YZE.Combat.SpecialAttacks.${value}`))}</option>`)
    .join("");
  const ammoOptions = Array.from({ length: ammunition.maximumAmmoDice + 1 }, (_value, index) => (
    `<option value="${index}">${index}</option>`
  )).join("");
  return `
    <div class="yze yze-attack-dialog">
      <p>${escape(game.i18n.format("YZE.Combat.AttackHint", {
        attacker: actor.name,
        target: target.name,
        weapon: weapon.name
      }))}</p>
      ${surprise ? `<p class="yze-surprise-notice">${escape(game.i18n.format(
        "YZE.Surprise.PendingAttack", { target: surprise.targetName }
      ))}</p>` : ""}
      <div class="form-group"><label>${escape(game.i18n.localize("YZE.Combat.AttackSkill"))}</label><select name="skill">${skillOptions}</select></div>
      ${rangedCapable ? `<div class="form-group"><label>${escape(game.i18n.localize("YZE.Combat.AttackType"))}</label><select name="kind"><option value="ranged">${escape(game.i18n.localize("YZE.Combat.RangedAttack"))}</option><option value="melee">${escape(game.i18n.localize("YZE.Combat.MeleeAttack"))}</option></select></div>` : ""}
      ${rangedCapable ? `<div class="form-group"><label>${escape(game.i18n.localize("YZE.Item.Range"))}</label><select name="range"${spatial?.configured ? " disabled" : ""}>${ranges}</select></div>` : ""}
      ${spatial?.configured ? `<p class="hint">${escape(game.i18n.format("YZE.Zones.AttackRange", {
        from: spatial.sourceZone.name,
        to: spatial.targetZone.name,
        range: game.i18n.localize(`YZE.Range.${spatial.range}`)
      }))}</p>` : ""}
      ${rangedCapable ? `<label class="checkbox-row"><input type="checkbox" name="aimed"${overwatch ? " checked disabled" : ""}><span>${escape(game.i18n.localize(overwatch ? "YZE.Combat.OverwatchAim" : preparedAim ? "YZE.Combat.PreparedTelescopicAim" : "YZE.Combat.Aimed"))}</span></label>` : ""}
      ${rangedCapable ? `
        <div class="form-group"><label>${escape(game.i18n.localize("YZE.Combat.TargetSize"))}</label>
          <select name="size"><option value="0">${escape(game.i18n.localize("YZE.Combat.NormalTarget"))}</option><option value="2">${escape(game.i18n.localize("YZE.Combat.LargeTarget"))}</option><option value="-2">${escape(game.i18n.localize("YZE.Combat.SmallTarget"))}</option></select>
        </div>
        <div class="form-group"><label>${escape(game.i18n.localize("YZE.Combat.Visibility"))}</label>
          <select name="visibility"${spatial?.targetDimlyLit ? " disabled" : ""}><option value="0"${!spatial?.targetDimlyLit ? " selected" : ""}>${escape(game.i18n.localize("YZE.Combat.Clear"))}</option><option value="-1">${escape(game.i18n.localize("YZE.Combat.DimLight"))}</option><option value="-2"${spatial?.targetDimlyLit ? " selected" : ""}>${escape(game.i18n.localize("YZE.Combat.Darkness"))}</option></select>
        </div>` : ""}
      <label class="checkbox-row"><input type="checkbox" name="attackerProne"${actor.system?.combat?.prone ? " checked" : ""}><span>${escape(game.i18n.localize("YZE.Combat.AttackerProne"))}</span></label>
      <label class="checkbox-row"><input type="checkbox" name="targetProne"${target.system?.combat?.prone ? " checked" : ""}><span>${escape(game.i18n.localize("YZE.Combat.TargetProne"))}</span></label>
      <label class="checkbox-row"><input type="checkbox" name="defenseless"${surprise ? " checked disabled" : ""}><span>${escape(game.i18n.localize("YZE.Combat.DefenselessTarget"))}</span></label>
      ${unarmed ? `<div class="form-group"><label>${escape(game.i18n.localize("YZE.Combat.SpecialAttack"))}</label><select name="special">${specialOptions}</select></div>
        <label class="checkbox-row"><input type="checkbox" name="divingBlow"><span>${escape(game.i18n.localize("YZE.Combat.DivingBlow"))}</span></label>` : ""}
      ${ammunition.showAmmoDice ? `<div class="form-group"><label>${escape(game.i18n.localize("YZE.Combat.AmmoDiceToRoll"))}</label><select name="ammoDice">${ammoOptions}</select></div>` : ""}
      ${ammunition.showBasicAutofire ? `<label class="checkbox-row"><input type="checkbox" name="basicAutofire"><span>${escape(game.i18n.localize("YZE.Combat.BasicAutofire"))}</span></label>` : ""}
      ${specialty.hardHitter ? `<label class="checkbox-row"><input type="checkbox" name="hardHitter"><span>${escape(game.i18n.localize("YZE.Specialty.UseHardHitter"))}</span></label>` : ""}
      ${specialty.sniper && rangedCapable ? `<label class="checkbox-row"><input type="checkbox" name="hiddenPosition"><span>${escape(game.i18n.localize("YZE.Specialty.UseSniper"))}</span></label>` : ""}
      <p class="hint">${escape(game.i18n.localize("YZE.Combat.BasicAttackHint"))}</p>
    </div>`;
}

async function promptAttack(actor, target, weapon, { overwatch = false, surprise = null, spatial = null } = {}) {
  const rangedCapable = weapon.system.range !== "engaged";
  const skills = attackSkillOptions(actor, rangedCapable);
  if (skills.length === 0) {
    ui.notifications.error(game.i18n.localize("YZE.Combat.NoAttackSkills"));
    return null;
  }
  if (!skills.some((skill) => skill.selected)) skills[0].selected = true;
  const { DialogV2 } = foundry.applications.api;
  const specialty = {
    hardHitter: hasSpecialty(actor, SPECIALTY_EFFECTS.HARD_HITTER),
    sniper: hasSpecialty(actor, SPECIALTY_EFFECTS.SNIPER)
  };
  const ammunition = ammunitionOptions(weapon);
  const preparedAim = actor.system?.combat?.aim?.active === true
    && actor.system.combat.aim.weaponItemId === weapon.id;
  return DialogV2.wait({
    window: { title: game.i18n.localize("YZE.Combat.AttackTitle") },
    content: attackDialogContent(actor, target, weapon, rangedCapable, skills, specialty, ammunition, {
      overwatch, preparedAim, surprise, spatial
    }),
    buttons: [
      {
        action: "attack",
        label: game.i18n.localize("YZE.Combat.RollAttack"),
        icon: "fa-solid fa-burst",
        default: true,
        callback: (event, button, dialog) => {
          const form = button.form ?? dialog.element.querySelector("form");
          const ranged = rangedCapable && form.elements.kind?.value !== "melee";
          return {
            skillId: form.elements.skill?.value,
            ranged,
            range: ranged ? form.elements.range?.value : "engaged",
            aimed: ranged && (overwatch || form.elements.aimed?.checked === true),
            aimBonus: ranged && form.elements.aimed?.checked === true
              ? (preparedAim ? 3 : 2)
              : (overwatch ? 2 : 0),
            preparedAim: ranged && preparedAim && form.elements.aimed?.checked === true,
            defenseless: surprise || form.elements.defenseless?.checked === true,
            surpriseForced: Boolean(surprise),
            attackerProne: !ranged && form.elements.attackerProne?.checked === true,
            targetProne: !ranged && form.elements.targetProne?.checked === true,
            size: ranged ? Number(form.elements.size?.value) || 0 : 0,
            visibility: ranged ? Number(form.elements.visibility?.value) || 0 : 0,
            hardHitter: !ranged && form.elements.hardHitter?.checked === true,
            sniper: ranged && ["long", "extreme"].includes(form.elements.range?.value)
              && form.elements.hiddenPosition?.checked === true,
            special: !ranged ? (form.elements.special?.value ?? "damage") : "damage",
            divingBlow: !ranged && form.elements.divingBlow?.checked === true,
            ammoDice: ranged ? Math.max(0, Math.trunc(Number(form.elements.ammoDice?.value) || 0)) : 0,
            basicAutofire: ranged && form.elements.basicAutofire?.checked === true
          };
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
}

function attackModifiers(options, actor, weapon) {
  const modifiers = [];
  if (options.ranged) {
    const rangeModifier = options.defenseless && options.range === "engaged"
      ? 3
      : RANGE_MODIFIERS[options.range] ?? 0;
    if (rangeModifier) modifiers.push([game.i18n.localize("YZE.Combat.RangeModifier"), rangeModifier]);
    if (options.aimed) modifiers.push([
      game.i18n.localize(options.preparedAim ? "YZE.Combat.PreparedTelescopicAim" : "YZE.Combat.Aimed"),
      options.aimBonus || 2
    ]);
    if (options.size) modifiers.push([game.i18n.localize("YZE.Combat.TargetSize"), options.size]);
    if (options.visibility) modifiers.push([game.i18n.localize("YZE.Combat.Visibility"), options.visibility]);
    if (isTravelEnabled() && game.settings.get(SYSTEM_ID, "travelWeather") === "heavy") {
      modifiers.push([game.i18n.localize("YZE.Travel.HeavyWeather"), -1]);
    }
  } else {
    if (options.attackerProne) modifiers.push([game.i18n.localize("YZE.Combat.AttackerProne"), -2]);
    if (options.targetProne) modifiers.push([game.i18n.localize("YZE.Combat.TargetProne"), 2]);
    if (options.defenseless && !options.sneakAttack) {
      modifiers.push([game.i18n.localize("YZE.Combat.DefenselessTarget"), 3]);
    }
    if (options.sneakAttack) {
      modifiers.push([game.i18n.localize("YZE.Surprise.SneakAttackModifier"), 3]);
    }
    if (options.divingBlow) modifiers.push([game.i18n.localize("YZE.Combat.DivingBlow"), 2]);
  }
  if (options.hardHitter) {
    modifiers.push([game.i18n.localize("YZE.Specialty.Effects.hardHitter"), 1]);
  }
  if (options.mountedRanged) {
    modifiers.push([game.i18n.localize("YZE.Mount.RangedPenalty"), -2]);
  }
  if (options.mountedRiderTarget) {
    modifiers.push([game.i18n.localize("YZE.Mount.RiderTargetPenalty"), -1]);
  }
  if (options.sniper) {
    modifiers.push([game.i18n.localize("YZE.Specialty.Effects.sniper"), 1]);
  }
  if (hasWeaponSpecialty(actor, weapon)) {
    modifiers.push([game.i18n.format("YZE.Specialty.WeaponSpecialistModifier", {
      weapon: weapon.name
    }), 1]);
  }
  return modifiers;
}

export async function attackWithWeapon(actor, weaponId, {
  overwatch = false,
  fixedModifiers = [],
  targetActorUuid = ""
} = {}) {
  const weapon = actor?.items?.get(weaponId);
  if (!weapon || weapon.type !== "weapon") return null;
  const injuryRestriction = getCriticalInjuryWeaponRestriction(actor, weapon);
  if (injuryRestriction) {
    notifyCriticalInjuryRestriction(actor, injuryRestriction);
    return null;
  }
  if (Number(weapon.system.quantity) <= 0) {
    ui.notifications.warn(game.i18n.localize("YZE.Combat.WeaponUnavailable"));
    return null;
  }
  if (getDiceSystem() === DICE_SYSTEMS.STEP && Number(weapon.system.reliability?.value) <= 0) {
    ui.notifications.warn(game.i18n.localize("YZE.Combat.BrokenWeapon"));
    return null;
  }
  if (!hasAttackAmmunition(weapon)) {
    ui.notifications.warn(game.i18n.localize("YZE.Combat.OutOfAmmunition"));
    return null;
  }
  if (weapon.system.requiresPreparation === true
    && actor.getFlag(SYSTEM_ID, "preparedRangedWeaponId") !== weapon.id) {
    ui.notifications.warn(game.i18n.format("YZE.Combat.PrepareWeaponFirst", { weapon: weapon.name }));
    return null;
  }
  let targets = [...(game.user?.targets ?? [])].filter((token) => token.actor);
  if (targetActorUuid) {
    const forcedTarget = await fromUuid(targetActorUuid);
    if (forcedTarget?.system) {
      const forcedToken = activeTokenForActor(forcedTarget);
      targets = [forcedToken ?? { actor: forcedTarget }];
    }
  }
  if (targets.length !== 1) {
    ui.notifications.warn(game.i18n.localize("YZE.Combat.SelectOneTarget"));
    return null;
  }
  let target = targets[0].actor;
  let mountedRiderTarget = false;
  const targetMount = mountForRider(target);
  if (targetMount) {
    const { DialogV2 } = foundry.applications.api;
    const choice = await DialogV2.wait({
      window: { title: game.i18n.localize("YZE.Mount.ChooseTarget") },
      content: `<div class="yze"><p>${escape(game.i18n.format("YZE.Mount.ChooseTargetHint", { rider: target.name, mount: targetMount.name }))}</p></div>`,
      buttons: [
        { action: "rider", label: target.name, icon: "fa-solid fa-person", default: true, callback: () => "rider" },
        { action: "mount", label: targetMount.name, icon: "fa-solid fa-horse", callback: () => "mount" },
        { action: "cancel", label: game.i18n.localize("YZE.Common.Cancel"), callback: () => null }
      ],
      close: () => null, rejectClose: false, modal: true
    });
    if (!choice) return null;
    if (choice === "mount") target = targetMount;
    else mountedRiderTarget = true;
  }
  const sourceToken = activeTokenForActor(actor);
  const spatial = sourceToken && targets[0]?.document
    ? rangeBetweenTokens(sourceToken, targets[0])
    : { configured: false };
  const pendingSurprise = pendingSneakAttack(actor, target);
  const options = await promptAttack(actor, target, weapon, { overwatch, surprise: pendingSurprise, spatial });
  if (!options) return null;
  if (options.ranged && isTravelEnabled()) {
    const weather = game.settings.get(SYSTEM_ID, "travelWeather");
    const shift = game.settings.get(SYSTEM_ID, "travelShift");
    const dark = ["evening", "night"].includes(shift);
    const visibilityMaximum = weather === "heavy" ? (dark ? "short" : "long")
      : dark && weather === "cloudy" ? "medium"
        : dark ? "long" : "extreme";
    if (RANGE_ORDER.indexOf(options.range) > RANGE_ORDER.indexOf(visibilityMaximum)) {
      ui.notifications.warn(game.i18n.format("YZE.Travel.VisibilityLimited", {
        range: game.i18n.localize(`YZE.Range.${visibilityMaximum}`)
      }));
      return null;
    }
  }
  if (target.type === "mount" && options.special !== "damage") {
    options.special = "damage";
    options.divingBlow = false;
    ui.notifications.info(game.i18n.localize("YZE.Mount.NormalDamageOnly"));
  }
  const attackerMount = mountForRider(actor);
  if (attackerMount && !options.ranged && String(weapon.system.grip || "").toUpperCase().includes("2H")) {
    ui.notifications.warn(game.i18n.localize("YZE.Mount.OneHandedOnly"));
    return null;
  }
  options.mountedRanged = Boolean(attackerMount && options.ranged);
  options.mountedRiderTarget = mountedRiderTarget;
  if (spatial.configured) {
    options.range = spatial.range;
    options.visibility = spatial.targetDimlyLit && options.ranged ? -2 : 0;
    if (!spatial.visible) {
      ui.notifications.warn(game.i18n.localize(`YZE.Zones.Sight.${spatial.reason}`));
      return null;
    }
    if (!options.ranged && spatial.range !== "engaged") {
      ui.notifications.warn(game.i18n.localize("YZE.Zones.MeleeRequiresEngaged"));
      return null;
    }
    if (!options.ranged && !spatial.reachable) {
      ui.notifications.warn(game.i18n.localize("YZE.Zones.MeleeBarrier"));
      return null;
    }
    if (options.ranged && !rangeAllows(spatial.range, weapon.system.range)) {
      ui.notifications.warn(game.i18n.format("YZE.Zones.WeaponOutOfRange", {
        weapon: weapon.name,
        range: game.i18n.localize(`YZE.Range.${spatial.range}`)
      }));
      return null;
    }
  }
  const chosenKind = options.ranged ? "ranged" : "melee";
  options.sneakAttack = Boolean(pendingSurprise && pendingSurprise.attackKind === chosenKind);
  if (pendingSurprise && !options.sneakAttack) {
    options.defenseless = false;
    options.surpriseForced = false;
    ui.notifications.info(game.i18n.localize("YZE.Surprise.KindMismatch"));
  }
  if (actor.system?.combat?.grappled === true
    && !actor.system?.combat?.grapplingTargetUuid) {
    ui.notifications.warn(game.i18n.localize("YZE.Combat.GrappledActionsOnly"));
    return null;
  }
  if (actor.system?.combat?.grapplingTargetUuid
    && options.special !== "grappleStrike") {
    ui.notifications.warn(game.i18n.localize("YZE.Combat.GrapplerActionsOnly"));
    return null;
  }
  const attackSkill = actor.items.get(options.skillId);
  const skillName = String(attackSkill?.name ?? "");
  if ((options.special !== "damage" || options.divingBlow)
    && skillName.localeCompare("Melee", undefined, { sensitivity: "base" }) !== 0) {
    ui.notifications.warn(game.i18n.localize("YZE.Combat.SpecialAttackRequiresMelee"));
    return null;
  }
  options.hardHitter = options.hardHitter
    && skillName.localeCompare("Melee", undefined, { sensitivity: "base" }) === 0;
  options.sniper = options.sniper
      && skillName.localeCompare("Marksmanship", undefined, { sensitivity: "base" }) === 0;
  if (options.divingBlow) options.special = "damage";
  if (options.special === "grappleStrike"
    && actor.system?.combat?.grapplingTargetUuid !== target.uuid) {
    ui.notifications.warn(game.i18n.localize("YZE.Combat.NotGrapplingTarget"));
    return null;
  }
  const needsDrawAction = weapon.system.equipped !== true
    && !hasSpecialty(actor, SPECIALTY_EFFECTS.QUICK_DRAW);
  const actionCost = {
    slow: options.special === "grappleStrike" ? 0 : 1,
    fast: (options.special === "grappleStrike" ? 1 : 0)
      + (options.aimed && !overwatch && !options.preparedAim ? 1 : 0)
      + (options.hardHitter ? 1 : 0)
      + (needsDrawAction ? 1 : 0)
  };
  if (!canSpendActorActions(actor, actionCost)) {
    ui.notifications.warn(game.i18n.localize("YZE.Combat.NotEnoughActions"));
    return null;
  }

  const attackCount = options.basicAutofire ? 3 : 1;
  const messages = [];
  for (let index = 0; index < attackCount; index += 1) {
    if (!hasAttackAmmunition(weapon)) break;
    const attackOptions = index === 0 ? options : {
      ...options,
      sneakAttack: false,
      defenseless: options.surpriseForced ? false : options.defenseless
    };
    const message = await actor.rollSkill(options.skillId, {
      canOppose: false,
      helpAction: actionCost.slow ? "slow" : "fast",
      excludedHelperUuids: [target.uuid],
      fixedModifiers: [...attackModifiers(attackOptions, actor, weapon), ...fixedModifiers],
      fixedGearIds: Number(weapon.system.bonus) > 0 ? [weapon.id] : [],
      ammoDice: options.ammoDice,
      attack: {
        attackerActorUuid: actor.uuid,
        targetActorUuid: target.uuid,
        targetName: target.name,
        weaponItemId: weapon.id,
        weaponName: weapon.name,
        armed: Boolean(String(weapon.system.grip || "").trim()),
        baseDamage: Math.max(0, Math.trunc(Number(weapon.system.damage) || 0)),
        critThreshold: Math.max(0, Math.trunc(Number(weapon.system.critThreshold) || 0)),
        critFormula: String(weapon.system.critFormula || "1d6 * 10 + 1d6"),
        kind: attackOptions.ranged ? "ranged" : "melee",
        range: attackOptions.range,
        special: attackOptions.special,
        blockable: !attackOptions.defenseless && attackOptions.special !== "grappleStrike",
        surprise: attackOptions.sneakAttack,
        sneakAttack: attackOptions.sneakAttack,
        divingBlow: options.divingBlow,
        ammunitionMode: getAmmunitionMode(),
        ammoDice: options.ammoDice,
        basicAutofire: options.basicAutofire,
        burstIndex: index + 1
      }
    });
    if (!message) break;
    messages.push(message);
    if (index === 0 && options.sneakAttack) await consumeSneakAttack(actor);
    await spendAttackAmmunition(weapon, message);
    const state = message.getFlag(SYSTEM_ID, "push");
    if (!options.basicAutofire || combatRollSuccesses(state) < 1) break;
  }
  if (messages.length === 0) return null;
  await spendActorActions(actor, {
    ...actionCost,
    preserveOverwatch: overwatch,
    preserveAim: options.preparedAim,
    preservePreparedWeapon: weapon.system.requiresPreparation === true
  });
  if (options.basicAutofire && getAmmunitionMode() === AMMUNITION_MODES.SUPPLY) {
    await rollAmmunitionSupply(actor, weapon);
  }
  if (weapon.system.equipped !== true) await weapon.update({ "system.equipped": true });
  if (options.divingBlow && actor.system?.combat) {
    await actor.update({ "system.combat.prone": true });
  }
  if (options.preparedAim) await cancelPreparedAim(actor);
  if (weapon.system.requiresPreparation === true) await actor.unsetFlag(SYSTEM_ID, "preparedRangedWeaponId");
  if (overwatch) await cancelOverwatch(actor);
  return messages.at(-1);
}

function namedSkill(actor, name) {
  return actor?.items?.find((item) => item.type === "skill"
    && item.name.localeCompare(name, undefined, { sensitivity: "base" }) === 0) ?? null;
}

export function advancedCombatState(actor) {
  const combat = actor?.system?.combat ?? {};
  const cover = combat.cover ?? {};
  const stepDice = getDiceSystem() === DICE_SYSTEMS.STEP;
  const coverRating = Math.max(0, Math.trunc(Number(
    stepDice ? cover.stepRating : cover.rating
  ) || 0));
  return {
    prone: combat.prone === true,
    grappled: combat.grappled === true,
    grappling: Boolean(combat.grapplingTargetUuid),
    coverActive: cover.active === true && coverRating > 0,
    coverLabel: String(cover.label || game.i18n.localize("YZE.Combat.Cover")),
    coverRating,
    coverRatingLabel: stepDice
      ? (coverRating > 0 ? `${["", "D", "C", "B", "A"][coverRating]}` : "—")
      : String(coverRating),
    overwatchActive: combat.overwatch?.active === true,
    overwatchDirection: String(combat.overwatch?.direction || ""),
    overwatchWeaponId: String(combat.overwatch?.weaponItemId || ""),
    aimActive: combat.aim?.active === true
  };
}

export async function takeCover(actor) {
  if (!canSpendActorActions(actor, { fast: 1 })) return false;
  const stepDice = getDiceSystem() === DICE_SYSTEMS.STEP;
  const zoneCover = zoneCoverForActor(actor);
  const presets = stepDice
    ? [[1, "Furniture"], [2, "Wooden Door / Tree Trunk"], [3, "Wooden Wall"], [4, "Stone Wall"]]
    : [[3, "Furniture"], [4, "Wooden Door"], [5, "Tree Trunk"], [6, "Wooden Wall"], [8, "Stone Wall"]];
  const zoneRating = zoneCover ? Number(stepDice ? zoneCover.stepRating : zoneCover.rating) || 0 : 0;
  if (zoneRating > 0 && !presets.some(([rating]) => rating === zoneRating)) {
    presets.unshift([zoneRating, zoneCover.label]);
  }
  const options = presets.map(([rating, label]) => `<option value="${rating}"${zoneRating === rating ? " selected" : ""}>${escape(label)} — ${escape(
    stepDice ? ["", "D", "C", "B", "A"][rating] : rating
  )}</option>`).join("");
  const { DialogV2 } = foundry.applications.api;
  const choice = await DialogV2.wait({
    window: { title: game.i18n.localize("YZE.Combat.TakeCover") },
    content: `<div class="yze"><div class="form-group"><label>${escape(game.i18n.localize("YZE.Combat.CoverType"))}</label><select name="rating">${options}</select></div><div class="form-group"><label>${escape(game.i18n.localize("YZE.Combat.CoverName"))}</label><input name="label" type="text" value="${escape(zoneCover?.label ?? "")}"></div></div>`,
    buttons: [{
      action: "take",
      label: game.i18n.localize("YZE.Combat.TakeCover"),
      icon: "fa-solid fa-shield",
      default: true,
      callback: (event, button, dialog) => {
        const form = button.form ?? dialog.element.querySelector("form");
        const rating = Math.max(0, Math.trunc(Number(form.elements.rating?.value) || 0));
        const preset = presets.find(([value]) => value === rating);
        return { rating, label: String(form.elements.label?.value || preset?.[1] || "Cover").trim() };
      }
    }, { action: "cancel", label: game.i18n.localize("YZE.Common.Cancel"), callback: () => null }],
    close: () => null,
    rejectClose: false,
    modal: true
  });
  if (!choice) return false;
  if (!await spendActorActions(actor, { fast: 1 })) return false;
  await actor.update({
    "system.combat.cover.active": true,
    "system.combat.cover.label": choice.label,
    [`system.combat.cover.${stepDice ? "stepRating" : "rating"}`]: choice.rating,
    [`system.combat.cover.${stepDice ? "maxStepRating" : "maxRating"}`]: choice.rating
  });
  return true;
}

export async function leaveCover(actor) {
  if (!actor?.system?.combat?.cover?.active) return false;
  await actor.update({ "system.combat.cover.active": false });
  return true;
}

export async function toggleProne(actor) {
  const prone = actor?.system?.combat?.prone === true;
  if (prone && !await spendActorActions(actor, { fast: 1 })) return false;
  await actor.update({ "system.combat.prone": !prone });
  return true;
}

export async function assumeOverwatch(actor) {
  const weapons = actor?.items?.filter((item) => item.type === "weapon"
    && item.system.equipped === true && item.system.range !== "engaged"
    && Number(item.system.quantity) > 0) ?? [];
  if (weapons.length === 0) {
    ui.notifications.warn(game.i18n.localize("YZE.Combat.NoOverwatchWeapon"));
    return false;
  }
  if (!canSpendActorActions(actor, { fast: 1 })) return false;
  const options = weapons.map((weapon) => `<option value="${escape(weapon.id)}">${escape(weapon.name)}</option>`).join("");
  const { DialogV2 } = foundry.applications.api;
  const result = await DialogV2.wait({
    window: { title: game.i18n.localize("YZE.Combat.AssumeOverwatch") },
    content: `<div class="yze"><div class="form-group"><label>${escape(game.i18n.localize("YZE.Actor.Item"))}</label><select name="weapon">${options}</select></div><div class="form-group"><label>${escape(game.i18n.localize("YZE.Combat.Direction"))}</label><input name="direction" type="text"></div></div>`,
    buttons: [{
      action: "assume", label: game.i18n.localize("YZE.Combat.AssumeOverwatch"), default: true,
      callback: (event, button, dialog) => {
        const form = button.form ?? dialog.element.querySelector("form");
        return { weaponId: form.elements.weapon?.value, direction: String(form.elements.direction?.value || "").trim() };
      }
    }, { action: "cancel", label: game.i18n.localize("YZE.Common.Cancel"), callback: () => null }],
    close: () => null, rejectClose: false, modal: true
  });
  if (!result || !weapons.some((weapon) => weapon.id === result.weaponId)) return false;
  const injuryRestriction = getCriticalInjuryWeaponRestriction(
    actor, weapons.find((weapon) => weapon.id === result.weaponId)
  );
  if (injuryRestriction) {
    notifyCriticalInjuryRestriction(actor, injuryRestriction);
    return false;
  }
  const overwatchWeapon = weapons.find((weapon) => weapon.id === result.weaponId);
  if (overwatchWeapon?.system.requiresPreparation === true
    && actor.getFlag(SYSTEM_ID, "preparedRangedWeaponId") !== overwatchWeapon.id) {
    ui.notifications.warn(game.i18n.format("YZE.Combat.PrepareWeaponFirst", { weapon: overwatchWeapon.name }));
    return false;
  }
  if (!await spendActorActions(actor, {
    fast: 1,
    preserveOverwatch: true,
    preservePreparedWeapon: overwatchWeapon?.system.requiresPreparation === true
  })) return false;
  await actor.update({
    "system.combat.overwatch.active": true,
    "system.combat.overwatch.direction": result.direction,
    "system.combat.overwatch.weaponItemId": result.weaponId
  });
  return true;
}

export async function cancelOverwatch(actor) {
  if (!actor?.system?.combat?.overwatch?.active) return false;
  await actor.update({
    "system.combat.overwatch.active": false,
    "system.combat.overwatch.direction": "",
    "system.combat.overwatch.weaponItemId": ""
  });
  return true;
}

export async function fireOverwatch(actor) {
  const weaponId = actor?.system?.combat?.overwatch?.weaponItemId;
  if (!actor?.system?.combat?.overwatch?.active || !weaponId) return null;
  const targetTokens = [...(game.user?.targets ?? [])].filter((token) => token.actor);
  const targetToken = targetTokens[0];
  const target = targetToken?.actor;
  if (targetTokens.length !== 1 || !target) {
    ui.notifications.warn(game.i18n.localize("YZE.Combat.SelectOneTarget"));
    return null;
  }
  const round = Math.max(0, Number(game.combat?.round) || 0);
  let order = actor.getFlag(SYSTEM_ID, "simultaneousOverwatch");
  const mutual = target.system?.combat?.overwatch?.active === true
    && Boolean(target.system.combat.overwatch.weaponItemId);
  if (mutual && (!order || Number(order.round) !== round || order.opponentUuid !== target.uuid)) {
    if (!game.user?.isGM && (actor.isOwner === false || target.isOwner === false)) {
      ui.notifications.warn(game.i18n.localize("YZE.Combat.GMResolveSimultaneousOverwatch"));
      return null;
    }
    const attackerSkill = namedSkill(actor, "Marksmanship");
    const targetSkill = namedSkill(target, "Marksmanship");
    if (!attackerSkill || !targetSkill) {
      ui.notifications.warn(game.i18n.localize("YZE.Combat.MarksmanshipRequired"));
      return null;
    }
    const attackerMessage = await actor.rollSkill(attackerSkill.id, {
      canPush: false, canOppose: false, allowHelpers: false, allowAttemptTracking: false,
      labelOverride: game.i18n.localize("YZE.Combat.OverwatchOrder")
    });
    const targetMessage = await target.rollSkill(targetSkill.id, {
      canPush: false, canOppose: false, allowHelpers: false, allowAttemptTracking: false,
      labelOverride: game.i18n.localize("YZE.Combat.OverwatchOrder")
    });
    if (!attackerMessage || !targetMessage) return null;
    const attackerSuccesses = combatRollSuccesses(attackerMessage.getFlag(SYSTEM_ID, "push"));
    const targetSuccesses = combatRollSuccesses(targetMessage.getFlag(SYSTEM_ID, "push"));
    const first = attackerSuccesses > targetSuccesses ? actor : target;
    const second = first.uuid === actor.uuid ? target : actor;
    const shared = { round, firstUuid: first.uuid, secondUuid: second.uuid, firstFired: false };
    await actor.setFlag(SYSTEM_ID, "simultaneousOverwatch", { ...shared, opponentUuid: target.uuid });
    await target.setFlag(SYSTEM_ID, "simultaneousOverwatch", { ...shared, opponentUuid: actor.uuid });
    await ChatMessage.create({
      content: `<div class="yze chat-card"><h3>${escape(game.i18n.localize("YZE.Combat.SimultaneousOverwatch"))}</h3><p>${escape(game.i18n.format("YZE.Combat.SimultaneousOverwatchOrder", { first: first.name, second: second.name }))}</p></div>`
    });
    return attackerMessage;
  }
  if (order && Number(order.round) === round) {
    if (actor.uuid === order.secondUuid && order.firstFired !== true) {
      const first = await fromUuid(order.firstUuid);
      ui.notifications.warn(game.i18n.format("YZE.Combat.OverwatchWaitFor", { actor: first?.name ?? "" }));
      return null;
    }
    const opponentUuid = order.opponentUuid || target.uuid;
    const message = await attackWithWeapon(actor, weaponId, {
      overwatch: true,
      targetActorUuid: opponentUuid
    });
    if (!message) return null;
    const opponent = await fromUuid(opponentUuid);
    if (actor.uuid === order.firstUuid) {
      const next = { ...order, firstFired: true };
      await actor.setFlag(SYSTEM_ID, "simultaneousOverwatch", next);
      if (opponent?.system) await opponent.setFlag(SYSTEM_ID, "simultaneousOverwatch", {
        ...next,
        opponentUuid: actor.uuid
      });
    } else {
      await actor.unsetFlag(SYSTEM_ID, "simultaneousOverwatch");
      if (opponent?.system) await opponent.unsetFlag(SYSTEM_ID, "simultaneousOverwatch");
    }
    return message;
  }
  return attackWithWeapon(actor, weaponId, { overwatch: true });
}

export async function cancelPreparedAim(actor) {
  if (!actor?.system?.combat?.aim?.active) return false;
  await actor.update({
    "system.combat.aim.active": false,
    "system.combat.aim.weaponItemId": "",
    "system.combat.aim.preparedRound": 0
  });
  return true;
}

export async function prepareTelescopicAim(actor) {
  const weapons = actor?.items?.filter((item) => item.type === "weapon"
    && item.system.equipped === true && item.system.range !== "engaged"
    && item.system.telescopicSight === true) ?? [];
  if (weapons.length === 0) {
    ui.notifications.warn(game.i18n.localize("YZE.Combat.NoTelescopicWeapon"));
    return false;
  }
  if (!canSpendActorActions(actor, { slow: 1 })) return false;
  const options = weapons.map((weapon) => `<option value="${escape(weapon.id)}">${escape(weapon.name)}</option>`).join("");
  const { DialogV2 } = foundry.applications.api;
  const weaponId = await DialogV2.wait({
    window: { title: game.i18n.localize("YZE.Combat.PrepareTelescopicAim") },
    content: `<div class="yze"><div class="form-group"><label>${escape(game.i18n.localize("YZE.Actor.Item"))}</label><select name="weapon">${options}</select></div></div>`,
    buttons: [{ action: "aim", label: game.i18n.localize("YZE.Combat.PrepareTelescopicAim"), default: true,
      callback: (event, button, dialog) => (button.form ?? dialog.element.querySelector("form")).elements.weapon?.value },
      { action: "cancel", label: game.i18n.localize("YZE.Common.Cancel"), callback: () => null }],
    close: () => null, rejectClose: false, modal: true
  });
  if (!weaponId || !weapons.some((weapon) => weapon.id === weaponId)) return false;
  const injuryRestriction = getCriticalInjuryWeaponRestriction(
    actor, weapons.find((weapon) => weapon.id === weaponId)
  );
  if (injuryRestriction) {
    notifyCriticalInjuryRestriction(actor, injuryRestriction);
    return false;
  }
  const aimedWeapon = weapons.find((weapon) => weapon.id === weaponId);
  if (!await spendActorActions(actor, {
    slow: 1,
    preserveAim: true,
    preservePreparedWeapon: aimedWeapon?.system.requiresPreparation === true
  })) return false;
  await actor.update({
    "system.combat.aim.active": true,
    "system.combat.aim.weaponItemId": weaponId,
    "system.combat.aim.preparedRound": Math.max(0, Number(game.combat?.round) || 0)
  });
  return true;
}

async function clearGrapple(actor, opponent = null) {
  await actor.update({
    "system.combat.grappled": false,
    "system.combat.grapplerUuid": "",
    "system.combat.grapplingTargetUuid": ""
  });
  if (opponent && (opponent.isOwner !== false || game.user?.isGM)) {
    await opponent.update({
      "system.combat.grappled": false,
      "system.combat.grapplerUuid": "",
      "system.combat.grapplingTargetUuid": ""
    });
  }
}

export async function releaseGrapple(actor) {
  const opponentUuid = actor?.system?.combat?.grapplingTargetUuid
    || actor?.system?.combat?.grapplerUuid;
  const opponent = opponentUuid ? await fromUuid(opponentUuid) : null;
  await clearGrapple(actor, opponent);
  return true;
}

export async function breakGrapple(actor) {
  const opponentUuid = actor?.system?.combat?.grapplerUuid;
  const opponent = opponentUuid ? await fromUuid(opponentUuid) : null;
  const activeSkill = namedSkill(actor, "Melee");
  const opposingSkill = namedSkill(opponent, "Melee");
  if (!opponent || !activeSkill || !opposingSkill) {
    ui.notifications.warn(game.i18n.localize("YZE.Combat.GrappleUnavailable"));
    return false;
  }
  if (!canSpendActorActions(actor, { slow: 1 })) return false;
  const activeMessage = await actor.rollSkill(activeSkill.id, {
    canPush: false,
    canOppose: false,
    helpAction: "slow",
    excludedHelperUuids: [opponent.uuid]
  });
  if (!activeMessage) return false;
  const opposingMessage = await opponent.rollSkill(opposingSkill.id, {
    canPush: false,
    canOppose: false,
    allowHelpers: false,
    excludedHelperUuids: [actor.uuid]
  });
  if (!opposingMessage) return false;
  await spendActorActions(actor, { slow: 1 });
  const active = combatRollSuccesses(activeMessage.getFlag(SYSTEM_ID, "push"));
  const opposition = combatRollSuccesses(opposingMessage.getFlag(SYSTEM_ID, "push"));
  if (active > opposition) await clearGrapple(actor, opponent);
  await ChatMessage.create({ content: `<div class="yze chat-card"><p>${escape(game.i18n.format(
    active > opposition ? "YZE.Combat.BrokeFree" : "YZE.Combat.RemainsGrappled",
    { actor: actor.name, active, opposition }
  ))}</p></div>` });
  return active > opposition;
}

export async function retreat(actor) {
  const skill = namedSkill(actor, "Mobility");
  const token = activeTokenForActor(actor);
  const enemies = token ? engagedHostileTokens(token) : [];
  if (!token || enemies.length === 0) {
    ui.notifications.warn(game.i18n.localize("YZE.Combat.RetreatNoEngagedEnemy"));
    return null;
  }
  const restrictions = getCriticalInjuryRestrictions(actor);
  if (restrictions.movement === "none") {
    notifyCriticalInjuryRestriction(actor, {
      kind: "movement",
      sources: restrictions.movementSources
    });
    return null;
  }
  const actionCost = restrictions.movement === "slow" ? { slow: 1 } : { fast: 1 };
  if (!skill || !canSpendActorActions(actor, actionCost)) return null;
  const message = await actor.rollSkill(skill.id, {
    canOppose: false,
    helpAction: actionCost.slow ? "slow" : "fast",
    retreat: { actorUuid: actor.uuid }
  });
  if (!message) return null;
  if (!await spendActorActions(actor, actionCost)) return null;
  const successes = combatRollSuccesses(message.getFlag(SYSTEM_ID, "push"));
  await actor.setFlag(SYSTEM_ID, "retreatMovement", {
    combatId: game.combat?.id ?? "",
    round: Number(game.combat?.round) || 0,
    nonce: foundry.utils.randomID(),
    rollMessageId: message.id,
    failed: successes < 1,
    consumed: false,
    attackerTokenUuids: [],
    targetTokenUuid: "",
    eligibleAttackerTokenUuids: enemies.map((enemy) => enemy.uuid)
  });
  await ChatMessage.create({ content: `<div class="yze chat-card"><p>${escape(game.i18n.format(
    successes > 0 ? "YZE.Combat.RetreatSucceeded" : "YZE.Combat.RetreatFailed",
    { actor: actor.name }
  ))}</p></div>` });
  return message;
}

/** Keep an unconsumed Retreat permission aligned with the final pushed result. */
export async function refreshRetreatAfterPush(originalMessage, pushedMessage, pushedState) {
  if (!pushedState?.retreat?.actorUuid) return false;
  const actor = await fromUuid(pushedState.retreat.actorUuid);
  const pending = actor?.getFlag?.(SYSTEM_ID, "retreatMovement");
  if (!actor || !pending || pending.consumed === true
    || ![originalMessage.id, pushedMessage.id].includes(pending.rollMessageId)) return false;
  await actor.setFlag(SYSTEM_ID, "retreatMovement", {
    ...pending,
    rollMessageId: pushedMessage.id,
    failed: combatRollSuccesses(pushedState) < 1
  });
  return true;
}

function freeAttackWeapon(actor) {
  const usable = actor?.items?.filter((item) => (
    item.type === "weapon"
    && item.system.range === "engaged"
    && item.system.equipped === true
    && Number(item.system.quantity) > 0
    && (getDiceSystem() !== DICE_SYSTEMS.STEP || Number(item.system.reliability?.value) > 0)
    && !getCriticalInjuryWeaponRestriction(actor, item)
  )) ?? [];
  usable.sort((left, right) => (
    Number(right.system.damage) - Number(left.system.damage)
    || Number(right.system.bonus) - Number(left.system.bonus)
    || left.name.localeCompare(right.name)
  ));
  if (usable[0]) return usable[0];
  return actor?.items?.find((item) => (
    item.type === "weapon"
    && item.name.localeCompare("Unarmed", undefined, { sensitivity: "base" }) === 0
    && Number(item.system.quantity) > 0
  )) ?? null;
}

async function performFailedRetreatFreeAttack(attacker, target) {
  if (!attacker || !target || attacker.system?.dead === true) return null;
  const skill = namedSkill(attacker, "Melee");
  if (!skill) {
    await ChatMessage.create({ content: `<div class="yze chat-card"><p>${escape(game.i18n.format(
      "YZE.Combat.RetreatFreeAttackNoSkill", { attacker: attacker.name }
    ))}</p></div>` });
    return null;
  }
  const weapon = freeAttackWeapon(attacker);
  const weaponName = weapon?.name || game.i18n.localize("YZE.Combat.UnarmedFreeAttack");
  const weaponData = weapon?.system ?? {};
  const options = {
    ranged: false,
    range: "engaged",
    attackerProne: attacker.system?.combat?.prone === true,
    targetProne: target.system?.combat?.prone === true,
    defenseless: false,
    sneakAttack: false,
    divingBlow: false,
    hardHitter: false,
    sniper: false
  };
  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor: attacker }),
    content: `<div class="yze chat-card"><p>${escape(game.i18n.format(
      "YZE.Combat.RetreatFreeAttackBegins",
      { attacker: attacker.name, target: target.name, weapon: weaponName }
    ))}</p></div>`
  });
  return attacker.rollSkill(skill.id, {
    canOppose: false,
    allowHelpers: false,
    allowAttemptTracking: false,
    excludedHelperUuids: [target.uuid],
    fixedModifiers: attackModifiers(options, attacker, weapon ?? { name: weaponName }),
    fixedGearIds: weapon && Number(weaponData.bonus) > 0 ? [weapon.id] : [],
    attack: {
      attackerActorUuid: attacker.uuid,
      targetActorUuid: target.uuid,
      targetName: target.name,
      weaponItemId: weapon?.id ?? null,
      weaponName,
      armed: Boolean(weapon && String(weaponData.grip || "").trim()),
      baseDamage: weapon
        ? Math.max(0, Math.trunc(Number(weaponData.damage) || 0))
        : 1,
      critThreshold: Math.max(0, Math.trunc(Number(weaponData.critThreshold) || 0)),
      critFormula: String(weaponData.critFormula || "1d6 * 10 + 1d6"),
      kind: "melee",
      range: "engaged",
      special: "damage",
      blockable: false,
      freeRetreatAttack: true,
      ammunitionMode: getAmmunitionMode(),
      ammoDice: 0,
      basicAutofire: false,
      burstIndex: 1
    }
  });
}

/** Resolve every active enemy actually left behind by a failed canvas Retreat. */
export async function resolveFailedRetreatFreeAttacks(targetActorUuid, nonce) {
  const target = targetActorUuid ? await fromUuid(targetActorUuid) : null;
  const pending = target?.getFlag?.(SYSTEM_ID, "retreatMovement");
  if (!target || !pending || pending.nonce !== nonce || pending.failed !== true
    || pending.consumed !== true || pending.combatId !== game.combat?.id
    || Number(pending.round) !== (Number(game.combat?.round) || 0)
    || !actorCombatant(target)) return [];
  const rollMessage = game.messages?.get(pending.rollMessageId);
  const rollState = rollMessage?.getFlag(SYSTEM_ID, "push");
  if (!rollState?.retreat || rollState.actorUuid !== target.uuid
    || combatRollSuccesses(rollState) > 0) return [];
  const targetToken = pending.targetTokenUuid ? await fromUuid(pending.targetTokenUuid) : null;
  const attackers = [];
  const eligible = new Set(pending.eligibleAttackerTokenUuids ?? []);
  for (const uuid of pending.attackerTokenUuids ?? []) {
    const token = await fromUuid(uuid);
    if (!eligible.has(uuid) || !token?.actor || !targetToken
      || Number(token.disposition) * Number(targetToken.disposition) >= 0
      || !actorCombatant(token.actor) || token.actor.system?.dead === true) continue;
    attackers.push(token.actor);
  }
  await target.unsetFlag(SYSTEM_ID, "retreatMovement");
  const messages = [];
  for (const attacker of attackers) {
    const message = await performFailedRetreatFreeAttack(attacker, target);
    if (message) messages.push(message);
  }
  return messages;
}

export async function requestFailedRetreatFreeAttacks(target) {
  const pending = target?.getFlag?.(SYSTEM_ID, "retreatMovement");
  if (!target || !pending?.failed || !pending?.consumed) return [];
  const gm = primaryActiveGM();
  if (!gm || gm.id === game.user?.id) {
    return resolveFailedRetreatFreeAttacks(target.uuid, pending.nonce);
  }
  game.socket.emit(COMBAT_SOCKET, {
    action: "failedRetreatFreeAttacks",
    targetActorUuid: target.uuid,
    nonce: pending.nonce,
    requesterId: game.user?.id
  });
  return [];
}

export function registerCombatHooks() {
  Hooks.once("ready", () => game.socket?.on(COMBAT_SOCKET, (data) => {
    if (data?.action !== "failedRetreatFreeAttacks" || !isPrimaryActiveGM()) return;
    (async () => {
      const requester = game.users?.get(data.requesterId);
      const target = data.targetActorUuid ? await fromUuid(data.targetActorUuid) : null;
      if (!requester?.active || !target?.testUserPermission?.(requester, "OWNER")) return;
      await resolveFailedRetreatFreeAttacks(data.targetActorUuid, data.nonce);
    })().catch((error) => {
      console.error("YZE System Toolkit | Failed Retreat free attack could not be resolved", error);
    });
  }));
  const renderActorSheet = (combatant) => combatant?.actor?.sheet?.render({ force: false });
  const consumeSkippedTurn = async (combat) => {
    const combatant = combat.combatant;
    if (!combatant?.getFlag(SYSTEM_ID, "skipNextTurn")) return;
    await combatant.setFlag(SYSTEM_ID, "actions", {
      round: Number(combat.round) || 0,
      fast: 1,
      slow: true,
      exchangeLockedRound: Number(combat.round) || 0
    });
    await combatant.unsetFlag(SYSTEM_ID, "skipNextTurn");
    await ChatMessage.create({ content: `<div class="yze chat-card"><p>${escape(game.i18n.format(
      "YZE.Vehicle.SkidTurnSkipped", { driver: combatant.name }
    ))}</p></div>` });
    renderActorSheet(combatant);
  };
  Hooks.on("updateCombat", (combat, changed) => {
    if (!Object.hasOwn(changed, "round") || !isPrimaryActiveGM()) return;
    (async () => {
      await resetRoundActions(combat);
      if (getInitiativeMode() === INITIATIVE_MODES.HIDDEN_CARDS
        && Number(changed.round) > 1) {
        await combat.rollInitiative([...combat.combatants].map((combatant) => combatant.id), {
          updateTurn: false
        });
      }
      await consumeSkippedTurn(combat);
    })().catch((error) => {
      console.error("YZE System Toolkit | Could not begin the new combat round", error);
    });
  });
  Hooks.on("updateCombat", (combat, changed) => {
    if (!Object.hasOwn(changed, "turn") || Object.hasOwn(changed, "round")
      || !isPrimaryActiveGM()) return;
    consumeSkippedTurn(combat)
      .catch((error) => console.error("YZE System Toolkit | Could not skip skid turn", error));
  });
  const concealHiddenInitiative = (_application, element) => {
    if (getInitiativeMode() !== INITIATIVE_MODES.HIDDEN_CARDS || game.user?.isGM) return;
    const root = element?.querySelector ? element : element?.[0];
    for (const row of root?.querySelectorAll?.("[data-combatant-id]") ?? []) {
      const combatant = game.combat?.combatants?.get(row.dataset.combatantId);
      if (combatant?.actor?.isOwner) continue;
      for (const value of row.querySelectorAll(".token-initiative, .combatant-initiative")) {
        if (value.tagName === "INPUT") {
          value.value = "";
          value.placeholder = "?";
        } else {
          value.textContent = "?";
        }
      }
    }
  };
  Hooks.on("renderCombatTracker", concealHiddenInitiative);
  Hooks.on("renderCombatTrackerHTML", concealHiddenInitiative);
  Hooks.on("updateCombatant", (combatant) => {
    renderActorSheet(combatant);
  });
  Hooks.on("createCombatant", renderActorSheet);
  Hooks.on("deleteCombatant", renderActorSheet);
  Hooks.on("combatStart", (combat) => {
    for (const combatant of combat.combatants) renderActorSheet(combatant);
  });
  Hooks.on("deleteCombat", (combat) => {
    for (const combatant of combat.combatants) renderActorSheet(combatant);
  });
}
