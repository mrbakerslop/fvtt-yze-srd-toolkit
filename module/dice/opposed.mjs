import { ATTRIBUTE_KEYS, SYSTEM_ID } from "../constants.mjs";
import { getAttributeLabels } from "../settings.mjs";
import { countPushSuccesses } from "./push.mjs";

const OPPOSED_FLAG = "opposed";
const PUSH_FLAG = "push";

function escape(value) {
  return foundry.utils.escapeHTML(String(value));
}

function availableActors() {
  const actors = new Map();
  for (const actor of game.actors ?? []) actors.set(actor.uuid, actor);
  for (const token of globalThis.canvas?.tokens?.placeables ?? []) {
    if (token.actor) actors.set(token.actor.uuid, token.actor);
  }
  return [...actors.values()]
    .filter((actor) => ["character", "npc"].includes(actor.type))
    .filter((actor) => game.user?.isGM === true || actor.isOwner !== false)
    .sort((a, b) => a.name.localeCompare(b.name));
}

function opposedTests() {
  const labels = getAttributeLabels();
  const tests = new Map();
  const groups = [];
  let index = 0;

  for (const actor of availableActors()) {
    const options = [];
    for (const key of ATTRIBUTE_KEYS) {
      const id = String(index++);
      tests.set(id, { actor, kind: "attribute", key });
      options.push(`<option value="${id}">${escape(labels[key])}</option>`);
    }
    const skills = actor.items
      .filter((item) => item.type === "skill")
      .sort((a, b) => a.name.localeCompare(b.name));
    for (const skill of skills) {
      const id = String(index++);
      tests.set(id, { actor, kind: "skill", key: skill.id });
      options.push(`<option value="${id}">${escape(skill.name)}</option>`);
    }
    groups.push(`<optgroup label="${escape(actor.name)}">${options.join("")}</optgroup>`);
  }

  return { tests, options: groups.join("") };
}

export function renderOpposedControl(state) {
  if (state?.canOppose === false) return "";
  return `
    <div class="yze-opposed-controls">
      <button type="button" data-action="opposeRoll">
        <i class="fa-solid fa-scale-balanced" aria-hidden="true"></i>
        ${escape(game.i18n.localize("YZE.Opposed.Start"))}
      </button>
    </div>`;
}

function comparisonContent(activeState, opponentState, { updated = false } = {}) {
  const active = countPushSuccesses(activeState);
  const opponent = countPushSuccesses(opponentState);
  const margin = Math.max(0, active - opponent);
  const outcomeKey = active > opponent
    ? "YZE.Opposed.ActiveWins"
    : active === opponent
      ? "YZE.Opposed.Tie"
      : "YZE.Opposed.ActiveLoses";
  const successLabel = (count) => game.i18n.format(
    count === 1 ? "YZE.Roll.Success" : "YZE.Roll.Successes",
    { count }
  );
  const rollLabel = (state) => state.actorName
    ? `${state.actorName}: ${state.label}`
    : state.label;

  return `
    <div class="yze chat-card yze-opposed-result">
      <h3>${escape(game.i18n.localize(updated ? "YZE.Opposed.UpdatedTitle" : "YZE.Opposed.Title"))}</h3>
      <div class="yze-opposed-sides">
        <div>
          <strong>${escape(game.i18n.localize("YZE.Opposed.ActiveParty"))}</strong>
          <span>${escape(rollLabel(activeState))}</span>
          <b>${escape(successLabel(active))}</b>
        </div>
        <div>
          <strong>${escape(game.i18n.localize("YZE.Opposed.Opposition"))}</strong>
          <span>${escape(rollLabel(opponentState))}</span>
          <b>${escape(successLabel(opponent))}</b>
        </div>
      </div>
      <p class="yze-opposed-outcome">${escape(game.i18n.format(outcomeKey, { margin }))}</p>
      <p class="hint">${escape(game.i18n.localize("YZE.Opposed.PushHint"))}</p>
    </div>`;
}

async function chooseOpposition(activeState) {
  const context = opposedTests();
  if (context.tests.size === 0) {
    ui.notifications.warn(game.i18n.localize("YZE.Opposed.NoActors"));
    return null;
  }

  const { DialogV2 } = foundry.applications.api;
  return DialogV2.wait({
    window: { title: game.i18n.localize("YZE.Opposed.DialogTitle") },
    content: `
      <div class="yze yze-opposed-dialog">
        <p>${escape(game.i18n.format("YZE.Opposed.DialogHint", { roll: activeState.label }))}</p>
        <div class="form-group">
          <label>${escape(game.i18n.localize("YZE.Opposed.OpposingTest"))}</label>
          <select name="opposedTest">${context.options}</select>
        </div>
        <p class="hint">${escape(game.i18n.localize("YZE.Opposed.DefenderCannotPush"))}</p>
      </div>`,
    buttons: [
      {
        action: "roll",
        label: game.i18n.localize("YZE.Opposed.RollOpposition"),
        icon: "fa-solid fa-dice",
        default: true,
        callback: (event, button, dialog) => {
          const form = button.form ?? dialog.element.querySelector("form");
          return context.tests.get(form.elements.opposedTest?.value) ?? null;
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

export async function startOpposedRoll(activeMessage, activeState) {
  if (!activeState || activeState.canOppose === false) return null;
  const selection = await chooseOpposition(activeState);
  if (!selection) return null;

  const opponentMessage = selection.kind === "skill"
    ? await selection.actor.rollSkill(selection.key, {
      canPush: false,
      canOppose: false,
      excludedHelperUuids: [activeState.actorUuid]
    })
    : await selection.actor.rollAttribute(selection.key, {
      canPush: false,
      canOppose: false,
      excludedHelperUuids: [activeState.actorUuid]
    });
  if (!opponentMessage) return null;

  const opponentState = opponentMessage.getFlag(SYSTEM_ID, PUSH_FLAG);
  if (!opponentState) throw new Error("The opposition roll has no YZE roll state.");

  return linkOpposedRolls(activeMessage, activeState, opponentMessage, opponentState);
}

/** Link a preselected defensive roll to an active roll, such as a Block reaction. */
export async function linkOpposedRolls(activeMessage, activeState, opponentMessage, opponentState) {
  if (!activeMessage || !activeState || !opponentMessage || !opponentState) return null;
  const resultMessage = await ChatMessage.create({
    speaker: activeMessage.speaker,
    content: comparisonContent(activeState, opponentState),
    flags: {
      [SYSTEM_ID]: {
        [OPPOSED_FLAG]: {
          activeMessageId: activeMessage.id,
          opponentMessageId: opponentMessage.id
        }
      }
    }
  });
  const link = {
    opponentMessageId: opponentMessage.id,
    resultMessageId: resultMessage.id
  };
  await activeMessage.setFlag(SYSTEM_ID, OPPOSED_FLAG, link);
  return resultMessage;
}

export async function refreshOpposedAfterPush(originalMessage, pushedMessage, pushedState) {
  const link = originalMessage.getFlag(SYSTEM_ID, OPPOSED_FLAG);
  if (!link?.opponentMessageId) return null;

  const opponentMessage = game.messages?.get(link.opponentMessageId);
  const opponentState = opponentMessage?.getFlag(SYSTEM_ID, PUSH_FLAG);
  if (!opponentState) return null;

  const resultMessage = game.messages?.get(link.resultMessageId);
  if (resultMessage) {
    await resultMessage.update({
      content: comparisonContent(pushedState, opponentState, { updated: true }),
      [`flags.${SYSTEM_ID}.${OPPOSED_FLAG}.activeMessageId`]: pushedMessage.id
    });
  }
  await pushedMessage.setFlag(SYSTEM_ID, OPPOSED_FLAG, link);
  return resultMessage ?? null;
}

export function registerOpposedChatHook() {
  Hooks.on("renderChatMessageHTML", (message, html) => {
    const root = html?.querySelector ? html : html?.[0];
    const button = root?.querySelector?.('[data-action="opposeRoll"]');
    if (!button) return;

    const state = message.getFlag(SYSTEM_ID, PUSH_FLAG);
    const linked = message.getFlag(SYSTEM_ID, OPPOSED_FLAG);
    if (!state || state.canOppose === false || state.superseded || linked?.opponentMessageId) {
      button.disabled = true;
      if (state?.superseded) {
        button.textContent = game.i18n.localize("YZE.Opposed.UsePushedResult");
      } else if (linked?.opponentMessageId) {
        button.textContent = game.i18n.localize("YZE.Opposed.Completed");
      }
      return;
    }

    button.addEventListener("click", async () => {
      const isAuthor = message.author?.id === game.user.id;
      if (!isAuthor && !game.user?.isGM) {
        ui.notifications.warn(game.i18n.localize("YZE.Opposed.NotAllowed"));
        return;
      }
      button.disabled = true;
      try {
        const current = message.getFlag(SYSTEM_ID, PUSH_FLAG);
        if (!current || current.superseded) return;
        await startOpposedRoll(message, current);
      } catch (error) {
        console.error("YZE System Toolkit | Opposed roll failed", error);
        ui.notifications.error(game.i18n.localize("YZE.Opposed.Failed"));
      } finally {
        if (!message.getFlag(SYSTEM_ID, OPPOSED_FLAG)) button.disabled = false;
      }
    });
  });
}
