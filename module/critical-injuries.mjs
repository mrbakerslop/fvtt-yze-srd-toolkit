import {
  ATTRIBUTE_GROUPS,
  CONDITIONS,
  CRITICAL_INJURY_TRIGGERS,
  DICE_SYSTEMS,
  HARM_MODELS,
  SPECIALTY_EFFECTS,
  SYSTEM_ID
} from "./constants.mjs";
import {
  getAttributeLabels,
  getCriticalInjuryTrigger,
  getDiceSystem,
  getHarmModel,
  isCriticalInjuriesEnabled
} from "./settings.mjs";
import { hasSpecialty } from "./specialties.mjs";
import { countStateSuccesses } from "./dice/successes.mjs";
import { getSRDRollTable } from "./srd-content/packs.mjs";

const CATEGORIES = Object.freeze(["physical", "mental"]);
const TABLE_NAMES = Object.freeze({
  physical: "YZE Physical Critical Injuries",
  mental: "YZE Mental Critical Injuries"
});

function escape(value) {
  return foundry.utils.escapeHTML(String(value));
}

function list(value) {
  return String(value ?? "")
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
}

function categoryLabel(category) {
  return game.i18n.localize(`YZE.CriticalInjury.${category}`);
}

function canUpdateActor(actor) {
  return Boolean(actor) && (actor.isOwner !== false || game.user?.isGM === true);
}

/** Resolve one explicitly contextual recurring trauma effect from its Actor sheet. */
export async function triggerCriticalInjury(actor, injury) {
  if (!canUpdateActor(actor) || injury?.type !== "criticalInjury"
    || injury.system.active !== true || !injury.system.triggerKind) return false;
  const trigger = injury.system.triggerKind;
  if (trigger === "hallucinations") {
    const insight = actor.items.find((item) => item.type === "skill"
      && item.name.localeCompare("Insight", undefined, { sensitivity: "base" }) === 0);
    if (!insight) {
      ui.notifications.warn(game.i18n.format("YZE.CriticalInjury.TriggerSkillMissing", { skill: "Insight" }));
      return false;
    }
    const message = await actor.rollSkill(insight.id, {
      canPush: false, canOppose: false, allowHelpers: false, allowAttemptTracking: false,
      labelOverride: game.i18n.format("YZE.CriticalInjury.TriggerRoll", { injury: injury.name })
    });
    if (!message) return false;
    const successes = countStateSuccesses(message.getFlag(SYSTEM_ID, "push"));
    await ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor }),
      content: `<div class="yze chat-card"><p>${escape(game.i18n.format(
        successes > 0 ? "YZE.CriticalInjury.HallucinationResisted" : "YZE.CriticalInjury.HallucinationTriggered",
        { actor: actor.name, injury: injury.name }
      ))}</p></div>`
    });
    return message;
  }
  if (trigger === "alcohol") {
    const day = Math.floor((Number(game.time?.worldTime) || 0) / 86400);
    if (Number(injury.getFlag(SYSTEM_ID, "requirementMetDay")) === day) {
      ui.notifications.info(game.i18n.localize("YZE.CriticalInjury.RequirementAlreadyMet"));
      return false;
    }
    const { DialogV2 } = foundry.applications.api;
    const outcome = await DialogV2.wait({
      window: { title: injury.name },
      content: `<div class="yze"><p>${escape(game.i18n.localize("YZE.CriticalInjury.AlcoholPrompt"))}</p></div>`,
      buttons: [
        { action: "met", label: game.i18n.localize("YZE.CriticalInjury.RequirementMet"), default: true, callback: () => "met" },
        { action: "missed", label: game.i18n.localize("YZE.CriticalInjury.ApplyTriggerDamage"), callback: () => "missed" },
        { action: "cancel", label: game.i18n.localize("YZE.Common.Cancel"), callback: () => null }
      ], close: () => null, rejectClose: false, modal: true
    });
    if (outcome === "met") {
      await injury.setFlag(SYSTEM_ID, "requirementMetDay", day);
      return true;
    }
    if (outcome !== "missed") return false;
  }
  const attributeKey = trigger === "alcohol" ? "agility" : "wits";
  const { applyDamage } = await import("./harm.mjs");
  await applyDamage(actor, 1, { category: "mental", attributeKey, skipCriticalInjury: true });
  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    content: `<div class="yze chat-card"><p>${escape(game.i18n.format("YZE.CriticalInjury.TriggerApplied", { actor: actor.name, injury: injury.name }))}</p></div>`
  });
  return true;
}

function activeRestrictionItems(actor) {
  if (!isCriticalInjuriesEnabled()) return [];
  return actor?.items?.filter((item) => (
    item.type === "criticalInjury" && item.system.active === true
  )) ?? [];
}

/** Aggregate deterministic restrictions from every active Critical Injury on an Actor. */
export function getCriticalInjuryRestrictions(actor) {
  const injuries = activeRestrictionItems(actor);
  const movementNone = injuries.filter((item) => item.system.movementRestriction === "none");
  const movementSlow = injuries.filter((item) => item.system.movementRestriction === "slow");
  const actionSources = injuries.filter((item) => item.system.blocksActions === true);
  const handSources = injuries.filter((item) => Number(item.system.disabledHands) > 0);
  const blockedAttributes = new Map();
  for (const item of injuries) {
    for (const attribute of list(item.system.blockedAttributes)) {
      const sources = blockedAttributes.get(attribute) ?? [];
      sources.push(item);
      blockedAttributes.set(attribute, sources);
    }
  }
  const sleepInsight = injuries.filter((item) => item.system.sleepRestriction === "insight");
  const sleepDaylight = injuries.filter((item) => item.system.sleepRestriction === "daylight");
  return {
    active: injuries.length > 0,
    injuries,
    blocksActions: actionSources.length > 0,
    actionSources,
    movement: movementNone.length > 0 ? "none" : movementSlow.length > 0 ? "slow" : "",
    movementSources: movementNone.length > 0 ? movementNone : movementSlow,
    disabledHands: Math.min(2, handSources.reduce(
      (total, item) => total + Math.max(0, Math.trunc(Number(item.system.disabledHands) || 0)), 0
    )),
    handSources,
    blockedAttributes,
    sleepInsight,
    sleepDaylight
  };
}

/** Return a blocking Critical Injury rule for a roll, or null when the roll is allowed. */
export function getCriticalInjuryRollRestriction(actor, attributeKey) {
  const restrictions = getCriticalInjuryRestrictions(actor);
  if (restrictions.blocksActions) {
    return { kind: "actions", sources: restrictions.actionSources };
  }
  const sources = restrictions.blockedAttributes.get(String(attributeKey ?? "").toLowerCase()) ?? [];
  return sources.length > 0 ? { kind: "attribute", sources, attributeKey } : null;
}

/** Infer how many hands a Weapon requires from its configured Grip. */
export function weaponRequiredHands(weapon) {
  const grip = String(weapon?.system?.grip ?? "").trim().toLowerCase();
  if (!grip || weapon?.name?.localeCompare("Unarmed", undefined, { sensitivity: "base" }) === 0) {
    return 0;
  }
  if (/(?:^|\D)2(?:\D|$)|two[ -]?hand|2h/.test(grip)) return 2;
  return 1;
}

/** Return a restriction when the Actor lacks enough usable hands for a Weapon. */
export function getCriticalInjuryWeaponRestriction(actor, weapon) {
  const restrictions = getCriticalInjuryRestrictions(actor);
  if (restrictions.blocksActions) {
    return { kind: "actions", sources: restrictions.actionSources };
  }
  const requiredHands = weaponRequiredHands(weapon);
  const usableHands = Math.max(0, 2 - restrictions.disabledHands);
  if (requiredHands <= usableHands) return null;
  return {
    kind: "hands",
    sources: restrictions.handSources,
    requiredHands,
    usableHands,
    weapon
  };
}

/** Show the standard warning for a mechanically blocked injury restriction. */
export function notifyCriticalInjuryRestriction(actor, restriction) {
  if (!restriction) return;
  const injuries = restriction.sources.map((item) => item.name).join(", ");
  if (restriction.kind === "attribute") {
    const attribute = getAttributeLabels()[restriction.attributeKey] ?? restriction.attributeKey;
    ui.notifications.warn(game.i18n.format("YZE.CriticalInjury.AttributeRestricted", {
      actor: actor.name, attribute, injuries
    }));
    return;
  }
  if (restriction.kind === "hands") {
    ui.notifications.warn(game.i18n.format("YZE.CriticalInjury.WeaponHandsRestricted", {
      actor: actor.name,
      weapon: restriction.weapon.name,
      usable: restriction.usableHands,
      required: restriction.requiredHands,
      injuries
    }));
    return;
  }
  if (restriction.kind === "movement") {
    ui.notifications.warn(game.i18n.format("YZE.CriticalInjury.MovementRestricted", {
      actor: actor.name, injuries
    }));
    return;
  }
  ui.notifications.warn(game.i18n.format("YZE.CriticalInjury.ActionsRestricted", {
    actor: actor.name, injuries
  }));
}

/** Determine which aspects of a person Actor are currently Broken. */
export function getActorBrokenState(actor, harmModel = getHarmModel()) {
  const state = {
    physical: actor?.system?.broken?.physical === true,
    mental: actor?.system?.broken?.mental === true
  };
  if (!actor || actor.type === "vehicle") return { ...state, broken: false, categories: [] };

  if (harmModel === HARM_MODELS.DAMAGE_STRESS) {
    state.physical ||= Number(actor.system?.resources?.health?.value) <= 0;
    state.mental ||= Number(actor.system?.resources?.resolve?.value) <= 0;
  } else if (harmModel === HARM_MODELS.HEALTH_ONLY) {
    state.physical ||= Number(actor.system?.resources?.health?.value) <= 0;
  } else if (harmModel === HARM_MODELS.ATTRIBUTE_DAMAGE) {
    for (const [attributeKey, group] of Object.entries(ATTRIBUTE_GROUPS)) {
      const field = getDiceSystem() === DICE_SYSTEMS.STEP ? "stepRating" : "value";
      if (Number(actor.system?.attributes?.[attributeKey]?.[field]) <= 0) state[group] = true;
    }
  }

  const categories = CATEGORIES.filter((category) => state[category]);
  return { ...state, broken: categories.length > 0, categories };
}

/** Determine which SRD Critical Injury trigger categories an Actor currently meets. */
export function getActorCriticalInjuryTriggerState(
  actor,
  trigger = getCriticalInjuryTrigger()
) {
  const state = { physical: false, mental: false };
  if (!actor || ["vehicle", "mount"].includes(actor.type)) {
    return { ...state, triggered: false, categories: [] };
  }

  const harmModel = getHarmModel();
  if (trigger === CRITICAL_INJURY_TRIGGERS.HEALTH_RESOLVE_ZERO
    && [HARM_MODELS.DAMAGE_STRESS, HARM_MODELS.HEALTH_ONLY].includes(harmModel)) {
    state.physical = Number(actor.system?.resources?.health?.value) <= 0;
    state.mental = harmModel === HARM_MODELS.DAMAGE_STRESS
      && Number(actor.system?.resources?.resolve?.value) <= 0;
  } else if (trigger === CRITICAL_INJURY_TRIGGERS.STRENGTH_WITS_ZERO
    && harmModel === HARM_MODELS.ATTRIBUTE_DAMAGE) {
    const field = getDiceSystem() === DICE_SYSTEMS.STEP ? "stepRating" : "value";
    state.physical = Number(actor.system?.attributes?.strength?.[field]) <= 0;
    state.mental = Number(actor.system?.attributes?.wits?.[field]) <= 0;
  } else if (trigger === CRITICAL_INJURY_TRIGGERS.CONDITIONS_BROKEN
    && harmModel === HARM_MODELS.CONDITIONS) {
    state.physical = actor.system?.broken?.physical === true;
    state.mental = actor.system?.broken?.mental === true;
  }

  const categories = CATEGORIES.filter((category) => state[category]);
  return { ...state, triggered: categories.length > 0, categories };
}

/** Draw the SRD table whose results are linked Critical Injury Items. */
async function criticalCandidate(table, formula) {
  const roll = String(formula ?? "").trim()
    ? await new Roll(String(formula).trim()).evaluate()
    : null;
  return table.roll(roll ? { roll } : {});
}

async function chooseCriticalCandidate(actor, table, formula, reason) {
  const candidates = [
    await criticalCandidate(table, formula),
    await criticalCandidate(table, formula)
  ];
  const options = candidates.map((candidate, index) => {
    const names = candidate.results.map((result) => result.name).join(", ");
    return `<option value="${index}">${escape(candidate.roll.total)} — ${escape(names)}</option>`;
  }).join("");
  const { DialogV2 } = foundry.applications.api;
  const selected = await DialogV2.wait({
    window: { title: game.i18n.localize("YZE.Specialty.CriticalChoiceTitle") },
    content: `<div class="yze"><p>${escape(game.i18n.format(
      "YZE.Specialty.CriticalChoiceHint", { actor: actor.name, specialty: reason }
    ))}</p><div class="form-group"><label>${escape(
      game.i18n.localize("YZE.Specialty.CriticalResult")
    )}</label><select name="candidate">${options}</select></div></div>`,
    buttons: [{
      action: "choose",
      label: game.i18n.localize("YZE.Common.Continue"),
      icon: "fa-solid fa-dice",
      default: true,
      callback: (event, button, dialog) => {
        const form = button.form ?? dialog.element.querySelector("form");
        return Number(form.elements.candidate?.value) || 0;
      }
    }],
    close: () => 0,
    rejectClose: false,
    modal: true
  });
  return candidates[selected] ?? candidates[0];
}

export async function rollCriticalInjury(actor, category, {
  formula = null,
  sourceActor = null
} = {}) {
  if (!CATEGORIES.includes(category)) throw new Error(`Unknown critical injury category: ${category}`);
  if (!canUpdateActor(actor)) {
    ui.notifications.warn(game.i18n.localize("YZE.CriticalInjury.RollNotAllowed"));
    return null;
  }

  const table = await getSRDRollTable(TABLE_NAMES[category], { category });
  if (!table) {
    ui.notifications.error(game.i18n.format("YZE.CriticalInjury.TableMissing", {
      category: categoryLabel(category)
    }));
    return null;
  }

  try {
    let roll = null;
    if (String(formula ?? "").trim()) {
      try {
        roll = await new Roll(String(formula).trim()).evaluate();
      } catch (error) {
        console.warn("YZE System Toolkit | Invalid critical injury formula; using table default", error);
        ui.notifications.warn(game.i18n.localize("YZE.CriticalInjury.InvalidFormula"));
      }
    }
    const lucky = hasSpecialty(actor, SPECIALTY_EFFECTS.LUCKY);
    const killer = sourceActor && sourceActor.uuid !== actor.uuid
      && hasSpecialty(sourceActor, SPECIALTY_EFFECTS.KILLER);
    if (lucky || killer) {
      const reason = game.i18n.localize(`YZE.Specialty.Effects.${
        lucky ? SPECIALTY_EFFECTS.LUCKY : SPECIALTY_EFFECTS.KILLER
      }`);
      const selected = await chooseCriticalCandidate(actor, table, roll?.formula ?? null, reason);
      return await table.draw({
        displayChat: true,
        roll: selected.roll,
        results: selected.results
      });
    }
    return await table.draw({ displayChat: true, ...(roll ? { roll } : {}) });
  } catch (error) {
    console.error("YZE System Toolkit | Critical injury roll failed", error);
    ui.notifications.error(game.i18n.localize("YZE.CriticalInjury.RollFailed"));
    return null;
  }
}

/** Post the Broken notification and automatically draw each applicable injury. */
export async function announceBroken(actor, categories, {
  rollInjury = true,
  injuryCategories = null,
  pushedDamage = false,
  environmentalDamage = false,
  sourceActorUuid = null
} = {}) {
  const valid = [...new Set(categories)].filter((category) => CATEGORIES.includes(category));
  if (valid.length === 0) return;
  const automatic = rollInjury
    ? [...new Set(injuryCategories ?? valid)].filter((category) => valid.includes(category))
    : [];

  const labels = valid.map(categoryLabel).join(", ");
  const buttons = valid.map((category) => `
    <button type="button" data-action="rollCriticalInjury" data-category="${category}">
      <i class="fa-solid fa-dice-d6" aria-hidden="true"></i>
      ${escape(game.i18n.format("YZE.CriticalInjury.RollAnother", { category: categoryLabel(category) }))}
    </button>`).join("");
  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    content: `
      <div class="yze chat-card yze-broken-card" data-actor-uuid="${escape(actor.uuid)}">
        <h3>${escape(game.i18n.format("YZE.CriticalInjury.BrokenTitle", { actor: actor.name }))}</h3>
        <p>${escape(game.i18n.format("YZE.CriticalInjury.BrokenMessage", { categories: labels }))}</p>
        ${isCriticalInjuriesEnabled() && automatic.length > 0
          ? `<p>${escape(game.i18n.localize("YZE.CriticalInjury.AutomaticRoll"))}</p><div class="yze-broken-actions">${buttons}</div>`
          : environmentalDamage
            ? `<p>${escape(game.i18n.localize("YZE.CriticalInjury.EnvironmentalDamageException"))}</p>`
            : pushedDamage
            ? `<p>${escape(game.i18n.localize("YZE.CriticalInjury.PushedDamageException"))}</p>`
            : ""}
      </div>`,
    flags: { [SYSTEM_ID]: { broken: { actorUuid: actor.uuid, categories: valid } } }
  });

  if (!isCriticalInjuriesEnabled() || automatic.length === 0) return;
  const sourceActor = sourceActorUuid && typeof fromUuid === "function"
    ? await fromUuid(sourceActorUuid)
    : null;
  for (const category of automatic) await rollCriticalInjury(actor, category, { sourceActor });
}

/** Return automatic penalties supplied by active Critical Injury Items. */
export function getCriticalInjuryModifier(actor, attributeKey, skillName = null) {
  if (!isCriticalInjuriesEnabled()) return { value: 0, sources: [] };
  const attribute = String(attributeKey ?? "").toLowerCase();
  const skill = String(skillName ?? "").trim().toLowerCase();
  const sources = actor?.items
    ?.filter((item) => item.type === "criticalInjury" && item.system.active === true)
    .filter((item) => {
      const attributes = list(item.system.affectedAttributes);
      const skills = list(item.system.affectedSkills);
      return attributes.includes(attribute) || (skill && skills.includes(skill));
    })
    .map((item) => ({ name: item.name, value: Number(item.system.rollModifier) || 0 }))
    .filter((source) => source.value !== 0) ?? [];

  return {
    value: sources.reduce((total, source) => total + source.value, 0),
    sources
  };
}

function matchingRollDamageInjuries(actor, skillName) {
  const skill = String(skillName ?? "").trim().toLowerCase();
  if (!skill) return [];
  return actor?.items
    ?.filter((item) => item.type === "criticalInjury" && item.system.active === true)
    .filter((item) => list(item.system.damageOnSkills).includes(skill)) ?? [];
}

/** Apply injury effects which inflict one point of harm whenever a listed Skill is rolled. */
export async function applyCriticalInjuryRollDamage(actor, { attributeKey, skillName } = {}) {
  if (!isCriticalInjuriesEnabled()) return { damage: 0, injuries: [] };
  const injuries = matchingRollDamageInjuries(actor, skillName);
  if (injuries.length === 0 || !canUpdateActor(actor)) return { damage: 0, injuries: [] };

  const damage = injuries.length;
  const harmModel = getHarmModel();
  const updates = {};
  if (harmModel === HARM_MODELS.ATTRIBUTE_DAMAGE) {
    const field = getDiceSystem() === DICE_SYSTEMS.STEP ? "stepRating" : "value";
    const current = Number(actor.system?.attributes?.[attributeKey]?.[field]);
    if (Number.isFinite(current)) {
      updates[`system.attributes.${attributeKey}.${field}`] = Math.max(0, current - damage);
    }
  } else if (harmModel === HARM_MODELS.CONDITIONS) {
    const available = CONDITIONS.physical.filter((key) => actor.system?.conditions?.[key] !== true);
    for (const key of available.slice(0, damage)) updates[`system.conditions.${key}`] = true;
    if (damage > available.length) updates["system.broken.physical"] = true;
  } else {
    const current = Number(actor.system?.resources?.health?.value);
    if (Number.isFinite(current)) updates["system.resources.health.value"] = Math.max(0, current - damage);
  }

  if (Object.keys(updates).length > 0) await actor.update(updates);
  ui.notifications.warn(game.i18n.format("YZE.CriticalInjury.RollDamageApplied", {
    actor: actor.name,
    damage,
    injuries: injuries.map((item) => item.name).join(", ")
  }));
  return { damage, injuries };
}

export function registerCriticalInjuryChatHook() {
  Hooks.on("renderChatMessageHTML", (message, html) => {
    const root = html?.querySelector ? html : html?.[0];
    for (const button of root?.querySelectorAll?.('[data-action="rollCriticalInjury"]') ?? []) {
      button.addEventListener("click", async () => {
        const actorUuid = button.closest("[data-actor-uuid]")?.dataset.actorUuid;
        const actor = actorUuid && typeof fromUuid === "function" ? await fromUuid(actorUuid) : null;
        if (!actor) {
          ui.notifications.error(game.i18n.localize("YZE.CriticalInjury.ActorMissing"));
          return;
        }
        button.disabled = true;
        await rollCriticalInjury(actor, button.dataset.category);
        button.disabled = false;
      });
    }
  });
}
