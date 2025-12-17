/* Handles first-run initialization and keeps default settings available. */
const DEFAULT_NAMES = ["Sam Altman", "Elon Musk"];
const DEFAULT_SETTINGS = {
  names: DEFAULT_NAMES,
  whitelist: [],
  blacklist: [],
  siteMode: "all", // all | whitelist | blacklist
  uiCollapsed: false,
  initialized: true
};

chrome.runtime.onInstalled.addListener(async () => {
  const existing = await chrome.storage.local.get(null);
  if (!existing.initialized) {
    await chrome.storage.local.set(DEFAULT_SETTINGS);
  } else {
    // Ensure new defaults are added without overwriting user settings.
    const updates = {};
    if (!Array.isArray(existing.names)) updates.names = DEFAULT_NAMES;
    if (typeof existing.siteMode !== "string") updates.siteMode = "all";
    if (!Array.isArray(existing.whitelist)) updates.whitelist = [];
    if (!Array.isArray(existing.blacklist)) updates.blacklist = [];
    if (typeof existing.uiCollapsed !== "boolean") updates.uiCollapsed = false;
    if (Object.keys(updates).length) {
      updates.initialized = true;
      await chrome.storage.local.set(updates);
    }
  }
});
