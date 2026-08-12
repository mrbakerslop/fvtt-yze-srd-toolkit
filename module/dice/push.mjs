import {
  ATTRIBUTE_GROUPS,
  CONDITIONS,
  DICE_SYSTEMS,
  HARM_MODELS,
  SYSTEM_ID
} from "../constants.mjs";
import { getAttributeLabels } from "../settings.mjs";
import { renderAttackControl } from "../attack-card.mjs";
import { renderHealingControl } from "../recovery-card.mjs";
import { resolveStressDiePanic } from "../panic.mjs";
import { gainDoomFromPush } from "../doom.mjs";
import { renderChaseControl } from "../chases.mjs";
import { renderTravelControl } from "../travel.mjs";
import { renderVehicleManeuverControl } from "../vehicles.mjs";
import { renderHazardControl } from "../environmental-hazards.mjs";
import { countStateSuccesses, dieSuccesses } from "./successes.mjs";
import { renderHelpingSummary } from "../helping.mjs";
import { renderSurpriseControl } from "../surprise.mjs";
import { renderRollContext } from "./roll-context.mjs";

const PUSH_FLAG = "push";
const VALID_FACES = new Set([6, 8, 10, 12]);

export function pushDieSuccesses(mode, result, category = "") {
  return dieSuccesses(mode, result, category);
}

export function countPushSuccesses(state) {
  return countStateSuccesses(state);
}

export function countPushBanes(state) {
  const counts = {
    total: 0,
    attribute: 0,
    skill: 0,
    advantage: 0,
    gear: 0,
    artifact: 0,
    stress: 0
  };
  for (const die of state?.dice ?? []) {
    if (die.category === "ammo" || Number(die.result) !== 1) continue;
    counts.total += 1;
    if (Object.hasOwn(counts, die.category)) counts[die.category] += 1;
  }
  return counts;
}

export function applyPushResults(state, selectedIds, results) {
  const selected = new Set(selectedIds);
  const replacements = [...results];
  let resultIndex = 0;
  const dice = (state?.dice ?? []).map((die) => {
    if (!selected.has(die.id)) return { ...die, rerolled: false };
    if (Number(die.result) === 1) return { ...die, rerolled: false };

    const result = Number(replacements[resultIndex]);
    resultIndex += 1;
    if (!Number.isFinite(result)) {
      throw new Error("A pushed YZE die did not produce a numeric result.");
    }
    return { ...die, result, rerolled: true };
  });

  if (resultIndex !== replacements.length || resultIndex !== selected.size) {
    throw new Error("The pushed YZE roll returned an unexpected number of dice.");
  }

  const maxPushes = Math.max(1, Math.trunc(Number(state?.maxPushes) || 1));
  const pushesUsed = Math.max(0, Math.trunc(Number(state?.pushesUsed) || 0)) + 1;
  return { ...state, maxPushes, pushesUsed, pushed: pushesUsed >= maxPushes, dice };
}

function canPushAgain(state) {
  const maximum = Math.max(1, Math.trunc(Number(state?.maxPushes) || 1));
  const used = Math.max(0, Math.trunc(Number(state?.pushesUsed) || 0));
  return state?.canPush !== false && state?.pushed !== true && used < maximum;
}

function escape(value) {
  return foundry.utils.escapeHTML(String(value));
}

function categoryLabel(category) {
  const keys = {
    attribute: "YZE.Roll.AttributeDie",
    skill: "YZE.Roll.SkillDie",
    advantage: "YZE.Roll.AdvantageDie",
    gear: "YZE.Roll.GearDie",
    artifact: "YZE.Roll.ArtifactDie",
    stress: "YZE.Roll.StressDie",
    ammo: "YZE.Roll.AmmoDie"
  };
  return game.i18n.localize(keys[category] ?? "YZE.Roll.Die");
}

function dieSummary(die) {
  return `${categoryLabel(die.category)} D${die.faces}: ${die.result}`;
}

function pushConditionControl(state) {
  const group = ATTRIBUTE_GROUPS[state.attributeKey];
  const usesConditions = state?.rules?.conditions || state?.rules?.conditionBaneDamage;
  const conditionKeys = usesConditions ? CONDITIONS[group] ?? [] : [];
  const availableConditions = conditionKeys.filter(
    (key) => state.conditionState?.[key] !== true
  );
  if (conditionKeys.length > 0 && availableConditions.length > 0) {
    const options = availableConditions.map((key) => (
      `<option value="${key}">${escape(game.i18n.localize(`YZE.Conditions.${key}`))}</option>`
    )).join("");
    return `
      <label class="yze-push-condition">
        ${escape(game.i18n.localize("YZE.Roll.ChooseCondition"))}
        <select name="pushCondition">${options}</select>
      </label>`;
  }
  return conditionKeys.length > 0
    ? `<p class="yze-panic-warning">${escape(game.i18n.localize("YZE.Roll.NoConditionAvailable"))}</p>`
    : "";
}

function pushDieShape(faces) {
  const shape = VALID_FACES.has(Number(faces)) ? Number(faces) : 6;
  return `<img class="yze-push-die-shape" src="/icons/svg/d${shape}-grey.svg" alt="">`;
}

/** Render one selectable die illustration for the Push dialog. */
export function renderPushDieChoice(state, die) {
  const successes = pushDieSuccesses(state.mode, die.result, die.category);
  const checked = successes === 0 ? " checked" : "";
  const summary = dieSummary(die);
  const caption = `${categoryLabel(die.category)} · D${die.faces}`;
  return `
    <label class="yze-push-die${successes > 0 ? " is-success" : ""}" data-tooltip="${escape(summary)}">
      <input type="checkbox" name="pushDice" value="${escape(die.id)}" aria-label="${escape(summary)}"${checked}>
      <span class="yze-push-die-image" aria-hidden="true">
        ${pushDieShape(die.faces)}
        <strong class="yze-push-die-result">${escape(die.result)}</strong>
      </span>
      <span class="yze-push-die-caption">${escape(caption)}</span>
      <span class="yze-push-die-roll">${escape(game.i18n.format("YZE.Roll.PushDieResult", {
        result: die.result
      }))}</span>
      <span class="yze-push-die-selected" aria-hidden="true">
        <i class="fa-solid fa-check"></i>
        ${escape(game.i18n.localize("YZE.Roll.PushDieSelected"))}
      </span>
    </label>`;
}

/** Ask which eligible dice should be rerolled and collect any pushing Condition. */
export async function promptPushSelection(state) {
  const eligible = (state?.dice ?? []).filter((die) => (
    Number(die.result) !== 1 && VALID_FACES.has(Number(die.faces))
  ));
  const addsStressDie = state?.rules?.stressDice === true;
  if (eligible.length === 0 && !addsStressDie) {
    ui.notifications.warn(game.i18n.localize("YZE.Roll.NoPushDice"));
    return null;
  }

  const dice = eligible.map((die) => renderPushDieChoice(state, die)).join("");
  const noExistingDice = eligible.length === 0 && addsStressDie
    ? `<p>${escape(game.i18n.localize("YZE.Roll.NoPushDiceStress"))}</p>`
    : "";
  const { DialogV2 } = foundry.applications.api;
  return DialogV2.wait({
    window: {
      title: game.i18n.format("YZE.Roll.PushDialogTitle", { label: state.label })
    },
    content: `<div class="yze yze-push-dialog">
      <p>${escape(game.i18n.localize("YZE.Roll.PushDialogHint"))}</p>
      ${pushConditionControl(state)}
      ${noExistingDice}
      ${dice ? `<div class="yze-push-dice" role="group" aria-label="${escape(game.i18n.localize("YZE.Roll.PushDiceSelection"))}">${dice}</div>` : ""}
    </div>`,
    buttons: [
      {
        action: "push",
        label: game.i18n.localize("YZE.Roll.Push"),
        icon: "fa-solid fa-rotate",
        default: true,
        callback: (event, button, dialog) => {
          const form = button.form ?? dialog.element.querySelector("form");
          return {
            selectedIds: [...form.querySelectorAll('[name="pushDice"]:checked')]
              .map((input) => input.value),
            condition: form.elements.pushCondition?.value ?? null
          };
        }
      },
      {
        action: "cancel",
        label: game.i18n.localize("YZE.Common.Cancel"),
        icon: "fa-solid fa-xmark",
        callback: () => false
      }
    ],
    close: () => null,
    rejectClose: false,
    modal: true
  });
}

/** Render the compact chat-card entry point for pushing a roll. */
export function renderPushControls(state) {
  const eligible = (state?.dice ?? []).filter((die) => Number(die.result) !== 1);
  const addsStressDie = state?.rules?.stressDice === true;
  if (eligible.length === 0 && !addsStressDie) {
    return `<p class="yze-push-unavailable">${escape(game.i18n.localize("YZE.Roll.NoPushDice"))}</p>`;
  }

  return `
    <div class="yze-push-controls">
      <p>${escape(game.i18n.localize("YZE.Roll.PushCardHint"))}</p>
      ${eligible.length === 0 && addsStressDie
        ? `<p>${escape(game.i18n.localize("YZE.Roll.NoPushDiceStress"))}</p>`
        : ""}
      <button type="button" data-action="pushRoll">
        <i class="fa-solid fa-rotate" aria-hidden="true"></i>
        ${escape(game.i18n.localize("YZE.Roll.Push"))}
      </button>
    </div>`;
}

export function renderInitialRuleNotices(state) {
  const stressBanes = countPushBanes(state).stress;
  if (!state?.rules?.stressDice || stressBanes === 0) return "";
  return `<p class="yze-panic-warning">${escape(game.i18n.localize("YZE.Roll.PanicTriggered"))}</p>`;
}

function categoryGroupLabel(category, mode) {
  const keys = {
    attribute: "YZE.Roll.AttributeDice",
    skill: "YZE.Roll.SkillDice",
    gear: "YZE.Roll.GearDice",
    artifact: "YZE.Roll.ArtifactDice",
    stress: "YZE.Roll.StressDice",
    ammo: "YZE.Roll.AmmoDice"
  };
  if (mode === DICE_SYSTEMS.POOL || ["stress", "ammo"].includes(category)) {
    return game.i18n.localize(keys[category] ?? "YZE.Roll.Die");
  }
  return categoryLabel(category);
}

function renderFinalDiceGroups(state) {
  const groups = new Map();
  for (const die of state?.dice ?? []) {
    const dice = groups.get(die.category) ?? [];
    dice.push(die);
    groups.set(die.category, dice);
  }

  return [...groups].map(([category, dice]) => {
    const successes = dice.reduce((total, die) => (
      total + (die.category === "ammo"
        ? 0
        : pushDieSuccesses(state.mode, die.result, die.category))
    ), 0);
    const results = dice.map((die) => {
      const dieSuccessCount = die.category === "ammo"
        ? 0
        : pushDieSuccesses(state.mode, die.result, die.category);
      const classes = [
        "yze-final-die",
        `d${Number(die.faces)}`,
        die.rerolled ? "was-rerolled" : "",
        Number(die.result) === 1 ? "is-bane" : "",
        dieSuccessCount > 0 ? "is-success" : ""
      ].filter(Boolean).join(" ");
      return `<span class="${classes}" data-tooltip="${escape(dieSummary(die))}">${escape(die.result)}</span>`;
    }).join("");

    return `
      <section class="yze-final-dice-group">
        <header>
          <span>${escape(categoryGroupLabel(category, state.mode))}</span>
          <strong>${successes}</strong>
        </header>
        <div class="yze-final-dice-values">${results}</div>
      </section>`;
  }).join("");
}

function renderPushedFlavor(state, consequences = []) {
  const successes = countPushSuccesses(state);
  const banes = countPushBanes(state);
  const successKey = successes === 1 ? "YZE.Roll.Success" : "YZE.Roll.Successes";
  const baneKey = banes.total === 1 ? "YZE.Roll.Bane" : "YZE.Roll.Banes";
  const resultLabel = game.i18n.format(successKey, { count: successes });
  const baneLabel = game.i18n.format(baneKey, { count: banes.total });
  const dice = renderFinalDiceGroups(state);
  const consequenceList = consequences.length > 0
    ? `<ul class="yze-push-consequences">${consequences.map((entry) => `<li>${escape(entry)}</li>`).join("")}</ul>`
    : "";
  const opposedControl = state.canOppose === false
    ? ""
    : `<div class="yze-opposed-controls">
        <button type="button" data-action="opposeRoll">
          <i class="fa-solid fa-scale-balanced" aria-hidden="true"></i>
          ${escape(game.i18n.localize("YZE.Opposed.Start"))}
        </button>
      </div>`;

  return `
    <div class="yze chat-card yze-pushed-roll">
      <h3>${escape(game.i18n.format("YZE.Roll.PushedTitle", { label: state.label }))}</h3>
      ${renderRollContext(state)}
      <p class="yze-successes">${escape(resultLabel)}</p>
      <p class="yze-banes">${escape(baneLabel)}</p>
      <div class="yze-final-dice">${dice}</div>
      <div class="yze-pushed-total">${successes}</div>
      ${renderHelpingSummary(state.helpers, state.helpAction)}
      ${consequenceList}
      <p class="yze-push-cost-hint">${escape(game.i18n.localize("YZE.Roll.PushCostHint"))}</p>
      ${canPushAgain(state) ? renderPushControls(state) : ""}
      ${opposedControl}
      ${renderAttackControl(state)}
      ${renderHealingControl(state)}
      ${renderChaseControl(state)}
      ${renderTravelControl(state)}
      ${renderVehicleManeuverControl(state)}
      ${renderHazardControl(state)}
      ${renderSurpriseControl(state)}
    </div>`;
}

async function resolveActor(state) {
  if (!state?.actorUuid || typeof fromUuid !== "function") return null;
  const actor = await fromUuid(state.actorUuid);
  return actor?.documentName === "Actor" || actor?.system ? actor : null;
}

function canUpdateActor(actor) {
  return Boolean(actor) && (actor.isOwner !== false || game.user?.isGM === true);
}

export function getPushHarmTarget(harmModel, attributeKey) {
  if (harmModel === HARM_MODELS.ATTRIBUTE_DAMAGE) return "attribute";
  if (harmModel === HARM_MODELS.HEALTH_ONLY) return "health";
  if (harmModel === HARM_MODELS.CONDITIONS) return "condition";
  return ATTRIBUTE_GROUPS[attributeKey] === "mental" ? "resolve" : "health";
}

function prepareStressPush(state) {
  if (!state?.rules?.stressDice) return { state, consequences: [] };

  const existingStressDice = state.dice.filter((die) => die.category === "stress").length;
  const newDie = {
    id: `stress-${existingStressDice}`,
    category: "stress",
    faces: 6,
    result: null,
    rerolled: false,
    addedByPush: true
  };
  const prepared = { ...state, dice: [...state.dice, newDie] };
  return { state: prepared, consequences: [] };
}

async function applyConfiguredConsequences(state, actor, selectedCondition, consequences) {
  const rules = state.rules ?? {};
  // Stored rolls created before this setting retain the previous behaviour.
  const appliesBaneDamage = rules.baneDamage !== false;
  const banes = countPushBanes(state);
  const group = ATTRIBUTE_GROUPS[state.attributeKey];
  const labels = getAttributeLabels();
  const updates = {};
  const canUpdate = canUpdateActor(actor);
  let willpowerGain = 0;

  if (rules.stressDice) {
    const current = Number(actor?.system?.resources?.stress?.value);
    const maximum = Number(actor?.system?.resources?.stress?.max) || 99;
    if (canUpdate && Number.isFinite(current)) {
      updates["system.resources.stress.value"] = Math.min(maximum, current + 1);
      consequences.push(game.i18n.localize("YZE.Roll.StressGained"));
    } else {
      consequences.push(game.i18n.localize("YZE.Roll.StressManual"));
    }
  }

  if (appliesBaneDamage && banes.attribute > 0 && state.mount?.mountUuid) {
    const mount = await fromUuid(state.mount.mountUuid);
    const current = Number(mount?.system?.resources?.health?.value);
    if (mount?.type === "mount" && canUpdateActor(mount) && Number.isFinite(current)) {
      const next = Math.max(0, current - banes.attribute);
      await mount.update({
        "system.resources.health.value": next,
        "system.perished": next === 0
      }, { yzeSkipCriticalInjury: true });
      consequences.push(game.i18n.format("YZE.Mount.PushDamage", {
        mount: mount.name,
        count: current - next
      }));
    } else consequences.push(game.i18n.format("YZE.Roll.HarmManual", { count: banes.attribute }));
  } else if (appliesBaneDamage && banes.attribute > 0) {
    const harmTarget = getPushHarmTarget(rules.harmModel, state.attributeKey);
    if (harmTarget === "attribute") {
      const field = state.mode === DICE_SYSTEMS.STEP ? "stepRating" : "value";
      const current = Number(actor?.system?.attributes?.[state.attributeKey]?.[field]);
      if (canUpdate && Number.isFinite(current)) {
        const next = Math.max(0, current - banes.attribute);
        updates[`system.attributes.${state.attributeKey}.${field}`] = next;
        willpowerGain = current - next;
        consequences.push(game.i18n.format("YZE.Roll.AttributeLost", {
          attribute: labels[state.attributeKey] ?? state.attributeKey,
          count: banes.attribute
        }));
      } else {
        consequences.push(game.i18n.format("YZE.Roll.HarmManual", { count: banes.attribute }));
      }
    } else if (harmTarget !== "condition") {
      const resource = harmTarget;
      const current = Number(actor?.system?.resources?.[resource]?.value);
      if (canUpdate && Number.isFinite(current)) {
        updates[`system.resources.${resource}.value`] = Math.max(0, current - banes.attribute);
        consequences.push(game.i18n.format(
          resource === "resolve" ? "YZE.Roll.ResolveLost" : "YZE.Roll.HealthLost",
          { count: banes.attribute }
        ));
      } else {
        consequences.push(game.i18n.format("YZE.Roll.HarmManual", { count: banes.attribute }));
      }
    }
  }

  if (appliesBaneDamage && rules.harmModel === HARM_MODELS.ATTRIBUTE_DAMAGE
    && banes.gear > 0) {
    const gearBanes = new Map();
    let unlinkedBanes = 0;
    for (const die of state.dice ?? []) {
      if (die.category !== "gear" || Number(die.result) !== 1) continue;
      if (!die.gearItemId) {
        unlinkedBanes += 1;
        continue;
      }
      const entry = gearBanes.get(die.gearItemId) ?? {
        count: 0,
        name: die.gearItemName ?? game.i18n.localize("YZE.Actor.Gear")
      };
      entry.count += 1;
      gearBanes.set(die.gearItemId, entry);
    }

    for (const [itemId, entry] of gearBanes) {
      const item = actor?.items?.get(itemId);
      const gearField = state.mode === DICE_SYSTEMS.STEP
        ? "system.reliability.value"
        : "system.bonus";
      const current = Number(foundry.utils.getProperty(item, gearField));
      if (!canUpdate || !item || !["gear", "weapon"].includes(item.type)
        || !Number.isFinite(current)) {
        unlinkedBanes += entry.count;
        continue;
      }
      const next = Math.max(0, current - entry.count);
      try {
        await item.update({ [gearField]: next });
        consequences.push(game.i18n.format(
          next === 0 ? "YZE.Roll.GearBroken" : "YZE.Roll.GearDamaged",
          { gear: item.name, count: current - next, bonus: next }
        ));
      } catch (error) {
        console.warn("YZE System Toolkit | Could not degrade Gear Item", error);
        unlinkedBanes += entry.count;
      }
    }
    if (unlinkedBanes > 0) {
      consequences.push(game.i18n.format("YZE.Roll.GearDamageManual", {
        count: unlinkedBanes
      }));
    }
  }

  const appliesCondition = rules.conditions || rules.conditionBaneDamage;
  if (appliesCondition && !state.mount?.mountUuid && group && CONDITIONS[group]) {
    const validConditions = CONDITIONS[group];
    const currentConditions = actor?.system?.conditions ?? state.conditionState ?? {};
    const available = validConditions.filter((key) => currentConditions[key] !== true);
    if (available.length === 0) {
      if (canUpdate) updates[`system.broken.${group}`] = true;
      consequences.push(game.i18n.format("YZE.Roll.ConditionBroken", {
        group: game.i18n.localize(`YZE.Conditions.${group}.Label`)
      }));
    } else if (available.includes(selectedCondition) && canUpdate) {
      updates[`system.conditions.${selectedCondition}`] = true;
      consequences.push(game.i18n.format("YZE.Roll.ConditionGained", {
        condition: game.i18n.localize(`YZE.Conditions.${selectedCondition}`)
      }));
    } else {
      consequences.push(game.i18n.format("YZE.Roll.ConditionManual", {
        group: game.i18n.localize(`YZE.Conditions.${group}.Label`)
      }));
    }
  }

  if (rules.willpower) {
    if (!appliesBaneDamage || rules.harmModel !== HARM_MODELS.ATTRIBUTE_DAMAGE) {
      willpowerGain = 1;
    }
    if (willpowerGain > 0) {
      const current = Number(actor?.system?.resources?.willpower?.value);
      const maximum = Number(actor?.system?.resources?.willpower?.max) || 99;
      if (canUpdate && Number.isFinite(current)) {
        const next = Math.min(maximum, current + willpowerGain);
        const gained = next - current;
        if (gained > 0) {
          updates["system.resources.willpower.value"] = next;
          consequences.push(game.i18n.format("YZE.Roll.WillpowerGained", { count: gained }));
        }
      } else {
        consequences.push(game.i18n.format("YZE.Roll.WillpowerManual", { count: willpowerGain }));
      }
    }
  }

  if (rules.doomPoints) {
    const doomGained = await gainDoomFromPush(state);
    consequences.push(game.i18n.localize(
      doomGained ? "YZE.Roll.DoomPointGained" : "YZE.Roll.DoomPointRequested"
    ));
  }

  if (canUpdate && Object.keys(updates).length > 0) {
    try {
      await actor.update(updates, { yzeSkipCriticalInjury: true });
    } catch (error) {
      console.warn("YZE System Toolkit | Could not apply pushed-roll consequences", error);
      consequences.push(game.i18n.localize("YZE.Roll.ConsequenceUpdateFailed"));
    }
  }
  return consequences;
}

function activeRollResults(roll) {
  return (roll.dice ?? []).flatMap((die) => (die.results ?? []))
    .filter((result) => result.active !== false)
    .map((result) => Number(result.result));
}

function validatedSelection(state, selectedIds) {
  const requested = new Set(selectedIds);
  return (state?.dice ?? [])
    .filter((die) => requested.has(die.id))
    .filter((die) => Number(die.result) !== 1)
    .filter((die) => VALID_FACES.has(Number(die.faces)))
    .map((die) => die.id);
}

export async function executePush(
  message,
  state,
  selectedIds,
  StepRollClass = Roll,
  { condition = null, onPushed = null } = {}
) {
  if (state?.canPush === false) {
    ui.notifications.warn(game.i18n.localize("YZE.Roll.CannotPush"));
    return null;
  }
  if (!state || !canPushAgain(state)) {
    ui.notifications.warn(game.i18n.localize("YZE.Roll.AlreadyPushed"));
    return null;
  }

  const actor = await resolveActor(state);
  const prepared = prepareStressPush(state);
  const newStressIds = prepared.state.dice
    .filter((die) => die.addedByPush)
    .map((die) => die.id);
  const selection = validatedSelection(prepared.state, [...selectedIds, ...newStressIds]);
  if (selection.length === 0) {
    ui.notifications.warn(game.i18n.localize("YZE.Roll.SelectPushDice"));
    return null;
  }

  const selected = new Set(selection);
  const terms = prepared.state.dice
    .filter((die) => selected.has(die.id))
    .map((die) => state.mode === DICE_SYSTEMS.POOL
      ? `1d${die.faces}cs>=6[${categoryLabel(die.category)}]`
      : `1d${die.faces}[${categoryLabel(die.category)}]`);
  const RollClass = state.mode === DICE_SYSTEMS.STEP ? StepRollClass : Roll;
  const roll = await new RollClass(terms.join(" + ")).evaluate();
  const pushedState = {
    ...applyPushResults(prepared.state, selection, activeRollResults(roll)),
    sourceMessageId: message.id
  };
  const appliedBaneIds = new Set(state.appliedBaneIds ?? []);
  const consequenceDice = pushedState.dice.filter((die) => (
    Number(die.result) !== 1 || !appliedBaneIds.has(die.id)
  ));
  for (const die of consequenceDice) {
    if (Number(die.result) === 1) appliedBaneIds.add(die.id);
  }
  pushedState.appliedBaneIds = [...appliedBaneIds];
  const consequences = await applyConfiguredConsequences(
    { ...pushedState, dice: consequenceDice },
    actor,
    condition,
    prepared.consequences
  );
  if (condition && (pushedState.rules?.conditions || pushedState.rules?.conditionBaneDamage)) {
    pushedState.conditionState = { ...pushedState.conditionState, [condition]: true };
  }
  // The Roll terms contain only rerolled dice, but the SRD result includes
  // retained dice as well. Keep Foundry's displayed total aligned with the
  // combined result shown in the pushed chat card.
  roll._total = countPushSuccesses(pushedState);

  const pushedMessage = await roll.toMessage({
    speaker: message.speaker,
    flavor: renderPushedFlavor(pushedState, consequences),
    whisper: message.whisper,
    blind: message.blind,
    flags: {
      [SYSTEM_ID]: {
        [PUSH_FLAG]: pushedState
      }
    }
  });

  const panicResolution = await resolveStressDiePanic(pushedMessage, pushedState, actor);
  const finalPushedState = panicResolution?.state ?? pushedState;

  await message.setFlag(SYSTEM_ID, PUSH_FLAG, {
    ...state,
    pushed: true,
    superseded: true
  });
  if (typeof onPushed === "function") {
    await onPushed(message, pushedMessage, finalPushedState);
  }
  return pushedMessage;
}

/** Show only localized YZE die-type headers in Foundry's roll breakdown. */
export function renderDiceTypeFormula(root, state = null) {
  if (!root?.querySelectorAll) return;

  const pushed = root.querySelector?.(".yze-pushed-roll");
  for (const diceRoll of root.querySelectorAll(".dice-roll")) {
    if (pushed) {
      diceRoll.classList.add("yze-pushed-foundry-roll");
      continue;
    }
    diceRoll.classList.add("yze-dice-type-roll");
    const renderedDice = diceRoll.querySelectorAll(".dice-tooltip .dice-rolls .roll");
    for (const [index, result] of renderedDice.entries()) {
      const die = state?.dice?.[index];
      if (die?.category !== "ammo" && Number(die?.result) === 1) {
        result.classList.add("failure");
      }
      if (
        state?.mode === DICE_SYSTEMS.STEP
        && die?.category !== "ammo"
        && dieSuccesses(state.mode, die?.result, die?.category) > 0
      ) {
        result.classList.add("success");
      }
    }
    for (const flavor of diceRoll.querySelectorAll(".dice-tooltip .part-flavor")) {
      const header = flavor.closest?.(".part-header") ?? flavor.parentElement;
      const foundryFormula = header?.querySelector?.(".part-formula");
      if (foundryFormula) foundryFormula.hidden = true;
    }

    if (state?.mode === DICE_SYSTEMS.STEP) {
      const groupSuccesses = [];
      for (const die of state.dice ?? []) {
        const previous = groupSuccesses.at(-1);
        const successes = die.category === "ammo"
          ? 0
          : dieSuccesses(state.mode, die.result, die.category);
        if (previous?.category === die.category) {
          previous.successes += successes;
        } else {
          groupSuccesses.push({ category: die.category, successes });
        }
      }

      const partTotals = diceRoll.querySelectorAll(".dice-tooltip .part-total");
      for (const [index, total] of partTotals.entries()) {
        const group = groupSuccesses[index];
        if (group) total.textContent = String(group.successes);
      }
    }

    const formula = diceRoll.querySelector(".dice-formula");
    if (formula) formula.hidden = true;
  }
}

export function registerPushChatHook({ StepRollClass, onPushed } = {}) {
  Hooks.on("renderChatMessageHTML", (message, html) => {
    const root = html?.querySelector ? html : html?.[0];
    const state = message.getFlag(SYSTEM_ID, PUSH_FLAG);
    if (state) renderDiceTypeFormula(root, state);

    const button = root?.querySelector?.('[data-action="pushRoll"]');
    if (!button) return;

    if (!state || !canPushAgain(state)) {
      button.disabled = true;
      button.textContent = game.i18n.localize(
        state?.canPush === false ? "YZE.Roll.CannotPush" : "YZE.Roll.AlreadyPushed"
      );
      return;
    }

    button.addEventListener("click", async () => {
      const isAuthor = message.author?.id === game.user.id;
      if (!isAuthor && !game.user.isGM) {
        ui.notifications.warn(game.i18n.localize("YZE.Roll.PushNotAllowed"));
        return;
      }

      const current = message.getFlag(SYSTEM_ID, PUSH_FLAG);
      if (!current || !canPushAgain(current)) {
        ui.notifications.warn(game.i18n.localize("YZE.Roll.AlreadyPushed"));
        return;
      }

      button.disabled = true;
      try {
        const selection = await promptPushSelection(current);
        if (!selection) {
          button.disabled = false;
          return;
        }
        const pushed = await executePush(
          message,
          current,
          selection.selectedIds,
          StepRollClass,
          { condition: selection.condition, onPushed }
        );
        if (!pushed) button.disabled = false;
      } catch (error) {
        console.error("YZE System Toolkit | Push failed", error);
        ui.notifications.error(game.i18n.localize("YZE.Roll.PushFailed"));
        button.disabled = false;
      }
    });
  });
}
