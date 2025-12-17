# Call Them Out (Chrome Extension)

Surfaces a floating panel whenever a page includes phrases like “Sam Altman says” or “says Elon Musk”. Users can edit the watched names, control site matching (all, whitelist, blacklist), and collapse the panel with persistent state.

## Features
- Default watch list: Sam Altman, Elon Musk.
- Detects case-insensitive “[name] says” or “says [name]” on any page.
- Floating UI with collapse (persistent) and close (per-page) controls.
- Popup options to edit names, choose site scope: all / whitelist / blacklist, and edit those lists.
- Uses `chrome.storage.local` with first-run seeding.

## Install (developer mode)
1. Run `npm` commands are not needed; no build step.
2. Open `chrome://extensions`, enable Developer Mode.
3. Click “Load unpacked” and select this folder.

## How it works
- `background.js` seeds defaults on first install.
- `content.js` reads settings, checks site mode, scans page text, and shows the floating UI. Collapse state persists; close hides until reload.
- `popup.html/js` lets you edit watched names and site lists; saved to storage.

## Storage keys
- `names`: string[] of watched names.
- `whitelist`: string[] of allowed host fragments when in whitelist mode.
- `blacklist`: string[] of blocked host fragments when in blacklist mode.
- `siteMode`: "all" | "whitelist" | "blacklist".
- `uiCollapsed`: boolean, persisted collapse state.
