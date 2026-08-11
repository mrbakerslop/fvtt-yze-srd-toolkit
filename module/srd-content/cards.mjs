import { SYSTEM_ID } from "../constants.mjs";

const CARD_BACK = {
  name: "YZE Initiative",
  img: `systems/${SYSTEM_ID}/assets/cards/initiative-back.svg`
};

export const SRD_INITIATIVE_DECK = {
  name: "YZE Initiative Cards",
  type: "deck",
  img: `systems/${SYSTEM_ID}/assets/cards/initiative-back.svg`,
  description: "<p>Ten initiative cards numbered 1–10. Lower values act first. This editable world deck is available for manual draws; the Combat Tracker uses the same values without consuming these cards.</p>",
  displayCount: true,
  cards: Array.from({ length: 10 }, (_entry, index) => {
    const value = index + 1;
    return {
      name: `Initiative ${value}`,
      type: "base",
      suit: "Initiative",
      value,
      faces: [{
        name: `Initiative ${value}`,
        img: `systems/${SYSTEM_ID}/assets/cards/initiative-${value}.svg`
      }],
      back: CARD_BACK,
      face: 0,
      drawn: false,
      description: `<p>Initiative ${value}. Lower values act first.</p>`,
      sort: value * 100000,
      flags: {
        [SYSTEM_ID]: { initiativeValue: value }
      }
    };
  })
};
