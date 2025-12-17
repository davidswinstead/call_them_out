const DEFAULT_NAMES = ["Sam Altman", "Elon Musk"];

const textareaToList = (value) => value.split(/\n+/).map((v) => v.trim()).filter(Boolean);
const listToTextarea = (list) => (Array.isArray(list) ? list.join("\n") : "");

const load = async () => {
  const stored = await chrome.storage.local.get(null);
  const names = Array.isArray(stored.names) && stored.names.length ? stored.names : DEFAULT_NAMES;
  const whitelist = Array.isArray(stored.whitelist) ? stored.whitelist : [];
  const blacklist = Array.isArray(stored.blacklist) ? stored.blacklist : [];
  const siteMode = typeof stored.siteMode === "string" ? stored.siteMode : "all";

  document.getElementById("names").value = listToTextarea(names);
  document.getElementById("whitelist").value = listToTextarea(whitelist);
  document.getElementById("blacklist").value = listToTextarea(blacklist);
  const modeInput = document.querySelector(`input[name="mode"][value="${siteMode}"]`);
  if (modeInput) modeInput.checked = true;
};

const save = async () => {
  const names = textareaToList(document.getElementById("names").value);
  const whitelist = textareaToList(document.getElementById("whitelist").value);
  const blacklist = textareaToList(document.getElementById("blacklist").value);
  const modeEl = document.querySelector('input[name="mode"]:checked');
  const siteMode = modeEl ? modeEl.value : "all";

  await chrome.storage.local.set({ names, whitelist, blacklist, siteMode });
  const status = document.getElementById("status");
  status.textContent = "Saved";
  setTimeout(() => (status.textContent = ""), 1200);
};

document.addEventListener("DOMContentLoaded", () => {
  load();
  document.getElementById("save").addEventListener("click", save);
});
