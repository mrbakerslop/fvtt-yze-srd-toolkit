import { SYSTEM_ID } from "./constants.mjs";
import {
  canSpendActorActions,
  combatActionState,
  spendActorActions
} from "./combat.mjs";
import {
  getActorBrokenState,
  getCriticalInjuryRestrictions
} from "./critical-injuries.mjs";
import { isActorCatatonic } from "./panic.mjs";

const SOCKET = `system.${SYSTEM_ID}`;
const MAX_HELPERS = 3;
const pendingRequests = new Map();

function primaryActiveGM() {
  return game.users?.filter((user) => user.active && user.isGM)
    .sort((left, right) => Number(right.role) - Number(left.role)
      || left.id.localeCompare(right.id))[0] ?? null;
}

function sameActor(left, right) {
  if (!left || !right) return false;
  return left.uuid === right.uuid || (!left.isToken && !right.isToken && left.id === right.id);
}

function currentSceneId() {
  return globalThis.canvas?.scene?.id ?? game.scenes?.current?.id ?? "";
}

function sceneActors(sceneId = currentSceneId()) {
  const viewedScene = globalThis.canvas?.scene;
  const scene = sceneId ? game.scenes?.get?.(sceneId) : game.scenes?.current;
  if (!scene) return [];
  const tokens = globalThis.canvas?.ready && viewedScene?.id === sceneId
    ? globalThis.canvas.tokens?.placeables?.map((token) => token.actor) ?? []
    : [...(scene?.tokens ?? [])].map((token) => token.actor);
  return tokens.filter(Boolean);
}

function mechanicallyCapable(actor) {
  return actor && ["character", "npc"].includes(actor.type)
    && actor.system?.dead !== true
    && !getActorBrokenState(actor).broken
    && !isActorCatatonic(actor)
    && !getCriticalInjuryRestrictions(actor).blocksActions;
}

/** Return mechanically eligible Actors which share the rolling Actor's active Scene. */
export function helperCandidates(actor, {
  excludeUuids = [],
  sceneId = currentSceneId()
} = {}) {
  const present = sceneActors(sceneId);
  if (!present.some((candidate) => sameActor(candidate, actor))) return [];
  const excluded = new Set(excludeUuids.filter(Boolean));
  const rollerInCombat = combatActionState(actor).active;
  const unique = new Map();
  for (const helper of present) {
    if (sameActor(helper, actor) || excluded.has(helper.uuid)
      || helper.visible === false || !mechanicallyCapable(helper)) continue;
    if (unique.has(helper.uuid)) continue;
    const actions = combatActionState(helper);
    unique.set(helper.uuid, {
      actor: helper,
      uuid: helper.uuid,
      name: helper.name,
      sceneId,
      inCombat: actions.active,
      canFast: !rollerInCombat || (actions.active && canSpendActorActions(helper, { fast: 1 })),
      canSlow: !rollerInCombat || (actions.active && canSpendActorActions(helper, { slow: 1 }))
    });
  }
  return [...unique.values()].sort((left, right) => left.name.localeCompare(right.name));
}

function actionCost(actionType) {
  return actionType === "fast" ? { fast: 1 }
    : actionType === "slow" ? { slow: 1 }
      : null;
}

function failure(key, data = {}) {
  return { ok: false, key, data };
}

async function spendLocally(roller, helperUuids, actionType, sceneId) {
  const candidates = new Map(helperCandidates(roller, { sceneId })
    .map((entry) => [entry.uuid, entry]));
  const selected = [...new Set(helperUuids)].slice(0, MAX_HELPERS)
    .map((uuid) => candidates.get(uuid));
  if (selected.length !== helperUuids.length || selected.some((entry) => !entry)) {
    return failure("YZE.Helping.HelperUnavailable");
  }
  const rollerInCombat = combatActionState(roller).active;
  if (!rollerInCombat) return { ok: true };
  const cost = actionCost(actionType);
  if (!cost) return failure("YZE.Helping.ActionTypeRequired");
  const unavailable = selected.find((entry) => (
    !entry.inCombat || !canSpendActorActions(entry.actor, cost)
  ));
  if (unavailable) {
    return failure("YZE.Helping.NotEnoughActions", { helper: unavailable.name });
  }
  try {
    for (const entry of selected) {
      if (!await spendActorActions(entry.actor, cost)) {
        return failure("YZE.Helping.NotEnoughActions", { helper: entry.name });
      }
    }
  } catch (error) {
    console.error("YZE System Toolkit | Could not spend helper actions", error);
    return failure("YZE.Helping.ActionSpendFailed");
  }
  return { ok: true };
}

function notifyFailure(result) {
  if (result?.ok !== false) return;
  ui.notifications.warn(game.i18n.format(result.key, result.data ?? {}));
}

async function requestGMSpend(roller, helperUuids, actionType, sceneId, gm) {
  const requestId = foundry.utils.randomID();
  const result = new Promise((resolve) => {
    const timeout = setTimeout(() => {
      pendingRequests.delete(requestId);
      resolve(failure("YZE.Helping.GMTimeout"));
    }, 10000);
    pendingRequests.set(requestId, (response) => {
      clearTimeout(timeout);
      pendingRequests.delete(requestId);
      resolve(response);
    });
  });
  game.socket.emit(SOCKET, {
    action: "spendHelperActions",
    requestId,
    requesterId: game.user.id,
    gmId: gm.id,
    rollerUuid: roller.uuid,
    helperUuids,
    actionType,
    sceneId
  });
  return result;
}

/** Validate selected helpers and spend their matching combat actions before the roll. */
export async function spendHelperActions(roller, helpers = [], actionType = "") {
  const helperUuids = [...new Set(helpers.map((helper) => helper.uuid).filter(Boolean))];
  if (helperUuids.length === 0) return true;
  if (helperUuids.length > MAX_HELPERS) {
    notifyFailure(failure("YZE.Helping.TooManyHelpers", { maximum: MAX_HELPERS }));
    return false;
  }
  const sceneIds = [...new Set(helpers.map((helper) => helper.sceneId).filter(Boolean))];
  if (sceneIds.length !== 1) {
    notifyFailure(failure("YZE.Helping.HelperUnavailable"));
    return false;
  }
  const sceneId = sceneIds[0];

  let result;
  const gm = primaryActiveGM();
  if (game.user.isGM || !combatActionState(roller).active) {
    result = await spendLocally(roller, helperUuids, actionType, sceneId);
  } else if (gm) {
    result = await requestGMSpend(roller, helperUuids, actionType, sceneId, gm);
  } else {
    const selected = helperUuids.map((uuid) => helperCandidates(roller, { sceneId })
      .find((entry) => entry.uuid === uuid)?.actor).filter(Boolean);
    result = selected.every((actor) => actor.isOwner !== false)
      ? await spendLocally(roller, helperUuids, actionType, sceneId)
      : failure("YZE.Helping.GMRequired");
  }
  notifyFailure(result);
  return result?.ok === true;
}

/** Render selected helper names on initial and pushed roll cards. */
export function renderHelpingSummary(helpers = [], actionType = "") {
  if (!Array.isArray(helpers) || helpers.length === 0) return "";
  const action = ["fast", "slow"].includes(actionType)
    ? game.i18n.localize(`YZE.Helping.Actions.${actionType}`)
    : game.i18n.localize("YZE.Helping.NoActionCost");
  return `<p class="yze-helping-summary">${foundry.utils.escapeHTML(game.i18n.format(
    "YZE.Helping.ChatSummary", {
      helpers: helpers.map((helper) => helper.name).join(", "),
      action
    }
  ))}</p>`;
}

async function handleSocket(data) {
  if (!data || typeof data !== "object") return;
  if (data.action === "helperActionsResult" && data.requesterId === game.user.id) {
    pendingRequests.get(data.requestId)?.(data.result);
    return;
  }
  if (data.action !== "spendHelperActions" || !game.user.isGM
    || primaryActiveGM()?.id !== game.user.id || data.gmId !== game.user.id) return;
  const requester = game.users.get(data.requesterId);
  const roller = typeof fromUuid === "function" ? await fromUuid(data.rollerUuid) : null;
  const authorized = requester?.active && roller
    && (requester.isGM || roller.testUserPermission?.(requester, "OWNER") === true);
  const result = authorized
    ? await spendLocally(
      roller,
      Array.isArray(data.helperUuids) ? data.helperUuids : [],
      data.actionType,
      data.sceneId
    )
    : failure("YZE.Helping.HelperUnavailable");
  game.socket.emit(SOCKET, {
    action: "helperActionsResult",
    requestId: data.requestId,
    requesterId: data.requesterId,
    result
  });
}

export function registerHelpingHooks() {
  Hooks.once("ready", () => game.socket?.on(SOCKET, (data) => {
    handleSocket(data).catch((error) => {
      console.error("YZE System Toolkit | Helping socket request failed", error);
    });
  }));
}

export { MAX_HELPERS };
