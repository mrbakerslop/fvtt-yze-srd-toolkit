import { SRD_CRITICAL_INJURIES } from "./critical-injuries.mjs";
import { PANIC_RESULTS } from "../panic-data.mjs";

function result(range, title, effect, { criticalInjuryKey = null } = {}) {
  const bounds = Array.isArray(range) ? range : [range, range];
  return {
    range: bounds,
    name: title,
    description: effect,
    criticalInjuryKey
  };
}

function table(name, formula, description, results, { criticalInjuryCategory = null } = {}) {
  return { name, formula, description, results, criticalInjuryCategory };
}

const criticalInjuryResults = (category) => SRD_CRITICAL_INJURIES
  .filter((injury) => injury.category === category)
  .map((injury) => result(injury.range, injury.name, injury.effect, {
    criticalInjuryKey: injury.key
  }));

export const SRD_ROLL_TABLES = [
  table(
    "YZE Sample Panic",
    "1d6",
    "Roll D6 and add the character's current stress. Foundry cannot infer an Actor's stress in a directory RollTable, so add it to the displayed D6 result or temporarily change the formula to 1d6 + X.",
    PANIC_RESULTS.map((entry) => result(
      entry.min === entry.max ? entry.min : [entry.min, entry.max],
      entry.title,
      entry.effect
    ))
  ),
  table("YZE Physical Critical Injuries", "1d6 * 10 + 1d6", "Roll D66 for a physical critical injury. Drag the resulting Item from chat onto a Character or NPC sheet.", criticalInjuryResults("physical"), { criticalInjuryCategory: "physical" }),
  table("YZE Mental Critical Injuries", "1d6 * 10 + 1d6", "Roll D66 for a mental critical injury. Drag the resulting Item from chat onto a Character or NPC sheet.", criticalInjuryResults("mental"), { criticalInjuryCategory: "mental" }),
  table(
    "YZE Critical Vehicle Damage",
    "1d12",
    "Roll D12 for critical vehicle component damage. The SRD also provides equivalent D66 ranges and D6 results for the first six entries.",
    [
      result(1, "Ricochet", "The attack strikes another random target in the same zone for the same damage."),
      result(2, "Skid", "The driver immediately rolls their driving skill; failure costs their next turn."),
      result(3, "Windshield Shattered", "Reduce Maneuverability by one step."),
      result(4, "Driver Hit", "The driver suffers damage equal to that inflicted on the vehicle."),
      result(5, "Passenger Hit", "A random passenger takes the vehicle's damage and a critical injury; re-roll if there are no passengers."),
      result(6, "Wheel Blown", "A wheel or thruster is destroyed, giving −2 to driving rolls."),
      result(7, "Severe Spin", "The driver immediately rolls; failure wrecks the vehicle and passengers suffer falling damage."),
      result(8, "Fuel Fire", "The vehicle and everyone inside are exposed to intensity 6/C fire."),
      result(9, "Weapon Disabled", "A random mounted weapon is disabled; re-roll if none are present."),
      result(10, "Massive Crash", "The vehicle is wrecked and each passenger suffers D6 falling damage plus altitude, reduced by armor."),
      result(11, "Engine Disabled", "The vehicle cannot continue; an aerial vehicle can descend one altitude zone per round."),
      result(12, "Explosion", "The vehicle is destroyed beyond repair and everyone inside is exposed to blast power 9/B.")
    ]
  ),
  table(
    "YZE Foot Chase Obstacles",
    "1d10",
    "Roll once per chase round to generate a foot-chase obstacle.",
    [
      result(1, "Dead End", "Pursue/Flee, Hide, or Block chosen by the prey fails automatically."),
      result(2, "Food Stall", "The prey must Force through it before Flee, Hide, or Block; failure cancels the maneuver and causes D3 damage."),
      result(3, "Vehicle or Cart", "Pursue/Flee and Stand and Shoot gain +2; Cut Off suffers −2."),
      result(4, "Crowd", "Hide gains +2. Otherwise the pursuer must pass Observation or lose the maneuver; failed shooting hits a bystander."),
      result(5, "Monks", "The prey must Persuade them to move. Success gives Hide +2; failure cancels the maneuver."),
      result(6, "Guards or Police", "Pursue/Flee, Hide, and Stand and Shoot suffer −2; shooting draws an attack from the guards."),
      result(7, "Old Man", "The pursuer must pay or pass Force; failure cancels their maneuver."),
      result(8, "Garbage", "Pursue/Flee suffers −2 while Block gains +2."),
      result(9, "Open Space", "Stand and Shoot gains +2 while Hide suffers −2."),
      result(10, "Thugs", "The prey must pass Persuasion. Failure cancels the maneuver and prompts an attack; success turns the thugs on the pursuer.")
    ]
  ),
  table(
    "YZE Vehicle Chase Obstacles",
    "1d10",
    "Roll once per chase round to generate a vehicle-chase obstacle.",
    [
      result(1, "Dead End", "Pursue/Flee, Hide, or Block chosen by the prey fails automatically."),
      result(2, "Downpour", "Pursue/Flee is disadvantaged and Hide is advantaged."),
      result(3, "Vehicle or Cart", "Block is advantaged; Pursue/Flee is disadvantaged and failure causes D3 vehicle damage."),
      result(4, "Red Lights", "Cut Off is advantaged; Pursue/Flee and Stand and Shoot are disadvantaged, with failure causing collateral damage."),
      result(5, "Patrol Car", "Pursue/Flee, Hide, and Stand and Shoot are disadvantaged; shooters are fired upon by police."),
      result(6, "Freeway", "Pursue/Flee and Stand and Shoot are advantaged; Hide and Block are disadvantaged."),
      result(7, "Roadworks", "Hide, Block, and Cut Off are advantaged; Pursue/Flee and shooting are disadvantaged, and failed pursuit causes D3 vehicle damage."),
      result(8, "Cyclists", "Block is advantaged; Pursue/Flee and shooting are disadvantaged, with failures causing collateral damage."),
      result(9, "Truck", "Cut Off is advantaged; Pursue/Flee is disadvantaged and failure causes D6 vehicle damage."),
      result(10, "Alleyway", "Pass a separate driving roll or wreck. A driver can cancel their maneuver to proceed safely.")
    ]
  ),
  table(
    "YZE Magic Mishaps",
    "1d12",
    "Roll D12 when uncontrolled magic causes a mishap.",
    [
      result(1, "Sleepless", "You cannot sleep for D6 days."),
      result(2, "Drained", "Suffer one stress."),
      result(3, "Hurt", "Suffer one damage."),
      result(4, "Magical Disease", "A virulence 2D6 disease exposes you and everyone Engaged with you during the next shift."),
      result(5, "Unintended Target", "The spell also affects an unintended victim; helpful magic may aid an enemy."),
      result(6, "Altered Appearance", "Your appearance changes permanently as the GM decides."),
      result(7, "Blinded", "Act as if in complete darkness for one full day."),
      result(8, "Ravaged Mind", "Immediately roll a mental critical injury."),
      result(9, "Broken Bones", "Immediately roll a physical critical injury."),
      result(10, "Demon Drawn", "A demon arrives within the next shift and causes trouble."),
      result(11, "Backfire", "The spell reverses, harms, corrupts, or turns against the caster as the GM decides."),
      result(12, "Rift", "A demon drags you into another dimension. The character returns as a changed NPC after D66 days.")
    ]
  ),
  table(
    "YZE Driving Mishaps",
    "2d6",
    "Roll 2D6 after a failed driving roll during travel.",
    [
      result(2, "Broken Axle", "The vehicle is inoperable until a shift of repairs and a successful Crafting roll."),
      result(3, "Roadkill", "Hit a random hunting-table animal. It dies and damages the vehicle by half its hit capacity, rounded up."),
      result(4, "Busted Gearbox", "The vehicle stops; repair requires a Crafting roll and a shift."),
      result(5, "Dirty Fuel", "Drain all fuel and refuel before continuing."),
      result(6, "Bogged Down", "Movement ends for the shift; one Force or assisted-vehicle attempt can free it per shift."),
      result(7, "Wrong Turn", "Lose one hex of movement this shift."),
      result(8, "Roadblock", "Choose another hex or spend a shift and pass Force to clear the obstruction."),
      result(9, "Engine Overheated", "Stop for the remainder of the shift."),
      result(10, "Blown Tire", "The vehicle stops; repair needs Crafting +2, with one attempt per shift."),
      result(11, "Crash", "The vehicle suffers damage equal to its travel speed rating."),
      result(12, "Engine Blown", "The vehicle is wrecked.")
    ]
  ),
  table(
    "YZE Sample Hunting",
    "1d6",
    "Roll D6 after successfully tracking prey.",
    [
      result(1, "Grouse", "Health 1; cannot be trapped; yields 1 food ration."),
      result(2, "Rabbit", "Health 1; can be trapped; yields 1 food ration."),
      result(3, "Fox", "Health 1; can be trapped; yields D3 food rations."),
      result(4, "Deer", "Health 2; cannot be trapped; yields 2D6 food rations."),
      result(5, "Boar", "Health 3; cannot be trapped; yields 2D6×2 food rations."),
      result(6, "Moose", "Health 5; cannot be trapped; yields 2D6×4 food rations.")
    ]
  ),
  table(
    "YZE Camp Mishaps",
    "1d10",
    "Roll secretly after a failed attempt to make camp; re-roll inapplicable results.",
    [
      result(1, "Food Spoiled", "Half of the group's carried rations spoil."),
      result(2, "Flooding", "The camp floods. Everyone rolls Stamina against cold and nobody sleeps."),
      result(3, "Fire Dies", "The campfire goes out; unless it is warm, everyone rolls Stamina against cold."),
      result(4, "Fire!", "A tent is destroyed. Everyone faces intensity D fire and rolls Mobility to save their gear."),
      result(5, "Ants", "Everyone suffers one stress or Empathy damage and nobody sleeps."),
      result(6, "Lice", "One character suffers daily stress or Empathy damage and cannot sleep until a Healing roll succeeds."),
      result(7, "Mosquito Swarm", "Roll two D6 per character; each success causes one stress or Empathy damage."),
      result(8, "Savage Animal", "A starving wolf, dog, boar, or bear attacks."),
      result(9, "Lost Gear", "A random character loses a piece of gear selected by the GM."),
      result(10, "Broken Gear", "A random character's item breaks and requires a Crafting roll to repair.")
    ]
  )
];
