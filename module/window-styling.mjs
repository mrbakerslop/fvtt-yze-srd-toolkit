/** Apply the system window theme to any Application whose rendered content belongs to YZE. */
export function registerWindowStylingHooks() {
  Hooks.on("renderApplicationV2", (_application, element) => {
    const root = element?.querySelector ? element : element?.[0];
    if (!root) return;
    const systemOwned = root.classList.contains("yze")
      || root.querySelector(":scope > .window-content .yze")
      || root.querySelector(":scope > form .yze");
    if (!systemOwned) return;
    root.classList.add("yze", "yze-window");
    if (root.matches("dialog, .dialog")) root.classList.add("yze-dialog");
  });
}
