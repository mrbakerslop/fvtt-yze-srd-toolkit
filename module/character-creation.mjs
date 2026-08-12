import { ATTRIBUTE_KEYS, DICE_SYSTEMS, STEP_RATINGS, SYSTEM_ID } from "./constants.mjs";
import {
  formatStepRatingLabel,
  getAttributeLabels,
  getCharacterHeaderFields,
  getDiceSystem
} from "./settings.mjs";

const STARTING_ATTRIBUTE_POINTS = 14;
const STARTING_SKILL_POINTS = 10;
const STARTING_STEP_ATTRIBUTE_TOTAL = 11;
const STARTING_STEP_SKILL_TOTAL = 10;
const STARTING_STEP_SKILL_COUNTS = Object.freeze({ 1: 3, 2: 2, 3: 1 });

function escape(value) {
  return foundry.utils.escapeHTML(String(value ?? ""));
}

function normalName(value) {
  return String(value ?? "").trim().toLocaleLowerCase();
}

function integer(value, { min = 0, max = 99 } = {}) {
  return Math.min(max, Math.max(min, Math.trunc(Number(value) || 0)));
}

function worldItems(type) {
  return [...game.items]
    .filter((item) => item.type === type && item.visible !== false)
    .sort((left, right) => left.name.localeCompare(right.name));
}

async function referencedItems(uuids, types) {
  const allowed = new Set(Array.isArray(types) ? types : [types]);
  const documents = await Promise.all([...new Set(uuids ?? [])].map((uuid) => fromUuid(uuid)));
  return documents.filter((document) => document?.documentName === "Item" && allowed.has(document.type));
}

function defaultPoolAttributes() {
  return Object.fromEntries(ATTRIBUTE_KEYS.map((key) => [key, 2]));
}

function defaultStepAttributes() {
  return Object.fromEntries(ATTRIBUTE_KEYS.map((key) => [key, 2]));
}

function defaultPoolSkills(skills) {
  return new Map(skills.map((skill) => [skill.uuid, 0]));
}

function defaultStepSkills(skills) {
  return new Map(skills.map((skill) => [skill.uuid, 0]));
}

function allocationSummary(stepDice) {
  return stepDice
    ? game.i18n.localize("YZE.CharacterCreation.StepAllocationHint")
    : game.i18n.localize("YZE.CharacterCreation.PoolAllocationHint");
}

function ratingControl(name, value, minimum, maximum, label, { stepDice = false } = {}) {
  const escapedName = escape(name);
  const escapedLabel = escape(label);
  return `<div class="yze-creation-stepper">
    <button type="button" data-action="adjustCreationRating" data-rating="${escapedName}" data-delta="-1" aria-label="${escape(
      game.i18n.format("YZE.CharacterCreation.DecreaseRating", { rating: label })
    )}"><i class="fa-solid fa-minus" aria-hidden="true"></i></button>
    ${stepDice
      ? `<input name="${escapedName}" type="hidden" value="${value}" min="${minimum}" max="${maximum}" data-step-rating>
        <output class="yze-creation-step-value" data-step-rating-label aria-label="${escapedLabel}">${escape(formatStepRatingLabel(value))}</output>`
      : `<input name="${escapedName}" type="number" value="${value}" min="${minimum}" max="${maximum}" readonly aria-label="${escapedLabel}">`}
    <button type="button" data-action="adjustCreationRating" data-rating="${escapedName}" data-delta="1" aria-label="${escape(
      game.i18n.format("YZE.CharacterCreation.IncreaseRating", { rating: label })
    )}"><i class="fa-solid fa-plus" aria-hidden="true"></i></button>
  </div>`;
}

function creationContent(actor, archetype, sources) {
  const stepDice = getDiceSystem() === DICE_SYSTEMS.STEP;
  const labels = getAttributeLabels();
  const completed = actor.system.creation?.completed === true;
  const attributeDefaults = completed
    ? Object.fromEntries(ATTRIBUTE_KEYS.map((key) => [
      key, Number(actor.system.attributes[key][stepDice ? "stepRating" : "value"])
    ]))
    : stepDice
      ? defaultStepAttributes()
      : defaultPoolAttributes();
  const keySkillUuids = new Set(sources.keySkills.map((skill) => skill.uuid));
  const skillDefaults = stepDice
    ? defaultStepSkills(sources.skills)
    : defaultPoolSkills(sources.skills);
  if (completed) {
    for (const skill of sources.skills) {
      const owned = actor.items.find((item) => item.type === "skill"
        && normalName(item.name) === normalName(skill.name));
      if (owned) skillDefaults.set(skill.uuid, Number(owned.system[stepDice ? "stepRating" : "rating"]));
    }
  }

  const attributes = ATTRIBUTE_KEYS.map((key) => {
    const keyAttribute = key === archetype.system.keyAttribute;
    const maximum = keyAttribute ? 5 : 4;
    const value = stepDice
      ? attributeDefaults[key]
      : integer(attributeDefaults[key], { min: 2, max: maximum });
    const control = stepDice
      ? ratingControl(`attribute-${key}`, value, 1, 4, labels[key], { stepDice: true })
      : ratingControl(`attribute-${key}`, value, 2, maximum, labels[key]);
    const content = `<span>${escape(labels[key])}${keyAttribute ? ` <strong>${escape(game.i18n.localize("YZE.CharacterCreation.Key"))}</strong>` : ""}</span>${control}`;
    return stepDice
      ? `<div class="yze-creation-rating" data-step-attribute>${content}</div>`
      : `<div class="yze-creation-rating" data-pool-attribute>${content}</div>`;
  }).join("");

  const skills = sources.skills.map((skill) => {
    const keySkill = keySkillUuids.has(skill.uuid);
    const selected = skillDefaults.get(skill.uuid) ?? 0;
    const maximum = keySkill ? 3 : 1;
    const control = stepDice
      ? ratingControl(`skill-${skill.id}`, selected, 0, keySkill ? 3 : 2, skill.name, { stepDice: true })
      : ratingControl(
        `skill-${skill.id}`,
        integer(selected, { max: maximum }),
        0,
        maximum,
        skill.name
      );
    const content = `<span>${escape(skill.name)}${keySkill ? ` <strong>${escape(game.i18n.localize("YZE.CharacterCreation.Key"))}</strong>` : ""}</span>${control}`;
    return stepDice
      ? `<div class="yze-creation-rating" data-skill-uuid="${escape(skill.uuid)}" data-step-skill>${content}</div>`
      : `<div class="yze-creation-rating" data-skill-uuid="${escape(skill.uuid)}" data-pool-skill>${content}</div>`;
  }).join("");

  const choices = (items, name, chosen) => {
    if (items.length === 0) return `<p class="hint">${escape(game.i18n.localize("YZE.Common.None"))}</p>`;
    const selected = new Set(completed ? items
      .filter((item) => actor.items.some((owned) => owned.type === item.type
        && normalName(owned.name) === normalName(item.name)))
      .slice(0, chosen)
      .map((item) => item.uuid) : []);
    return items.map((item) => `<label class="checkbox-row"><input type="checkbox" name="${name}" value="${escape(item.uuid)}"${selected.has(item.uuid) ? " checked" : ""}><span>${escape(item.name)}</span></label>`).join("");
  };
  const grants = sources.grantedItems.length > 0
    ? `<p>${sources.grantedItems.map((item) => escape(item.name)).join(", ")}</p>`
    : `<p class="hint">${escape(game.i18n.localize("YZE.Common.None"))}</p>`;

  return `<div class="yze yze-character-creation">
    <h2>${escape(archetype.name)}</h2>
    <p>${escape(allocationSummary(stepDice))}</p>
    <fieldset><legend>${escape(game.i18n.localize("YZE.Actor.Attributes"))}</legend><div class="yze-creation-grid">${attributes}</div><div class="yze-creation-total" data-attribute-allocation><span>${escape(game.i18n.localize(stepDice ? "YZE.CharacterCreation.AttributeSteps" : "YZE.CharacterCreation.AttributePoints"))}</span><output data-attribute-total aria-live="polite"></output></div></fieldset>
    <fieldset><legend>${escape(game.i18n.localize("YZE.Actor.Skills"))}</legend><div class="yze-creation-grid skill-grid">${skills}</div><div class="yze-creation-total" data-skill-allocation><span>${escape(game.i18n.localize(stepDice ? "YZE.CharacterCreation.SkillDistribution" : "YZE.CharacterCreation.SkillPoints"))}</span><output data-skill-total aria-live="polite"></output></div></fieldset>
    <fieldset><legend>${escape(game.i18n.format("YZE.CharacterCreation.ChooseSpecialties", { count: sources.specialtyChoices }))}</legend>${choices(sources.specialties, "specialty", sources.specialtyChoices)}<div class="yze-creation-total" data-specialty-allocation><span>${escape(game.i18n.localize("YZE.CharacterCreation.SpecialtyPicks"))}</span><output data-specialty-total aria-live="polite"></output></div></fieldset>
    <fieldset><legend>${escape(game.i18n.localize("YZE.CharacterCreation.GrantedEquipment"))}</legend>${grants}</fieldset>
    <fieldset><legend>${escape(game.i18n.format("YZE.CharacterCreation.ChooseEquipment", { count: sources.equipmentChoices }))}</legend>${choices(sources.equipment, "equipment", sources.equipmentChoices)}<div class="yze-creation-total" data-equipment-allocation><span>${escape(game.i18n.localize("YZE.CharacterCreation.EquipmentPicks"))}</span><output data-equipment-total aria-live="polite"></output></div></fieldset>
    <p class="hint">${escape(game.i18n.localize("YZE.CharacterCreation.NonDestructiveHint"))}</p>
  </div>`;
}

function wireCreationDialog(dialog, sources, archetype) {
  const root = dialog.element.querySelector(".yze-character-creation");
  const form = root?.closest("form");
  if (!root || !form || root.dataset.controlsReady === "true") return;
  root.dataset.controlsReady = "true";

  const applyButton = form.querySelector('button[data-action="create"]');
  const stepDice = getDiceSystem() === DICE_SYSTEMS.STEP;
  const poolAttributeInputs = [...form.querySelectorAll("[data-pool-attribute] input")];
  const poolSkillInputs = [...form.querySelectorAll("[data-pool-skill] input")];
  const stepAttributeInputs = [...form.querySelectorAll("[data-step-attribute] input[data-step-rating]")];
  const stepSkillInputs = [...form.querySelectorAll("[data-step-skill] input[data-step-rating]")];
  const groups = [
    {
      inputs: poolAttributeInputs,
      maximum: STARTING_ATTRIBUTE_POINTS,
      output: form.querySelector("[data-attribute-total]"),
      row: form.querySelector("[data-attribute-allocation]")
    },
    {
      inputs: poolSkillInputs,
      maximum: STARTING_SKILL_POINTS,
      output: form.querySelector("[data-skill-total]"),
      row: form.querySelector("[data-skill-allocation]")
    }
  ];
  const choiceGroups = [
    {
      inputs: [...form.querySelectorAll('input[name="specialty"]')],
      maximum: sources.specialtyChoices,
      output: form.querySelector("[data-specialty-total]"),
      row: form.querySelector("[data-specialty-allocation]")
    },
    {
      inputs: [...form.querySelectorAll('input[name="equipment"]')],
      maximum: sources.equipmentChoices,
      output: form.querySelector("[data-equipment-total]"),
      row: form.querySelector("[data-equipment-allocation]")
    }
  ];

  const valuesFor = (inputs, changedInput = null, changedValue = null) => inputs.map((input) => (
    input === changedInput
      ? changedValue
      : integer(input.value, { min: Number(input.min), max: Number(input.max) })
  ));

  const stepSkillCounts = (values) => Object.fromEntries(
    [0, 1, 2, 3].map((rating) => [rating, values.filter((value) => value === rating).length])
  );

  const canAdjustStepRating = (input, delta) => {
    const minimum = Number(input.min);
    const maximum = Number(input.max);
    const current = integer(input.value, { min: minimum, max: maximum });
    const candidate = current + delta;
    if (candidate < minimum || candidate > maximum) return false;

    if (stepAttributeInputs.includes(input)) {
      const values = valuesFor(stepAttributeInputs, input, candidate);
      return values.reduce((total, value) => total + value, 0) <= STARTING_STEP_ATTRIBUTE_TOTAL;
    }
    if (stepSkillInputs.includes(input)) {
      const values = valuesFor(stepSkillInputs, input, candidate);
      return values.reduce((total, value) => total + value, 0) <= STARTING_STEP_SKILL_TOTAL
        && values.filter((value) => value === 3).length <= 1;
    }
    return false;
  };

  const sync = () => {
    for (const group of groups) {
      if (group.inputs.length === 0) continue;
      const total = group.inputs.reduce((sum, input) => sum + integer(input.value, {
        min: Number(input.min), max: Number(input.max)
      }), 0);
      if (group.output) group.output.textContent = `${total} / ${group.maximum}`;
      group.row?.classList.toggle("is-valid", total === group.maximum);
      group.row?.classList.toggle("is-invalid", total !== group.maximum);

      for (const input of group.inputs) {
        const stepper = input.closest(".yze-creation-stepper");
        const minimum = Number(input.min);
        const maximum = Number(input.max);
        const value = integer(input.value, { min: minimum, max: maximum });
        const decrease = stepper?.querySelector('[data-delta="-1"]');
        const increase = stepper?.querySelector('[data-delta="1"]');
        if (decrease) decrease.disabled = value <= minimum;
        if (increase) increase.disabled = value >= maximum || total >= group.maximum;
      }
    }
    if (stepDice) {
      const attributeValues = valuesFor(stepAttributeInputs);
      const attributeSteps = attributeValues.reduce((total, value) => total + value - 2, 0);
      const attributeValid = attributeValues.length === ATTRIBUTE_KEYS.length
        && attributeSteps === 3
        && attributeValues.filter((value) => value === 1).length <= 1;
      const attributeOutput = form.querySelector("[data-attribute-total]");
      const attributeRow = form.querySelector("[data-attribute-allocation]");
      if (attributeOutput) attributeOutput.textContent = `${attributeSteps} / 3`;
      attributeRow?.classList.toggle("is-valid", attributeValid);
      attributeRow?.classList.toggle("is-invalid", !attributeValid);

      const skillCounts = stepSkillCounts(valuesFor(stepSkillInputs));
      const skillValid = skillCounts[3] === STARTING_STEP_SKILL_COUNTS[3]
        && skillCounts[2] === STARTING_STEP_SKILL_COUNTS[2]
        && skillCounts[1] === STARTING_STEP_SKILL_COUNTS[1];
      const skillOutput = form.querySelector("[data-skill-total]");
      const skillRow = form.querySelector("[data-skill-allocation]");
      if (skillOutput) skillOutput.textContent = game.i18n.format(
        "YZE.CharacterCreation.SkillDistributionSummary",
        {
          bLabel: formatStepRatingLabel(3), b: skillCounts[3],
          cLabel: formatStepRatingLabel(2), c: skillCounts[2],
          dLabel: formatStepRatingLabel(1), d: skillCounts[1]
        }
      );
      skillRow?.classList.toggle("is-valid", skillValid);
      skillRow?.classList.toggle("is-invalid", !skillValid);

      for (const input of [...stepAttributeInputs, ...stepSkillInputs]) {
        const stepper = input.closest(".yze-creation-stepper");
        const output = stepper?.querySelector("[data-step-rating-label]");
        if (output) output.textContent = formatStepRatingLabel(Number(input.value));
        const decrease = stepper?.querySelector('[data-delta="-1"]');
        const increase = stepper?.querySelector('[data-delta="1"]');
        if (decrease) decrease.disabled = !canAdjustStepRating(input, -1);
        if (increase) increase.disabled = !canAdjustStepRating(input, 1);
      }
    }
    for (const group of choiceGroups) {
      const selected = group.inputs.filter((input) => input.checked).length;
      if (group.output) group.output.textContent = `${selected} / ${group.maximum}`;
      group.row?.classList.toggle("is-valid", selected === group.maximum);
      group.row?.classList.toggle("is-invalid", selected !== group.maximum);
      const atLimit = selected >= group.maximum;
      for (const input of group.inputs) input.disabled = !input.checked && atLimit;
    }

    if (applyButton) {
      applyButton.disabled = Boolean(readCreationForm(form, sources, archetype).error);
    }
  };

  root.addEventListener("click", (event) => {
    const button = event.target.closest('[data-action="adjustCreationRating"]');
    if (!button || !root.contains(button)) return;
    const input = form.elements[button.dataset.rating];
    if (!input) return;
    const minimum = Number(input.min);
    const maximum = Number(input.max);
    const delta = Number(button.dataset.delta) || 0;
    const group = groups.find((entry) => entry.inputs.includes(input));
    const groupTotal = group?.inputs.reduce((sum, entry) => sum + integer(entry.value, {
      min: Number(entry.min), max: Number(entry.max)
    }), 0) ?? 0;
    if (stepDice) {
      if (!canAdjustStepRating(input, delta)) return;
    } else if (!group || (delta > 0 && groupTotal >= group.maximum)) return;
    const current = integer(input.value, { min: minimum, max: maximum });
    input.value = String(Math.min(maximum, Math.max(minimum, current + delta)));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
  form.addEventListener("input", sync);
  form.addEventListener("change", sync);
  sync();
}

function readCreationForm(form, sources, archetype) {
  const stepDice = getDiceSystem() === DICE_SYSTEMS.STEP;
  const attributes = Object.fromEntries(ATTRIBUTE_KEYS.map((key) => [
    key, integer(form.elements[`attribute-${key}`]?.value, { max: 5 })
  ]));
  const skills = new Map(sources.skills.map((skill) => [
    skill.uuid, integer(form.elements[`skill-${skill.id}`]?.value, { max: 5 })
  ]));
  const specialties = [...form.querySelectorAll('input[name="specialty"]:checked')]
    .map((input) => input.value);
  const equipment = [...form.querySelectorAll('input[name="equipment"]:checked')]
    .map((input) => input.value);

  if (stepDice) {
    const attributeValues = Object.values(attributes);
    if (attributeValues.some((value) => value < 1 || value > 4)
      || attributeValues.filter((value) => value === 1).length > 1
      || attributeValues.reduce((total, value) => total + value, 0) !== STARTING_STEP_ATTRIBUTE_TOTAL) {
      return { error: "YZE.CharacterCreation.InvalidStepAttributes" };
    }
    const skillValues = [...skills.values()];
    const bSkills = sources.skills.filter((skill) => skills.get(skill.uuid) === 3);
    const keyUuids = new Set(sources.keySkills.map((skill) => skill.uuid));
    if (bSkills.length !== STARTING_STEP_SKILL_COUNTS[3] || !keyUuids.has(bSkills[0].uuid)
      || skillValues.filter((value) => value === 2).length !== STARTING_STEP_SKILL_COUNTS[2]
      || skillValues.filter((value) => value === 1).length !== STARTING_STEP_SKILL_COUNTS[1]
      || skillValues.some((value) => value > 3)) {
      return { error: "YZE.CharacterCreation.InvalidStepSkills" };
    }
  } else {
    if (Object.entries(attributes).some(([key, value]) => (
      value < 2 || value > (key === archetype.system.keyAttribute ? 5 : 4)
    )) || Object.values(attributes).reduce((total, value) => total + value, 0) !== STARTING_ATTRIBUTE_POINTS) {
      return { error: "YZE.CharacterCreation.InvalidPoolAttributes" };
    }
    const keyUuids = new Set(sources.keySkills.map((skill) => skill.uuid));
    if ([...skills.entries()].some(([uuid, value]) => value > (keyUuids.has(uuid) ? 3 : 1))
      || [...skills.values()].reduce((total, value) => total + value, 0) !== STARTING_SKILL_POINTS) {
      return { error: "YZE.CharacterCreation.InvalidPoolSkills" };
    }
  }
  if (specialties.length !== sources.specialtyChoices) {
    return { error: "YZE.CharacterCreation.InvalidSpecialtyCount", data: { count: sources.specialtyChoices } };
  }
  if (equipment.length !== sources.equipmentChoices) {
    return { error: "YZE.CharacterCreation.InvalidEquipmentCount", data: { count: sources.equipmentChoices } };
  }
  return { attributes, skills, specialties, equipment, stepDice };
}

function embeddedItemData(source) {
  const data = foundry.utils.deepClone(source.toObject());
  for (const key of ["_id", "folder", "sort", "ownership", "_stats"]) delete data[key];
  data.flags ??= {};
  data.flags[SYSTEM_ID] = { ...(data.flags[SYSTEM_ID] ?? {}), sourceUuid: source.uuid };
  return data;
}

async function addMissingItems(actor, sources) {
  const existing = new Set(actor.items.map((item) => `${item.type}:${normalName(item.name)}`));
  const additions = sources.filter((source) => !existing.has(`${source.type}:${normalName(source.name)}`));
  if (additions.length > 0) {
    await actor.createEmbeddedDocuments("Item", additions.map(embeddedItemData));
  }
}

async function applyCreation(actor, archetype, sources, selection) {
  const updates = {};
  for (const key of ATTRIBUTE_KEYS) {
    const value = selection.attributes[key];
    if (selection.stepDice) {
      updates[`system.attributes.${key}.stepRating`] = value;
      updates[`system.attributes.${key}.maxStepRating`] = value;
    } else {
      updates[`system.attributes.${key}.value`] = value;
      updates[`system.attributes.${key}.maxValue`] = value;
    }
  }
  const faces = (rating) => STEP_RATINGS[rating]?.faces ?? 0;
  const health = selection.stepDice
    ? Math.ceil((faces(selection.attributes.strength) + faces(selection.attributes.agility)) / 4)
    : Math.ceil((selection.attributes.strength + selection.attributes.agility) / 2) + 1;
  const resolve = selection.stepDice
    ? Math.ceil((faces(selection.attributes.wits) + faces(selection.attributes.empathy)) / 4)
    : Math.ceil((selection.attributes.wits + selection.attributes.empathy) / 2) + 1;
  updates["system.resources.health.value"] = health;
  updates["system.resources.health.max"] = health;
  updates["system.resources.resolve.value"] = resolve;
  updates["system.resources.resolve.max"] = resolve;
  updates["system.creation.completed"] = true;
  updates["system.creation.archetypeUuid"] = archetype.uuid;
  const archetypeField = getCharacterHeaderFields().find((field) => (
    normalName(field.label) === normalName(game.i18n.localize("YZE.CharacterCreation.Archetype"))
  ));
  if (archetypeField) updates[`system.details.${archetypeField.key}`] = archetype.name;
  await actor.update(updates);

  await addMissingItems(actor, sources.skills);
  for (const source of sources.skills) {
    const owned = actor.items.find((item) => item.type === "skill"
      && normalName(item.name) === normalName(source.name));
    if (!owned) continue;
    const rating = selection.skills.get(source.uuid) ?? 0;
    await owned.update({
      [selection.stepDice ? "system.stepRating" : "system.rating"]: rating,
      "system.usedSuccessfully": false
    });
  }

  const selectedSpecialties = sources.specialties.filter((item) => selection.specialties.includes(item.uuid));
  const selectedEquipment = sources.equipment.filter((item) => selection.equipment.includes(item.uuid));
  await addMissingItems(actor, [...selectedSpecialties, ...sources.grantedItems, ...selectedEquipment]);
  await actor.update({
    "system.resources.health.value": Number(actor.system.resources.health.max),
    "system.resources.resolve.value": Number(actor.system.resources.resolve.max)
  });
  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    content: `<div class="yze chat-card"><h3>${escape(game.i18n.localize("YZE.CharacterCreation.Completed"))}</h3><p>${escape(game.i18n.format("YZE.CharacterCreation.CompletedSummary", { actor: actor.name, archetype: archetype.name }))}</p></div>`
  });
  return true;
}

async function chooseArchetype(actor, archetypes) {
  const selectedUuid = actor.system.creation?.archetypeUuid;
  const options = archetypes.map((archetype) => `<option value="${escape(archetype.uuid)}"${archetype.uuid === selectedUuid ? " selected" : ""}>${escape(archetype.name)}</option>`).join("");
  const { DialogV2 } = foundry.applications.api;
  return DialogV2.wait({
    window: { title: game.i18n.localize("YZE.CharacterCreation.SelectArchetype") },
    content: `<div class="yze"><p>${escape(game.i18n.localize("YZE.CharacterCreation.SelectArchetypeHint"))}</p><div class="form-group"><label>${escape(game.i18n.localize("YZE.CharacterCreation.Archetype"))}</label><select name="archetype">${options}</select></div></div>`,
    buttons: [
      { action: "next", label: game.i18n.localize("YZE.Common.Next"), icon: "fa-solid fa-arrow-right", default: true,
        callback: (event, button, dialog) => (button.form ?? dialog.element.querySelector("form")).elements.archetype?.value },
      { action: "cancel", label: game.i18n.localize("YZE.Common.Cancel"), callback: () => null }
    ],
    close: () => null, rejectClose: false, modal: true
  });
}

export async function startCharacterCreation(actor) {
  if (actor?.type !== "character" || (actor.isOwner === false && !game.user?.isGM)) {
    ui.notifications.warn(game.i18n.localize("YZE.CharacterCreation.NotAllowed"));
    return null;
  }
  const archetypes = worldItems("archetype");
  if (archetypes.length === 0) {
    ui.notifications.warn(game.i18n.localize("YZE.CharacterCreation.NoArchetypes"));
    return null;
  }
  const archetypeUuid = await chooseArchetype(actor, archetypes);
  if (!archetypeUuid) return null;
  const archetype = archetypes.find((item) => item.uuid === archetypeUuid);
  if (!archetype) return null;
  const sources = {
    skills: worldItems("skill"),
    keySkills: await referencedItems(archetype.system.keySkills, "skill"),
    specialties: await referencedItems(archetype.system.availableSpecialties, "specialty"),
    specialtyChoices: integer(archetype.system.specialtyChoices),
    grantedItems: await referencedItems(archetype.system.grantedItems, ["gear", "weapon", "armor", "consumable"]),
    equipment: await referencedItems(archetype.system.availableEquipment, ["gear", "weapon", "armor", "consumable"]),
    equipmentChoices: integer(archetype.system.equipmentChoices)
  };
  if (sources.skills.length === 0) {
    ui.notifications.warn(game.i18n.localize("YZE.CharacterCreation.NoSkills"));
    return null;
  }
  const stepDice = getDiceSystem() === DICE_SYSTEMS.STEP;
  const maximumPoolSkillPoints = sources.skills.reduce((total, skill) => (
    total + (sources.keySkills.some((keySkill) => keySkill.uuid === skill.uuid) ? 3 : 1)
  ), 0);
  if ((stepDice && (sources.skills.length < 6 || sources.keySkills.length < 1))
    || (!stepDice && maximumPoolSkillPoints < STARTING_SKILL_POINTS)) {
    ui.notifications.warn(game.i18n.localize("YZE.CharacterCreation.InsufficientSkills"));
    return null;
  }
  if (sources.specialtyChoices > sources.specialties.length
    || sources.equipmentChoices > sources.equipment.length) {
    ui.notifications.warn(game.i18n.localize("YZE.CharacterCreation.InvalidArchetype"));
    return null;
  }

  const { DialogV2 } = foundry.applications.api;
  const result = await DialogV2.wait({
    window: { title: game.i18n.format("YZE.CharacterCreation.Title", { actor: actor.name }) },
    position: { width: 760, height: 760 },
    content: creationContent(actor, archetype, sources),
    render: (_event, dialog) => wireCreationDialog(dialog, sources, archetype),
    buttons: [
      { action: "create", label: game.i18n.localize("YZE.CharacterCreation.Apply"), icon: "fa-solid fa-user-plus", default: true,
        callback: (event, button, dialog) => {
          const selection = readCreationForm(button.form ?? dialog.element.querySelector("form"), sources, archetype);
          if (selection.error) {
            ui.notifications.warn(game.i18n.format(selection.error, selection.data ?? {}));
            return false;
          }
          return selection;
        } },
      { action: "cancel", label: game.i18n.localize("YZE.Common.Cancel"), callback: () => null }
    ],
    close: () => null, rejectClose: false, modal: true
  });
  if (!result) return null;
  return applyCreation(actor, archetype, sources, result);
}
