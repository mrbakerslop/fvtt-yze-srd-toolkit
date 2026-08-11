import { ITEM_EFFECT_TYPES, itemEffects } from "./item-effects.mjs";
import { canManageDoom, spendDoom } from "./doom.mjs";
import { isDoomPointsEnabled, isWillpowerEnabled } from "./settings.mjs";
import { adjustWillpower } from "./willpower.mjs";

function escape(value) {
  return foundry.utils.escapeHTML(String(value ?? ""));
}

function costOf(effect) {
  return Math.max(1, Math.min(99, Math.trunc(Number(effect?.value) || 1)));
}

function effectName(item, effect) {
  return String(effect?.label || item?.name || game.i18n.localize("YZE.ResourceEffects.Title")).trim();
}

function rawWorldEffects(item) {
  if (!item || item.parent) return [];
  return (item.system.effects ?? [])
    .filter((effect) => effect.active !== false
      && effect.type === ITEM_EFFECT_TYPES.DOOM_EXPENDITURE)
    .map((effect, index) => ({
      ...effect,
      id: effect.id || `${item.id}-${index}`,
      item
    }));
}

export function resourceActivationEffects(actor, item) {
  if (actor && item?.parent !== actor && item?.parent?.uuid !== actor.uuid) return [];
  const effects = actor ? itemEffects(item) : rawWorldEffects(item);
  return effects.filter((effect) => {
    if (effect.type === ITEM_EFFECT_TYPES.WILLPOWER_ACTIVATION) {
      return Boolean(actor) && isWillpowerEnabled()
        && actor.type !== "vehicle" && (actor.isOwner !== false || game.user?.isGM === true);
    }
    if (effect.type === ITEM_EFFECT_TYPES.DOOM_EXPENDITURE) {
      return isDoomPointsEnabled() && canManageDoom();
    }
    return false;
  });
}

async function announceWillpowerActivation(actor, item, effect, cost) {
  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    content: `<div class="yze chat-card yze-resource-effect-card">
      <h3>${escape(effectName(item, effect))}</h3>
      <p>${escape(game.i18n.format("YZE.ResourceEffects.WillpowerActivated", {
        actor: actor.name,
        cost
      }))}</p>
      ${effect.description ? `<p>${escape(effect.description)}</p>` : ""}
      <p class="hint">${escape(item.name)}</p>
    </div>`
  });
}

export async function activateResourceEffect(actor, item, effectId) {
  const effect = resourceActivationEffects(actor, item)
    .find((entry) => entry.id === effectId);
  if (!effect) {
    ui.notifications.warn(game.i18n.localize("YZE.ResourceEffects.Unavailable"));
    return false;
  }
  const cost = costOf(effect);
  const name = effectName(item, effect);
  if (effect.type === ITEM_EFFECT_TYPES.WILLPOWER_ACTIVATION) {
    const available = Math.max(0, Math.trunc(Number(actor.system.resources.willpower.value) || 0));
    if (available < cost) {
      ui.notifications.warn(game.i18n.localize("YZE.ResourceEffects.NotEnoughWillpower"));
      return false;
    }
    const spent = await adjustWillpower(actor, -cost, { announce: false });
    if (!spent) return false;
    await announceWillpowerActivation(actor, item, effect, cost);
    return true;
  }
  const description = String(effect.description ?? "").trim();
  return spendDoom(cost, {
    reason: description ? `${item.name}: ${name} — ${description}` : `${item.name}: ${name}`
  });
}

export async function promptResourceEffect(actor, item, { effectId = null } = {}) {
  let effects = resourceActivationEffects(actor, item);
  if (effectId) effects = effects.filter((effect) => effect.id === effectId);
  if (effects.length === 0) {
    ui.notifications.warn(game.i18n.localize("YZE.ResourceEffects.Unavailable"));
    return false;
  }
  const options = effects.map((effect) => {
    const resource = effect.type === ITEM_EFFECT_TYPES.WILLPOWER_ACTIVATION
      ? game.i18n.localize("YZE.Actor.Willpower")
      : game.i18n.localize("YZE.Doom.Title");
    return `<option value="${escape(effect.id)}">${escape(effectName(item, effect))} — ${costOf(effect)} ${escape(resource)}</option>`;
  }).join("");
  const summaries = effects.map((effect) => (
    effect.description
      ? `<p><strong>${escape(effectName(item, effect))}:</strong> ${escape(effect.description)}</p>`
      : ""
  )).join("");
  const { DialogV2 } = foundry.applications.api;
  const selected = await DialogV2.wait({
    window: { title: game.i18n.localize("YZE.ResourceEffects.Title") },
    content: `<div class="yze yze-resource-effect-dialog">
      <p>${escape(game.i18n.format("YZE.ResourceEffects.ActivationHint", { item: item.name }))}</p>
      <div class="form-group"><label>${escape(game.i18n.localize("YZE.ResourceEffects.Effect"))}</label><select name="effectId">${options}</select></div>
      ${summaries}
    </div>`,
    buttons: [{
      action: "activate",
      label: game.i18n.localize("YZE.ResourceEffects.Activate"),
      icon: "fa-solid fa-bolt",
      default: true,
      callback: (event, button, dialog) => (
        button.form ?? dialog.element.querySelector("form")
      ).elements.effectId?.value
    }, {
      action: "cancel",
      label: game.i18n.localize("YZE.Common.Cancel"),
      callback: () => null
    }],
    close: () => null,
    rejectClose: false,
    modal: true
  });
  return selected ? activateResourceEffect(actor, item, selected) : false;
}
