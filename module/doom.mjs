import { SYSTEM_ID } from "./constants.mjs";
import { isDoomPointsEnabled } from "./settings.mjs";
import { worldDoomExpenditures } from "./item-effects.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;
const SOCKET = `system.${SYSTEM_ID}`;
const DOOM_PANEL_ID = "yze-doom-panel";
const handledRequests = new Set();
const handledPushes = new Set();

function wholeNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.trunc(number)) : 0;
}

function escape(value) {
  return foundry.utils.escapeHTML(String(value));
}

function isWorldGameMaster(user) {
  return Number(user?.role ?? CONST.USER_ROLES.NONE) >= CONST.USER_ROLES.GAMEMASTER;
}

function primaryActiveGM() {
  return game.users?.filter((user) => user.active && isWorldGameMaster(user))
    .sort((a, b) => a.id.localeCompare(b.id))[0] ?? null;
}

function doomRoleLabelKey(role) {
  if (role >= CONST.USER_ROLES.GAMEMASTER) return "YZE.Settings.DoomManagerRole.GameMaster";
  if (role >= CONST.USER_ROLES.ASSISTANT) return "YZE.Settings.DoomManagerRole.Assistant";
  return "YZE.Settings.DoomManagerRole.Trusted";
}

export function getDoomManagerRole() {
  const configured = Number(game.settings.get(SYSTEM_ID, "doomManagerRole"));
  const allowed = [
    CONST.USER_ROLES.TRUSTED,
    CONST.USER_ROLES.ASSISTANT,
    CONST.USER_ROLES.GAMEMASTER
  ];
  return allowed.includes(configured) ? configured : CONST.USER_ROLES.GAMEMASTER;
}

export function canManageDoom(user = game.user) {
  return isDoomPointsEnabled()
    && Number(user?.role ?? CONST.USER_ROLES.NONE) >= getDoomManagerRole();
}

export function getDoomPoints() {
  return wholeNumber(game.settings.get(SYSTEM_ID, "doomPoints"));
}

async function announceDoom(previous, current, reason = "", kind = null) {
  const change = current - previous;
  const messageKey = kind === "reset"
    ? "YZE.Doom.Reset"
    : change > 0 ? "YZE.Doom.Gained" : "YZE.Doom.Spent";
  await ChatMessage.create({
    content: `
      <div class="yze chat-card yze-doom-card">
        <h3>${escape(game.i18n.localize("YZE.Doom.Title"))}</h3>
        <p>${escape(game.i18n.format(
          messageKey,
          { amount: Math.abs(change), total: current }
        ))}</p>
        ${reason ? `<p class="hint">${escape(reason)}</p>` : ""}
      </div>`
  });
}

async function commitDoom(delta, { reason = "", announce = true, kind = null } = {}) {
  const previous = getDoomPoints();
  const current = kind === "reset"
    ? 0
    : Math.max(0, previous + Math.trunc(Number(delta) || 0));
  if (current === previous) return false;
  await game.settings.set(SYSTEM_ID, "doomPoints", current);
  if (announce) await announceDoom(previous, current, reason, kind);
  return true;
}

function requestDoomManagement(action, { delta = 0, reason = "", announce = true } = {}) {
  const gm = primaryActiveGM();
  if (!gm) {
    ui.notifications.warn(game.i18n.localize("YZE.Doom.NoActiveGM"));
    return false;
  }
  game.socket.emit(SOCKET, {
    type: "manageDoom",
    requestId: foundry.utils.randomID(),
    userId: game.user.id,
    action,
    delta: Math.trunc(Number(delta) || 0),
    reason: String(reason).trim().slice(0, 500),
    announce: announce !== false
  });
  return true;
}

export async function adjustDoom(delta, { reason = "", announce = true } = {}) {
  if (!isDoomPointsEnabled()) return false;
  if (!canManageDoom()) {
    ui.notifications.warn(game.i18n.localize("YZE.Doom.RoleRequired"));
    return false;
  }
  const change = Math.trunc(Number(delta) || 0);
  if (!change) return false;
  if (isWorldGameMaster(game.user)) return commitDoom(change, { reason, announce });
  return requestDoomManagement("adjust", { delta: change, reason, announce });
}

export async function spendDoom(cost, { reason = "", announce = true } = {}) {
  if (!isDoomPointsEnabled()) {
    ui.notifications.info(game.i18n.localize("YZE.Doom.Disabled"));
    return false;
  }
  if (!canManageDoom()) {
    ui.notifications.warn(game.i18n.localize("YZE.Doom.RoleRequired"));
    return false;
  }
  const amount = wholeNumber(cost);
  if (amount < 1 || getDoomPoints() < amount) {
    ui.notifications.warn(game.i18n.localize("YZE.Doom.NotEnough"));
    return false;
  }
  if (isWorldGameMaster(game.user)) return commitDoom(-amount, { reason, announce });
  return requestDoomManagement("spendExact", { delta: -amount, reason, announce });
}

export async function resetDoom() {
  if (!isDoomPointsEnabled()) return false;
  if (!canManageDoom()) {
    ui.notifications.warn(game.i18n.localize("YZE.Doom.RoleRequired"));
    return false;
  }
  const previous = getDoomPoints();
  if (previous === 0) return false;
  const confirmed = await foundry.applications.api.DialogV2.confirm({
    window: { title: game.i18n.localize("YZE.Doom.ResetTitle") },
    content: `<div class="yze"><p>${escape(game.i18n.localize("YZE.Doom.ResetConfirm"))}</p></div>`,
    yes: { label: game.i18n.localize("YZE.Doom.ResetButton") },
    no: { label: game.i18n.localize("YZE.Common.Cancel") },
    rejectClose: false,
    modal: true
  });
  if (!confirmed) return false;
  if (isWorldGameMaster(game.user)) return commitDoom(0, { kind: "reset" });
  return requestDoomManagement("reset");
}

export async function promptDoomChange(mode) {
  if (!canManageDoom()) {
    ui.notifications.warn(game.i18n.localize("YZE.Doom.RoleRequired"));
    return false;
  }
  const spending = mode === "spend";
  const maximum = spending ? getDoomPoints() : 99;
  if (spending && maximum === 0) {
    ui.notifications.info(game.i18n.localize("YZE.Doom.NoneToSpend"));
    return false;
  }
  const { DialogV2 } = foundry.applications.api;
  const result = await DialogV2.wait({
    window: { title: game.i18n.localize(spending ? "YZE.Doom.SpendTitle" : "YZE.Doom.GainTitle") },
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
        label: game.i18n.localize(spending ? "YZE.Doom.SpendButton" : "YZE.Doom.GainButton"),
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
  return adjustDoom(spending ? -result.amount : result.amount, { reason: result.reason });
}

export async function gainDoomFromPush(state) {
  if (!isDoomPointsEnabled()) return false;
  if (state?.sourceMessageId && handledPushes.has(state.sourceMessageId)) return false;
  if (isWorldGameMaster(game.user)) {
    if (state?.sourceMessageId) handledPushes.add(state.sourceMessageId);
    return commitDoom(1, {
      reason: game.i18n.format("YZE.Doom.PushReason", { actor: state.actorName ?? "—" }),
      announce: false
    });
  }
  const gm = primaryActiveGM();
  if (!gm) {
    ui.notifications.warn(game.i18n.localize("YZE.Doom.NoActiveGM"));
    return false;
  }
  game.socket.emit(SOCKET, {
    type: "gainDoomFromPush",
    requestId: foundry.utils.randomID(),
    userId: game.user.id,
    actorUuid: state.actorUuid,
    actorName: state.actorName,
    label: state.label,
    sourceMessageId: state.sourceMessageId
  });
  return false;
}

async function handlePushRequest(data, user) {
  const source = game.messages?.get(data.sourceMessageId);
  const push = source?.getFlag(SYSTEM_ID, "push");
  if (!user?.active || !isDoomPointsEnabled()
    || !source || source.author?.id !== user.id
    || !push || push.actorUuid !== data.actorUuid
    || handledPushes.has(data.sourceMessageId)) return;
  handledPushes.add(data.sourceMessageId);
  await commitDoom(1, {
    reason: game.i18n.format("YZE.Doom.PushReason", { actor: data.actorName ?? "—" }),
    announce: false
  });
}

async function handleManagementRequest(data, user) {
  if (!user?.active || !canManageDoom(user)) return;
  if (data.action === "reset") {
    await commitDoom(0, { kind: "reset" });
    return;
  }
  if (!["adjust", "spendExact"].includes(data.action)) return;
  const delta = Math.trunc(Number(data.delta) || 0);
  if (!delta || Math.abs(delta) > 99) return;
  if (data.action === "spendExact" && (delta >= 0 || getDoomPoints() < Math.abs(delta))) return;
  await commitDoom(delta, {
    reason: String(data.reason ?? "").trim().slice(0, 500),
    announce: data.announce !== false
  });
}

async function handleSocketRequest(data) {
  if (!isWorldGameMaster(game.user) || primaryActiveGM()?.id !== game.user.id
    || !data?.requestId || handledRequests.has(data.requestId)) return;
  const user = game.users?.get(data.userId);
  if (data.type === "gainDoomFromPush") await handlePushRequest(data, user);
  else if (data.type === "manageDoom") await handleManagementRequest(data, user);
  else return;
  handledRequests.add(data.requestId);
  if (handledRequests.size > 1000) handledRequests.clear();
}

export class YZEDoomPanel extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: DOOM_PANEL_ID,
    classes: ["yze", "doom-pool-panel"],
    position: { width: 420, height: 520 },
    window: {
      title: "YZE.Doom.Title",
      icon: "fa-solid fa-skull",
      resizable: true
    },
    actions: {
      gainDoom: this._onGainDoom,
      spendDoom: this._onSpendDoom,
      resetDoom: this._onResetDoom,
      useExpenditure: this._onUseExpenditure
    }
  };

  static PARTS = {
    main: { template: `systems/${SYSTEM_ID}/templates/doom-panel.hbs` }
  };

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const managerRole = getDoomManagerRole();
    const doomPoints = getDoomPoints();
    return {
      ...context,
      doomPoints,
      canManage: canManageDoom(),
      managerRoleLabel: game.i18n.localize(doomRoleLabelKey(managerRole)),
      expenditures: worldDoomExpenditures().map((effect) => {
        const cost = Math.max(1, Math.min(99, Math.trunc(Number(effect.value) || 1)));
        return {
          itemId: effect.item.id,
          effectId: effect.id,
          itemName: effect.item.name,
          name: String(effect.label || effect.item.name),
          description: String(effect.description || ""),
          cost,
          canUse: canManageDoom() && doomPoints >= cost
        };
      })
    };
  }

  static async _onGainDoom() {
    await promptDoomChange("gain");
  }

  static async _onSpendDoom() {
    await promptDoomChange("spend");
  }

  static async _onResetDoom() {
    await resetDoom();
  }

  static async _onUseExpenditure(event, target) {
    const item = game.items?.get(target.dataset.itemId);
    if (!item) return;
    const { promptResourceEffect } = await import("./resource-effects.mjs");
    await promptResourceEffect(null, item, { effectId: target.dataset.effectId });
  }
}

export function openDoomPanel() {
  if (!isDoomPointsEnabled()) {
    ui.notifications.info(game.i18n.localize("YZE.Doom.Disabled"));
    return null;
  }
  const existing = foundry.applications.instances.get(DOOM_PANEL_ID);
  if (existing) {
    existing.render({ force: true });
    existing.bringToFront?.();
    return existing;
  }
  const panel = new YZEDoomPanel();
  panel.render({ force: true });
  return panel;
}

export function registerDoomHooks() {
  Hooks.on("getSceneControlButtons", (controls) => {
    if (!isDoomPointsEnabled() || !controls.tokens?.tools) return;
    controls.tokens.tools.yzeDoomPool = {
      name: "yzeDoomPool",
      title: game.i18n.localize("YZE.Doom.OpenPanel"),
      icon: "fa-solid fa-skull",
      order: Object.keys(controls.tokens.tools).length,
      button: true,
      visible: true,
      onChange: () => openDoomPanel()
    };
  });

  Hooks.once("ready", () => game.socket?.on(SOCKET, (data) => {
    handleSocketRequest(data).catch((error) => {
      console.error("YZE System Toolkit | Doom socket request failed", error);
    });
  }));

  Hooks.on("updateSetting", (setting) => {
    if (![`${SYSTEM_ID}.doomPoints`, `${SYSTEM_ID}.doomManagerRole`].includes(setting?.key)) return;
    foundry.applications.instances.get(DOOM_PANEL_ID)?.render({ force: false });
  });

  for (const hook of ["createItem", "updateItem", "deleteItem"]) {
    Hooks.on(hook, () => foundry.applications.instances.get(DOOM_PANEL_ID)?.render({ force: false }));
  }
}
