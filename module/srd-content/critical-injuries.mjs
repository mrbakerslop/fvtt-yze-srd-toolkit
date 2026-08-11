function bounds(range) {
  return Array.isArray(range) ? range : [range, range];
}

function slug(value) {
  return value.toLowerCase().replaceAll(/[^a-z0-9]+/g, "-").replaceAll(/^-|-$/g, "");
}

function injury(category, range, name, effect, automation = {}) {
  const rollRange = bounds(range);
  const lethal = effect.startsWith("Lethal")
    || /instant death|die immediately|heart stops|story ends|last time/i.test(effect);
  const deathSaveMatch = effect.match(/[−-](\d+) to death saves/i);
  const timeLimitMatch = effect.match(/time limit ([^.]+)\./i);
  const healingTimeMatch = effect.match(/healing time ([^.]+)\./i);
  const instantDeath = /instant death|die immediately|heart stops|story ends|last time/i.test(effect);
  const permanent = /(?:^|[.;]\s*)permanent\.$/i.test(effect) || instantDeath;

  return Object.freeze({
    key: `${category}-${rollRange.join("-")}-${slug(name)}`,
    category,
    range: rollRange,
    name,
    effect,
    system: Object.freeze({
      category,
      active: true,
      lethal,
      deathSaveModifier: deathSaveMatch ? -Number(deathSaveMatch[1]) : 0,
      timeLimit: timeLimitMatch?.[1] ?? "",
      healingTime: /no healing time/i.test(effect) ? "None" : healingTimeMatch?.[1] ?? "",
      permanent,
      instantDeath,
      stabilized: false,
      deathSaveSkill: lethal ? "Stamina" : "",
      rollRange: rollRange[0] === rollRange[1] ? String(rollRange[0]) : `${rollRange[0]}–${rollRange[1]}`,
      rollModifier: automation.modifier ?? 0,
      affectedAttributes: (automation.attributes ?? []).join(", "),
      affectedSkills: (automation.skills ?? []).join(", "),
      damageOnSkills: (automation.damageOnSkills ?? []).join(", "),
      movementRestriction: automation.movement ?? "",
      disabledHands: automation.disabledHands ?? 0,
      blockedAttributes: (automation.blockedAttributes ?? []).join(", "),
      blocksActions: automation.blocksActions ?? false,
      sleepRestriction: automation.sleep ?? "",
      sleepSkill: automation.sleep === "insight" ? automation.sleepSkill ?? "Insight" : "",
      triggerKind: automation.trigger ?? "",
      specialRule: automation.specialRule ?? "",
      description: `<p>${effect}</p>`
    })
  });
}

export const SRD_PHYSICAL_CRITICAL_INJURIES = Object.freeze([
  injury("physical", 11, "Winded", "Non-lethal; no ongoing effect; no healing time."),
  injury("physical", 12, "Stunned", "Non-lethal; no ongoing effect; no healing time."),
  injury("physical", 13, "Crippling Pain", "Non-lethal; no ongoing effect; no healing time."),
  injury("physical", 14, "Sprained Ankle", "Non-lethal. Mobility −2 and movement is a slow action until a Healing roll is made; no healing time.", { modifier: -2, skills: ["Mobility"], movement: "slow" }),
  injury("physical", 15, "Blood in Eyes", "Non-lethal. Observation and Marksmanship −2 until a Healing roll is made; no healing time.", { modifier: -2, skills: ["Observation", "Marksmanship"] }),
  injury("physical", 16, "Concussion", "Non-lethal. Mobility −2; healing time D6 days.", { modifier: -2, skills: ["Mobility"] }),
  injury("physical", 21, "Severed Ear", "Non-lethal. Observation −2; healing time D6 days.", { modifier: -2, skills: ["Observation"] }),
  injury("physical", 22, "Broken Toes", "Non-lethal. Movement becomes a slow action; healing time D6 days.", { movement: "slow" }),
  injury("physical", 23, "Broken Hand", "Non-lethal. The hand cannot be used; healing time D6 days.", { disabledHands: 1 }),
  injury("physical", 24, "Knocked Out Teeth", "Non-lethal. Persuasion −2; healing time D6 days.", { modifier: -2, skills: ["Persuasion"] }),
  injury("physical", 25, "Impaled Thigh", "Non-lethal. Movement becomes a slow action; healing time 2D6 days.", { movement: "slow" }),
  injury("physical", 26, "Slashed Shoulder", "Non-lethal. The arm cannot be used; healing time D6 days.", { disabledHands: 1 }),
  injury("physical", 31, "Broken Nose", "Non-lethal. Persuasion and Observation −1; healing time D6 days.", { modifier: -1, skills: ["Persuasion", "Observation"] }),
  injury("physical", 32, "Crotch Hit", "Non-lethal. Suffer one damage whenever making a Mobility or Melee roll; healing time D6 days.", { damageOnSkills: ["Mobility", "Melee"] }),
  injury("physical", 33, "Broken Ribs", "Non-lethal. Mobility and Observation −2; healing time 2D6 days.", { modifier: -2, skills: ["Mobility", "Observation"] }),
  injury("physical", 34, "Gouged Eye", "Non-lethal. Marksmanship and Observation −2; healing time 2D6 days.", { modifier: -2, skills: ["Marksmanship", "Observation"] }),
  injury("physical", 35, "Busted Kneecap", "Non-lethal. Movement becomes a slow action; healing time 2D6 days.", { movement: "slow" }),
  injury("physical", 36, "Broken Arm", "Non-lethal. The arm cannot be used; healing time 2D6 days.", { disabledHands: 1 }),
  injury("physical", 41, "Broken Leg", "Non-lethal. Movement becomes a slow action; healing time 2D6 days.", { movement: "slow" }),
  injury("physical", 42, "Crushed Foot", "Non-lethal. Movement becomes a slow action; healing time 3D6 days.", { movement: "slow" }),
  injury("physical", 43, "Crushed Elbow", "Non-lethal. The arm cannot be used; healing time 3D6 days.", { disabledHands: 1 }),
  injury("physical", 44, "Punctured Lung", "Lethal, time limit one shift. Stamina and Mobility −2; healing time D6 days.", { modifier: -2, skills: ["Stamina", "Mobility"] }),
  injury("physical", 45, "Bleeding Gut", "Lethal, time limit one shift. Suffer one damage whenever making a Mobility or Melee roll; healing time D6 days.", { damageOnSkills: ["Mobility", "Melee"] }),
  injury("physical", 46, "Ruptured Intestines", "Lethal, time limit one shift. Disease with virulence 6; healing time 2D6 days.", { specialRule: "rupturedIntestines" }),
  injury("physical", 51, "Busted Kidney", "Lethal, time limit one day. Mobility −2 and movement is a slow action; healing time 2D6 days.", { modifier: -2, skills: ["Mobility"], movement: "slow" }),
  injury("physical", 52, "Severed Arm Artery", "Lethal with −1 to death saves, time limit one stretch. The arm cannot be used; healing time D6 days.", { disabledHands: 1 }),
  injury("physical", 53, "Severed Leg Artery", "Lethal with −1 to death saves, time limit one stretch. Movement becomes a slow action; healing time D6 days.", { movement: "slow" }),
  injury("physical", 54, "Severed Arm", "Lethal with −1 to death saves, time limit one shift. The arm cannot be used; permanent.", { disabledHands: 1 }),
  injury("physical", 55, "Severed Leg", "Lethal with −1 to death saves, time limit one shift. Movement becomes a slow action; permanent.", { movement: "slow" }),
  injury("physical", 56, "Cracked Spine", "Non-lethal. Paralyzed from the neck down; without a timely Healing roll the effect is permanent. Healing time 3D6 days.", { movement: "none", disabledHands: 2, blockedAttributes: ["strength", "agility"], specialRule: "crackedSpine" }),
  injury("physical", 61, "Ruptured Jugular", "Lethal with −1 to death saves, time limit one round. Stamina −1; healing time 2D6 days.", { modifier: -1, skills: ["Stamina"] }),
  injury("physical", 62, "Ruptured Aorta", "Lethal with −2 to death saves, time limit one round. Stamina −2; healing time 3D6 days.", { modifier: -2, skills: ["Stamina"] }),
  injury("physical", 63, "Disemboweled", "Lethal. Instant death."),
  injury("physical", 64, "Crushed Skull", "Lethal. Your story ends here."),
  injury("physical", 65, "Pierced Head", "Lethal. You die immediately."),
  injury("physical", 66, "Impaled Heart", "Lethal. Your heart beats for the last time.")
]);

export const SRD_MENTAL_CRITICAL_INJURIES = Object.freeze([
  injury("mental", [11, 16], "Trembling", "Modifier −1 on all Agility-based rolls; healing time D6 days.", { modifier: -1, attributes: ["agility"] }),
  injury("mental", 21, "White Hair", "No mechanical effect; permanent."),
  injury("mental", [22, 24], "Anxious", "Modifier −1 on all Wits-based rolls; healing time D6 days.", { modifier: -1, attributes: ["wits"] }),
  injury("mental", [25, 31], "Sullen", "Modifier −1 on all Empathy-based rolls; healing time D6 days.", { modifier: -1, attributes: ["empathy"] }),
  injury("mental", [32, 35], "Nightmares", "Roll Insight every shift spent sleeping; failure means the sleep does not count. Healing time D6 days.", { sleep: "insight" }),
  injury("mental", [36, 41], "Nocturnal", "You can sleep only during the light part of the day; healing time 2D6 days.", { sleep: "daylight" }),
  injury("mental", [42, 43], "Phobic", "Fear an object related to what broke you and suffer one stress or Wits damage each round within Short range of it. Healing time 2D6 days.", { trigger: "phobia" }),
  injury("mental", [44, 45], "Alcoholic", "Drink alcohol every day or suffer one stress or Agility damage; healing time 3D6 days.", { trigger: "alcohol" }),
  injury("mental", [46, 51], "Claustrophobic", "Each stretch in a confined environment causes one stress or Wits damage; healing time 2D6 days.", { trigger: "claustrophobia" }),
  injury("mental", 52, "Mythomaniac", "You cannot stop lying and must roleplay the effect; healing time 2D6 days."),
  injury("mental", [53, 54], "Paranoia", "You are certain someone is out to get you and must roleplay the effect; healing time 2D6 days."),
  injury("mental", 55, "Delusion", "You believe something entirely untrue; healing time 3D6 days."),
  injury("mental", 56, "Hallucinations", "Roll Insight every shift; on failure the GM introduces a powerful hallucination. Healing time 3D6 days.", { trigger: "hallucinations" }),
  injury("mental", [61, 62], "Altered Personality", "Your personality changes fundamentally; determine and roleplay it with the GM. Permanent."),
  injury("mental", 63, "Amnesia", "You lose all memory of yourself and the other PCs; healing time D6 days."),
  injury("mental", [64, 65], "Catatonic", "You stare into oblivion and respond to no stimuli; healing time D6 days.", { blocksActions: true }),
  injury("mental", 66, "Heart Attack", "Your heart stops and you die of fright.")
]);

export const SRD_CRITICAL_INJURIES = Object.freeze([
  ...SRD_PHYSICAL_CRITICAL_INJURIES,
  ...SRD_MENTAL_CRITICAL_INJURIES
]);
