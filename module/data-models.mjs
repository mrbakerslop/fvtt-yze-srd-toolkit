const {
  ArrayField,
  BooleanField,
  HTMLField,
  NumberField,
  SchemaField,
  StringField
} = foundry.data.fields;

function ratingField(initial = 3) {
  return new SchemaField({
    value: new NumberField({
      required: true,
      nullable: false,
      integer: true,
      min: 0,
      max: 5,
      initial
    }),
    maxValue: new NumberField({
      required: true,
      nullable: false,
      integer: true,
      min: 0,
      max: 5,
      initial
    }),
    stepRating: new NumberField({
      required: true,
      nullable: false,
      integer: true,
      min: 0,
      max: 4,
      initial: 2
    }),
    maxStepRating: new NumberField({
      required: true,
      nullable: false,
      integer: true,
      min: 0,
      max: 4,
      initial: 2
    })
  });
}

function resourceField({ value = 0, max = 0 } = {}) {
  return new SchemaField({
    value: new NumberField({
      required: true,
      nullable: false,
      integer: true,
      min: 0,
      initial: value
    }),
    max: new NumberField({
      required: true,
      nullable: false,
      integer: true,
      min: 0,
      initial: max
    })
  });
}

function textField() {
  return new StringField({
    required: true,
    nullable: false,
    blank: true,
    initial: ""
  });
}

class PersonDataModel extends foundry.abstract.TypeDataModel {
  static defineSchema() {
    return {
      attributes: new SchemaField({
        strength: ratingField(),
        agility: ratingField(),
        wits: ratingField(),
        empathy: ratingField()
      }),
      resources: new SchemaField({
        health: resourceField({ value: 4, max: 4 }),
        resolve: resourceField({ value: 4, max: 4 }),
        willpower: resourceField({ value: 0, max: 99 }),
        stress: resourceField({ value: 0, max: 99 })
      }),
      conditions: new SchemaField({
        exhausted: new BooleanField({ required: true, initial: false }),
        battered: new BooleanField({ required: true, initial: false }),
        wounded: new BooleanField({ required: true, initial: false }),
        angry: new BooleanField({ required: true, initial: false }),
        scared: new BooleanField({ required: true, initial: false }),
        disheartened: new BooleanField({ required: true, initial: false })
      }),
      broken: new SchemaField({
        physical: new BooleanField({ required: true, initial: false }),
        mental: new BooleanField({ required: true, initial: false })
      }),
      combat: new SchemaField({
        prone: new BooleanField({ required: true, initial: false }),
        grappled: new BooleanField({ required: true, initial: false }),
        grapplerUuid: textField(),
        grapplingTargetUuid: textField(),
        cover: new SchemaField({
          active: new BooleanField({ required: true, initial: false }),
          label: textField(),
          rating: new NumberField({ required: true, nullable: false, integer: true, min: 0, initial: 0 }),
          maxRating: new NumberField({ required: true, nullable: false, integer: true, min: 0, initial: 0 }),
          stepRating: new NumberField({ required: true, nullable: false, integer: true, min: 0, max: 4, initial: 0 }),
          maxStepRating: new NumberField({ required: true, nullable: false, integer: true, min: 0, max: 4, initial: 0 })
        }),
        overwatch: new SchemaField({
          active: new BooleanField({ required: true, initial: false }),
          direction: textField(),
          weaponItemId: textField()
        }),
        aim: new SchemaField({
          active: new BooleanField({ required: true, initial: false }),
          weaponItemId: textField(),
          preparedRound: new NumberField({ required: true, nullable: false, integer: true, min: 0, initial: 0 })
        })
      }),
      panic: new SchemaField({
        active: new BooleanField({ required: true, initial: false }),
        total: new NumberField({ required: true, nullable: false, integer: true, min: 0, initial: 0 }),
        key: textField(),
        title: textField(),
        effect: textField(),
        effects: new ArrayField(new SchemaField({
          total: new NumberField({ required: true, nullable: false, integer: true, min: 0, initial: 0 }),
          key: textField(),
          title: textField(),
          effect: textField()
        }), { required: true, nullable: false, initial: [] })
      }),
      dead: new BooleanField({ required: true, initial: false }),
      details: new SchemaField({
        field1: textField(),
        field2: textField(),
        field3: textField(),
        field4: textField(),
        field5: textField(),
        field6: textField()
      }),
      creation: new SchemaField({
        completed: new BooleanField({ required: true, initial: false }),
        archetypeUuid: textField()
      }),
      personality: new SchemaField({
        pride: new SchemaField({
          value: textField(),
          used: new BooleanField({ required: true, initial: false })
        }),
        weakness: textField(),
        darkSecret: textField(),
        bigDream: textField(),
        buddyUuid: textField(),
        relationships: new ArrayField(new SchemaField({
          id: textField(),
          actorUuid: textField(),
          description: textField()
        }), { required: true, nullable: false, initial: [] })
      }),
      criticalInjuries: textField(),
      biography: new HTMLField({ required: true, nullable: false, blank: true }),
      experience: new NumberField({
        required: true,
        nullable: false,
        integer: true,
        min: 0,
        initial: 0
      }),
      experienceLedger: new ArrayField(new SchemaField({
        id: textField(),
        type: textField(),
        amount: new NumberField({ required: true, nullable: false, integer: true, initial: 0 }),
        balance: new NumberField({
          required: true,
          nullable: false,
          integer: true,
          min: 0,
          initial: 0
        }),
        description: textField(),
        timestamp: new NumberField({ required: true, nullable: false, min: 0, initial: 0 }),
        worldTime: new NumberField({ required: true, nullable: false, min: 0, initial: 0 }),
        userId: textField(),
        userName: textField()
      }), { required: true, nullable: false, initial: [] })
    };
  }
}

export class CharacterDataModel extends PersonDataModel {
  static defineSchema() {
    return {
      ...super.defineSchema(),
      currency: new NumberField({
        required: true,
        nullable: false,
        min: 0,
        initial: 0
      })
    };
  }
}

export class NPCDataModel extends PersonDataModel {}

export class MountDataModel extends foundry.abstract.TypeDataModel {
  static defineSchema() {
    return {
      attributes: new SchemaField({
        strength: ratingField(4),
        agility: ratingField(4)
      }),
      resources: new SchemaField({
        health: resourceField({ value: 4, max: 4 })
      }),
      armor: new NumberField({ required: true, nullable: false, integer: true, min: 0, initial: 0 }),
      armorStepRating: new NumberField({ required: true, nullable: false, integer: true, min: 0, max: 4, initial: 0 }),
      riderUuid: textField(),
      passengerUuids: new ArrayField(
        new StringField({ required: true, nullable: false, blank: false }),
        { required: true, nullable: false, initial: [] }
      ),
      mobilitySkillName: new StringField({
        required: true, nullable: false, blank: false, initial: "Mobility"
      }),
      carryCapacity: new NumberField({ required: true, nullable: false, min: 0, initial: 8 }),
      travelSpeed: new NumberField({ required: true, nullable: false, min: 0, initial: 2 }),
      lame: new BooleanField({ required: true, initial: false }),
      perished: new BooleanField({ required: true, initial: false }),
      description: new HTMLField({ required: true, nullable: false, blank: true })
    };
  }
}

export class VehicleDataModel extends foundry.abstract.TypeDataModel {
  static defineSchema() {
    return {
      passengers: new NumberField({
        required: true,
        nullable: false,
        integer: true,
        min: 0,
        initial: 0
      }),
      maneuverability: new NumberField({
        required: true,
        nullable: false,
        integer: true,
        initial: 0
      }),
      hull: resourceField({ value: 0, max: 0 }),
      armor: new NumberField({
        required: true,
        nullable: false,
        integer: true,
        min: 0,
        initial: 0
      }),
      armorMax: new NumberField({
        required: true,
        nullable: false,
        integer: true,
        min: 0,
        initial: 0
      }),
      armorStepRating: new NumberField({
        required: true,
        nullable: false,
        integer: true,
        min: 0,
        max: 4,
        initial: 0
      }),
      armorStepMax: new NumberField({
        required: true,
        nullable: false,
        integer: true,
        min: 0,
        max: 4,
        initial: 0
      }),
      travelSpeedRoad: new NumberField({
        required: true,
        nullable: false,
        min: 0,
        initial: 0
      }),
      travelSpeedOffRoad: new NumberField({
        required: true,
        nullable: false,
        min: 0,
        initial: 0
      }),
      fuel: resourceField({ value: 0, max: 0 }),
      fuelPerHex: new NumberField({ required: true, nullable: false, min: 0, initial: 0 }),
      driverUuid: textField(),
      occupantUuids: new ArrayField(
        new StringField({ required: true, nullable: false, blank: false }),
        { required: true, nullable: false, initial: [] }
      ),
      drivingSkillName: new StringField({
        required: true, nullable: false, blank: false, initial: "Mobility"
      }),
      drivingPenalty: new NumberField({
        required: true, nullable: false, integer: true, initial: 0
      }),
      altitude: new NumberField({
        required: true, nullable: false, integer: true, min: 0, initial: 0
      }),
      isAerial: new BooleanField({ required: true, initial: false }),
      isWatercraft: new BooleanField({ required: true, initial: false }),
      quickAccess: new BooleanField({ required: true, initial: false }),
      engineRunning: new BooleanField({ required: true, initial: true }),
      wrecked: new BooleanField({ required: true, initial: false }),
      engineDisabled: new BooleanField({ required: true, initial: false }),
      destroyed: new BooleanField({ required: true, initial: false }),
      travelCondition: textField(),
      description: new HTMLField({ required: true, nullable: false, blank: true })
    };
  }
}

class DescribedItemDataModel extends foundry.abstract.TypeDataModel {
  static defineSchema() {
    return {
      description: new HTMLField({ required: true, nullable: false, blank: true }),
      price: new NumberField({
        required: true,
        nullable: false,
        min: 0,
        initial: 0
      }),
      effects: new ArrayField(new SchemaField({
        id: textField(),
        active: new BooleanField({ required: true, initial: true }),
        type: new StringField({
          required: true,
          nullable: false,
          blank: false,
          choices: [
            "rollModifier", "automaticRollModifier", "extraPush", "alternateAttribute",
            "initiativeCards", "healingTime", "derivedStat",
            "carryCapacityMultiplier",
            "hitInterception", "coupDeGrace",
            "willpowerActivation", "doomExpenditure",
            "spellDamage", "spellRecovery", "spellModifier",
            "spellResource", "spellStatus", "spellArmor",
            "spellAutomaticSuccess", "spellItemDamage",
            "spellCriticalInjury", "spellHazard", "spellWorkflow"
          ],
          initial: "rollModifier"
        }),
        target: textField(),
        application: new StringField({
          required: true,
          nullable: false,
          blank: false,
          choices: ["passive", "spell"],
          initial: "passive"
        }),
        attribute: new StringField({
          required: true,
          nullable: false,
          blank: true,
          choices: ["", "strength", "agility", "wits", "empathy"],
          initial: ""
        }),
        label: textField(),
        description: textField(),
        targetMode: textField(),
        scaling: textField(),
        category: textField(),
        resource: textField(),
        mode: textField(),
        duration: textField(),
        handler: textField(),
        filter: textField(),
        status: textField(),
        affectedAttributes: textField(),
        affectedSkills: textField(),
        armorApplies: new BooleanField({ required: true, initial: false }),
        multiplier: new NumberField({
          required: true, nullable: false, integer: true, min: -99, max: 99, initial: 0
        }),
        value: new NumberField({
          required: true, nullable: false, integer: true, min: -99, max: 999, initial: 1
        })
      }), { required: true, nullable: false, initial: [] })
    };
  }
}

export class ArchetypeDataModel extends DescribedItemDataModel {
  static defineSchema() {
    const uuidList = () => new ArrayField(
      new StringField({ required: true, nullable: false, blank: false }),
      { required: true, nullable: false, initial: [] }
    );
    return {
      ...super.defineSchema(),
      keyAttribute: new StringField({
        required: true,
        nullable: false,
        blank: false,
        choices: ["strength", "agility", "wits", "empathy"],
        initial: "strength"
      }),
      keySkills: uuidList(),
      availableSpecialties: uuidList(),
      specialtyChoices: new NumberField({
        required: true, nullable: false, integer: true, min: 0, initial: 1
      }),
      grantedItems: uuidList(),
      availableEquipment: uuidList(),
      equipmentChoices: new NumberField({
        required: true, nullable: false, integer: true, min: 0, initial: 0
      })
    };
  }
}

export class SkillDataModel extends DescribedItemDataModel {
  static defineSchema() {
    return {
      ...super.defineSchema(),
      attribute: new StringField({
        required: true,
        nullable: false,
        blank: false,
        choices: ["strength", "agility", "wits", "empathy"],
        initial: "strength"
      }),
      rating: new NumberField({
        required: true,
        nullable: false,
        integer: true,
        min: 0,
        max: 5,
        initial: 0
      }),
      stepRating: new NumberField({
        required: true,
        nullable: false,
        integer: true,
        min: 0,
        max: 4,
        initial: 0
      }),
      usedSuccessfully: new BooleanField({ required: true, initial: false })
    };
  }
}

export class SpecialtyDataModel extends DescribedItemDataModel {
  static defineSchema() {
    return {
      ...super.defineSchema(),
      active: new BooleanField({ required: true, initial: true }),
      used: new BooleanField({ required: true, initial: false }),
      effect: new StringField({
        required: true,
        nullable: false,
        blank: true,
        initial: ""
      }),
      effectTarget: new StringField({
        required: true,
        nullable: false,
        blank: true,
        initial: ""
      }),
      magicDiscipline: new BooleanField({ required: true, initial: false }),
      rank: new NumberField({
        required: true, nullable: false, integer: true, min: 0, max: 5, initial: 0
      }),
      bonus: new NumberField({
        required: true,
        nullable: false,
        integer: true,
        initial: 0
      })
    };
  }
}

class CarryableItemDataModel extends DescribedItemDataModel {
  static defineSchema() {
    return {
      ...super.defineSchema(),
      quantity: new NumberField({
        required: true,
        nullable: false,
        integer: true,
        min: 0,
        initial: 1
      }),
      weight: new NumberField({
        required: true,
        nullable: false,
        min: 0,
        initial: 1
      }),
      equipped: new BooleanField({ required: true, initial: false })
    };
  }
}

export class GearDataModel extends CarryableItemDataModel {
  static defineSchema() {
    return {
      ...super.defineSchema(),
      reliability: resourceField({ value: 5, max: 5 }),
      isBackpack: new BooleanField({ required: true, initial: false }),
      bonus: new NumberField({
        required: true,
        nullable: false,
        integer: true,
        min: 0,
        initial: 0
      }),
      maxBonus: new NumberField({
        required: true, nullable: false, integer: true, min: 0, initial: 0
      }),
      artifactDie: new NumberField({
        required: true, nullable: false, integer: true, min: 0, max: 12, initial: 0
      })
    };
  }
}

export class WeaponDataModel extends CarryableItemDataModel {
  static defineSchema() {
    return {
      ...super.defineSchema(),
      reliability: resourceField({ value: 5, max: 5 }),
      grip: new StringField({ required: true, nullable: false, blank: true, initial: "" }),
      bonus: new NumberField({
        required: true,
        nullable: false,
        integer: true,
        min: 0,
        initial: 0
      }),
      maxBonus: new NumberField({
        required: true, nullable: false, integer: true, min: 0, initial: 0
      }),
      artifactDie: new NumberField({
        required: true, nullable: false, integer: true, min: 0, max: 12, initial: 0
      }),
      damage: new NumberField({
        required: true,
        nullable: false,
        integer: true,
        min: 0,
        initial: 1
      }),
      range: new StringField({
        required: true,
        nullable: false,
        blank: false,
        choices: ["engaged", "short", "medium", "long", "extreme"],
        initial: "engaged"
      }),
      critThreshold: new NumberField({
        required: true,
        nullable: false,
        integer: true,
        min: 0,
        initial: 0
      }),
      critFormula: new StringField({
        required: true,
        nullable: false,
        blank: false,
        initial: "1d6 * 10 + 1d6"
      }),
      ammunition: resourceField({ value: 0, max: 0 }),
      usesAmmunition: new BooleanField({ required: true, initial: false }),
      requiresPreparation: new BooleanField({ required: true, initial: false }),
      fullAuto: new BooleanField({ required: true, initial: false }),
      telescopicSight: new BooleanField({ required: true, initial: false }),
      reloadAction: new StringField({
        required: true,
        nullable: false,
        blank: false,
        choices: ["fast", "slow"],
        initial: "slow"
      }),
      rateOfFire: new NumberField({
        required: true,
        nullable: false,
        integer: true,
        min: 0,
        initial: 0
      })
    };
  }
}

export class ArmorDataModel extends CarryableItemDataModel {
  static defineSchema() {
    return {
      ...super.defineSchema(),
      rating: new NumberField({
        required: true,
        nullable: false,
        integer: true,
        min: 0,
        initial: 0
      }),
      maxRating: new NumberField({
        required: true,
        nullable: false,
        integer: true,
        min: 0,
        initial: 0
      }),
      stepRating: new NumberField({
        required: true,
        nullable: false,
        integer: true,
        min: 0,
        max: 4,
        initial: 0
      }),
      maxStepRating: new NumberField({
        required: true,
        nullable: false,
        integer: true,
        min: 0,
        max: 4,
        initial: 0
      })
    };
  }
}

export class ConsumableDataModel extends CarryableItemDataModel {
  static defineSchema() {
    return {
      ...super.defineSchema(),
      supply: new NumberField({
        required: true,
        nullable: false,
        integer: true,
        min: 0,
        initial: 0
      }),
      foodType: new StringField({
        required: true,
        nullable: false,
        blank: false,
        choices: ["none", "prepared", "plants", "meat", "fish"],
        initial: "none"
      }),
      foodState: new StringField({
        required: true,
        nullable: false,
        blank: false,
        choices: ["safe", "raw", "unsafe"],
        initial: "safe"
      })
    };
  }
}

export class SpellDataModel extends DescribedItemDataModel {
  static defineSchema() {
    return {
      ...super.defineSchema(),
      discipline: new StringField({
        required: true,
        nullable: false,
        blank: true,
        initial: ""
      }),
      rank: new NumberField({
        required: true,
        nullable: false,
        integer: true,
        min: 0,
        initial: 0
      }),
      range: new StringField({
        required: true,
        nullable: false,
        blank: true,
        initial: ""
      }),
      duration: new StringField({
        required: true,
        nullable: false,
        blank: true,
        initial: ""
      }),
      ritual: new BooleanField({ required: true, initial: false }),
      ritualRequirements: textField(),
      powerWord: new BooleanField({ required: true, initial: false }),
      cost: new NumberField({
        required: true,
        nullable: false,
        integer: true,
        min: 0,
        initial: 0
      }),
      automation: new StringField({
        required: true,
        nullable: false,
        blank: false,
        choices: ["none", "damage", "healing", "modifier"],
        initial: "none"
      }),
      targetMode: new StringField({
        required: true,
        nullable: false,
        blank: false,
        choices: ["self", "selected"],
        initial: "selected"
      }),
      effectCategory: new StringField({
        required: true,
        nullable: false,
        blank: false,
        choices: ["physical", "mental"],
        initial: "physical"
      }),
      effectBase: new NumberField({ required: true, nullable: false, integer: true, initial: 0 }),
      effectPerPower: new NumberField({ required: true, nullable: false, integer: true, initial: 1 }),
      effectModifier: new NumberField({ required: true, nullable: false, integer: true, initial: 0 }),
      armorApplies: new BooleanField({ required: true, initial: false }),
      affectedAttributes: textField(),
      affectedSkills: textField()
    };
  }
}

export class VehicleComponentDataModel extends DescribedItemDataModel {
  static defineSchema() {
    return {
      ...super.defineSchema(),
      componentType: new StringField({
        required: true,
        nullable: false,
        blank: false,
        choices: ["engine", "mobility", "weapon", "utility"],
        initial: "utility"
      }),
      active: new BooleanField({ required: true, initial: true }),
      damaged: new BooleanField({ required: true, initial: false }),
      targetingSystem: new BooleanField({ required: true, initial: false }),
      modifier: new NumberField({ required: true, nullable: false, integer: true, initial: 0 }),
      damage: new NumberField({ required: true, nullable: false, integer: true, min: 0, initial: 0 }),
      range: new StringField({ required: true, nullable: false, blank: true, initial: "" })
    };
  }
}

export class CriticalInjuryDataModel extends DescribedItemDataModel {
  static defineSchema() {
    return {
      ...super.defineSchema(),
      category: new StringField({
        required: true,
        nullable: false,
        blank: false,
        choices: ["physical", "mental"],
        initial: "physical"
      }),
      active: new BooleanField({ required: true, initial: true }),
      lethal: new BooleanField({ required: true, initial: false }),
      deathSaveModifier: new NumberField({
        required: true,
        nullable: false,
        integer: true,
        initial: 0
      }),
      timeLimit: textField(),
      healingTime: textField(),
      permanent: new BooleanField({ required: true, initial: false }),
      instantDeath: new BooleanField({ required: true, initial: false }),
      stabilized: new BooleanField({ required: true, initial: false }),
      recovery: new SchemaField({
        initialized: new BooleanField({ required: true, initial: false }),
        totalDays: new NumberField({ required: true, nullable: false, integer: true, min: 0, initial: 0 }),
        remainingDays: new NumberField({ required: true, nullable: false, integer: true, min: 0, initial: 0 }),
        lastProcessedAt: new NumberField({ required: true, nullable: false, min: 0, initial: 0 }),
        careCredits: new NumberField({ required: true, nullable: false, integer: true, min: 0, initial: 0 }),
        lastCareDay: new NumberField({ required: true, nullable: false, integer: true, initial: -1 }),
        deathSaveDue: new BooleanField({ required: true, initial: false }),
        nextDeathSaveAt: new NumberField({ required: true, nullable: false, min: 0, initial: 0 }),
        nextDeathSaveRound: new NumberField({ required: true, nullable: false, integer: true, min: 0, initial: 0 }),
        treatmentLocked: new BooleanField({ required: true, initial: false })
      }),
      deathSaveSkill: textField(),
      rollRange: textField(),
      rollModifier: new NumberField({
        required: true,
        nullable: false,
        integer: true,
        initial: 0
      }),
      affectedAttributes: textField(),
      affectedSkills: textField(),
      damageOnSkills: textField(),
      movementRestriction: new StringField({
        required: true,
        nullable: false,
        blank: true,
        choices: ["", "slow", "none"],
        initial: ""
      }),
      disabledHands: new NumberField({
        required: true,
        nullable: false,
        integer: true,
        min: 0,
        max: 2,
        initial: 0
      }),
      blockedAttributes: textField(),
      blocksActions: new BooleanField({ required: true, initial: false }),
      sleepRestriction: new StringField({
        required: true,
        nullable: false,
        blank: true,
        choices: ["", "insight", "daylight"],
        initial: ""
      }),
      sleepSkill: textField(),
      triggerKind: new StringField({
        required: true, nullable: false, blank: true,
        choices: ["", "phobia", "alcohol", "claustrophobia", "hallucinations"], initial: ""
      }),
      specialRule: new StringField({
        required: true, nullable: false, blank: true,
        choices: ["", "rupturedIntestines", "crackedSpine"], initial: ""
      })
    };
  }
}
