import { SYSTEM_ID } from "./constants.mjs";

export const CORE_SKILLS = Object.freeze([
  {
    name: "Force",
    attribute: "strength",
    description: "Use Force for feats of raw strength such as lifting, pushing, pulling, or breaking obstacles."
  },
  {
    name: "Melee",
    attribute: "strength",
    description: "Use Melee to attack or defend at close range with your body or a hand-to-hand weapon."
  },
  {
    name: "Stamina",
    attribute: "strength",
    description: "Use Stamina when physical endurance or resilience is tested."
  },
  {
    name: "Marksmanship",
    attribute: "agility",
    description: "Use Marksmanship to attack with ranged weapons."
  },
  {
    name: "Mobility",
    attribute: "agility",
    description: "Use Mobility for actions requiring speed, balance, or precise body control."
  },
  {
    name: "Stealth",
    attribute: "agility",
    description: "Use Stealth to remain unnoticed, move silently, hide, or pick pockets."
  },
  {
    name: "Crafting",
    attribute: "wits",
    description: "Use Crafting to build, understand, operate, or repair equipment and mechanisms."
  },
  {
    name: "Observation",
    attribute: "wits",
    description: "Use Observation to search an area, notice details, or detect distant and approaching threats."
  },
  {
    name: "Survival",
    attribute: "wits",
    description: "Use Survival to endure hazardous environments and find a way through natural dangers."
  },
  {
    name: "Healing",
    attribute: "empathy",
    description: "Use Healing to treat injuries, help a broken character recover, or stabilize a critical injury."
  },
  {
    name: "Insight",
    attribute: "empathy",
    description: "Use Insight to read emotions, see through deception, and resist persuasion."
  },
  {
    name: "Persuasion",
    attribute: "empathy",
    description: "Use Persuasion to influence, deceive, negotiate with, or convince another person."
  }
]);

function skillIdentity(skill) {
  return `${skill.name.trim().toLocaleLowerCase()}::${skill.attribute}`;
}

export async function createDefaultSkills({ force = false } = {}) {
  if (!game.user.isGM) return [];
  if (!force && game.settings.get(SYSTEM_ID, "coreSkillsCreated")) return [];

  const existingSkills = new Set(
    game.items
      .filter((item) => item.type === "skill")
      .map((item) => skillIdentity({
        name: item.name,
        attribute: item.system.attribute
      }))
  );
  const missingSkills = CORE_SKILLS.filter((skill) => !existingSkills.has(skillIdentity(skill)));

  let created = [];
  if (missingSkills.length > 0) {
    let folder = game.folders.find((candidate) => (
      candidate.type === "Item" && candidate.name === "YZE Core Skills"
    ));

    if (!folder) {
      [folder] = await Folder.implementation.createDocuments([{
        name: "YZE Core Skills",
        type: "Item"
      }]);
    }

    created = await Item.implementation.createDocuments(missingSkills.map((skill) => ({
      name: skill.name,
      type: "skill",
      img: "icons/svg/book.svg",
      folder: folder.id,
      system: {
        attribute: skill.attribute,
        rating: 0,
        stepRating: 0,
        usedSuccessfully: false,
        description: `<p>${skill.description}</p>`
      }
    })));
  }

  await game.settings.set(SYSTEM_ID, "coreSkillsCreated", true);
  if (created.length > 0) {
    ui.notifications.info(game.i18n.format("YZE.Defaults.SkillsCreated", {
      count: created.length
    }));
  }

  return created;
}
