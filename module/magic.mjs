import { CONSUMABLE_MODES, DICE_SYSTEMS, HARM_MODELS, SYSTEM_ID, getStepRating } from "./constants.mjs";
import { ITEM_EFFECT_TYPES, spellItemEffects } from "./item-effects.mjs";
import { getConsumableMode, getDiceSystem, getHarmModel, isMagicEnabled } from "./settings.mjs";
import { isStressDiceEnabled } from "./settings.mjs";
import { applyDamage, applyRecovery, promptProtection, rollArmor } from "./harm.mjs";
import { getActorBrokenState, rollCriticalInjury } from "./critical-injuries.mjs";
import { actorCombatant, combatActionState, canSpendActorActions, spendActorActions } from "./combat.mjs";
import { clearEnvironmentalHazard, environmentalHazards, updateEnvironmentalHazards } from "./hazard-state.mjs";
import { countStateSuccesses } from "./dice/successes.mjs";
import { consumeTemporaryWillpower } from "./willpower.mjs";
import { activeTokenForActor, maximumRange, rangeAllows, rangeBetweenTokens } from "./zones.mjs";

const MAGIC_EFFECTS_FLAG = "magicEffects";
const MAGIC_APPLIED_FLAG = "magicApplied";
const TIME_SECONDS = Object.freeze({ round: 6, stretch: 600, shift: 21600, day: 86400 });

export const MAGIC_MISHAPS = Object.freeze([
  { result: 1, name: "Sleepless", effect: "You cannot sleep for D6 days." },
  { result: 2, name: "Drained", effect: "Suffer one stress." },
  { result: 3, name: "Hurt", effect: "Suffer one damage." },
  { result: 4, name: "Magical Disease", effect: "A virulence 2D6 disease exposes you and everyone Engaged with you during the next shift." },
  { result: 5, name: "Unintended Target", effect: "The spell also affects an unintended victim; helpful magic may aid an enemy." },
  { result: 6, name: "Altered Appearance", effect: "Your appearance changes permanently as the GM decides." },
  { result: 7, name: "Blinded", effect: "Act as if in complete darkness for one full day." },
  { result: 8, name: "Ravaged Mind", effect: "Immediately roll a mental critical injury." },
  { result: 9, name: "Broken Bones", effect: "Immediately roll a physical critical injury." },
  { result: 10, name: "Demon Drawn", effect: "A demon arrives within the next shift and causes trouble." },
  { result: 11, name: "Backfire", effect: "The spell reverses, harms, corrupts, or turns against the caster as the GM decides." },
  { result: 12, name: "Rift", effect: "A demon drags you into another dimension. The character returns as a changed NPC after D66 days." }
]);

function escape(value) {
  return foundry.utils.escapeHTML(String(value));
}

function wholeNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.trunc(number)) : 0;
}

function activeResults(roll) {
  return (roll?.dice ?? []).flatMap((die) => die.results ?? [])
    .filter((result) => result.active !== false)
    .map((result) => Number(result.result));
}

function list(value) {
  return String(value ?? "").split(",").map((entry) => entry.trim().toLowerCase()).filter(Boolean);
}

function worldTime() {
  return Math.max(0, Number(game.time?.worldTime) || 0);
}

export function magicEffects(actor) {
  const effects = actor?.getFlag?.(SYSTEM_ID, MAGIC_EFFECTS_FLAG);
  return Array.isArray(effects) ? foundry.utils.deepClone(effects) : [];
}

function durationSeconds(duration, powerLevel = 1) {
  const text = String(duration ?? "").trim().toLowerCase();
  if (!text || text === "immediate" || text === "varies" || text === "permanent") return 0;
  const unit = Object.keys(TIME_SECONDS).find((key) => text.includes(key));
  if (!unit) return 0;
  const count = text.includes("per power")
    ? Math.max(1, wholeNumber(powerLevel))
    : text.includes("next round") ? 2 : 1;
  return TIME_SECONDS[unit] * count;
}

function durationRounds(duration, powerLevel = 1) {
  const text = String(duration ?? "").trim().toLowerCase();
  if (!text.includes("round")) return 0;
  if (text.includes("per power")) return Math.max(1, wholeNumber(powerLevel));
  return text.includes("next round") ? 2 : 1;
}

export function getMagicRollModifier(actor, attributeKey, skillName = null) {
  if (!isMagicEnabled()) return { value: 0, sources: [] };
  const attribute = String(attributeKey ?? "").toLowerCase();
  const skill = String(skillName ?? "").toLowerCase();
  const sources = magicEffects(actor).filter((effect) => effect.modifier)
    .filter((effect) => {
      const attributes = list(effect.affectedAttributes);
      const skills = list(effect.affectedSkills);
      return (attributes.length === 0 && skills.length === 0)
        || attributes.includes(attribute) || (skill && skills.includes(skill));
    })
    .map((effect) => ({ name: effect.name, value: Number(effect.modifier) || 0 }));
  return { value: sources.reduce((total, source) => total + source.value, 0), sources };
}

export function getMagicAutomaticSuccesses(actor, skillName = null) {
  const skill = String(skillName ?? "").trim().toLowerCase();
  const sources = magicEffects(actor)
    .filter((effect) => wholeNumber(effect.automaticSuccesses) > 0)
    .filter((effect) => !effect.affectedSkills
      || list(effect.affectedSkills).includes(skill))
    .map((effect) => ({
      id: effect.id,
      name: effect.name,
      value: wholeNumber(effect.automaticSuccesses),
      oneUse: effect.oneUse === true,
      replaceRoll: effect.replaceRoll === true
    }));
  return {
    value: sources.reduce((total, source) => total + source.value, 0),
    replaceRoll: sources.some((source) => source.replaceRoll),
    sources
  };
}

export async function consumeMagicAutomaticSuccesses(actor, effectIds = []) {
  const consumed = new Set(effectIds);
  if (!actor || consumed.size === 0) return false;
  const current = magicEffects(actor);
  const next = current.filter((effect) => !(effect.oneUse === true && consumed.has(effect.id)));
  if (next.length === current.length) return false;
  await actor.setFlag(SYSTEM_ID, MAGIC_EFFECTS_FLAG, next);
  return true;
}

export async function clearMagicEffect(actor, effectId) {
  if (!actor || (!game.user?.isGM && actor.isOwner === false)) return false;
  const next = magicEffects(actor).filter((effect) => effect.id !== effectId);
  await actor.setFlag(SYSTEM_ID, MAGIC_EFFECTS_FLAG, next);
  return true;
}

async function addMagicEffect(actor, spell, state, definition = {}, payload = {}) {
  const duration = String(definition.duration || spell.system.duration || "");
  const seconds = durationSeconds(duration, state.powerLevel);
  const rounds = durationRounds(duration, state.powerLevel);
  const combatant = rounds > 0 ? actorCombatant(actor) : null;
  const combat = combatant?.parent;
  const target = String(definition.target || "all");
  const affectedAttributes = definition.affectedAttributes
    || (["strength", "agility", "wits", "empathy"].includes(target) ? target : "");
  const affectedSkills = definition.affectedSkills
    || (target.startsWith("skill:") ? target.slice(6) : "")
    || (definition.type === ITEM_EFFECT_TYPES.SPELL_AUTOMATIC_SUCCESS ? target : "");
  const effect = {
    id: foundry.utils.randomID(),
    name: String(payload.name || spell.name),
    spellUuid: spell.uuid,
    casterUuid: state.actorUuid,
    powerLevel: state.powerLevel,
    modifier: Number(payload.modifier ?? 0) || 0,
    automaticSuccesses: wholeNumber(payload.automaticSuccesses),
    oneUse: payload.oneUse === true,
    replaceRoll: payload.replaceRoll === true,
    armor: wholeNumber(payload.armor),
    armorStep: wholeNumber(payload.armorStep),
    resourceGrant: wholeNumber(payload.resourceGrant),
    resource: String(payload.resource || ""),
    remainingTicks: wholeNumber(payload.remainingTicks),
    nextTickAt: wholeNumber(payload.nextTickAt),
    tickInterval: wholeNumber(payload.tickInterval),
    nextCombatRound: wholeNumber(payload.nextCombatRound),
    tickDamage: wholeNumber(payload.tickDamage),
    tickStress: wholeNumber(payload.tickStress),
    startsCombatRound: wholeNumber(payload.startsCombatRound),
    kind: String(payload.kind || definition.status || definition.handler || "spell"),
    description: String(definition.description || ""),
    affectedAttributes,
    affectedSkills,
    endsAt: seconds > 0 ? worldTime() + seconds : 0,
    combatId: combat?.id ?? "",
    endsCombatRound: combat ? (Number(combat.round) || 0) + rounds : 0,
    duration
  };
  await actor.setFlag(SYSTEM_ID, MAGIC_EFFECTS_FLAG, [...magicEffects(actor), effect]);
  return effect;
}

function legacySpellEffects(spell) {
  const types = {
    damage: ITEM_EFFECT_TYPES.SPELL_DAMAGE,
    healing: ITEM_EFFECT_TYPES.SPELL_RECOVERY,
    modifier: ITEM_EFFECT_TYPES.SPELL_MODIFIER
  };
  const type = types[spell.system.automation];
  if (!type) return [];
  return [{
    id: `legacy-${spell.id}`,
    active: true,
    application: "spell",
    type,
    targetMode: spell.system.targetMode || "selected",
    category: spell.system.effectCategory || "physical",
    value: Number(spell.system.effectBase) || 0,
    multiplier: Number(spell.system.effectPerPower) || 0,
    target: "all",
    duration: spell.system.duration,
    armorApplies: spell.system.armorApplies === true,
    affectedAttributes: spell.system.affectedAttributes || "",
    affectedSkills: spell.system.affectedSkills || "",
    description: ""
  }];
}

export function configuredSpellEffects(spell) {
  const configured = spellItemEffects(spell);
  return configured.length > 0 ? configured : legacySpellEffects(spell);
}

function effectAmount(effect, powerLevel) {
  return Math.max(0, Math.trunc(
    (Number(effect.value) || 0) + (Number(effect.multiplier) || 0) * wholeNumber(powerLevel)
  ));
}

function signedEffectAmount(effect, powerLevel) {
  return Math.trunc(
    (Number(effect.value) || 0) + (Number(effect.multiplier) || 0) * wholeNumber(powerLevel)
  );
}

function effectiveSpellPower(target, state) {
  if (!target || target.uuid === state.actorUuid) return wholeNumber(state.powerLevel);
  const seal = magicEffects(target)
    .filter((effect) => effect.kind === "magical-seal")
    .reduce((total, effect) => total + wholeNumber(effect.powerLevel), 0);
  return Math.max(0, wholeNumber(state.powerLevel) - seal);
}

async function applyAutomatedSpellDamage(target, amount, effect) {
  if (effect.category === "stress") {
    if (isStressDiceEnabled()) return adjustSpellResource(target, "stress", amount);
    const attributes = list(effect.affectedAttributes);
    if (getHarmModel() === HARM_MODELS.ATTRIBUTE_DAMAGE && attributes.length > 0) {
      for (const attributeKey of attributes) {
        await applyDamage(target, amount, { category: "mental", attributeKey });
      }
      return true;
    }
    return applyDamage(target, amount, { category: "mental" });
  }
  let finalDamage = amount;
  if (effect.armorApplies === true && amount > 0) {
    const protection = await promptProtection(target, amount);
    if (!protection) return false;
    finalDamage = (await rollArmor(target, protection.damage, protection.armorId)).penetrating;
  }
  if (finalDamage > 0) await applyDamage(target, finalDamage, {
    category: effect.category || "physical"
  });
  return true;
}

function resourceField(actor, resource) {
  if (["health", "resolve", "willpower", "stress"].includes(resource)) {
    return {
      current: `system.resources.${resource}.value`,
      maximum: `system.resources.${resource}.max`,
      value: Number(actor.system.resources?.[resource]?.value) || 0,
      max: Number(actor.system.resources?.[resource]?.max) || 99
    };
  }
  if (["strength", "agility", "wits", "empathy"].includes(resource)) {
    const step = getDiceSystem() === DICE_SYSTEMS.STEP;
    const current = step ? "stepRating" : "value";
    const maximum = step ? "maxStepRating" : "maxValue";
    return {
      current: `system.attributes.${resource}.${current}`,
      maximum: `system.attributes.${resource}.${maximum}`,
      value: Number(actor.system.attributes?.[resource]?.[current]) || 0,
      max: Number(actor.system.attributes?.[resource]?.[maximum]) || (step ? 4 : 5)
    };
  }
  return null;
}

async function adjustSpellResource(actor, resource, delta) {
  const field = resourceField(actor, resource);
  if (!field) return false;
  const next = Math.max(0, Math.min(field.max, field.value + Math.trunc(Number(delta) || 0)));
  if (next === field.value) return true;
  await actor.update({ [field.current]: next });
  return true;
}

async function confirmTargetFilter(target, effect) {
  const filter = String(effect.filter || "").trim();
  if (!filter) return true;
  const { DialogV2 } = foundry.applications.api;
  return DialogV2.confirm({
    window: { title: game.i18n.localize("YZE.SpellEffects.TargetCheckTitle") },
    content: `<div class="yze"><p>${escape(game.i18n.format(
      "YZE.SpellEffects.TargetCheckHint", { target: target.name, requirement: filter }
    ))}</p></div>`,
    yes: { label: game.i18n.localize("YZE.SpellEffects.TargetEligible") },
    no: { label: game.i18n.localize("YZE.Common.Cancel") },
    rejectClose: false,
    modal: true
  });
}

function targetsForEffect(effect, caster, selectedTargets) {
  const mode = String(effect.targetMode || "selected");
  if (mode === "self") return [caster];
  if (mode === "firstSelected") return selectedTargets.slice(0, 1);
  if (mode === "casterAndSelected") {
    return [...new Map([caster, ...selectedTargets].map((actor) => [actor.uuid, actor])).values()];
  }
  return selectedTargets;
}

async function applySpellItemDamage(target, effect, amount) {
  const items = target.items?.filter((item) => (
    effect.mode === "food"
      ? item.type === "consumable" && item.system.foodType !== "none"
      : ["gear", "weapon", "armor", "consumable"].includes(item.type)
  )) ?? [];
  if (items.length === 0) return false;
  const options = items.map((item) => `<option value="${escape(item.id)}">${escape(item.name)}</option>`).join("");
  const { DialogV2 } = foundry.applications.api;
  const itemId = await DialogV2.wait({
    window: { title: game.i18n.localize("YZE.SpellEffects.ChooseItem") },
    content: `<div class="yze"><select name="itemId">${options}</select></div>`,
    buttons: [{
      action: "apply",
      label: game.i18n.localize("YZE.Common.Continue"),
      default: true,
      callback: (event, button, dialog) => (
        button.form ?? dialog.element.querySelector("form")
      ).elements.itemId?.value
    }, { action: "cancel", label: game.i18n.localize("YZE.Common.Cancel"), callback: () => null }],
    close: () => null,
    rejectClose: false,
    modal: true
  });
  const item = target.items.get(itemId);
  if (!item) return false;
  if (effect.mode === "food") {
    const supplyMode = getConsumableMode() === CONSUMABLE_MODES.SUPPLY;
    const amountField = supplyMode ? "supply" : "quantity";
    const corrupted = Math.min(wholeNumber(item.system[amountField]), Math.max(1, amount));
    const remaining = Math.max(0, wholeNumber(item.system[amountField]) - corrupted);
    await item.update({
      [`system.${amountField}`]: remaining,
      "system.equipped": supplyMode || remaining > 0 ? item.system.equipped === true : false
    });
    if (corrupted > 0) await target.createEmbeddedDocuments("Item", [{
      name: game.i18n.localize("YZE.SpellEffects.BefouledRations"),
      type: "consumable",
      img: item.img,
      system: {
        quantity: supplyMode ? 1 : corrupted,
        weight: Number(item.system.weight) || 0,
        equipped: false,
        supply: supplyMode ? corrupted : 0,
        foodType: "prepared",
        foodState: "unsafe",
        description: `<p>${escape(game.i18n.localize("YZE.SpellEffects.BefouledRationsDescription"))}</p>`
      },
      flags: { [SYSTEM_ID]: { poison: {
        toxicityPool: Math.max(1, amount * 3),
        toxicityStep: Math.min(4, Math.max(1, amount))
      } } }
    }]);
  } else if (effect.mode === "destroy") {
    await item.update({ "system.quantity": 0, "system.equipped": false });
  } else if (effect.mode === "reliability" && item.system.reliability) {
    await item.update({
      "system.reliability.value": Math.max(0, Number(item.system.reliability.value) - amount)
    });
  } else if (typeof item.system.bonus === "number") {
    await item.update({ "system.bonus": Math.max(0, Number(item.system.bonus) - amount) });
  }
  return true;
}

async function applyCriticalInjuryEffect(target, effect, powerLevel) {
  if (effect.mode === "resurrect") {
    if (target.system.dead !== true) return false;
    await target.update({ "system.dead": false });
    return true;
  }
  const injuries = target.items.filter((item) => item.type === "criticalInjury" && item.system.active);
  if (injuries.length === 0) return false;
  const eligible = injuries.filter((item) => !item.system.lethal || powerLevel >= Math.max(2, wholeNumber(effect.value)));
  if (eligible.length === 0) return false;
  const options = eligible.map((item) => `<option value="${escape(item.id)}">${escape(item.name)}</option>`).join("");
  const { DialogV2 } = foundry.applications.api;
  const id = await DialogV2.wait({
    window: { title: game.i18n.localize("YZE.SpellEffects.ChooseInjury") },
    content: `<div class="yze"><select name="injury">${options}</select></div>`,
    buttons: [{ action: "heal", label: game.i18n.localize("YZE.SpellEffects.HealInjury"), default: true,
      callback: (event, button, dialog) => (button.form ?? dialog.element.querySelector("form")).elements.injury?.value },
    { action: "cancel", label: game.i18n.localize("YZE.Common.Cancel"), callback: () => null }],
    close: () => null, rejectClose: false, modal: true
  });
  if (!id) return false;
  await target.deleteEmbeddedDocuments("Item", [id]);
  return true;
}

async function applySpellHazard(target, spell, state, effect, amount) {
  const kind = String(effect.handler || "");
  if (kind === "fire" && magicEffects(target).some((entry) => entry.kind === "firewalker")) return true;
  if (["fire", "disease", "poison"].includes(kind)) {
    const rating = getDiceSystem() === DICE_SYSTEMS.STEP
      ? Math.min(4, Math.max(1, state.powerLevel))
      : Math.max(1, amount);
    const update = {
      active: true,
      rating,
      startedAt: worldTime(),
      source: spell.name
    };
    if (kind === "fire") update.nextCheckAt = worldTime() + TIME_SECONDS.round;
    await updateEnvironmentalHazards(target, { [kind]: update });
    return true;
  }
  if (kind === "chill") {
    await applyDamage(target, 1, { category: "physical", attributeKey: "strength" });
    if (isStressDiceEnabled()) await adjustSpellResource(target, "stress", 1);
    else await applyDamage(target, 1, { category: "mental", attributeKey: "wits" });
    if (state.powerLevel > 1) {
      const inCombat = Boolean(actorCombatant(target));
      await addMagicEffect(target, spell, state, effect, {
        kind,
        remainingTicks: state.powerLevel - 1,
        nextCombatRound: inCombat ? (Number(game.combat?.round) || 0) + 1 : 0,
        nextTickAt: inCombat ? 0 : worldTime() + TIME_SECONDS.round,
        tickInterval: TIME_SECONDS.round,
        tickDamage: 1,
        tickStress: 1
      });
    }
    return true;
  }
  if (kind === "suffocation") {
    const inCombat = Boolean(actorCombatant(target));
    await addMagicEffect(target, spell, state, effect, {
      kind,
      remainingTicks: state.powerLevel,
      nextCombatRound: inCombat ? (Number(game.combat?.round) || 0) + 1 : 0,
      nextTickAt: inCombat ? 0 : worldTime() + TIME_SECONDS.round,
      tickInterval: TIME_SECONDS.round,
      tickDamage: 1
    });
    return true;
  }
  if (kind === "bloodCurse") {
    const { DialogV2 } = foundry.applications.api;
    const mode = await DialogV2.wait({
      window: { title: spell.name },
      content: `<div class="yze"><div class="form-group"><label>${escape(game.i18n.localize("YZE.SpellEffects.CurseMode"))}</label><select name="mode"><option value="damage">${escape(game.i18n.localize("YZE.SpellEffects.CurseDamage"))}</option><option value="stress">${escape(game.i18n.localize("YZE.SpellEffects.CurseStress"))}</option></select></div></div>`,
      buttons: [{ action: "apply", label: game.i18n.localize("YZE.Magic.ApplyEffect"), default: true,
        callback: (event, button, dialog) => (button.form ?? dialog.element.querySelector("form")).elements.mode?.value },
      { action: "cancel", label: game.i18n.localize("YZE.Common.Cancel"), callback: () => null }],
      close: () => null, rejectClose: false, modal: true
    });
    if (!mode) return false;
    await addMagicEffect(target, spell, state, effect, {
      kind: "blood-curse",
      remainingTicks: state.powerLevel,
      nextTickAt: worldTime() + TIME_SECONDS.shift,
      tickInterval: TIME_SECONDS.shift,
      tickDamage: mode === "damage" ? 1 : 0,
      tickStress: mode === "stress" ? 1 : 0
    });
    return true;
  }
  await addMagicEffect(target, spell, state, effect, { kind });
  return true;
}

async function promptResolutionNote(spell, effect, handler) {
  const { DialogV2 } = foundry.applications.api;
  return DialogV2.wait({
    window: { title: effect.label || spell.name },
    content: `<div class="yze"><p>${escape(effect.description || spell.system.description || "")}</p>
      <label>${escape(game.i18n.localize("YZE.SpellEffects.Resolution"))}<textarea name="resolution" rows="4"></textarea></label></div>`,
    buttons: [{
      action: "resolve",
      label: game.i18n.localize("YZE.SpellEffects.RecordResolution"),
      default: true,
      callback: (event, button, dialog) => String(
        (button.form ?? dialog.element.querySelector("form")).elements.resolution?.value ?? ""
      ).trim()
    }, { action: "cancel", label: game.i18n.localize("YZE.Common.Cancel"), callback: () => null }],
    close: () => null, rejectClose: false, modal: true
  });
}

async function rollSpellResistance(target, spell, power, { opposed = false } = {}) {
  const skill = target.items.find((item) => item.type === "skill"
    && item.name.localeCompare("Insight", undefined, { sensitivity: "base" }) === 0);
  if (!skill) return null;
  if (!opposed) {
    const message = await target.rollSkill(skill.id, {
      canPush: false,
      canOppose: false,
      allowHelpers: false,
      fixedModifiers: [[spell.name, -power]]
    });
    return countStateSuccesses(message?.getFlag(SYSTEM_ID, "push")) < 1;
  }

  const step = getDiceSystem() === DICE_SYSTEMS.STEP;
  const rating = getStepRating(Math.min(4, Math.max(1, power)));
  const casterRoll = await new Roll(step ? `2d${rating.faces}` : `${Math.max(1, power * 2)}d6`).evaluate();
  const casterSuccesses = activeResults(casterRoll).reduce((total, result) => (
    total + (step ? (result >= 10 ? 2 : result >= 6 ? 1 : 0) : result === 6 ? 1 : 0)
  ), 0);
  await casterRoll.toMessage({
    flavor: `<div class="yze chat-card"><h3>${escape(spell.name)}</h3><p>${escape(
      game.i18n.format("YZE.SpellEffects.OpposedCasterResult", { successes: casterSuccesses })
    )}</p></div>`
  });
  const targetMessage = await target.rollSkill(skill.id, {
    canPush: false,
    canOppose: false,
    allowHelpers: false
  });
  const targetSuccesses = countStateSuccesses(targetMessage?.getFlag(SYSTEM_ID, "push"));
  return casterSuccesses > targetSuccesses;
}

async function applySpellWorkflow(caster, targets, spell, state, effect) {
  const handler = String(effect.handler || "narrative");
  const power = wholeNumber(state.powerLevel);
  if (handler === "bindMagic" && spell.name === "Obscure Magic") {
    await caster.setFlag(SYSTEM_ID, "obscureNextSpellPower", power);
    return game.i18n.format("YZE.Magic.NextSpellObscured", { power });
  }
  if (["gmQuestion", "yesNoQuestion"].includes(handler) && !game.user?.isGM) {
    ui.notifications.warn(game.i18n.localize("YZE.SpellEffects.GMResolutionRequired"));
    return false;
  }
  if (handler === "resourceTransfer") {
    const target = targets[0];
    if (!target) return false;
    const resources = ["health", "resolve", "willpower", "stress", "strength", "agility", "wits", "empathy"];
    const options = resources.map((resource) => `<option value="${resource}">${escape(resource)}</option>`).join("");
    const { DialogV2 } = foundry.applications.api;
    const selection = await DialogV2.wait({
      window: { title: spell.name },
      content: `<div class="yze"><div class="form-group"><label>${escape(game.i18n.localize("YZE.SpellEffects.Resource"))}</label><select name="resource">${options}</select></div>
        <div class="form-group"><label>${escape(game.i18n.localize("YZE.SpellEffects.Direction"))}</label><select name="direction"><option value="give">${escape(game.i18n.localize("YZE.SpellEffects.Give"))}</option><option value="take">${escape(game.i18n.localize("YZE.SpellEffects.Take"))}</option></select></div>
        <div class="form-group"><label>${escape(game.i18n.localize("YZE.Common.Amount"))}</label><input name="amount" type="number" min="1" max="${Math.max(1, power)}" value="1"></div>
        <label class="checkbox-row"><input name="willing" type="checkbox" checked><span>${escape(game.i18n.localize("YZE.SpellEffects.TargetWilling"))}</span></label></div>`,
      buttons: [{ action: "transfer", label: game.i18n.localize("YZE.SpellEffects.Transfer"), default: true,
        callback: (event, button, dialog) => { const form = button.form ?? dialog.element.querySelector("form"); return { resource: form.elements.resource?.value, direction: form.elements.direction?.value, amount: Math.max(1, Math.min(power, wholeNumber(form.elements.amount?.value))), willing: form.elements.willing?.checked === true }; } },
      { action: "cancel", label: game.i18n.localize("YZE.Common.Cancel"), callback: () => null }],
      close: () => null, rejectClose: false, modal: true
    });
    if (!selection) return false;
    if (selection.direction === "take" && !selection.willing) {
      const affected = await rollSpellResistance(target, spell, power);
      if (affected !== true) return game.i18n.localize("YZE.SpellEffects.Resisted");
    }
    const source = selection.direction === "give" ? caster : target;
    const recipient = selection.direction === "give" ? target : caster;
    const available = resourceField(source, selection.resource)?.value ?? 0;
    const amount = Math.min(selection.amount, available);
    if (amount < 1) return false;
    await adjustSpellResource(source, selection.resource, -amount);
    await adjustSpellResource(recipient, selection.resource, amount);
    return game.i18n.format("YZE.SpellEffects.Transferred", {
      amount, resource: selection.resource, source: source.name, target: recipient.name
    });
  }
  if (handler === "distributeDamage") {
    if (targets.length === 0) return false;
    const fields = targets.map((target, index) => `<label>${escape(target.name)}<input type="number" name="amount-${index}" min="0" max="${power}" value="0"></label>`).join("");
    const { DialogV2 } = foundry.applications.api;
    const allocations = await DialogV2.wait({
      window: { title: spell.name },
      content: `<div class="yze form-grid"><p>${escape(game.i18n.format("YZE.SpellEffects.DistributeHint", { power }))}</p>${fields}</div>`,
      buttons: [{ action: "apply", label: game.i18n.localize("YZE.Magic.ApplyEffect"), default: true,
        callback: (event, button, dialog) => { const form = button.form ?? dialog.element.querySelector("form"); return targets.map((_target, index) => wholeNumber(form.elements[`amount-${index}`]?.value)); } },
      { action: "cancel", label: game.i18n.localize("YZE.Common.Cancel"), callback: () => null }],
      close: () => null, rejectClose: false, modal: true
    });
    if (!allocations || allocations.reduce((sum, value) => sum + value, 0) > power) return false;
    for (const [index, target] of targets.entries()) {
      if (allocations[index] > 0) {
        await applyAutomatedSpellDamage(target, allocations[index], effect);
        if (effect.mode === "prone" && target.system?.combat) {
          await target.update({ "system.combat.prone": true });
        }
      }
    }
    return game.i18n.localize("YZE.SpellEffects.DamageDistributed");
  }
  if (handler === "dispel") {
    const target = targets[0];
    const active = magicEffects(target);
    if (!target || active.length === 0) return false;
    const options = active.map((entry) => `<option value="${escape(entry.id)}">${escape(entry.name)} (${wholeNumber(entry.powerLevel)})</option>`).join("");
    const { DialogV2 } = foundry.applications.api;
    const id = await DialogV2.wait({
      window: { title: spell.name }, content: `<div class="yze"><select name="effect">${options}</select></div>`,
      buttons: [{ action: "dispel", label: game.i18n.localize("YZE.SpellEffects.Dispel"), default: true,
        callback: (event, button, dialog) => (button.form ?? dialog.element.querySelector("form")).elements.effect?.value }],
      close: () => null, rejectClose: false, modal: true
    });
    const selected = active.find((entry) => entry.id === id);
    if (!selected) return false;
    const remaining = wholeNumber(selected.powerLevel) - power;
    const next = remaining > 0
      ? active.map((entry) => entry.id === id ? { ...entry, powerLevel: remaining } : entry)
      : active.filter((entry) => entry.id !== id);
    await target.setFlag(SYSTEM_ID, MAGIC_EFFECTS_FLAG, next);
    return remaining > 0
      ? game.i18n.format("YZE.SpellEffects.Reduced", { name: selected.name, power: remaining })
      : game.i18n.format("YZE.SpellEffects.Dispelled", { name: selected.name });
  }
  if (handler === "opposedTest") {
    const results = [];
    for (const target of targets) {
      const affected = await rollSpellResistance(target, spell, effectiveSpellPower(target, state), {
        opposed: effect.mode === "opposed"
      });
      if (affected === null) return false;
      if (affected && effect.description) await addMagicEffect(target, spell, state, effect, { kind: effect.status || effect.label || spell.name });
      results.push(`${target.name}: ${affected ? game.i18n.localize("YZE.SpellEffects.Affected") : game.i18n.localize("YZE.SpellEffects.Resisted")}`);
    }
    return results.join("; ");
  }
  if (handler === "powerRequirement") {
    const resolution = await promptResolutionNote(spell, effect, handler);
    if (resolution === null) return false;
    for (const target of targets) await addMagicEffect(target, spell, state, effect, { kind: effect.status || "controlled" });
    return resolution || effect.description;
  }
  if (handler === "cureHazard") {
    const results = [];
    for (const target of targets) {
      const hazards = environmentalHazards(target);
      const choices = ["disease", "poison"].filter((kind) => hazards[kind]?.active === true);
      if (choices.length === 0) return false;
      const kind = choices.length === 1 ? choices[0] : await foundry.applications.api.DialogV2.wait({
        window: { title: spell.name },
        content: `<div class="yze"><select name="hazard">${choices.map((choice) => `<option value="${choice}">${escape(game.i18n.localize(`YZE.Environment.Hazards.${choice}`))}</option>`).join("")}</select></div>`,
        buttons: [{ action: "cure", label: game.i18n.localize("YZE.SpellEffects.Cure"), default: true,
          callback: (event, button, dialog) => (button.form ?? dialog.element.querySelector("form")).elements.hazard?.value }],
        close: () => null, rejectClose: false, modal: true
      });
      if (!kind) return false;
      const rating = wholeNumber(hazards[kind]?.rating);
      const required = getDiceSystem() === DICE_SYSTEMS.STEP ? rating : Math.floor(rating / 3);
      if (power < required) {
        results.push(`${target.name}: ${game.i18n.localize("YZE.SpellEffects.PowerTooLow")}`);
        continue;
      }
      await clearEnvironmentalHazard(target, kind);
      results.push(`${target.name}: ${game.i18n.localize("YZE.SpellEffects.Cured")}`);
    }
    return results.join("; ");
  }
  if (handler === "forceStanding") {
    const results = [];
    for (const target of targets) {
      const skill = target.items.find((item) => item.type === "skill"
        && item.name.localeCompare("Force", undefined, { sensitivity: "base" }) === 0);
      if (!skill) return false;
      const message = await target.rollSkill(skill.id, {
        canPush: false,
        canOppose: false,
        allowHelpers: false
      });
      const standing = countStateSuccesses(message?.getFlag(SYSTEM_ID, "push")) > 0;
      if (!standing && target.system?.combat) await target.update({ "system.combat.prone": true });
      results.push(`${target.name}: ${game.i18n.localize(standing
        ? "YZE.SpellEffects.RemainedStanding"
        : "YZE.SpellEffects.KnockedProne")}`);
    }
    return results.join("; ");
  }
  if (handler === "storeWillpower") {
    const target = targets[0] ?? caster;
    await target.createEmbeddedDocuments("Item", [{
      name: effect.label || spell.name,
      type: "gear",
      img: spell.img,
      system: { quantity: 1, weight: 0, equipped: false, bonus: 0, description: `<p>${escape(effect.description)}</p>` },
      flags: { [SYSTEM_ID]: { storedWillpower: power, sourceSpellUuid: spell.uuid } }
    }]);
    return game.i18n.format("YZE.SpellEffects.StoredWillpower", { amount: power, target: target.name });
  }

  const resolution = await promptResolutionNote(spell, effect, handler);
  if (resolution === null) return false;
  if (["transform", "summon", "bindMagic"].includes(handler) || String(effect.duration || spell.system.duration).toLowerCase() !== "immediate") {
    for (const target of targets.length > 0 ? targets : [caster]) {
      await addMagicEffect(target, spell, state, effect, { kind: handler });
    }
  }
  return resolution || effect.description || spell.system.description;
}

async function applyConfiguredSpellEffect(caster, selectedTargets, spell, state, effect) {
  const targets = targetsForEffect(effect, caster, selectedTargets);
  if (targets.length === 0) return false;
  for (const target of targets) {
    if (!await confirmTargetFilter(target, effect)) return false;
  }
  const protectedTargets = targets.map((target) => ({
    target,
    power: effectiveSpellPower(target, state)
  })).filter((entry) => entry.power > 0);
  if (protectedTargets.length === 0) return game.i18n.localize("YZE.SpellEffects.NegatedBySeal");

  if (effect.type === ITEM_EFFECT_TYPES.SPELL_WORKFLOW) {
    const workflowPower = Math.min(...protectedTargets.map((entry) => entry.power));
    return applySpellWorkflow(caster, protectedTargets.map((entry) => entry.target), spell, {
      ...state,
      powerLevel: workflowPower
    }, effect);
  }

  for (const { target, power } of protectedTargets) {
    const targetState = { ...state, powerLevel: power };
    const amount = effectAmount(effect, power);
    if (effect.type === ITEM_EFFECT_TYPES.SPELL_DAMAGE) {
      if (!await applyAutomatedSpellDamage(target, amount, effect)) return false;
    } else if (effect.type === ITEM_EFFECT_TYPES.SPELL_RECOVERY) {
      if (!await applyRecovery(target, amount, { category: effect.category || "physical" })) return false;
    } else if (effect.type === ITEM_EFFECT_TYPES.SPELL_MODIFIER) {
      await addMagicEffect(target, spell, targetState, effect, {
        modifier: signedEffectAmount(effect, power)
      });
    } else if (effect.type === ITEM_EFFECT_TYPES.SPELL_RESOURCE) {
      const delta = effect.mode === "lose" ? -amount : amount;
      if (!await adjustSpellResource(target, effect.resource, delta)) return false;
      const duration = String(effect.duration || "").trim().toLowerCase();
      if (delta > 0 && duration && duration !== "immediate") {
        await addMagicEffect(target, spell, targetState, effect, {
          kind: "temporary-resource",
          resourceGrant: delta,
          resource: effect.resource
        });
      }
    } else if (effect.type === ITEM_EFFECT_TYPES.SPELL_STATUS) {
      let statusEffect = effect;
      if (effect.status === "paralyzed") {
        const actions = combatActionState(target);
        const deferToNextRound = actions.active
          && ((power === 1 && actions.fastUsed > 0) || (power === 2 && actions.slowUsed));
        if (deferToNextRound) statusEffect = { ...effect, duration: "Next round" };
        await addMagicEffect(target, spell, targetState, statusEffect, {
          kind: effect.status,
          startsCombatRound: deferToNextRound ? (Number(game.combat?.round) || 0) + 1 : 0
        });
        continue;
      }
      await addMagicEffect(target, spell, targetState, statusEffect, { kind: effect.status });
    } else if (effect.type === ITEM_EFFECT_TYPES.SPELL_ARMOR) {
      await addMagicEffect(target, spell, targetState, effect, {
        armor: amount,
        armorStep: Math.min(4, Math.max(1, power))
      });
    } else if (effect.type === ITEM_EFFECT_TYPES.SPELL_AUTOMATIC_SUCCESS) {
      await addMagicEffect(target, spell, targetState, effect, {
        automaticSuccesses: amount,
        oneUse: true,
        replaceRoll: effect.mode === "replace"
      });
    } else if (effect.type === ITEM_EFFECT_TYPES.SPELL_ITEM_DAMAGE) {
      if (!await applySpellItemDamage(target, effect, amount)) return false;
    } else if (effect.type === ITEM_EFFECT_TYPES.SPELL_CRITICAL_INJURY) {
      if (!await applyCriticalInjuryEffect(target, effect, power)) return false;
    } else if (effect.type === ITEM_EFFECT_TYPES.SPELL_HAZARD) {
      if (!await applySpellHazard(target, spell, targetState, effect, amount)) return false;
    }
  }
  return effect.label || game.i18n.localize(`YZE.ItemEffects.Types.${effect.type}`);
}

export async function applySpellOutcome(message) {
  const state = message?.getFlag(SYSTEM_ID, "magic");
  if (!state || message.getFlag(SYSTEM_ID, MAGIC_APPLIED_FLAG)) return false;
  const caster = await fromUuid(state.actorUuid);
  const spell = await fromUuid(state.spellUuid);
  if (!caster || !spell || (!game.user?.isGM && caster.isOwner === false)) return false;
  const targets = [...new Set(state.targetUuids ?? [])].map((uuid) => fromUuid(uuid));
  const resolvedTargets = (await Promise.all(targets)).filter((actor) => actor?.system);
  const effects = configuredSpellEffects(spell);
  const allTargets = [...new Map(effects.flatMap((effect) => (
    targetsForEffect(effect, caster, resolvedTargets)
  )).map((actor) => [actor.uuid, actor])).values()];
  if (!game.user?.isGM && allTargets.some((target) => target.isOwner === false)) {
    ui.notifications.warn(game.i18n.localize("YZE.Magic.GMApplyEffect"));
    return false;
  }
  const outcomes = [];
  for (const effect of effects) {
    const outcome = await applyConfiguredSpellEffect(caster, resolvedTargets, spell, state, effect);
    if (outcome === false) return false;
    if (outcome) outcomes.push(String(outcome));
  }
  await message.setFlag(SYSTEM_ID, MAGIC_APPLIED_FLAG, true);
  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor: caster }),
    content: `<div class="yze chat-card"><p>${escape(game.i18n.format("YZE.Magic.EffectApplied", {
      spell: spell.name,
      targets: allTargets.map((target) => target.name).join(", "),
      amount: state.powerLevel
    }))}</p>${outcomes.length > 0 ? `<ul>${outcomes.map((outcome) => `<li>${escape(outcome)}</li>`).join("")}</ul>` : ""}</div>`
  });
  return true;
}

export function countMagicRoll(results = []) {
  return results.reduce((summary, result) => {
    if (Number(result) === 6) summary.successes += 1;
    if (Number(result) === 1) summary.banes += 1;
    return summary;
  }, { successes: 0, banes: 0 });
}

export function magicDisciplines(actor) {
  return actor?.items
    ?.filter((item) => item.type === "specialty" && item.system.active
      && item.system.magicDiscipline && wholeNumber(item.system.rank) > 0)
    .map((item) => ({ id: item.id, name: item.name, rank: wholeNumber(item.system.rank) }))
    .sort((a, b) => a.name.localeCompare(b.name)) ?? [];
}

async function notifyNearbyMagicUsers(caster, spell, { obscuredPower = 0 } = {}) {
  if (obscuredPower > 0) return;
  const source = activeTokenForActor(caster);
  if (!source) return;
  for (const observer of game.actors.filter((actor) => actor.uuid !== caster.uuid
    && magicDisciplines(actor).length > 0)) {
    const token = activeTokenForActor(observer, (source.document ?? source).parent);
    if (!token) continue;
    const spatial = rangeBetweenTokens(source, token);
    let nearby = spatial.configured && ["engaged", "short"].includes(spatial.range);
    if (!spatial.configured) {
      const left = source.center ?? { x: Number((source.document ?? source).x), y: Number((source.document ?? source).y) };
      const right = token.center ?? { x: Number((token.document ?? token).x), y: Number((token.document ?? token).y) };
      const grid = Number((source.document ?? source).parent?.grid?.size) || 100;
      nearby = Math.hypot(left.x - right.x, left.y - right.y) <= grid * 1.5;
    }
    if (!nearby) continue;
    const whisper = Object.entries(observer.ownership ?? {})
      .filter(([id, level]) => id !== "default" && Number(level) >= CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER)
      .map(([id]) => id);
    if (whisper.length === 0) continue;
    await ChatMessage.create({
      whisper,
      speaker: ChatMessage.getSpeaker({ actor: observer }),
      content: `<div class="yze chat-card"><p>${escape(game.i18n.format("YZE.Magic.NearbyMagicSensed", { observer: observer.name, caster: caster.name, spell: spell.name }))}</p></div>`
    });
  }
}

function eligibleDisciplines(actor, spell) {
  const disciplines = magicDisciplines(actor);
  if (String(spell.system.discipline).toLowerCase() === "general") return disciplines;
  return disciplines.filter((entry) => entry.name.localeCompare(
    spell.system.discipline, undefined, { sensitivity: "base" }
  ) === 0);
}

async function appendMishapEffect(actor, effect) {
  await actor.setFlag(SYSTEM_ID, MAGIC_EFFECTS_FLAG, [...magicEffects(actor), {
    id: foundry.utils.randomID(), modifier: 0, affectedAttributes: "", affectedSkills: "", ...effect
  }]);
}

async function applyMishapEffect(actor, result, { spellMessage = null } = {}) {
  if (result === 1) {
    const roll = await new Roll("1d6").evaluate();
    await actor.setFlag(SYSTEM_ID, MAGIC_EFFECTS_FLAG, [...magicEffects(actor), {
      id: foundry.utils.randomID(), kind: "sleepless", name: MAGIC_MISHAPS[0].name, modifier: 0,
      affectedAttributes: "", affectedSkills: "", endsAt: worldTime() + wholeNumber(roll.total) * TIME_SECONDS.day,
      duration: `${roll.total} days`
    }]);
  } else if (result === 2) {
    if (isStressDiceEnabled()) {
      const current = wholeNumber(actor.system?.resources?.stress?.value);
      const maximum = Math.max(1, wholeNumber(actor.system?.resources?.stress?.max));
      await actor.update({ "system.resources.stress.value": Math.min(maximum, current + 1) });
    } else await applyDamage(actor, 1, { category: "mental", attributeKey: "empathy" });
  } else if (result === 3) {
    await applyDamage(actor, 1, { category: "physical", attributeKey: "strength" });
  } else if (result === 4) {
    const virulence = wholeNumber((await new Roll("2d6").evaluate()).total);
    const source = activeTokenForActor(actor);
    const exposed = new Map([[actor.uuid, actor]]);
    if (source) {
      for (const token of (source.document ?? source).parent?.tokens ?? []) {
        if (!token.actor || token.actor.uuid === actor.uuid) continue;
        const spatial = rangeBetweenTokens(source, token);
        if (spatial.configured && spatial.range === "engaged") exposed.set(token.actor.uuid, token.actor);
      }
    }
    const { rollSicknessExposure } = await import("./environmental-hazards.mjs");
    for (const target of exposed.values()) {
      await rollSicknessExposure(target, {
        poolRating: virulence,
        stepRating: Math.min(4, Math.max(1, Math.ceil(virulence / 3))),
        name: MAGIC_MISHAPS[3].name
      });
    }
    await appendMishapEffect(actor, {
      kind: "magical-contagion", name: MAGIC_MISHAPS[3].name,
      virulence, endsAt: worldTime() + TIME_SECONDS.shift, duration: "Shift",
      exposedUuids: [...exposed.keys()]
    });
  } else if (result === 5 && spellMessage) {
    const state = spellMessage.getFlag(SYSTEM_ID, "magic");
    const excluded = new Set([actor.uuid, ...(state?.targetUuids ?? [])]);
    const candidates = game.actors.filter((entry) => ["character", "npc", "mount"].includes(entry.type)
      && !excluded.has(entry.uuid));
    if (state && candidates.length > 0) {
      const options = candidates.map((entry) => `<option value="${escape(entry.uuid)}">${escape(entry.name)}</option>`).join("");
      const { DialogV2 } = foundry.applications.api;
      const uuid = await DialogV2.wait({
        window: { title: game.i18n.localize("YZE.Magic.UnintendedTarget") },
        content: `<div class="yze"><select name="target">${options}</select></div>`,
        buttons: [{ action: "choose", label: game.i18n.localize("YZE.Common.Continue"), default: true,
          callback: (event, button, dialog) => (button.form ?? dialog.element.querySelector("form")).elements.target?.value }],
        close: () => null, rejectClose: false, modal: true
      });
      if (uuid) await spellMessage.setFlag(SYSTEM_ID, "magic", {
        ...state, targetUuids: [...new Set([...(state.targetUuids ?? []), uuid])], unintendedTargetUuid: uuid
      });
    }
  } else if (result === 6) {
    await appendMishapEffect(actor, { kind: "altered-appearance", name: MAGIC_MISHAPS[5].name, duration: "Permanent" });
  } else if (result === 8) {
    await rollCriticalInjury(actor, "mental");
  } else if (result === 9) {
    await rollCriticalInjury(actor, "physical");
  } else if (result === 7) {
    await actor.setFlag(SYSTEM_ID, MAGIC_EFFECTS_FLAG, [...magicEffects(actor), {
      id: foundry.utils.randomID(), kind: "blinded", name: MAGIC_MISHAPS[6].name, modifier: -2,
      affectedAttributes: "", affectedSkills: "", endsAt: worldTime() + TIME_SECONDS.day, duration: "Day"
    }]);
  } else if (result === 10) {
    await appendMishapEffect(actor, {
      kind: "demon-due", name: MAGIC_MISHAPS[9].name,
      endsAt: worldTime() + TIME_SECONDS.shift, duration: "Shift"
    });
  } else if (result === 11) {
    await appendMishapEffect(actor, { kind: "backfire-pending", name: MAGIC_MISHAPS[10].name, duration: "Pending GM resolution" });
  } else if (result === 12) {
    const days = wholeNumber((await new Roll("1d6 * 10 + 1d6").evaluate()).total);
    await actor.update({ "system.dead": true });
    await appendMishapEffect(actor, {
      kind: "rift-return", name: MAGIC_MISHAPS[11].name,
      endsAt: worldTime() + days * TIME_SECONDS.day, duration: `${days} days`
    });
  }
}

export async function rollMagicMishap(actor, { reason = "", spellMessage = null } = {}) {
  const roll = await new Roll("1d12").evaluate();
  const result = Math.min(12, Math.max(1, wholeNumber(roll.total)));
  const mishap = MAGIC_MISHAPS[result - 1];
  await applyMishapEffect(actor, result, { spellMessage });
  await roll.toMessage({
    speaker: ChatMessage.getSpeaker({ actor }),
    flavor: `
      <div class="yze chat-card yze-magic-mishap-card">
        <h3>${escape(game.i18n.localize("YZE.Magic.Mishap"))}</h3>
        ${reason ? `<p class="hint">${escape(reason)}</p>` : ""}
        <h4>${result}: ${escape(mishap.name)}</h4>
        <p>${escape(mishap.effect)}</p>
      </div>`,
    flags: { [SYSTEM_ID]: { magicMishap: { actorUuid: actor.uuid, result } } }
  });
  return mishap;
}

function castDialogContent(actor, spell, disciplines) {
  const npc = actor.type === "npc";
  const disciplineOptions = disciplines.map((entry) => (
    `<option value="${escape(entry.id)}">${escape(entry.name)} (${escape(game.i18n.format("YZE.Magic.RankValue", { rank: entry.rank }))})</option>`
  )).join("");
  const storedSources = actor.items.filter((item) => wholeNumber(item.getFlag(SYSTEM_ID, "storedWillpower")) > 0);
  const personalWillpower = wholeNumber(actor.system?.resources?.willpower?.value);
  const available = npc
    ? Math.max(...disciplines.map((entry) => entry.rank))
    : Math.max(personalWillpower, ...storedSources.map((item) => wholeNumber(item.getFlag(SYSTEM_ID, "storedWillpower"))));
  const sourceOptions = [
    `<option value="">${escape(game.i18n.format("YZE.Magic.PersonalWillpower", { amount: personalWillpower }))}</option>`,
    ...storedSources.map((item) => `<option value="${escape(item.id)}">${escape(game.i18n.format("YZE.Magic.StoredWillpowerSource", {
      name: item.name,
      amount: wholeNumber(item.getFlag(SYSTEM_ID, "storedWillpower"))
    }))}</option>`)
  ].join("");
  const minimum = Math.max(1, wholeNumber(spell.system.cost));
  const safeMaximum = Math.max(...disciplines.map((entry) => entry.rank));
  const ritualItems = actor.items.filter((item) => ["gear", "consumable"].includes(item.type)
    && Number(item.system.quantity ?? item.system.supply) > 0);
  const ritualOptions = ritualItems.map((item) => `<option value="${escape(item.id)}">${escape(item.name)}</option>`).join("");
  return `
    <div class="yze yze-magic-dialog">
      <p><strong>${escape(spell.name)}</strong> — ${escape(game.i18n.format("YZE.Magic.SpellSummary", {
        rank: spell.system.rank,
        range: spell.system.range,
        duration: spell.system.duration
      }))}</p>
      <div class="form-group">
        <label>${escape(game.i18n.localize("YZE.Magic.Discipline"))}</label>
        <select name="discipline">${disciplineOptions}</select>
      </div>
      <div class="form-group">
        <label>${escape(game.i18n.localize("YZE.Magic.BasePower"))}</label>
        <input type="number" name="willpower" value="${minimum}" min="${minimum}" max="${available}" step="1">
      </div>
      ${npc ? "" : `<div class="form-group">
        <label>${escape(game.i18n.localize("YZE.Magic.WillpowerSource"))}</label>
        <select name="willpowerSource">${sourceOptions}</select>
      </div>`}
      <label class="checkbox-row">
        <input type="checkbox" name="grimoire">
        <span>${escape(game.i18n.localize("YZE.Magic.UseGrimoire"))}</span>
      </label>
      ${spell.system.ritual ? `<div class="form-group"><label>${escape(game.i18n.localize("YZE.Magic.RitualIngredient"))}</label><select name="ritualIngredient"><option value="">${escape(game.i18n.localize("YZE.Common.None"))}</option>${ritualOptions}</select></div><label class="checkbox-row"><input type="checkbox" name="consumeIngredient"> ${escape(game.i18n.localize("YZE.Magic.ConsumeRitualIngredient"))}</label>${spell.system.ritualRequirements ? `<p class="hint">${escape(spell.system.ritualRequirements)}</p>` : ""}` : ""}
      <div class="form-group">
        <label>${escape(game.i18n.localize("YZE.Magic.SafeDice"))}</label>
        <input type="number" name="safeDice" value="0" min="0" max="${safeMaximum}" step="1">
      </div>
      <p class="hint">${escape(game.i18n.localize(npc ? "YZE.Magic.NPCHint" : "YZE.Magic.CastHint"))}</p>
    </div>`;
}

async function promptCast(actor, spell, disciplines) {
  const npc = actor.type === "npc";
  const { DialogV2 } = foundry.applications.api;
  return DialogV2.wait({
    window: { title: game.i18n.format("YZE.Magic.CastTitle", { spell: spell.name }) },
    content: castDialogContent(actor, spell, disciplines),
    buttons: [
      {
        action: "cast",
        label: game.i18n.localize("YZE.Magic.Cast"),
        icon: "fa-solid fa-wand-sparkles",
        default: true,
        callback: (event, button, dialog) => {
          const form = button.form ?? dialog.element.querySelector("form");
          const discipline = disciplines.find((entry) => entry.id === form.elements.discipline?.value);
          if (!discipline) return null;
          const grimoire = form.elements.grimoire?.checked === true;
          const effectiveRank = Math.max(0, wholeNumber(spell.system.rank) - (grimoire ? 1 : 0));
          const safeMaximum = Math.max(0, discipline.rank - effectiveRank);
          return {
            discipline,
            willpower: wholeNumber(form.elements.willpower?.value),
            willpowerSourceId: String(form.elements.willpowerSource?.value || ""),
            grimoire,
            ritualIngredientId: String(form.elements.ritualIngredient?.value || ""),
            consumeIngredient: form.elements.consumeIngredient?.checked === true,
            safeDice: Math.min(safeMaximum, wholeNumber(form.elements.safeDice?.value)),
            effectiveRank,
            npc
          };
        }
      },
      { action: "cancel", label: game.i18n.localize("YZE.Common.Cancel"), callback: () => null }
    ],
    close: () => null,
    rejectClose: false,
    modal: true
  });
}

export async function castSpell(actor, spellId) {
  if (!isMagicEnabled()) {
    ui.notifications.warn(game.i18n.localize("YZE.Magic.Disabled"));
    return null;
  }
  const spell = actor?.items?.get(spellId);
  if (!spell || spell.type !== "spell" || (actor.isOwner === false && !game.user?.isGM)) return null;
  const disciplines = eligibleDisciplines(actor, spell);
  if (disciplines.length === 0) {
    ui.notifications.warn(game.i18n.format("YZE.Magic.DisciplineMissing", {
      discipline: spell.system.discipline
    }));
    return null;
  }
  if (spell.system.ritual && combatActionState(actor).active) {
    ui.notifications.warn(game.i18n.localize("YZE.Magic.RitualInCombat"));
    return null;
  }
  const effects = configuredSpellEffects(spell);
  const targetTokens = [...(game.user?.targets ?? [])].filter((token) => token.actor);
  const targetUuids = targetTokens
    .map((token) => token.actor?.uuid)
    .filter(Boolean);
  const requiresSelectedTarget = effects.some((effect) => (
    !["self"].includes(String(effect.targetMode || "selected"))
  ));
  if (requiresSelectedTarget && targetUuids.length === 0) {
    ui.notifications.warn(game.i18n.localize("YZE.Magic.SelectTarget"));
    return null;
  }
  const spellMaximum = maximumRange(spell.system.range);
  const sourceToken = spellMaximum ? activeTokenForActor(actor) : null;
  if (requiresSelectedTarget && spellMaximum && sourceToken) {
    for (const targetToken of targetTokens) {
      const spatial = rangeBetweenTokens(sourceToken, targetToken);
      if (!spatial.configured) continue;
      if (!spatial.visible) {
        ui.notifications.warn(game.i18n.localize(`YZE.Zones.Sight.${spatial.reason}`));
        return null;
      }
      if (!rangeAllows(spatial.range, spellMaximum)) {
        ui.notifications.warn(game.i18n.format("YZE.Zones.SpellOutOfRange", {
          spell: spell.name,
          target: targetToken.name,
          range: game.i18n.localize(`YZE.Range.${spatial.range}`)
        }));
        return null;
      }
    }
  }
  const selection = await promptCast(actor, spell, disciplines);
  if (!selection) return null;
  if (spell.system.ritual && spell.system.ritualRequirements && !selection.ritualIngredientId) {
    ui.notifications.warn(game.i18n.localize("YZE.Magic.RitualIngredientRequired"));
    return null;
  }
  const minimum = Math.max(1, wholeNumber(spell.system.cost));
  const storedSource = selection.willpowerSourceId
    ? actor.items.get(selection.willpowerSourceId)
    : null;
  const available = storedSource
    ? wholeNumber(storedSource.getFlag(SYSTEM_ID, "storedWillpower"))
    : wholeNumber(actor.system?.resources?.willpower?.value);
  if (!selection.npc && (selection.willpower < minimum || selection.willpower > available)) {
    ui.notifications.warn(game.i18n.localize("YZE.Magic.NotEnoughWillpower"));
    return null;
  }
  if (selection.npc && selection.willpower > selection.discipline.rank) {
    ui.notifications.warn(game.i18n.localize("YZE.Magic.NPCPowerTooHigh"));
    return null;
  }
  if (selection.effectiveRank > selection.discipline.rank + 1) {
    ui.notifications.warn(game.i18n.localize("YZE.Magic.RankTooHigh"));
    return null;
  }
  const chanceCasting = selection.effectiveRank === selection.discipline.rank + 1;
  const actionCost = spell.system.ritual
    ? { fast: 0, slow: 0 }
    : { fast: (spell.system.powerWord ? 1 : 0) + (selection.grimoire ? 1 : 0), slow: spell.system.powerWord ? 0 : 1 };
  if (!canSpendActorActions(actor, actionCost)) {
    ui.notifications.warn(game.i18n.localize("YZE.Combat.NotEnoughActions"));
    return null;
  }

  if (!selection.npc) {
    if (storedSource) await storedSource.setFlag(
      SYSTEM_ID,
      "storedWillpower",
      available - selection.willpower
    );
    else {
      await actor.update({ "system.resources.willpower.value": available - selection.willpower });
      await consumeTemporaryWillpower(actor, selection.willpower);
    }
  }
  if (spell.system.ritual && selection.consumeIngredient && selection.ritualIngredientId) {
    const ingredient = actor.items.get(selection.ritualIngredientId);
    if (!ingredient) return null;
    const field = getConsumableMode() === CONSUMABLE_MODES.SUPPLY && ingredient.type === "consumable"
      ? "supply" : "quantity";
    const amount = wholeNumber(ingredient.system[field]);
    if (amount < 1) {
      ui.notifications.warn(game.i18n.localize("YZE.Magic.RitualIngredientRequired"));
      return null;
    }
    await ingredient.update({ [`system.${field}`]: amount - 1 });
  }
  const dice = Math.max(0, selection.willpower - selection.safeDice);
  const roll = dice > 0 ? await new Roll(`${dice}d6`).evaluate() : null;
  const summary = countMagicRoll(activeResults(roll));
  const powerLevel = selection.willpower + summary.successes;
  const mishap = chanceCasting || summary.banes > 0;
  const canApply = effects.length > 0 && (!requiresSelectedTarget || targetUuids.length > 0);
  const content = `
    <div class="yze chat-card yze-spell-card">
      <h3>${escape(game.i18n.format("YZE.Magic.CastResultTitle", { actor: actor.name, spell: spell.name }))}</h3>
      <p>${escape(game.i18n.format("YZE.Magic.CastResult", {
        discipline: selection.discipline.name,
        base: selection.willpower,
        dice,
        successes: summary.successes,
        banes: summary.banes,
        power: powerLevel
      }))}</p>
      ${selection.safeDice > 0 ? `<p>${escape(game.i18n.format("YZE.Magic.SafeCastingUsed", { dice: selection.safeDice }))}</p>` : ""}
      ${chanceCasting ? `<p class="yze-panic-warning">${escape(game.i18n.localize("YZE.Magic.ChanceCastingMishap"))}</p>` : ""}
      <p><strong>${escape(game.i18n.localize("YZE.Magic.Range"))}:</strong> ${escape(spell.system.range)}; <strong>${escape(game.i18n.localize("YZE.Magic.Duration"))}:</strong> ${escape(spell.system.duration)}</p>
      <div class="yze-spell-effect">${spell.system.description}</div>
      ${canApply ? `<button type="button" data-action="applyMagicEffect"><i class="fa-solid fa-wand-magic-sparkles"></i> ${escape(game.i18n.localize("YZE.Magic.ApplyEffect"))}</button>` : ""}
    </div>`;
  const messageData = {
    speaker: ChatMessage.getSpeaker({ actor }),
    flavor: content,
    content,
    flags: { [SYSTEM_ID]: { magic: {
      actorUuid: actor.uuid, spellUuid: spell.uuid, discipline: selection.discipline.name,
      basePower: selection.willpower, powerLevel, successes: summary.successes,
      banes: summary.banes, chanceCasting, targetUuids
    } } }
  };
  const obscuredPower = wholeNumber(actor.getFlag(SYSTEM_ID, "obscureNextSpellPower"));
  if (obscuredPower > 0 && spell.name !== "Obscure Magic") {
    messageData.flags[SYSTEM_ID].magic.obscuredPower = obscuredPower;
    await actor.unsetFlag(SYSTEM_ID, "obscureNextSpellPower");
  }
  const message = roll ? await roll.toMessage(messageData) : await ChatMessage.create(messageData);
  await notifyNearbyMagicUsers(actor, spell, { obscuredPower: messageData.flags[SYSTEM_ID].magic.obscuredPower });
  if (actionCost.fast || actionCost.slow) await spendActorActions(actor, actionCost);
  if (mishap) await rollMagicMishap(actor, {
    reason: game.i18n.format("YZE.Magic.MishapReason", { spell: spell.name }),
    spellMessage: message
  });
  return message;
}

async function applyRecurringMagicTick(actor, effect) {
  if (wholeNumber(effect.tickDamage) > 0) {
    await applyDamage(actor, wholeNumber(effect.tickDamage), {
      category: "physical",
      attributeKey: "strength"
    });
  }
  if (wholeNumber(effect.tickStress) > 0) {
    if (isStressDiceEnabled()) await adjustSpellResource(actor, "stress", wholeNumber(effect.tickStress));
    else await applyDamage(actor, wholeNumber(effect.tickStress), {
      category: "mental",
      attributeKey: "wits"
    });
  }
}

async function updateSuffocationDeadline(actor, effect, combat) {
  if (effect.kind !== "suffocation") return false;
  if (!getActorBrokenState(actor).broken) {
    if (!effect.fatalCombatRound && !effect.fatalAt) return false;
    effect.fatalCombatRound = 0;
    effect.fatalAt = 0;
    return true;
  }
  if (effect.fatalCombatRound || effect.fatalAt) return false;
  const roll = await new Roll("1d6").evaluate();
  const rounds = Math.max(1, wholeNumber(roll.total));
  if (combat && actorCombatant(actor, combat)) effect.fatalCombatRound = (Number(combat.round) || 0) + rounds;
  else effect.fatalAt = worldTime() + rounds * TIME_SECONDS.round;
  await roll.toMessage({
    speaker: ChatMessage.getSpeaker({ actor }),
    flavor: `<div class="yze chat-card"><h3>${escape(game.i18n.localize("YZE.SpellEffects.SuffocationDeadline"))}</h3><p>${escape(
      game.i18n.format("YZE.SpellEffects.SuffocationDeadlineHint", { actor: actor.name, rounds })
    )}</p></div>`
  });
  return true;
}

async function expireMagicEffects(time = worldTime(), combat = game.combat, {
  advanceCombat = false,
  forceCombatCleanup = false
} = {}) {
  if (!game.user?.isGM) return;
  const actors = new Map([
    ...[...(game.actors ?? [])].map((actor) => [actor.uuid, actor]),
    ...[...(canvas?.tokens?.placeables ?? [])].filter((token) => token.actor)
      .map((token) => [token.actor.uuid, token.actor])
  ]);
  for (const actor of actors.values()) {
    const effects = magicEffects(actor);
    let changed = false;
    for (const effect of effects) {
      if (effect.kind === "suffocation") {
        changed = await updateSuffocationDeadline(actor, effect, combat) || changed;
        const fatal = (Number(effect.fatalAt) > 0 && time >= Number(effect.fatalAt))
          || (advanceCombat && Number(effect.fatalCombatRound) > 0
            && Number(combat?.round) >= Number(effect.fatalCombatRound));
        if (fatal && getActorBrokenState(actor).broken) {
          await actor.update({ "system.dead": true });
          effect.remainingTicks = 0;
          changed = true;
        }
      }
      while (wholeNumber(effect.remainingTicks) > 0
        && Number(effect.nextTickAt) > 0
        && time >= Number(effect.nextTickAt)) {
        await applyRecurringMagicTick(actor, effect);
        changed = await updateSuffocationDeadline(actor, effect, combat) || changed;
        effect.remainingTicks = wholeNumber(effect.remainingTicks) - 1;
        effect.nextTickAt = effect.remainingTicks > 0
          ? Number(effect.nextTickAt) + Math.max(1, wholeNumber(effect.tickInterval))
          : 0;
        changed = true;
      }
      while (advanceCombat
        && effect.combatId === combat?.id
        && wholeNumber(effect.remainingTicks) > 0
        && Number(effect.nextCombatRound) > 0
        && Number(combat.round) >= Number(effect.nextCombatRound)) {
        await applyRecurringMagicTick(actor, effect);
        changed = await updateSuffocationDeadline(actor, effect, combat) || changed;
        effect.remainingTicks = wholeNumber(effect.remainingTicks) - 1;
        effect.nextCombatRound = effect.remainingTicks > 0 ? Number(effect.nextCombatRound) + 1 : 0;
        changed = true;
      }
    }
    const expired = effects.filter((effect) => {
      const durationEnded = (!effect.combatId && Number(effect.endsAt) > 0 && time >= Number(effect.endsAt))
        || (effect.combatId && effect.combatId === combat?.id
          && Number(effect.endsCombatRound) > 0
          && Number(combat.round) >= Number(effect.endsCombatRound));
      const awaitingSuffocationDeath = effect.kind === "suffocation"
        && !forceCombatCleanup
        && actor.system.dead !== true
        && getActorBrokenState(actor).broken
        && (Number(effect.fatalAt) > 0 || Number(effect.fatalCombatRound) > 0);
      return durationEnded && !awaitingSuffocationDeath;
    });
    for (const effect of expired) {
      if (wholeNumber(effect.resourceGrant) > 0 && effect.resource) {
        await adjustSpellResource(actor, effect.resource, -wholeNumber(effect.resourceGrant));
      }
      if (effect.kind === "demon-due") {
        await ChatMessage.create({
          whisper: game.users.filter((user) => user.isGM).map((user) => user.id),
          content: `<div class="yze chat-card"><p><strong>${escape(game.i18n.format("YZE.Magic.DemonArrives", { actor: actor.name }))}</strong></p></div>`
        });
      }
      if (effect.kind === "rift-return") {
        await actor.update({ "system.dead": false });
        await actor.setFlag(SYSTEM_ID, "riftReturnPendingNPC", true);
        await ChatMessage.create({
          whisper: game.users.filter((user) => user.isGM).map((user) => user.id),
          content: `<div class="yze chat-card"><p><strong>${escape(game.i18n.format("YZE.Magic.RiftReturn", { actor: actor.name }))}</strong></p></div>`
        });
      }
    }
    const next = effects.filter((effect) => !expired.some((entry) => entry.id === effect.id));
    if (changed || next.length !== effects.length) await actor.setFlag(SYSTEM_ID, MAGIC_EFFECTS_FLAG, next);
  }
}

export function registerMagicHooks() {
  Hooks.on("renderChatMessageHTML", (message, html) => {
    const root = html?.querySelector ? html : html?.[0];
    const button = root?.querySelector?.('[data-action="applyMagicEffect"]');
    if (!button) return;
    if (message.getFlag(SYSTEM_ID, MAGIC_APPLIED_FLAG)) {
      button.disabled = true;
      return;
    }
    button.addEventListener("click", async () => {
      button.disabled = true;
      if (!await applySpellOutcome(message)) button.disabled = false;
    });
  });
  Hooks.once("ready", () => expireMagicEffects().catch((error) => console.error("YZE System Toolkit | Magic effect expiry failed", error)));
  Hooks.on("updateWorldTime", (time) => expireMagicEffects(Number(time)).catch((error) => console.error("YZE System Toolkit | Magic effect expiry failed", error)));
  Hooks.on("updateCombat", (combat, changes) => {
    if (!Object.hasOwn(changes, "round")) return;
    expireMagicEffects(worldTime(), combat, { advanceCombat: true }).catch((error) => console.error("YZE System Toolkit | Magic round expiry failed", error));
  });
  Hooks.on("deleteCombat", (combat) => {
    expireMagicEffects(worldTime(), {
      id: combat.id,
      round: Number.MAX_SAFE_INTEGER
    }, { forceCombatCleanup: true }).catch((error) => console.error("YZE System Toolkit | Magic combat cleanup failed", error));
  });
  Hooks.on("updateToken", async (token, changes) => {
    if (!Object.hasOwn(changes, "x") && !Object.hasOwn(changes, "y")) return;
    const primaryGM = game.users.filter((user) => user.active && user.isGM)
      .sort((left, right) => left.id.localeCompare(right.id))[0];
    if (game.user?.id !== primaryGM?.id || !token.actor) return;
    for (const sourceActor of game.actors ?? []) {
      const effects = magicEffects(sourceActor);
      const sourceToken = activeTokenForActor(sourceActor, token.parent);
      if (!sourceToken) continue;
      let changed = false;
      for (const effect of effects) {
        if (effect.kind !== "magical-contagion" || Number(effect.endsAt) <= worldTime()
          || (effect.exposedUuids ?? []).includes(token.actor.uuid)) continue;
        const spatial = rangeBetweenTokens(sourceToken, token);
        if (!spatial.configured || spatial.range !== "engaged") continue;
        const { rollSicknessExposure } = await import("./environmental-hazards.mjs");
        await rollSicknessExposure(token.actor, {
          poolRating: wholeNumber(effect.virulence),
          stepRating: Math.min(4, Math.max(1, Math.ceil(wholeNumber(effect.virulence) / 3))),
          name: effect.name || MAGIC_MISHAPS[3].name
        });
        effect.exposedUuids = [...new Set([...(effect.exposedUuids ?? []), token.actor.uuid])];
        changed = true;
      }
      if (changed) await sourceActor.setFlag(SYSTEM_ID, MAGIC_EFFECTS_FLAG, effects);
    }
  });
}
