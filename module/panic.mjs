import { SYSTEM_ID } from "./constants.mjs";
import { PANIC_RESULTS, getPanicResult } from "./panic-data.mjs";
import { isStressDiceEnabled } from "./settings.mjs";

function escape(value) {
  return foundry.utils.escapeHTML(String(value));
}

function wholeNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.trunc(number)) : 0;
}

export function isActorCatatonic(actor) {
  return activePanicEffects(actor).some((effect) => effect.key === "catatonic");
}

function activePanicEffects(actor) {
  if (!isStressDiceEnabled()) return [];
  const panic = actor?.system?.panic;
  if (panic?.active !== true) return [];
  if (Array.isArray(panic.effects) && panic.effects.length > 0) return panic.effects;
  return panic.key ? [{
    total: panic.total,
    key: panic.key,
    title: panic.title,
    effect: panic.effect
  }] : [];
}

export function getPanicModifier(actor, attributeKey) {
  const tremble = activePanicEffects(actor).find((effect) => effect.key === "tremble");
  if (!tremble || attributeKey !== "agility") {
    return { value: 0, names: [] };
  }
  return {
    value: -2,
    names: [tremble.title || game.i18n.localize("YZE.Panic.Tremble")]
  };
}

export function panicSheetState(actor) {
  const effects = activePanicEffects(actor);
  if (effects.length === 0) return { active: false, effects: [] };
  return {
    active: true,
    effects: effects.map((effect) => ({
      total: wholeNumber(effect.total),
      title: effect.title,
      effect: effect.effect
    }))
  };
}

export async function clearPanic(actor) {
  if (!actor || actor.type === "vehicle") return false;
  await actor.update({
    "system.panic.active": false,
    "system.panic.total": 0,
    "system.panic.key": "",
    "system.panic.title": "",
    "system.panic.effect": "",
    "system.panic.effects": []
  });
  return true;
}

export async function rollPanic(actor, { reason = null, whisper = [], blind = false } = {}) {
  if (!isStressDiceEnabled()) {
    ui.notifications.info(game.i18n.localize("YZE.Panic.Disabled"));
    return null;
  }
  if (!actor || actor.type === "vehicle") {
    ui.notifications.warn(game.i18n.localize("YZE.Panic.ActorRequired"));
    return null;
  }
  if (actor.isOwner === false && game.user?.isGM !== true) {
    ui.notifications.warn(game.i18n.localize("YZE.Panic.NotAllowed"));
    return null;
  }

  const stressBefore = wholeNumber(actor.system?.resources?.stress?.value);
  const roll = await new Roll("1d6").evaluate();
  const die = wholeNumber(roll.total);
  const total = die + stressBefore;
  const result = getPanicResult(total);
  const maximum = wholeNumber(actor.system?.resources?.stress?.max) || 99;
  const stressAfter = Math.min(maximum, Math.max(0, stressBefore + result.stressChange));
  const existingEffects = activePanicEffects(actor).map((effect) => ({
    total: wholeNumber(effect.total),
    key: effect.key,
    title: effect.title,
    effect: effect.effect
  }));
  const effects = stressAfter === 0
    ? []
    : result.key === "keepingTogether"
      ? existingEffects
      : [
        ...existingEffects.filter((effect) => effect.key !== result.key),
        { total, key: result.key, title: result.title, effect: result.effect }
      ];
  const latest = effects.at(-1);
  const remainsActive = effects.length > 0;
  const updates = {
    "system.resources.stress.value": stressAfter,
    "system.panic.active": remainsActive,
    "system.panic.total": latest?.total ?? 0,
    "system.panic.key": latest?.key ?? "",
    "system.panic.title": latest?.title ?? "",
    "system.panic.effect": latest?.effect ?? "",
    "system.panic.effects": effects
  };
  await actor.update(updates);

  const stressLine = result.stressChange === 0 ? "" : `<p>${escape(game.i18n.format(
    result.stressChange > 0 ? "YZE.Panic.StressGained" : "YZE.Panic.StressLost",
    { actor: actor.name, stress: stressAfter }
  ))}</p>`;
  const clearedLine = stressAfter === 0
    ? `<p>${escape(game.i18n.localize("YZE.Panic.Cleared"))}</p>`
    : "";
  const reasonLine = reason
    ? `<p class="hint">${escape(reason)}</p>`
    : "";
  const message = await roll.toMessage({
    speaker: ChatMessage.getSpeaker({ actor }),
    ...(Array.isArray(whisper) && whisper.length > 0 ? { whisper } : {}),
    ...(blind ? { blind: true } : {}),
    flavor: `
      <div class="yze chat-card yze-panic-card">
        <h3>${escape(game.i18n.format("YZE.Panic.RollTitle", { actor: actor.name }))}</h3>
        ${reasonLine}
        <p>${escape(game.i18n.format("YZE.Panic.Total", {
          die,
          stress: stressBefore,
          total
        }))}</p>
        <h4>${escape(`${total}: ${result.title}`)}</h4>
        <p>${escape(result.effect)}</p>
        ${stressLine}
        ${clearedLine}
      </div>`,
    flags: {
      [SYSTEM_ID]: {
        panic: { actorUuid: actor.uuid, die, stress: stressBefore, total, key: result.key }
      }
    }
  });
  return { message, roll, result, total, stressBefore, stressAfter };
}

export async function resolveStressDiePanic(message, state, actor = null) {
  if (!state?.rules?.stressDice || state.panicTriggered === true) return null;
  const triggered = (state.dice ?? []).some((die) => (
    die.category === "stress" && Number(die.result) === 1
  ));
  if (!triggered) return null;

  const nextState = { ...state, panicTriggered: true };
  if (message?.setFlag) await message.setFlag(SYSTEM_ID, "push", nextState);
  const target = actor ?? (state.actorUuid && typeof fromUuid === "function"
    ? await fromUuid(state.actorUuid)
    : null);
  if (!target?.system) {
    ui.notifications.warn(game.i18n.localize("YZE.Panic.ActorRequired"));
    return { state: nextState, panic: null };
  }
  const panic = await rollPanic(target, {
    reason: game.i18n.localize("YZE.Panic.StressDieReason"),
    whisper: message?.whisper ?? [],
    blind: message?.blind === true
  });
  return { state: nextState, panic };
}

export { PANIC_RESULTS };
