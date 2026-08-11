# YZE System Toolkit for Foundry VTT

YZE System Toolkit is a configurable Foundry Virtual Tabletop Version 14 game
system based on the Year Zero Engine Standard Reference Document. It is built
for creating original games: choose the rules your world uses, import only the
SRD examples you need, and customise the terminology and content to suit your
setting.

This project does not reproduce any specific published game.

## At a glance

- D6 dice-pool and stepped-dice core systems
- Four selectable damage models and modular pushing consequences
- Guided, rules-enforced character creation from reusable Archetype Items
- Character, NPC, Vehicle, and Mount Actor types
- Configurable Attributes, identity fields, personality fields, currency, and
  sheet sections
- Automated rolls, pushing, opposed tests, combat, harm, recovery, Critical
  Injuries, Panic, Experience, and advancement
- Optional Magic, Vehicles and Chases, Mounts, and Travel systems
- Native SRD Compendium Packs for Actors, Items, Roll Tables, Cards, and the
  Game World Setup Guide
- Responsive Application V2 sheets and consistent black-and-white styling

## Installation

### Install from Foundry

In Foundry VTT's **Game Systems** setup screen, select **Install System** and
paste this manifest URL:

```text
https://github.com/mrbakerslop/fvtt-yze-srd-toolkit/releases/latest/download/system.json
```

Foundry will use the same manifest to detect and install future updates.

### Install locally

Place or link the project in the following directory. Its directory name must
match the system ID, `fvtt-yze-srd`.

```text
{Foundry user data}/Data/systems/fvtt-yze-srd
```

Restart Foundry, then create a world using **YZE System Toolkit**.

### Compatibility and versions

- Minimum Foundry version: **14**
- Verified Foundry version: **14**
- System ID: `fvtt-yze-srd`

Versions use `FoundryVersion.GameSystemMajorVersion.MinorFeatureVersion`. For
example, version `14.0.81` is tagged `v14.0.81` for Foundry VTT 14.

## First world setup

The Game World Setup Wizard opens for the GM when a world starts. It continues
to open on startup until the GM clears its launch checkbox.

The wizard guides the GM through three foundational choices:

- the core dice system;
- the damage model;
- pushing and its consequences.

Each step links to the supplied **YZE Game World Setup Guide** Journal for a
longer explanation. The wizard can be reopened at any time from **Configure
Settings → System Settings**.

SRD examples are supplied in Compendium Packs instead of being created directly
in every world. Drag individual documents from a pack or use Foundry's import
controls when you want editable world-owned copies.

## World configuration

The main rule choices are independent wherever the SRD permits them. This lets
a world use, for example, Stress Dice and Panic without taking damage from
pushed-roll banes.

| Area | Available options |
| --- | --- |
| Core dice | D6 dice pools or stepped dice |
| Stepped modifiers | Numerical modifiers or Advantage/Disadvantage |
| Damage | Damage & Stress, Health Only, Conditions, or Attribute Damage |
| Pushing | Bane damage or no bane damage, plus independent Stress Dice, Conditions, Doom Points, and Willpower |
| Encumbrance | Standard, Weapons at Hand, or disabled |
| Consumables | Exact quantities or Supply ratings |
| Ammunition | Untracked, counted rounds, Supply ratings, or Ammo Dice |
| Critical Injury trigger | Five SRD example triggers |
| Initiative | Open cards or hidden cards redrawn each round |
| Optional systems | Magic, Vehicles and Chases, and Travel |

World configuration also controls:

- the display names of the four stable Attributes;
- Character header and identity fields;
- Pride, Weakness, Dark Secret, Big Dream, Buddy, and Relationships;
- Currency naming and which Item types show prices;
- Character-sheet features and section visibility;
- the minimum Foundry User Role allowed to manage Doom Points.

Changing a fundamental rule in an established campaign can alter how stored
Actor and Item data is interpreted. Review the affected sheets after making a
major world-level change.

## Implemented features

### Characters and sheets

- Character, NPC, Vehicle, and Mount Actor data models and dedicated sheets
- Stable physical and mental Attribute slots with world-configurable names
- Skill Items linked to Attributes and displayed directly beneath them
- Typed drop zones for Skills, Specialities, Gear, Weapons, Armour, Spells,
  Vehicle Components, and Critical Injuries
- Dynamic tab layouts in which disabled sections do not leave blank spaces
- Configurable identity, personality, relationship, and currency fields
- Derived Health, Resolve, carrying capacity, and Speciality bonuses
- Stored data remains intact when an optional field or subsystem is hidden

### Character creation and advancement

- Reusable Archetype Items with a key Attribute, key Skills, Speciality choices,
  equipment grants, and equipment choices
- Archetype-level limits for starting Speciality and equipment selections
- Dice-pool creation with Attributes starting at 2, the key Attribute capped at
  5, other Attributes capped at 4, and an enforced total of 14 points
- Dice-pool Skills starting at 0, key Skills capped at 3, other Skills capped at
  1, and an enforced total of 10 points
- Rules-enforced stepped-dice starting distributions
- Automatic application of the selected Archetype and starting Items
- Timestamped Experience award and spending ledger
- End-of-session Experience questions using the world's configured terms
- Advancement checks for Skill use, teachers, Specialities, and magic ranks

### Rolls, pushing, and resources

- Attribute and Skill roll dialogs with difficulty, helpers, Gear, Specialities,
  Conditions, and free-form modifiers
- Public or GM-secret rolls and active or passive tests
- Scene-aware helpers and the SRD one-attempt goal lock
- Dice-pool and stepped-dice success counting
- Artifact Dice, Gear Bonus, Reliability, Supply Dice, and Ammo Dice
- Opposed rolls with push-aware final results
- A push dialog showing every eligible die and retaining successes by default
- Push limits, including Specialities that permit an additional push
- Clear chat-card summaries by Attribute, Skill, Gear, and Stress die type
- Optional Stress gain, Stress Dice, automatic Panic rolls, Conditions, Doom
  gain, Willpower gain, and pushed-roll bane damage
- Persistent Panic effects where the result can be automated safely
- Shared, role-controlled Doom pool and Item-defined Doom expenditures

### Combat and zones

- Ten-card initiative, exchanges, open or hidden initiative, and round redraws
- Fast and slow action economy
- Surprise, sneak attacks, and multi-target ambushes
- Weapon attacks, range modifiers, opposed Blocks, and helper actions
- Armour, cover, ammunition, reloads, full auto, and overwatch
- Grappling, prone state, retreats, diving blows, and coup de grâce workflows
- Foundry Scene Regions used as configurable abstract zones
- Zone range bands, borders, cover, lighting, clutter, cramped spaces, and line
  of sight
- Action-aware Token movement and Engaged-enemy Retreat handling

### Harm, recovery, and Critical Injuries

- Damage & Stress, Health Only, Conditions, and Attribute Damage models
- Shared damage handling across attacks, hazards, Vehicles, and sheet controls
- Armour protection, degradation, and repair
- Physical and mental Broken states
- Recovery by Shift, safe-Stretch Stress relief, Healing, and target recovery
- All five example SRD Critical Injury triggers
- Draggable physical and mental Critical Injury Item results
- Lethality, stabilization, death saves, treatment stages, healing time, and
  daily care
- Injury restrictions for actions, movement, usable hands, Weapon grip,
  Attribute rolls, and Travel sleep
- Environmental hazards with persistent interval tracking

### Items, equipment, and Specialities

- Archetype, Skill, Speciality, Gear, Weapon, Armour, Consumable, Spell,
  Critical Injury, and Vehicle Component Item types
- Universal Item Effects for modifiers, resources, automatic successes, harm,
  recovery, statuses, armour, and guided outcomes
- Contextual and stack-aware Speciality effects
- Gear degradation, repairs, permanent damage, and Item-defined carry capacity
- Exact and Supply-based Consumables with transfers and food actions
- Item-powered Willpower activations and shared Doom expenditures

### Magic

- Optional ranked magic disciplines and 70 supplied Spell Items
- Willpower-powered casting, overcharge, chance casting, safe casting, power
  words, rituals, grimoires, and NPC base power
- D12 Magic Mishaps and deterministic consequence automation
- Ordered, editable Universal Item Effect recipes on Spell Items
- Damage, recovery, resources, modifiers, armour, statuses, hazards, Critical
  Injuries, resistance tests, timed effects, and guided fictional outcomes
- Active-effect and expiry summaries on the Actor sheet

### Vehicles, Mounts, and Chases

- Vehicle Actors with Hull, armour, speed, fuel, crew, altitude, and component
  tracking
- Land, watercraft, and aerial manoeuvres
- Driving, ramming, damage, critical damage, crashes, repairs, and fuel use
- Vehicle Components for engines, mobility, and mounted Weapons
- Mount Actors with riders, carrying capacity, lameness, equipment, combat, and
  travel rules
- Multi-participant chase tracker with secret manoeuvre commitments
- Individual or grouped positions, obstacles, hiding, cutting off, overtaking,
  attacks, and escape

### Travel and journey maps

- Shared Day, Shift, weather, world time, and journey distance
- Marching, forced marches, navigation, keeping watch, foraging, hunting,
  fishing, camp, rest, and sleep activities
- Party-wide task claims and Scene-aware helpers
- Food preparation, consumption, starvation, sickness, and gathered supplies
- Camps, weather, hazards, hunting results, and travel mishaps
- Vehicle and mounted travel
- Square- and hex-grid journey maps using Tokens and Foundry Regions
- Terrain, roads, route planning, navigation errors, detours, and resumable
  movement

## Supplied Compendium Packs

| Pack | Contents |
| --- | --- |
| **YZE SRD Actors** | 8 example Vehicle Actors |
| **YZE SRD Items** | 193 Items: 12 Skills, 30 Specialities, 12 Weapons, 3 Gear, 10 Consumables, 70 Spells, 3 Vehicle Components, and 53 Critical Injuries |
| **YZE SRD Roll Tables** | 10 Roll Tables with 134 linked and text results |
| **YZE SRD Cards** | A 10-card initiative deck |
| **YZE Game World Setup Guide** | A native four-page Journal linked from the startup wizard |

System updates replace the supplied packs without overwriting copies that a GM
has imported and edited in a world. Older world-owned example documents are
preserved during migration; only the obsolete system-created reference Journal
is removed.

## Development

Install the pack-building dependency:

```bash
npm install
```

Build the Foundry LevelDB packs from the readable JSON sources in `packs-src/`:

```bash
npm run build:packs
```

To refresh those sources from a closed Foundry world:

```bash
npm run export:packs -- "/path/to/foundry/Data/worlds/world-id"
```

Close Foundry before exporting or rebuilding packs. LevelDB files must not be
edited while Foundry has them open.

For implementation details and the rules map, see
[`docs/architecture.md`](docs/architecture.md). Published versions and their
human-readable summaries are available on the
[GitHub Releases page](https://github.com/mrbakerslop/fvtt-yze-srd-toolkit/releases).

## Project status

The toolkit is under active development. The listed systems are playable, but
some deliberately open-ended obstacle, vehicle, magic, and fictional results
still require GM adjudication. Broader game-builder configuration and testing
will continue as the project develops.

## Licence notice

This game is not affiliated with, sponsored, or endorsed by Fria Ligan AB. The
Year Zero Engine System Reference Document is used under Fria Ligan AB's Free
Tabletop License.

Source SRD and licence PDFs, screenshots, and other raster assets are
intentionally excluded from the repository and release archive. The setup
guide and system Compendiums use native Foundry documents and core icons.
