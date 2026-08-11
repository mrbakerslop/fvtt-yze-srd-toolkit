import { DICE_SYSTEMS, SYSTEM_ID, getStepRating } from "./constants.mjs";
import { formatStepRatingLabel, getDiceSystem } from "./settings.mjs";
import { countStateSuccesses } from "./dice/successes.mjs";
import {
  getCriticalInjuryRestrictions,
  notifyCriticalInjuryRestriction
} from "./critical-injuries.mjs";
import { mountForRider } from "./mounts.mjs";

export const ZONE_RANGES = Object.freeze(["engaged", "short", "medium", "long", "extreme"]);
export const ZONE_BORDERS = Object.freeze(["open", "doorOpen", "doorClosed", "blocked"]);

const pendingMoves = new Map();

function escape(value) {
  return foundry.utils.escapeHTML(String(value ?? ""));
}

function localize(key) {
  return game.i18n.localize(`YZE.Zones.${key}`);
}

function collectionValues(collection) {
  if (!collection) return [];
  if (Array.isArray(collection)) return collection;
  if (typeof collection.values === "function") return [...collection.values()];
  return [...collection];
}

export function zoneData(region) {
  const stored = region?.getFlag?.(SYSTEM_ID, "zone") ?? {};
  return {
    enabled: stored.enabled === true,
    cluttered: stored.cluttered === true,
    dimlyLit: stored.dimlyLit === true,
    cramped: stored.cramped === true,
    coverLabel: String(stored.coverLabel || ""),
    coverRating: Math.max(0, Math.trunc(Number(stored.coverRating) || 0)),
    coverStepRating: Math.max(0, Math.min(4, Math.trunc(Number(stored.coverStepRating) || 0))),
    notes: String(stored.notes || "")
  };
}

export function isYZEZone(region) {
  return zoneData(region).enabled;
}

export function sceneZones(scene = canvas?.scene) {
  return collectionValues(scene?.regions).filter(isYZEZone);
}

export function zoneConnections(scene = canvas?.scene) {
  const stored = scene?.getFlag?.(SYSTEM_ID, "zoneConnections");
  return Array.isArray(stored) ? stored.filter((entry) => entry?.a && entry?.b && entry.a !== entry.b) : [];
}

function pointInZone(region, point, elevation = 0) {
  try {
    return region.testPoint(point, elevation) === true;
  } catch (_error) {
    try {
      return region.testPoint({ x: point.x, y: point.y, elevation }) === true;
    } catch (_nestedError) {
      return false;
    }
  }
}

function regionArea(region) {
  const bounds = region.bounds ?? region.object?.bounds;
  return Math.max(0, Number(bounds?.width) || 0) * Math.max(0, Number(bounds?.height) || 0);
}

export function zoneAtPoint(scene, point, elevation = 0) {
  return sceneZones(scene)
    .filter((region) => pointInZone(region, point, elevation))
    .sort((left, right) => regionArea(left) - regionArea(right))[0] ?? null;
}

export function tokenCenter(tokenOrDocument, position = null) {
  const document = tokenOrDocument?.document ?? tokenOrDocument;
  if (!position && tokenOrDocument?.center) return { ...tokenOrDocument.center };
  const scene = document?.parent ?? canvas?.scene;
  const size = Number(scene?.grid?.size) || Number(canvas?.grid?.size) || 100;
  const x = Number(position?.x ?? document?.x) || 0;
  const y = Number(position?.y ?? document?.y) || 0;
  return {
    x: x + (Math.max(0.1, Number(position?.width ?? document?.width) || 1) * size / 2),
    y: y + (Math.max(0.1, Number(position?.height ?? document?.height) || 1) * size / 2)
  };
}

export function zoneForToken(tokenOrDocument, position = null) {
  const document = tokenOrDocument?.document ?? tokenOrDocument;
  const scene = document?.parent ?? canvas?.scene;
  return zoneAtPoint(scene, tokenCenter(tokenOrDocument, position), Number(position?.elevation ?? document?.elevation) || 0);
}

function connectionAllows(connection, purpose) {
  const border = ZONE_BORDERS.includes(connection?.border) ? connection.border : "open";
  if (purpose === "range") return true;
  return ["open", "doorOpen"].includes(border);
}

export function zonePath(scene, origin, destination, { purpose = "movement" } = {}) {
  if (!origin || !destination) return null;
  if (origin.id === destination.id) return [origin];
  const regions = new Map(sceneZones(scene).map((region) => [region.id, region]));
  const graph = new Map([...regions.keys()].map((id) => [id, []]));
  for (const connection of zoneConnections(scene)) {
    if (!regions.has(connection.a) || !regions.has(connection.b) || !connectionAllows(connection, purpose)) continue;
    graph.get(connection.a).push(connection.b);
    graph.get(connection.b).push(connection.a);
  }
  const queue = [[origin.id]];
  const visited = new Set([origin.id]);
  while (queue.length) {
    const ids = queue.shift();
    for (const next of graph.get(ids.at(-1)) ?? []) {
      if (visited.has(next)) continue;
      const path = [...ids, next];
      if (next === destination.id) return path.map((id) => regions.get(id));
      visited.add(next);
      queue.push(path);
    }
  }
  return null;
}

function tokenRect(tokenOrDocument) {
  const document = tokenOrDocument?.document ?? tokenOrDocument;
  const scene = document?.parent ?? canvas?.scene;
  const size = Number(scene?.grid?.size) || Number(canvas?.grid?.size) || 100;
  return {
    x: Number(document?.x) || 0,
    y: Number(document?.y) || 0,
    width: Math.max(0.1, Number(document?.width) || 1) * size,
    height: Math.max(0.1, Number(document?.height) || 1) * size
  };
}

function tokensEngaged(source, target) {
  const left = tokenRect(source);
  const right = tokenRect(target);
  const dx = Math.max(0, left.x - (right.x + right.width), right.x - (left.x + left.width));
  const dy = Math.max(0, left.y - (right.y + right.height), right.y - (left.y + left.height));
  const size = Number((source?.document ?? source)?.parent?.grid?.size) || Number(canvas?.grid?.size) || 100;
  return Math.hypot(dx, dy) <= size * 0.2;
}

function wallPathClear(source, target, type = "sight") {
  const sourceObject = source?.object ?? source;
  if (typeof sourceObject?.checkCollision !== "function") return true;
  try {
    return !sourceObject.checkCollision(tokenCenter(target), {
      origin: tokenCenter(source),
      type,
      mode: "any"
    });
  } catch (_error) {
    return true;
  }
}

function zoneLineOfSight(path, scene, source, target) {
  if (!path) return { visible: false, reason: "disconnected" };
  const sightPath = zonePath(scene, path[0], path.at(-1), { purpose: "sight" });
  if (!sightPath) return { visible: false, reason: "border" };
  for (const region of sightPath.slice(1, -1)) {
    const data = zoneData(region);
    if (data.dimlyLit) return { visible: false, reason: "dimTransit" };
    if (data.cramped) {
      const occupied = collectionValues(scene?.tokens).some((token) => (
        token.id !== (source?.document ?? source)?.id
        && token.id !== (target?.document ?? target)?.id
        && zoneForToken(token)?.id === region.id
      ));
      if (occupied) return { visible: false, reason: "crampedTransit" };
    }
  }
  if (!wallPathClear(source, target, "sight")) return { visible: false, reason: "wall" };
  return { visible: true, reason: "" };
}

export function rangeBetweenTokens(source, target, { scene = null } = {}) {
  const sourceDocument = source?.document ?? source;
  const targetDocument = target?.document ?? target;
  scene ??= sourceDocument?.parent ?? targetDocument?.parent ?? canvas?.scene;
  const sourceZone = zoneForToken(source);
  const targetZone = zoneForToken(target);
  if (!scene || !sourceZone || !targetZone) {
    return {
      configured: false, range: null, distance: null, sourceZone, targetZone,
      visible: wallPathClear(source, target, "sight"),
      reachable: wallPathClear(source, target, "move"),
      reason: "unconfigured"
    };
  }
  const path = zonePath(scene, sourceZone, targetZone, { purpose: "range" });
  const distance = path ? path.length - 1 : null;
  const range = sourceZone.id === targetZone.id
    ? (tokensEngaged(source, target) ? "engaged" : "short")
    : distance === 1 ? "medium" : distance != null && distance <= 4 ? "long" : "extreme";
  const sight = zoneLineOfSight(path, scene, source, target);
  const movementPath = zonePath(scene, sourceZone, targetZone, { purpose: "movement" });
  return {
    configured: true,
    range,
    distance,
    sourceZone,
    targetZone,
    path: path ?? [],
    visible: sight.visible,
    reachable: Boolean(movementPath) && wallPathClear(source, target, "move"),
    reason: sight.reason,
    targetDimlyLit: zoneData(targetZone).dimlyLit
  };
}

export function activeTokenForActor(actor, scene = canvas?.scene) {
  const matches = (token) => (
    token.actor?.uuid === actor?.uuid || token.actor?.id === actor?.id || token.actorId === actor?.id
  );
  return (canvas?.scene?.id === scene?.id ? (canvas?.tokens?.controlled ?? []).find(matches) : null)
    ?? collectionValues(scene?.tokens).find(matches)
    ?? actor?.getActiveTokens?.().find((token) => token.scene?.id === scene?.id || token.document?.parent?.id === scene?.id)
    ?? null;
}

export function maximumRange(range) {
  const key = String(range || "").trim().toLowerCase();
  return ZONE_RANGES.includes(key) ? key : null;
}

export function rangeAllows(actual, maximum) {
  const actualIndex = ZONE_RANGES.indexOf(String(actual));
  const maximumIndex = ZONE_RANGES.indexOf(String(maximum));
  return actualIndex >= 0 && maximumIndex >= 0 && actualIndex <= maximumIndex;
}

export function zoneRollModifiers(actor, skillName) {
  if (String(skillName || "").localeCompare("Observation", undefined, { sensitivity: "base" }) !== 0) return [];
  const token = activeTokenForActor(actor);
  const region = token ? zoneForToken(token) : null;
  return region && zoneData(region).dimlyLit
    ? [[game.i18n.localize("YZE.Zones.DimObservationModifier"), -2]]
    : [];
}

export function zoneCoverForActor(actor) {
  const token = activeTokenForActor(actor);
  const region = token ? zoneForToken(token) : null;
  const data = region ? zoneData(region) : null;
  if (!region || (!data.coverRating && !data.coverStepRating)) return null;
  return { region, label: data.coverLabel || region.name, rating: data.coverRating, stepRating: data.coverStepRating };
}

function regionOptions(regions, selected = "") {
  return regions.map((region) => `<option value="${escape(region.id)}"${region.id === selected ? " selected" : ""}>${escape(region.name)}</option>`).join("");
}

function managerContent(scene) {
  const regions = collectionValues(scene?.regions);
  const rows = regions.map((region) => {
    const data = zoneData(region);
    return `<fieldset class="yze-zone-row" data-region-id="${escape(region.id)}">
      <legend>${escape(region.name)}</legend>
      <label class="checkbox-row"><input type="checkbox" name="enabled"${data.enabled ? " checked" : ""}> <span>${escape(localize("Enabled"))}</span></label>
      <div class="yze-zone-features">
        <label class="checkbox-row"><input type="checkbox" name="cluttered"${data.cluttered ? " checked" : ""}> <span>${escape(localize("Cluttered"))}</span></label>
        <label class="checkbox-row"><input type="checkbox" name="dimlyLit"${data.dimlyLit ? " checked" : ""}> <span>${escape(localize("DimlyLit"))}</span></label>
        <label class="checkbox-row"><input type="checkbox" name="cramped"${data.cramped ? " checked" : ""}> <span>${escape(localize("Cramped"))}</span></label>
      </div>
      <div class="form-group"><label>${escape(localize("CoverName"))}</label><input type="text" name="coverLabel" value="${escape(data.coverLabel)}"></div>
      <div class="yze-zone-cover"><label>${escape(localize("PoolCover"))}<input type="number" name="coverRating" min="0" value="${data.coverRating}"></label><label>${escape(localize("StepCover"))}<select name="coverStepRating">${[0,1,2,3,4].map((value) => `<option value="${value}"${value === data.coverStepRating ? " selected" : ""}>${escape(formatStepRatingLabel(value, { none: "—" }))}</option>`).join("")}</select></label></div>
      <div class="form-group"><label>${escape(localize("Notes"))}</label><input type="text" name="notes" value="${escape(data.notes)}"></div>
    </fieldset>`;
  }).join("");
  const connections = zoneConnections(scene);
  const connectionRows = connections.map((connection, index) => `<div class="yze-zone-connection" data-connection-index="${index}">
    <select name="a">${regionOptions(regions, connection.a)}</select><i class="fa-solid fa-arrow-right-arrow-left"></i><select name="b">${regionOptions(regions, connection.b)}</select>
    <select name="border">${ZONE_BORDERS.map((border) => `<option value="${border}"${border === connection.border ? " selected" : ""}>${escape(localize(`Border.${border}`))}</option>`).join("")}</select>
    <label>${escape(localize("BarrierHealth"))}<input type="number" name="health" min="0" value="${Math.max(0, Number(connection.health) || 0)}"></label>
    <label>${escape(localize("BarrierMax"))}<input type="number" name="maxHealth" min="0" value="${Math.max(0, Number(connection.maxHealth) || 0)}"></label>
    <label>${escape(localize("BarrierArmor"))}<input type="number" name="armor" min="0" value="${Math.max(0, Number(connection.armor) || 0)}"></label>
    <label>${escape(localize("BarrierStepArmor"))}<input type="number" name="stepArmor" min="0" max="4" value="${Math.max(0, Number(connection.stepArmor) || 0)}"></label>
    <label class="checkbox-row"><input type="checkbox" name="remove"> <span>${escape(localize("Remove"))}</span></label>
  </div>`).join("");
  return `<div class="yze yze-zone-manager"><p>${escape(localize("ManagerHint"))}</p>
    ${regions.length ? rows : `<p class="hint">${escape(localize("NoRegions"))}</p>`}
    <h3>${escape(localize("Connections"))}</h3>${connectionRows || `<p class="hint">${escape(localize("NoConnections"))}</p>`}
  </div>`;
}

async function saveManager(form, scene) {
  const updates = [];
  for (const row of form.querySelectorAll("[data-region-id]")) {
    updates.push({
      _id: row.dataset.regionId,
      [`flags.${SYSTEM_ID}.zone`]: {
        enabled: row.elements?.enabled?.checked ?? row.querySelector('[name="enabled"]')?.checked === true,
        cluttered: row.querySelector('[name="cluttered"]')?.checked === true,
        dimlyLit: row.querySelector('[name="dimlyLit"]')?.checked === true,
        cramped: row.querySelector('[name="cramped"]')?.checked === true,
        coverLabel: String(row.querySelector('[name="coverLabel"]')?.value || "").trim(),
        coverRating: Math.max(0, Math.trunc(Number(row.querySelector('[name="coverRating"]')?.value) || 0)),
        coverStepRating: Math.max(0, Math.min(4, Math.trunc(Number(row.querySelector('[name="coverStepRating"]')?.value) || 0))),
        notes: String(row.querySelector('[name="notes"]')?.value || "").trim()
      }
    });
  }
  if (updates.length) await scene.updateEmbeddedDocuments("Region", updates);
  const connections = [...form.querySelectorAll("[data-connection-index]")]
    .filter((row) => row.querySelector('[name="remove"]')?.checked !== true)
    .map((row) => ({
      a: row.querySelector('[name="a"]')?.value,
      b: row.querySelector('[name="b"]')?.value,
      border: row.querySelector('[name="border"]')?.value || "open",
      health: Math.max(0, Math.trunc(Number(row.querySelector('[name="health"]')?.value) || 0)),
      maxHealth: Math.max(0, Math.trunc(Number(row.querySelector('[name="maxHealth"]')?.value) || 0)),
      armor: Math.max(0, Math.trunc(Number(row.querySelector('[name="armor"]')?.value) || 0)),
      stepArmor: Math.max(0, Math.min(4, Math.trunc(Number(row.querySelector('[name="stepArmor"]')?.value) || 0)))
    })).filter((entry) => entry.a && entry.b && entry.a !== entry.b);
  await scene.setFlag(SYSTEM_ID, "zoneConnections", connections);
}

export async function operateZoneBarrier(scene = canvas?.scene) {
  const connections = zoneConnections(scene).filter((entry) => entry.border === "doorClosed" || Number(entry.health) > 0);
  const actor = canvas?.tokens?.controlled?.[0]?.actor;
  if (!scene || !actor || connections.length === 0) {
    ui.notifications.warn(localize("BarrierSelectionRequired"));
    return false;
  }
  const regions = new Map(sceneZones(scene).map((region) => [region.id, region.name]));
  const options = connections.map((entry, index) => `<option value="${index}">${escape(regions.get(entry.a))} ↔ ${escape(regions.get(entry.b))}</option>`).join("");
  const { DialogV2 } = foundry.applications.api;
  const choice = await DialogV2.wait({
    window: { title: localize("OperateBarrier") },
    content: `<div class="yze"><select name="connection">${options}</select><label>${escape(localize("BarrierDamage"))}<input type="number" name="damage" min="0" value="0"></label></div>`,
    buttons: [
      { action: "open", label: localize("OpenBarrier"), default: true, callback: (event, button, dialog) => ({ index: Number((button.form ?? dialog.element.querySelector("form")).elements.connection.value), open: true }) },
      { action: "damage", label: localize("DamageBarrier"), callback: (event, button, dialog) => { const form = button.form ?? dialog.element.querySelector("form"); return { index: Number(form.elements.connection.value), damage: Math.max(0, Math.trunc(Number(form.elements.damage.value) || 0)) }; } },
      { action: "cancel", label: game.i18n.localize("YZE.Common.Cancel"), callback: () => null }
    ], close: () => null, rejectClose: false, modal: true
  });
  if (!choice) return false;
  const selected = connections[choice.index];
  const all = zoneConnections(scene);
  const index = all.findIndex((entry) => entry.a === selected.a && entry.b === selected.b);
  if (index < 0) return false;
  if (choice.open) {
    if (!await game.yze?.spendActorActions?.(actor, { fast: 1 })) return false;
    all[index].border = "doorOpen";
  } else {
    const step = getDiceSystem() === DICE_SYSTEMS.STEP;
    const rating = step ? Number(selected.stepArmor) || 0 : Number(selected.armor) || 0;
    let absorbed = 0;
    if (rating > 0) {
      const die = step ? getStepRating(rating) : null;
      const roll = await new Roll(step ? `2d${die.faces}` : `${rating}d6`).evaluate();
      absorbed = roll.dice.flatMap((entry) => entry.results).reduce((total, entry) => total + (step ? (entry.result >= 10 ? 2 : entry.result >= 6 ? 1 : 0) : entry.result === 6 ? 1 : 0), 0);
      await roll.toMessage({ flavor: localize("BarrierArmorRoll") });
    }
    const startingHealth = Object.hasOwn(selected, "health") ? Number(selected.health) : 5;
    all[index].health = Math.max(0, startingHealth - Math.max(0, choice.damage - absorbed));
    if (!Object.hasOwn(all[index], "maxHealth")) all[index].maxHealth = 5;
    if (all[index].health === 0) all[index].border = "doorOpen";
  }
  await scene.setFlag(SYSTEM_ID, "zoneConnections", all);
  return true;
}

async function addConnection(scene) {
  const regions = sceneZones(scene);
  if (regions.length < 2) {
    ui.notifications.warn(localize("NeedTwoZones"));
    return;
  }
  const { DialogV2 } = foundry.applications.api;
  const connection = await DialogV2.wait({
    window: { title: localize("AddConnection") },
    content: `<div class="yze"><div class="form-group"><label>${escape(localize("From"))}</label><select name="a">${regionOptions(regions)}</select></div><div class="form-group"><label>${escape(localize("To"))}</label><select name="b">${regionOptions(regions, regions[1]?.id)}</select></div><div class="form-group"><label>${escape(localize("BorderLabel"))}</label><select name="border">${ZONE_BORDERS.map((border) => `<option value="${border}">${escape(localize(`Border.${border}`))}</option>`).join("")}</select></div></div>`,
    buttons: [{ action: "add", label: localize("Add"), icon: "fa-solid fa-link", default: true, callback: (_event, button, dialog) => {
      const form = button.form ?? dialog.element.querySelector("form");
      return { a: form.elements.a.value, b: form.elements.b.value, border: form.elements.border.value };
    }}, { action: "cancel", label: game.i18n.localize("YZE.Common.Cancel"), callback: () => null }],
    close: () => null, rejectClose: false, modal: true
  });
  if (!connection || connection.a === connection.b) return;
  if (connection.border === "doorClosed") Object.assign(connection, {
    health: 5, maxHealth: 5, armor: 4, stepArmor: 2
  });
  const connections = zoneConnections(scene).filter((entry) => !(
    (entry.a === connection.a && entry.b === connection.b) || (entry.a === connection.b && entry.b === connection.a)
  ));
  await scene.setFlag(SYSTEM_ID, "zoneConnections", [...connections, connection]);
  await openZoneManager(scene);
}

export async function openZoneManager(scene = canvas?.scene) {
  if (!scene || !game.user?.isGM) return null;
  const { DialogV2 } = foundry.applications.api;
  return DialogV2.wait({
    window: { title: localize("ManagerTitle") },
    position: { width: 760, height: 760 },
    content: managerContent(scene),
    buttons: [
      { action: "save", label: localize("Save"), icon: "fa-solid fa-floppy-disk", default: true, callback: async (_event, button, dialog) => {
        await saveManager(button.form ?? dialog.element.querySelector("form"), scene);
        ui.notifications.info(localize("Saved"));
        return true;
      }},
      { action: "add", label: localize("AddConnection"), icon: "fa-solid fa-link", callback: async (_event, button, dialog) => {
        await saveManager(button.form ?? dialog.element.querySelector("form"), scene);
        setTimeout(() => addConnection(scene), 0);
        return true;
      }},
      { action: "cancel", label: game.i18n.localize("YZE.Common.Cancel"), callback: () => null }
    ],
    close: () => null, rejectClose: false, modal: true
  });
}

export async function analyzeSelectedRange() {
  const sources = canvas?.tokens?.controlled ?? [];
  const targets = [...(game.user?.targets ?? [])];
  if (sources.length !== 1 || targets.length !== 1) {
    ui.notifications.warn(localize("SelectSourceTarget"));
    return null;
  }
  const result = rangeBetweenTokens(sources[0], targets[0]);
  if (!result.configured) {
    ui.notifications.warn(localize("TokensNeedZones"));
    return result;
  }
  const message = game.i18n.format("YZE.Zones.RangeResult", {
    source: sources[0].name,
    target: targets[0].name,
    range: game.i18n.localize(`YZE.Range.${result.range}`),
    zones: result.distance ?? 0,
    sight: localize(result.visible ? "Visible" : `Sight.${result.reason}`)
  });
  ui.notifications.info(message);
  return result;
}

function combatantForActor(actor) {
  return collectionValues(game.combat?.combatants).find((combatant) => (
    combatant.actor?.uuid === actor?.uuid || (!actor?.isToken && combatant.actorId === actor?.id)
  ));
}

function actorInActiveCombat(actor) {
  return Boolean(game.combat?.started && combatantForActor(actor));
}

function hostileTokens(document) {
  const disposition = Number(document?.disposition) || 0;
  return collectionValues(document?.parent?.tokens).filter((other) => (
    other.id !== document.id && other.actor && Number(other.disposition) * disposition < 0
  ));
}

export function engagedHostileTokens(tokenOrDocument, position = null) {
  const document = tokenOrDocument?.document ?? tokenOrDocument;
  if (!document) return [];
  const source = position
    ? { ...document.toObject(), parent: document.parent, x: position.x, y: position.y }
    : tokenOrDocument;
  return hostileTokens(document).filter((other) => {
    if (!actorInActiveCombat(other.actor) || other.actor.system?.dead === true
      || !tokensEngaged(source, other)) return false;
    if (position) return true;
    const spatial = rangeBetweenTokens(source, other);
    return spatial.configured ? spatial.range === "engaged" && spatial.reachable : spatial.reachable;
  });
}

function engagedTokensAt(document, position) {
  const virtual = { ...document.toObject(), parent: document.parent, x: position.x, y: position.y };
  return collectionValues(document?.parent?.tokens)
    .filter((other) => other.id !== document.id && other.actor && tokensEngaged(virtual, other))
    .map((token) => token.id);
}

function engagedHostilesAt(document, position) {
  return engagedHostileTokens(document, position).map((token) => token.id);
}

function movementCost(actor, originZone, destinationZone) {
  const injuryMovement = getCriticalInjuryRestrictions(actor).movement;
  const restricted = injuryMovement === "slow" || actor?.system?.combat?.prone === true
    || zoneData(originZone).cramped || zoneData(destinationZone).cramped;
  return restricted ? { slow: 1, fast: 0 } : { slow: 0, fast: 1 };
}

function movementKey(document, movement) {
  return `${document.uuid}:${movement?.id ?? ""}:${Math.round(Number(movement?.destination?.x) || 0)}:${Math.round(Number(movement?.destination?.y) || 0)}`;
}

function preMoveToken(document, movement) {
  const actor = document?.actor;
  const vehicleDriver = actor?.type === "vehicle" && actor.system?.driverUuid
    ? game.actors?.get(String(actor.system.driverUuid).split(".").pop())
    : null;
  const actionActor = vehicleDriver ?? actor;
  if (!actor || (!actorInActiveCombat(actor) && !actorInActiveCombat(actionActor))) return true;
  const origin = movement?.origin ?? document;
  const destination = movement?.destination;
  if (!destination) return true;
  const injuryRestrictions = getCriticalInjuryRestrictions(actionActor);
  if (injuryRestrictions.movement === "none") {
    notifyCriticalInjuryRestriction(actor, {
      kind: "movement",
      sources: injuryRestrictions.movementSources
    });
    return false;
  }
  const originZone = zoneForToken(document, origin);
  const destinationZone = zoneForToken(document, destination);
  const mount = mountForRider(actionActor);
  const prepared = actionActor.getFlag?.(SYSTEM_ID, "mountedMovement");
  const preparedValid = mount && prepared?.mountUuid === mount.uuid
    && prepared?.sceneId === document.parent?.id
    && (!game.combat || (prepared.combatId === game.combat.id
      && Number(prepared.round) === (Number(game.combat.round) || 0)));
  const vehiclePrepared = actor.type === "vehicle"
    ? actor.getFlag?.(SYSTEM_ID, "vehicleMovement")
    : null;
  const vehiclePreparedValid = vehiclePrepared
    && vehiclePrepared.sceneId === document.parent?.id
    && (!game.combat || (vehiclePrepared.combatId === game.combat.id
      && Number(vehiclePrepared.round) === (Number(game.combat.round) || 0)));
  const originEngagements = engagedTokensAt(document, origin);
  const destinationEngagements = engagedTokensAt(document, destination);
  const leaving = engagedHostilesAt(document, origin);
  const arriving = engagedHostilesAt(document, destination);
  const retreat = actionActor.getFlag?.(SYSTEM_ID, "retreatMovement");
  const baseValidRetreat = retreat?.combatId === game.combat?.id
    && Number(retreat?.round) === (Number(game.combat?.round) || 0)
    && retreat?.consumed !== true;
  const leavingHostile = leaving.some((id) => !arriving.includes(id));
  const eligibleRetreatTokens = new Set(retreat?.eligibleAttackerTokenUuids ?? []);
  const leftHostiles = leaving
    .filter((id) => !arriving.includes(id))
    .map((id) => document.parent?.tokens?.get(id))
    .filter(Boolean);
  const validRetreat = baseValidRetreat && leftHostiles.length > 0
    && leftHostiles.every((token) => eligibleRetreatTokens.has(token.uuid));
  if (leavingHostile && !validRetreat) {
    ui.notifications.warn(localize("RetreatRequired"));
    return false;
  }
  if (originZone && destinationZone && originZone.id !== destinationZone.id) {
    const path = zonePath(document.parent, originZone, destinationZone, { purpose: "movement" });
    if (!path) {
      ui.notifications.warn(localize("NotAdjacent"));
      return false;
    }
    if (mount && path.some((zone) => zoneData(zone).cramped)) {
      ui.notifications.warn(game.i18n.localize("YZE.Mount.CannotEnterCramped"));
      return false;
    }
    const steps = path.length - 1;
    const cluttered = path.some((zone) => zoneData(zone).cluttered);
    const mountedLimit = cluttered ? 1 : Math.max(1, Math.trunc(Number(preparedValid ? prepared.allowedZones : 1) || 1));
    const vehicleLimit = Math.max(1, Math.trunc(Number(
      vehiclePreparedValid ? vehiclePrepared.allowedZones : 1
    ) || 1));
    if ((!mount && actor.type !== "vehicle" && steps !== 1)
      || (actor.type === "vehicle" && steps > vehicleLimit)
      || (mount && steps > mountedLimit)) {
      const key = mount ? "YZE.Mount.MoveLimit"
        : actor.type === "vehicle" ? "YZE.Vehicle.MoveLimit" : "YZE.Zones.NotAdjacent";
      ui.notifications.warn(game.i18n.format(key, {
        zones: mount ? mountedLimit : vehicleLimit
      }));
      return false;
    }
  }
  if (!originZone || !destinationZone) {
    if (sceneZones(document.parent).length > 0) ui.notifications.warn(localize("TokensNeedZones"));
    return sceneZones(document.parent).length === 0;
  }
  const engagementChanged = originEngagements.some((id) => !destinationEngagements.includes(id))
    || destinationEngagements.some((id) => !originEngagements.includes(id));
  if (originZone.id === destinationZone.id && !engagementChanged) return true;
  const cost = leavingHostile && validRetreat
    ? { slow: 0, fast: 0 }
    : preparedValid || vehiclePreparedValid
      ? { slow: 0, fast: 0 }
      : movementCost(actionActor, originZone, destinationZone);
  if (!game.yze?.canSpendActorActions?.(actionActor, cost)) {
    ui.notifications.warn(game.i18n.localize("YZE.Combat.NotEnoughActions"));
    return false;
  }
  pendingMoves.set(movementKey(document, movement), {
    actor: actionActor,
    movedActor: actor,
    cost,
    originZone,
    destinationZone,
    mountedMovement: preparedValid ? prepared : null,
    vehicleMovement: vehiclePreparedValid ? vehiclePrepared : null,
    consumeRetreat: leavingHostile && validRetreat,
    retreatAttackerTokenIds: leaving.filter((id) => !arriving.includes(id))
  });
  movement.finished?.then?.((completed) => {
    if (!completed) pendingMoves.delete(movementKey(document, movement));
  });
  return true;
}

async function resolveMoveToken(document, movement) {
  const pending = pendingMoves.get(movementKey(document, movement));
  if (!pending) return;
  pendingMoves.delete(movementKey(document, movement));
  if (!await game.yze?.spendActorActions?.(pending.actor, pending.cost)) return;
  if (pending.mountedMovement) await pending.actor.unsetFlag(SYSTEM_ID, "mountedMovement");
  if (pending.vehicleMovement) await pending.movedActor.unsetFlag(SYSTEM_ID, "vehicleMovement");
  if (pending.consumeRetreat) {
    const retreat = pending.actor.getFlag(SYSTEM_ID, "retreatMovement");
    if (retreat?.failed === true) {
      const attackerTokenUuids = pending.retreatAttackerTokenIds
        .map((id) => document.parent?.tokens?.get(id)?.uuid)
        .filter(Boolean);
      await pending.actor.setFlag(SYSTEM_ID, "retreatMovement", {
        ...retreat,
        consumed: true,
        attackerTokenUuids,
        targetTokenUuid: document.uuid
      });
      await game.yze?.requestFailedRetreatFreeAttacks?.(pending.actor);
    } else {
      await pending.actor.unsetFlag(SYSTEM_ID, "retreatMovement");
    }
  }
  if (pending.mountedMovement || pending.vehicleMovement
    || pending.originZone.id === pending.destinationZone.id
    || !zoneData(pending.destinationZone).cluttered) return;
  const skill = pending.actor.items.find((item) => item.type === "skill" && item.name.localeCompare("Mobility", undefined, { sensitivity: "base" }) === 0);
  if (!skill) {
    ui.notifications.warn(localize("MobilityMissing"));
    return;
  }
  const message = await pending.actor.rollSkill(skill.id, { canOppose: false, helpAction: pending.cost.slow ? "slow" : "fast" });
  if (!message || countStateSuccesses(message.getFlag(SYSTEM_ID, "push")) > 0) return;
  await pending.actor.update({ "system.combat.prone": true });
  ui.notifications.warn(game.i18n.format("YZE.Zones.ClutteredFall", { actor: pending.actor.name, zone: pending.destinationZone.name }));
}

function addControlTool(controls) {
  const getControl = (name) => Array.isArray(controls)
    ? controls.find((control) => control.name === name)
    : controls?.[name];
  const addTool = (control, tool) => {
    if (!control) return;
    if (Array.isArray(control.tools)) {
      if (!control.tools.some((entry) => entry.name === tool.name)) control.tools.push(tool);
      return;
    }
    control.tools ??= {};
    tool.order ??= Object.keys(control.tools).length;
    control.tools[tool.name] = tool;
  };
  addTool(getControl("regions"), {
    name: "yze-zone-manager", title: "YZE.Zones.ManagerTitle", icon: "fa-solid fa-draw-polygon",
    button: true, visible: game.user?.isGM === true, onChange: () => openZoneManager()
  });
  addTool(getControl("tokens"), {
    name: "yze-zone-range", title: "YZE.Zones.Analyze", icon: "fa-solid fa-ruler-combined",
    button: true, onChange: () => analyzeSelectedRange()
  });
  addTool(getControl("tokens"), {
    name: "yze-zone-barrier", title: "YZE.Zones.OperateBarrier", icon: "fa-solid fa-door-open",
    button: true, onChange: () => operateZoneBarrier()
  });
}

export function registerZoneHooks() {
  Hooks.on("getSceneControlButtons", addControlTool);
  Hooks.on("preMoveToken", preMoveToken);
  Hooks.on("moveToken", (document, movement, _operation, user) => {
    if (user?.id && user.id !== game.user?.id) return;
    resolveMoveToken(document, movement).catch((error) => console.error("YZE System Toolkit | Zone movement failed", error));
  });
}
