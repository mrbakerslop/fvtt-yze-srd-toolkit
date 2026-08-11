import { readdir, readFile, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { ClassicLevel } from "classic-level";
import { WORLD_GUIDE_SOURCES } from "../module/srd-content/world-guide.mjs";

const PACK_NAMES = Object.freeze([
  "srd-actors",
  "srd-items",
  "srd-roll-tables",
  "srd-cards",
  "world-setup-guide"
]);

const projectRoot = resolve(import.meta.dirname, "..");

for (const name of PACK_NAMES) {
  const sourceDirectory = resolve(projectRoot, "packs-src", name);
  const packDirectory = resolve(projectRoot, "packs", name);
  const sources = name === "world-setup-guide"
    ? WORLD_GUIDE_SOURCES.map((source) => structuredClone(source))
    : await Promise.all((await readdir(sourceDirectory))
      .filter((file) => file.endsWith(".json"))
      .sort()
      .map(async (file) => JSON.parse(await readFile(resolve(sourceDirectory, file), "utf8"))));

  await rm(packDirectory, { recursive: true, force: true });
  const database = new ClassicLevel(packDirectory, {
    keyEncoding: "utf8",
    valueEncoding: "json"
  });
  await database.open();
  const batch = database.batch();

  for (const source of sources) {
    const key = source._key;
    if (!key) throw new Error(`${name} contains a source with no _key.`);
    delete source._key;
    batch.put(key, source);
  }

  await batch.write();
  await database.close();
  console.log(`Built ${name}: ${sources.length} database entries.`);
}
