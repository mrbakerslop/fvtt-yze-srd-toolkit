import { SYSTEM_ID } from "../constants.mjs";

export const WORLD_GUIDE_PACK = "world-setup-guide";
export const WORLD_GUIDE_ID = "YZEWorldGuide001";
export const WORLD_GUIDE_PAGES = Object.freeze({
  overview: "YZESetOverview01",
  dice: "YZESetCoreDice01",
  damage: "YZESetDamageMod1",
  pushing: "YZESetPushing001"
});
export const WORLD_GUIDE_UUID = `Compendium.${SYSTEM_ID}.${WORLD_GUIDE_PACK}.JournalEntry.${WORLD_GUIDE_ID}`;

const pageContent = Object.freeze({
  overview: `
    <h1>Game World Setup Guide</h1>
    <p>The YZE System Toolkit supports several Year Zero Engine rule variants. The startup wizard configures the three choices that most strongly shape a world: the core dice system, the damage model, and pushing consequences.</p>
    <p>These are world settings. They apply to every player and Actor in this world. The Gamemaster can reopen the wizard or change individual options later under <strong>Configure Settings → System Settings</strong>.</p>
    <p>The supplied SRD Actors, Items, Roll Tables, and Card Stack live in the system's <strong>Compendium Packs</strong>. Import or drag only the content this world needs; system updates can then refresh the source packs without overwriting world documents you have edited.</p>
    <h2>Recommended order</h2>
    <ol>
      <li>Choose Dice Pool or Stepped Dice.</li>
      <li>Choose how characters suffer harm.</li>
      <li>Choose what banes and pushed rolls cost.</li>
      <li>Save the wizard, then configure optional subsystems as required.</li>
    </ol>
    <p>Leaving <strong>Launch this wizard when the world starts</strong> checked makes the wizard return on the next startup. Uncheck it once the world rules are settled.</p>`,
  dice: `
    <h1>Core Dice System</h1>
    <h2>Dice Pool</h2>
    <p>Attributes, Skills, Gear, Stress, and other sources contribute D6s to one pool. Each 6 is a success. This is the familiar Year Zero dice-pool approach and keeps ratings numeric.</p>
    <h2>Stepped Dice</h2>
    <p>Ratings select die sizes rather than numbers of D6s. Attribute and Skill dice are rolled together. Results from 6–9 generate one success and results of 10 or higher generate two successes.</p>
    <h2>Stepped modifier method</h2>
    <p><strong>Numerical modifiers</strong> step ratings up or down. <strong>Advantage and Disadvantage</strong> uses additional favorable or unfavorable dice where the configured rule calls for them.</p>
    <p>Changing dice systems does not erase the other system's stored ratings, but character creation and roll dialogs use the currently selected system.</p>`,
  damage: `
    <h1>Damage Model</h1>
    <h2>Damage &amp; Stress</h2>
    <p>Physical harm reduces Health and mental harm reduces Resolve. This supports distinct physical and mental breaking points.</p>
    <h2>Health Only</h2>
    <p>All ordinary harm uses Health. Resolve is not displayed or used as a separate damage track.</p>
    <h2>Conditions</h2>
    <p>Harm applies named physical or mental Conditions. Taking the fourth Condition in one category breaks the character. When a pushed roll applies a Condition, the player chooses the eligible Condition in the Push Roll dialog.</p>
    <h2>Attribute Damage</h2>
    <p>Physical and mental harm reduce Attributes directly. The configured critical-injury trigger determines which reduced Attributes can break a character.</p>
    <p>The damage model controls ordinary harm and, when enabled, bane damage from pushed rolls. Stress Dice can be used independently without applying damage on a bane.</p>`,
  pushing: `
    <h1>Pushing &amp; Consequences</h1>
    <h2>Bane damage</h2>
    <p><strong>Use the damage model</strong> applies the world's normal harm consequence when an eligible pushed die rolls a bane. <strong>No bane damage</strong> suppresses that damage while leaving other consequences active.</p>
    <h2>Stress Dice</h2>
    <p>Pushing immediately adds one Stress. Current Stress adds that many Stress Dice to Skill rolls, including the immediate reroll. Sixes on Stress Dice count as successes. A bane on any Stress Die triggers a Panic roll, even on an initial roll. Stress Dice can be used without bane damage.</p>
    <h2>Doom Points</h2>
    <p>Eligible banes can generate Doom for the Gamemaster. The configured manager role controls who may spend and adjust the shared Doom pool.</p>
    <h2>Conditions from pushing</h2>
    <p>When enabled, Conditions are available as a pushing consequence. If Conditions are also the selected damage model and bane damage is active, a pushed bane applies the chosen eligible Condition.</p>
    <p>These switches are independent so the world can use Stress-only horror, Doom-driven pressure, Conditions, direct damage, or combinations of them.</p>`
});

function pageSource(key, name, sort) {
  const id = WORLD_GUIDE_PAGES[key];
  return Object.freeze({
    _key: `!journal.pages!${WORLD_GUIDE_ID}.${id}`,
    _id: id,
    name,
    type: "text",
    sort,
    text: Object.freeze({ content: pageContent[key].trim(), format: 1 }),
    system: Object.freeze({}),
    title: Object.freeze({ show: true, level: 1 }),
    image: Object.freeze({}),
    video: Object.freeze({ controls: true, volume: 0.5 }),
    src: null,
    category: null,
    ownership: Object.freeze({ default: -1 }),
    flags: Object.freeze({})
  });
}

export const WORLD_GUIDE_SOURCES = Object.freeze([
  Object.freeze({
    _key: `!journal!${WORLD_GUIDE_ID}`,
    _id: WORLD_GUIDE_ID,
    name: "YZE Game World Setup Guide",
    pages: Object.freeze(Object.values(WORLD_GUIDE_PAGES)),
    categories: Object.freeze([]),
    folder: null,
    sort: 0,
    ownership: Object.freeze({ default: 2 }),
    flags: Object.freeze({ [SYSTEM_ID]: Object.freeze({ settingsGuide: true }) })
  }),
  pageSource("overview", "Setup Overview", 100000),
  pageSource("dice", "Core Dice System", 200000),
  pageSource("damage", "Damage Models", 300000),
  pageSource("pushing", "Pushing & Consequences", 400000)
]);
