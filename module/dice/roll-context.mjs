export function rollMessageVisibility(mode) {
  if (mode !== "blindroll") return {};
  return {
    whisper: game.users.filter((user) => user.isGM).map((user) => user.id),
    blind: true
  };
}

export function renderRollContext({ rollType = "active", attemptGoal = "" } = {}) {
  const notices = [];
  if (rollType === "passive") {
    notices.push(game.i18n.localize("YZE.Roll.PassiveRollNotice"));
  }
  if (attemptGoal) {
    notices.push(game.i18n.format("YZE.Attempts.ChatNotice", { goal: attemptGoal }));
  }
  if (notices.length === 0) return "";
  return `<p class="hint yze-roll-context">${notices
    .map((notice) => foundry.utils.escapeHTML(notice))
    .join(" · ")}</p>`;
}
