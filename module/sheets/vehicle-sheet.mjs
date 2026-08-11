import { STEP_RATINGS } from "../constants.mjs";
import {
  formatStepRatingLabel,
  isStepDiceEnabled,
  isTravelEnabled,
  isVehicleSubsystemEnabled
} from "../settings.mjs";
import { promptManualDamage } from "../harm.mjs";
import { promptVehicleRepair } from "../recovery-card.mjs";
import { beginAerialCrash, controlledAerialLanding, rollVehicleManeuver, vehicleCrewAction } from "../vehicles.mjs";
import { chaseStateFor, drawChaseObstacle, endChase, promptChaseManeuver, startChase } from "../chases.mjs";
import { advanceTravelShift, getTravelClock, performVehicleTravel } from "../travel.mjs";
import { travelMapState } from "../travel-map.mjs";

const { ActorSheetV2 } = foundry.applications.sheets;
const { HandlebarsApplicationMixin } = foundry.applications.api;

export class YZEVehicleSheet extends HandlebarsApplicationMixin(ActorSheetV2) {
  static DEFAULT_OPTIONS = {
    classes: ["yze", "actor-sheet", "vehicle-sheet"],
    position: {
      width: 620,
      height: 560
    },
    window: {
      resizable: true
    },
    form: {
      closeOnSubmit: false,
      submitOnChange: true
    },
    actions: {
      applyDamage: this._onApplyDamage,
      repairHull: this._onRepairHull,
      vehicleManeuver: this._onVehicleManeuver,
      controlledLanding: this._onControlledLanding,
      resolveAerialCrash: this._onResolveAerialCrash,
      ramVehicle: this._onRamVehicle,
      chaseManeuver: this._onChaseManeuver,
      chaseObstacle: this._onChaseObstacle,
      startChase: this._onStartChase,
      endChase: this._onEndChase,
      vehicleTravel: this._onVehicleTravel,
      advanceTravelShift: this._onAdvanceTravelShift,
      enterVehicle: this._onEnterVehicle,
      exitVehicle: this._onExitVehicle,
      startVehicle: this._onStartVehicle,
      grabWheel: this._onGrabWheel,
      editItem: this._onEditItem,
      removeComponent: this._onRemoveComponent
    }
  };

  static PARTS = {
    main: {
      template: "systems/fvtt-yze-srd/templates/vehicle-sheet.hbs"
    }
  };

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    context.actor = this.actor;
    context.system = this.actor.system;
    context.useStepDice = isStepDiceEnabled();
    context.showVehicleSubsystem = isVehicleSubsystemEnabled();
    context.showTravel = isTravelEnabled();
    context.isGM = game.user?.isGM === true;
    context.chaseTracker = chaseStateFor(this.actor);
    context.travelClock = context.showTravel ? getTravelClock() : null;
    context.travelMap = context.showTravel ? travelMapState() : null;
    if (context.travelClock) {
      context.travelClock.summary = game.i18n.format("YZE.Travel.ClockSummary", {
        day: context.travelClock.day,
        shift: game.i18n.localize(`YZE.Travel.Shifts.${context.travelClock.shift}`),
        weather: game.i18n.localize(`YZE.Travel.Weather.${context.travelClock.weather}`)
      });
    }
    context.canAdvanceTravel = game.user?.isGM === true;
    context.driverOptions = game.actors
      .filter((actor) => ["character", "npc"].includes(actor.type))
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((actor) => ({ uuid: actor.uuid, name: actor.name, selected: actor.uuid === this.actor.system.driverUuid }));
    const occupants = new Set(this.actor.system.occupantUuids ?? []);
    context.occupantOptions = game.actors
      .filter((actor) => ["character", "npc"].includes(actor.type)
        && actor.uuid !== this.actor.system.driverUuid)
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((actor) => ({ uuid: actor.uuid, name: actor.name, selected: occupants.has(actor.uuid) }));
    context.occupantNames = context.occupantOptions.filter((entry) => entry.selected).map((entry) => entry.name).join(", ");
    context.components = this.actor.items
      .filter((item) => item.type === "vehicleComponent")
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((item) => ({
        id: item.id,
        name: item.name,
        system: item.system,
        componentTypeLabel: game.i18n.localize(`YZE.Vehicle.ComponentTypes.${item.system.componentType}`)
      }));
    context.armorRatingOptions = STEP_RATINGS.map((rating) => ({
      value: rating.value,
      label: formatStepRatingLabel(rating.value),
      selected: Number(this.actor.system.armorStepRating) === rating.value
    }));
    context.armorMaximumOptions = STEP_RATINGS.map((rating) => ({
      value: rating.value,
      label: formatStepRatingLabel(rating.value),
      selected: Number(this.actor.system.armorStepMax) === rating.value
    }));
    return context;
  }

  async _onRender(context, options) {
    await super._onRender(context, options);
    for (const input of this.element.querySelectorAll("[data-item-field]")) {
      input.addEventListener("change", async (event) => {
        const target = event.currentTarget;
        const item = this.actor.items.get(target.dataset.itemId);
        if (!item || !this.isEditable) return;
        await item.update({ [target.dataset.itemField]: target.type === "checkbox" ? target.checked : target.value });
      });
    }
    this.element.querySelector("[data-occupant-select]")?.addEventListener("change", async (event) => {
      if (!this.isEditable) return;
      const uuids = [...event.currentTarget.selectedOptions].map((option) => option.value);
      await this.actor.update({ "system.occupantUuids": uuids });
    });
  }

  static async _onApplyDamage() {
    await promptManualDamage(this.actor);
  }

  static async _onRepairHull() {
    await promptVehicleRepair(this.actor);
  }

  static async _onVehicleManeuver() { await rollVehicleManeuver(this.actor); }
  static async _onControlledLanding() { await controlledAerialLanding(this.actor); }
  static async _onResolveAerialCrash() { await beginAerialCrash(this.actor); }
  static async _onRamVehicle() { await rollVehicleManeuver(this.actor, { ram: true }); }
  static async _onChaseManeuver() { await promptChaseManeuver(this.actor); }
  static async _onChaseObstacle() { await drawChaseObstacle({ vehicle: true }); }
  static async _onStartChase() { await startChase(this.actor); }
  static async _onEndChase() { await endChase(); }
  static async _onVehicleTravel() { await performVehicleTravel(this.actor); }
  static async _onAdvanceTravelShift() { await advanceTravelShift(); }
  static async _onEnterVehicle() { await vehicleCrewAction(this.actor, "enter"); }
  static async _onExitVehicle() { await vehicleCrewAction(this.actor, "exit"); }
  static async _onStartVehicle() { await vehicleCrewAction(this.actor, "start"); }
  static async _onGrabWheel() { await vehicleCrewAction(this.actor, "grabWheel"); }

  static _onEditItem(event, target) {
    this.actor.items.get(target.closest("[data-item-id]")?.dataset.itemId)?.sheet.render({ force: true });
  }

  static async _onRemoveComponent(event, target) {
    const id = target.closest("[data-item-id]")?.dataset.itemId;
    const item = this.actor.items.get(id);
    if (item?.type === "vehicleComponent" && this.isEditable) {
      await this.actor.deleteEmbeddedDocuments("Item", [id]);
    }
  }

  async _onDropItem(event, item) {
    const target = event.target instanceof Element ? event.target : null;
    const dropZone = target?.closest('[data-accepts="vehicleComponent"]');
    if (!isVehicleSubsystemEnabled() || !dropZone || item.type !== "vehicleComponent") {
      ui.notifications.warn(game.i18n.localize("YZE.Vehicle.DropComponentOnly"));
      return null;
    }
    if (!this.isEditable) return null;

    const wasAlreadyEmbedded = item.parent?.uuid === this.actor.uuid;
    const dropped = await super._onDropItem(event, item);
    if (dropped && !wasAlreadyEmbedded) {
      ui.notifications.info(game.i18n.format("YZE.Vehicle.ComponentAdded", {
        component: item.name,
        vehicle: this.actor.name
      }));
    }
    return dropped;
  }
}
