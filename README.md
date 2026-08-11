# YZE System Toolkit for Foundry VTT

An early Foundry Virtual Tabletop Version 14 game system based on the
Year Zero Engine Standard Reference Document. The goal is to provide a toolkit
for building original games rather than reproduce a specific published game.

This first vertical slice provides:

- Foundry VTT Version 14 package metadata
- Character and NPC data models
- A dedicated Vehicle Actor model and resizable sheet
- Four attributes with world-configurable display names
- Skills implemented as configurable Item documents
- SRD example Actors, Items, RollTables, and Cards supplied as Compendium Packs
- A native Game World Setup guide supplied as a Journal Compendium
- World-selectable D6 dice-pool or stepped-dice core resolution
- Type-aware sheet drop zones for Skills, Specialties, Inventory, Weapons,
  Armour, and Spells
- Reusable Archetype Items and guided SRD character creation for both dice systems
- Structured, world-configurable personality traits and linked Character relationships
- Attribute and skill rolls with YZE success counting
- Roll dialogs for difficulty, Scene-based helper selection, Specialties, Gear,
  Conditions, and other modifiers
- Active/passive and public/secret roll choices with SRD one-attempt goal locks
- Automated surprise initiative, sneak attacks, and multi-target ambush draws
- One-time pushed rolls with selectable dice, retained results, and bane reporting
- Once-per-session Pride successes and pushable Insight resistance for stressful situations
- Armour protection, damage application, Healing rolls, and recovery controls
- SRD environmental hazards with persistent interval tracking
- Timed Critical Injury death saves, treatment stages, healing days, and daily care
- Mechanical Critical Injury restrictions for actions, movement, usable hands,
  Attribute rolls, Weapon grip, and Travel sleep
- Optional Magic, Vehicles & Chases, and Travel workflows
- Reference-inspired monochrome Character and NPC sheets with configurable identity fields
- Shared black-and-white window styling for system sheets, configuration apps, and pop-up dialogs
- Application V2 Actor and Item sheets

## Automated installation

In Foundry VTT's **Game Systems** setup screen, use **Install System** and paste
this manifest URL:

```text
https://github.com/mrbakerslop/fvtt-yze-srd-toolkit/releases/latest/download/system.json
```

Published versions are built from Git tags and attached to the corresponding
GitHub Release. Foundry uses the stable manifest URL above to discover the
latest version and download its installable system archive automatically.
Versions follow `FoundryVersion.GameSystemMajorVersion.MinorFeatureVersion`;
for example, the initial Foundry VTT 14 release is `14.0.80` and is tagged
`v14.0.80`.

## Local installation

The directory name must match the system id, `fvtt-yze-srd`. Place or link this
directory at:

```text
{Foundry user data}/Data/systems/fvtt-yze-srd
```

Restart Foundry and create a world using **YZE System Toolkit**. The GM setup
wizard opens on startup until its launch checkbox is cleared. It configures the
core dice system, damage model, and pushing consequences, with links to the
more detailed Journal guide. The wizard can always be reopened under
**Configure Settings → System Settings**.
Core Mechanics are grouped at the top of that page. Separate buttons beneath
them open the Pushing & Consequences, Equipment & Combat Rules, Character Sheet
Features, Currency & Prices, Personality & Relationships, Optional Subsystems,
Attribute Names, and Character Header Fields configuration windows.
Reload the world after saving changes.

The same world settings choose **Damage & Stress**, **Health Only (no
Resolve)**, **Conditions**, or **Attribute Damage** as the harm model. Stress
Dice, Doom Points, Conditions, Willpower, Critical Injuries, and Experience are
independent on/off switches, except that Conditions are always enabled when
they are the selected damage model. **Magic / Spells**, **Vehicles & Chases**,
and **Travel** have independent world switches in **Optional Subsystems**. The
sheet also provides six world-configurable identity-field slots; each slot has
its own label and visibility setting.

**Currency & Prices** optionally adds a numeric balance beside Encumbrance on
the Character's Inventory tab. Its world-specific label can be Cash, Money,
Credits, Gold, Resources, or any other term. The same configuration chooses
exactly which Item types display a price field; Gear, Weapons, Armour,
Consumables, and Vehicle Components are selected by default. Currency and
price values remain stored when the feature or an individual Item type is
disabled.

**Equipment & Combat Rules** selects the SRD variants used by the world:
standard, Weapons-at-Hand, or disabled encumbrance; exact or Supply-rated
Consumables; all five SRD example Critical Injury triggers (Health/Resolve at
zero, Strength/Wits at zero, broken by Conditions, weapon Crit threshold, or
two attack successes); untracked, counted, Supply-rated, or Ammo-Dice
ammunition data; and open or
hidden initiative cards. Hidden initiative conceals other combatants' values
from players and redraws the ten-card initiative at the beginning of each new
round. Exact quantities, Supply ratings, magazine ammunition, and Rate of Fire
remain stored when their fields are hidden, so changing a variant does not
discard Item data.

The two variants store separate ratings. In dice-pool mode, Attributes and
Skills use numeric D6 pool ratings. In stepped-dice mode, Attributes use A–D
(D12–D6), while Skills use None or A–D. A stepped Skill roll combines its
Attribute and Skill dice; a result of 6–9 gives one success and 10 or higher
gives two successes. Switching variants does not reinterpret or erase the
other variant's ratings. The **Stepped rating labels** world setting controls
whether stepped-rating menus show only letters (D, C, B, A) or only die sizes
(D6, D8, D10, D12); this is a display choice and does not alter stored ratings.
On Character sheets, Skill names are presented as compact clickable text: click
a name to roll it, or right-click its row for the Skill context menu. Attribute
names and rating controls share the same left edge, sizing, and column alignment
as the Skills listed beneath them.

Create **Archetype** Items in the Items sidebar to define a key Attribute, key
Skills, available starting Specialities, automatically granted equipment, and
optional equipment choices. Each Archetype also sets exactly how many
Speciality and equipment picks are allowed; these limits cannot exceed the
number of options configured on that Archetype. The **Create Character** title-bar
button first selects an Archetype and then opens the guided starting
allocation. Dice-pool Attributes begin at 2 and Skills at 0, both with bounded
−/+ controls; creation enforces exactly 14 Attribute points and 10 Skill
points, including the Archetype limits. Stepped-dice creation enforces three
net Attribute increases from C and the SRD distribution of one B, two C, and
three D Skills, with the B assigned to a key Skill. Applying the result adds
all world Skills, sets the chosen ratings, copies the configured starting
Items, initializes Health and Resolve, and records the selected Archetype in
the enabled Archetype identity field. The creation control is hidden after the
character has been created.

**Personality & Relationships** in System Settings controls the structured
Character fields for Pride, Weakness, Dark Secret, Big Dream, Buddy, and
Relationships. Each field can be renamed or hidden for the current world
without erasing Actor data. Enabled fields appear on the Character's
**Personality** tab. Pride includes a once-per-session usage checkbox; Buddy
and Relationship entries link to other Character Actors; Relationships hold a
separate descriptive sentence. Dark Secrets are shown only to an Actor owner
or GM. The end-of-session XP question automatically uses the enabled,
world-specific personality labels.

In Damage & Stress worlds, maximum Health and Resolve are derived from the
active Attribute ratings. In Health Only worlds, the same Health calculation
is used and Resolve is hidden. Dice-pool Health is the rounded-up average of
Strength and Agility plus one; Resolve uses Wits and Empathy. Stepped-dice
Health and Resolve use the corresponding two Attribute die sizes, divide their
sum by four, and round up. Current visible values are independently damageable
and are clamped to the calculated maximum. Each active Tough or Hardened
Speciality adds one to maximum Health or Resolve respectively, capped at three
purchases. Pack Mule adds two to the calculated carry limit.

After an Attribute or Skill roll, its chat card allows the roll's author or a
GM to push it once. Compassion, Inquisitive, Reckless, and True Grit allow a
matching Skill roll to be pushed a second time. Any non-bane die can be selected
for rerolling from the illustrated dice-selection dialog opened by **Push
Roll**; unsuccessful dice are selected by default, while successful dice are
retained by default. The pushed chat card reports the final combined successes
and banes by Attribute, Skill, Gear, and Stress source.
When pushed-roll bane damage is enabled, Damage & Stress makes Attribute banes
on a pushed physical roll reduce Health and those on a mental roll reduce
Resolve. With Attribute Damage, they reduce the rolled Attribute instead. With
Health Only, Attribute banes from both physical and mental rolls reduce Health.
When bane damage is disabled, Attribute and Gear banes cause no harm; this
allows Stress Dice to be the only pushing cost. Stress Dice add the Actor's
current Stress as D6s to initial rolls, add one Stress and one new Stress Die
when pushing, and automatically roll D6 plus current Stress on the Panic table
whenever a Stress Die rolls a bane. Panic effects are shown on the sheet until
all Stress is relieved; Tremble applies its Agility penalty automatically and
Catatonic prevents normal rolls. Effects involving nearby or hearing characters
are reported in chat for scene-specific adjudication. When the pushing
Condition option is enabled, pushing applies the selected physical or mental
Condition. The same selection is required automatically when pushed-roll bane
damage follows the Conditions damage model. In that model, Health and Resolve
are hidden and condition tracking is mandatory; acquiring a fourth Condition of
the same type reports that the Actor is broken and suffers an appropriate
critical injury. Enabled Doom Points use a shared world pool: every push adds
one, and all users can open the dedicated Doom panel from the Token scene
controls. Management is restricted by a configurable minimum Foundry User Role
(Game Master by default), and Doom is no longer shown on individual Actor
sheets. When Willpower is enabled, pushing grants one point by default. When
pushed-roll banes use Attribute Damage, it instead grants one point per
Attribute point actually lost from the push. Actor-sheet controls also support explicit
Willpower gains and spending for world-specific abilities and magic.

Willpower-powered Specialities and Doom expenditures are configured through
the universal Item Effects editor. Add a **Willpower-powered activation** to a
Speciality, give the activation a name, Willpower cost, and mechanical/table
instruction, then place and activate that Speciality on an Actor. Available
effects appear in the Actor's General tab and beside the Speciality; activating
one validates ownership and available Willpower, spends the exact cost, and
posts the instruction to chat. Multiple activations can be added to one Item.

Add a **Doom expenditure** to a world Item to publish it in the shared Doom
panel, or put it on an Actor-owned Item for an Actor-specific GM ability. Each
entry has its own name, Doom cost, and instruction. Only Users meeting the
world's configured Doom manager role can activate it, and the shared pool must
contain the full cost. World-level entries remain visible in the Doom panel so
the table has the clear, known expenditure list required by the SRD.

Clicking an Attribute or Skill opens a roll dialog before any dice are rolled.
Difficulty ranges from Trivial (+3) to Formidable (−3). Help is selected from
up to three mechanically capable Character or NPC tokens sharing the roller's
active Scene, with each helper providing +1. In combat, every helper spends a
Fast or Slow Action matching the supported action; unowned helper actions are
validated and spent by the active GM client over the system socket. Helper
names and their action type remain recorded on initial and pushed roll cards.
The same dialog separates roll type from visibility: passive rolls cannot be
pushed, while secret rolls and any Stress-triggered Panic result are visible
only to GMs. A specific non-combat goal can be entered to enforce the SRD's
one-chance rule. That Actor is blocked from repeating the goal until a GM
clears its lock on the sheet; a different Actor may still try, and combat rolls
are never locked.
Applicable Conditions are included automatically, and an Other field handles
game-specific circumstances. Active Specialties with a non-zero modifier and
carried Gear or Weapons with a bonus are listed for selection. In dice-pool
mode selected Gear remains a distinct Gear Dice category; all other modifiers
follow the SRD removal order of Skill, then Gear, then Attribute dice. Gear and
Weapons can also carry a D8, D10, or D12 Artifact Die in dice-pool worlds. It
rolls separately, scores one success on 6–9 and two on 10+, can be pushed, and
does not itself degrade on a bane.

Every active roll chat card can start an opposed roll. The initiating user or
a GM chooses an available Character or NPC and one of its Attributes or Skills,
then resolves that opposition with the normal modifier dialog. The opposing
party cannot push. The comparison card applies the SRD rule that each opposing
success cancels one active success, treats ties as a normal failure for the
active party, and updates automatically if the active party pushes afterward.

In dice-pool worlds using Attribute Damage, selected Gear and Weapon dice retain
their embedded Item identity. A bane on one of those dice after a push reduces
that Item's Gear Bonus automatically; a bonus of zero marks it broken and keeps
it out of later modifier dialogs. Stepped-dice Gear and Weapons instead track
current and maximum Reliability. Reliability is editable on both the Actor and
Item sheets, and an item at zero Reliability cannot be selected for a roll.
Gear and Weapon rows provide a Crafting repair action: each success restores a
lost point, a failed attempt permanently lowers the maximum to the current
rating, and failing while broken destroys the embedded Item. Attempts take a
Shift and are limited to one per Item in the current Shift.

With Supply consumables enabled, each Consumable row can roll up to six D6 and
automatically loses one Supply step per bane. Supply can also be transferred
one-for-one to a matching Consumable on one targeted Character or NPC. An
equipped Backpack doubles the Actor's calculated carry limit, weighs nothing,
and automatically applies −2 to Mobility rolls while encumbrance is enabled.

Every Item type has a reusable **Item Effects** editor. An Item can hold any
number of active effects: roll modifiers and extra pushes targeted at all
rolls, a renamed Attribute, or an individual Skill; an alternate Attribute for
a named Skill; additional initiative-card draws; a healing-time multiplier;
and modifiers to maximum Health, maximum Resolve, or carry limit. Roll
modifiers are offered individually in the normal roll dialogue. Effects from
carryable Items require the Item to be equipped; Specialities and Critical
Injuries must be active. This keeps the same effect definitions usable on
custom Gear, Weapons, Armour, Spells, Skills, injuries, and Specialities.

Foundry's Combat Tracker uses the standard SRD initiative deck: drawing assigns
unique cards numbered 1–10 and sorts combatants from lowest to highest. The
order remains fixed between rounds in the open-card mode. In hidden-card mode,
players see only values for Actors they own, the GM receives the complete draw,
and all cards are redrawn each round. A fully surprising Actor can choose any
available card, after which everyone without initiative draws normally.
Sneak Attack rolls apply the Engaged-range Stealth penalty, remain pushable,
and on success prepare the next matching attack against the chosen target;
close-combat sneak attacks gain +3 and cannot be blocked. A GM can resolve an
ambush against several targeted victims using secret passive Observation
rolls, the optional well-prepared −2 modifier, randomly assigned bottom cards
for failures, and normal draws for everyone else. Identical NPCs can still be
given the same card manually for group initiative. These controls are grouped
in the compact **Manoeuvres** panel, with instructions available by hovering
over each manoeuvre. At the start of a combatant's turn, its Actor sheet can
exchange initiative with a later combatant before any actions are spent.

The General tab places the compact **Character State** and **Critical
Injuries** panels side by side. Character State combines Resources with a
single Harm, Recovery & Broken block; its actions use compact icon controls and
show their instructions on hover.

The **YZE SRD Cards** Compendium supplies an initiative deck numbered 1–10. A
GM can import it for manual draws and chat reveals. Automatic Combat Tracker
draws use the same values but do not consume cards from an imported deck.

Actors in the active Combat display a **Combat Actions** panel. It tracks one
Slow plus one Fast Action, or two Fast Actions, including reactions spent out
of turn. Actions refresh automatically at the beginning of each round. Weapon
rows have an Attack button: target one token, choose the attack Skill and basic
SRD circumstances, then resolve the normal roll and push workflow. Successful
attacks calculate base Weapon damage plus one per extra success and provide a
chat button which applies damage through the world's selected harm model.

Melee attack cards now offer the target owner a **Block Attack** reaction.
Blocking spends a Fast Action, rolls Melee as the defending side of the
opposed attack, enforces the armed-block prerequisite, and lets Flyweight use
Agility. Actors can take rated cover with a Fast Action. Ranged damage rolls
and degrades that cover before selecting one equipped Armour Item.
Dice-pool armour rolls D6s equal to its current rating; stepped armour rolls two
dice at its current A–D rating. Each success absorbs one damage. If damage
penetrates, every armour bane reduces its current rating; banes do not degrade
armour when it absorbs the whole hit. Pool and stepped ratings are stored
separately, with editable current and starting/maximum values. A Crafting roll
can restore one armour step per success up to that maximum. Vehicle armour uses
the same protection workflow.

The General tab's **Harm & Recovery** panel can apply non-attack damage or make
manual healing adjustments against the tracks supplied by the selected harm
model. **Recover a Shift** restores one point under the SRD recovery rules;
when Attribute Damage has several eligible tracks, the player chooses which
Attribute recovers. **Relieve Stress** removes all Stress after a safe Stretch.
Targeting one token and choosing **Use Healing on Target** rolls the healer's
Healing Skill. A successful result can either recover a Broken target, advance
a lethal Critical Injury's death-save interval, or provide daily care. These
remain separate rolls. World time now counts rolled healing days, makes a day
with successful care count twice, and deactivates healed injuries. Lethal
injuries schedule their next death save by Round, Stretch, Shift, or Day; failed
treatment is locked until the patient's next successful death save.

The General tab also contains an **Environmental Hazards** panel. It resolves
darkness, fire, explosions, falls, drowning, poison, disease, cold, starvation,
and sleep deprivation using the active pool or stepped dice rules. Continuing
hazards are stored on the Actor, become due as world time advances, and enforce
the SRD restrictions on natural damage or Stress recovery.

The ammunition world option drives the complete firing workflow. Counted
magazines spend rounds and reload with the weapon's configured action. Supply
weapons make the SRD depletion roll after basic full-auto fire. Ammo Dice are
limited by Rate of Fire and remaining rounds, do not help the attack hit, spend
the sum of their faces plus one, and can add damage or create additional hits.
Pushing Ammo Dice reconciles magazine expenditure against their replacement
faces without double-spending rounds.
The combat panel also handles prone/get-up state, retreat, taking/leaving
cover, grapples and breaking free, and assuming/firing/cancelling overwatch.
Weapons with telescopic sights can spend a Slow Action preparing the SRD +3
aim for a later round; acting or taking damage clears the prepared aim.
Unarmed attack dialogs include disarm, trip, shove, grapple, grapple attacks,
and diving blows. Foundry Scene Regions can be enabled as YZE zones from the
Region toolbar's **YZE Zone Manager**. The manager stores Cluttered, Dimly Lit,
Cramped, cover, notes, and explicit open, door, or blocked borders on the Scene.
The canvas range tool measures controlled-to-targeted tokens, combines those
borders with Foundry walls for line of sight, and drives weapon and spell range.
In combat, token movement spends the appropriate fast or slow action, permits
one connected zone per action, rolls Mobility when entering Cluttered zones,
and requires the existing Retreat action before leaving an Engaged hostile.
After a failed Retreat, moving the token automatically launches a free,
actionless, unblockable close-combat attack from every Engaged enemy actually
left behind. The attack uses that enemy's best equipped close-combat weapon
(falling back to Unarmed), retains the normal universal modifier/push dialog,
and produces the standard attack damage card.

Stepped Dice worlds choose **Numerical modifiers** or **Advantage /
Disadvantage** under System Settings. Numerical modifiers balance the two base
dice within the one-D6 to two-D12 limits. In Advantage mode, each positive and
negative source cancels one-for-one. One net Advantage adds a third die matching
the lower base die; one net Disadvantage removes the lower die; a balanced result
leaves the base dice unchanged. The dialog replaces Other modifier with explicit
Additional Advantages and Disadvantages fields in this mode.

The SRD recommends a minimum Skill rating of D when using Advantage. For a
single-die roll, this toolkit adds one matching die for Advantage and preserves
the sole die under Disadvantage, and reports that compatibility case in chat.

Speciality Items have an editable rules-effect selector and optional target.
The supplied SRD Specialities use stable effect identifiers. Generic
custom Specialities can still expose a manually selected modifier on every
roll, while conditional SRD bonuses are limited to the correct context:
Field Surgeon applies only to lethal-injury stabilization, Musician is offered
only for Persuasion, Hard Hitter spends a Fast Action on a Melee attack, Sniper
requires a hidden single shot at Long or Extreme range, and Weapon Specialist
requires an exact configured Weapon name. Gut Feeling and Menacing offer their
Empathy/Strength Attribute substitutions before the relevant Skill roll.

Fast Reflexes draws two unique initiative cards and prompts for the one to
keep. Lucky and Killer roll two Critical Injury results and prompt for the
preferred result. Second Wind is available from the Broken panel, cannot be
pushed, and resets only after the Actor is no longer Broken. Healer displays
halved Critical Injury healing time. Attacking with an unready Weapon normally
spends the SRD Fast Action to draw it, while Quick Draw waives that cost.
Flyweight is applied automatically to Block reactions. Bodyguard and Merciless
use the universal Item Effects system rather than being tied to those supplied
Speciality names. **Hit interception** lets any active Item grant a pushable,
action-free reaction using a configured Skill to redirect an ally's hit from
within Short range; the supplied Bodyguard uses Mobility. **Coup-de-grâce
permission** lets any active Item bypass the normal
Empathy-only roll when killing a defenseless target. The coup still spends a
Slow Action in combat and applies one point of mental harm to the executioner
through the world's selected damage model. Legacy world-seeded Bodyguard and
Merciless Items are recognised for compatibility and are migrated to the new
effects automatically.

Create Skills in the Items sidebar. Each Skill selects its linked attribute.
Drag Items onto their labelled section of a Character or NPC sheet. The sheet
rejects mismatched Item types. Embedded Skill ratings and successful-use marks
can be changed directly beside the Skill on the Actor sheet. Hovering over a
Skill name displays its description. Right-clicking a Skill row opens its
context menu, where the embedded Skill can be removed from the Actor after
confirmation without deleting the reusable world Skill.

Character and NPC sheets keep identity and the four Attribute/Skill columns
above their tabs. The tabs are **General**, **Inventory**, **Specialities**,
optional **Personality**, optional **Experience**, optional **Magic / Spells**,
optional **Travel**, and **Notes**. General contains equipped Items and the
character-state features enabled for the world. Resources, Harm & Recovery,
and Broken share one responsive **Character State** panel. Inventory has separate
drop zones for Weapons, Armour, Gear, and Consumables. Notes is always present
and stores free-form player notes. The sheet scrolls as content grows, with the
tab navigation remaining available at the top of the window.

Successful-use tracking is a world option under **System Settings → Character
Sheet Features**. Disabling it hides the checkboxes without erasing existing
marks.

When Experience is enabled, its dedicated tab shows the current balance and a
persistent ledger of every award and spend, including its reason, timestamp,
recording user, change, and resulting balance. Existing balances are migrated
to an opening-balance entry. **Award XP** presents the six SRD end-of-session
questions plus an additional game-specific award. **Spend XP** applies the SRD
target-level costs for the active dice system, resets the advanced Skill's
successful-use mark, and can copy new Skill or Speciality Items from the world
directories. **Adjust XP** records other awards, spends, or corrections without
bypassing the ledger. Advancement enforces
rest/between-session timing, successful-use or teacher requirements for Skills,
and teacher instruction plus a successful Persuasion roll for Specialities.
Disabling successful-use tracking removes that prerequisite without removing
the SRD teacher requirement for non-magical Specialities. Tough and Hardened
can each be purchased three times, and Weapon Specialist can be purchased once
per distinct configured Weapon name. Magical discipline Specialities can be
advanced to rank 3 for 10 XP with a higher-rank master or 30 XP without one.

An embedded Skill can be removed from an Actor with its trash button after a
confirmation prompt. This removes only the Actor-owned copy; the reusable world
Skill remains available.

The system supplies its editable SRD examples in five Compendium Packs: Actors,
Items, Roll Tables, Cards, and the Game World Setup Guide. Drag individual
documents into a world or use Foundry's pack import controls when a world-owned
copy is needed. The Items pack contains 193 Items and the Actors pack contains
8 Vehicle Actors:

- 12 core Skills;
- 30 Specialties, including seven example magic disciplines;
- 12 Weapons;
- 3 pieces of Gear and 10 Consumables;
- 70 Spells with discipline, rank, range, duration, ritual, and power-word
  metadata;
- 3 example Vehicle Components covering engine, mobility, and mounted-weapon
  customisation;
- 36 physical and 17 mental Critical Injury Items, including lethality, time
  limits, healing times, roll penalties, and other effects.

The Vehicle Actors are created in **YZE SRD Vehicles** and track passengers,
manoeuvrability, current and maximum Hull, armour, on-road and off-road speed,
fuel, driver, driving Skill, altitude, and operational state. With Vehicles &
Chases enabled, Vehicle Component Items can be dragged to the sheet; active,
undamaged components modify driving rolls. Drop them into the dedicated
**Vehicle Components** panel to create an Actor-owned copy. The sheet provides manoeuvre,
ramming, chase, obstacle, damage, and repair controls. A hit dealing at least
half the Vehicle's maximum Hull automatically rolls D6 critical vehicle damage
for close attacks or D12 for other attacks and applies statuses which can be
represented directly by the Actor data.

With Magic enabled, the seven supplied discipline Specialities are tiered
prerequisites. Casting from the Actor's Spells tab spends personal Willpower or
Willpower stored by a Power Rune, rolls one Magic Die per point spent, adds
overcharge power for 6s, and triggers the D12 Magic Mishap workflow for banes or
chance casting. The dialog supports safe casting, grimoires, NPC base power,
normal, power-word, and ritual timing; Magic rolls cannot be pushed.

All 70 supplied spells contain ordered Universal Item Effect recipes. Spell
sheets retain only casting metadata and expose conditional effect rows for
damage, recovery, resources, modifiers, armour, automatic successes, Critical
Injuries, hazards, statuses, and guided workflows. The generic resolver handles
targeting, power scaling, Magical Seals, resistance and opposed tests, timed
effects, recurring Blood Curse/Chill/Suffocation harm, Firewalker immunity,
Stoneskin armour, Cat's Paw roll replacement, Power Runes, disease/poison cures,
item damage, resurrection, and resource transfer. Effects whose outcome is a
fictional choice use a guided prompt and record the ruling rather than encoding
setting-specific assumptions. Active effects and expiry appear on the Actor's
Magic tab. Existing legacy damage/recovery/modifier fields are read as a
compatibility fallback and are migrated to effect recipes without overwriting
custom spell effects.

With Vehicles, Mounts & Chases enabled, Character/NPC, Vehicle, and Mount sheets
expose chase manoeuvres and the GM's matching obstacle tables. A GM can start a
multi-participant tracker in individual-position or grouped-side mode. Every
participant whispers a secret manoeuvre commitment to the GM; all commitments
and the automatically drawn obstacle are revealed together, then resolved from
the leading prey to the last pursuer. The tracker handles relative ranges,
blocked routes, cancelled commitments, prerequisites, obstacle modifiers and
damage, opposed hiding and cutting off, pursuit, flight, overtaking, immediate
close-combat or ramming attacks, Stand and Shoot, and escape. Successful hiding
can feed directly into the Sneak Attack workflow. Vehicle Actors can
assign a Driver and multiple passenger Actors. Vehicle criticals now
apply their listed driving tests, passenger or Driver damage, crashes, fire,
explosions, and component states to those documents. Repairs use the Driver's
Crafting roll and allow one pushed attempt per damaged part per Shift.

Mounts are a dedicated Actor type with Strength, Agility, Health, armour, rider,
carrying capacity, lameness, and carried Items. Their resizable sheet accepts
Gear, Weapons, Armour, and Consumables. Mounted Mobility uses the animal's
Agility, pushed Attribute banes damage the Mount, Cramped and Cluttered zone
limits are enforced, and combat applies the one-handed melee restriction,
ranged-attack penalty, mounted-rider defence penalty, and rider-or-Mount target
choice. Mounted travel allows two normal riding Shifts per day, requires a
Mobility roll for additional Shifts, tracks daily rest, and makes a Mount lame
when that extra-Shift roll fails.

Vehicles can also be marked as aerial or as watercraft. Aerial manoeuvres commit to horizontal,
ascending, or descending movement before the driving roll; final pushed results
either prepare a multi-zone canvas move or change altitude, never both. An
engine-disabled aerial Vehicle can make one controlled one-zone descent per
combat round. Wrecking an aerial Vehicle starts a D3-plus-altitude crash (D6
for Massive Crash), resets altitude, and creates a Mobility bracing card for
every Driver and occupant before Vehicle armour and final falling damage are
applied. Legacy world-seeded Helicopters are migrated to the aerial type automatically.

Ricochet, result 1 on the Critical Vehicle Damage table, now gathers other
Actors in the Vehicle's configured canvas zone (including recorded occupants),
randomly selects one, and produces a permission-safe chat action which applies
the same triggering damage. If the Vehicle is not in a configured canvas zone
and has no recorded occupants, the card explicitly asks the GM to select the
valid same-zone target manually.

With Travel enabled, all sheets display shared Day, Shift, weather, and journey
distance. Advancing a Shift also advances Foundry world time, keeping timed
hazards, injuries, and magic in sync. Character task ledgers enforce one task
per Shift except Keep Watch while marching. Party-wide task claims allow only
one leader for navigation, keeping watch, foraging, hunting, fishing, or making
camp in the same Shift (and location where applicable), while other characters
can help the leader. Claims include pending roll cards so simultaneous players
cannot reserve the same task. Travel activities apply terrain and
repeated-location foraging penalties, track third/fourth-shift forced marches, update supplies,
and automate resting and sleeping recovery. Final roll cards record marching
progress, navigation errors, hunting and camp table draws, and gathered fuel.
Camp setup records shelter, fire, and the selected night guard; camp mishaps
apply their deterministic weather, cold, fire, sleep, Stress, lice, food, and
Gear consequences. Daily rollover tracks whether each traveller slept and ate.
Foraged plants, caught fish, and trapped prey create typed raw-food Consumables.
Cooking converts up to twelve rations per Shift into safe food on a successful
Survival roll or badly cooked food on a failure. Eating raw or badly cooked
plants triggers a virulence 3/D sickness roll; meat and fish use virulence 6/C.
Food Items expose an Eat action on the Actor sheet, work with exact quantities
or Supply ratings, clear starvation, and also recognize magically poisoned
rations. Successful hunting now creates a tracked-prey card. Rabbit and fox
results can launch a second, pushable Survival roll using a selected Gear Item
as a snare; successful traps automatically roll and add the prey's raw-meat yield.
Vehicle travel calculates road/off-road terrain speed, night travel,
heavy-weather and terrain modifiers, doubled off-road fuel use, progress, and
driving mishaps. Mishaps automatically set repair conditions and apply dirty
fuel, roadkill, crashes, or a blown engine where applicable. Because journey
distance is shared world state, a GM applies March and Drive result cards after
players finish pushing them.

Travel can also use an active Foundry square- or hex-grid Scene as the journey map. From the
Token controls or a Character's Travel tab, a GM configures the party-marker
Token, default terrain, and kilometres per grid space. Draw Foundry Regions over the
map to assign woods, hills, mountains, water, swamp, ruins, open ground, or
roads; smaller overlapping Regions take priority. To plan a journey, target
exactly one destination Token and choose **Plan Grid Route**. The current grid space,
next terrain, destination, and remaining route appear on Character, Vehicle,
and Mount sheets. Off-road movement pauses before every new grid space until a
successful Navigation roll approves entry; failure diverts the route one
adjacent space to the rolled left or right. Terrain-adjusted fractional vehicle
movement is retained across rolls and Shifts, and entering a new off-road
terrain type pauses the Vehicle until its Driver makes the additional required
roll. Encounter cards offer approach, ambush, or backing off; backing off adds
the terrain-adjusted detour cost to the route. Group movement is still applied
only once unless one of these resumable route stages is pending. Without a
configured grid route, all abstract travel-distance workflows remain available.

The **YZE SRD Roll Tables** Compendium contains ten RollTables: sample panic,
physical and mental critical injuries, critical vehicle damage, foot and
vehicle chase obstacles, magic mishaps, driving mishaps, sample hunting, and
camp mishaps. The panic table cannot infer an Actor's stress from a directory
draw, so its description explains how to add the current stress to the D6
result.

The physical and mental Critical Injury tables use document-backed results.
Their chat results are draggable Items: drop a result into the Critical
Injuries section of a Character or NPC. Active injuries automatically add
their configured Attribute or Skill penalties to roll dialogs. The two SRD
injuries which cause damage on a Mobility or Melee roll apply that harm through
the world's damage model. Structured restrictions on Critical Injury Items
enforce action lockout, blocked Attribute rolls, unusable hands and Weapon grip,
immobility, slow-action Retreats, and the Nightmares/Nocturnal Travel sleep
rules. Fiction-dependent effects such as phobias remain visible for GM
adjudication.

Broken state is derived from the selected damage model. Reaching zero Health,
Resolve, or a relevant Attribute announces the matching physical or mental
state and rolls the linked table. With Conditions, acquiring a fourth physical
or mental Condition records the matching Broken state. The SRD exception for
becoming Broken through a pushed roll is respected: the Actor is marked Broken
but no Critical Injury is rolled. Broken Actors cannot make normal sheet rolls.
Lethal injuries expose stabilization and death-save controls; instant-death
results mark the Actor deceased.

The **YZE Game World Setup Guide** Journal Compendium explains each choice made
by the startup wizard. It is native Foundry content and contains no embedded
SRD PDF. The system no longer creates reference or example documents directly
in a world. Existing world documents from older toolkit versions are preserved
because a GM may have edited them; only the obsolete system-created SRD
reference Journal is removed by migration.

## Development status

This is a foundation, not yet a complete implementation. Basic dice-pool and
stepped-dice rolls, modifiers, opposed rolls, Gear degradation, XP and
advancement, automated and contextual Speciality effects, the push workflow,
armour, damage application, recovery, Broken state, Critical Injuries, Panic,
the shared Doom pool, Willpower, Magic, Vehicles & Chases, and Travel are
playable. Some open-ended obstacle and critical-vehicle results still require
GM adjudication, and broader game-configuration tooling remains future work. See
[`docs/architecture.md`](docs/architecture.md).

## Licence notice

This game is not affiliated with, sponsored, or endorsed by Fria Ligan AB. The
Year Zero Engine System Reference Document is used under Fria Ligan AB's Free
Tabletop License.

Source SRD and licence PDFs, screenshots, and other raster assets are
intentionally excluded from the repository and release archive. The setup
guide and system Compendiums use native Foundry documents and core icons.
