const DEFAULT_NAMES = ["Sam Altman", "Elon Musk"];
const DEFAULT_VERBS = ["says", "said", "predicts", "claims"];
const DEFAULT_QUOTES = {
  "Elon Musk": [
    {
      text: "There will be 1 MILLION robotaxis operating fully autonomously within 1 year",
      date: "April 22 2019"
    },
    {
      text: "Tesla  increasing production of solar roofs towards one thousand per week by end of 2019.",
      date: "7/29/2019"
    },
    {
        text: "I see a path to Twitter exceeding a billion monthly users in 12 to 18 months.",
        date: "2022-11-27"
    }
  ],
  "Sam Altman": [
    { text: "Placeholder quote 1.", date: "2023-01-01" },
    { text: "Placeholder quote 2.", date: "2024-01-01" },
    { text: "Placeholder quote 3.", date: "2025-01-01" }
  ]
};
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
let isDragging = false;
let isResizing = false;
let dismissed = false;

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
  const escapedVerbs = DEFAULT_VERBS.map(escapeRegex).join("|");
  const pattern = `(?:\\b(?:${escaped})\\b\\s+(?:${escapedVerbs})|(?:${escapedVerbs})\\s+\\b(?:${escaped})\\b)`;
  log("buildNameRegex", { names, verbs: DEFAULT_VERBS, pattern });
  return new RegExp(pattern, "i");
};

const findMatchingNames = (text, names) => {
  const lower = text.toLowerCase();
  return names.filter((name) => {
    const escaped = escapeRegex(name);
    const escapedVerbs = DEFAULT_VERBS.map(escapeRegex).join("|");
    const pattern = new RegExp(`(?:\\b${escaped}\\b\\s+(?:${escapedVerbs})|(?:${escapedVerbs})\\s+\\b${escaped}\\b)`, "i");
    return pattern.test(lower);
  });
};

const injectStyles = () => {
  if (styleInjected) return;
  const style = document.createElement("style");
  style.textContent = `
    #${CONTAINER_ID} { position: fixed; bottom: 16px; right: 16px; z-index: 2147483647; font-family: Arial, sans-serif; color: #0f172a; background: #e2e8f0; border: 1px solid #cbd5e1; border-radius: 10px; box-shadow: 0 10px 30px rgba(15, 23, 42, 0.18); overflow: hidden; min-width: 180px; width: 280px; user-select: none; box-sizing: border-box; }
    #${CONTAINER_ID}.collapsed { width: auto; height: auto; padding: 10px 12px; display: flex; gap: 8px; align-items: center; cursor: pointer; }
    #${CONTAINER_ID} .cto-header { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 6px 8px; background: linear-gradient(135deg, #0ea5e9, #6366f1); color: #f8fafc; cursor: move; user-select: none; touch-action: none; }
    #${CONTAINER_ID} .cto-title { font-weight: 700; font-size: 12px; letter-spacing: 0.2px; }
    #${CONTAINER_ID} .cto-controls { display: flex; align-items: center; gap: 6px; }
    #${CONTAINER_ID} button { border: none; background: #f8fafc; color: #0f172a; cursor: pointer; border-radius: 6px; padding: 4px 8px; font-weight: 700; box-shadow: inset 0 1px 0 rgba(255,255,255,0.7); transition: transform 0.08s ease, box-shadow 0.12s ease; }
    #${CONTAINER_ID} button:hover { transform: translateY(-1px); box-shadow: 0 4px 10px rgba(15, 23, 42, 0.18); }
    #${CONTAINER_ID} .cto-body { padding: 10px 10px 12px; }
    #${CONTAINER_ID} .cto-pill { display: inline-block; background: #c7d2fe; color: #1e1b4b; padding: 2px 6px; border-radius: 999px; font-size: 11px; font-weight: 700; margin: 4px 6px 0 0; }
    #${CONTAINER_ID} .cto-subtext { font-size: 12px; color: #475569; margin-top: 6px; }
    #${CONTAINER_ID} .cto-section { margin-top: 8px; }
    #${CONTAINER_ID} .cto-name { font-weight: 800; font-size: 12px; color: #0f172a; margin-top: 6px; }
    #${CONTAINER_ID} .cto-quote { margin-top: 6px; font-size: 12px; color: #111827; background: #eef2ff; border: 1px solid #c7d2fe; border-radius: 8px; padding: 6px 8px; }
    #${CONTAINER_ID} .cto-ago { display: block; font-size: 11px; color: #475569; margin-top: 2px; }
    #${CONTAINER_ID} .cto-resize { position: absolute; width: 14px; height: 14px; bottom: 6px; right: 6px; cursor: se-resize; background: rgba(15, 23, 42, 0.12); border: 1px solid rgba(15, 23, 42, 0.2); border-radius: 4px; }
    #${CONTAINER_ID} .cto-resize:hover { background: rgba(15, 23, 42, 0.22); }
  `;
  document.head.appendChild(style);
  styleInjected = true;
  log("styles injected");
};

const parseDate = (value) => {
  const d = new Date(value);
  return isNaN(d.getTime()) ? null : d;
};

const formatSince = (date) => {
  const d = typeof date === "string" ? parseDate(date) : date;
  if (!d) return "unknown time";
  const now = new Date();
  let diff = Math.max(0, now - d);
  const minute = 60 * 1000;
  const hour = 60 * minute;
  const day = 24 * hour;
  const month = 30 * day;
  const year = 365 * day;

  const years = Math.floor(diff / year); diff -= years * year;
  const months = Math.floor(diff / month); diff -= months * month;
  const days = Math.floor(diff / day);
  const parts = [];
  if (years) parts.push(`${years} year${years === 1 ? "" : "s"}`);
  if (months && parts.length < 2) parts.push(`${months} month${months === 1 ? "" : "s"}`);
  if (!years && !months && days) parts.push(`${days} day${days === 1 ? "" : "s"}`);
  if (!parts.length) return "today";
  return parts.join(", ") + " ago";
};

const captureUiState = (existing) => {
  if (!existing) return;
  const rect = existing.getBoundingClientRect();
  if (isResizing) {
    uiState.size.width = rect.width;
    uiState.size.height = rect.height;
  }
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
    container.style.height = size.height ? `${size.height}px` : "";
  } else {
    container.style.left = "";
    container.style.top = "";
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
  let maxLeft = 0;
  let maxTop = 0;

  const onMove = (e) => {
    if (!dragging) return;
    e.preventDefault();
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    const nextLeft = Math.min(maxLeft, Math.max(0, startLeft + dx));
    const nextTop = Math.min(maxTop, Math.max(0, startTop + dy));
    container.style.left = `${nextLeft}px`;
    container.style.top = `${nextTop}px`;
    container.style.right = "";
    container.style.bottom = "";
    uiState.position.left = nextLeft;
    uiState.position.top = nextTop;
    uiState.position.right = null;
    uiState.position.bottom = null;
    log("drag move", { nextLeft, nextTop });
  };

  const onUp = (e) => {
    if (!dragging) return;
    dragging = false;
    isDragging = false;
    try { handle.releasePointerCapture(e.pointerId); } catch (_) {}
    document.removeEventListener("pointermove", onMove);
    document.removeEventListener("pointerup", onUp);
    log("drag end", { left: uiState.position.left, top: uiState.position.top });
  };

  handle.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    if (e.target.closest && e.target.closest(".cto-controls")) return; // don't drag when clicking buttons
    dragging = true;
    isDragging = true;
    startX = e.clientX;
    startY = e.clientY;
    const rect = container.getBoundingClientRect();
    startLeft = rect.left;
    startTop = rect.top;
    maxLeft = Math.max(0, window.innerWidth - rect.width);
    maxTop = Math.max(0, window.innerHeight - rect.height);
    container.style.bottom = "";
    container.style.right = "";
    try { handle.setPointerCapture(e.pointerId); } catch (_) {}
    document.addEventListener("pointermove", onMove, { passive: false });
    document.addEventListener("pointerup", onUp, { passive: true });
    e.preventDefault();
    log("drag start", { startLeft, startTop, maxLeft, maxTop });
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
    const nextWidth = Math.max(180, startWidth + dx);
    const nextHeight = Math.max(100, startHeight + dy);
    container.style.width = `${nextWidth}px`;
    container.style.height = `${nextHeight}px`;
    uiState.size.width = nextWidth;
    uiState.size.height = nextHeight;
  };

  const onUp = () => {
    resizing = false;
    isResizing = false;
    document.removeEventListener("mousemove", onMove);
    document.removeEventListener("mouseup", onUp);
  };

  handle.addEventListener("mousedown", (e) => {
    if (e.button !== 0) return;
    resizing = true;
    isResizing = true;
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
  if (dismissed) return;
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
      settingsCache = { ...(settingsCache || {}), uiCollapsed: false };
      await chrome.storage.local.set({ uiCollapsed: false });
      renderUI(matches, false);
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
    settingsCache = { ...(settingsCache || {}), uiCollapsed: true };
    await chrome.storage.local.set({ uiCollapsed: true });
    renderUI(matches, true);
  });
  const closeBtn = document.createElement("button");
  closeBtn.textContent = "X";
  closeBtn.title = "Close until this page reloads";
  closeBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    dismissed = true;
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

  // For each matched name, show their quotes and how long since
  if (matches.length) {
    matches.forEach((name) => {
      const quotes = DEFAULT_QUOTES[name] || [];
      if (!quotes.length) return;
      const section = document.createElement("div");
      section.className = "cto-section";
      const who = document.createElement("div");
      who.className = "cto-name";
      who.textContent = `${name} — they also said:`;
      section.appendChild(who);

      quotes.forEach((q) => {
        const item = document.createElement("div");
        item.className = "cto-quote";
        item.textContent = `“${q.text}”`;
        const ago = document.createElement("span");
        ago.className = "cto-ago";
        ago.textContent = `${formatSince(q.date)} (said ${new Date(q.date).toLocaleDateString()})`;
        item.appendChild(ago);
        section.appendChild(item);
      });
      body.appendChild(section);
    });
  }

  const resizeHandle = document.createElement("div");
  resizeHandle.className = "cto-resize";

  container.append(header, body, resizeHandle);
  enableDrag(container, header);
  enableResize(container, resizeHandle);
  document.body.appendChild(container);
};

const scheduleEvaluate = (settings) => {
  if (evalTimeout) clearTimeout(evalTimeout);
  const delay = (isDragging || isResizing) ? 800 : 350;
  evalTimeout = setTimeout(() => {
    if (!isDragging && !isResizing) {
      evaluatePage(settingsCache || settings);
    } else {
      log("scheduleEvaluate skipped due to drag/resize in progress");
    }
  }, delay);
  log("scheduleEvaluate queued", { debounceMs: 350 });
};

const evaluatePage = (settings) => {
  const start = performance.now();
  log("evaluatePage start", { host: window.location.hostname, names: settings.names, collapsed: settings.uiCollapsed });
  if (dismissed) {
    log("evaluatePage aborted: dismissed for this session");
    const existing = document.getElementById(CONTAINER_ID);
    if (existing) existing.remove();
    return;
  }
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
