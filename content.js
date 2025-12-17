const DEFAULT_NAMES = ["Sam Altman", "Elon Musk"];
const CONTAINER_ID = "call-them-out-container";
const LOG_PREFIX = "[CallThemOut]";
const log = (...args) => console.log(LOG_PREFIX, ...args);
let settingsCache = null;
let styleInjected = false;
let observer = null;
let bootstrapped = false;
const uiState = {
  position: { left: null, top: null, right: 16, bottom: 16 },
  size: { width: null, height: null }
};
let evalTimeout = null;

const escapeRegex = (str) => str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const loadSettings = async () => {
  const stored = await chrome.storage.local.get(null);
  log("loadSettings fetched", stored);
  return {
    names: Array.isArray(stored.names) && stored.names.length ? stored.names : DEFAULT_NAMES,
    whitelist: Array.isArray(stored.whitelist) ? stored.whitelist : [],
    blacklist: Array.isArray(stored.blacklist) ? stored.blacklist : [],
    siteMode: typeof stored.siteMode === "string" ? stored.siteMode : "all",
    uiCollapsed: typeof stored.uiCollapsed === "boolean" ? stored.uiCollapsed : false
  };
};

const hostnameMatches = (hostname, settings) => {
  const host = hostname.toLowerCase();
  log("hostnameMatches", { host, mode: settings.siteMode, whitelist: settings.whitelist, blacklist: settings.blacklist });
  if (settings.siteMode === "whitelist") {
    return settings.whitelist.some((item) => host.includes(item.toLowerCase()));
  }
  if (settings.siteMode === "blacklist") {
    return !settings.blacklist.some((item) => host.includes(item.toLowerCase()));
  }
  return true; // "all"
};

const buildNameRegex = (names) => {
  if (!names.length) return null;
  const escaped = names.map(escapeRegex).join("|");
  const pattern = `(?:\\b(?:${escaped})\\b\\s+says|says\\s+\\b(?:${escaped})\\b)`;
  log("buildNameRegex", { names, pattern });
  return new RegExp(pattern, "i");
};

const findMatchingNames = (text, names) => {
  const lower = text.toLowerCase();
  return names.filter((name) => {
    const escaped = escapeRegex(name);
    const pattern = new RegExp(`(?:\\b${escaped}\\b\\s+says|says\\s+\\b${escaped}\\b)`, "i");
    return pattern.test(lower);
  });
};

const injectStyles = () => {
  if (styleInjected) return;
  const style = document.createElement("style");
  style.textContent = `
    #${CONTAINER_ID} { position: fixed; bottom: 16px; right: 16px; z-index: 2147483647; font-family: Arial, sans-serif; color: #0f172a; background: #e2e8f0; border: 1px solid #cbd5e1; border-radius: 10px; box-shadow: 0 10px 30px rgba(15, 23, 42, 0.18); overflow: hidden; min-width: 260px; max-width: 360px; user-select: none; }
    #${CONTAINER_ID}.collapsed { width: auto; height: auto; padding: 10px 12px; display: flex; gap: 8px; align-items: center; cursor: pointer; }
    #${CONTAINER_ID} .cto-header { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 12px 14px; background: linear-gradient(135deg, #0ea5e9, #6366f1); color: #f8fafc; }
    #${CONTAINER_ID} .cto-title { font-weight: 700; font-size: 14px; letter-spacing: 0.2px; }
    #${CONTAINER_ID} .cto-controls { display: flex; align-items: center; gap: 8px; }
    #${CONTAINER_ID} button { border: none; background: #f8fafc; color: #0f172a; cursor: pointer; border-radius: 8px; padding: 6px 10px; font-weight: 600; box-shadow: inset 0 1px 0 rgba(255,255,255,0.7); transition: transform 0.08s ease, box-shadow 0.12s ease; }
    #${CONTAINER_ID} button:hover { transform: translateY(-1px); box-shadow: 0 4px 10px rgba(15, 23, 42, 0.18); }
    #${CONTAINER_ID} .cto-body { padding: 12px 14px 14px; }
    #${CONTAINER_ID} .cto-pill { display: inline-block; background: #c7d2fe; color: #1e1b4b; padding: 4px 8px; border-radius: 999px; font-size: 12px; font-weight: 700; margin: 4px 6px 0 0; }
    #${CONTAINER_ID} .cto-subtext { font-size: 12px; color: #475569; margin-top: 6px; }
    #${CONTAINER_ID} .cto-resize { position: absolute; width: 14px; height: 14px; bottom: 6px; right: 6px; cursor: se-resize; background: rgba(15, 23, 42, 0.12); border: 1px solid rgba(15, 23, 42, 0.2); border-radius: 4px; }
    #${CONTAINER_ID} .cto-resize:hover { background: rgba(15, 23, 42, 0.22); }
  `;
  document.head.appendChild(style);
  styleInjected = true;
  log("styles injected");
};

const captureUiState = (existing) => {
  if (!existing) return;
  const rect = existing.getBoundingClientRect();
  uiState.size.width = rect.width;
  uiState.size.height = rect.height;
  uiState.position.left = rect.left;
  uiState.position.top = rect.top;
  uiState.position.right = null;
  uiState.position.bottom = null;
};

const applyUiState = (container, collapsed) => {
  const { position, size } = uiState;
  if (!collapsed && size.width) container.style.width = `${size.width}px`;
  if (!collapsed && size.height) container.style.height = `${size.height}px`;
  if (position.left != null && position.top != null) {
    container.style.left = `${position.left}px`;
    container.style.top = `${position.top}px`;
    container.style.right = "";
    container.style.bottom = "";
  } else {
    container.style.right = `${position.right || 16}px`;
    container.style.bottom = `${position.bottom || 16}px`;
  }
};

const enableDrag = (container, handle) => {
  let dragging = false;
  let startX = 0;
  let startY = 0;
  let startLeft = 0;
  let startTop = 0;

  const onMove = (e) => {
    if (!dragging) return;
    e.preventDefault();
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    const nextLeft = Math.max(0, startLeft + dx);
    const nextTop = Math.max(0, startTop + dy);
    container.style.left = `${nextLeft}px`;
    container.style.top = `${nextTop}px`;
    container.style.right = "";
    container.style.bottom = "";
    uiState.position.left = nextLeft;
    uiState.position.top = nextTop;
    uiState.position.right = null;
    uiState.position.bottom = null;
  };

  const onUp = () => {
    dragging = false;
    document.removeEventListener("mousemove", onMove);
    document.removeEventListener("mouseup", onUp);
  };

  handle.addEventListener("mousedown", (e) => {
    if (e.button !== 0) return;
    dragging = true;
    startX = e.clientX;
    startY = e.clientY;
    const rect = container.getBoundingClientRect();
    startLeft = rect.left;
    startTop = rect.top;
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  });
};

const enableResize = (container, handle) => {
  let resizing = false;
  let startX = 0;
  let startY = 0;
  let startWidth = 0;
  let startHeight = 0;

  const onMove = (e) => {
    if (!resizing) return;
    e.preventDefault();
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    const nextWidth = Math.max(240, startWidth + dx);
    const nextHeight = Math.max(140, startHeight + dy);
    container.style.width = `${nextWidth}px`;
    container.style.height = `${nextHeight}px`;
    uiState.size.width = nextWidth;
    uiState.size.height = nextHeight;
  };

  const onUp = () => {
    resizing = false;
    document.removeEventListener("mousemove", onMove);
    document.removeEventListener("mouseup", onUp);
  };

  handle.addEventListener("mousedown", (e) => {
    if (e.button !== 0) return;
    resizing = true;
    startX = e.clientX;
    startY = e.clientY;
    const rect = container.getBoundingClientRect();
    startWidth = rect.width;
    startHeight = rect.height;
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  });
};

const renderUI = (matches, collapsed) => {
  log("renderUI", { matches, collapsed, uiState });
  injectStyles();
  let container = document.getElementById(CONTAINER_ID);
  if (container) {
    captureUiState(container);
    container.remove();
  }

  container = document.createElement("div");
  container.id = CONTAINER_ID;
  if (collapsed) container.classList.add("collapsed");
  container.style.position = "fixed";
  applyUiState(container, collapsed);

  if (collapsed) {
    const label = document.createElement("span");
    label.textContent = "Call Them Out";
    label.style.fontWeight = "700";
    label.style.fontSize = "12px";
    container.appendChild(label);
    const count = document.createElement("span");
    count.textContent = `${matches.length} match${matches.length === 1 ? "" : "es"}`;
    count.style.fontSize = "12px";
    count.style.color = "#334155";
    container.appendChild(count);
    container.addEventListener("click", async (e) => {
      e.stopPropagation();
      await chrome.storage.local.set({ uiCollapsed: false });
    });
    document.body.appendChild(container);
    return;
  }

  const header = document.createElement("div");
  header.className = "cto-header";
  const title = document.createElement("div");
  title.className = "cto-title";
  title.textContent = "Call Them Out";
  header.appendChild(title);

  const controls = document.createElement("div");
  controls.className = "cto-controls";
  const collapseBtn = document.createElement("button");
  collapseBtn.textContent = "_";
  collapseBtn.title = "Collapse this panel";
  collapseBtn.addEventListener("click", async (e) => {
    e.stopPropagation();
    await chrome.storage.local.set({ uiCollapsed: true });
  });
  const closeBtn = document.createElement("button");
  closeBtn.textContent = "X";
  closeBtn.title = "Close until this page reloads";
  closeBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    container.remove();
  });
  controls.append(collapseBtn, closeBtn);
  header.appendChild(controls);

  const body = document.createElement("div");
  body.className = "cto-body";
  const lead = document.createElement("div");
  lead.textContent = matches.length ? "We spotted mentions:" : "We spotted a match.";
  body.appendChild(lead);

  if (matches.length) {
    const pillsWrapper = document.createElement("div");
    matches.forEach((match) => {
      const pill = document.createElement("span");
      pill.className = "cto-pill";
      pill.textContent = match;
      pillsWrapper.appendChild(pill);
    });
    body.appendChild(pillsWrapper);
  }

  const sub = document.createElement("div");
  sub.className = "cto-subtext";
  sub.textContent = "Matches show when the page includes '[name] says' patterns.";
  body.appendChild(sub);

  const resizeHandle = document.createElement("div");
  resizeHandle.className = "cto-resize";

  container.append(header, body, resizeHandle);
  enableDrag(container, header);
  enableResize(container, resizeHandle);
  document.body.appendChild(container);
};

const scheduleEvaluate = (settings) => {
  if (evalTimeout) clearTimeout(evalTimeout);
  evalTimeout = setTimeout(() => {
    evaluatePage(settingsCache || settings);
  }, 350);
  log("scheduleEvaluate queued", { debounceMs: 350 });
};

const evaluatePage = (settings) => {
  const start = performance.now();
  log("evaluatePage start", { host: window.location.hostname, names: settings.names, collapsed: settings.uiCollapsed });
  if (!hostnameMatches(window.location.hostname, settings)) {
    const existing = document.getElementById(CONTAINER_ID);
    if (existing) existing.remove();
    log("evaluatePage skipped due to hostname filter");
    return;
  }
  const regex = buildNameRegex(settings.names);
  if (!regex) {
    log("evaluatePage no regex built");
    return;
  }
  const text = document.body ? document.body.innerText : "";
  if (!text) {
    log("evaluatePage empty body text");
    return;
  }
  log("evaluatePage text length", text.length);
  const hasMatch = regex.test(text);
  if (!hasMatch) {
    const existing = document.getElementById(CONTAINER_ID);
    if (existing) existing.remove();
    log("evaluatePage no match found", { durationMs: (performance.now() - start).toFixed(1) });
    return;
  }
  const namesFound = findMatchingNames(text, settings.names);
  log("evaluatePage match", { namesFound, durationMs: (performance.now() - start).toFixed(1) });
  renderUI(namesFound, settings.uiCollapsed);
};

const setupObserver = (settings) => {
  if (observer) observer.disconnect();
  observer = new MutationObserver(() => {
    scheduleEvaluate(settings);
  });
  observer.observe(document.body || document.documentElement, { childList: true, subtree: true, characterData: true });
  log("MutationObserver set");
};

const bootstrap = async () => {
  if (bootstrapped) return;
  bootstrapped = true;
  log("bootstrap start");
  settingsCache = await loadSettings();
  evaluatePage(settingsCache);
  setupObserver(settingsCache);
  log("bootstrap complete");
};

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  log("storage.onChanged", changes);
  const next = { ...(settingsCache || {}) };
  for (const key of Object.keys(changes)) {
    next[key] = changes[key].newValue;
  }
  settingsCache = next;
  evaluatePage(settingsCache);
});

document.addEventListener("DOMContentLoaded", bootstrap);
if (document.readyState === "complete" || document.readyState === "interactive") {
  bootstrap();
}
