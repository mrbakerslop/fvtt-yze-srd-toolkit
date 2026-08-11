import {
  ATTRIBUTE_GROUPS,
  CONDITIONS,
  DICE_SYSTEMS,
  SPECIALTY_EFFECTS,
  STEP_MODIFIER_METHODS
} from "../constants.mjs";
import {
  getDiceSystem,
  getPersonalityFields,
  getStepModifierMethod,
  isConditionsEnabled
} from "../settings.mjs";
import { getCriticalInjuryModifier } from "../critical-injuries.mjs";
import { getPanicModifier } from "../panic.mjs";
import { specialtyEffect } from "../specialties.mjs";
import { getMagicAutomaticSuccesses, getMagicRollModifier } from "../magic.mjs";
import { automaticRollModifierEffects, rollModifierEffects } from "../item-effects.mjs";
import { combatActionState } from "../combat.mjs";
import { helperCandidates, MAX_HELPERS } from "../helping.mjs";
import { zoneRollModifiers } from "../zones.mjs";

const ARTIFACT_DICE = new Set([8, 10, 12]);

function integer(value, { min = -99, max = 99 } = {}) {
  const number = Math.trunc(Number(value) || 0);
  return Math.min(max, Math.max(min, number));
}

function signed(value) {
  const number = Number(value) || 0;
  return number > 0 ? `+${number}` : String(number);
}

function escape(value) {
  return foundry.utils.escapeHTML(String(value));
}

function conditionModifier(actor, attributeKey) {
  if (!isConditionsEnabled()) return { value: 0, names: [] };
  const group = ATTRIBUTE_GROUPS[attributeKey];
  const keys = CONDITIONS[group] ?? [];
  const active = keys.filter((key) => actor?.system?.conditions?.[key] === true);
  return {
    value: -active.length,
    names: active.map((key) => game.i18n.localize(`YZE.Conditions.${key}`))
  };
}

function modifierItems(actor, requiredGearIds = [], skillName = null, attributeKey = null) {
  const stepDice = getDiceSystem() === DICE_SYSTEMS.STEP;
  const requiredGear = new Set(requiredGearIds);
  const specialties = actor?.items
    ?.filter((item) => item.type === "specialty" && item.system.active)
    .filter((item) => {
      const effect = specialtyEffect(item);
      return effect === SPECIALTY_EFFECTS.MUSICIAN
        && String(skillName ?? "").localeCompare("Persuasion", undefined, { sensitivity: "base" }) === 0;
    })
    .map((item) => ({
      id: item.id,
      name: item.name,
      bonus: integer(item.system.bonus)
    }))
    .filter((item) => item.bonus !== 0)
    .sort((a, b) => a.name.localeCompare(b.name)) ?? [];

  const gear = actor?.items
    ?.filter((item) => ["gear", "weapon"].includes(item.type))
    .filter((item) => Number(item.system.quantity) > 0)
    .filter((item) => !stepDice || Number(item.system.reliability?.value ?? 5) > 0)
    .map((item) => ({
      id: item.id,
      name: item.name,
      bonus: Math.max(0, integer(item.system.bonus)),
      artifactDie: ARTIFACT_DICE.has(Number(item.system.artifactDie))
        ? Number(item.system.artifactDie)
        : 0,
      equipped: item.system.equipped === true,
      required: requiredGear.has(item.id)
    }))
    .filter((item) => item.bonus > 0)
    .sort((a, b) => a.name.localeCompare(b.name)) ?? [];

  const effects = rollModifierEffects(actor, attributeKey, skillName)
    .map((effect) => ({
      id: `${effect.item.id}:${effect.id}`,
      name: effect.item.name,
      bonus: integer(effect.value)
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  return { specialties, effects, gear };
}

function checkboxList(items, name, emptyKey, { advantageMode = false } = {}) {
  if (items.length === 0) {
    return `<p class="hint">${escape(game.i18n.localize(emptyKey))}</p>`;
  }
  return items.map((item) => `
    <label class="yze-modifier-item">
      <input type="checkbox" name="${name}" value="${escape(item.id)}" data-bonus="${item.bonus}"${item.required ? " checked disabled" : ""}>
      <span>${escape(item.name)}${item.equipped ? ` (${escape(game.i18n.localize("YZE.Roll.Equipped"))})` : ""}</span>
      <strong>${escape(advantageMode
        ? game.i18n.localize(item.bonus > 0 ? "YZE.Roll.Advantage" : "YZE.Roll.Disadvantage")
        : `${signed(item.bonus)}${item.artifactDie ? ` + D${item.artifactDie}` : ""}`)}</strong>
    </label>`).join("");
}

function helperList(context) {
  if (!context.allowHelpers) {
    return `<p class="hint">${escape(game.i18n.localize("YZE.Helping.NotAllowed"))}</p>`;
  }
  if (context.helpers.length === 0) {
    return `<p class="hint">${escape(game.i18n.localize("YZE.Helping.NoneAvailable"))}</p>`;
  }
  return context.helpers.map((helper) => {
    const unavailable = context.helpInCombat && !helper.canFast && !helper.canSlow;
    const availability = context.helpInCombat
      ? game.i18n.format("YZE.Helping.ActionAvailability", {
        fast: game.i18n.localize(helper.canFast ? "YZE.Common.Yes" : "YZE.Common.No"),
        slow: game.i18n.localize(helper.canSlow ? "YZE.Common.Yes" : "YZE.Common.No")
      })
      : game.i18n.localize("YZE.Helping.NoActionCost");
    return `<label class="yze-modifier-item">
      <input type="checkbox" name="helper" value="${escape(helper.uuid)}"${unavailable ? " disabled" : ""}>
      <span>${escape(helper.name)}</span>
      <small>${escape(availability)}</small>
    </label>`;
  }).join("");
}

function dialogContent(context) {
  const {
    condition, panic, injury, magic, fixed, specialties, effects, gear,
    advantageMode, forcedCanPush, forcedRollType, defaultRollMode, forceRollMode,
    allowAttemptTracking, helpInCombat, forcedHelpAction, allowHelpers, helpers, pride
  } = context;
  const difficultyOptions = [3, 2, 1, 0, -1, -2, -3]
    .map((value) => `<option value="${value}"${value === 0 ? " selected" : ""}>${escape(
      game.i18n.localize(`YZE.Roll.Difficulty.${value > 0 ? `plus${value}` : value < 0 ? `minus${Math.abs(value)}` : "zero"}`)
    )}</option>`)
    .join("");
  const conditionText = condition.value === 0
    ? game.i18n.localize("YZE.Roll.NoConditionModifier")
    : game.i18n.format("YZE.Roll.ConditionModifier", {
      conditions: condition.names.join(", "),
      modifier: condition.value
    });
  const injuryText = injury.value === 0
    ? game.i18n.localize("YZE.Roll.NoCriticalInjuryModifier")
    : game.i18n.format("YZE.Roll.CriticalInjuryModifier", {
      injuries: injury.sources.map((source) => source.name).join(", "),
      modifier: injury.value
    });
  const panicText = panic.value === 0
    ? game.i18n.localize("YZE.Roll.NoPanicModifier")
    : game.i18n.format("YZE.Roll.PanicModifier", {
      effects: panic.names.join(", "),
      modifier: panic.value
    });
  const fixedText = fixed.sources.map((source) => `${source.name} (${signed(source.value)})`).join(", ");
  const magicParts = [];
  if (magic.value !== 0) magicParts.push(game.i18n.format("YZE.Roll.MagicModifier", {
      effects: magic.sources.map((source) => source.name).join(", "), modifier: magic.value
    }));
  if (Number(magic.automaticSuccesses) > 0) magicParts.push(game.i18n.format(
    magic.replaceWithAutomaticSuccesses
      ? "YZE.Roll.MagicReplacementSuccesses"
      : "YZE.Roll.MagicAutomaticSuccesses",
    { count: magic.automaticSuccesses }
  ));
  const magicText = magicParts.join("; ") || game.i18n.localize("YZE.Roll.NoMagicModifier");

  return `
    <div class="yze yze-roll-dialog">
      <div class="form-group">
        <label>${escape(game.i18n.localize("YZE.Roll.DifficultyLabel"))}</label>
        <select name="difficulty">${difficultyOptions}</select>
      </div>
      ${pride.available ? `<fieldset>
        <legend>${escape(pride.label)}</legend>
        <label class="yze-modifier-item">
          <input type="checkbox" name="usePride">
          <span>${escape(pride.value)}</span>
          <strong>+1 ${escape(game.i18n.localize("YZE.Roll.AutomaticSuccess"))}</strong>
        </label>
        <p class="hint">${escape(game.i18n.localize("YZE.Personality.PrideRollHint"))}</p>
      </fieldset>` : ""}
      <fieldset>
        <legend>${escape(game.i18n.localize("YZE.Roll.Help"))}</legend>
        ${helpInCombat && allowHelpers && helpers.length > 0 ? forcedHelpAction
          ? `<input name="helpAction" type="hidden" value="${escape(forcedHelpAction)}">
            <p class="hint">${escape(game.i18n.format("YZE.Helping.MatchingAction", {
              action: game.i18n.localize(`YZE.Helping.Actions.${forcedHelpAction}`)
            }))}</p>`
          : `<div class="form-group"><label>${escape(game.i18n.localize("YZE.Helping.SupportedAction"))}</label>
              <select name="helpAction">
                <option value="slow">${escape(game.i18n.localize("YZE.Helping.Actions.slow"))}</option>
                <option value="fast">${escape(game.i18n.localize("YZE.Helping.Actions.fast"))}</option>
              </select></div>`
          : ""}
        ${helperList(context)}
        ${allowHelpers ? `<p class="hint">${escape(game.i18n.format(
          "YZE.Helping.SelectionHint", { maximum: MAX_HELPERS }
        ))}</p>` : ""}
      </fieldset>
      <fieldset>
        <legend>${escape(game.i18n.localize("YZE.Roll.SpecialtyModifiers"))}</legend>
        ${checkboxList(specialties, "specialty", "YZE.Roll.NoSpecialtyModifiers", { advantageMode })}
      </fieldset>
      <fieldset>
        <legend>${escape(game.i18n.localize("YZE.Roll.ItemEffectModifiers"))}</legend>
        ${checkboxList(effects, "itemEffect", "YZE.Roll.NoItemEffectModifiers", { advantageMode })}
      </fieldset>
      <fieldset>
        <legend>${escape(game.i18n.localize("YZE.Roll.GearModifiers"))}</legend>
        ${checkboxList(gear, "gear", "YZE.Roll.NoGearModifiers", { advantageMode })}
      </fieldset>
      <div class="form-group">
        <label>${escape(game.i18n.localize("YZE.Roll.ConditionModifiers"))}</label>
        <span class="yze-fixed-modifier">${escape(conditionText)}</span>
      </div>
      <div class="form-group">
        <label>${escape(game.i18n.localize("YZE.Roll.PanicModifiers"))}</label>
        <span class="yze-fixed-modifier">${escape(panicText)}</span>
      </div>
      <div class="form-group">
        <label>${escape(game.i18n.localize("YZE.Roll.CriticalInjuryModifiers"))}</label>
        <span class="yze-fixed-modifier">${escape(injuryText)}</span>
      </div>
      <div class="form-group">
        <label>${escape(game.i18n.localize("YZE.Roll.MagicModifiers"))}</label>
        <span class="yze-fixed-modifier">${escape(magicText)}</span>
      </div>
      ${magic.replaceWithAutomaticSuccesses ? `<p class="hint">${escape(game.i18n.localize("YZE.Roll.AutomaticReplacementHint"))}</p>` : ""}
      ${fixed.sources.length > 0 ? `
        <div class="form-group">
          <label>${escape(game.i18n.localize("YZE.Roll.FixedModifiers"))}</label>
          <span class="yze-fixed-modifier">${escape(fixedText)}</span>
        </div>` : ""}
      ${advantageMode ? `
        <div class="form-group">
          <label>${escape(game.i18n.localize("YZE.Roll.AdditionalAdvantages"))}</label>
          <input name="advantages" type="number" value="0" min="0" step="1">
        </div>
        <div class="form-group">
          <label>${escape(game.i18n.localize("YZE.Roll.AdditionalDisadvantages"))}</label>
          <input name="disadvantages" type="number" value="0" min="0" step="1">
        </div>` : `
        <div class="form-group">
          <label>${escape(game.i18n.localize("YZE.Roll.OtherModifier"))}</label>
          <input name="other" type="number" value="0" step="1">
        </div>`}
      ${forcedRollType
        ? `<input name="rollType" type="hidden" value="${escape(forcedRollType)}">
          <p class="hint">${escape(game.i18n.localize(
            forcedRollType === "passive" ? "YZE.Roll.PassiveCannotPush" : "YZE.Roll.CannotPush"
          ))}</p>`
        : forcedCanPush === false
          ? `<input name="rollType" type="hidden" value="active">
            <p class="hint">${escape(game.i18n.localize("YZE.Roll.CannotPush"))}</p>`
          : `<div class="form-group">
              <label>${escape(game.i18n.localize("YZE.Roll.RollType"))}</label>
              <select name="rollType">
                <option value="active">${escape(game.i18n.localize("YZE.Roll.ActiveRoll"))}</option>
                <option value="passive">${escape(game.i18n.localize("YZE.Roll.PassiveRoll"))}</option>
              </select>
            </div>`}
      ${forceRollMode
        ? `<input name="rollMode" type="hidden" value="${escape(defaultRollMode)}">
          <p class="hint">${escape(game.i18n.localize(
            defaultRollMode === "blindroll" ? "YZE.Roll.SecretRollForced" : "YZE.Roll.PublicRoll"
          ))}</p>`
        : `<div class="form-group">
            <label>${escape(game.i18n.localize("YZE.Roll.RollVisibility"))}</label>
            <select name="rollMode">
              <option value="publicroll"${defaultRollMode === "publicroll" ? " selected" : ""}>${escape(game.i18n.localize("YZE.Roll.PublicRoll"))}</option>
              <option value="blindroll"${defaultRollMode === "blindroll" ? " selected" : ""}>${escape(game.i18n.localize("YZE.Roll.SecretRoll"))}</option>
            </select>
          </div>`}
      ${allowAttemptTracking ? `<div class="form-group">
        <label>${escape(game.i18n.localize("YZE.Attempts.Goal"))}</label>
        <input name="attemptGoal" type="text" value="" placeholder="${escape(game.i18n.localize("YZE.Attempts.GoalPlaceholder"))}">
      </div>
      <p class="hint">${escape(game.i18n.localize("YZE.Attempts.GoalHint"))}</p>` : ""}
      <p class="hint">${escape(game.i18n.localize(
        advantageMode ? "YZE.Roll.AdvantageHint" : "YZE.Roll.ModifierHint"
      ))}</p>
    </div>`;
}

function parseDialog(form, context) {
  const rollType = form.elements.rollType?.value === "passive" ? "passive" : "active";
  const rollMode = form.elements.rollMode?.value === "blindroll" ? "blindroll" : "publicroll";
  const prideUsed = rollType === "active" && context.pride.available
    && form.elements.usePride?.checked === true;
  const attemptGoal = context.allowAttemptTracking
    ? String(form.elements.attemptGoal?.value ?? "").trim().replace(/\s+/g, " ")
    : "";
  const difficulty = integer(form.elements.difficulty?.value, { min: -3, max: 3 });
  const selectedHelpers = [...form.querySelectorAll('input[name="helper"]:checked')]
    .map((input) => context.helpers.find((helper) => helper.uuid === input.value))
    .filter(Boolean);
  const help = selectedHelpers.length;
  const helpAction = context.helpInCombat
    ? context.forcedHelpAction || form.elements.helpAction?.value || "slow"
    : "";
  const helpLabel = selectedHelpers.length > 0
    ? game.i18n.format("YZE.Helping.ModifierSource", {
      helpers: selectedHelpers.map((helper) => helper.name).join(", ")
    })
    : game.i18n.localize("YZE.Roll.Help");
  const other = integer(form.elements.other?.value);
  const selectedSpecialties = [...form.querySelectorAll('input[name="specialty"]:checked')]
    .map((input) => context.specialties.find((item) => item.id === input.value))
    .filter(Boolean);
  const selectedEffects = [...form.querySelectorAll('input[name="itemEffect"]:checked')]
    .map((input) => context.effects.find((item) => item.id === input.value))
    .filter(Boolean);
  const selectedGear = [...form.querySelectorAll('input[name="gear"]:checked')]
    .map((input) => context.gear.find((item) => item.id === input.value))
    .filter(Boolean);
  const specialty = selectedSpecialties.reduce((total, item) => total + item.bonus, 0);
  const itemEffect = selectedEffects.reduce((total, item) => total + item.bonus, 0);
  const gear = selectedGear.reduce((total, item) => total + item.bonus, 0);

  if (context.advantageMode) {
    const additionalAdvantages = integer(form.elements.advantages?.value, { min: 0 });
    const additionalDisadvantages = integer(form.elements.disadvantages?.value, { min: 0 });
    const positiveSources = (sources = []) => sources.filter((source) => source.value > 0).length;
    const negativeSources = (sources = []) => sources.filter((source) => source.value < 0).length;
    const advantageSources = [
      difficulty > 0 ? 1 : 0,
      help,
      positiveSources(context.injury.sources),
      positiveSources(context.magic.sources),
      positiveSources(context.fixed.sources),
      ...selectedSpecialties.map((item) => item.bonus > 0 ? 1 : 0),
      ...selectedEffects.map((item) => item.bonus > 0 ? 1 : 0),
      selectedGear.length,
      additionalAdvantages
    ];
    const disadvantageSources = [
      difficulty < 0 ? 1 : 0,
      Math.abs(Math.min(0, context.condition.value)),
      context.panic.value < 0 ? Math.max(1, context.panic.names.length) : 0,
      negativeSources(context.injury.sources),
      negativeSources(context.magic.sources),
      negativeSources(context.fixed.sources),
      ...selectedSpecialties.map((item) => item.bonus < 0 ? 1 : 0),
      ...selectedEffects.map((item) => item.bonus < 0 ? 1 : 0),
      additionalDisadvantages
    ];
    const advantages = advantageSources.reduce((total, value) => total + value, 0);
    const disadvantages = disadvantageSources.reduce((total, value) => total + value, 0);
    const net = Math.sign(advantages - disadvantages);
    const breakdown = [
      [game.i18n.localize("YZE.Roll.DifficultyLabel"), Math.sign(difficulty)],
      [helpLabel, help],
      ...selectedSpecialties.map((item) => [item.name, Math.sign(item.bonus)]),
      ...selectedEffects.map((item) => [item.name, Math.sign(item.bonus)]),
      ...selectedGear.map((item) => [item.name, 1]),
      [game.i18n.localize("YZE.Roll.ConditionModifiers"), context.condition.value],
      [game.i18n.localize("YZE.Roll.PanicModifiers"), context.panic.value],
      ...context.injury.sources.map((source) => [source.name, source.value]),
      ...context.magic.sources.map((source) => [source.name, source.value]),
      ...context.fixed.sources.map((source) => [source.name, source.value]),
      [game.i18n.localize("YZE.Roll.AdditionalAdvantages"), additionalAdvantages],
      [game.i18n.localize("YZE.Roll.AdditionalDisadvantages"), -additionalDisadvantages]
    ].filter(([, value]) => value !== 0);

    return {
      canPush: context.forcedCanPush ?? rollType === "active",
      rollType,
      rollMode,
      attemptGoal,
      modifierMode: STEP_MODIFIER_METHODS.ADVANTAGE,
      generalModifier: 0,
      gearDice: 0,
      totalModifier: 0,
      advantage: net,
      advantages,
      disadvantages,
      helpers: selectedHelpers.map(({ uuid, name, sceneId }) => ({ uuid, name, sceneId })),
      helpAction,
      gearItems: selectedGear.map((item) => ({ ...item })),
      breakdown,
      automaticSuccesses: (context.magic.automaticSuccesses ?? 0) + (prideUsed ? 1 : 0),
      replaceWithAutomaticSuccesses: context.magic.replaceWithAutomaticSuccesses === true,
      automaticEffectIds: context.magic.automaticEffectIds ?? [],
      prideUsed
    };
  }

  const generalModifier = difficulty + help + specialty + itemEffect + context.condition.value + context.panic.value
    + context.injury.value + context.magic.value + context.fixed.value + other;
  const breakdown = [
    [game.i18n.localize("YZE.Roll.DifficultyLabel"), difficulty],
    [helpLabel, help],
    ...selectedSpecialties.map((item) => [item.name, item.bonus]),
    ...selectedEffects.map((item) => [item.name, item.bonus]),
    ...selectedGear.map((item) => [item.name, item.bonus]),
    [game.i18n.localize("YZE.Roll.ConditionModifiers"), context.condition.value],
    [game.i18n.localize("YZE.Roll.PanicModifiers"), context.panic.value],
    ...context.injury.sources.map((source) => [source.name, source.value]),
    ...context.magic.sources.map((source) => [source.name, source.value]),
    ...context.fixed.sources.map((source) => [source.name, source.value]),
    [game.i18n.localize("YZE.Roll.OtherModifier"), other]
  ].filter(([, value]) => value !== 0);

  return {
    canPush: context.forcedCanPush ?? rollType === "active",
    rollType,
    rollMode,
    attemptGoal,
    modifierMode: STEP_MODIFIER_METHODS.NUMERICAL,
    generalModifier,
    helpers: selectedHelpers.map(({ uuid, name, sceneId }) => ({ uuid, name, sceneId })),
    helpAction,
    gearDice: gear,
    gearItems: selectedGear.map((item) => ({ ...item })),
    totalModifier: generalModifier + gear,
    breakdown,
    automaticSuccesses: (context.magic.automaticSuccesses ?? 0) + (prideUsed ? 1 : 0),
    replaceWithAutomaticSuccesses: context.magic.replaceWithAutomaticSuccesses === true,
    automaticEffectIds: context.magic.automaticEffectIds ?? [],
    prideUsed
  };
}

export async function promptRollModifiers({
  actor,
  label,
  attributeKey,
  skillName = null,
  canPush = null,
  rollType = null,
  rollMode = "publicroll",
  forceRollMode = false,
  allowAttemptTracking = true,
  helpAction = null,
  allowHelpers = true,
  excludedHelperUuids = [],
  fixedGearIds = [],
  fixedModifiers = []
}) {
  const advantageMode = getDiceSystem() === DICE_SYSTEMS.STEP
    && getStepModifierMethod() === STEP_MODIFIER_METHODS.ADVANTAGE;
  const automaticItemEffects = automaticRollModifierEffects(actor, attributeKey, skillName);
  const combinedFixedModifiers = [
    ...fixedModifiers,
    ...automaticItemEffects.map((effect) => [effect.item.name, effect.value]),
    ...zoneRollModifiers(actor, skillName)
  ];
  const magicModifier = getMagicRollModifier(actor, attributeKey, skillName);
  const magicAutomatic = getMagicAutomaticSuccesses(actor, skillName);
  const prideField = getPersonalityFields().find((field) => field.key === "pride");
  const prideValue = String(actor?.system?.personality?.pride?.value ?? "").trim();
  const context = {
    condition: conditionModifier(actor, attributeKey),
    panic: getPanicModifier(actor, attributeKey),
    injury: getCriticalInjuryModifier(actor, attributeKey, skillName),
    magic: {
      ...magicModifier,
      automaticSuccesses: magicAutomatic.value,
      replaceWithAutomaticSuccesses: magicAutomatic.replaceRoll,
      automaticEffectIds: magicAutomatic.sources.filter((source) => source.oneUse).map((source) => source.id)
    },
    fixed: {
      sources: combinedFixedModifiers.map(([name, value]) => ({ name, value: integer(value) })),
      value: combinedFixedModifiers.reduce((total, [, value]) => total + integer(value), 0)
    },
    ...modifierItems(actor, fixedGearIds, skillName, attributeKey),
    helpers: allowHelpers ? helperCandidates(actor, { excludeUuids: excludedHelperUuids }) : [],
    allowHelpers,
    helpInCombat: combatActionState(actor).active,
    forcedHelpAction: ["fast", "slow"].includes(helpAction) ? helpAction : "",
    advantageMode,
    forcedCanPush: canPush === false || rollType === "passive" ? false : null,
    forcedRollType: ["active", "passive"].includes(rollType) ? rollType : null,
    defaultRollMode: rollMode === "blindroll" ? "blindroll" : "publicroll",
    forceRollMode,
    allowAttemptTracking,
    pride: {
      available: actor?.type === "character" && prideField?.enabled === true
        && prideValue.length > 0 && actor.system.personality.pride.used !== true
        && rollType !== "passive",
      label: prideField?.label || game.i18n.localize("YZE.Personality.Defaults.pride"),
      value: prideValue
    }
  };
  if (magicAutomatic.replaceRoll) {
    context.condition = { value: 0, names: [] };
    context.panic = { value: 0, names: [] };
    context.injury = { value: 0, sources: [] };
    context.magic.value = 0;
    context.magic.sources = [];
    context.fixed = { value: 0, sources: [] };
    context.specialties = [];
    context.effects = [];
    context.gear = [];
    context.helpers = [];
    context.allowHelpers = false;
    context.forcedCanPush = false;
    context.pride.available = false;
  }
  const { DialogV2 } = foundry.applications.api;
  return DialogV2.wait({
    window: {
      title: game.i18n.format("YZE.Roll.DialogTitle", { label })
    },
    content: dialogContent(context),
    buttons: [
      {
        action: "roll",
        label: game.i18n.localize("YZE.Roll.Roll"),
        icon: "fa-solid fa-dice",
        default: true,
        callback: (event, button, dialog) => {
          const form = button.form ?? dialog.element.querySelector("form");
          return parseDialog(form, context);
        }
      },
      {
        action: "cancel",
        label: game.i18n.localize("YZE.Common.Cancel"),
        icon: "fa-solid fa-xmark",
        // DialogV2 replaces a nullish callback result with the button action.
        // Return false so callers can reliably treat this as cancellation.
        callback: () => false
      }
    ],
    close: () => null,
    rejectClose: false,
    modal: true
  });
}

export function renderModifierBreakdown(
  breakdown = [],
  total = 0,
  { modifierMode = STEP_MODIFIER_METHODS.NUMERICAL, advantages = 0, disadvantages = 0 } = {}
) {
  if (breakdown.length === 0) return "";
  const entries = breakdown.map(([label, value]) => (
    `<li><span>${escape(label)}</span><strong>${escape(signed(value))}</strong></li>`
  )).join("");
  const summary = modifierMode === STEP_MODIFIER_METHODS.ADVANTAGE
    ? game.i18n.format("YZE.Roll.AdvantageTotal", {
      advantages,
      disadvantages,
      result: game.i18n.localize(
        total > 0
          ? "YZE.Roll.Advantage"
          : total < 0
            ? "YZE.Roll.Disadvantage"
            : "YZE.Roll.Balanced"
      )
    })
    : game.i18n.format("YZE.Roll.ModifierTotal", { total: signed(total) });
  return `
    <details class="yze-modifier-breakdown">
      <summary>${escape(summary)}</summary>
      <ul>${entries}</ul>
    </details>`;
}
