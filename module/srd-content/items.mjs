import { SYSTEM_ID } from "../constants.mjs";
import {
  SRD_MENTAL_CRITICAL_INJURIES,
  SRD_PHYSICAL_CRITICAL_INJURIES
} from "./critical-injuries.mjs";

export function specialtyItemEffects(effect) {
  const definitions = {
    bodyguard: [{ type: "hitInterception", target: "mobility", value: 0 }],
    trueGrit: [{ type: "extraPush", target: "strength", value: 1 }],
    reckless: [{ type: "extraPush", target: "agility", value: 1 }],
    inquisitive: [{ type: "extraPush", target: "wits", value: 1 }],
    compassion: [{ type: "extraPush", target: "empathy", value: 1 }],
    fastReflexes: [{ type: "initiativeCards", target: "", value: 1 }],
    healer: [{ type: "healingTime", target: "", value: 50 }],
    tough: [{ type: "derivedStat", target: "health", value: 1 }],
    hardened: [{ type: "derivedStat", target: "resolve", value: 1 }],
    packMule: [{ type: "derivedStat", target: "carry", value: 2 }],
    gutFeeling: [{ type: "alternateAttribute", target: "observation", attribute: "empathy", value: 0 }],
    menacing: [{ type: "alternateAttribute", target: "persuasion", attribute: "strength", value: 0 }],
    merciless: [{ type: "coupDeGrace", target: "", value: 0 }]
  };
  return (definitions[effect] ?? []).map((entry, index) => ({
    id: `srd-${effect}-${index}`,
    active: true,
    attribute: "",
    ...entry
  }));
}

function specialty(name, description, bonus = 0, options = {}) {
  return {
    name,
    type: "specialty",
    img: "icons/svg/book.svg",
    system: {
      active: true,
      bonus,
      effect: options.effect ?? "",
      effectTarget: options.effectTarget ?? "",
      magicDiscipline: options.magicDiscipline ?? false,
      rank: options.rank ?? 0,
      effects: options.effects ?? specialtyItemEffects(options.effect ?? ""),
      description
    }
  };
}

function spell(name, discipline, rank, range, duration, description, options = {}) {
  return {
    name,
    type: "spell",
    img: "icons/svg/daze.svg",
    system: {
      discipline,
      rank,
      range,
      duration,
      cost: 1,
      ritual: options.ritual ?? false,
      ritualRequirements: options.ritualRequirements ?? "",
      powerWord: options.powerWord ?? false,
      automation: options.automation ?? "none",
      targetMode: options.targetMode ?? "selected",
      effectCategory: options.effectCategory ?? "physical",
      effectBase: options.effectBase ?? 0,
      effectPerPower: options.effectPerPower ?? 1,
      effectModifier: options.effectModifier ?? 0,
      armorApplies: options.armorApplies ?? false,
      affectedAttributes: options.affectedAttributes ?? "",
      affectedSkills: options.affectedSkills ?? "",
      effects: options.effects ?? spellEffects(name),
      description
    }
  };
}

export const SRD_SPECIALTIES = [
  specialty("Bodyguard", "When someone within Short range is hit, roll Mobility without spending an action. On a success, you take the hit instead; the roll can be pushed.", 0, { effect: "bodyguard" }),
  specialty("Compassion", "You can push Empathy-based skill rolls twice rather than once.", 0, { effect: "compassion" }),
  specialty("Fast Reflexes", "Draw two initiative cards and choose which one to use.", 0, { effect: "fastReflexes" }),
  specialty("Field Surgeon", "Gain +1 to Healing when treating someone who is about to die from a critical injury.", 1, { effect: "fieldSurgeon" }),
  specialty("Flyweight", "When blocking in close combat, you may use Agility instead of Strength.", 0, { effect: "flyweight" }),
  specialty("Gut Feeling", "Use Empathy instead of Wits when rolling Observation to detect an approaching threat.", 0, { effect: "gutFeeling" }),
  specialty("Hardened", "Increase maximum Resolve by 1. This specialty may be taken up to three times.", 0, { effect: "hardened" }),
  specialty("Hard Hitter", "Gain +1 to Melee if you sacrifice your fast action for the round.", 1, { effect: "hardHitter" }),
  specialty("Healer", "Your critical injuries take half the normal time to heal.", 0, { effect: "healer" }),
  specialty("Inquisitive", "You can push Wits-based skill rolls twice rather than once.", 0, { effect: "inquisitive" }),
  specialty("Killer", "When an enemy suffers a critical injury, roll twice and choose the result.", 0, { effect: "killer" }),
  specialty("Lucky", "When you suffer a critical injury, re-roll and choose the preferred result.", 0, { effect: "lucky" }),
  specialty("Menacing", "Use Strength instead of Empathy for Persuasion rolls made to threaten someone.", 0, { effect: "menacing" }),
  specialty("Merciless", "You can perform a coup de grace without first rolling Empathy.", 0, { effect: "merciless" }),
  specialty("Musician", "Gain +1 to Persuasion when singing or playing an instrument is helpful, at the GM's discretion.", 1, { effect: "musician" }),
  specialty("Pack Mule", "Increase your carry limit by 2.", 0, { effect: "packMule" }),
  specialty("Quick Draw", "Drawing a weapon does not cost an action.", 0, { effect: "quickDraw" }),
  specialty("Reckless", "You can push Agility-based skill rolls twice rather than once.", 0, { effect: "reckless" }),
  specialty("Second Wind", "When broken, roll Stamina without pushing to immediately recover one relevant point per success. Usable once while broken and ineffective against critical injuries.", 0, { effect: "secondWind" }),
  specialty("Sniper", "Gain +1 to single-shot Marksmanship rolls from a hidden position at Long or greater range.", 1, { effect: "sniper" }),
  specialty("Tough", "Increase maximum Health by 1. This specialty may be taken up to three times.", 0, { effect: "tough" }),
  specialty("True Grit", "You can push Strength-based skill rolls twice rather than once.", 0, { effect: "trueGrit" }),
  specialty("Weapon Specialist", "Choose a weapon type and gain +1 when using it. This may be taken once for each weapon type, including unarmed combat.", 1, { effect: "weaponSpecialist" }),
  specialty("Awareness", "A magic discipline for perceiving hidden things, viewing the past, and sensing possible futures.", 0, { magicDiscipline: true, rank: 1 }),
  specialty("Healing", "A magic discipline devoted to healing nature, body, and spirit.", 0, { magicDiscipline: true, rank: 1 }),
  specialty("Shapeshifting", "A magic discipline concerned with animals, their aspects, and taking animal form.", 0, { magicDiscipline: true, rank: 1 }),
  specialty("Blood Magic", "A magic discipline that draws power from life and blood.", 0, { magicDiscipline: true, rank: 1 }),
  specialty("Death Magic", "A magic discipline drawing on death, decay, and the animation of the dead.", 0, { magicDiscipline: true, rank: 1 }),
  specialty("Elementalism", "A magic discipline manipulating earth, air, fire, and water.", 0, { magicDiscipline: true, rank: 1 }),
  specialty("Symbolism", "A magic discipline using runes and esoteric signs to bend underlying laws.", 0, { magicDiscipline: true, rank: 1 })
];

export const SRD_WEAPONS = [
  ["Unarmed", "", 0, 1, "engaged", 0],
  ["Blunt instrument", "1H", 1, 1, "engaged", 1],
  ["Knife", "1H", 1, 2, "engaged", 0.5],
  ["Club", "1H", 2, 1, "engaged", 1],
  ["Sword", "1H", 2, 2, "engaged", 1],
  ["Battleaxe", "2H", 2, 3, "engaged", 2],
  ["Spear", "1H", 1, 2, "short", 1],
  ["Rock", "1H", 0, 1, "medium", 0.25],
  ["Sling", "1H", 1, 1, "medium", 0.5],
  ["Bow", "2H", 1, 1, "long", 1],
  ["Pistol", "1H", 2, 2, "medium", 0.5],
  ["Rifle", "2H", 2, 2, "long", 1]
].map(([name, grip, bonus, damage, range, weight]) => {
  const usesAmmunition = ["Sling", "Bow", "Pistol", "Rifle"].includes(name);
  const firearm = ["Pistol", "Rifle"].includes(name);
  const magazine = firearm ? 3 : usesAmmunition ? 1 : 0;
  return ({
  name,
  type: "weapon",
  img: "icons/svg/sword.svg",
  system: {
    grip,
    bonus,
    damage,
    range,
    weight,
    quantity: 1,
    equipped: false,
    usesAmmunition,
    requiresPreparation: ["Sling", "Bow"].includes(name),
    ammunition: { value: magazine, max: magazine },
    reloadAction: firearm ? "slow" : "fast",
    rateOfFire: firearm ? 2 : 0,
    fullAuto: false,
    telescopicSight: false,
    description: "An example weapon from the Year Zero Engine SRD weapon table."
  }
  });
});

export const SRD_GEAR = [
  {
    name: "Backpack",
    type: "gear",
    img: "icons/svg/item-bag.svg",
    system: {
      quantity: 1,
      weight: 0,
      equipped: false,
      bonus: 0,
      effects: [
        {
          id: "srd-backpack-capacity",
          active: true,
          type: "carryCapacityMultiplier",
          target: "",
          value: 2
        },
        {
          id: "srd-backpack-mobility",
          active: true,
          type: "automaticRollModifier",
          target: "skill:mobility",
          value: -2
        }
      ],
      description: "Carries additional regular items equal to the wearer's carry limit, but gives −2 to Mobility while carried."
    }
  },
  {
    name: "Grimoire",
    type: "gear",
    img: "icons/svg/book.svg",
    system: {
      quantity: 1,
      weight: 1,
      equipped: false,
      bonus: 0,
      description: "Casting a spell from a book or scroll treats its rank as one step lower. In combat, readying the grimoire costs a fast action."
    }
  },
  {
    name: "Simple Snare",
    type: "gear",
    img: "icons/tools/fishing/net-simple-tan.webp",
    system: {
      quantity: 1,
      weight: 0.25,
      equipped: false,
      bonus: 0,
      description: "Simple trapping gear used to catch suitable prey after a successful hunting roll."
    }
  }
];

export const SRD_CONSUMABLES = [
  ["Food", "Rations of prepared food used to stave off starvation.", "prepared", "safe", 0.25],
  ["Raw Plants", "Foraged plants. Eating them raw risks virulence 3/D food poisoning.", "plants", "raw", 0.25],
  ["Raw Meat", "Uncooked meat. Eating it raw risks virulence 6/C food poisoning.", "meat", "raw", 0.25],
  ["Raw Fish", "Uncooked fish. Eating it raw risks virulence 6/C food poisoning.", "fish", "raw", 0.25],
  ["Water", "A supply of drinking water.", "none", "safe", 1],
  ["Ammunition", "A general supply of firearm ammunition.", "none", "safe", 1],
  ["Arrows", "A supply of arrows for bows or crossbows.", "none", "safe", 1],
  ["Torches", "A supply of portable light sources.", "none", "safe", 1],
  ["Air Supply", "A limited supply of breathable air.", "none", "safe", 1],
  ["Electric Power", "A portable or stored supply of electrical power.", "none", "safe", 1]
].map(([name, description, foodType, foodState, weight]) => ({
  name,
  type: "consumable",
  img: "icons/svg/coins.svg",
  system: {
    quantity: 1,
    weight,
    equipped: false,
    supply: 0,
    foodType,
    foodState,
    description
  }
}));

export const SRD_VEHICLES = [
  ["Car", 4, 1, 4, 3, 10, 1],
  ["Truck", 3, 0, 8, 3, 8, 1],
  ["Motorcycle", 1, 2, 2, 0, 9, 2],
  ["Dirtbike", 1, 2, 2, 0, 6, 4],
  ["Pickup Truck", 3, 1, 3, 4, 9, 4],
  ["Armored Personnel Carrier", 8, 0, 8, 8, 8, 6],
  ["Battle Tank", 0, 0, 10, 12, 7, 6],
  ["Helicopter", 5, 3, 5, 2, 40, 40]
].map(([name, passengers, maneuverability, hull, armor, travelSpeedRoad, travelSpeedOffRoad]) => ({
  name,
  type: "vehicle",
  img: "icons/svg/wing.svg",
  system: {
    passengers,
    maneuverability,
    hull: { value: hull, max: hull },
    armor,
    armorMax: armor,
    armorStepRating: armor >= 8 ? 4 : armor >= 6 ? 3 : armor >= 4 ? 2 : armor > 0 ? 1 : 0,
    armorStepMax: armor >= 8 ? 4 : armor >= 6 ? 3 : armor >= 4 ? 2 : armor > 0 ? 1 : 0,
    travelSpeedRoad,
    travelSpeedOffRoad,
    isAerial: name === "Helicopter",
    description: "An example vehicle from the Year Zero Engine SRD."
  }
}));

const spellEffect = (type, options = {}) => ({
  active: true,
  application: "spell",
  type,
  target: options.target ?? "",
  attribute: "",
  label: options.label ?? "",
  description: options.description ?? "",
  targetMode: options.targetMode ?? "selected",
  scaling: options.scaling ?? "linear",
  category: options.category ?? "physical",
  resource: options.resource ?? "",
  mode: options.mode ?? "",
  duration: options.duration ?? "",
  handler: options.handler ?? "",
  filter: options.filter ?? "",
  status: options.status ?? "",
  affectedAttributes: options.affectedAttributes ?? "",
  affectedSkills: options.affectedSkills ?? "",
  armorApplies: options.armorApplies ?? false,
  multiplier: options.multiplier ?? 0,
  value: options.value ?? 0
});

const damageSpell = (options = {}) => spellEffect("spellDamage", {
  multiplier: 1, targetMode: "firstSelected", label: "Damage", ...options
});
const recoverySpell = (options = {}) => spellEffect("spellRecovery", {
  multiplier: 1, targetMode: "firstSelected", label: "Recovery", ...options
});
const modifierSpell = (options = {}) => spellEffect("spellModifier", {
  multiplier: 1, label: "Magical modifier", ...options
});
const resourceSpell = (resource, options = {}) => spellEffect("spellResource", {
  resource, mode: "gain", label: resource, ...options
});
const statusSpell = (status, options = {}) => spellEffect("spellStatus", {
  status, label: status, ...options
});
const armorSpell = (options = {}) => spellEffect("spellArmor", {
  multiplier: 2, targetMode: "self", label: "Magical armor", ...options
});
const automaticSpell = (skill, options = {}) => spellEffect("spellAutomaticSuccess", {
  target: skill.toLowerCase(), mode: "replace", multiplier: 1, targetMode: "self", label: `Automatic ${skill} successes`, ...options
});
const itemSpell = (mode, options = {}) => spellEffect("spellItemDamage", {
  mode, multiplier: 1, targetMode: "firstSelected", label: "Item effect", ...options
});
const injurySpell = (mode, options = {}) => spellEffect("spellCriticalInjury", {
  mode, targetMode: "firstSelected", label: "Critical Injury effect", ...options
});
const hazardSpell = (handler, options = {}) => spellEffect("spellHazard", {
  handler, multiplier: 1, targetMode: "firstSelected", label: handler, ...options
});
const workflowSpell = (handler = "narrative", options = {}) => spellEffect("spellWorkflow", {
  handler, label: "Guided resolution", ...options
});

const SRD_SPELL_EFFECTS = Object.freeze({
  "Magical Seal": [statusSpell("magical-seal", { duration: "Shift", description: "Reduce the power level of hostile spells against the protected target by this spell's power level." })],
  "Sense Magic": [workflowSpell("narrative", { targetMode: "self", description: "Record the magic detected, its discipline, and whether this power level pierces any Obscure Magic." })],
  "Dispel Magic": [workflowSpell("dispel", { description: "Reduce a selected active magical effect by this spell's power level and remove it at zero." })],
  "Obscure Magic": [workflowSpell("bindMagic", { targetMode: "self", description: "Mark the associated spell as Obscured. Detecting it requires Sense Magic at sufficient power." })],
  "Bind Magic": [workflowSpell("bindMagic", { targetMode: "self", description: "Record the bound spell, object, trigger, and additional Willpower committed to its duration." })],
  "Transfer": [workflowSpell("resourceTransfer", { description: "Give Willpower to the target or take it from them. An unwilling transfer cannot exceed the spell's power level." })],

  "Lightbringer": [statusSpell("bright-light", { targetMode: "self", duration: "One stretch per power level", description: "Bright light dispels ordinary shadows within Short range." })],
  "True Sight": [statusSpell("true-sight", { targetMode: "self", duration: "Round", description: "See distant detail, darkness, smoke, fog, disguises, and shapeshifting." })],
  "Words on the Wind": [statusSpell("distant-hearing", { targetMode: "self", duration: "One stretch per power level", description: "Hear sounds at the chosen visible location as if present." })],
  "Farsight": [workflowSpell("narrative", { targetMode: "self", description: "Record the viewed location, familiarity, distance, required power, and the GM's fragmented vision." })],
  "True Path": [workflowSpell("gmQuestion", { targetMode: "self", description: "Ask which available decision the GM believes is wisest." })],
  "Visions of the Past": [workflowSpell("narrative", { targetMode: "self", description: "Record the requested time and the fragmented past events revealed at this location." })],
  "Divination": [workflowSpell("gmQuestion", { targetMode: "self", description: "Record the future questions and the GM's brief, possibly cryptic answers." })],
  "Intuition": [workflowSpell("yesNoQuestion", { targetMode: "self", description: "Ask one short question. The GM answers yes, no, or maybe." })],
  "Telepathy": [workflowSpell("narrative", { description: "Choose surface thoughts, memory probing, thought transmission, or mental suffering and record the result." })],

  "Cleanse Spirit": [recoverySpell({ category: "mental", filter: "A target other than the caster", description: "Recover Resolve or a mental Attribute equal to power." })],
  "Healing Hands": [recoverySpell({ category: "physical", filter: "A target other than the caster; Critical Injuries are unaffected", description: "Recover Health or a physical Attribute equal to power." })],
  "Nature's Cure": [workflowSpell("cureHazard", { description: "Cure an active disease or poison when power meets its virulence or toxicity requirement." })],
  "Banish Demon": [damageSpell({ filter: "Demon", description: "Inflict physical damage equal to power." })],
  "Mend Wounds": [injurySpell("heal", { value: 2, description: "Heal one Critical Injury immediately; lethal injuries require power 2." })],
  "Purge Undead": [damageSpell({ filter: "One undead target", description: "Inflict physical damage equal to power." })],
  "Resurrection": [
    injurySpell("resurrect", { description: "Restore a recently dead person to life after confirming the elapsed-time requirement." }),
    resourceSpell("empathy", { mode: "lose", value: 1, description: "Permanently lose one Empathy." })
  ],
  "Serenity": [statusSpell("serenity", { description: "The living humanoid complies with one reasonable social request without Persuasion." })],
  "Weathermaster": [hazardSpell("weather", { targetMode: "self", duration: "Shift", description: "Record the summoned weather; drastic or unnatural changes require higher power." })],

  "Animal Speech": [statusSpell("animal-speech", { targetMode: "self", duration: "Stretch", description: "Speak with a mammal and ask one question per power level." })],
  "Cat's Paw": [automaticSpell("Stealth", { description: "The next Stealth roll is replaced by automatic successes equal to power." })],
  "Hawk's Eye": [statusSpell("hawks-eye", { targetMode: "self", duration: "Stretch", description: "See fine detail and identify individuals within Extreme range." })],
  "Beastmaster": [workflowSpell("powerRequirement", { status: "beastmaster", duration: "Stretch", filter: "Animal; Strength cannot exceed twice power; agitation or unnatural orders increase the required power", description: "Confirm the animal's Strength, state, and requested behaviour, then record its command." })],
  "Bear's Claw": [damageSpell({ armorApplies: true, description: "Automatic physical hit equal to power; it cannot be parried or dodged." })],
  "Deer's Dash": [modifierSpell({ target: "skill:mobility", targetMode: "self", duration: "Stretch", description: "Gain a Mobility modifier equal to power." })],
  "Animal Form": [workflowSpell("transform", { targetMode: "self", duration: "Shift", description: "Record the chosen animal form and replacement physical Attributes; Wits and Empathy become 1." })],
  "Primal Soul": [workflowSpell("powerRequirement", { status: "primal-emotion", duration: "Stretch", filter: "Power must meet or exceed the target's current Wits; larger crowds require power 2–4", description: "Confirm the Wits or crowd-size requirement and record the animal-like emotion awakened." })],

  "Firewalker": [statusSpell("firewalker", { targetMode: "self", duration: "Shift", description: "Immune to heat, cold, and fire damage." })],
  "Stir Blood": [statusSpell("stirred-emotion", { duration: "Stretch", filter: "Living target", description: "Record the powerful emotion awakened in the target." })],
  "Bind Demon": [workflowSpell("opposedTest", { status: "bound-demon", duration: "Shift", filter: "Demon", description: "Bind the demon if its Insight roll at a penalty equal to power fails." })],
  "Blood Bond": [workflowSpell("resourceTransfer", { filter: "A similar living being", description: "Transfer Health, Resolve, or Attribute points between caster and target." })],
  "Immolate": [damageSpell({ description: "Inflict physical damage equal to power; armour does not apply." }), hazardSpell("fire", { multiplier: 2, description: "Set the target on fire at twice power in dice-pool mode or the power-matched step rating." })],
  "Blood Channeling": [resourceSpell("willpower", { targetMode: "self", multiplier: 2, duration: "Next round", description: "Gain temporary Willpower equal to twice power; unused points expire after the next round." })],
  "Blood Curse": [hazardSpell("bloodCurse", { duration: "One shift per power level", filter: "Known living humanoid", description: "Choose damage or stress. Apply one point each shift until the total equals power; natural healing is prevented." })],
  "Bind Soul": [workflowSpell("opposedTest", { status: "soul-bound", duration: "Varies", filter: "Living victim and prepared vessel", description: "Bind the victim's soul if its Insight roll at a penalty equal to power fails; record the vessel and release condition." })],

  "Befoul": [itemSpell("food", { description: "Destroy one food ration per power level and mark it poisonous." })],
  "Chill of the Grave": [hazardSpell("chill", { duration: "One round per power level", filter: "Living non-monster target", description: "Apply one damage and one stress immediately and each round until each total equals power." })],
  "Contaminate": [hazardSpell("disease", { multiplier: 3, filter: "Living humanoid", description: "Apply disease at three times power in dice-pool mode or the power-matched step rating." })],
  "Ghoulish Glare": [damageSpell({ category: "stress", affectedAttributes: "empathy", filter: "Living humanoid", description: "Inflict stress equal to power, or Empathy damage in Attribute Damage mode." })],
  "Hand of Doom": [damageSpell({ filter: "Living humanoid", description: "Inflict physical damage equal to power; extra Willpower may extend range." })],
  "Raise the Dead": [workflowSpell("summon", { duration: "Shift", filter: "Dead humanoid or animal", description: "Record animated corpses and select improvements permitted by power." })],
  "Speak to the Dead": [workflowSpell("narrative", { targetMode: "self", description: "Record the named dead person, questions, and answers heard near their death or burial place." })],
  "Steal Life": [resourceSpell("willpower", { targetMode: "self", multiplier: 2, description: "Kill nearby plants and animals and gain Willpower equal to twice power." })],
  "Terror": [damageSpell({ category: "stress", affectedAttributes: "wits,empathy", filter: "Living humanoid", description: "Inflict stress equal to power, or equal damage to Wits and Empathy in Attribute Damage mode." }), statusSpell("terror", { filter: "Living humanoid", description: "Record the severe fear caused by the spell." })],

  "Combustion": [hazardSpell("fire", { multiplier: 2, filter: "Non-living object, clothing, or armour", description: "Ignite the object at twice power in dice-pool mode or the power-matched step rating." })],
  "Sunder": [itemSpell("gearBonus", { filter: "Non-living, non-magical object", description: "Reduce Gear bonus or structural integrity equal to power." })],
  "Suffocate": [hazardSpell("suffocation", { duration: "One round per power level", filter: "Breathing target", description: "Apply recurring suffocation damage and prevent speech." })],
  "Water Breathing": [statusSpell("water-breathing", { duration: "Stretch", description: "Allow touched targets to breathe underwater; record extra targets or duration bought with power." })],
  "Heat of the Moment": [workflowSpell("opposedTest", { mode: "opposed", status: "berserk", filter: "Living target with Wits; monsters are immune", description: "Roll twice power as unpushable base dice against the target's Insight; on success the target goes berserk." })],
  "Rock Storm": [damageSpell({ armorApplies: true, description: "Inflict physical damage equal to power; armour applies." })],
  "Flight": [statusSpell("flight", { duration: "Round", description: "Fly two zones per move; record extra duration or passengers bought with power." })],
  "Parch": [damageSpell({ filter: "Living target", description: "Inflict physical damage equal to power; armour does not apply." })],
  "Fireball": [damageSpell({ description: "Inflict physical damage equal to power on the first selected target." }), hazardSpell("fire", { targetMode: "selected", multiplier: 2, description: "Expose all selected nearby targets to fire at twice power in dice-pool mode or the power-matched step rating." })],
  "Stoneskin": [armorSpell({ duration: "Stretch", description: "Gain armour equal to twice power in dice-pool mode or one step per power in stepped-dice mode." })],
  "Tornado": [
    workflowSpell("distributeDamage", { armorApplies: true, description: "Distribute damage equal to power among selected zone targets; armour applies." }),
    workflowSpell("forceStanding", { description: "Each selected target makes an unpushable Force roll and is knocked prone on failure." })
  ],
  "Flood Wave": [workflowSpell("distributeDamage", { mode: "prone", description: "Distribute damage equal to power among selected targets and knock each damaged victim prone." })],

  "Entice": [workflowSpell("opposedTest", { status: "enticed", description: "Compel the victim to approach the symbol if its Insight roll at a penalty equal to power fails." })],
  "Horrify": [damageSpell({ category: "stress", affectedAttributes: "wits", filter: "Non-monster target", description: "Inflict stress equal to power, or Wits damage in Attribute Damage mode." })],
  "Paralyze": [statusSpell("paralyzed", { duration: "Round", filter: "Non-monster target", description: "Remove one fast action at power 1, the slow action at power 2, both at power 3, and bonus actions at power 4." })],
  "Blind": [workflowSpell("opposedTest", { status: "blinded", duration: "Shift", filter: "Non-monster; animals are affected automatically", description: "Blind the target if its Insight roll at a penalty equal to power fails." })],
  "Illusion": [workflowSpell("narrative", { duration: "Stretch", description: "Record the image or sound, affected observer, and size permitted by power." })],
  "Mind Trick": [statusSpell("mind-trick", { duration: "Round", filter: "NPC outside combat", description: "The NPC omits one minor absent-minded action." })],
  "Puppeteer": [workflowSpell("opposedTest", { status: "puppeteered", duration: "Round", filter: "Non-monster victim", description: "Control the victim's actions if its Insight roll at a penalty equal to power fails." })],
  "Power Rune": [workflowSpell("storeWillpower", { targetMode: "self", description: "Create a rune Item storing Willpower equal to power." })],
  "Portal": [workflowSpell("narrative", { targetMode: "self", duration: "One shift per power level", description: "Record the linked destinations, duration, and dangerous passage conditions." })]
});

function spellEffects(name) {
  return (SRD_SPELL_EFFECTS[name] ?? [workflowSpell("narrative")]).map((effect, index) => ({
    id: `srd-spell-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "")}-${index}`,
    ...effect
  }));
}

export const SRD_SPELLS = [
  spell("Magical Seal", "General", 1, "Engaged", "Shift", "Protect a person or human-sized location, reducing the power level of spells cast against it by this spell's power level."),
  spell("Sense Magic", "General", 1, "Medium", "Immediate", "Identify the kind of magic present and detect Obscured magic when this spell's power level is high enough."),
  spell("Dispel Magic", "General", 2, "Medium", "Immediate", "React to another spell and reduce its power level; negate it if reduced to zero.", { powerWord: true }),
  spell("Obscure Magic", "General", 2, "Personal", "Immediate", "Spend an additional WP to hide a spell from notice; Sense Magic is required to detect it."),
  spell("Bind Magic", "General", 3, "Personal", "Varies", "Bind a non-ritual spell into an object as a trap or reusable magical artifact.", { ritual: true }),
  spell("Transfer", "General", 3, "Engaged", "Immediate", "Give Willpower Points to another target or steal them from an unwilling target."),

  spell("Lightbringer", "Awareness", 1, "Short", "One stretch per power level", "Summon bright light that dispels all shadows within Short range."),
  spell("True Sight", "Awareness", 1, "Extreme", "Round", "See distant detail, darkness, smoke, fog, disguises, and shapeshifting with supernatural clarity."),
  spell("Words on the Wind", "Awareness", 1, "Extreme", "One stretch per power level", "Hear sounds at a visible location within Extreme range as if present there."),
  spell("Farsight", "Awareness", 2, "Varies", "Stretch", "View a known distant location; greater distance or unfamiliarity requires higher power."),
  spell("True Path", "Awareness", 2, "Personal", "Immediate", "Ask the GM which available decision they believe is wisest."),
  spell("Visions of the Past", "Awareness", 2, "Medium", "Stretch", "Witness fragmented events that occurred at the current location in the past."),
  spell("Divination", "Awareness", 3, "Short", "Stretch", "Ask brief questions about the future and receive possibly cryptic answers or omens.", { ritual: true }),
  spell("Intuition", "Awareness", 3, "Personal", "Immediate", "Ask one short yes-or-no question; the GM answers yes, no, or maybe."),
  spell("Telepathy", "Awareness", 3, "Short", "Stretch", "Read surface thoughts, probe memories, send thoughts, or inflict mental suffering."),

  spell("Cleanse Spirit", "Healing", 1, "Engaged", "Immediate", "Heal Resolve or a mental attribute equal to the power level; you cannot target yourself.", { automation: "healing", effectCategory: "mental" }),
  spell("Healing Hands", "Healing", 1, "Engaged", "Immediate", "Heal Health or a physical attribute equal to the power level; critical injuries and the caster are unaffected.", { automation: "healing" }),
  spell("Nature's Cure", "Healing", 1, "Engaged", "Immediate", "Cure sickness or poison when the power level meets the required virulence or toxicity."),
  spell("Banish Demon", "Healing", 2, "Short", "Immediate", "Inflict damage equal to the power level on a demon.", { automation: "damage" }),
  spell("Mend Wounds", "Healing", 2, "Engaged", "Immediate", "Immediately heal a critical injury; lethal injuries require power level 2."),
  spell("Purge Undead", "Healing", 2, "Short", "Immediate", "Inflict damage equal to the power level on one undead target.", { automation: "damage" }),
  spell("Resurrection", "Healing", 3, "Engaged", "Immediate", "Restore a recently dead person to true life; difficulty rises with elapsed time and the target permanently loses Empathy."),
  spell("Serenity", "Healing", 3, "Short", "Immediate", "Make a living humanoid comply with a reasonable social request without a Persuasion roll."),
  spell("Weathermaster", "Healing", 3, "Extreme", "Shift", "Summon a weather shift; more drastic or unnatural changes require greater power."),

  spell("Animal Speech", "Shapeshifting", 1, "Short", "Stretch", "Speak with a mammal and ask one question per power level."),
  spell("Cat's Paw", "Shapeshifting", 1, "Personal", "Immediate", "Replace a Stealth roll with automatic successes equal to the power level."),
  spell("Hawk's Eye", "Shapeshifting", 1, "Extreme", "Stretch", "See fine details and identify individuals anywhere within Extreme range."),
  spell("Beastmaster", "Shapeshifting", 2, "Short", "Stretch", "Command one animal, subject to its Strength, state, and the requested behavior."),
  spell("Bear's Claw", "Shapeshifting", 2, "Engaged", "Immediate", "Automatically hit for damage equal to the power level; armor applies but the attack cannot be parried or dodged.", { automation: "damage", armorApplies: true }),
  spell("Deer's Dash", "Shapeshifting", 2, "Personal", "Immediate", "Move with animal speed and gain a Mobility modifier equal to the power level."),
  spell("Animal Form", "Shapeshifting", 3, "Personal", "Immediate", "Take the form and physical attributes of an animal while reducing Wits and Empathy to 1."),
  spell("Primal Soul", "Shapeshifting", 3, "Long", "Stretch", "Awaken an animal-like emotion in one or many minds."),

  spell("Firewalker", "Blood Magic", 1, "Personal", "Shift", "Become immune to heat and cold and take no damage from fire."),
  spell("Stir Blood", "Blood Magic", 1, "Short", "Stretch", "Awaken a strong emotion such as lust, fear, or rage in a living target."),
  spell("Bind Demon", "Blood Magic", 2, "Short", "Shift", "Attempt to bend a demonic creature to your will; it can resist with Insight."),
  spell("Blood Bond", "Blood Magic", 2, "Engaged", "Immediate", "Transfer Health, Resolve, or attribute points to or from another similar living being."),
  spell("Immolate", "Blood Magic", 2, "Short", "Immediate", "Inflict damage equal to the power level and set the target alight; armor does not protect.", { automation: "damage" }),
  spell("Blood Channeling", "Blood Magic", 3, "Personal", "Round", "Gain temporary WP equal to twice the power level, which must be spent in the next round."),
  spell("Blood Curse", "Blood Magic", 3, "Unlimited", "One shift per power level", "Curse a known living humanoid to take gradual damage or stress and prevent natural healing.", { ritual: true }),
  spell("Bind Soul", "Blood Magic", 3, "Engaged", "Varies", "Extract a victim's soul into a vessel, leaving the body unconscious until freed.", { ritual: true }),

  spell("Befoul", "Death Magic", 1, "Short", "Immediate", "Corrupt one food ration per power level into poisonous, inedible matter."),
  spell("Chill of the Grave", "Death Magic", 1, "Engaged", "One round per power level", "Inflict recurring cold damage and stress on a living target."),
  spell("Contaminate", "Death Magic", 1, "Engaged", "Immediate", "Infect a living humanoid with a disease whose virulence scales with power."),
  spell("Ghoulish Glare", "Death Magic", 1, "Medium", "Immediate", "Inflict stress equal to the power level on a living humanoid.", { automation: "damage", effectCategory: "mental" }),
  spell("Hand of Doom", "Death Magic", 2, "Short", "Immediate", "Inflict damage equal to the power level on a living humanoid; spend extra WP to extend the range.", { automation: "damage" }),
  spell("Raise the Dead", "Death Magic", 2, "Short", "Shift", "Animate one or more dead humanoids or animals and improve them with higher power.", { ritual: true }),
  spell("Speak to the Dead", "Death Magic", 2, "Short", "Stretch", "Question a named dead person near where they died or were buried."),
  spell("Steal Life", "Death Magic", 3, "Short", "Immediate", "Kill nearby plants and animals to gain WP equal to twice the power level.", { ritual: true }),
  spell("Terror", "Death Magic", 3, "Medium", "Immediate", "Inflict severe fear and stress equal to the power level on a living humanoid.", { automation: "damage", effectCategory: "mental" }),

  spell("Combustion", "Elementalism", 1, "Short", "Immediate", "Cause a non-living object to burst into flame, endangering anyone holding or wearing it."),
  spell("Sunder", "Elementalism", 1, "Engaged", "Immediate", "Break a non-living, non-magical object, reducing its gear bonus or dealing structural damage."),
  spell("Suffocate", "Elementalism", 1, "Short", "One round per power level", "Pull air from a victim's lungs, causing recurring damage and preventing speech."),
  spell("Water Breathing", "Elementalism", 1, "Engaged", "Stretch", "Allow touched creatures to breathe underwater; power increases targets or duration."),
  spell("Heat of the Moment", "Elementalism", 2, "Short", "Immediate", "Overcome a living target with rage after an opposed roll."),
  spell("Rock Storm", "Elementalism", 2, "Medium", "Immediate", "Hurl stones at an enemy for damage equal to the power level; armor applies.", { automation: "damage", armorApplies: true }),
  spell("Flight", "Elementalism", 2, "Engaged", "Round", "Fly two zones per move action; power extends duration or adds passengers."),
  spell("Parch", "Elementalism", 2, "Engaged", "Immediate", "Draw fluids from a living target, inflicting damage equal to the power level without armor.", { automation: "damage" }),
  spell("Fireball", "Elementalism", 3, "Long", "Immediate", "Strike a target for damage equal to power and expose everyone nearby to intense fire.", { automation: "damage" }),
  spell("Stoneskin", "Elementalism", 3, "Personal", "Stretch", "Cover yourself in living stone, gaining armor determined by power level."),
  spell("Tornado", "Elementalism", 3, "Medium", "Immediate", "Distribute damage among targets in a zone and force everyone there to remain standing."),
  spell("Flood Wave", "Elementalism", 3, "Medium", "Immediate", "Unleash water or snow, distribute damage among targets, and knock damaged victims down."),

  spell("Entice", "Symbolism", 1, "Medium", "Immediate", "Compel a victim to approach the symbol after a failed Insight roll."),
  spell("Horrify", "Symbolism", 1, "Medium", "Immediate", "Awaken deep fear and inflict stress equal to power; monsters are unaffected.", { automation: "damage", effectCategory: "mental" }),
  spell("Paralyze", "Symbolism", 1, "Medium", "Immediate", "Mesmerize a target and remove actions according to the power level."),
  spell("Blind", "Symbolism", 2, "Medium", "Shift", "Blind a target that fails Insight; animals are affected automatically and monsters are immune."),
  spell("Illusion", "Symbolism", 2, "Medium", "Stretch", "Create or conceal an image or sound for one person, with size based on power."),
  spell("Mind Trick", "Symbolism", 2, "Medium", "Round", "Make an NPC omit a minor, absent-minded action outside combat.", { powerWord: true }),
  spell("Puppeteer", "Symbolism", 3, "Short", "Round", "Control a victim's fast and slow actions if they fail Insight; monsters are immune."),
  spell("Power Rune", "Symbolism", 3, "Engaged", "Immediate", "Store WP equal to the power level in a drawn or carved symbol for later spellcasting.", { ritual: true }),
  spell("Portal", "Symbolism", 3, "Short", "One shift per power level", "Open a dangerous passage between worlds or create a linked portal to another place.", { ritual: true })
];

export const SRD_VEHICLE_COMPONENTS = [
  {
    name: "Standard Engine",
    type: "vehicleComponent",
    img: "icons/svg/gear.svg",
    system: {
      componentType: "engine", active: true, damaged: false, modifier: 0,
      damage: 0, range: "", description: "The vehicle's primary engine or drive system."
    }
  },
  {
    name: "Responsive Controls",
    type: "vehicleComponent",
    img: "icons/svg/wing.svg",
    system: {
      componentType: "mobility", active: true, damaged: false, modifier: 1,
      damage: 0, range: "", description: "Agile controls granting +1 to vehicle manoeuvre rolls while operational."
    }
  },
  {
    name: "Mounted Weapon",
    type: "vehicleComponent",
    img: "icons/svg/explosion.svg",
    system: {
      componentType: "weapon", active: true, damaged: false, modifier: 0,
      damage: 2, range: "long", description: "An example vehicle-mounted weapon. Configure its damage and range for the setting."
    }
  }
];

export const SRD_ITEM_GROUPS = [
  { folder: "YZE SRD Specialties", items: SRD_SPECIALTIES },
  { folder: "YZE SRD Weapons", items: SRD_WEAPONS },
  { folder: "YZE SRD Gear", items: SRD_GEAR },
  { folder: "YZE SRD Consumables", items: SRD_CONSUMABLES },
  { folder: "YZE SRD Spells", items: SRD_SPELLS },
  { folder: "YZE SRD Vehicle Components", items: SRD_VEHICLE_COMPONENTS },
  {
    folder: "YZE Physical Critical Injuries",
    items: SRD_PHYSICAL_CRITICAL_INJURIES.map((injury) => ({
      name: injury.name,
      type: "criticalInjury",
      img: "icons/svg/blood.svg",
      system: injury.system,
      flags: { [SYSTEM_ID]: { criticalInjuryKey: injury.key } }
    }))
  },
  {
    folder: "YZE Mental Critical Injuries",
    items: SRD_MENTAL_CRITICAL_INJURIES.map((injury) => ({
      name: injury.name,
      type: "criticalInjury",
      img: "icons/svg/terror.svg",
      system: injury.system,
      flags: { [SYSTEM_ID]: { criticalInjuryKey: injury.key } }
    }))
  }
];
