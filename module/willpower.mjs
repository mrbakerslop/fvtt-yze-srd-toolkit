import { SYSTEM_ID } from "./constants.mjs";
import { isWillpowerEnabled } from "./settings.mjs";

function wholeNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.trunc(number)) : 0;
}

function escape(value) {
  return foundry.utils.escapeHTML(String(value));
}

export async function consumeTemporaryWillpower(actor, amount) {
  let remaining = wholeNumber(amount);
  if (!actor || remaining < 1) return 0;
  const effects = actor.getFlag?.(SYSTEM_ID, "magicEffects");
  if (!Array.isArray(effects)) return 0;
  const next = foundry.utils.deepClone(effects);
  for (const effect of next
    .filter((entry) => entry.kind === "temporary-resource"
      && entry.resource === "willpower" && wholeNumber(entry.resourceGrant) > 0)
    .sort((left, right) => Number(left.endsAt || Number.POSITIVE_INFINITY) - Number(right.endsAt || Number.POSITIVE_INFINITY))) {
    const spent = Math.min(remaining, wholeNumber(effect.resourceGrant));
    effect.resourceGrant = wholeNumber(effect.resourceGrant) - spent;
    remaining -= spent;
    if (remaining < 1) break;
  }
  const consumed = wholeNumber(amount) - remaining;
  if (consumed > 0) await actor.setFlag(SYSTEM_ID, "magicEffects", next);
  return consumed;
}

export async function adjustWillpower(actor, delta, { reason = "", announce = true } = {}) {
  if (!isWillpowerEnabled() || !actor || actor.type === "vehicle") return false;
  if (actor.isOwner === false && game.user?.isGM !== true) {
    ui.notifications.warn(game.i18n.localize("YZE.Willpower.NotAllowed"));
    return false;
  }
  const previous = wholeNumber(actor.system?.resources?.willpower?.value);
  const maximum = wholeNumber(actor.system?.resources?.willpower?.max) || 99;
  const current = Math.min(maximum, Math.max(0, previous + Math.trunc(Number(delta) || 0)));
  if (current === previous) return false;
  await actor.update({ "system.resources.willpower.value": current });
  if (current < previous) await consumeTemporaryWillpower(actor, previous - current);
  if (announce) {
    await ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor }),
      content: `
        <div class="yze chat-card yze-willpower-card">
          <h3>${escape(game.i18n.localize("YZE.Willpower.Title"))}</h3>
          <p>${escape(game.i18n.format(
            current > previous ? "YZE.Willpower.Gained" : "YZE.Willpower.Spent",
            { actor: actor.name, amount: Math.abs(current - previous), total: current }
          ))}</p>
          ${reason ? `<p class="hint">${escape(reason)}</p>` : ""}
        </div>`
    });
  }
  return true;
}

export async function promptWillpowerChange(actor, mode) {
  const spending = mode === "spend";
  const current = wholeNumber(actor?.system?.resources?.willpower?.value);
  if (spending && current === 0) {
    ui.notifications.info(game.i18n.localize("YZE.Willpower.NoneToSpend"));
    return false;
  }
  const maximum = spending ? current : 99;
  const { DialogV2 } = foundry.applications.api;
  const result = await DialogV2.wait({
    window: {
      title: game.i18n.localize(spending ? "YZE.Willpower.SpendTitle" : "YZE.Willpower.GainTitle")
    },
    content: `
      <div class="yze yze-resource-dialog">
        <div class="form-group">
          <label>${escape(game.i18n.localize("YZE.Common.Amount"))}</label>
          <input type="number" name="amount" value="1" min="1" max="${maximum}" step="1">
        </div>
        <div class="form-group">
          <label>${escape(game.i18n.localize("YZE.Common.Reason"))}</label>
          <input type="text" name="reason" value="">
        </div>
      </div>`,
    buttons: [
      {
        action: "apply",
        label: game.i18n.localize(spending ? "YZE.Willpower.SpendButton" : "YZE.Willpower.GainButton"),
        icon: spending ? "fa-solid fa-minus" : "fa-solid fa-plus",
        default: true,
        callback: (event, button, dialog) => {
          const form = button.form ?? dialog.element.querySelector("form");
          return {
            amount: Math.min(maximum, Math.max(1, wholeNumber(form.elements.amount?.value))),
            reason: String(form.elements.reason?.value ?? "").trim()
          };
        }
      },
      { action: "cancel", label: game.i18n.localize("YZE.Common.Cancel"), callback: () => null }
    ],
    close: () => null,
    rejectClose: false,
    modal: true
  });
  if (!result) return false;
  return adjustWillpower(actor, spending ? -result.amount : result.amount, {
    reason: result.reason
  });
}
