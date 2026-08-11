import {
  DICE_SYSTEMS,
  HARM_MODELS,
  SYSTEM_ID,
  getStepRating
} from "./constants.mjs";
import { getActorBrokenState } from "./critical-injuries.mjs";
import { applyDamage, promptProtection, rollArmor, rollCover } from "./harm.mjs";
import {
  clearEnvironmentalHazard,
  environmentalHazards,
  updateEnvironmentalHazards
} from "./hazard-state.mjs";
import {
  formatStepRatingLabel,
  getDiceSystem,
  getHarmModel,
  isStressDiceEnabled
} from "./settings.mjs";
import { INJURY_TIME_SECONDS } from "./injury-timing.mjs";
import { combatActionState, spendActorActions } from "./combat.mjs";
import { countStateSuccesses } from "./dice/successes.mjs";

const APPLIED_FLAG = "hazardApplied";
const PUSH_FLAG = "push";
const ROUND_SECONDS = 6;

function escape(value) {
  return foundry.utils.escapeHTML(String(value));
}

function whole(value, minimum = 0) {
  const number = Math.trunc(Number(value));
  return Number.isFinite(number) ? Math.max(minimum, number) : minimum;
}

function now() {
  return Math.max(0, Number(game.time?.worldTime) || 0);
}

function primaryGM() {
  return game.users?.filter((user) => user.active && user.isGM)
    .sort((left, right) => Number(right.role) - Number(left.role) || left.id.localeCompare(right.id))[0];
}

function mayUpdate(actor) {
  return Boolean(actor) && (game.user?.isGM === true || actor.isOwner !== false);
}

function hasMagicProtection(actor, kind) {
  const effects = actor?.getFlag?.(SYSTEM_ID, "magicEffects");
  return Array.isArray(effects) && effects.some((effect) => effect.kind === kind);
}

function stateSuccesses(state) {
  return countStateSuccesses(state);
}

function activeResults(roll) {
  return (roll.dice ?? []).flatMap((die) => die.results ?? [])
    .filter((result) => result.active !== false)
    .map((result) => Number(result.result));
}

export function countHazardSuccesses(results = [], { step = false } = {}) {
  return results.reduce((total, result) => (
    total + (step ? (result >= 10 ? 2 : result >= 6 ? 1 : 0) : result === 6 ? 1 : 0)
  ), 0);
}

async function rollHazardRating(rating, label, { twoStepDice = true } = {}) {
  const step = getDiceSystem() === DICE_SYSTEMS.STEP;
  const safeRating = whole(rating, 1);
  const stepRating = getStepRating(Math.min(4, safeRating));
  const formula = step
    ? `${twoStepDice ? 2 : 1}d${stepRating.faces}`
    : `${safeRating}d6`;
  const roll = await new Roll(formula).evaluate();
  const successes = countHazardSuccesses(activeResults(roll), { step });
  await roll.toMessage({
    flavor: `<div class="yze chat-card yze-hazard-roll"><h3>${escape(label)}</h3><p>${escape(
      game.i18n.format(successes === 1 ? "YZE.Roll.Success" : "YZE.Roll.Successes", { count: successes })
    )}</p></div>`
  });
  return { roll, successes };
}

function skillNamed(actor, name) {
  return actor?.items?.find((item) => item.type === "skill"
    && item.name.localeCompare(name, undefined, { sensitivity: "base" }) === 0);
}

async function protectAndDamage(actor, damage, { ranged = false, category = "physical" } = {}) {
  let penetrating = whole(damage);
  if (penetrating < 1) return 0;
  const protection = await promptProtection(actor, penetrating, { ranged });
  if (!protection) return null;
  const cover = ranged
    ? await rollCover(actor, protection.damage, { useCover: protection.useCover })
    : { penetrating: protection.damage };
  const armor = await rollArmor(actor, cover.penetrating, protection.armorId);
  penetrating = armor.penetrating;
  if (penetrating > 0) {
    await applyDamage(actor, penetrating, {
      category,
      skipCriticalInjury: true,
      environmental: true
    });
  }
  return penetrating;
}

async function applyColdFailure(actor) {
  if (hasMagicProtection(actor, "firewalker")) return;
  await applyDamage(actor, 1, {
    category: "physical",
    attributeKey: "strength",
    skipCriticalInjury: true,
    environmental: true
  });
  if (isStressDiceEnabled()) {
    const current = whole(actor.system?.resources?.stress?.value);
    const maximum = whole(actor.system?.resources?.stress?.max, 1);
    await actor.update({ "system.resources.stress.value": Math.min(maximum, current + 1) });
  } else if (getHarmModel() !== HARM_MODELS.HEALTH_ONLY) {
    await applyDamage(actor, 1, {
      category: "mental",
      attributeKey: "wits",
      skipCriticalInjury: true,
      environmental: true
    });
  }
}

async function configureHazard(kind) {
  const step = getDiceSystem() === DICE_SYSTEMS.STEP;
  const ratingLabel = game.i18n.localize(step ? "YZE.Environment.StepRating" : "YZE.Environment.PoolRating");
  const stepOptions = [1, 2, 3, 4].map((rating) => {
    return `<option value="${rating}">${escape(formatStepRatingLabel(rating))}</option>`;
  }).join("");
  const ratingInput = step
    ? `<select name="rating">${stepOptions}</select>`
    : `<input type="number" name="rating" value="6" min="1" max="20" step="1">`;
  const blocks = {
    fire: `<div class="form-group"><label>${escape(ratingLabel)}</label>${ratingInput}</div>`,
    explosion: `<div class="form-group"><label>${escape(ratingLabel)}</label>${ratingInput}</div>
      <div class="form-group"><label>${escape(game.i18n.localize("YZE.Environment.BaseDamage"))}</label><input type="number" name="baseDamage" value="2" min="1" step="1"></div>
      <div class="form-group"><label>${escape(game.i18n.localize("YZE.Environment.Range"))}</label><select name="range"><option value="short">${escape(game.i18n.localize("YZE.Range.short"))}</option><option value="engaged">${escape(game.i18n.localize("YZE.Range.engaged"))}</option><option value="medium">${escape(game.i18n.localize("YZE.Range.medium"))}</option></select></div>`,
    falling: `<div class="form-group"><label>${escape(game.i18n.localize("YZE.Environment.Height"))}</label><input type="number" name="height" value="4" min="0" step="1"></div><label class="checkbox-row"><input type="checkbox" name="controlled"><span>${escape(game.i18n.localize("YZE.Environment.ControlledFall"))}</span></label>`,
    poison: `<div class="form-group"><label>${escape(ratingLabel)}</label>${ratingInput}</div><div class="form-group"><label>${escape(game.i18n.localize("YZE.Environment.PoisonType"))}</label><select name="effect"><option value="lethal">${escape(game.i18n.localize("YZE.Environment.LethalPoison"))}</option><option value="paralyzing">${escape(game.i18n.localize("YZE.Environment.ParalyzingPoison"))}</option><option value="sleeping">${escape(game.i18n.localize("YZE.Environment.SleepingPoison"))}</option></select></div>`,
    disease: `<div class="form-group"><label>${escape(ratingLabel)}</label>${ratingInput}</div><div class="form-group"><label>${escape(game.i18n.localize("YZE.Environment.DiseaseName"))}</label><input type="text" name="name" value="${escape(game.i18n.localize("YZE.Environment.Disease"))}"></div>`,
    cold: `<div class="form-group"><label>${escape(game.i18n.localize("YZE.Environment.Interval"))}</label><select name="interval"><option value="day">${escape(game.i18n.localize("YZE.Environment.Day"))}</option><option value="shift">${escape(game.i18n.localize("YZE.Environment.Shift"))}</option><option value="stretch">${escape(game.i18n.localize("YZE.Environment.Stretch"))}</option></select></div>`,
    darkness: "",
    drowning: "",
    starvation: "",
    sleepDeprivation: ""
  };
  const { DialogV2 } = foundry.applications.api;
  return DialogV2.wait({
    window: { title: game.i18n.localize(`YZE.Environment.Hazards.${kind}`) },
    content: `<div class="yze yze-damage-dialog">${blocks[kind] ?? ""}</div>`,
    buttons: [
      {
        action: "apply",
        label: game.i18n.localize("YZE.Common.Continue"),
        icon: "fa-solid fa-triangle-exclamation",
        default: true,
        callback: (event, button, dialog) => {
          const form = button.form ?? dialog.element.querySelector("form");
          return {
            rating: whole(form.elements.rating?.value, 1),
            baseDamage: whole(form.elements.baseDamage?.value, 1),
            height: whole(form.elements.height?.value),
            controlled: form.elements.controlled?.checked === true,
            range: form.elements.range?.value ?? "short",
            effect: form.elements.effect?.value ?? "lethal",
            interval: form.elements.interval?.value ?? "day",
            name: String(form.elements.name?.value ?? "").trim()
          };
        }
      },
      { action: "cancel", label: game.i18n.localize("YZE.Common.Cancel"), icon: "fa-solid fa-xmark", callback: () => null }
    ],
    close: () => null,
    rejectClose: false,
    modal: true
  });
}

async function chooseHazard() {
  const kinds = ["darkness", "fire", "explosion", "falling", "drowning", "poison", "disease", "cold", "starvation", "sleepDeprivation"];
  const options = kinds.map((kind) => `<option value="${kind}">${escape(game.i18n.localize(`YZE.Environment.Hazards.${kind}`))}</option>`).join("");
  const { DialogV2 } = foundry.applications.api;
  return DialogV2.wait({
    window: { title: game.i18n.localize("YZE.Environment.Title") },
    content: `<div class="yze yze-damage-dialog"><div class="form-group"><label>${escape(game.i18n.localize("YZE.Environment.Hazard"))}</label><select name="hazard">${options}</select></div></div>`,
    buttons: [
      { action: "continue", label: game.i18n.localize("YZE.Common.Continue"), icon: "fa-solid fa-arrow-right", default: true, callback: (event, button, dialog) => (button.form ?? dialog.element.querySelector("form")).elements.hazard?.value },
      { action: "cancel", label: game.i18n.localize("YZE.Common.Cancel"), icon: "fa-solid fa-xmark", callback: () => null }
    ],
    close: () => null,
    rejectClose: false,
    modal: true
  });
}

async function skillHazardRoll(actor, skillName, hazard, options = {}) {
  const skill = skillNamed(actor, skillName);
  if (!skill) {
    ui.notifications.error(game.i18n.format("YZE.Environment.SkillMissing", { skill: skillName }));
    return null;
  }
  return actor.rollSkill(skill.id, {
    allowBroken: options.allowBroken === true,
    canPush: options.canPush,
    canOppose: false,
    helpAction: options.helpAction,
    allowHelpers: options.allowHelpers !== false,
    applyInjuryDamage: false,
    fixedModifiers: options.fixedModifiers ?? [],
    hazard
  });
}

/** Make the SRD opposed sickness roll for a known disease or contaminated meal. */
export async function rollSicknessExposure(actor, {
  poolRating = 6,
  stepRating = 2,
  name = null
} = {}) {
  if (!mayUpdate(actor) || actor?.type === "vehicle" || actor.system?.dead === true) return null;
  const rating = getDiceSystem() === DICE_SYSTEMS.STEP
    ? whole(stepRating, 1)
    : whole(poolRating, 1);
  const diseaseName = name || game.i18n.localize("YZE.Environment.Disease");
  const threat = await rollHazardRating(rating, diseaseName);
  return skillHazardRoll(actor, "Stamina", {
    kind: "disease",
    actorUuid: actor.uuid,
    rating,
    threatSuccesses: threat.successes,
    name: diseaseName
  });
}

/** Make an opposed ingestion roll for poison whose ratings are known in both dice modes. */
export async function rollPoisonExposure(actor, {
  poolRating = 6,
  stepRating = 2,
  effect = "lethal"
} = {}) {
  if (!mayUpdate(actor) || actor?.type === "vehicle" || actor.system?.dead === true) return null;
  const rating = getDiceSystem() === DICE_SYSTEMS.STEP
    ? whole(stepRating, 1)
    : whole(poolRating, 1);
  const threat = await rollHazardRating(rating, game.i18n.localize("YZE.Environment.Hazards.poison"));
  return skillHazardRoll(actor, "Stamina", {
    kind: "poison",
    actorUuid: actor.uuid,
    rating,
    threatSuccesses: threat.successes,
    effect
  });
}

/** Roll the standard Stamina check used when a camp or weather exposes an Actor to cold. */
export async function rollColdExposure(actor, { modifier = 0, name = null } = {}) {
  if (!mayUpdate(actor) || actor?.type === "vehicle" || actor.system?.dead === true) return null;
  return skillHazardRoll(actor, "Stamina", {
    kind: "cold",
    actorUuid: actor.uuid,
    name: name || game.i18n.localize("YZE.Environment.Hazards.cold")
  }, {
    fixedModifiers: modifier ? [[game.i18n.localize("YZE.Environment.Hazards.cold"), modifier]] : []
  });
}

export async function promptEnvironmentalHazard(actor) {
  if (!mayUpdate(actor) || actor?.type === "vehicle" || actor.system?.dead === true) return null;
  const kind = await chooseHazard();
  if (!kind) return null;
  const config = await configureHazard(kind);
  if (!config) return null;
  const actorUuid = actor.uuid;

  if (kind === "darkness") return skillHazardRoll(actor, "Mobility", { kind, actorUuid });
  if (kind === "drowning") return skillHazardRoll(actor, "Stamina", { kind, actorUuid });
  if (kind === "cold") return skillHazardRoll(actor, "Stamina", { kind, actorUuid, interval: config.interval });
  if (kind === "falling" && config.controlled) {
    return skillHazardRoll(actor, "Mobility", { kind, actorUuid, height: config.height });
  }
  if (kind === "poison" || kind === "disease") {
    const threat = await rollHazardRating(config.rating, game.i18n.localize(`YZE.Environment.Hazards.${kind}`));
    return skillHazardRoll(actor, "Stamina", {
      kind,
      actorUuid,
      rating: config.rating,
      threatSuccesses: threat.successes,
      effect: config.effect,
      name: config.name
    });
  }
  if (kind === "fire") {
    return promptEnvironmentalHazardDirect(actor, "fire", { active: true, ...config });
  }
  if (kind === "explosion") {
    let rating = config.rating;
    if (config.range === "medium") rating = Math.max(1, rating - (getDiceSystem() === DICE_SYSTEMS.STEP ? 2 : 6));
    const result = await rollHazardRating(rating, game.i18n.localize("YZE.Environment.Hazards.explosion"));
    const damage = result.successes > 0
      ? config.baseDamage + result.successes - 1 + (config.range === "engaged" ? 1 : 0)
      : config.range === "engaged" ? 1 : 0;
    await protectAndDamage(actor, damage, { ranged: true });
    return result.roll;
  }
  if (kind === "falling") {
    await protectAndDamage(actor, Math.floor(config.height / 2));
    return true;
  }
  if (kind === "starvation") {
    await updateEnvironmentalHazards(actor, { starvation: { active: true, due: false, nextAt: now() + 7 * INJURY_TIME_SECONDS.day } });
    return true;
  }
  if (kind === "sleepDeprivation") {
    await updateEnvironmentalHazards(actor, { sleepDeprivation: { active: true, since: now() } });
    return true;
  }
  return null;
}

export async function extinguishEnvironmentalFire(actor) {
  if (!environmentalHazards(actor).fire?.active || !mayUpdate(actor)) return null;
  const actions = combatActionState(actor);
  if (actions.active && !actions.canSlow) {
    ui.notifications.warn(game.i18n.localize("YZE.Combat.NotEnoughActions"));
    return null;
  }
  const { DialogV2 } = foundry.applications.api;
  const blanket = await DialogV2.wait({
    window: { title: game.i18n.localize("YZE.Environment.ExtinguishFire") },
    content: `<div class="yze yze-damage-dialog"><label class="checkbox-row"><input type="checkbox" name="blanket"><span>${escape(game.i18n.localize("YZE.Environment.UseBlanket"))}</span></label></div>`,
    buttons: [
      { action: "roll", label: game.i18n.localize("YZE.Environment.ExtinguishFire"), icon: "fa-solid fa-fire-extinguisher", default: true, callback: (event, button, dialog) => (button.form ?? dialog.element.querySelector("form")).elements.blanket?.checked === true },
      { action: "cancel", label: game.i18n.localize("YZE.Common.Cancel"), icon: "fa-solid fa-xmark", callback: () => null }
    ],
    close: () => null,
    rejectClose: false,
    modal: true
  });
  if (blanket === null) return null;
  const message = await skillHazardRoll(actor, "Mobility", {
    kind: "extinguishFire",
    actorUuid: actor.uuid
  }, {
    helpAction: "slow",
    fixedModifiers: blanket ? [[game.i18n.localize("YZE.Environment.BlanketModifier"), 2]] : []
  });
  if (message) await spendActorActions(actor, { slow: 1 });
  return message;
}

function hazardOutcome(state, successes) {
  const hazard = state.hazard;
  if (hazard.kind === "stressfulSituation") {
    return successes >= whole(hazard.potentialStress) ? "resisted" : "failed";
  }
  if (["poison", "disease"].includes(hazard.kind)) return successes > whole(hazard.threatSuccesses) ? "resisted" : "failed";
  return successes > 0 ? "resisted" : "failed";
}

export function renderHazardControl(state) {
  if (!state?.hazard) return "";
  const successes = stateSuccesses(state);
  if (state.hazard.kind === "stressfulSituation") {
    const remaining = Math.max(0, whole(state.hazard.potentialStress) - successes);
    return `<div class="yze-hazard-result ${remaining === 0 ? "is-success" : "is-failure"}">
      <p>${escape(game.i18n.format("YZE.Environment.StressfulResult", {
        potential: whole(state.hazard.potentialStress), successes, remaining
      }))}</p>
      <button type="button" data-action="applyHazard"><i class="fa-solid fa-brain"></i> ${escape(game.i18n.localize("YZE.Environment.ApplyStress"))}</button>
    </div>`;
  }
  return `<div class="yze-hazard-result ${hazardOutcome(state, successes) === "resisted" ? "is-success" : "is-failure"}">
    <p>${escape(game.i18n.format("YZE.Environment.RollResult", {
      hazard: game.i18n.localize(`YZE.Environment.Hazards.${state.hazard.kind}`),
      successes,
      opposition: whole(state.hazard.threatSuccesses)
    }))}</p>
    <button type="button" data-action="applyHazard"><i class="fa-solid fa-triangle-exclamation"></i> ${escape(game.i18n.localize("YZE.Environment.ApplyResult"))}</button>
  </div>`;
}

export async function applyHazardRoll(message, state) {
  if (!state?.hazard || state.superseded || message.getFlag(SYSTEM_ID, APPLIED_FLAG)) return false;
  const actor = await fromUuid(state.hazard.actorUuid ?? state.actorUuid);
  if (!mayUpdate(actor)) return false;
  const hazard = state.hazard;
  const successes = stateSuccesses(state);
  const failed = hazardOutcome(state, successes) === "failed";
  if (hazard.kind === "stressfulSituation") {
    const remaining = Math.max(0, whole(hazard.potentialStress) - successes);
    if (remaining > 0) {
      await applyDamage(actor, remaining, { category: "mental", attributeKey: "wits" });
    }
    await ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor }),
      content: `<div class="yze chat-card"><p>${escape(game.i18n.format("YZE.Environment.StressApplied", {
        actor: actor.name, cause: hazard.cause, amount: remaining
      }))}</p></div>`
    });
  } else if (hazard.kind === "darkness" && failed) {
    await applyDamage(actor, 1, { category: "physical", skipCriticalInjury: true, environmental: true });
  } else if (hazard.kind === "falling") {
    if (await protectAndDamage(actor, Math.max(0, Math.floor(whole(hazard.height) / 2) - successes)) === null) return false;
  } else if (hazard.kind === "drowning" && failed) {
    await applyDamage(actor, 1, { category: "physical", attributeKey: "strength", skipCriticalInjury: true, environmental: true });
    await updateEnvironmentalHazards(actor, { drowning: { active: true, due: false, nextAt: now() + ROUND_SECONDS, brokenAt: getActorBrokenState(actor).broken ? Math.max(1, now()) : 0 } });
  } else if (hazard.kind === "drowning") {
    const current = environmentalHazards(actor).drowning;
    if (current?.active) await updateEnvironmentalHazards(actor, { drowning: { ...current, due: false, nextAt: now() + ROUND_SECONDS } });
  } else if (hazard.kind === "poison") {
    if (failed && hazard.effect === "lethal" && hazard.fatalIfFailed === true) {
      await actor.update({ "system.dead": true });
      await clearEnvironmentalHazard(actor, "poison");
    } else if (failed && hazard.effect === "lethal") {
      await applyDamage(actor, 1, { category: "physical", attributeKey: "strength", skipCriticalInjury: true, environmental: true });
      await updateEnvironmentalHazards(actor, { poison: { active: true, effect: "lethal", rating: hazard.rating, due: false, nextAt: now() + ROUND_SECONDS } });
    } else if (failed && hazard.effect === "paralyzing") {
      await updateEnvironmentalHazards(actor, { poison: { active: true, effect: "paralyzing", until: now() + INJURY_TIME_SECONDS.stretch } });
    } else if (failed) {
      await updateEnvironmentalHazards(actor, { poison: { active: true, effect: "sleeping", until: now() + INJURY_TIME_SECONDS.shift } });
    } else await clearEnvironmentalHazard(actor, "poison");
  } else if (hazard.kind === "disease") {
    if (failed) {
      await applyDamage(actor, 1, { category: "physical", attributeKey: "strength", skipCriticalInjury: true, environmental: true });
      const previous = environmentalHazards(actor).disease;
      await updateEnvironmentalHazards(actor, { disease: { active: true, name: hazard.name || game.i18n.localize("YZE.Environment.Disease"), rating: hazard.rating, due: false, nextAt: now() + INJURY_TIME_SECONDS.day, brokenAt: previous?.brokenAt || (getActorBrokenState(actor).broken ? Math.max(1, now()) : 0) } });
    } else await clearEnvironmentalHazard(actor, "disease");
  } else if (hazard.kind === "cold") {
    if (failed) await applyColdFailure(actor);
    await updateEnvironmentalHazards(actor, { cold: { active: true, interval: hazard.interval, due: false, nextAt: now() + INJURY_TIME_SECONDS[hazard.interval] } });
  } else if (hazard.kind === "fireDeath" && failed) {
    await actor.update({ "system.dead": true });
  } else if (hazard.kind === "fireDeath") {
    const key = hazard.sourceKey ?? "fireInjury";
    const current = environmentalHazards(actor)[key];
    if (current?.active) {
      await updateEnvironmentalHazards(actor, {
        [key]: { ...current, due: false, nextAt: now() + ROUND_SECONDS }
      });
    }
  } else if (hazard.kind === "extinguishFire" && !failed) {
    const fire = environmentalHazards(actor).fire;
    if (fire?.critical && getActorBrokenState(actor).broken) {
      await updateEnvironmentalHazards(actor, {
        fireInjury: { active: true, due: false, nextAt: now() + ROUND_SECONDS }
      });
    }
    await clearEnvironmentalHazard(actor, "fire");
  }
  await message.setFlag(SYSTEM_ID, APPLIED_FLAG, true);
  await message.setFlag(SYSTEM_ID, PUSH_FLAG, { ...state, canPush: false });
  return true;
}

/** Resolve the SRD Insight test which reduces potential Stress point-for-point. */
export async function promptStressfulSituation(actor) {
  if (!mayUpdate(actor) || actor?.type === "vehicle" || actor.system?.dead === true) return null;
  const insight = actor.items.find((item) => item.type === "skill"
    && item.name.localeCompare("Insight", undefined, { sensitivity: "base" }) === 0);
  if (!insight) {
    ui.notifications.warn(game.i18n.localize("YZE.Environment.InsightMissing"));
    return null;
  }
  const { DialogV2 } = foundry.applications.api;
  const selection = await DialogV2.wait({
    window: { title: game.i18n.localize("YZE.Environment.StressfulSituation") },
    content: `<div class="yze yze-damage-dialog">
      <div class="form-group"><label>${escape(game.i18n.localize("YZE.Environment.PotentialStress"))}</label><input name="potential" type="number" value="1" min="1" step="1"></div>
      <div class="form-group"><label>${escape(game.i18n.localize("YZE.Environment.StressCause"))}</label><input name="cause" type="text" value=""></div>
      <p class="hint">${escape(game.i18n.localize("YZE.Environment.StressfulSituationHint"))}</p>
    </div>`,
    buttons: [{ action: "roll", label: game.i18n.localize("YZE.Roll.Roll"), icon: "fa-solid fa-brain", default: true,
      callback: (event, button, dialog) => { const form = button.form ?? dialog.element.querySelector("form"); return {
        potentialStress: Math.max(1, whole(form.elements.potential?.value)),
        cause: String(form.elements.cause?.value || game.i18n.localize("YZE.Environment.StressfulSituation")).trim()
      }; } },
    { action: "cancel", label: game.i18n.localize("YZE.Common.Cancel"), callback: () => null }],
    close: () => null, rejectClose: false, modal: true
  });
  if (!selection) return null;
  return actor.rollSkill(insight.id, {
    canOppose: false,
    allowHelpers: false,
    helpAction: null,
    hazard: { kind: "stressfulSituation", actorUuid: actor.uuid, ...selection }
  });
}

export async function resolveEnvironmentalInterval(actor, key) {
  const hazards = environmentalHazards(actor);
  const hazard = hazards[key];
  if (!hazard?.active || !mayUpdate(actor)) return false;
  if (key === "fire") return promptEnvironmentalHazardDirect(actor, "fire", hazard);
  if (key === "fireInjury") {
    return skillHazardRoll(actor, "Stamina", {
      kind: "fireDeath",
      sourceKey: "fireInjury",
      actorUuid: actor.uuid
    }, { allowBroken: true, canPush: false, allowHelpers: false });
  }
  if (key === "drowning") {
    if (getActorBrokenState(actor).broken && hazard.brokenAt > 0 && now() >= hazard.brokenAt + INJURY_TIME_SECONDS.stretch) {
      await actor.update({ "system.dead": true });
      return true;
    }
    if (getActorBrokenState(actor).broken) {
      ui.notifications.warn(game.i18n.localize("YZE.Environment.DrowningDeathPending"));
      return false;
    }
    return skillHazardRoll(actor, "Stamina", { kind: "drowning", actorUuid: actor.uuid });
  }
  if (key === "poison" && hazard.effect === "lethal") {
    if (getActorBrokenState(actor).broken) {
      const threat = await rollHazardRating(hazard.rating, game.i18n.localize("YZE.Environment.Hazards.poison"));
      return skillHazardRoll(actor, "Stamina", { kind: "poison", actorUuid: actor.uuid, rating: hazard.rating, threatSuccesses: threat.successes, effect: "lethal", fatalIfFailed: true }, { allowBroken: true });
    }
    await applyDamage(actor, 1, { category: "physical", attributeKey: "strength", skipCriticalInjury: true, environmental: true });
    await updateEnvironmentalHazards(actor, { poison: { ...hazard, due: false, nextAt: now() + ROUND_SECONDS } });
    return true;
  }
  if (key === "disease") {
    if (getActorBrokenState(actor).broken && hazard.brokenAt > 0 && now() >= hazard.brokenAt + INJURY_TIME_SECONDS.day) {
      await actor.update({ "system.dead": true });
      return true;
    }
    const threat = await rollHazardRating(hazard.rating, hazard.name);
    return skillHazardRoll(actor, "Stamina", { kind: "disease", actorUuid: actor.uuid, rating: hazard.rating, threatSuccesses: threat.successes, name: hazard.name }, { allowBroken: true });
  }
  if (key === "cold") {
    if (getActorBrokenState(actor).broken && hazard.fatalNext === true) {
      await actor.update({ "system.dead": true });
      return true;
    }
    return skillHazardRoll(actor, "Stamina", { kind: "cold", actorUuid: actor.uuid, interval: hazard.interval }, { allowBroken: true });
  }
  if (key === "starvation") {
    if (getActorBrokenState(actor).broken) await actor.update({ "system.dead": true });
    else await applyDamage(actor, 1, { category: "physical", attributeKey: "strength", skipCriticalInjury: true, environmental: true });
    await updateEnvironmentalHazards(actor, { starvation: { ...hazard, due: false, nextAt: now() + 7 * INJURY_TIME_SECONDS.day } });
    return true;
  }
  if (key === "lice") {
    await applyDamage(actor, 1, { category: "mental", attributeKey: "empathy", skipCriticalInjury: true, environmental: true });
    await updateEnvironmentalHazards(actor, { lice: { ...hazard, due: false, nextAt: now() + INJURY_TIME_SECONDS.day } });
    return true;
  }
  return false;
}

async function promptEnvironmentalHazardDirect(actor, kind, config) {
  if (kind !== "fire") return false;
  if (hasMagicProtection(actor, "firewalker")) {
    await clearEnvironmentalHazard(actor, "fire");
    return true;
  }
  const result = await rollHazardRating(config.rating, game.i18n.localize("YZE.Environment.Hazards.fire"));
  const damage = await protectAndDamage(actor, result.successes);
  if (damage === null) return false;
  const critical = config.critical === true || (damage > 0 && getActorBrokenState(actor).broken);
  if (damage > 0) {
    await updateEnvironmentalHazards(actor, {
      fire: {
        ...config,
        critical,
        rating: Math.min(getDiceSystem() === DICE_SYSTEMS.STEP ? 4 : 20, config.rating + 1),
        due: false,
        nextAt: now() + ROUND_SECONDS
      }
    });
  } else {
    await clearEnvironmentalHazard(actor, "fire");
    if (critical && getActorBrokenState(actor).broken) {
      await updateEnvironmentalHazards(actor, {
        fireInjury: { active: true, due: false, nextAt: now() + ROUND_SECONDS }
      });
    }
  }
  if (critical && config.due === true && actor.system.dead !== true) {
    return skillHazardRoll(actor, "Stamina", {
      kind: "fireDeath",
      sourceKey: damage > 0 ? "fire" : "fireInjury",
      actorUuid: actor.uuid
    }, { allowBroken: true, canPush: false, allowHelpers: false });
  }
  return true;
}

/** Apply a fire exposure whose D6-pool and stepped ratings are both known. */
export async function rollFireExposure(actor, {
  poolRating = 3,
  stepRating = 1,
  name = null
} = {}) {
  if (!mayUpdate(actor) || actor?.type === "vehicle" || actor.system?.dead === true) return null;
  const rating = getDiceSystem() === DICE_SYSTEMS.STEP
    ? whole(stepRating, 1)
    : whole(poolRating, 1);
  return promptEnvironmentalHazardDirect(actor, "fire", {
    active: true,
    due: true,
    critical: false,
    rating,
    name: name || game.i18n.localize("YZE.Environment.Hazards.fire")
  });
}

export function environmentalHazardSheetState(actor) {
  const hazards = environmentalHazards(actor);
  return Object.entries(hazards).filter(([, state]) => state?.active === true).map(([key, state]) => ({
    key,
    label: game.i18n.localize(`YZE.Environment.Hazards.${key === "sleepDeprivation" ? key : key}`),
    detail: state.effect ? game.i18n.localize(`YZE.Environment.PoisonEffects.${state.effect}`) : state.name || "",
    due: state.due === true,
    canResolve: ["fire", "fireInjury", "drowning", "poison", "disease", "cold", "starvation", "lice"].includes(key),
    canExtinguish: key === "fire"
  }));
}

async function processEnvironmentalTime(time = now()) {
  if (primaryGM()?.id !== game.user?.id) return;
  for (const actor of game.actors ?? []) {
    const hazards = environmentalHazards(actor);
    let changed = false;
    for (const [key, state] of Object.entries(hazards)) {
      if (!state?.active) continue;
      if (Number(state.until) > 0 && time >= Number(state.until)) {
        delete hazards[key];
        changed = true;
      } else if (Number(state.nextAt) > 0 && time >= Number(state.nextAt) && state.due !== true) {
        state.due = true;
        if (key === "cold" && getActorBrokenState(actor).broken) state.fatalNext = true;
        changed = true;
        await ChatMessage.create({
          speaker: ChatMessage.getSpeaker({ actor }),
          content: `<div class="yze chat-card"><p>${escape(game.i18n.format("YZE.Environment.IntervalDue", { actor: actor.name, hazard: game.i18n.localize(`YZE.Environment.Hazards.${key}`) }))}</p></div>`
        });
      }
    }
    if (changed) await actor.setFlag(SYSTEM_ID, "environmentalHazards", hazards);
  }
}

async function processCombatHazards(combat) {
  if (primaryGM()?.id !== game.user?.id) return;
  const actor = combat?.combatant?.actor;
  if (!actor) return;
  const hazards = environmentalHazards(actor);
  let changed = false;
  for (const key of ["fire", "fireInjury", "drowning", "poison"]) {
    const state = hazards[key];
    if (!state?.active || state.due === true || (key === "poison" && state.effect !== "lethal")) continue;
    state.due = true;
    changed = true;
    await ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor }),
      content: `<div class="yze chat-card"><p>${escape(game.i18n.format("YZE.Environment.IntervalDue", { actor: actor.name, hazard: game.i18n.localize(`YZE.Environment.Hazards.${key}`) }))}</p></div>`
    });
  }
  if (changed) await actor.setFlag(SYSTEM_ID, "environmentalHazards", hazards);
}

export function registerEnvironmentalHazardHooks() {
  Hooks.on("renderChatMessageHTML", (message, html) => {
    const root = html?.querySelector ? html : html?.[0];
    const button = root?.querySelector?.('[data-action="applyHazard"]');
    if (!button) return;
    const state = message.getFlag(SYSTEM_ID, PUSH_FLAG);
    if (!state?.hazard || state.superseded || message.getFlag(SYSTEM_ID, APPLIED_FLAG)) {
      button.disabled = true;
      return;
    }
    button.addEventListener("click", async () => {
      button.disabled = true;
      if (!await applyHazardRoll(message, message.getFlag(SYSTEM_ID, PUSH_FLAG))) button.disabled = false;
    });
  });
  Hooks.once("ready", () => processEnvironmentalTime().catch((error) => console.error("YZE System Toolkit | Hazard time failed", error)));
  Hooks.on("updateWorldTime", (time) => processEnvironmentalTime(Number(time)).catch((error) => console.error("YZE System Toolkit | Hazard time failed", error)));
  Hooks.on("updateCombat", (combat, changed) => {
    if (!Object.hasOwn(changed, "turn") && !Object.hasOwn(changed, "round")) return;
    processCombatHazards(combat).catch((error) => console.error("YZE System Toolkit | Combat hazard time failed", error));
  });
  Hooks.on("updateActor", (actor) => {
    const hazards = environmentalHazards(actor);
    if (hazards.fire?.critical && !getActorBrokenState(actor).broken
      && primaryGM()?.id === game.user?.id) {
      updateEnvironmentalHazards(actor, {
        fire: { ...hazards.fire, critical: false }
      }).catch((error) => console.error("YZE System Toolkit | Fire treatment failed", error));
    }
    if (hazards.fireInjury?.active && !getActorBrokenState(actor).broken
      && primaryGM()?.id === game.user?.id) {
      clearEnvironmentalHazard(actor, "fireInjury").catch((error) => console.error("YZE System Toolkit | Fire injury recovery failed", error));
    }
    if (!hazards.sleepDeprivation?.active || hazards.sleepDeprivation.collapsed
      || !getActorBrokenState(actor).mental || primaryGM()?.id !== game.user?.id) return;
    updateEnvironmentalHazards(actor, {
      sleepDeprivation: {
        ...hazards.sleepDeprivation,
        collapsed: true,
        until: now() + INJURY_TIME_SECONDS.shift
      }
    }).catch((error) => console.error("YZE System Toolkit | Sleep deprivation collapse failed", error));
  });
}
