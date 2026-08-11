# Architecture and rules map

## Product boundary

This project is a configurable Year Zero Engine toolkit for people creating
their own games. It should provide mechanics and neutral data structures, not
setting-specific content, names, artwork, or assumptions from published games.

The system has three layers:

1. **World rules configuration** selects the YZE variants used by a game.
2. **World Items** define the game-specific building blocks such as skills,
   specialties, gear, weapons, armour, spells, and archetypes.
3. **Actors** represent characters, NPCs, and vehicles. They own Items and
   store ratings, resources, damage, and narrative traits.

## Stable attribute slots

YZE uses four attributes with two physical and two mental slots. The internal
keys remain `strength`, `agility`, `wits`, and `empathy` so relationships and
stored Skill links remain stable. Their display labels are world settings and
can be renamed at any time.

This is deliberately label configuration rather than arbitrary attribute
creation. Several SRD rules depend on the stable physical/mental distinction:

- pushing costs can depend on the rolled attribute group;
- damage and stress can affect different resources;
- conditions apply to physical or mental rolls;
- Health and Resolve derive from pairs of attributes.

## Skill Items

A Skill Item stores:

- its linked stable attribute key;
- separate dice-pool and stepped-dice ratings on an Actor-owned copy;
- whether it has been used successfully since advancement;
- a free-form description.

World-level Skill Items act as definitions. Dragging one onto an Actor creates
an embedded copy whose rating and advancement state belong to that Actor.

The twelve SRD core Skills are supplied in the **YZE SRD Items** Compendium.
Importing or dragging a Skill creates an editable world definition; dragging a
world Skill onto an Actor creates the rating-bearing embedded copy.

## SRD example content

The SRD's formal examples are distributed as system Compendium Packs for
Actors, Items, RollTables, and Cards. Readable JSON sources in `packs-src/` are
compiled into Foundry v14 LevelDB packs by `npm run build:packs`. A world can
import only the documents it needs, while system updates replace the source
packs without overwriting edited world copies. Legacy migrations still repair
newly required fields on older world documents, but no longer seed content.

Vehicles are Actor documents rather than Items. Their Hull is a trackable
resource with current and maximum values, and their dedicated sheet exposes
the other SRD vehicle statistics. Vehicle Component Items are embedded in those
Actors and contribute driving modifiers while active and undamaged. This
provides a stable ownership model for later, game-specific component expansion
without requiring a document-type conversion.

The Game World Setup Guide is a native Journal Compendium. The GM startup
wizard links directly to its overview, dice, damage, and pushing pages. It does
not embed the temporary development-reference SRD PDF.

Random-result tables are native Foundry RollTable documents. D66 tables use
the formula `1d6 * 10 + 1d6`; other tables retain their stated D6, D10, D12,
or 2D6 formula. The panic table documents its special D6-plus-current-stress
procedure because a directory RollTable has no Actor context from which to
read stress automatically.

Physical and mental Critical Injury results are linked Compendium Items rather than
plain table text. Foundry renders those results as draggable chat links, and
the Actor sheet accepts them in a typed Critical Injuries drop zone. Active
injury Items feed configured Attribute/Skill penalties into the roll engine;
roll-triggered damage is applied through the current harm model. Effects which
require knowledge of the fiction remain visible in the Item description.

## Typed sheet drop zones

Actor sheet sections declare which Item types they accept. A world Item must be
dropped into its relevant section: Skills, Specialties, Inventory, Weapons,
Armour, Spells, or Critical Injuries. A mismatched drop is rejected with a notification.
This keeps a generic toolkit understandable while allowing every Item's
content and name to be tailored to the world.

Skills are displayed beneath their linked attribute rather than in a separate
list. Each attribute card is its own Skill drop zone and rejects Skills linked
to a different attribute.

Character and NPC sheets use the native ApplicationV2 tab system. Attributes,
Skills, Resources, and enabled Conditions share the first tab; Specialities,
Inventory, Weapons and Armour, and Spells occupy four dedicated tabs. The
header and tab navigation remain fixed while the active tab scrolls vertically.
Typed drop-zone semantics are unchanged by this presentation layer.

## Core dice variants

The world selects either D6 dice pools or stepped dice. Both sets of ratings
remain stored so changing the world setting never converts or discards data.
Dice-pool ratings use the existing numeric Attribute and Skill values.
Stepped-dice Attributes use D through A (D6, D8, D10, D12), defaulting to C;
Skills additionally allow None, meaning the roll uses only its Attribute die.

The stepped roll counts 6–9 on a die as one success and 10 or higher as two
successes. Successes are counted directly from each active die result rather
than from the arithmetic sum of the die faces.

An initial roll stores a serialisable snapshot of every die in ChatMessage
flags, including its category, face count, and result. Its author or a GM can
push it once, selecting any dice other than banes. Unsuccessful dice are
selected by default and successes retained by default. The pushed message
combines retained and rerolled dice when counting successes and reports final
banes by source.

The world chooses Damage & Stress, Health Only, Conditions, or Attribute
Damage for ordinary harm. Pushing separately chooses whether Attribute and
Gear banes apply that model or cause no damage. The latter supports a Stress
Dice-only pushing variant without changing how attacks and other harm are
tracked. Stress Dice, Conditions, and Doom Points are independent Boolean
options: Stress Dice participate in both initial and pushed rolls and update
the Actor's Stress; the optional pushing Condition can be enabled independently,
and is also used automatically when pushed-roll bane damage follows the
Conditions harm model. Conditions selected in the push dialog are stored on
the Actor. A Stress-die bane automatically rolls D6 plus current Stress on the
sample Panic table. Persistent effects are recorded on the Actor until Stress
is fully relieved; Tremble and Catatonic are enforced in roll workflows, while
scene-dependent effects remain visible for GM adjudication. Doom uses a hidden
world Number setting as a shared pool and a dedicated scene-control panel. A
world setting chooses the minimum Foundry User Role that can manage it; the
default is Game Master, and ordinary Players remain read-only. A system socket
lets pushes and authorised non-GM managers ask the active GM client to update
that world setting. Willpower gains from
pushes are written to the Actor, using actual Attribute damage when that harm
model is active for pushed-roll banes. Gear damage is also automated when rolled Gear dice identify
their source Item.

Universal Item Effects also define resource-powered activations. An active
embedded Item can expose one or more named Willpower or Doom effects, each with
an exact cost and table-facing instruction. The Actor sheet validates and
spends Willpower locally; Doom activations use the role-gated shared-pool
service and its GM socket. Doom effects on world Items are indexed by the Doom
panel as the world's published expenditure list, while embedded Doom effects
remain Actor-specific.

Broken state is derived from zero-valued Health/Resolve or Attributes, with
explicit physical and mental overflow flags for the fourth Condition. The
Critical Injury trigger is selected independently from all five SRD examples:
Health/Resolve reaching zero, Strength/Wits reaching zero, breaking through
Conditions, reaching a Weapon's Crit threshold, or rolling two attack
successes. A newly Broken Actor produces a chat notice, while the applicable
zero-value or Conditions trigger draws the appropriate linked Critical Injury
table automatically. The SRD pushed-damage exception suppresses that injury
draw. Broken Actors cannot use ordinary Attribute or Skill sheet
rolls. Lethal injury Items support Healing-roll stabilization and unpushable
death saves, while instant-death Items mark the Actor deceased when embedded.
Critical Injury Items also carry structured restrictions for movement, usable
hands, blocked Attributes, complete action lockout, and sleep. The Actor
aggregates all active injuries before rolls and action workflows; combat checks
Weapon grip against remaining hands, movement-based workflows reject paralysis,
and Travel enforces the SRD Nightmares and Nocturnal sleep rules. Restrictions
which depend on fictional context remain descriptive for GM adjudication.
Recurring mental-trauma triggers are structured fields with Actor-sheet actions.
Ruptured Intestines and Cracked Spine use explicit special-rule identifiers so
their disease exposure and one-chance urgent treatment remain data-driven rather
than depending on the displayed Item name.

External damage passes through a shared harm service, so attacks, manual sheet
controls, Vehicles, all four harm models, and recovery use the same update
rules. Armour Items retain independent dice-pool and stepped ratings plus their
starting maxima. Equipped armour rolls its rating without pushing, absorbs one
damage per success, and loses one rating per bane only when damage penetrates.
Crafting rolls restore armour toward its recorded maximum. Vehicle armour uses
the same calculation with ratings stored on the Vehicle Actor.

Recovery controls implement the generic SRD timing points: a non-Broken Actor
recovers one physical and one mental point simultaneously after a Shift,
complete Stress relief follows a safe Stretch, and Broken healing remains a
separate choice. Healing is a
normal pushable Skill roll whose chat card can recover a Broken target by its
successes or stabilize one lethal Critical Injury. Those purposes are separate
rolls. Critical-injury death-save deadlines, treatment stages, healing days,
and daily care are tracked against Foundry world time. Travel Shift advancement
advances the same clock.

Magic Spell Items separate casting metadata and descriptive rules text from an
ordered list of Universal Item Effects. Eleven spell effect types cover damage,
recovery, modifiers, resources, statuses, armour, automatic successes, Item
damage, Critical Injuries, hazards, and guided workflows. Each row owns its
target mode, eligibility instruction, power formula, duration, and the small
amount of type-specific data needed by its generic handler. The 70 supplied SRD
spells are data recipes built from those rows rather than spell-name branches.

Persistent outcomes are Actor flags with world-time and combat-round expiry.
The same flags feed roll modifiers and replacements, magical armour, action
availability, recovery restrictions, recurring consequences, Magical Seal
power reduction, and the Actor sheet's active-effect summary. Exceptional
fictional outcomes use named generic workflows for resistance tests, resource
transfer, distribution, dispelling, requirements, transformations, summoning,
and recorded GM rulings. This keeps custom Spell Items composable while still
automating all deterministic SRD consequences. Legacy flat spell automation is
retained as a read-only compatibility fallback. Magic mishaps automate direct
damage, Stress, Critical Injuries, sleeplessness, blindness, magical-disease
exposure (including Actors who later become Engaged), unintended targets,
permanent alteration, demon deadlines, and rift return. Backfire remains a
recorded GM ruling because the SRD deliberately leaves its reversal or
corruption to the fiction.

The Chase tracker is hidden shared world state containing a variable participant
list, relative positions, secret commitments, round state, and the manoeuvres
resolved this round. The GM starts and updates it, while participant rolls retain
their chase context in chat flags through pushing. Opposed Hide and Cut Off rolls,
overtaking, immediate attacks, Stand and Shoot, and obstacle consequences update
the same tracker. Vehicle Actors store Driver and passenger UUIDs so
crash and critical consequences can reach the affected Actors. Repair attempts
are keyed by damaged part and six-hour world Shift.

Travel keeps shared clock, weather, and distance settings plus per-Actor task
ledgers. Ledgers enforce task compatibility and retain location histories for
cumulative foraging penalties. A square- or hex-grid Scene can additionally
store a party marker, Region terrain, route, per-Shift resumable movement,
off-road Navigation approvals, fractional movement banks, and encounter detour
costs. March and Drive outcomes require GM application because they mutate
shared journey state; personal supply, rest, sleep, and hazard changes still
update the owning Actor or selected Vehicle directly.

## Canvas zones

YZE zones reuse Foundry Scene Region documents rather than maintaining a
second set of canvas polygons. A Region flag enables it as a zone and stores
Cluttered, Dimly Lit, Cramped, cover, and GM-note metadata. An undirected graph
on the Scene connects Region IDs with open, open-door, closed-door, or blocked
borders. Breadth-first traversal supplies the SRD range bands, while sight
traversal additionally rejects closed borders, intervening Dimly Lit zones,
occupied Cramped zones, and collisions reported by Foundry's sight polygon.

The Region and Token toolbars expose zone configuration and controlled-token
range analysis. Weapon attacks, standard-range spells, Bodyguard eligibility,
Observation modifiers, and Take Cover consume the same spatial service. The
Version 14 pre/post token-movement hooks enforce adjacent movement in combat,
spend fast or slow actions after a successful move, require Retreat before
leaving Engaged enemies, and resolve the Cluttered Mobility test on entry. A
Retreat roll carries a push-aware one-use movement permission. If its final
result fails, the post-movement workflow asks the primary active GM to roll an
actionless and unblockable standard melee attack for each hostile token that
was Engaged at the origin but not at the destination; normal attack modifiers,
pushing, armour, damage, and Critical Injury handling remain shared.

Base maximum Health and Resolve are derived during Actor preparation from the
active dice-system ratings. Current resource values remain stored Actor state
and are clamped to those maxima. Active Tough and Hardened Items contribute to
those maxima through the isolated Speciality-effect service, with the SRD
three-purchase cap. Pack Mule contributes to the same service's carry-limit
bonus.

Every sheet roll opens a modifier dialog. It lists difficulty, eligible helpers, applicable
Conditions, applicable Specialities, carried Gear and Weapons with bonuses,
and a free-form numerical adjustment. Built-in conditional Speciality effects
are filtered by Skill and workflow rather than being offered globally.
Helpers are derived from mechanically capable Character and NPC tokens in the
roller's active Scene, capped at three, and stored by UUID and name in roll
state. Combat workflows declare Fast or Slow support; selected helpers spend
the matching action before the roll, with the active GM mediating updates to
helpers the rolling user does not own. Pushing retains the original helper
record without charging their actions again.
Dice-pool Gear is
kept as a separate category while the other cumulative modifier follows the
Skill → Gear → Attribute removal order.

Stepped Dice worlds separately select numerical modifiers or the SRD's
Advantage/Disadvantage alternative. Numerical modifiers balance the lower die
upward and higher die downward, add a D6 when stepping up a single-die roll,
cap at two D12s, and never reduce the roll below one D6. In the alternative
method, positive and negative sources cancel one-for-one before a net Advantage
adds a third die matching the lower base die or a net Disadvantage removes the
lower die. The added die has its own category so its banes are not mistaken for
Attribute banes by push-cost automation.

## World-level rule switches

These should be configured once near the beginning of a campaign. Changing a
fundamental switch in an established world may require a guided migration.
Core dice, harm model, Stress Dice, Conditions, Doom Points, Willpower,
Critical Injury tracking, Experience tracking, Magic, Vehicles & Chases, and
Travel switches are implemented. The shared equipment/combat variant selectors
are also implemented, including their sheet visibility, encumbrance calculation,
Critical Injury trigger, and initiative behavior. Six configurable Actor
identity fields can also be labelled and enabled per world.

| Area | SRD variants |
| --- | --- |
| Core dice | D6 dice pools; step dice |
| Harm model | Damage & Stress using Health/Resolve; Health only; Conditions; Attribute Damage |
| Push options | Bane damage can follow the harm model or be disabled; Stress Dice, Conditions, and Doom Points are independent switches |
| Initiative | open card draw; hidden cards redrawn each round |
| Encumbrance | standard; weapons at hand; disabled |
| Consumables | exact tracking; Supply ratings |
| Critical injuries | broken-triggered; damage threshold; success-triggered |
| Ammunition | untracked; individual rounds; Supply ratings; Ammo Dice data |
| Optional subsystems | combat depth; vehicles; magic; travel |

## Delivery slices

### Slice 1: playable data foundation

- installable Version 14 system;
- Version 14 DataModels and Application V2 sheets;
- Character and NPC Actors;
- Vehicle Actors with dedicated sheets;
- configurable attribute labels;
- Skill, Specialty, Gear, and reusable Archetype Items;
- a dice-system-aware guided character builder;
- dice-pool and stepped-dice Attribute and Skill rolls;
- one-time push workflow with selectable non-bane dice.

### Slice 2: complete roll engine

- stepped-dice modifiers and balancing rules (implemented);
- Advantage/Disadvantage alternative (implemented);
- roll dialog for modifiers and gear dice (implemented);
- push workflow retaining the original dice result (implemented);
- selectable push-cost policy (core policies implemented);
- opposed-roll workflow and active-party-only pushing (implemented);
- Gear Bonus degradation and stepped-dice Reliability tracking (implemented);
- Item-defined carry-capacity and automatic Mobility effects, general Supply rolls and transfers,
  Artifact Dice, and permanent Gear-repair consequences (implemented);
- universal multi-effect Item automation for all-roll, Attribute, and
  individual-Skill modifiers and extra pushes, alternate Attributes,
  initiative draws, healing time, derived Health/Resolve/carry values,
  Willpower-powered activations, and role-gated Doom expenditures
  (implemented);
- chat cards with die categories, banes, and push state;
- deterministic unit tests for roll interpretation.

### Slice 3: character state

- Archetype selection, SRD starting Attribute/Skill allocations, starting
  Speciality and equipment choices, and initial derived resources
  (implemented);
- chosen damage model and derived resources (implemented);
- conditions, broken state, core recovery, and critical injuries (implemented);
- experience with a timestamped award/spend ledger, stack-aware Speciality
  advancement, magical discipline ranks, and derived Speciality bonuses
  (implemented);
- configurable Pride, Weakness, Dark Secret, Big Dream, Buddy, and linked
  Relationship data with world labels and XP-question integration
  (implemented);
- encumbrance calculation, reusable container effects, consumable representations,
  and general Supply-roll/transfer execution (implemented).

### Slice 4: conflict and optional subsystems

- card initiative, initiative exchange, and core action economy (implemented);
- active/passive and public/GM-secret roll modes, per-Actor non-combat goal
  locks for the one-chance rule, and GM-only lock clearing (implemented);
- surprise card choice, push-aware individual Sneak Attack setup and attack
  benefits, and GM-resolved multi-victim Ambush Observation/bottom-card draws
  (implemented);
- Fast Reflexes, contextual attack Specialities, repeat-push Specialities,
  Second Wind, Lucky/Killer Critical Injury choices, Flyweight blocking,
  universal-effect Bodyguard interception, and universal-effect Merciless
  coup-de-grace handling (implemented);
- Weapon attacks, range modifiers, opposed Block reactions, rated/degrading
  cover, armour protection/degradation, counted/Supply/Ammo-Dice ammunition,
  reloading, basic full auto, prone/retreat state, special attacks, grappling,
  diving blows, ordered simultaneous overwatch, prepared bows/slings, selectable Critical Injury triggers, Region-based
  abstract zones, line of sight, and action-aware token movement (implemented);
- vehicle components, occupants and cover, crew actions, land/water/aerial manoeuvres, ramming, critical consequences,
  per-part repair rolls, and shared chase range tracking (implemented);
- optional Magic casting, configurable spell outcomes, timed modifiers, and
  direct mishap consequences (implemented);
- optional Travel clock, square/hex routes, shared distance, task ledgers,
  Navigation, encounters, camps, survival, hunting, terrain/repeat modifiers,
  recovery, vehicle travel, and driving-mishap automation
  (implemented).

### Slice 5: game-builder experience

- a GM configuration application;
- validation of incompatible rule combinations;
- starter templates without setting-specific content;
- import/export of a world's game definition;
- migrations and release packaging.

## Licensing checkpoint

The supplied Free Tabletop License version 1.0 permits copying, modification,
and distribution of the YZE SRD as a VTT within its stated scope. It requires a
non-affiliation notice and a copy of or link to the licence with each
publication. It excludes other Free League text, artwork, brands, and logos
except for the separately controlled optional YZE logo.

Before a public release, review the final package contents and public project
description against the supplied licence. This document records a development
interpretation, not legal advice.
