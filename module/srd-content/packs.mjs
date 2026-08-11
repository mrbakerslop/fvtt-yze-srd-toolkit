import { SYSTEM_ID } from "../constants.mjs";
import {
  WORLD_GUIDE_PAGES,
  WORLD_GUIDE_UUID
} from "./world-guide.mjs";

export const SRD_ROLL_TABLE_PACK = `${SYSTEM_ID}.srd-roll-tables`;

const tableCache = new Map();

/** Find an imported world table first, then fall back to the system compendium. */
export async function getSRDRollTable(name, { category = null } = {}) {
  const worldTable = game.tables?.find((table) => (
    (category && table.getFlag(SYSTEM_ID, "criticalInjuryCategory") === category)
    || table.name === name
  ));
  if (worldTable) return worldTable;

  const cacheKey = category ? `category:${category}` : `name:${name}`;
  if (tableCache.has(cacheKey)) return tableCache.get(cacheKey);

  const pack = game.packs?.get(SRD_ROLL_TABLE_PACK);
  if (!pack) return null;
  const documents = await pack.getDocuments();
  const table = documents.find((candidate) => (
    (category && candidate.getFlag(SYSTEM_ID, "criticalInjuryCategory") === category)
    || candidate.name === name
  )) ?? null;
  if (table) tableCache.set(cacheKey, table);
  return table;
}

/** Open the system setup guide at a specific page. */
export async function openWorldSetupGuide(page = "overview") {
  const journal = await fromUuid(WORLD_GUIDE_UUID);
  if (!journal) {
    ui.notifications.error(game.i18n.localize("YZE.WorldSetup.GuideMissing"));
    return null;
  }
  journal.sheet.render({ force: true, pageId: WORLD_GUIDE_PAGES[page] ?? WORLD_GUIDE_PAGES.overview });
  return journal;
}
