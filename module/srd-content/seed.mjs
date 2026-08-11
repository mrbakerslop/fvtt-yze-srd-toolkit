import { SYSTEM_ID } from "../constants.mjs";
import { SPELL_EFFECT_TYPES } from "../item-effects.mjs";
import {
  specialtyItemEffects,
  SRD_CONSUMABLES,
  SRD_SPECIALTIES,
  SRD_SPELLS,
  SRD_WEAPONS
} from "./items.mjs";
import { SRD_CRITICAL_INJURIES } from "./critical-injuries.mjs";

const SRD_CONTENT_VERSION = 23;

const MAGIC_DISCIPLINES = new Set([
  "awareness", "healing", "shapeshifting", "blood magic",
  "death magic", "elementalism", "symbolism"
]);

function normalize(value) {
  return String(value ?? "").trim().toLowerCase();
}

function contentKey(documentType, type, name) {
  return `${documentType}:${type}:${normalize(name).replaceAll(/[^a-z0-9]+/g, "-")}`;
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

async function removeObsoleteReferenceJournal() {
  const journal = game.journal.find((entry) => (
    entry.getFlag(SYSTEM_ID, "srdKey") === "journal:reference:year-zero-engine-srd"
  ));
  if (journal) await journal.delete();

  const folder = game.folders.find((entry) => (
    entry.type === "JournalEntry" && entry.name === "YZE SRD Reference"
  ));
  if (folder && folder.contents.length === 0 && folder.children.length === 0) await folder.delete();
}

/** Run migrations for existing world documents without creating SRD content. */
export async function migrateWorldData({ force = false } = {}) {
  if (!game.user.isGM) return false;
  const currentVersion = Number(game.settings.get(SYSTEM_ID, "srdContentVersion")) || 0;
  if (!force && currentVersion >= SRD_CONTENT_VERSION) return false;

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
  if (force || currentVersion < 23) await removeObsoleteReferenceJournal();
  await game.settings.set(SYSTEM_ID, "srdContentVersion", SRD_CONTENT_VERSION);
  return true;
}
