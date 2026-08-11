import { DICE_SYSTEMS, SPECIALTY_EFFECTS } from "./constants.mjs";
import {
  formatStepRatingLabel,
  getDiceSystem,
  getPersonalityFields,
  isMagicEnabled,
  isSuccessfulSkillUseEnabled
} from "./settings.mjs";
import {
  specialtyEffect,
  specialtyStackLimit,
  specialtyTarget
} from "./specialties.mjs";

const XP_QUESTIONS = Object.freeze([
  "Participated",
  "Explored",
  "DefeatedAdversary",
  "OvercameWithoutForce",
  "FollowedTrait",
  "ExtraordinaryAction"
]);

function escape(value) {
  return foundry.utils.escapeHTML(String(value));
}

function integer(value, { min = 0, max = 999 } = {}) {
  const number = Math.trunc(Number(value) || 0);
  return Math.min(max, Math.max(min, number));
}

function canManage(actor) {
  return Boolean(actor) && (actor.isOwner !== false || game.user?.isGM === true);
}

function currentExperience(actor) {
  return integer(actor?.system?.experience);
}

function experienceLedger(actor) {
  const ledger = actor?.toObject()?.system?.experienceLedger;
  return foundry.utils.deepClone(Array.isArray(ledger) ? ledger : []);
}

function transactionType(amount, requestedType = "") {
  if (["award", "spend", "opening"].includes(requestedType)) return requestedType;
  return amount > 0 ? "award" : "spend";
}

/** Change an Actor's XP balance and append the corresponding audit entry. */
export async function recordExperienceTransaction(actor, amount, description, { type = "" } = {}) {
  if (!canManage(actor)) throw new Error(game.i18n.localize("YZE.Advancement.NotAllowed"));
  const delta = Math.trunc(Number(amount) || 0);
  if (delta === 0) throw new Error(game.i18n.localize("YZE.Advancement.ZeroAdjustment"));
  const previousBalance = currentExperience(actor);
  const balance = previousBalance + delta;
  if (balance < 0) throw new Error(game.i18n.localize("YZE.Advancement.NotEnoughXP"));

  const ledger = experienceLedger(actor);
  const entry = {
    id: foundry.utils.randomID(),
    type: transactionType(delta, type),
    amount: delta,
    balance,
    description: String(description || game.i18n.localize("YZE.Advancement.UnspecifiedTransaction")).trim(),
    timestamp: Date.now(),
    worldTime: Math.max(0, Number(game.time?.worldTime) || 0),
    userId: game.user?.id ?? "",
    userName: game.user?.name ?? ""
  };
  ledger.push(entry);
  await actor.update({
    "system.experience": balance,
    "system.experienceLedger": ledger
  });
  return { ...entry, previousBalance };
}

async function rollbackExperienceTransaction(actor, transaction) {
  if (!transaction?.id) return;
  const ledger = experienceLedger(actor).filter((entry) => entry.id !== transaction.id);
  await actor.update({
    "system.experience": Math.max(0, currentExperience(actor) - transaction.amount),
    "system.experienceLedger": ledger
  });
}

export function skillAdvancementCost(targetLevel, { stepDice = false } = {}) {
  const target = Math.trunc(Number(targetLevel));
  const maximum = stepDice ? 4 : 5;
  if (!Number.isFinite(target) || target < 1 || target > maximum) return null;
  return target * 5;
}

function targetLabel(level, stepDice) {
  if (!stepDice) return String(level);
  return formatStepRatingLabel(level, { none: "—" });
}

function normalName(value) {
  return String(value).trim().toLocaleLowerCase();
}

function worldItems(type) {
  return [...game.items]
    .filter((item) => item.type === type && item.visible !== false)
    .sort((a, b) => a.name.localeCompare(b.name));
}

function ownedEffectCount(actor, effect) {
  return actor.items.filter((item) => (
    item.type === "specialty" && specialtyEffect(item) === effect
  )).length;
}

function advancementChoices(actor) {
  const stepDice = getDiceSystem() === DICE_SYSTEMS.STEP;
  const field = stepDice ? "stepRating" : "rating";
  const maximum = stepDice ? 4 : 5;
  const choices = new Map();
  const options = [];
  const ownedSkillNames = new Set();
  const ownedSpecialtyNames = new Set();
  let index = 0;

  const skills = actor.items
    .filter((item) => item.type === "skill")
    .sort((a, b) => a.name.localeCompare(b.name));
  for (const skill of skills) {
    ownedSkillNames.add(normalName(skill.name));
    const current = integer(skill.system[field], { max: maximum });
    if (current >= maximum) continue;
    const target = current + 1;
    const cost = skillAdvancementCost(target, { stepDice });
    const id = String(index++);
    choices.set(id, {
      kind: "skill",
      itemId: skill.id,
      target,
      cost,
      name: skill.name
    });
    options.push(`<option value="${id}">${escape(game.i18n.format("YZE.Advancement.SkillOption", {
      skill: skill.name,
      level: targetLabel(target, stepDice),
      cost
    }))}</option>`);
  }


  for (const specialty of actor.items
    .filter((item) => isMagicEnabled() && item.type === "specialty" && item.system.magicDiscipline)
    .sort((a, b) => a.name.localeCompare(b.name))) {
    const current = integer(specialty.system.rank, { max: 3 });
    if (current >= 3) continue;
    const id = String(index++);
    choices.set(id, {
      kind: "magicRank",
      itemId: specialty.id,
      target: current + 1,
      name: specialty.name
    });
    options.push(`<option value="${id}">${escape(game.i18n.format(
      "YZE.Advancement.MagicRankOption",
      { specialty: specialty.name, rank: current + 1 }
    ))}</option>`);
  }

  for (const specialty of actor.items.filter((item) => item.type === "specialty")) {
    ownedSpecialtyNames.add(normalName(specialty.name));
  }

  for (const skill of worldItems("skill")) {
    if (ownedSkillNames.has(normalName(skill.name))) continue;
    const id = String(index++);
    choices.set(id, {
      kind: "newSkill",
      sourceUuid: skill.uuid,
      target: 1,
      cost: 5,
      name: skill.name
    });
    options.push(`<option value="${id}">${escape(game.i18n.format("YZE.Advancement.NewSkillOption", {
      skill: skill.name,
      level: targetLabel(1, stepDice),
      cost: 5
    }))}</option>`);
  }

  for (const specialty of worldItems("specialty")) {
    if (specialty.system.magicDiscipline && !isMagicEnabled()) continue;
    const effect = specialtyEffect(specialty);
    const ownedByName = ownedSpecialtyNames.has(normalName(specialty.name));
    const stackLimit = specialtyStackLimit(effect);
    if (specialty.system.magicDiscipline && ownedByName) continue;
    if (!effect) {
      if (ownedByName) continue;
    } else if (effect === SPECIALTY_EFFECTS.WEAPON_SPECIALIST) {
      // The target entered when spending XP identifies each distinct purchase.
    } else if (Number.isFinite(stackLimit)) {
      if (ownedEffectCount(actor, effect) >= stackLimit) continue;
    } else if (ownedByName) continue;
    const id = String(index++);
    choices.set(id, {
      kind: "specialty",
      sourceUuid: specialty.uuid,
      cost: 10,
      name: specialty.name,
      effect,
      magicDiscipline: specialty.system.magicDiscipline === true
    });
    const optionKey = specialty.system.magicDiscipline
      ? "YZE.Advancement.MagicSpecialtyOption"
      : "YZE.Advancement.SpecialtyOption";
    options.push(`<option value="${id}">${escape(game.i18n.format(optionKey, {
      specialty: specialty.name,
      cost: 10
    }))}</option>`);
  }

  return { choices, options };
}

function xpQuestionsContent(actor) {
  const xpPersonalityFields = new Set(["weakness", "darkSecret", "bigDream", "buddy", "relationships"]);
  const personalityLabels = getPersonalityFields()
    .filter((field) => field.enabled && xpPersonalityFields.has(field.key))
    .map((field) => field.label);
  const questionKeys = XP_QUESTIONS.filter((key) => key !== "FollowedTrait" || personalityLabels.length > 0);
  const personalityQuestion = personalityLabels.length > 0
    ? game.i18n.format("YZE.Advancement.Questions.FollowedConfiguredTraits", {
      traits: new Intl.ListFormat(game.i18n.lang, { style: "long", type: "disjunction" }).format(personalityLabels)
    })
    : "";
  const questions = questionKeys.map((key) => `
    <label class="checkbox-row yze-xp-question">
      <input type="checkbox" name="question" value="${key}">
      <span>${escape(key === "FollowedTrait"
        ? personalityQuestion
        : game.i18n.localize(`YZE.Advancement.Questions.${key}`))}</span>
    </label>`).join("");
  return `
    <div class="yze yze-xp-dialog">
      <p>${escape(game.i18n.format("YZE.Advancement.AwardHint", {
        actor: actor.name,
        current: currentExperience(actor)
      }))}</p>
      <fieldset>
        <legend>${escape(game.i18n.localize("YZE.Advancement.SessionQuestions"))}</legend>
        ${questions}
      </fieldset>
      <div class="form-group">
        <label>${escape(game.i18n.localize("YZE.Advancement.AdditionalXP"))}</label>
        <input type="number" name="additional" value="0" min="0" step="1">
      </div>
      <p class="hint">${escape(game.i18n.localize("YZE.Advancement.GMFinalSay"))}</p>
    </div>`;
}

export async function awardSessionExperience(actor) {
  if (!canManage(actor)) {
    ui.notifications.warn(game.i18n.localize("YZE.Advancement.NotAllowed"));
    return null;
  }
  const { DialogV2 } = foundry.applications.api;
  const result = await DialogV2.wait({
    window: { title: game.i18n.localize("YZE.Advancement.AwardTitle") },
    content: xpQuestionsContent(actor),
    buttons: [
      {
        action: "award",
        label: game.i18n.localize("YZE.Advancement.AwardXP"),
        icon: "fa-solid fa-award",
        default: true,
        callback: (event, button, dialog) => {
          const form = button.form ?? dialog.element.querySelector("form");
          return {
            questions: [...form.querySelectorAll('input[name="question"]:checked')]
              .map((input) => input.value)
              .filter((key) => XP_QUESTIONS.includes(key)),
            additional: integer(form.elements.additional?.value)
          };
        }
      },
      {
        action: "cancel",
        label: game.i18n.localize("YZE.Common.Cancel"),
        icon: "fa-solid fa-xmark",
        callback: () => null
      }
    ],
    close: () => null,
    rejectClose: false,
    modal: true
  });
  if (!result) return null;

  const total = result.questions.length + result.additional;
  if (total < 1) {
    ui.notifications.warn(game.i18n.localize("YZE.Advancement.NoXPAwarded"));
    return null;
  }

  const answerLabels = result.questions.map((key) => (
    game.i18n.localize(`YZE.Advancement.Questions.${key}`)
  ));
  const answers = answerLabels.map((answer) => `<li>${escape(answer)}</li>`);
  if (result.additional > 0) {
    const additionalLabel = game.i18n.format("YZE.Advancement.AdditionalXPEntry", {
      count: result.additional
    });
    answerLabels.push(additionalLabel);
    answers.push(`<li>${escape(additionalLabel)}</li>`);
  }
  const transaction = await recordExperienceTransaction(
    actor,
    total,
    game.i18n.format("YZE.Advancement.SessionAwardLedger", {
      details: answerLabels.join(" ")
    }),
    { type: "award" }
  );
  const next = transaction.balance;
  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    content: `
      <div class="yze chat-card yze-xp-card">
        <h3>${escape(game.i18n.format("YZE.Advancement.AwardedTitle", { actor: actor.name }))}</h3>
        <ul>${answers.join("")}</ul>
        <p><strong>${escape(game.i18n.format("YZE.Advancement.AwardedTotal", {
          gained: total,
          total: next
        }))}</strong></p>
      </div>`
  });
  return total;
}

function experienceAdjustmentContent(actor) {
  return `
    <div class="yze yze-xp-dialog">
      <p>${escape(game.i18n.format("YZE.Advancement.AdjustHint", {
        actor: actor.name,
        current: currentExperience(actor)
      }))}</p>
      <div class="form-group">
        <label>${escape(game.i18n.localize("YZE.Advancement.TransactionType"))}</label>
        <select name="transactionType">
          <option value="award">${escape(game.i18n.localize("YZE.Advancement.LedgerTypes.award"))}</option>
          <option value="spend">${escape(game.i18n.localize("YZE.Advancement.LedgerTypes.spend"))}</option>
        </select>
      </div>
      <div class="form-group">
        <label>${escape(game.i18n.localize("YZE.Advancement.Amount"))}</label>
        <input type="number" name="amount" value="1" min="1" step="1">
      </div>
      <div class="form-group stacked">
        <label>${escape(game.i18n.localize("YZE.Advancement.Reason"))}</label>
        <input type="text" name="reason" required autocomplete="off">
      </div>
      <p class="hint">${escape(game.i18n.localize("YZE.Advancement.AdjustLedgerHint"))}</p>
    </div>`;
}

/** Record a game-specific manual XP award or spend without bypassing the ledger. */
export async function promptExperienceAdjustment(actor) {
  if (!canManage(actor)) {
    ui.notifications.warn(game.i18n.localize("YZE.Advancement.NotAllowed"));
    return null;
  }
  const { DialogV2 } = foundry.applications.api;
  const selection = await DialogV2.wait({
    window: { title: game.i18n.localize("YZE.Advancement.AdjustTitle") },
    content: experienceAdjustmentContent(actor),
    buttons: [
      {
        action: "record",
        label: game.i18n.localize("YZE.Advancement.RecordTransaction"),
        icon: "fa-solid fa-book",
        default: true,
        callback: (event, button, dialog) => {
          const form = button.form ?? dialog.element.querySelector("form");
          return {
            type: form.elements.transactionType?.value === "spend" ? "spend" : "award",
            amount: integer(form.elements.amount?.value),
            reason: String(form.elements.reason?.value ?? "").trim()
          };
        }
      },
      {
        action: "cancel",
        label: game.i18n.localize("YZE.Common.Cancel"),
        icon: "fa-solid fa-xmark",
        callback: () => null
      }
    ],
    close: () => null,
    rejectClose: false,
    modal: true
  });
  if (!selection) return null;
  if (selection.amount < 1 || !selection.reason) {
    ui.notifications.warn(game.i18n.localize("YZE.Advancement.AdjustmentIncomplete"));
    return null;
  }

  let transaction;
  try {
    const amount = selection.type === "spend" ? -selection.amount : selection.amount;
    transaction = await recordExperienceTransaction(actor, amount, selection.reason, {
      type: selection.type
    });
  } catch (error) {
    ui.notifications.error(error.message || game.i18n.localize("YZE.Advancement.Failed"));
    return null;
  }
  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    content: `<div class="yze chat-card yze-xp-card">
      <h3>${escape(game.i18n.format("YZE.Advancement.AdjustedTitle", { actor: actor.name }))}</h3>
      <p>${escape(transaction.description)}</p>
      <p><strong>${escape(game.i18n.format("YZE.Advancement.AdjustedTotal", {
        change: transaction.amount > 0 ? `+${transaction.amount}` : String(transaction.amount),
        total: transaction.balance
      }))}</strong></p>
    </div>`
  });
  return transaction;
}

function advancementContent(actor, context) {
  return `
    <div class="yze yze-advancement-dialog">
      <p>${escape(game.i18n.format("YZE.Advancement.SpendHint", {
        actor: actor.name,
        current: currentExperience(actor)
      }))}</p>
      <div class="form-group stacked">
        <label>${escape(game.i18n.localize("YZE.Advancement.AdvancementChoice"))}</label>
        <select name="advancement">${context.options.join("")}</select>
      </div>
      <label class="checkbox-row">
        <input type="checkbox" name="resting">
        <span>${escape(game.i18n.localize("YZE.Advancement.RestingConfirmation"))}</span>
      </label>
      <div class="form-group stacked">
        <label>${escape(game.i18n.localize("YZE.Advancement.SpecialtyTarget"))}</label>
        <input type="text" name="effectTarget" placeholder="${escape(
          game.i18n.localize("YZE.Advancement.SpecialtyTargetPlaceholder")
        )}">
        <p class="hint">${escape(game.i18n.localize("YZE.Advancement.SpecialtyTargetHint"))}</p>
      </div>
      <label class="checkbox-row">
        <input type="checkbox" name="teacher">
        <span>${escape(game.i18n.localize("YZE.Advancement.TeacherConfirmation"))}</span>
      </label>
      <p class="hint">${escape(game.i18n.localize(
        isSuccessfulSkillUseEnabled()
          ? "YZE.Advancement.PrerequisiteHint"
          : "YZE.Advancement.PrerequisiteDisabledHint"
      ))}</p>
    </div>`;
}

function cleanEmbeddedSource(source) {
  const data = source.toObject();
  delete data._id;
  delete data.folder;
  delete data.sort;
  delete data.ownership;
  return data;
}

function advancementResultKey(result) {
  if (result.kind === "specialty") return "YZE.Advancement.LearnedSpecialty";
  if (result.kind === "magicRank") return "YZE.Advancement.IncreasedMagicRank";
  if (result.kind === "skill") return "YZE.Advancement.IncreasedSkill";
  return "YZE.Advancement.LearnedSkill";
}

function advancementLedgerDescription(result) {
  return game.i18n.format(advancementResultKey(result), result);
}

async function spendOnExistingSkill(actor, action, { teacher }) {
  const skill = actor.items.get(action.itemId);
  if (!skill || skill.type !== "skill") {
    throw new Error(game.i18n.localize("YZE.Advancement.ActorSkillMissing"));
  }
  const stepDice = getDiceSystem() === DICE_SYSTEMS.STEP;
  const field = stepDice ? "stepRating" : "rating";
  const maximum = stepDice ? 4 : 5;
  const current = integer(skill.system[field], { max: maximum });
  const target = current + 1;
  if (target > maximum) throw new Error(game.i18n.localize("YZE.Advancement.SkillAtMaximum"));
  const cost = skillAdvancementCost(target, { stepDice });
  if (isSuccessfulSkillUseEnabled() && skill.system.usedSuccessfully !== true && !teacher) {
    throw new Error(game.i18n.localize("YZE.Advancement.SkillPrerequisiteMissing"));
  }
  if (currentExperience(actor) < cost) throw new Error(game.i18n.localize("YZE.Advancement.NotEnoughXP"));

  const wasUsedSuccessfully = skill.system.usedSuccessfully === true;
  await skill.update({
    [`system.${field}`]: target,
    "system.usedSuccessfully": false
  });
  const result = { name: skill.name, level: targetLabel(target, stepDice), cost, kind: "skill" };
  try {
    await recordExperienceTransaction(actor, -cost, advancementLedgerDescription(result), {
      type: "spend"
    });
  } catch (error) {
    await skill.update({
      [`system.${field}`]: current,
      "system.usedSuccessfully": wasUsedSuccessfully
    });
    throw error;
  }
  return result;
}

async function spendOnMagicRank(actor, action, { teacher }) {
  const specialty = actor.items.get(action.itemId);
  if (!specialty || specialty.type !== "specialty" || !specialty.system.magicDiscipline) {
    throw new Error(game.i18n.localize("YZE.Advancement.ActorSpecialtyMissing"));
  }
  const current = integer(specialty.system.rank, { max: 3 });
  const target = current + 1;
  if (target > 3) throw new Error(game.i18n.localize("YZE.Advancement.MagicRankMaximum"));
  const cost = teacher ? 10 : 30;
  if (currentExperience(actor) < cost) throw new Error(game.i18n.localize("YZE.Advancement.NotEnoughXP"));

  const result = { name: specialty.name, level: target, cost, kind: "magicRank" };
  await specialty.update({ "system.rank": target });
  try {
    await recordExperienceTransaction(actor, -cost, advancementLedgerDescription(result), {
      type: "spend"
    });
  } catch (error) {
    await specialty.update({ "system.rank": current });
    throw error;
  }
  return result;
}

async function spendOnNewItem(actor, action, { teacher, effectTarget = "" }) {
  const source = await fromUuid(action.sourceUuid);
  if (!source || source.documentName !== "Item" || !["skill", "specialty"].includes(source.type)) {
    throw new Error(game.i18n.localize("YZE.Advancement.SourceMissing"));
  }
  const effect = source.type === "specialty" ? specialtyEffect(source) : "";
  const target = normalName(effectTarget);
  let duplicate = actor.items.some((item) => (
    item.type === source.type && normalName(item.name) === normalName(source.name)
  ));
  if (source.type === "specialty" && effect === SPECIALTY_EFFECTS.WEAPON_SPECIALIST) {
    if (!target) throw new Error(game.i18n.localize("YZE.Advancement.SpecialtyTargetMissing"));
    duplicate = actor.items.some((item) => (
      item.type === "specialty"
      && specialtyEffect(item) === effect
      && specialtyTarget(item) === target
    ));
  } else if (source.type === "specialty" && [
    SPECIALTY_EFFECTS.TOUGH,
    SPECIALTY_EFFECTS.HARDENED
  ].includes(effect)) {
    duplicate = ownedEffectCount(actor, effect) >= specialtyStackLimit(effect);
  }
  if (duplicate) throw new Error(game.i18n.localize("YZE.Advancement.AlreadyKnown"));

  const tracking = isSuccessfulSkillUseEnabled();
  if (source.type === "specialty" && !source.system.magicDiscipline && !teacher) {
    throw new Error(game.i18n.localize("YZE.Advancement.SpecialtyTeacherMissing"));
  }
  if (source.type === "skill" && tracking && !teacher) {
    throw new Error(game.i18n.localize("YZE.Advancement.NewSkillTeacherMissing"));
  }
  const cost = source.type === "specialty"
    ? source.system.magicDiscipline && !teacher ? 30 : 10
    : 5;
  if (currentExperience(actor) < cost) throw new Error(game.i18n.localize("YZE.Advancement.NotEnoughXP"));

  const data = cleanEmbeddedSource(source);
  if (source.type === "skill") {
    data.system.rating = 1;
    data.system.stepRating = 1;
    data.system.usedSuccessfully = false;
  } else {
    data.system.active = true;
    data.system.effect = effect;
    data.system.effectTarget = effect === SPECIALTY_EFFECTS.WEAPON_SPECIALIST ? effectTarget.trim() : "";
  }

  const result = {
    name: source.name,
    level: source.type === "skill" ? targetLabel(1, getDiceSystem() === DICE_SYSTEMS.STEP) : null,
    cost,
    kind: source.type === "skill" ? "newSkill" : "specialty"
  };
  const transaction = await recordExperienceTransaction(
    actor,
    -cost,
    advancementLedgerDescription(result),
    { type: "spend" }
  );
  try {
    await actor.createEmbeddedDocuments("Item", [data]);
  } catch (error) {
    await rollbackExperienceTransaction(actor, transaction);
    throw error;
  }
  return result;
}

export async function advanceActor(actor) {
  if (!canManage(actor)) {
    ui.notifications.warn(game.i18n.localize("YZE.Advancement.NotAllowed"));
    return null;
  }
  const context = advancementChoices(actor);
  if (context.choices.size === 0) {
    ui.notifications.warn(game.i18n.localize("YZE.Advancement.NoChoices"));
    return null;
  }

  const { DialogV2 } = foundry.applications.api;
  const selection = await DialogV2.wait({
    window: { title: game.i18n.localize("YZE.Advancement.SpendTitle") },
    content: advancementContent(actor, context),
    buttons: [
      {
        action: "advance",
        label: game.i18n.localize("YZE.Advancement.SpendXP"),
        icon: "fa-solid fa-arrow-up-right-dots",
        default: true,
        callback: (event, button, dialog) => {
          const form = button.form ?? dialog.element.querySelector("form");
          return {
            action: context.choices.get(form.elements.advancement?.value) ?? null,
            resting: form.elements.resting?.checked === true,
            teacher: form.elements.teacher?.checked === true,
            effectTarget: form.elements.effectTarget?.value ?? ""
          };
        }
      },
      {
        action: "cancel",
        label: game.i18n.localize("YZE.Common.Cancel"),
        icon: "fa-solid fa-xmark",
        callback: () => null
      }
    ],
    close: () => null,
    rejectClose: false,
    modal: true
  });
  if (!selection?.action) return null;
  if (!selection.resting) {
    ui.notifications.warn(game.i18n.localize("YZE.Advancement.RestRequired"));
    return null;
  }

  let result;
  try {
    result = selection.action.kind === "skill"
      ? await spendOnExistingSkill(actor, selection.action, selection)
      : selection.action.kind === "magicRank"
        ? await spendOnMagicRank(actor, selection.action, selection)
        : await spendOnNewItem(actor, selection.action, selection);
  } catch (error) {
    console.warn("YZE System Toolkit | Advancement failed", error);
    ui.notifications.error(error.message || game.i18n.localize("YZE.Advancement.Failed"));
    return null;
  }

  const resultKey = advancementResultKey(result);
  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    content: `
      <div class="yze chat-card yze-advancement-card">
        <h3>${escape(game.i18n.format("YZE.Advancement.AdvancedTitle", { actor: actor.name }))}</h3>
        <p>${escape(game.i18n.format(resultKey, result))}</p>
        <p>${escape(game.i18n.format("YZE.Advancement.XPRemaining", {
          total: currentExperience(actor)
        }))}</p>
      </div>`
  });
  return result;
}
