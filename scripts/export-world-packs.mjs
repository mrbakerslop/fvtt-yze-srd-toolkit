import { cp, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { ClassicLevel } from "classic-level";

const SYSTEM_ID = "fvtt-yze-srd";
const projectRoot = resolve(import.meta.dirname, "..");
const worldPath = resolve(process.argv[2] ?? process.env.YZE_WORLD_PATH ?? "");
const dataPath = resolve(worldPath, "data");

if (!worldPath || basename(dataPath) !== "data") {
  throw new Error("Pass the Foundry world directory as the first argument or YZE_WORLD_PATH.");
}

const temporaryRoot = await mkdtemp(join(tmpdir(), "yze-pack-export-"));
const collectionNames = ["actors", "items", "tables", "cards", "folders"];

async function copyAndReadCollection(name) {
  const source = resolve(dataPath, name);
  const copy = resolve(temporaryRoot, name);
  await cp(source, copy, { recursive: true });
  const database = new ClassicLevel(copy, {
    keyEncoding: "utf8",
    valueEncoding: "json",
    readOnly: true
  });
  const entries = [];
  for await (const [key, value] of database.iterator()) entries.push({ key, value });
  await database.close();
  return entries;
}

const collections = Object.fromEntries(await Promise.all(collectionNames.map(async (name) => [
  name,
  await copyAndReadCollection(name)
])));

function isSeeded(value) {
  return Boolean(value?.flags?.[SYSTEM_ID]?.srdKey);
}

function cleanSource(value) {
  const source = structuredClone(value);
  delete source._stats;
  if (source.ownership) {
    source.ownership = { default: Number(source.ownership.default) || 0 };
  }
  return source;
}

function slug(value) {
  return String(value || "entry")
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, "-")
    .replaceAll(/^-|-$/g, "")
    .slice(0, 72);
}

function primaryEntries(collection, keyPrefix) {
  return collections[collection].filter(({ key, value }) => (
    key.startsWith(keyPrefix)
    && !key.slice(keyPrefix.length).includes(".")
    && isSeeded(value)
  ));
}

function embeddedEntries(collection, rootIds) {
  return collections[collection].filter(({ key }) => {
    if (!key.startsWith(`!${collection}.`)) return false;
    const parent = key.slice(key.indexOf("!", 1) + 1).split(".")[0];
    return rootIds.has(parent);
  });
}

function folderEntries(folderIds) {
  const pending = new Set(folderIds);
  const selected = [];
  while (pending.size > 0) {
    const id = pending.values().next().value;
    pending.delete(id);
    const entry = collections.folders.find(({ value }) => value._id === id);
    if (!entry || selected.some(({ value }) => value._id === id)) continue;
    selected.push(entry);
    if (entry.value.folder) pending.add(entry.value.folder);
  }
  return selected;
}

function fixCardsSource(source) {
  source.img = "icons/svg/card-joker.svg";
  for (const face of source.faces ?? []) face.img = "icons/svg/card-joker.svg";
  if (source.back) source.back.img = "icons/svg/card-joker.svg";
}

const itemRoots = primaryEntries("items", "!items!");
const criticalInjuries = new Map(itemRoots.flatMap(({ value }) => {
  const key = value.flags?.[SYSTEM_ID]?.criticalInjuryKey;
  return key ? [[key, value._id]] : [];
}));

const specifications = [
  { name: "srd-actors", collection: "actors", prefix: "!actors!" },
  { name: "srd-items", collection: "items", prefix: "!items!" },
  { name: "srd-roll-tables", collection: "tables", prefix: "!tables!" },
  { name: "srd-cards", collection: "cards", prefix: "!cards!" }
];

for (const specification of specifications) {
  const roots = specification.collection === "items"
    ? itemRoots
    : primaryEntries(specification.collection, specification.prefix);
  const rootIds = new Set(roots.map(({ value }) => value._id));
  const embedded = embeddedEntries(specification.collection, rootIds);
  const folders = folderEntries(new Set(roots.map(({ value }) => value.folder).filter(Boolean)));
  const entries = [...roots, ...embedded, ...folders];
  const output = resolve(projectRoot, "packs-src", specification.name);

  await rm(output, { recursive: true, force: true });
  await mkdir(output, { recursive: true });

  for (const { key, value } of entries) {
    const source = cleanSource(value);
    if (specification.collection === "cards") fixCardsSource(source);
    if (specification.collection === "tables" && source.flags?.[SYSTEM_ID]?.criticalInjuryKey) {
      const itemId = criticalInjuries.get(source.flags[SYSTEM_ID].criticalInjuryKey);
      if (!itemId) throw new Error(`No Critical Injury Item for ${source.name}.`);
      source.documentUuid = `Compendium.${SYSTEM_ID}.srd-items.Item.${itemId}`;
    }
    source._key = key;
    const filename = key.startsWith("!folders!")
      ? `_folder-${source._id}.json`
      : `${slug(source.name)}-${source._id}.json`;
    await writeFile(resolve(output, filename), `${JSON.stringify(source, null, 2)}\n`);
  }

  console.log(`Exported ${specification.name}: ${entries.length} database entries.`);
}

await rm(temporaryRoot, { recursive: true, force: true });
