import { DICE_SYSTEMS, SYSTEM_ID } from "../constants.mjs";
import { getPushRules } from "../settings.mjs";
import { renderInitialRuleNotices, renderPushControls } from "./push.mjs";
import { renderModifierBreakdown } from "./roll-dialog.mjs";
import { renderOpposedControl } from "./opposed.mjs";
import { renderAttackControl } from "../attack-card.mjs";
import { renderHealingControl } from "../recovery-card.mjs";
import { renderChaseControl } from "../chases.mjs";
import { renderTravelControl } from "../travel.mjs";
import { renderAerialCrashControl, renderVehicleManeuverControl } from "../vehicles.mjs";
import { renderHazardControl } from "../environmental-hazards.mjs";
import { resolveStressDiePanic } from "../panic.mjs";
import { dieSuccesses } from "./successes.mjs";
import { renderHelpingSummary } from "../helping.mjs";
import { renderRollContext, rollMessageVisibility } from "./roll-context.mjs";
import { renderSurpriseControl } from "../surprise.mjs";

function asDieCount(value) {
  const count = Number(value);
  if (!Number.isFinite(count)) return 0;
  return Math.max(0, Math.trunc(count));
}

function poolDieLabel(category) {
  const keys = {
    attribute: "YZE.Roll.AttributeDice",
    skill: "YZE.Roll.SkillDice",
    gear: "YZE.Roll.GearDice",
    ammo: "YZE.Roll.AmmoDice",
    stress: "YZE.Roll.StressDice",
    artifact: "YZE.Roll.ArtifactDice"
  };
  return game.i18n.localize(keys[category] ?? "YZE.Roll.Die");
}

function flavoredTerm(formula, label) {
  const flavor = String(label).replaceAll("[", "(").replaceAll("]", ")");
  return `${formula}[${flavor}]`;
}

export function applyDicePoolModifier(pool, modifier = 0) {
  const adjusted = {
    attribute: asDieCount(pool.attribute),
    skill: asDieCount(pool.skill),
    gear: asDieCount(pool.gear)
  };

  let remaining = Math.trunc(Number(modifier) || 0);
  if (remaining > 0) {
    adjusted.skill += remaining;
    return adjusted;
  }

  remaining = Math.abs(remaining);
  for (const category of ["skill", "gear", "attribute"]) {
    const removed = Math.min(adjusted[category], remaining);
    adjusted[category] -= removed;
    remaining -= removed;
    if (remaining === 0) break;
  }

  return adjusted;
}

/** Count successes from the active results of a standard YZE D6 dice pool. */
export function countDicePoolSuccesses(dice = []) {
  return dice.reduce((total, die) => {
    const dieSuccesses = (die.results ?? []).reduce((subtotal, result) => {
      if (result.active === false) return subtotal;
      return subtotal + (Number(result.result) === 6 ? 1 : 0);
    }, 0);

    return total + dieSuccesses;
  }, 0);
}

/** Count an Artifact Die: 6–9 is one success and 10+ is two. */
export function countArtifactDieSuccesses(result) {
  return dieSuccesses(DICE_SYSTEMS.POOL, result, "artifact");
}

export async function rollDicePool({
  actor = null,
  label = "YZE Roll",
  attributeKey = null,
  canPush = true,
  canOppose = true,
  rollType = "active",
  rollMode = "publicroll",
  attemptGoal = "",
  maxPushes = 1,
  attributeDice = 0,
  skillDice = 0,
  gearDice = 0,
  gearItems = [],
  ammoDice = 0,
  modifier = 0,
  modifierTotal = modifier + gearDice,
  helpers = [],
  helpAction = "",
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
  const automatic = asDieCount(automaticSuccesses);
  const replaceRoll = replaceWithAutomaticSuccesses === true && automatic > 0;
  const pool = replaceRoll ? { attribute: 0, skill: 0, gear: 0 } : applyDicePoolModifier(
    { attribute: attributeDice, skill: skillDice, gear: gearDice },
    modifier
  );
  const stressDice = rules.stressDice && !replaceRoll
    ? asDieCount(actor?.system?.resources?.stress?.value)
    : 0;
  const ammunitionDice = replaceRoll ? 0 : asDieCount(ammoDice);
  const diceCounts = { ...pool, ammo: ammunitionDice, stress: stressDice };
  const artifactItems = replaceRoll ? [] : gearItems.filter((item) => (
    [8, 10, 12].includes(Number(item.artifactDie)) && asDieCount(item.bonus) > 0
  ));

  const standardTerms = Object.entries(diceCounts)
    .filter(([, count]) => count > 0)
    .map(([category, count]) => flavoredTerm(
      `${count}d6cs>=6`,
      poolDieLabel(category)
    ));
  const artifactTerms = artifactItems.map((item) => flavoredTerm(
    `1d${Number(item.artifactDie)}cs>=6`,
    poolDieLabel("artifact")
  ));
  const terms = [...standardTerms, ...artifactTerms];

  if (terms.length === 0 && automatic === 0) {
    ui.notifications.warn(game.i18n.localize("YZE.Roll.NoDice"));
    return null;
  }

  const roll = await new Roll(terms.length > 0 ? terms.join(" + ") : "0").evaluate();
  // Count the actual D6 faces so the displayed result cannot inherit an
  // arithmetic total cached by Foundry or another module.
  const activeCategories = Object.entries(diceCounts).filter(([, count]) => count > 0);
  const ammoTermIndex = activeCategories.findIndex(([category]) => category === "ammo");
  const ammunitionSuccesses = ammoTermIndex >= 0
    ? countDicePoolSuccesses([roll.dice[ammoTermIndex]])
    : 0;
  const standardSuccesses = countDicePoolSuccesses(roll.dice.slice(0, standardTerms.length))
    - ammunitionSuccesses;
  const artifactSuccesses = artifactItems.reduce((total, item, index) => {
    const result = roll.dice[standardTerms.length + index]?.results?.find(
      (entry) => entry.active !== false
    )?.result;
    return total + countArtifactDieSuccesses(result);
  }, 0);
  const successes = standardSuccesses + artifactSuccesses + automatic;
  roll._total = successes;
  const safeLabel = foundry.utils.escapeHTML(label);
  const resultKey = successes === 1 ? "YZE.Roll.Success" : "YZE.Roll.Successes";
  const resultLabel = game.i18n.format(resultKey, { count: successes });
  const dice = [];
  const gearSources = gearItems.flatMap((item) => (
    Array.from({ length: asDieCount(item.bonus) }, () => ({
      id: item.id,
      name: item.name
    }))
  ));
  let gearSourceIndex = 0;
  let termIndex = 0;
  for (const [category, count] of Object.entries(diceCounts)) {
    if (count === 0) continue;
    const term = roll.dice[termIndex];
    termIndex += 1;
    for (const [index, result] of (term?.results ?? []).entries()) {
      if (result.active === false) continue;
      const gearSource = category === "gear" ? gearSources[gearSourceIndex++] : null;
      dice.push({
        id: `${category}-${index}`,
        category,
        faces: 6,
        result: Number(result.result),
        rerolled: false,
        gearItemId: gearSource?.id ?? null,
        gearItemName: gearSource?.name ?? null
      });
    }
  }
  for (const [index, item] of artifactItems.entries()) {
    const term = roll.dice[termIndex + index];
    const result = term?.results?.find((entry) => entry.active !== false);
    if (!result) continue;
    dice.push({
      id: `artifact-${item.id}-${index}`,
      category: "artifact",
      faces: Number(item.artifactDie),
      result: Number(result.result),
      rerolled: false,
      gearItemId: item.id,
      gearItemName: item.name
    });
  }
  const pushState = {
    version: 1,
    mode: DICE_SYSTEMS.POOL,
    actorUuid: actor?.uuid ?? null,
    actorName: actor?.name ?? null,
    attributeKey,
    canPush: Boolean(canPush) && !replaceRoll,
    canOppose: Boolean(canOppose),
    rollType,
    rollMode,
    attemptGoal,
    label,
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
    dice
  };

  const flavor = `
    <div class="yze chat-card">
      <h3>${safeLabel}</h3>
      ${renderRollContext({ rollType, attemptGoal })}
      <p class="yze-successes">${foundry.utils.escapeHTML(resultLabel)}</p>
      ${automatic > 0 ? `<p class="hint">${foundry.utils.escapeHTML(game.i18n.format("YZE.Roll.AutomaticSuccesses", { count: automatic }))}</p>` : ""}
      ${renderHelpingSummary(helpers, helpAction)}
      ${renderModifierBreakdown(modifierBreakdown, modifierTotal)}
      ${renderInitialRuleNotices(pushState)}
      ${pushState.canPush ? renderPushControls(pushState) : ""}
      ${renderOpposedControl(pushState)}
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
