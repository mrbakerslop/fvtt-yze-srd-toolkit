export const PANIC_RESULTS = Object.freeze([
  { min: 1, max: 6, key: "keepingTogether", title: "Keeping It Together", effect: "You barely keep your nerves in check.", stressChange: 0 },
  { min: 7, max: 7, key: "nervousTwitch", title: "Nervous Twitch", effect: "You and all PCs within Short range gain one stress.", stressChange: 1 },
  { min: 8, max: 8, key: "tremble", title: "Tremble", effect: "All Agility-based skill rolls suffer −2.", stressChange: 0 },
  { min: 9, max: 9, key: "dropItem", title: "Drop Item", effect: "Drop a weapon or another important item chosen by the GM.", stressChange: 0 },
  { min: 10, max: 10, key: "freeze", title: "Freeze", effect: "Lose your next turn, frozen by fear or stress.", stressChange: 0 },
  { min: 11, max: 11, key: "seekCover", title: "Seek Cover", effect: "Use your next action to escape danger and find safety. Lose one stress, but nearby PCs gain one; act normally after one round.", stressChange: -1 },
  { min: 12, max: 12, key: "scream", title: "Scream", effect: "Lose your next turn screaming. Lose one stress; every PC who hears you makes an immediate panic roll.", stressChange: -1 },
  { min: 13, max: 13, key: "flee", title: "Flee", effect: "Flee to safety and refuse danger. Lose one stress; every PC who hears you makes an immediate panic roll.", stressChange: -1 },
  { min: 14, max: 14, key: "berserk", title: "Berserk", effect: "Attack the nearest creature until you or it is broken. Witnessing PCs make an immediate panic roll.", stressChange: 0 },
  { min: 15, max: 100, key: "catatonic", title: "Catatonic", effect: "Collapse, unable to speak or move, and stare blankly into oblivion.", stressChange: 0 }
]);

export function getPanicResult(total) {
  const value = Math.max(1, Math.trunc(Number(total) || 1));
  return PANIC_RESULTS.find((entry) => value >= entry.min && value <= entry.max)
    ?? PANIC_RESULTS.at(-1);
}
