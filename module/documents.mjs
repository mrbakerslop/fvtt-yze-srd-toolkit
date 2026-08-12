import {
  ATTRIBUTE_KEYS,
  HARM_MODELS,
  SPECIALTY_EFFECTS,
  SYSTEM_ID
} from "./constants.mjs";
import { calculateHealthResolve } from "./derived-stats.mjs";
import { rollDicePool } from "./dice/dice-pool.mjs";
import { rollStepDice } from "./dice/step-dice.mjs";
import { promptRollModifiers } from "./dice/roll-dialog.mjs";
import { findAttemptLock, recordAttemptLock } from "./attempts.mjs";
import {
  getAttributeLabels,
  getHarmModel,
  isCriticalInjuriesEnabled,
  isStepDiceEnabled
} from "./settings.mjs";
import {
  announceBroken,
  applyCriticalInjuryRollDamage,
  getActorBrokenState,
  getActorCriticalInjuryTriggerState,
  getCriticalInjuryRollRestriction,
  getCriticalInjuryWeaponRestriction,
  notifyCriticalInjuryRestriction,
  rollCriticalInjury
} from "./critical-injuries.mjs";
import { countPushSuccesses } from "./dice/push.mjs";
import { isActorCatatonic } from "./panic.mjs";
import {
  maximumPushes,
  promptSpecialtyAttribute,
  specialtyEffect
} from "./specialties.mjs";
import { completeTimedDeathSave } from "./injury-timing.mjs";
import { spendHelperActions } from "./helping.mjs";

export class YZEActor extends Actor {
  async _preUpdate(changed, options, user) {
    if (this.type === "mount") {
      const changedHealth = Number(
        foundry.utils.getProperty(changed, "system.resources.health.value")
        ?? changed["system.resources.health.value"]
      );
      if (Number.isFinite(changedHealth)) {
        foundry.utils.setProperty(changed, "system.perished", changedHealth <= 0);
      }
      return super._preUpdate(changed, options, user);
    }
    if (this.type === "vehicle") {
      const changedHull = Number(
        foundry.utils.getProperty(changed, "system.hull.value")
        ?? changed["system.hull.value"]
      );
      const changedDestroyed = foundry.utils.getProperty(changed, "system.destroyed")
        ?? changed["system.destroyed"];
      if (Number.isFinite(changedHull) || changedDestroyed === true) {
        foundry.utils.setProperty(
          changed,
          "system.wrecked",
          (Number.isFinite(changedHull) ? changedHull <= 0 : this.system.hull.value <= 0)
            || changedDestroyed === true
            || this.system.destroyed === true
        );
      }
      for (const [current, maximum] of [
        ["system.armor", "system.armorMax"],
        ["system.armorStepRating", "system.armorStepMax"]
      ]) {
        const next = Number(foundry.utils.getProperty(changed, current));
        const changedCap = Number(foundry.utils.getProperty(changed, maximum));
        const cap = Number(foundry.utils.getProperty(changed, maximum) ?? foundry.utils.getProperty(this, maximum));
        if (Number.isFinite(next) && (!Number.isFinite(cap) || next > cap)) {
          foundry.utils.setProperty(changed, maximum, next);
        } else if (Number.isFinite(changedCap)) {
          const currentValue = Number.isFinite(next)
            ? next
            : Number(foundry.utils.getProperty(this, current));
          if (Number.isFinite(currentValue) && currentValue > changedCap) {
            foundry.utils.setProperty(changed, current, changedCap);
          }
        }
      }
    } else {
      for (const attribute of ATTRIBUTE_KEYS) {
        for (const [current, maximum] of [
          ["value", "maxValue"],
          ["stepRating", "maxStepRating"]
        ]) {
          const path = `system.attributes.${attribute}`;
          const next = Number(foundry.utils.getProperty(changed, `${path}.${current}`));
          const cap = Number(
            foundry.utils.getProperty(changed, `${path}.${maximum}`)
            ?? foundry.utils.getProperty(this, `${path}.${maximum}`)
          );
          const changedCap = Number(foundry.utils.getProperty(changed, `${path}.${maximum}`));
          const tracksAttributeDamage = getHarmModel() === HARM_MODELS.ATTRIBUTE_DAMAGE;
          if (Number.isFinite(next) && (
            !tracksAttributeDamage || !Number.isFinite(cap) || next > cap
          )) {
            foundry.utils.setProperty(changed, `${path}.${maximum}`, next);
          } else if (Number.isFinite(changedCap)) {
            const currentValue = Number.isFinite(next)
              ? next
              : Number(foundry.utils.getProperty(this, `${path}.${current}`));
            if (Number.isFinite(currentValue) && currentValue > changedCap) {
              foundry.utils.setProperty(changed, `${path}.${current}`, changedCap);
            }
          }
        }
      }
      const stressPath = "system.resources.stress.value";
      const changedStress = Number(
        foundry.utils.getProperty(changed, stressPath) ?? changed[stressPath]
      );
      if (changedStress === 0) {
        foundry.utils.setProperty(changed, "system.panic.active", false);
        foundry.utils.setProperty(changed, "system.panic.total", 0);
        foundry.utils.setProperty(changed, "system.panic.key", "");
        foundry.utils.setProperty(changed, "system.panic.title", "");
        foundry.utils.setProperty(changed, "system.panic.effect", "");
        foundry.utils.setProperty(changed, "system.panic.effects", []);
      }
    }
    this._yzeBrokenBeforeUpdate = getActorBrokenState(this);
    this._yzeCriticalBeforeUpdate = getActorCriticalInjuryTriggerState(this);
    return super._preUpdate(changed, options, user);
  }

  _onUpdate(changed, options, userId) {
    super._onUpdate(changed, options, userId);
    if (this.type === "mount") return;
    if (userId !== game.user?.id || options?.yzeSkipBrokenNotification) return;

    const before = this._yzeBrokenBeforeUpdate ?? { physical: false, mental: false };
    const after = getActorBrokenState(this);
    const newlyBroken = after.categories.filter((category) => before[category] !== true);
    this._yzeBrokenBeforeUpdate = after;
    const criticalBefore = this._yzeCriticalBeforeUpdate ?? {
      physical: false,
      mental: false
    };
    const criticalAfter = getActorCriticalInjuryTriggerState(this);
    const newlyCritical = criticalAfter.categories.filter(
      (category) => criticalBefore[category] !== true
    );
    this._yzeCriticalBeforeUpdate = criticalAfter;
    if (before.broken && !after.broken) {
      const usedSecondWind = this.items.filter((item) => (
        item.type === "specialty"
        && specialtyEffect(item) === SPECIALTY_EFFECTS.SECOND_WIND
        && item.system.used === true
      ));
      if (usedSecondWind.length > 0) {
        this.updateEmbeddedDocuments("Item", usedSecondWind.map((item) => ({
          _id: item.id,
          "system.used": false
        }))).catch((error) => {
          console.warn("YZE System Toolkit | Could not reset Second Wind", error);
        });
      }
    }
    const canRollCritical = isCriticalInjuriesEnabled()
      && options?.yzeSkipCriticalInjury !== true;
    if (newlyBroken.length > 0 || (canRollCritical && newlyCritical.length > 0)) {
      const handleCriticalState = async () => {
        if (newlyBroken.length > 0) await announceBroken(this, newlyBroken, {
          rollInjury: canRollCritical,
          injuryCategories: newlyCritical,
          pushedDamage: options?.yzeSkipCriticalInjury === true
            && options?.yzeEnvironmentalDamage !== true,
          environmentalDamage: options?.yzeEnvironmentalDamage === true,
          sourceActorUuid: options?.yzeCriticalSourceUuid ?? null
        });
        const extraCategories = newlyCritical.filter(
          (category) => !newlyBroken.includes(category)
        );
        if (!canRollCritical || extraCategories.length === 0) return;
        const sourceActor = options?.yzeCriticalSourceUuid && typeof fromUuid === "function"
          ? await fromUuid(options.yzeCriticalSourceUuid)
          : null;
        for (const category of extraCategories) {
          await rollCriticalInjury(this, category, { sourceActor });
        }
      };
      handleCriticalState().catch((error) => {
        console.error("YZE System Toolkit | Could not resolve Broken or Critical Injury state", error);
      });
    }
  }

  prepareDerivedData() {
    super.prepareDerivedData();

    if (this.type === "vehicle" && this.system?.hull) {
      const hull = this.system.hull;
      if (typeof hull.value === "number" && typeof hull.max === "number") {
        hull.value = Math.clamp(hull.value, 0, hull.max);
      }
      for (const [current, maximum] of [
        ["armor", "armorMax"],
        ["armorStepRating", "armorStepMax"]
      ]) {
        if (typeof this.system[current] === "number" && typeof this.system[maximum] === "number") {
          this.system[current] = Math.clamp(this.system[current], 0, this.system[maximum]);
        }
      }
      return;
    }

    if (this.type === "mount" && this.system?.resources?.health) {
      const attribute = this.system.attributes?.strength;
      const maximum = isStepDiceEnabled()
        ? Number(attribute?.stepRating) || 0
        : Number(attribute?.value) || 0;
      this.system.resources.health.max = maximum;
      this.system.resources.health.value = Math.clamp(
        Number(this.system.resources.health.value) || 0,
        0,
        maximum
      );
      return;
    }

    if (!this.system?.resources) return;
    const maximums = calculateHealthResolve(this, {
      stepDice: isStepDiceEnabled()
    });
    this.system.resources.health.max = maximums.health;
    this.system.resources.resolve.max = maximums.resolve;

    for (const resource of Object.values(this.system.resources)) {
      if (typeof resource?.value !== "number" || typeof resource?.max !== "number") continue;
      resource.value = Math.clamp(resource.value, 0, resource.max);
    }
  }

  async rollAttribute(attributeKey, {
    canPush = null,
    canOppose = true,
    rollType = null,
    rollMode = "publicroll",
    forceRollMode = false,
    allowAttemptTracking = true,
    helpAction = null,
    allowHelpers = true,
    excludedHelperUuids = []
  } = {}) {
    if (!ATTRIBUTE_KEYS.includes(attributeKey)) {
      throw new Error(`Unknown YZE attribute: ${attributeKey}`);
    }
    if (this.system.dead === true) {
      ui.notifications.warn(game.i18n.format("YZE.CriticalInjury.DeadCannotRoll", { actor: this.name }));
      return null;
    }
    const injuryRestriction = getCriticalInjuryRollRestriction(this, attributeKey);
    if (injuryRestriction) {
      notifyCriticalInjuryRestriction(this, injuryRestriction);
      return null;
    }
    if (getActorBrokenState(this).broken) {
      ui.notifications.warn(game.i18n.format("YZE.CriticalInjury.BrokenCannotRoll", {
        actor: this.name
      }));
      return null;
    }
    if (isActorCatatonic(this)) {
      ui.notifications.warn(game.i18n.format("YZE.Panic.CatatonicCannotRoll", { actor: this.name }));
      return null;
    }

    const labels = getAttributeLabels();
    const modifiers = await promptRollModifiers({
      actor: this,
      label: labels[attributeKey],
      attributeKey,
      canPush,
      rollType,
      rollMode,
      forceRollMode,
      allowAttemptTracking: allowAttemptTracking && ![...(game.combat?.combatants ?? [])].some((combatant) => (
        combatant.actor?.uuid === this.uuid || (!this.isToken && combatant.actorId === this.id)
      )),
      helpAction,
      allowHelpers,
      excludedHelperUuids
    });
    if (!modifiers) return null;
    const priorAttempt = findAttemptLock(this, modifiers.attemptGoal);
    if (priorAttempt) {
      ui.notifications.warn(game.i18n.format("YZE.Attempts.AlreadyAttempted", {
        actor: this.name,
        goal: priorAttempt.goal
      }));
      return null;
    }
    for (const selected of modifiers.gearItems ?? []) {
      const weapon = this.items.get(selected.id);
      if (weapon?.type !== "weapon") continue;
      const weaponRestriction = getCriticalInjuryWeaponRestriction(this, weapon);
      if (!weaponRestriction) continue;
      notifyCriticalInjuryRestriction(this, weaponRestriction);
      return null;
    }
    if (!await spendHelperActions(this, modifiers.helpers, modifiers.helpAction)) return null;
    let message;
    if (isStepDiceEnabled()) {
      message = await rollStepDice({
        actor: this,
        label: labels[attributeKey],
        attributeKey,
        canPush: modifiers.canPush,
        rollType: modifiers.rollType,
        rollMode: modifiers.rollMode,
        attemptGoal: modifiers.attemptGoal,
        canOppose,
        maxPushes: maximumPushes(this, attributeKey),
        attributeRating: this.system.attributes[attributeKey].stepRating,
        modifier: modifiers.totalModifier,
        modifierMode: modifiers.modifierMode,
        advantage: modifiers.advantage,
        advantages: modifiers.advantages,
        disadvantages: modifiers.disadvantages,
        helpers: modifiers.helpers,
        helpAction: modifiers.helpAction,
        modifierBreakdown: modifiers.breakdown,
        automaticSuccesses: modifiers.automaticSuccesses,
        replaceWithAutomaticSuccesses: modifiers.replaceWithAutomaticSuccesses
      });
    } else {
      message = await rollDicePool({
        actor: this,
        label: labels[attributeKey],
        attributeKey,
        canPush: modifiers.canPush,
        canOppose,
        rollType: modifiers.rollType,
        rollMode: modifiers.rollMode,
        attemptGoal: modifiers.attemptGoal,
        maxPushes: maximumPushes(this, attributeKey),
        attributeDice: this.system.attributes[attributeKey].value,
        gearDice: modifiers.gearDice,
        gearItems: modifiers.gearItems,
        modifier: modifiers.generalModifier,
        modifierTotal: modifiers.totalModifier,
        helpers: modifiers.helpers,
        helpAction: modifiers.helpAction,
        modifierBreakdown: modifiers.breakdown,
        automaticSuccesses: modifiers.automaticSuccesses,
        replaceWithAutomaticSuccesses: modifiers.replaceWithAutomaticSuccesses
      });
    }
    if (message && modifiers.prideUsed) {
      await this.update({ "system.personality.pride.used": true });
    }
    if (message && modifiers.automaticEffectIds?.length > 0) {
      const { consumeMagicAutomaticSuccesses } = await import("./magic.mjs");
      await consumeMagicAutomaticSuccesses(this, modifiers.automaticEffectIds);
    }
    if (message && modifiers.attemptGoal) {
      await recordAttemptLock(this, {
        goal: modifiers.attemptGoal,
        rollLabel: labels[attributeKey],
        messageId: message.id
      });
    }
    return message;
  }

  async rollSkill(itemId, {
    allowBroken = false,
    canPush = null,
    canOppose = true,
    rollType = null,
    rollMode = "publicroll",
    forceRollMode = false,
    allowAttemptTracking = null,
    fixedGearIds = [],
    fixedModifiers = [],
    labelOverride = "",
    attributeOverride = null,
    attributeRatingOverride = null,
    ammoDice = 0,
    applyInjuryDamage = true,
    attack = null,
    recovery = null,
    chase = null,
    travel = null,
    mount = null,
    vehicleManeuver = null,
    aerialCrash = null,
    hazard = null,
    surprise = null,
    retreat = null,
    interception = null,
    ignoreInjuryRestrictions = false,
    helpAction = null,
    allowHelpers = true,
    excludedHelperUuids = []
  } = {}) {
    const skill = this.items.get(itemId);
    if (!skill || skill.type !== "skill") {
      throw new Error(`Unknown YZE Skill Item: ${itemId}`);
    }
    if (this.system.dead === true) {
      ui.notifications.warn(game.i18n.format("YZE.CriticalInjury.DeadCannotRoll", { actor: this.name }));
      return null;
    }
    if (!ignoreInjuryRestrictions) {
      const actionRestriction = getCriticalInjuryRollRestriction(this, null);
      if (actionRestriction) {
        notifyCriticalInjuryRestriction(this, actionRestriction);
        return null;
      }
    }
    if (!allowBroken && getActorBrokenState(this).broken) {
      ui.notifications.warn(game.i18n.format("YZE.CriticalInjury.BrokenCannotRoll", {
        actor: this.name
      }));
      return null;
    }
    if (isActorCatatonic(this)) {
      ui.notifications.warn(game.i18n.format("YZE.Panic.CatatonicCannotRoll", { actor: this.name }));
      return null;
    }

    const defaultAttributeKey = skill.system.attribute;
    const attributeKey = ATTRIBUTE_KEYS.includes(attributeOverride)
      ? attributeOverride
      : await promptSpecialtyAttribute(this, skill, defaultAttributeKey);
    if (!attributeKey) return null;
    if (!ATTRIBUTE_KEYS.includes(attributeKey)) {
      throw new Error(`Skill ${skill.name} has an invalid linked attribute.`);
    }
    if (!ignoreInjuryRestrictions) {
      const injuryRestriction = getCriticalInjuryRollRestriction(this, attributeKey);
      if (injuryRestriction) {
        notifyCriticalInjuryRestriction(this, injuryRestriction);
        return null;
      }
    }

    const labels = getAttributeLabels();
    const label = String(labelOverride || `${skill.name} (${labels[attributeKey]})`);
    const structuredRoll = Boolean(
      attack || recovery || chase || travel || mount || vehicleManeuver || aerialCrash || hazard || surprise || retreat || interception
    );
    const trackAttempts = (allowAttemptTracking ?? !structuredRoll)
      && ![...(game.combat?.combatants ?? [])].some((combatant) => (
        combatant.actor?.uuid === this.uuid || (!this.isToken && combatant.actorId === this.id)
      ));
    const modifiers = await promptRollModifiers({
      actor: this,
      label,
      attributeKey,
      skillName: skill.name,
      canPush,
      rollType,
      rollMode,
      forceRollMode,
      allowAttemptTracking: trackAttempts,
      helpAction,
      allowHelpers,
      excludedHelperUuids,
      fixedGearIds,
      fixedModifiers
    });
    if (!modifiers) return null;
    const priorAttempt = findAttemptLock(this, modifiers.attemptGoal);
    if (priorAttempt) {
      ui.notifications.warn(game.i18n.format("YZE.Attempts.AlreadyAttempted", {
        actor: this.name,
        goal: priorAttempt.goal
      }));
      return null;
    }
    for (const selected of modifiers.gearItems ?? []) {
      const weapon = this.items.get(selected.id);
      if (weapon?.type !== "weapon") continue;
      const weaponRestriction = getCriticalInjuryWeaponRestriction(this, weapon);
      if (!weaponRestriction) continue;
      notifyCriticalInjuryRestriction(this, weaponRestriction);
      return null;
    }
    if (!await spendHelperActions(this, modifiers.helpers, modifiers.helpAction)) return null;
    if (applyInjuryDamage) {
      await applyCriticalInjuryRollDamage(this, {
        attributeKey,
        skillName: skill.name
      });
    }
    let message;
    if (isStepDiceEnabled()) {
      message = await rollStepDice({
        actor: this,
        label,
        attributeKey,
        canPush: modifiers.canPush,
        rollType: modifiers.rollType,
        rollMode: modifiers.rollMode,
        attemptGoal: modifiers.attemptGoal,
        canOppose,
        maxPushes: maximumPushes(this, attributeKey, { skillRoll: true, skillName: skill.name }),
        attributeRating: attributeRatingOverride !== null && attributeRatingOverride !== ""
          && Number.isFinite(Number(attributeRatingOverride))
          ? Number(attributeRatingOverride)
          : this.system.attributes[attributeKey].stepRating,
        skillRating: skill.system.stepRating,
        modifier: modifiers.totalModifier,
        modifierMode: modifiers.modifierMode,
        advantage: modifiers.advantage,
        advantages: modifiers.advantages,
        disadvantages: modifiers.disadvantages,
        helpers: modifiers.helpers,
        helpAction: modifiers.helpAction,
        ammoDice,
        modifierBreakdown: modifiers.breakdown,
        attack,
        recovery,
        chase,
        travel,
        mount,
        vehicleManeuver,
        aerialCrash,
        hazard,
        surprise,
        retreat,
        interception,
        automaticSuccesses: modifiers.automaticSuccesses,
        replaceWithAutomaticSuccesses: modifiers.replaceWithAutomaticSuccesses
      });
    } else {
      message = await rollDicePool({
        actor: this,
        label,
        attributeKey,
        canPush: modifiers.canPush,
        canOppose,
        rollType: modifiers.rollType,
        rollMode: modifiers.rollMode,
        attemptGoal: modifiers.attemptGoal,
        maxPushes: maximumPushes(this, attributeKey, { skillRoll: true, skillName: skill.name }),
        attributeDice: attributeRatingOverride !== null && attributeRatingOverride !== ""
          && Number.isFinite(Number(attributeRatingOverride))
          ? Number(attributeRatingOverride)
          : this.system.attributes[attributeKey].value,
        skillDice: skill.system.rating,
        gearDice: modifiers.gearDice,
        gearItems: modifiers.gearItems,
        modifier: modifiers.generalModifier,
        modifierTotal: modifiers.totalModifier,
        helpers: modifiers.helpers,
        helpAction: modifiers.helpAction,
        modifierBreakdown: modifiers.breakdown,
        ammoDice,
        attack,
        recovery,
        chase,
        travel,
        mount,
        vehicleManeuver,
        aerialCrash,
        hazard,
        surprise,
        retreat,
        interception,
        automaticSuccesses: modifiers.automaticSuccesses,
        replaceWithAutomaticSuccesses: modifiers.replaceWithAutomaticSuccesses
      });
    }
    if (message && modifiers.automaticEffectIds?.length > 0) {
      const { consumeMagicAutomaticSuccesses } = await import("./magic.mjs");
      await consumeMagicAutomaticSuccesses(this, modifiers.automaticEffectIds);
    }
    if (message && modifiers.prideUsed) {
      await this.update({ "system.personality.pride.used": true });
    }
    if (message && modifiers.attemptGoal) {
      await recordAttemptLock(this, {
        goal: modifiers.attemptGoal,
        rollLabel: label,
        messageId: message.id
      });
    }
    return message;
  }

  async rollDeathSave(itemId) {
    const injury = this.items.get(itemId);
    if (!isCriticalInjuriesEnabled() || !injury || injury.type !== "criticalInjury"
      || !injury.system.active || !injury.system.lethal
      || injury.system.stabilized || injury.system.instantDeath) return null;

    const skillName = String(injury.system.deathSaveSkill || "Stamina").trim();
    const skill = this.items.find((item) => (
      item.type === "skill" && item.name.localeCompare(skillName, undefined, { sensitivity: "base" }) === 0
    ));
    if (!skill) {
      ui.notifications.error(game.i18n.format("YZE.CriticalInjury.DeathSaveSkillMissing", {
        skill: skillName,
        injury: injury.name
      }));
      return null;
    }

    const message = await this.rollSkill(skill.id, {
      allowBroken: true,
      ignoreInjuryRestrictions: true,
      canPush: false,
      allowHelpers: false,
      applyInjuryDamage: false,
      fixedModifiers: [[
        game.i18n.format("YZE.CriticalInjury.DeathSaveModifier", { injury: injury.name }),
        injury.system.deathSaveModifier
      ]]
    });
    if (!message) return null;

    const state = message.getFlag(SYSTEM_ID, "push");
    const succeeded = countPushSuccesses(state) > 0;
    await completeTimedDeathSave(injury, succeeded);
    if (!succeeded) await this.update({ "system.dead": true });
    await ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor: this }),
      content: `<div class="yze chat-card yze-death-save"><p>${foundry.utils.escapeHTML(
        game.i18n.format(
          succeeded ? "YZE.CriticalInjury.DeathSaveSucceeded" : "YZE.CriticalInjury.DeathSaveFailed",
          { actor: this.name, injury: injury.name }
        )
      )}</p></div>`
    });
    return message;
  }
}

export class YZEItem extends Item {
  async _preUpdate(changed, options, user) {
    if (this.type === "criticalInjury") {
      const changedValue = (path) => (
        foundry.utils.getProperty(changed, path) ?? changed[path]
      );
      const changedInstantDeath = changedValue("system.instantDeath");
      const instantDeath = typeof changedInstantDeath === "boolean"
        ? changedInstantDeath
        : this.system.instantDeath === true;
      const changedLethal = changedValue("system.lethal");
      const lethal = instantDeath
        ? true
        : typeof changedLethal === "boolean" ? changedLethal : this.system.lethal === true;
      const changedPermanent = changedValue("system.permanent");
      const permanent = typeof changedPermanent === "boolean"
        ? changedPermanent
        : this.system.permanent === true;
      if (instantDeath === true) {
        foundry.utils.setProperty(changed, "system.lethal", true);
        foundry.utils.setProperty(changed, "system.stabilized", false);
      } else if (lethal === false) {
        foundry.utils.setProperty(changed, "system.stabilized", false);
        foundry.utils.setProperty(changed, "system.timeLimit", "");
      }
      if (lethal === true && !String(
        changedValue("system.deathSaveSkill") ?? this.system.deathSaveSkill ?? ""
      ).trim()) {
        foundry.utils.setProperty(changed, "system.deathSaveSkill", "Stamina");
      }
      if (permanent === true) {
        foundry.utils.setProperty(changed, "system.healingTime", "");
      }
    }
    if (this.type === "armor") {
      for (const [current, maximum] of [
        ["system.rating", "system.maxRating"],
        ["system.stepRating", "system.maxStepRating"]
      ]) {
        const next = Number(foundry.utils.getProperty(changed, current));
        const changedCap = Number(foundry.utils.getProperty(changed, maximum));
        const cap = Number(foundry.utils.getProperty(changed, maximum) ?? foundry.utils.getProperty(this, maximum));
        if (Number.isFinite(next) && (!Number.isFinite(cap) || next > cap)) {
          foundry.utils.setProperty(changed, maximum, next);
        } else if (Number.isFinite(changedCap)) {
          const currentValue = Number.isFinite(next)
            ? next
            : Number(foundry.utils.getProperty(this, current));
          if (Number.isFinite(currentValue) && currentValue > changedCap) {
            foundry.utils.setProperty(changed, current, changedCap);
          }
        }
      }
    }
    if (["gear", "weapon"].includes(this.type)) {
      for (const [current, maximum] of [
        ["system.bonus", "system.maxBonus"],
        ["system.reliability.value", "system.reliability.max"]
      ]) {
        const next = Number(foundry.utils.getProperty(changed, current));
        const changedCap = Number(foundry.utils.getProperty(changed, maximum));
        const cap = Number(foundry.utils.getProperty(changed, maximum)
          ?? foundry.utils.getProperty(this, maximum));
        if (Number.isFinite(next) && (!Number.isFinite(cap) || next > cap)) {
          foundry.utils.setProperty(changed, maximum, next);
        } else if (Number.isFinite(changedCap)) {
          const currentValue = Number.isFinite(next)
            ? next
            : Number(foundry.utils.getProperty(this, current));
          if (Number.isFinite(currentValue) && currentValue > changedCap) {
            foundry.utils.setProperty(changed, current, changedCap);
          }
        }
      }
    }
    return super._preUpdate(changed, options, user);
  }

  _onCreate(data, options, userId) {
    super._onCreate(data, options, userId);
    this._applyInstantDeath(userId);
  }

  _onUpdate(changed, options, userId) {
    super._onUpdate(changed, options, userId);
    this._applyInstantDeath(userId);
  }

  _applyInstantDeath(userId) {
    const actor = this.parent;
    if (userId !== game.user?.id || actor?.documentName !== "Actor") return;
    if (!isCriticalInjuriesEnabled()) return;
    if (this.type !== "criticalInjury" || !this.system.active || !this.system.instantDeath) return;
    if (actor.system?.dead === true || (actor.isOwner === false && !game.user?.isGM)) return;

    actor.update({ "system.dead": true }).then(() => {
      ui.notifications.error(game.i18n.format("YZE.CriticalInjury.InstantDeathApplied", {
        actor: actor.name,
        injury: this.name
      }));
    }).catch((error) => {
      console.error("YZE System Toolkit | Could not apply instant-death injury", error);
    });
  }
}
