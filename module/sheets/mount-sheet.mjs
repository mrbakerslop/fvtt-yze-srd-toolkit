import { STEP_RATINGS } from "../constants.mjs";
import { formatStepRatingLabel, getAttributeLabels, isStepDiceEnabled, isTravelEnabled, isVehicleSubsystemEnabled } from "../settings.mjs";
import { promptManualDamage, promptManualRecovery } from "../harm.mjs";
import { assignMountRider, promptMountedMovement, restMount } from "../mounts.mjs";
import { chaseStateFor, drawChaseObstacle, endChase, promptChaseManeuver, startChase } from "../chases.mjs";
import { advanceTravelShift, getTravelClock, performMountedTravel } from "../travel.mjs";
import { travelMapState } from "../travel-map.mjs";
import { actorEncumbrance } from "../encumbrance.mjs";

const { ActorSheetV2 } = foundry.applications.sheets;
const { HandlebarsApplicationMixin } = foundry.applications.api;

export class YZEMountSheet extends HandlebarsApplicationMixin(ActorSheetV2) {
  static DEFAULT_OPTIONS = {
    classes: ["yze", "actor-sheet", "mount-sheet"],
    position: { width: 650, height: 620 },
    window: { resizable: true },
    form: { closeOnSubmit: false, submitOnChange: true },
    actions: {
      applyDamage: this._onApplyDamage,
      recover: this._onRecover,
      mountedMove: this._onMountedMove,
      mountedTravel: this._onMountedTravel,
      restMount: this._onRestMount,
      chaseManeuver: this._onChaseManeuver,
      chaseObstacle: this._onChaseObstacle,
      startChase: this._onStartChase,
      endChase: this._onEndChase,
      advanceTravelShift: this._onAdvanceTravelShift,
      editItem: this._onEditItem,
      removeItem: this._onRemoveItem
    }
  };

  static PARTS = { main: { template: "systems/fvtt-yze-srd/templates/mount-sheet.hbs" } };

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    context.actor = this.actor;
    context.system = this.actor.system;
    context.useStepDice = isStepDiceEnabled();
    context.attributeLabels = getAttributeLabels();
    context.showChases = isVehicleSubsystemEnabled();
    context.showTravel = isTravelEnabled();
    context.isGM = game.user?.isGM === true;
    context.chaseTracker = chaseStateFor(this.actor);
    context.travelClock = context.showTravel ? getTravelClock() : null;
    context.travelMap = context.showTravel ? travelMapState() : null;
    context.riderOptions = game.actors.filter((actor) => ["character", "npc"].includes(actor.type))
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((actor) => ({ uuid: actor.uuid, name: actor.name, selected: actor.uuid === this.actor.system.riderUuid }));
    context.items = [...this.actor.items].sort((a, b) => a.name.localeCompare(b.name)).map((item) => ({
      id: item.id, name: item.name, type: item.type, quantity: Number(item.system.quantity) || 0
    }));
    context.stepOptions = STEP_RATINGS.map((entry) => ({
      value: entry.value,
      label: formatStepRatingLabel(entry.value)
    }));
    context.travelState = { ridden: 0, rested: false, ...(this.actor.getFlag("fvtt-yze-srd", "mountedTravel") ?? {}) };
    context.encumbrance = actorEncumbrance(this.actor);
    return context;
  }

  async _onRender(context, options) {
    await super._onRender(context, options);
    this.element.querySelector('[name="system.riderUuid"]')?.addEventListener("change", async (event) => {
      if (this.isEditable) await assignMountRider(this.actor, event.currentTarget.value);
    });
  }

  static async _onApplyDamage() { await promptManualDamage(this.actor); }
  static async _onRecover() { await promptManualRecovery(this.actor); }
  static async _onMountedMove() { await promptMountedMovement(this.actor); }
  static async _onMountedTravel() { await performMountedTravel(this.actor); }
  static async _onRestMount() { await restMount(this.actor); }
  static async _onChaseManeuver() { await promptChaseManeuver(this.actor); }
  static async _onChaseObstacle() { await drawChaseObstacle({ vehicle: false }); }
  static async _onStartChase() { await startChase(this.actor); }
  static async _onEndChase() { await endChase(); }
  static async _onAdvanceTravelShift() { await advanceTravelShift(); }
  static _onEditItem(event, target) { this.actor.items.get(target.closest("[data-item-id]")?.dataset.itemId)?.sheet.render({ force: true }); }
  static async _onRemoveItem(event, target) {
    const id = target.closest("[data-item-id]")?.dataset.itemId;
    if (id && this.isEditable) await this.actor.deleteEmbeddedDocuments("Item", [id]);
  }

  async _onDropItem(event, item) {
    if (!["gear", "weapon", "armor", "consumable"].includes(item.type)) {
      ui.notifications.warn(game.i18n.localize("YZE.Mount.DropCarriedOnly"));
      return null;
    }
    return this.isEditable ? super._onDropItem(event, item) : null;
  }
}
