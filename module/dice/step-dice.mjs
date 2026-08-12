import {
  DICE_SYSTEMS,
  STEP_MODIFIER_METHODS,
  SYSTEM_ID,
  getStepRating
} from "../constants.mjs";
import { getPushRules, getStepModifierMethod } from "../settings.mjs";
import {
  renderAcceptControl,
  renderInitialRuleNotices,
  renderPushControls,
  renderPushHint
} from "./push.mjs";
import { renderModifierBreakdown } from "./roll-dialog.mjs";
import { renderOpposedControl } from "./opposed.mjs";
import { renderAttackControl } from "../attack-card.mjs";
import { renderHealingControl } from "../recovery-card.mjs";
import { renderChaseControl } from "../chases.mjs";
import { renderTravelControl } from "../travel.mjs";
import { renderAerialCrashControl, renderVehicleManeuverControl } from "../vehicles.mjs";
import { renderHazardControl } from "../environmental-hazards.mjs";
import { resolveStressDiePanic } from "../panic.mjs";
import { renderHelpingSummary } from "../helping.mjs";
import { renderRollContext, rollMessageVisibility } from "./roll-context.mjs";
import { renderSurpriseControl } from "../surprise.mjs";

function stepRating(value) {
  return Math.min(4, Math.max(0, Math.trunc(Number(value) || 0)));
}

function signedModifier(value) {
  return value > 0 ? `+${value}` : String(value);
}

/** Apply SRD step modifiers while keeping two dice as balanced as possible. */
export function applyStepDiceModifier(
  { attribute = 0, skill = 0 } = {},
  modifier = 0
) {
  const dice = [];
  const attributeRating = stepRating(attribute);
  const skillRating = stepRating(skill);
  if (attributeRating > 0) dice.push({ category: "attribute", rating: attributeRating });
  if (skillRating > 0) dice.push({ category: "skill", rating: skillRating });

  const requested = Math.trunc(Number(modifier) || 0);
  let remaining = Math.abs(requested);
  if (requested > 0) {
    while (remaining > 0) {
      if (dice.length === 0) {
        dice.push({ category: "attribute", rating: 1 });
      } else if (dice.length === 1) {
        const category = dice[0].category === "attribute" ? "skill" : "attribute";
        dice.push({ category, rating: 1 });
      } else {
        const candidates = dice.filter((die) => die.rating < 4);
        if (candidates.length === 0) break;
        const lowest = Math.min(...candidates.map((die) => die.rating));
        const die = candidates.find((candidate) => candidate.rating === lowest);
        die.rating += 1;
      }
      remaining -= 1;
    }
  } else if (requested < 0) {
    while (remaining > 0) {
      if (dice.length === 1) {
        if (dice[0].rating === 1) break;
        dice[0].rating -= 1;
      } else if (dice.length > 1) {
        const highest = Math.max(...dice.map((die) => die.rating));
        const tied = dice.filter((die) => die.rating === highest);
        const die = tied.find((candidate) => candidate.category === "skill") ?? tied[0];
        if (die.rating > 1) {
          die.rating -= 1;
        } else {
          dice.splice(dice.indexOf(die), 1);
        }
      } else {
        break;
      }
      remaining -= 1;
    }
  }

  return {
    attribute: dice.find((die) => die.category === "attribute")?.rating ?? 0,
    skill: dice.find((die) => die.category === "skill")?.rating ?? 0,
    requested,
    applied: requested > 0 ? requested - remaining : requested + remaining,
    capped: remaining > 0
  };
}

/** Resolve the net Advantage state after all sources have cancelled. */
export function applyStepAdvantage(
  { attribute = 0, skill = 0 } = {},
  advantage = 0
) {
  const dice = [];
  const attributeRating = stepRating(attribute);
  const skillRating = stepRating(skill);
  if (attributeRating > 0) dice.push({ category: "attribute", rating: attributeRating });
  if (skillRating > 0) dice.push({ category: "skill", rating: skillRating });

  const state = Math.sign(Number(advantage) || 0);
  const singleBaseDie = dice.length === 1;
  if (state > 0 && dice.length > 0) {
    const lowerRating = Math.min(...dice.map((die) => die.rating));
    dice.push({ category: "advantage", rating: lowerRating });
  } else if (state < 0 && dice.length > 1) {
    const lowerRating = Math.min(...dice.map((die) => die.rating));
    const tied = dice.filter((die) => die.rating === lowerRating);
    const removed = tied.find((die) => die.category === "skill") ?? tied[0];
    dice.splice(dice.indexOf(removed), 1);
  }

  return { dice, state, singleBaseDie };
}

export function stepResultSuccesses(value) {
  const result = Number(value);
  if (!Number.isFinite(result)) return 0;
  if (result >= 10) return 2;
  if (result >= 6) return 1;
  return 0;
}

export function countStepSuccesses(dice = []) {
  return dice.reduce((successes, die) => (
    successes + (die.results ?? []).reduce((dieSuccesses, result) => {
      if (result.active === false) return dieSuccesses;
      return dieSuccesses + stepResultSuccesses(result.result);
    }, 0)
  ), 0);
}

export class YZEStepRoll extends Roll {
  _evaluateTotal() {
    return countStepSuccesses(this.dice);
  }

  async _evaluate(options = {}) {
    await super._evaluate(options);
    this._total = countStepSuccesses(this.dice);
    return this;
  }

  _evaluateSync(options = {}) {
    super._evaluateSync(options);
    this._total = countStepSuccesses(this.dice);
    return this;
  }
}

export function registerStepDiceRoll() {
  if (!CONFIG.Dice.rolls.includes(YZEStepRoll)) {
    CONFIG.Dice.rolls.push(YZEStepRoll);
  }
}

function dieTerm(rating, flavor) {
  if (rating.faces === 0) return null;
  return `1d${rating.faces}[${flavor}]`;
}

function stepDieLabel(category) {
  const keys = {
    attribute: "YZE.Roll.AttributeDie",
    skill: "YZE.Roll.SkillDie",
    advantage: "YZE.Roll.AdvantageDie"
  };
  return game.i18n.localize(keys[category] ?? "YZE.Roll.Die");
}

export async function rollStepDice({
  actor = null,
  label = "YZE Roll",
  attributeKey = null,
  canPush = true,
  canOppose = true,
  rollType = "active",
  rollMode = "publicroll",
  attemptGoal = "",
  maxPushes = 1,
  attributeRating = 2,
  skillRating = 0,
  modifier = 0,
  modifierMode = getStepModifierMethod(),
  advantage = 0,
  advantages = 0,
  disadvantages = 0,
  helpers = [],
  helpAction = "",
  ammoDice = 0,
  modifierBreakdown = [],
  attack = null,
  recovery = null,
  chase = null,
  travel = null,
  mount = null,
  vehicleManeuver = null,
  aerialCrash = null,
  hazard = null,
  surprise = null,
  retreat = null,
  interception = null,
  automaticSuccesses = 0,
  replaceWithAutomaticSuccesses = false
} = {}) {
  const rules = getPushRules();
  const automatic = Math.max(0, Math.trunc(Number(automaticSuccesses) || 0));
  const replaceRoll = replaceWithAutomaticSuccesses === true && automatic > 0;
  const useAdvantage = modifierMode === STEP_MODIFIER_METHODS.ADVANTAGE;
  const advantageResult = useAdvantage
    ? applyStepAdvantage({ attribute: attributeRating, skill: skillRating }, advantage)
    : null;
  const adjusted = useAdvantage
    ? null
    : applyStepDiceModifier(
      { attribute: attributeRating, skill: skillRating },
      modifier
    );
  const baseDice = replaceRoll ? [] : useAdvantage
    ? advantageResult.dice
    : [
      { category: "attribute", rating: adjusted.attribute },
      { category: "skill", rating: adjusted.skill }
    ].filter((die) => die.rating > 0);
  const stressDice = rules.stressDice && !replaceRoll
    ? Math.max(0, Math.trunc(Number(actor?.system?.resources?.stress?.value) || 0))
    : 0;
  const ammunitionDice = replaceRoll ? 0 : Math.max(0, Math.trunc(Number(ammoDice) || 0));
  const terms = [
    ...baseDice.map((die) => dieTerm(getStepRating(die.rating), stepDieLabel(die.category))),
    ammunitionDice > 0
      ? `${ammunitionDice}d6[${game.i18n.localize("YZE.Roll.AmmoDice")}]`
      : null,
    stressDice > 0
      ? `${stressDice}d6[${game.i18n.localize("YZE.Roll.StressDice")}]`
      : null
  ].filter(Boolean);

  if (terms.length === 0 && automatic === 0) {
    ui.notifications.warn(game.i18n.localize("YZE.Roll.NoDice"));
    return null;
  }

  const roll = await new YZEStepRoll(terms.length > 0 ? terms.join(" + ") : "0").evaluate();
  const ammunitionTermIndex = ammunitionDice > 0 ? baseDice.length : -1;
  const ammunitionSuccesses = ammunitionTermIndex >= 0
    ? countStepSuccesses([roll.dice[ammunitionTermIndex]])
    : 0;
  const successes = countStepSuccesses(roll.dice) - ammunitionSuccesses + automatic;
  const resultKey = successes === 1 ? "YZE.Roll.Success" : "YZE.Roll.Successes";
  const resultLabel = game.i18n.format(resultKey, { count: successes });
  const pushDice = [];
  const categories = [
    ...baseDice.map((die) => die.category),
    ...(ammunitionDice > 0 ? ["ammo"] : []),
    ...(stressDice > 0 ? ["stress"] : [])
  ];
  for (const [index, die] of roll.dice.entries()) {
    const category = categories[index];
    for (const [resultIndex, result] of (die.results ?? []).entries()) {
      if (result.active === false) continue;
      pushDice.push({
        id: `${category}-${resultIndex}`,
        category,
        faces: Number(die.faces),
        result: Number(result.result),
        rerolled: false
      });
    }
  }
  const pushState = {
    version: 1,
    mode: DICE_SYSTEMS.STEP,
    actorUuid: actor?.uuid ?? null,
    actorName: actor?.name ?? null,
    attributeKey,
    canPush: Boolean(canPush) && !replaceRoll,
    canOppose: Boolean(canOppose),
    rollType,
    rollMode,
    attemptGoal,
    label,
    accepted: false,
    pushed: false,
    pushesUsed: 0,
    maxPushes: Math.max(1, Math.trunc(Number(maxPushes) || 1)),
    rules,
    conditionState: { ...(actor?.system?.conditions ?? {}) },
    helpers,
    helpAction,
    attack,
    recovery,
    chase,
    travel,
    mount,
    vehicleManeuver,
    aerialCrash,
    hazard,
    surprise,
    retreat,
    interception,
    automaticSuccesses: automatic,
    dice: pushDice
  };

  const rollActions = [
    renderAcceptControl(pushState),
    renderPushControls(pushState),
    renderOpposedControl(pushState)
  ].filter(Boolean).join("");

  const flavor = `
    <div class="yze chat-card">
      <h3>${foundry.utils.escapeHTML(label)}</h3>
      ${renderRollContext({ rollType, attemptGoal })}
      <p class="yze-successes">${foundry.utils.escapeHTML(resultLabel)}</p>
      ${automatic > 0 ? `<p class="hint">${foundry.utils.escapeHTML(game.i18n.format("YZE.Roll.AutomaticSuccesses", { count: automatic }))}</p>` : ""}
      ${renderHelpingSummary(helpers, helpAction)}
      ${renderModifierBreakdown(modifierBreakdown, useAdvantage ? advantageResult.state : modifier, {
        modifierMode,
        advantages,
        disadvantages
      })}
      ${!useAdvantage && adjusted.capped
        ? `<p class="yze-modifier-cap">${foundry.utils.escapeHTML(game.i18n.format("YZE.Roll.StepModifierCapped", {
          requested: signedModifier(adjusted.requested),
          applied: signedModifier(adjusted.applied)
        }))}</p>`
        : ""}
      ${useAdvantage && advantageResult.singleBaseDie
        ? `<p class="yze-modifier-cap">${foundry.utils.escapeHTML(game.i18n.localize("YZE.Roll.AdvantageSingleDie"))}</p>`
        : ""}
      ${renderInitialRuleNotices(pushState)}
      ${pushState.canPush ? renderPushHint(pushState) : ""}
      ${rollActions ? `<div class="yze-roll-actions">${rollActions}</div>` : ""}
      ${renderAttackControl(pushState)}
      ${renderHealingControl(pushState)}
      ${renderChaseControl(pushState)}
      ${renderTravelControl(pushState)}
      ${renderVehicleManeuverControl(pushState)}
      ${renderAerialCrashControl(pushState)}
      ${renderHazardControl(pushState)}
      ${renderSurpriseControl(pushState)}
    </div>`;

  const message = await roll.toMessage({
    speaker: ChatMessage.getSpeaker({ actor }),
    flavor,
    ...rollMessageVisibility(rollMode),
    flags: {
      [SYSTEM_ID]: {
        push: pushState
      }
    }
  });
  await resolveStressDiePanic(message, pushState, actor);
  return message;
}
