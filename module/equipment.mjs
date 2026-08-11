import { CONSUMABLE_MODES, SYSTEM_ID } from "./constants.mjs";
import { getConsumableMode } from "./settings.mjs";

function escape(value) {
  return foundry.utils.escapeHTML(String(value));
}

function canUpdate(actor) {
  return Boolean(actor) && (actor.isOwner !== false || game.user?.isGM === true);
}

function supplyItem(actor, itemId) {
  const item = actor?.items?.get(itemId);
  return item?.type === "consumable" ? item : null;
}

function activeResults(roll) {
  return roll.dice.flatMap((die) => die.results ?? []).filter((result) => result.active !== false);
}

/** Make a general SRD Supply roll and automatically expend one step per bane. */
export async function rollConsumableSupply(actor, itemId) {
  if (getConsumableMode() !== CONSUMABLE_MODES.SUPPLY) return null;
  const item = supplyItem(actor, itemId);
  if (!item || !canUpdate(actor)) return null;
  const current = Math.max(0, Math.trunc(Number(item.system.supply) || 0));
  if (current < 1) {
    ui.notifications.warn(game.i18n.format("YZE.Supply.Empty", { supply: item.name }));
    return null;
  }

  const dice = Math.min(6, current);
  const roll = await new Roll(`${dice}d6`).evaluate();
  const banes = activeResults(roll).filter((result) => Number(result.result) === 1).length;
  const remaining = Math.max(0, current - banes);
  await item.update({ "system.supply": remaining });
  const resultKey = banes === 1 ? "YZE.Supply.ResultOne" : "YZE.Supply.Result";
  return roll.toMessage({
    speaker: ChatMessage.getSpeaker({ actor }),
    flavor: `<div class="yze chat-card yze-supply-card">
      <h3>${escape(game.i18n.format("YZE.Supply.RollTitle", { supply: item.name }))}</h3>
      <p>${escape(game.i18n.format(resultKey, { supply: item.name, dice, banes, remaining }))}</p>
    </div>`,
    flags: { [SYSTEM_ID]: { supplyRoll: { actorUuid: actor.uuid, itemId, dice, banes, remaining } } }
  });
}

async function transferAmount(item, target) {
  const maximum = Math.max(0, Math.trunc(Number(item.system.supply) || 0));
  const { DialogV2 } = foundry.applications.api;
  return DialogV2.wait({
    window: { title: game.i18n.localize("YZE.Supply.TransferTitle") },
    content: `<div class="yze yze-damage-dialog">
      <p>${escape(game.i18n.format("YZE.Supply.TransferHint", {
        supply: item.name, target: target.name, maximum
      }))}</p>
      <div class="form-group">
        <label>${escape(game.i18n.localize("YZE.Supply.TransferAmount"))}</label>
        <input name="amount" type="number" value="1" min="1" max="${maximum}" step="1">
      </div>
    </div>`,
    buttons: [
      {
        action: "transfer",
        label: game.i18n.localize("YZE.Supply.Transfer"),
        icon: "fa-solid fa-arrow-right-arrow-left",
        default: true,
        callback: (event, button, dialog) => {
          const form = button.form ?? dialog.element.querySelector("form");
          return Math.min(maximum, Math.max(1, Math.trunc(Number(form.elements.amount?.value) || 1)));
        }
      },
      { action: "cancel", label: game.i18n.localize("YZE.Common.Cancel"), callback: () => null }
    ],
    close: () => null,
    rejectClose: false,
    modal: true
  });
}

/** Transfer Supply steps to a matching Consumable on one targeted Actor. */
export async function transferConsumableSupply(actor, itemId) {
  if (getConsumableMode() !== CONSUMABLE_MODES.SUPPLY) return null;
  const item = supplyItem(actor, itemId);
  if (!item || !canUpdate(actor)) return null;
  if (Number(item.system.supply) < 1) {
    ui.notifications.warn(game.i18n.format("YZE.Supply.Empty", { supply: item.name }));
    return null;
  }
  const targets = [...(game.user?.targets ?? [])].filter((token) => token.actor);
  if (targets.length !== 1 || targets[0].actor === actor) {
    ui.notifications.warn(game.i18n.localize("YZE.Supply.SelectOneRecipient"));
    return null;
  }
  const target = targets[0].actor;
  if (target.type === "vehicle" || !canUpdate(target)) {
    ui.notifications.warn(game.i18n.localize("YZE.Supply.CannotUpdateRecipient"));
    return null;
  }
  const amount = await transferAmount(item, target);
  if (!amount) return null;

  let recipient = target.items.find((candidate) => (
    candidate.type === "consumable"
    && candidate.name.localeCompare(item.name, undefined, { sensitivity: "base" }) === 0
  ));
  if (!recipient) {
    const source = item.toObject();
    delete source._id;
    delete source.folder;
    source.system.supply = 0;
    [recipient] = await target.createEmbeddedDocuments("Item", [source]);
  }
  const donorBefore = Math.max(0, Math.trunc(Number(item.system.supply) || 0));
  const recipientBefore = Math.max(0, Math.trunc(Number(recipient.system.supply) || 0));
  const moved = Math.min(donorBefore, amount);
  await item.update({ "system.supply": donorBefore - moved });
  try {
    await recipient.update({ "system.supply": recipientBefore + moved });
  } catch (error) {
    await item.update({ "system.supply": donorBefore });
    throw error;
  }
  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    content: `<div class="yze chat-card yze-supply-card"><p>${escape(game.i18n.format(
      "YZE.Supply.Transferred",
      { donor: actor.name, recipient: target.name, supply: item.name, amount: moved }
    ))}</p></div>`
  });
  return { donor: item, recipient, amount: moved };
}
