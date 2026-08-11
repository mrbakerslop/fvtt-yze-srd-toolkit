import { SYSTEM_ID } from "../constants.mjs";
import { SPELL_EFFECT_TYPES } from "../item-effects.mjs";
import { CORE_SKILLS } from "../default-content.mjs";
import {
  specialtyItemEffects,
  SRD_CONSUMABLES,
  SRD_ITEM_GROUPS,
  SRD_SPECIALTIES,
  SRD_SPELLS,
  SRD_VEHICLES,
  SRD_WEAPONS
} from "./items.mjs";
import { SRD_JOURNAL } from "./journals.mjs";
import { SRD_ROLL_TABLES } from "./tables.mjs";
import { SRD_CRITICAL_INJURIES } from "./critical-injuries.mjs";
import { SRD_INITIATIVE_DECK } from "./cards.mjs";

const SRD_CONTENT_VERSION = 22;

const MAGIC_DISCIPLINES = new Set([
  "awareness", "healing", "shapeshifting", "blood magic",
  "death magic", "elementalism", "symbolism"
]);

function normalize(value) {
  return String(value).trim().toLowerCase();
}

function contentKey(documentType, type, name) {
  return `${documentType}:${type}:${normalize(name).replaceAll(/[^a-z0-9]+/g, "-")}`;
}

async function getOrCreateFolder(name, type) {
  let folder = game.folders.find((candidate) => (
    candidate.type === type && candidate.name === name
  ));

  if (!folder) {
    [folder] = await Folder.implementation.createDocuments([{ name, type }]);
  }
  return folder;
}

function coreSkillItems() {
  return CORE_SKILLS.map((skill) => ({
    name: skill.name,
    type: "skill",
    img: "icons/svg/book.svg",
    system: {
      attribute: skill.attribute,
      rating: 0,
      stepRating: 0,
      usedSuccessfully: false,
      description: `<p>${skill.description}</p>`
    }
  }));
}

function itemExists(definition, key) {
  return game.items.some((item) => (
    item.getFlag(SYSTEM_ID, "srdKey") === key
    || (item.type === definition.type && normalize(item.name) === normalize(definition.name))
  ));
}

async function createItems() {
  const groups = [
    { folder: "YZE Core Skills", items: coreSkillItems() },
    ...SRD_ITEM_GROUPS
  ];
  const created = [];

  for (const group of groups) {
    const folder = await getOrCreateFolder(group.folder, "Item");
    const missing = group.items.flatMap((definition) => {
      const key = contentKey("item", definition.type, definition.name);
      if (itemExists(definition, key)) return [];
      const source = foundry.utils.deepClone(definition);
      if (["gear", "weapon"].includes(source.type)) {
        source.system.maxBonus ??= Number(source.system.bonus) || 0;
      }

      return [{
        ...source,
        folder: folder.id,
        ownership: source.ownership ?? {
          default: CONST.DOCUMENT_OWNERSHIP_LEVELS.OBSERVER
        },
        flags: {
          ...(source.flags ?? {}),
          [SYSTEM_ID]: {
            ...(source.flags?.[SYSTEM_ID] ?? {}),
            srdKey: key
          }
        }
      }];
    });

    if (missing.length > 0) {
      try {
        created.push(...await Item.implementation.createDocuments(missing));
      } catch (error) {
        throw new Error(`Could not seed Item group "${group.folder}": ${error.message}`, {
          cause: error
        });
      }
    }
  }

  return created;
}

async function migrateCriticalInjuryItems() {
  const definitions = new Map(SRD_CRITICAL_INJURIES.map((injury) => [injury.key, injury]));
  const updates = [];
  for (const item of game.items) {
    if (item.type !== "criticalInjury") continue;
    const definition = definitions.get(item.getFlag(SYSTEM_ID, "criticalInjuryKey"));
    if (!definition) continue;

    updates.push({
      _id: item.id,
      "system.instantDeath": definition.system.instantDeath,
      "system.deathSaveSkill": item.system.deathSaveSkill || definition.system.deathSaveSkill,
      "ownership.default": CONST.DOCUMENT_OWNERSHIP_LEVELS.OBSERVER
    });
  }
  if (updates.length > 0) await Item.implementation.updateDocuments(updates);
}

async function migrateExperienceLedgers() {
  for (const actor of game.actors) {
    if (!["character", "npc"].includes(actor.type)) continue;
    if ((actor.system.experienceLedger ?? []).length > 0) continue;
    const balance = Math.max(0, Math.trunc(Number(actor.system.experience) || 0));
    if (balance < 1) continue;
    await actor.update({
      "system.experienceLedger": [{
        id: foundry.utils.randomID(),
        type: "opening",
        amount: balance,
        balance,
        description: game.i18n.localize("YZE.Advancement.OpeningBalance"),
        timestamp: Date.now(),
        worldTime: Math.max(0, Number(game.time?.worldTime) || 0),
        userId: game.user?.id ?? "",
        userName: game.user?.name ?? ""
      }]
    });
  }
}

function seededFoodUpdate(item, definitions) {
  if (item.type !== "consumable") return null;
  const definition = definitions.get(item.getFlag(SYSTEM_ID, "srdKey"));
  if (!definition) return null;
  return {
    _id: item.id,
    "system.foodType": definition.system.foodType,
    "system.foodState": definition.system.foodState,
    "system.weight": definition.system.weight
  };
}

async function migrateSeededFood() {
  const definitions = new Map(SRD_CONSUMABLES.map((definition) => [
    contentKey("item", definition.type, definition.name),
    definition
  ]));
  const worldUpdates = [...game.items]
    .map((item) => seededFoodUpdate(item, definitions))
    .filter(Boolean);
  if (worldUpdates.length > 0) await Item.implementation.updateDocuments(worldUpdates);
  for (const actor of game.actors) {
    const actorUpdates = actor.items
      .map((item) => seededFoodUpdate(item, definitions))
      .filter(Boolean);
    if (actorUpdates.length > 0) await actor.updateEmbeddedDocuments("Item", actorUpdates);
  }
}

function criticalInjuryRestrictionUpdate(item, definitions) {
  const definition = definitions.get(item.getFlag(SYSTEM_ID, "criticalInjuryKey"));
  if (!definition) return null;
  return {
    _id: item.id,
    "system.movementRestriction": definition.system.movementRestriction,
    "system.disabledHands": definition.system.disabledHands,
    "system.blockedAttributes": definition.system.blockedAttributes,
    "system.blocksActions": definition.system.blocksActions,
    "system.sleepRestriction": definition.system.sleepRestriction,
    "system.sleepSkill": definition.system.sleepSkill,
    "system.triggerKind": definition.system.triggerKind,
    "system.specialRule": definition.system.specialRule
  };
}

async function migrateCriticalInjuryRestrictions() {
  const definitions = new Map(SRD_CRITICAL_INJURIES.map((injury) => [injury.key, injury]));
  const worldUpdates = [...game.items]
    .filter((item) => item.type === "criticalInjury")
    .map((item) => criticalInjuryRestrictionUpdate(item, definitions))
    .filter(Boolean);
  if (worldUpdates.length > 0) await Item.implementation.updateDocuments(worldUpdates);

  for (const actor of game.actors) {
    const actorUpdates = actor.items
      .filter((item) => item.type === "criticalInjury")
      .map((item) => criticalInjuryRestrictionUpdate(item, definitions))
      .filter(Boolean);
    if (actorUpdates.length > 0) await actor.updateEmbeddedDocuments("Item", actorUpdates);
  }
}

function reliabilityUpdate(item) {
  if (!["gear", "weapon"].includes(item.type)) return null;
  const source = item._source?.system?.reliability;
  if (source && Number.isFinite(Number(source.value)) && Number.isFinite(Number(source.max))) {
    return null;
  }
  return {
    _id: item.id,
    "system.reliability.value": Number.isFinite(Number(source?.value)) ? Number(source.value) : 5,
    "system.reliability.max": Number.isFinite(Number(source?.max)) ? Number(source.max) : 5
  };
}

async function migrateGearReliability() {
  const worldUpdates = [...game.items].map(reliabilityUpdate).filter(Boolean);
  if (worldUpdates.length > 0) await Item.implementation.updateDocuments(worldUpdates);

  for (const actor of game.actors) {
    const embeddedUpdates = [...actor.items].map(reliabilityUpdate).filter(Boolean);
    if (embeddedUpdates.length > 0) {
      await actor.updateEmbeddedDocuments("Item", embeddedUpdates);
    }
  }
}

function equipmentMechanicsUpdate(item) {
  if (!["gear", "weapon"].includes(item.type)) return null;
  const source = item._source?.system ?? {};
  const update = { _id: item.id };
  let changed = false;
  const currentBonus = Math.max(0, Number(source.bonus) || 0);
  const seededDefinition = item.getFlag(SYSTEM_ID, "srdKey")
    ? SRD_ITEM_GROUPS.flatMap((group) => group.items).find((definition) => (
      definition.type === item.type && normalize(definition.name) === normalize(item.name)
    ))
    : null;
  const startingBonus = Math.max(currentBonus, Number(seededDefinition?.system?.bonus) || 0);
  const maximumBonus = Number(source.maxBonus);
  if (!Number.isFinite(maximumBonus) || maximumBonus < startingBonus) {
    update["system.maxBonus"] = startingBonus;
    changed = true;
  }
  if (item.type === "gear" && item.getFlag(SYSTEM_ID, "srdKey")
    && normalize(item.name) === "backpack" && source.isBackpack !== true) {
    update["system.isBackpack"] = true;
    changed = true;
  }
  return changed ? update : null;
}

async function migrateEquipmentMechanics() {
  const worldUpdates = [...game.items].map(equipmentMechanicsUpdate).filter(Boolean);
  if (worldUpdates.length > 0) await Item.implementation.updateDocuments(worldUpdates);
  for (const actor of game.actors) {
    const embeddedUpdates = [...actor.items].map(equipmentMechanicsUpdate).filter(Boolean);
    if (embeddedUpdates.length > 0) {
      await actor.updateEmbeddedDocuments("Item", embeddedUpdates);
    }
  }
}

function universalItemEffectsUpdate(item) {
  if (item.type !== "specialty") return null;
  const source = item._source?.system ?? {};
  const existing = Array.isArray(source.effects) ? foundry.utils.deepClone(source.effects) : [];
  const additions = specialtyItemEffects(String(source.effect ?? ""))
    .filter((definition) => !existing.some((effect) => effect.type === definition.type));
  if (existing.length === 0 && additions.length === 0 && !source.effect && Number(source.bonus)) {
    additions.push({
      id: `migrated-${item.id}-modifier`,
      active: true,
      type: "rollModifier",
      target: "all",
      attribute: "",
      value: Math.trunc(Number(source.bonus))
    });
  }
  return additions.length > 0
    ? { _id: item.id, "system.effects": [...existing, ...additions] }
    : null;
}

async function migrateUniversalItemEffects() {
  const worldUpdates = [...game.items].map(universalItemEffectsUpdate).filter(Boolean);
  if (worldUpdates.length > 0) await Item.implementation.updateDocuments(worldUpdates);
  for (const actor of game.actors) {
    const embeddedUpdates = [...actor.items].map(universalItemEffectsUpdate).filter(Boolean);
    if (embeddedUpdates.length > 0) {
      await actor.updateEmbeddedDocuments("Item", embeddedUpdates);
    }
  }
}

function spellAutomationUpdate(item) {
  if (item.type !== "spell" || !item.getFlag(SYSTEM_ID, "srdKey")) return null;
  const definition = SRD_SPELLS.find((spell) => normalize(spell.name) === normalize(item.name));
  if (!definition) return null;
  const source = item._source?.system ?? {};
  const existing = Array.isArray(source.effects) ? foundry.utils.deepClone(source.effects) : [];
  const hasSpellEffects = existing.some((effect) => (
    effect.application === "spell" || SPELL_EFFECT_TYPES.includes(effect.type)
  ));
  return {
    _id: item.id,
    "system.automation": definition.system.automation,
    "system.targetMode": definition.system.targetMode,
    "system.effectCategory": definition.system.effectCategory,
    "system.effectBase": definition.system.effectBase,
    "system.effectPerPower": definition.system.effectPerPower,
    "system.effectModifier": definition.system.effectModifier,
    "system.armorApplies": definition.system.armorApplies,
    "system.affectedAttributes": definition.system.affectedAttributes,
    "system.affectedSkills": definition.system.affectedSkills,
    "system.ritualRequirements": definition.system.ritualRequirements ?? "",
    ...(!hasSpellEffects ? {
      "system.effects": [...existing, ...foundry.utils.deepClone(definition.system.effects ?? [])]
    } : {})
  };
}

async function migrateSpellAutomation() {
  const worldUpdates = [...game.items].map(spellAutomationUpdate).filter(Boolean);
  if (worldUpdates.length > 0) await Item.implementation.updateDocuments(worldUpdates);
  for (const actor of game.actors) {
    const updates = [...actor.items].map(spellAutomationUpdate).filter(Boolean);
    if (updates.length > 0) await actor.updateEmbeddedDocuments("Item", updates);
  }
}

function armorStepFromPool(value) {
  const rating = Number(value) || 0;
  if (rating >= 8) return 4;
  if (rating >= 6) return 3;
  if (rating >= 4) return 2;
  return rating > 0 ? 1 : 0;
}

function armorItemUpdate(item) {
  if (item.type !== "armor") return null;
  const source = item._source?.system ?? {};
  const stepRating = Math.min(4, Math.max(0, Math.trunc(Number(source.rating) || 0)));
  return {
    _id: item.id,
    "system.maxRating": Number(source.rating) || 0,
    "system.stepRating": stepRating,
    "system.maxStepRating": stepRating
  };
}

function personMaximumUpdate(actor) {
  if (!["character", "npc"].includes(actor.type)) return null;
  const source = actor._source?.system?.attributes ?? {};
  const update = { _id: actor.id };
  for (const key of ["strength", "agility", "wits", "empathy"]) {
    update[`system.attributes.${key}.maxValue`] = Number(source[key]?.value) || 0;
    update[`system.attributes.${key}.maxStepRating`] = Number(source[key]?.stepRating) || 0;
  }
  return update;
}

function vehicleArmorUpdate(actor) {
  if (actor.type !== "vehicle") return null;
  const source = actor._source?.system ?? {};
  const stepRating = armorStepFromPool(source.armor);
  return {
    _id: actor.id,
    "system.armorMax": Number(source.armor) || 0,
    "system.armorStepRating": stepRating,
    "system.armorStepMax": stepRating
  };
}

async function migrateHarmMaximums() {
  const worldItemUpdates = [...game.items].map(armorItemUpdate).filter(Boolean);
  if (worldItemUpdates.length > 0) await Item.implementation.updateDocuments(worldItemUpdates);

  const actorUpdates = [...game.actors]
    .map((actor) => personMaximumUpdate(actor) ?? vehicleArmorUpdate(actor))
    .filter(Boolean);
  if (actorUpdates.length > 0) await Actor.implementation.updateDocuments(actorUpdates);

  for (const actor of game.actors) {
    const embeddedUpdates = [...actor.items].map(armorItemUpdate).filter(Boolean);
    if (embeddedUpdates.length > 0) await actor.updateEmbeddedDocuments("Item", embeddedUpdates);
  }
}

async function migrateAerialVehicles() {
  const updates = [...game.actors]
    .filter((actor) => actor.type === "vehicle")
    .filter((actor) => actor.system.isAerial === true
      || normalize(actor.name) === "helicopter")
    .map((actor) => ({ _id: actor.id, "system.isAerial": true }));
  if (updates.length > 0) await Actor.implementation.updateDocuments(updates);
}

function magicDisciplineUpdate(item) {
  if (item.type !== "specialty" || !MAGIC_DISCIPLINES.has(normalize(item.name))) return null;
  return {
    _id: item.id,
    "system.magicDiscipline": true,
    "system.rank": Math.max(1, Number(item._source?.system?.rank) || 0)
  };
}

async function migrateMagicDisciplines() {
  const worldUpdates = [...game.items].map(magicDisciplineUpdate).filter(Boolean);
  if (worldUpdates.length > 0) await Item.implementation.updateDocuments(worldUpdates);
  for (const actor of game.actors) {
    const embeddedUpdates = [...actor.items].map(magicDisciplineUpdate).filter(Boolean);
    if (embeddedUpdates.length > 0) await actor.updateEmbeddedDocuments("Item", embeddedUpdates);
  }
}

function specialtyEffectUpdate(item) {
  if (item.type !== "specialty" || !item.getFlag(SYSTEM_ID, "srdKey")) return null;
  const definition = SRD_SPECIALTIES.find((entry) => normalize(entry.name) === normalize(item.name));
  if (!definition) return null;
  return {
    _id: item.id,
    "system.effect": item._source?.system?.effect || definition.system.effect || "",
    "system.effectTarget": item._source?.system?.effectTarget || ""
  };
}

async function migrateSpecialtyEffects() {
  const worldUpdates = [...game.items].map(specialtyEffectUpdate).filter(Boolean);
  if (worldUpdates.length > 0) await Item.implementation.updateDocuments(worldUpdates);
  for (const actor of game.actors) {
    const embeddedUpdates = [...actor.items].map(specialtyEffectUpdate).filter(Boolean);
    if (embeddedUpdates.length > 0) await actor.updateEmbeddedDocuments("Item", embeddedUpdates);
  }
}

function advancedWeaponUpdate(item) {
  if (item.type !== "weapon") return null;
  const source = item._source?.system ?? {};
  const definition = item.getFlag(SYSTEM_ID, "srdKey")
    ? SRD_WEAPONS.find((entry) => normalize(entry.name) === normalize(item.name))
    : null;
  const inferredAmmunition = Number(source.ammunition?.max) > 0 || Number(source.rateOfFire) > 0;
  const update = {
    _id: item.id,
    "system.usesAmmunition": typeof source.usesAmmunition === "boolean"
      ? source.usesAmmunition
      : (definition?.system?.usesAmmunition ?? inferredAmmunition),
    "system.requiresPreparation": typeof source.requiresPreparation === "boolean"
      ? source.requiresPreparation
      : (definition?.system?.requiresPreparation ?? false),
    "system.fullAuto": source.fullAuto === true,
    "system.telescopicSight": source.telescopicSight === true,
    "system.reloadAction": ["fast", "slow"].includes(source.reloadAction)
      ? source.reloadAction
      : "slow"
  };
  if (definition && !Number(source.ammunition?.max) && definition.system.ammunition?.max > 0) {
    update["system.ammunition.value"] = definition.system.ammunition.value;
    update["system.ammunition.max"] = definition.system.ammunition.max;
    update["system.rateOfFire"] = definition.system.rateOfFire;
    update["system.reloadAction"] = definition.system.reloadAction;
  }
  return update;
}

async function migrateAdvancedWeapons() {
  const worldUpdates = [...game.items].map(advancedWeaponUpdate).filter(Boolean);
  if (worldUpdates.length > 0) await Item.implementation.updateDocuments(worldUpdates);
  for (const actor of game.actors) {
    const embeddedUpdates = [...actor.items].map(advancedWeaponUpdate).filter(Boolean);
    if (embeddedUpdates.length > 0) await actor.updateEmbeddedDocuments("Item", embeddedUpdates);
  }
}

function actorExists(definition, key) {
  return game.actors.some((actor) => (
    actor.getFlag(SYSTEM_ID, "srdKey") === key
    || (actor.type === definition.type && normalize(actor.name) === normalize(definition.name))
  ));
}

async function createVehicleActors() {
  const folder = await getOrCreateFolder("YZE SRD Vehicles", "Actor");
  const missing = SRD_VEHICLES.flatMap((definition) => {
    const key = contentKey("actor", definition.type, definition.name);
    if (actorExists(definition, key)) return [];

    return [{
      ...definition,
      folder: folder.id,
      flags: {
        ...(definition.flags ?? {}),
        [SYSTEM_ID]: {
          ...(definition.flags?.[SYSTEM_ID] ?? {}),
          srdKey: key
        }
      }
    }];
  });

  if (missing.length === 0) return [];
  return Actor.implementation.createDocuments(missing);
}

function tableResultData(entry) {
  const injuryItem = entry.criticalInjuryKey
    ? game.items.find((item) => item.getFlag(SYSTEM_ID, "criticalInjuryKey") === entry.criticalInjuryKey)
    : null;

  if (injuryItem) {
    return {
      type: CONST.TABLE_RESULT_TYPES.DOCUMENT,
      name: injuryItem.name,
      description: entry.description,
      documentUuid: injuryItem.uuid,
      img: injuryItem.img,
      range: entry.range,
      weight: 1,
      drawn: false,
      flags: { [SYSTEM_ID]: { criticalInjuryKey: entry.criticalInjuryKey } }
    };
  }

  return {
    type: CONST.TABLE_RESULT_TYPES.TEXT,
    name: entry.name,
    description: entry.description,
    img: "icons/svg/d20-black.svg",
    range: entry.range,
    weight: 1,
    drawn: false
  };
}

function rollTableData(definition, folder, key) {
  return {
    name: definition.name,
    img: "icons/svg/d20-grey.svg",
    folder: folder.id,
    formula: definition.formula,
    description: definition.description,
    replacement: true,
    displayRoll: true,
    ownership: {
      default: CONST.DOCUMENT_OWNERSHIP_LEVELS.OBSERVER
    },
    flags: {
      [SYSTEM_ID]: {
        srdKey: key,
        criticalInjuryCategory: definition.criticalInjuryCategory
      }
    },
    results: definition.results.map(tableResultData)
  };
}

async function synchronizeCriticalInjuryTable(table, definition, key) {
  await table.update({
    formula: definition.formula,
    description: definition.description,
    replacement: true,
    displayRoll: true,
    "ownership.default": CONST.DOCUMENT_OWNERSHIP_LEVELS.OBSERVER,
    [`flags.${SYSTEM_ID}.srdKey`]: key,
    [`flags.${SYSTEM_ID}.criticalInjuryCategory`]: definition.criticalInjuryCategory
  });

  const resultIds = [...table.results].map((entry) => entry.id);
  if (resultIds.length > 0) {
    await table.deleteEmbeddedDocuments("TableResult", resultIds);
  }
  await table.createEmbeddedDocuments("TableResult", definition.results.map(tableResultData));
}

async function createRollTables({ upgradeCriticalInjuries = false } = {}) {
  const folder = await getOrCreateFolder("YZE SRD Roll Tables", "RollTable");
  const created = [];

  for (const definition of SRD_ROLL_TABLES) {
    const key = contentKey("table", "roll-table", definition.name);
    const existing = game.tables.find((table) => (
      table.getFlag(SYSTEM_ID, "srdKey") === key
      || normalize(table.name) === normalize(definition.name)
    ));

    if (!existing) {
      created.push(...await RollTable.implementation.createDocuments([
        rollTableData(definition, folder, key)
      ]));
      continue;
    }

    const isSeededTable = existing.getFlag(SYSTEM_ID, "srdKey") === key;
    if (upgradeCriticalInjuries && definition.criticalInjuryCategory && isSeededTable) {
      await synchronizeCriticalInjuryTable(existing, definition, key);
    }
  }

  return created;
}

function journalExists(definition, key) {
  return game.journal.some((journal) => (
    journal.getFlag(SYSTEM_ID, "srdKey") === key
    || normalize(journal.name) === normalize(definition.name)
  ));
}

async function createReferenceJournal() {
  const folder = await getOrCreateFolder("YZE SRD Reference", "JournalEntry");
  const key = contentKey("journal", "reference", SRD_JOURNAL.name);
  if (journalExists(SRD_JOURNAL, key)) return [];

  return JournalEntry.implementation.createDocuments([{
    ...foundry.utils.deepClone(SRD_JOURNAL),
    folder: folder.id,
    ownership: {
      default: CONST.DOCUMENT_OWNERSHIP_LEVELS.OBSERVER
    },
    flags: {
      [SYSTEM_ID]: { srdKey: key }
    }
  }]);
}

async function createInitiativeCards() {
  const key = contentKey("cards", "deck", SRD_INITIATIVE_DECK.name);
  const existing = game.cards?.find((stack) => (
    stack.getFlag(SYSTEM_ID, "srdKey") === key
    || normalize(stack.name) === normalize(SRD_INITIATIVE_DECK.name)
  ));
  if (existing) return [];

  const source = foundry.utils.deepClone(SRD_INITIATIVE_DECK);
  return Cards.implementation.createDocuments([{
    ...source,
    ownership: source.ownership ?? {
      default: CONST.DOCUMENT_OWNERSHIP_LEVELS.OBSERVER
    },
    flags: {
      ...(source.flags ?? {}),
      [SYSTEM_ID]: {
        ...(source.flags?.[SYSTEM_ID] ?? {}),
        srdKey: key
      }
    }
  }]);
}

export async function createSRDContent({ force = false } = {}) {
  if (!game.user.isGM) return { items: [], actors: [], tables: [], journals: [], cards: [] };
  const currentVersion = Number(game.settings.get(SYSTEM_ID, "srdContentVersion")) || 0;
  if (!force && currentVersion >= SRD_CONTENT_VERSION) {
    return { items: [], actors: [], tables: [], journals: [], cards: [] };
  }

  const items = await createItems();
  if (currentVersion < 5) await migrateCriticalInjuryItems();
  if (currentVersion < 6) await migrateGearReliability();
  if (currentVersion < 8) await migrateHarmMaximums();
  if (currentVersion < 9) await migrateMagicDisciplines();
  if (force || currentVersion < 10) await migrateSpecialtyEffects();
  if (force || currentVersion < 21) await migrateAdvancedWeapons();
  if (force || currentVersion < 21) await migrateSpellAutomation();
  if (force || currentVersion < 19) await migrateAerialVehicles();
  if (force || currentVersion < 20) await migrateSeededFood();
  if (force || currentVersion < 13) await migrateEquipmentMechanics();
  if (force || currentVersion < 16) await migrateUniversalItemEffects();
  if (force || currentVersion < 21) await migrateCriticalInjuryRestrictions();
  if (force || currentVersion < 22) await migrateExperienceLedgers();
  const actors = await createVehicleActors();
  const tables = await createRollTables({ upgradeCriticalInjuries: force || currentVersion < 4 });
  const journals = await createReferenceJournal();
  const cards = await createInitiativeCards();
  await game.settings.set(SYSTEM_ID, "srdContentCreated", true);
  await game.settings.set(SYSTEM_ID, "srdContentVersion", SRD_CONTENT_VERSION);
  await game.settings.set(SYSTEM_ID, "coreSkillsCreated", true);

  if (items.length > 0 || actors.length > 0 || tables.length > 0 || journals.length > 0 || cards.length > 0) {
    ui.notifications.info(game.i18n.format("YZE.Defaults.SRDContentCreated", {
      items: items.length,
      actors: actors.length,
      tables: tables.length,
      journals: journals.length,
      cards: cards.length
    }));
  }

  return { items, actors, tables, journals, cards };
}
