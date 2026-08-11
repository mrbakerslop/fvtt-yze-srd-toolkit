import { SYSTEM_ID } from "./constants.mjs";
import { isTravelEnabled } from "./settings.mjs";

const MAP_FLAG = "travelMap";
const ROUTE_FLAG = "travelRoute";
const TERRAIN_FLAG = "travelTerrain";
const TERRAIN_TYPES = Object.freeze(["road", "open", "woods", "hills", "mountains", "water", "swamp", "ruins"]);

function escape(value) {
  return foundry.utils.escapeHTML(String(value ?? ""));
}

function whole(value) {
  const number = Math.trunc(Number(value));
  return Number.isFinite(number) ? Math.max(0, number) : 0;
}

function values(collection) {
  if (!collection) return [];
  if (Array.isArray(collection)) return collection;
  if (typeof collection.values === "function") return [...collection.values()];
  return [...collection];
}

function offset(value) {
  if (!value || !Number.isFinite(Number(value.i)) || !Number.isFinite(Number(value.j))) return null;
  return { i: Math.trunc(Number(value.i)), j: Math.trunc(Number(value.j)) };
}

function sameOffset(left, right) {
  return left && right && Number(left.i) === Number(right.i) && Number(left.j) === Number(right.j);
}

function offsetKey(coords) {
  return coords ? `${coords.i},${coords.j}` : "";
}

function terrainLabel(terrain) {
  return game.i18n.localize(`YZE.Travel.TerrainTypes.${terrain}`);
}

function currentScene() {
  return globalThis.canvas?.scene ?? game.scenes?.current ?? null;
}

export function isHexTravelScene(scene = currentScene()) {
  return Boolean(scene?.grid && scene.grid.isGridless !== true && Number(scene.grid.type) !== 0);
}

function mapConfig(scene) {
  const stored = scene?.getFlag?.(SYSTEM_ID, MAP_FLAG) ?? {};
  return {
    enabled: stored.enabled === true,
    partyTokenId: String(stored.partyTokenId || ""),
    defaultTerrain: TERRAIN_TYPES.includes(stored.defaultTerrain) ? stored.defaultTerrain : "open",
    hexDistance: Math.max(0.1, Number(stored.hexDistance) || 10)
  };
}

function routeData(scene) {
  const stored = scene?.getFlag?.(SYSTEM_ID, ROUTE_FLAG);
  if (!stored || typeof stored !== "object") return null;
  return foundry.utils.deepClone(stored);
}

function tokenDocument(token) {
  return token?.document ?? token ?? null;
}

function tokenCenter(token) {
  const document = tokenDocument(token);
  const scene = document?.parent ?? currentScene();
  const size = Number(scene?.grid?.size) || 100;
  return {
    x: (Number(document?.x) || 0) + Math.max(0.1, Number(document?.width) || 1) * size / 2,
    y: (Number(document?.y) || 0) + Math.max(0.1, Number(document?.height) || 1) * size / 2
  };
}

function tokenOffset(scene, token) {
  try {
    return offset(scene.grid.getOffset(tokenCenter(token)));
  } catch (_error) {
    return null;
  }
}

function partyToken(scene, config = mapConfig(scene)) {
  return config.partyTokenId ? scene?.tokens?.get?.(config.partyTokenId) ?? null : null;
}

function pointInRegion(region, point) {
  try {
    return region.testPoint(point, 0) === true;
  } catch (_error) {
    try {
      return region.object?.testPoint?.(point, 0) === true;
    } catch (_nestedError) {
      return false;
    }
  }
}

function regionArea(region) {
  const bounds = region.bounds ?? region.object?.bounds;
  return Math.max(0, Number(bounds?.width) || 0) * Math.max(0, Number(bounds?.height) || 0);
}

export function travelTerrainData(region) {
  const stored = region?.getFlag?.(SYSTEM_ID, TERRAIN_FLAG) ?? {};
  return {
    terrain: TERRAIN_TYPES.includes(stored.terrain) ? stored.terrain : "",
    road: stored.road === true
  };
}

export function travelHexData(scene, coords) {
  const safeOffset = offset(coords);
  const config = mapConfig(scene);
  if (!scene || !safeOffset) return null;
  let center;
  try {
    center = scene.grid.getCenterPoint(safeOffset);
  } catch (_error) {
    return null;
  }
  const region = values(scene.regions)
    .filter((entry) => {
      const data = travelTerrainData(entry);
      return (data.terrain || data.road) && pointInRegion(entry, center);
    })
    .sort((left, right) => regionArea(left) - regionArea(right))[0] ?? null;
  const regionData = travelTerrainData(region);
  const terrain = regionData.road ? "road" : regionData.terrain || config.defaultTerrain;
  return {
    ...safeOffset,
    key: offsetKey(safeOffset),
    label: game.i18n.format("YZE.TravelMap.HexLabel", { i: safeOffset.i, j: safeOffset.j }),
    terrain,
    terrainLabel: terrainLabel(terrain),
    road: regionData.road,
    regionId: region?.id ?? "",
    regionName: region?.name ?? ""
  };
}

function directPath(scene, origin, destination) {
  try {
    const path = scene.grid.getDirectPath([origin, destination]).map(offset).filter(Boolean);
    if (!sameOffset(path[0], origin)) path.unshift(origin);
    if (!sameOffset(path.at(-1), destination)) path.push(destination);
    return path.filter((entry, index) => index === 0 || !sameOffset(entry, path[index - 1]));
  } catch (error) {
    console.error("YZE System Toolkit | Could not calculate hex route", error);
    return [];
  }
}

function currentRoutePath(scene, route, token) {
  const current = tokenOffset(scene, token);
  const destination = offset(route?.destination);
  if (!current || !destination) return [];
  const stored = Array.isArray(route.path) ? route.path.map(offset).filter(Boolean) : [];
  const index = stored.findIndex((entry) => sameOffset(entry, current));
  if (index >= 0 && sameOffset(stored.at(-1), destination)) return stored.slice(index);
  return directPath(scene, current, destination);
}

export function travelMapState(scene = currentScene()) {
  const config = mapConfig(scene);
  const token = partyToken(scene, config);
  const current = token ? tokenOffset(scene, token) : null;
  const route = routeData(scene);
  const path = route && token ? currentRoutePath(scene, route, token) : [];
  const currentHex = current ? travelHexData(scene, current) : null;
  const destination = route?.destination ? travelHexData(scene, route.destination) : null;
  const nextHex = path.length > 1 ? travelHexData(scene, path[1]) : currentHex;
  const remaining = Math.max(0, path.length - 1);
  return {
    configured: Boolean(scene && isHexTravelScene(scene) && config.enabled && config.partyTokenId && token),
    enabled: config.enabled,
    isHexagonal: isHexTravelScene(scene),
    sceneId: scene?.id ?? "",
    sceneName: scene?.name ?? "",
    partyTokenId: token?.id ?? "",
    partyTokenName: token?.name ?? token?.actor?.name ?? "",
    current: currentHex,
    next: nextHex,
    destination,
    remaining,
    remainingDistance: Number((remaining * config.hexDistance).toFixed(2)),
    route: route ? { ...route, path } : null,
    defaultTerrain: config.defaultTerrain,
    hexDistance: config.hexDistance
  };
}

function terrainOptions(selected) {
  return TERRAIN_TYPES.map((terrain) => `<option value="${terrain}"${terrain === selected ? " selected" : ""}>${escape(terrainLabel(terrain))}</option>`).join("");
}

/** Configure the active hex Scene, party marker, default terrain, and Region terrain overlays. */
export async function configureTravelMap(scene = currentScene()) {
  if (!game.user?.isGM) {
    ui.notifications.warn(game.i18n.localize("YZE.TravelMap.GMOnly"));
    return null;
  }
  if (!scene || !isHexTravelScene(scene)) {
    ui.notifications.warn(game.i18n.localize("YZE.TravelMap.HexSceneRequired"));
    return null;
  }
  const config = mapConfig(scene);
  const controlled = globalThis.canvas?.scene?.id === scene.id
    ? tokenDocument(globalThis.canvas?.tokens?.controlled?.[0])
    : null;
  const selectedPartyTokenId = config.partyTokenId || controlled?.id || "";
  const tokenOptions = values(scene.tokens).map((token) => `<option value="${escape(token.id)}"${token.id === selectedPartyTokenId ? " selected" : ""}>${escape(token.name || token.actor?.name || token.id)}</option>`).join("");
  const regions = values(scene.regions);
  const regionRows = regions.length > 0 ? regions.map((region) => {
    const data = travelTerrainData(region);
    return `<div class="yze-travel-region-row">
      <span>${escape(region.name)}</span>
      <select name="region.${escape(region.id)}.terrain"><option value="">${escape(game.i18n.localize("YZE.TravelMap.UseDefault"))}</option>${terrainOptions(data.terrain)}</select>
      <label class="checkbox-row"><input type="checkbox" name="region.${escape(region.id)}.road"${data.road ? " checked" : ""}> ${escape(game.i18n.localize("YZE.TravelMap.Road"))}</label>
    </div>`;
  }).join("") : `<p class="hint">${escape(game.i18n.localize("YZE.TravelMap.NoRegions"))}</p>`;
  const { DialogV2 } = foundry.applications.api;
  const selection = await DialogV2.wait({
    window: { title: game.i18n.localize("YZE.TravelMap.Configure") },
    content: `<div class="yze yze-travel-map-dialog">
      <label class="checkbox-row"><input type="checkbox" name="enabled"${config.enabled ? " checked" : ""}> ${escape(game.i18n.localize("YZE.TravelMap.Enabled"))}</label>
      <div class="form-group"><label>${escape(game.i18n.localize("YZE.TravelMap.PartyToken"))}</label><select name="partyToken"><option value="">${escape(game.i18n.localize("YZE.Common.None"))}</option>${tokenOptions}</select></div>
      <div class="form-group"><label>${escape(game.i18n.localize("YZE.TravelMap.DefaultTerrain"))}</label><select name="defaultTerrain">${terrainOptions(config.defaultTerrain)}</select></div>
      <div class="form-group"><label>${escape(game.i18n.localize("YZE.TravelMap.HexDistance"))}</label><input type="number" name="hexDistance" value="${config.hexDistance}" min="0.1" step="0.1"></div>
      <h3>${escape(game.i18n.localize("YZE.TravelMap.RegionTerrain"))}</h3>${regionRows}
      <p class="hint">${escape(game.i18n.localize("YZE.TravelMap.ConfigureHint"))}</p>
    </div>`,
    buttons: [
      { action: "save", label: game.i18n.localize("YZE.Common.Save"), icon: "fa-solid fa-floppy-disk", default: true,
        callback: (event, button, dialog) => {
          const form = button.form ?? dialog.element.querySelector("form");
          return {
            enabled: form.elements.enabled?.checked === true,
            partyTokenId: form.elements.partyToken?.value || "",
            defaultTerrain: form.elements.defaultTerrain?.value || "open",
            hexDistance: Math.max(0.1, Number(form.elements.hexDistance?.value) || 10),
            regions: regions.map((region) => ({
              region,
              terrain: form.elements.namedItem(`region.${region.id}.terrain`)?.value || "",
              road: form.elements.namedItem(`region.${region.id}.road`)?.checked === true
            }))
          };
        } },
      { action: "cancel", label: game.i18n.localize("YZE.Common.Cancel"), callback: () => null }
    ], close: () => null, rejectClose: false, modal: true
  });
  if (!selection) return null;
  if (selection.enabled && !selection.partyTokenId) {
    ui.notifications.warn(game.i18n.localize("YZE.TravelMap.NotConfigured"));
    return null;
  }
  await scene.setFlag(SYSTEM_ID, MAP_FLAG, {
    enabled: selection.enabled,
    partyTokenId: selection.partyTokenId,
    defaultTerrain: selection.defaultTerrain,
    hexDistance: selection.hexDistance
  });
  for (const entry of selection.regions) {
    await entry.region.setFlag(SYSTEM_ID, TERRAIN_FLAG, {
      terrain: entry.terrain,
      road: entry.road
    });
  }
  ui.notifications.info(game.i18n.localize("YZE.TravelMap.Saved"));
  return travelMapState(scene);
}

/** Plan a direct hex route from the configured party marker to one targeted token. */
export async function planTravelRoute(scene = currentScene()) {
  if (!game.user?.isGM) {
    ui.notifications.warn(game.i18n.localize("YZE.TravelMap.GMOnly"));
    return null;
  }
  const state = travelMapState(scene);
  if (!state.configured) {
    ui.notifications.warn(game.i18n.localize("YZE.TravelMap.NotConfigured"));
    return null;
  }
  const targets = [...(game.user?.targets ?? [])].filter((token) => token.document?.parent?.id === scene.id);
  if (targets.length !== 1) {
    ui.notifications.warn(game.i18n.localize("YZE.TravelMap.TargetDestination"));
    return null;
  }
  const source = scene.tokens.get(state.partyTokenId);
  const destinationToken = tokenDocument(targets[0]);
  if (!source || !destinationToken || source.id === destinationToken.id) {
    ui.notifications.warn(game.i18n.localize("YZE.TravelMap.TargetDestination"));
    return null;
  }
  const origin = tokenOffset(scene, source);
  const destination = tokenOffset(scene, destinationToken);
  const path = directPath(scene, origin, destination);
  if (!origin || !destination || path.length < 2) {
    ui.notifications.warn(game.i18n.localize("YZE.TravelMap.RouteFailed"));
    return null;
  }
  const route = {
    origin,
    destination,
    destinationTokenId: destinationToken.id,
    path,
    plannedBy: game.user.id,
    plannedAt: Date.now(),
    progress: {},
    movementBank: {},
    navigationApprovals: {}
  };
  await scene.setFlag(SYSTEM_ID, ROUTE_FLAG, route);
  const terrain = [...new Set(path.slice(1).map((coords) => travelHexData(scene, coords)?.terrainLabel).filter(Boolean))].join(", ");
  await ChatMessage.create({
    content: `<div class="yze chat-card yze-travel-map-card"><h3>${escape(game.i18n.localize("YZE.TravelMap.RoutePlanned"))}</h3>
      <p>${escape(game.i18n.format("YZE.TravelMap.RouteSummary", {
        origin: offsetKey(origin), destination: offsetKey(destination), hexes: path.length - 1,
        distance: Number(((path.length - 1) * state.hexDistance).toFixed(2)), terrain
      }))}</p></div>`
  });
  return travelMapState(scene);
}

export async function clearTravelRoute(scene = currentScene()) {
  if (!game.user?.isGM || !scene) return false;
  await scene.unsetFlag(SYSTEM_ID, ROUTE_FLAG);
  ui.notifications.info(game.i18n.localize("YZE.TravelMap.RouteCleared"));
  return true;
}

/** Move the party marker along the planned route and claim group movement once per Shift. */
export async function advanceTravelRoute(hexes, {
  clock = null,
  mode = "march",
  useTerrainCosts = false,
  maximumHexes = Number.POSITIVE_INFINITY,
  scene = currentScene()
} = {}) {
  const requested = whole(hexes);
  const state = travelMapState(scene);
  if (!state.configured || !state.route) return { configured: false, requested, moved: requested };
  if (!game.user?.isGM) return { configured: true, requested, moved: 0, gmRequired: true };
  const route = routeData(scene);
  const shiftKey = clock ? `${clock.day}:${clock.shift}` : "";
  const prior = shiftKey ? route.progress?.[shiftKey] : null;
  if (prior && prior.requiresNavigation !== true && prior.requiresAdditionalRoll !== true) {
    return { configured: true, requested, moved: 0, alreadyMoved: true, ...prior };
  }
  const token = scene.tokens.get(state.partyTokenId);
  const path = currentRoutePath(scene, route, token);
  let moved = 0;
  let requiresNavigation = false;
  let requiresAdditionalRoll = false;
  let lastTerrain = "";
  const addedMovement = prior ? 0 : requested;
  let movementRemaining = addedMovement + (useTerrainCosts ? Number(route.movementBank?.[mode]) || 0 : 0);
  if (useTerrainCosts) {
    const costs = { road: 1, open: 1, woods: 2, hills: 2, mountains: 3, water: 1, swamp: 4, ruins: 2 };
    const detourPaid = Math.min(movementRemaining, whole(route.detourCost));
    movementRemaining -= detourPaid;
    route.detourCost = whole(route.detourCost) - detourPaid;
    for (const coords of route.detourCost > 0 ? [] : path.slice(1)) {
      if (moved >= maximumHexes) break;
      const hex = travelHexData(scene, coords);
      const terrain = hex?.terrain ?? "open";
      const cost = costs[terrain] ?? 1;
      if (movementRemaining < cost) break;
      if (terrain !== "road" && route.navigationApprovals?.[hex.key] !== true) {
        requiresNavigation = true;
        break;
      }
      if (mode === "drive" && moved > 0 && terrain !== lastTerrain) {
        requiresAdditionalRoll = true;
        break;
      }
      movementRemaining -= cost;
      moved += 1;
      lastTerrain = terrain;
    }
    for (const coords of path.slice(1, moved + 1)) {
      const hex = travelHexData(scene, coords);
      if (hex?.terrain !== "road" && route.navigationApprovals) {
        delete route.navigationApprovals[hex.key];
      }
    }
    route.movementBank ??= {};
    route.movementBank[mode] = Number(movementRemaining.toFixed(3));
  } else moved = Math.min(requested, Math.max(0, path.length - 1), maximumHexes);
  if (moved > 0) {
    const destination = path[moved];
    const point = scene.grid.getTopLeftPoint(destination);
    await token.update({ x: point.x, y: point.y }, { animate: true });
  }
  route.origin = path[moved] ?? path[0] ?? route.origin;
  route.path = path.slice(moved);
  route.progress ??= {};
  if (shiftKey) route.progress[shiftKey] = {
    moved: whole(prior?.moved) + moved,
    movedThisRoll: moved,
    requested: whole(prior?.requested) + addedMovement,
    mode,
    requiresNavigation,
    requiresAdditionalRoll,
    nextHexKey: route.path[1] ? offsetKey(route.path[1]) : "",
    at: Date.now()
  };
  await scene.setFlag(SYSTEM_ID, ROUTE_FLAG, route);
  return {
    configured: true,
    requested,
    moved,
    remaining: Math.max(0, route.path.length - 1),
    movementBank: Number(route.movementBank?.[mode]) || 0,
    requiresNavigation,
    requiresAdditionalRoll,
    current: travelHexData(scene, route.origin),
    destination: travelHexData(scene, route.destination)
  };
}

/** Approve the next off-road route hex after a successful Navigation roll. */
export async function approveTravelNavigation(scene = currentScene()) {
  if (!game.user?.isGM) return null;
  const state = travelMapState(scene);
  if (!state.configured || !state.route || !state.next) return null;
  const route = routeData(scene);
  route.navigationApprovals ??= {};
  route.navigationApprovals[state.next.key] = true;
  await scene.setFlag(SYSTEM_ID, ROUTE_FLAG, route);
  return state.next;
}

/** Add the terrain-adjusted off-road movement cost for circling around an encounter. */
export async function addTravelDetour(scene = currentScene()) {
  if (!game.user?.isGM) return null;
  const state = travelMapState(scene);
  if (!state.configured || !state.route) return null;
  const costs = { road: 1, open: 1, woods: 2, hills: 2, mountains: 3, water: 1, swamp: 4, ruins: 2 };
  const terrain = state.next?.terrain === "road" ? state.current?.terrain ?? "open" : state.next?.terrain ?? "open";
  const route = routeData(scene);
  route.detourCost = whole(route.detourCost) + (costs[terrain] ?? 1);
  await scene.setFlag(SYSTEM_ID, ROUTE_FLAG, route);
  return { terrain, cost: costs[terrain] ?? 1 };
}

/** Replace the next route hex with the closest left/right adjacent hex after failed navigation. */
export async function deviateTravelRoute(direction, scene = currentScene()) {
  if (!game.user?.isGM || !["left", "right"].includes(direction)) return null;
  const state = travelMapState(scene);
  if (!state.configured || !state.route || !state.current || !state.next) return null;
  const origin = offset(state.current);
  const intended = offset(state.next);
  const destination = offset(state.destination);
  const originPoint = scene.grid.getCenterPoint(origin);
  const intendedPoint = scene.grid.getCenterPoint(intended);
  const intendedAngle = Math.atan2(intendedPoint.y - originPoint.y, intendedPoint.x - originPoint.x);
  const candidates = scene.grid.getAdjacentOffsets(origin).map(offset).filter(Boolean)
    .filter((entry) => !sameOffset(entry, intended))
    .map((entry) => {
      const point = scene.grid.getCenterPoint(entry);
      let delta = Math.atan2(point.y - originPoint.y, point.x - originPoint.x) - intendedAngle;
      while (delta <= -Math.PI) delta += Math.PI * 2;
      while (delta > Math.PI) delta -= Math.PI * 2;
      return { entry, delta };
    })
    .filter((candidate) => direction === "right" ? candidate.delta > 0 : candidate.delta < 0)
    .sort((left, right) => Math.abs(left.delta) - Math.abs(right.delta));
  const wrong = candidates[0]?.entry;
  if (!wrong) return null;
  const route = routeData(scene);
  route.origin = origin;
  route.path = [origin, ...directPath(scene, wrong, destination)];
  route.navigationApprovals ??= {};
  route.navigationApprovals[offsetKey(wrong)] = true;
  route.deviation = { direction, intended, actual: wrong, at: Date.now() };
  await scene.setFlag(SYSTEM_ID, ROUTE_FLAG, route);
  return travelHexData(scene, wrong);
}

function addControlTools(controls) {
  if (!isTravelEnabled()) return;
  const tokenControl = Array.isArray(controls)
    ? controls.find((control) => control.name === "tokens")
    : controls?.tokens;
  if (!tokenControl) return;
  const add = (tool) => {
    if (Array.isArray(tokenControl.tools)) {
      if (!tokenControl.tools.some((entry) => entry.name === tool.name)) tokenControl.tools.push(tool);
    } else {
      tokenControl.tools ??= {};
      tool.order ??= Object.keys(tokenControl.tools).length;
      tokenControl.tools[tool.name] = tool;
    }
  };
  add({ name: "yze-travel-map-config", title: "YZE.TravelMap.Configure", icon: "fa-solid fa-map", button: true, visible: game.user?.isGM === true, onChange: () => configureTravelMap() });
  add({ name: "yze-travel-map-route", title: "YZE.TravelMap.PlanRoute", icon: "fa-solid fa-route", button: true, visible: game.user?.isGM === true, onChange: () => planTravelRoute() });
  add({ name: "yze-travel-map-clear", title: "YZE.TravelMap.ClearRoute", icon: "fa-solid fa-eraser", button: true, visible: game.user?.isGM === true, onChange: () => clearTravelRoute() });
}

function rerenderTravelSheets() {
  if (!isTravelEnabled()) return;
  for (const actor of game.actors ?? []) {
    if (actor.sheet?.rendered) actor.sheet.render({ force: false });
  }
}

export function registerTravelMapHooks() {
  Hooks.on("getSceneControlButtons", addControlTools);
  Hooks.on("updateScene", (scene) => {
    if (scene?.id === currentScene()?.id) rerenderTravelSheets();
  });
  Hooks.on("updateRegion", (region) => {
    if (region?.parent?.id === currentScene()?.id) rerenderTravelSheets();
  });
}
