import assert from "node:assert/strict";
import test from "node:test";

function getProperty(object, path) {
  return String(path).split(".").reduce((value, key) => value?.[key], object);
}

function setProperty(object, path, value) {
  const keys = String(path).split(".");
  const final = keys.pop();
  let target = object;
  for (const key of keys) target = target[key] ??= {};
  target[final] = value;
  return true;
}

const dialogResults = [];
const settings = new Map([
  ["harmModel", "damageStress"],
  ["diceSystem", "pool"]
]);
const chat = [];
const notices = [];

globalThis.Combat = class {};
globalThis.Combatant = class {};
globalThis.foundry = {
  applications: {
    api: {
      ApplicationV2: class {},
      HandlebarsApplicationMixin: (Base) => Base,
      DialogV2: { wait: async () => dialogResults.shift() }
    }
  },
  utils: {
    deepClone: structuredClone,
    escapeHTML: (value) => String(value),
    getProperty,
    setProperty,
    mergeObject: (left, right) => ({ ...left, ...right })
  }
};
globalThis.game = {
  actors: [],
  combat: null,
  time: { worldTime: 0 },
  user: { id: "gm", isGM: true },
  users: [{ id: "gm", active: true, isGM: true, role: 4 }],
  settings: { get: (_system, key) => settings.get(key) },
  i18n: {
    localize: (key) => key,
    format: (key, data) => `${key}:${JSON.stringify(data)}`
  }
};
globalThis.ui = {
  notifications: {
    info: (message) => notices.push(message),
    warn: (message) => notices.push(message),
    error: (message) => notices.push(message)
  }
};
globalThis.ChatMessage = {
  create: async (data) => chat.push(data),
  getSpeaker: ({ actor }) => ({ actor: actor?.id })
};
globalThis.Hooks = { on: () => {}, once: () => {} };
globalThis.Roll = class {
  constructor() { this.total = 3; }
  async evaluate() { return this; }
};

const { HARM_MODELS } = await import("../module/constants.mjs");
const {
  applyDamage,
  applyRecovery,
  recoverShift
} = await import("../module/harm.mjs");
const {
  advanceLethalTreatment,
  INJURY_TIME_SECONDS,
  processTimedInjuries,
  synchronizeInjuryTiming
} = await import("../module/injury-timing.mjs");
const { countPushedConditions } = await import("../module/dice/push.mjs");
const { renderHealingControl } = await import("../module/recovery-card.mjs");

function applyUpdates(document, updates) {
  for (const [path, value] of Object.entries(updates)) setProperty(document, path, value);
}

function actor(overrides = {}) {
  const value = {
    id: "actor",
    uuid: "Actor.actor",
    name: "Patient",
    type: "character",
    documentName: "Actor",
    isOwner: true,
    system: {
      dead: false,
      broken: { physical: false, mental: false },
      combat: { overwatch: { active: false }, aim: { active: false } },
      resources: {
        health: { value: 4, max: 4 },
        resolve: { value: 4, max: 4 }
      },
      attributes: {
        strength: { value: 4, maxValue: 4, stepRating: 4, maxStepRating: 4 },
        agility: { value: 4, maxValue: 4, stepRating: 4, maxStepRating: 4 },
        wits: { value: 4, maxValue: 4, stepRating: 4, maxStepRating: 4 },
        empathy: { value: 4, maxValue: 4, stepRating: 4, maxStepRating: 4 }
      },
      conditions: {
        exhausted: false, battered: false, wounded: false,
        angry: false, scared: false, disheartened: false
      }
    },
    flags: {},
    items: [],
    updates: [],
    getFlag(system, key) { return this.flags?.[system]?.[key]; },
    async update(updates) {
      this.updates.push(structuredClone(updates));
      applyUpdates(this, updates);
    },
    ...overrides
  };
  value.items.get = (id) => value.items.find((item) => item.id === id);
  return value;
}

function injury(parent, overrides = {}) {
  const value = {
    id: `injury-${parent.items.length + 1}`,
    uuid: `Actor.${parent.id}.Item.injury-${parent.items.length + 1}`,
    name: "Injury",
    type: "criticalInjury",
    parent,
    flags: {},
    system: {
      active: true,
      lethal: false,
      stabilized: false,
      instantDeath: false,
      permanent: false,
      timeLimit: "",
      healingTime: "D6",
      effects: [],
      recovery: {
        initialized: true,
        totalDays: 1,
        remainingDays: 1,
        lastProcessedAt: 0,
        careCredits: 0,
        lastCareDay: -1,
        deathSaveDue: false,
        nextDeathSaveAt: 0,
        nextDeathSaveRound: 0,
        treatmentLocked: false
      },
      ...overrides
    },
    getFlag(system, key) { return this.flags?.[system]?.[key]; },
    async setFlag(system, key, flagValue) { setProperty(this, `flags.${system}.${key}`, flagValue); },
    async update(updates) { applyUpdates(this, updates); }
  };
  parent.items.push(value);
  return value;
}

test("damage and direct recovery use every harm model", async () => {
  for (const model of [HARM_MODELS.DAMAGE_STRESS, HARM_MODELS.HEALTH_ONLY]) {
    settings.set("harmModel", model);
    const patient = actor();
    await applyDamage(patient, 2, { category: "mental" });
    const resource = model === HARM_MODELS.DAMAGE_STRESS ? "resolve" : "health";
    assert.equal(patient.system.resources[resource].value, 2);
    await applyRecovery(patient, 1, { category: "mental" });
    assert.equal(patient.system.resources[resource].value, 3);
  }

  settings.set("harmModel", HARM_MODELS.ATTRIBUTE_DAMAGE);
  for (const diceSystem of ["pool", "step"]) {
    settings.set("diceSystem", diceSystem);
    const patient = actor();
    const field = diceSystem === "step" ? "stepRating" : "value";
    await applyDamage(patient, 2, { category: "physical", attributeKey: "agility" });
    assert.equal(patient.system.attributes.agility[field], 2);
    await applyRecovery(patient, 1, { category: "physical", attributeKey: "agility" });
    assert.equal(patient.system.attributes.agility[field], 3);
  }

  settings.set("harmModel", HARM_MODELS.CONDITIONS);
  const patient = actor();
  dialogResults.push(["exhausted", "battered"]);
  await applyDamage(patient, 2, { category: "physical" });
  assert.equal(patient.system.conditions.exhausted, true);
  assert.equal(patient.system.conditions.battered, true);
  dialogResults.push(["exhausted"]);
  await applyRecovery(patient, 1, { category: "physical" });
  assert.equal(patient.system.conditions.exhausted, false);
});

test("Conditions Shift recovery is a no-op when healthy and atomic when cancelled", async () => {
  settings.set("harmModel", HARM_MODELS.CONDITIONS);
  const healthy = actor();
  assert.equal(await recoverShift(healthy), false);
  assert.equal(healthy.updates.length, 0);

  const patient = actor();
  patient.system.conditions.exhausted = true;
  patient.system.conditions.angry = true;
  dialogResults.push(["exhausted"], null);
  assert.equal(await recoverShift(patient), false);
  assert.equal(patient.system.conditions.exhausted, true);
  assert.equal(patient.system.conditions.angry, true);
  assert.equal(patient.updates.length, 0);
});

test("push Conditions combine the selected push cost with one condition per attribute bane", () => {
  assert.equal(countPushedConditions({ conditions: true }, { attribute: 0 }), 1);
  assert.equal(countPushedConditions({ conditionBaneDamage: true }, { attribute: 0 }), 0);
  assert.equal(countPushedConditions({ conditionBaneDamage: true }, { attribute: 2 }), 2);
  assert.equal(countPushedConditions({ conditions: true, conditionBaneDamage: true }, { attribute: 2 }), 3);
});

test("timed injuries heal, but lethal injuries remain active until stabilized", async () => {
  const patient = actor();
  const ordinary = injury(patient);
  const lethal = injury(patient, {
    lethal: true,
    timeLimit: "Shift",
    recovery: {
      initialized: true, totalDays: 1, remainingDays: 1, lastProcessedAt: 0,
      careCredits: 0, lastCareDay: -1, deathSaveDue: false,
      nextDeathSaveAt: INJURY_TIME_SECONDS.shift, nextDeathSaveRound: 0,
      treatmentLocked: false
    }
  });
  game.actors = [patient];
  game.time.worldTime = INJURY_TIME_SECONDS.day;
  const result = await processTimedInjuries(game.time.worldTime);
  assert.equal(ordinary.system.active, false);
  assert.equal(lethal.system.active, true);
  assert.equal(lethal.system.recovery.remainingDays, 0);
  assert.equal(lethal.system.recovery.deathSaveDue, true);
  assert.equal(result.healed, 1);
  assert.equal(result.due, 1);
});

test("Cracked Spine becomes permanent only when its healing deadline passes untreated", async () => {
  const patient = actor();
  const spine = injury(patient, { specialRule: "crackedSpine" });
  game.actors = [patient];
  game.time.worldTime = INJURY_TIME_SECONDS.day;
  await processTimedInjuries(game.time.worldTime);
  assert.equal(spine.system.active, true);
  assert.equal(spine.system.permanent, true);
  assert.equal(spine.system.healingTime, "");
  assert.equal(spine.getFlag("fvtt-yze-srd", "spineTreatmentResolved"), true);
});

test("a failed urgent Cracked Spine roll can still be recorded as treatment", () => {
  const html = renderHealingControl({
    mode: "pool",
    dice: [],
    recovery: { kind: "spine", targetName: "Patient", injuryName: "Cracked Spine" }
  });
  assert.match(html, /data-action="applyHealing"/);
});

test("lethal treatment advances Round to Stretch to Shift, then stabilizes", async () => {
  const patient = actor();
  const lethal = injury(patient, {
    lethal: true,
    timeLimit: "Round",
    recovery: {
      initialized: true, totalDays: 1, remainingDays: 0, lastProcessedAt: 0,
      careCredits: 0, lastCareDay: -1, deathSaveDue: true,
      nextDeathSaveAt: 0, nextDeathSaveRound: 0, treatmentLocked: false
    }
  });
  assert.equal((await advanceLethalTreatment(lethal)).timeLimit, "Stretch");
  assert.equal((await advanceLethalTreatment(lethal)).timeLimit, "Shift");
  const completed = await advanceLethalTreatment(lethal);
  assert.equal(completed.stabilized, true);
  assert.equal(completed.completedHealing, true);
  assert.equal(lethal.system.stabilized, true);
  assert.equal(lethal.system.active, false);
});

test("edited Critical Injury fields rebuild stale healing and death-save timers", async () => {
  const patient = actor();
  const lethal = injury(patient, {
    lethal: true,
    timeLimit: "Stretch",
    recovery: {
      initialized: true, totalDays: 1, remainingDays: 1, lastProcessedAt: 0,
      careCredits: 0, lastCareDay: -1, deathSaveDue: true,
      nextDeathSaveAt: 1, nextDeathSaveRound: 0, treatmentLocked: true
    }
  });
  game.time.worldTime = 100;
  await synchronizeInjuryTiming(lethal, { "system.timeLimit": "Stretch" });
  assert.equal(lethal.system.recovery.deathSaveDue, false);
  assert.equal(lethal.system.recovery.treatmentLocked, false);
  assert.equal(lethal.system.recovery.nextDeathSaveAt, 100 + INJURY_TIME_SECONDS.stretch);

  lethal.system.healingTime = "D6";
  await synchronizeInjuryTiming(lethal, { system: { healingTime: "D6" } });
  assert.equal(lethal.system.recovery.totalDays, 3);
  assert.equal(lethal.system.recovery.remainingDays, 3);
});
