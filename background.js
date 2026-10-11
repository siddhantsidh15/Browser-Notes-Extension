// background.js - Service worker for Save to Notes extension

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: "saveToNotes",
    title: "Save to Notes",
    contexts: ["selection"],
  });
  applyDockMode();
});

// ── Docked side-panel mode ────────────────────────────────────────────────────
// When the "Dock" toggle in the popup is ON, the toolbar icon has NO popup, so
// clicking it (or pressing Cmd/Ctrl+M, which is mapped to _execute_action) fires
// action.onClicked and we open Chrome's side panel instead. Chrome handles the
// page split and the draggable divider. When the toggle is OFF the normal
// dropdown popup is restored.
const DOCK_KEY = "dockMode";

async function applyDockMode() {
  const r = await chrome.storage.local.get([DOCK_KEY]);
  const on = r[DOCK_KEY] === true;
  await chrome.action.setPopup({ popup: on ? "" : "popup.html" });

  // The panel is only ever enabled per tab (see onClicked below), never globally,
  // so it shows on the tab you opened it on and nowhere else.
  await chrome.sidePanel.setOptions({ enabled: false });

  // Dock turned off: drop the panel from every tab that had it
  if (!on) {
    const tabs = await chrome.tabs.query({});
    for (const t of tabs) {
      chrome.sidePanel.setOptions({ tabId: t.id, enabled: false }).catch(() => {});
    }
  }
}

// setPopup() isn't remembered across browser restarts / worker restarts, so
// re-apply the saved state whenever the service worker starts.
applyDockMode();
chrome.runtime.onStartup.addListener(applyDockMode);

// Flip between popup <-> side panel as soon as the toggle changes
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes[DOCK_KEY]) applyDockMode();
});

// Global shortcut (works while the page has focus, e.g. with the docked panel open):
// the open popup / side panel does the actual capture and inserts it into the note.
chrome.commands.onCommand.addListener((command) => {
  if (command === "take-snapshot") {
    chrome.runtime.sendMessage({ action: "takeSnapshot" }).catch(() => {});
  }
});

chrome.action.onClicked.addListener((tab) => {
  // Keep these calls synchronous (no awaits in between): sidePanel.open()
  // needs the user gesture. The panel is enabled for THIS tab only, so it
  // hides when you switch away and is still there when you come back.
  chrome.sidePanel
    .setOptions({ tabId: tab.id, path: "sidepanel.html", enabled: true })
    .catch((err) => console.error("Could not enable side panel:", err));
  chrome.sidePanel
    .open({ tabId: tab.id })
    .catch((err) => console.error("Could not open side panel:", err));
});

// // Open the notes page when the extension icon is clicked
// // If already open, focus it instead of opening a duplicate
// chrome.action.onClicked.addListener(async () => {
//   const notesUrl = chrome.runtime.getURL("notes.html");
//   const existing = await chrome.tabs.query({ url: notesUrl });
//   if (existing.length > 0) {
//     await chrome.tabs.update(existing[0].id, { active: true });
//     await chrome.windows.update(existing[0].windowId, { focused: true });
//   } else {
//     chrome.tabs.create({ url: notesUrl });
//   }
// });

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === "saveToNotes" && info.selectionText) {
    saveNote({
      selectedText: info.selectionText.trim(),
      sourceUrl: tab.url,
      sourceTitle: tab.title,
      timestamp: new Date().toISOString(),
      tabId: tab.id,
    });
  }
});


function getDateKey(isoTimestamp) {
  const d = new Date(isoTimestamp);

  // Extract local year, month, and day
  const y = d.getFullYear();
  // Months are 0-indexed in JS, so we add 1. padStart ensures "5" becomes "05"
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");

  return `${y}-${m}-${day}`;
}

function getDomain(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

async function saveNote({
  selectedText,
  sourceUrl,
  sourceTitle,
  timestamp,
  tabId,
}) {
  const result = await chrome.storage.local.get(["notes"]);
  const notes = result.notes || [];

  notes.push({
    id: Date.now(),
    text: selectedText,
    url: sourceUrl,
    title: sourceTitle,
    domain: getDomain(sourceUrl),
    timestamp,
  });

  await chrome.storage.local.set({ notes });

  // Notify the open notes page to refresh (if open)
  const notesUrl = chrome.runtime.getURL("notes.html");
  const notesTabs = await chrome.tabs.query({ url: notesUrl });
  for (const t of notesTabs) {
    chrome.tabs.sendMessage(t.id, { action: "refreshNotes" }).catch(() => {});
  }

  // Toast on the source page
  chrome.tabs
    .sendMessage(tabId, { action: "showToast", message: "✅ Saved to Notes!" })
    .catch(() => {});
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "getNotes") {
    chrome.storage.local.get(["notes"]).then((result) => {
      sendResponse({ notes: result.notes || [] });
    });
    return true;
  }

  if (message.action === "clearNotes") {
    chrome.storage.local
      .set({ notes: [] })
      .then(() => sendResponse({ success: true }));
    return true;
  }

  if (message.action === "deleteNote") {
    chrome.storage.local.get(["notes"]).then((result) => {
      const notes = (result.notes || []).filter((n) => n.id !== message.id);
      chrome.storage.local
        .set({ notes })
        .then(() => sendResponse({ success: true }));
    });
    return true;
  }

  if (message.action === "getTypedNotes") {
    chrome.storage.local.get(["typedNotes"]).then((result) => {
      sendResponse({ notes: result.typedNotes || [] });
    });
    return true;
  }

  if (message.action === "saveTypedNote") {
    chrome.storage.local.get(["typedNotes"]).then((result) => {
      const typedNotes = result.typedNotes || [];
      typedNotes.push(message.note);
      chrome.storage.local
        .set({ typedNotes })
        .then(() => sendResponse({ success: true }));
    });
    return true;
  }

  if (message.action === "updateTypedNote") {
    chrome.storage.local.get(["typedNotes"]).then((result) => {
      const typedNotes = result.typedNotes || [];
      const idx = typedNotes.findIndex((n) => n.id === message.id);
      if (idx === -1) {
        sendResponse({ success: false, error: "not found" });
        return;
      }
      // Keep id / timestamp / source info; only overwrite the edited fields
      typedNotes[idx] = {
        ...typedNotes[idx],
        ...message.updates,
        updatedAt: new Date().toISOString(),
      };
      chrome.storage.local
        .set({ typedNotes })
        .then(() => sendResponse({ success: true }));
    });
    return true;
  }

  if (message.action === "deleteTypedNote") {
    chrome.storage.local.get(["typedNotes"]).then((result) => {
      const typedNotes = (result.typedNotes || []).filter(
        (n) => n.id !== message.id
      );
      chrome.storage.local
        .set({ typedNotes })
        .then(() => sendResponse({ success: true }));
    });
    return true;
  }

  if (message.action === "clearTypedNotes") {
    chrome.storage.local
      .set({ typedNotes: [] })
      .then(() => sendResponse({ success: true }));
    return true;
  }

  if (message.action === "exportNotes") {
    chrome.storage.local.get(["notes"]).then((result) => {
      const markdown = buildMarkdown(result.notes || []);
      downloadMarkdown(markdown);
      sendResponse({ success: true });
    });
    return true;
  }
});

function buildMarkdown(notes) {
  const header = `# 📝 My Saved Notes\n\n_Exported on ${new Date().toLocaleString()}_\n\n`;
  if (notes.length === 0) return header + "_No notes saved yet._\n";

  const grouped = {};
  for (const note of notes) {
    const dateKey = getDateKey(note.timestamp);
    const domain = note.domain || getDomain(note.url);
    if (!grouped[dateKey]) grouped[dateKey] = {};
    if (!grouped[dateKey][domain]) grouped[dateKey][domain] = [];
    grouped[dateKey][domain].push(note);
  }

  const sortedDates = Object.keys(grouped).sort();
  const sections = [];

  for (const dateKey of sortedDates) {
    const dateLabel = formatDateLabel(dateKey);
    let dateSection = `## 📅 ${dateLabel}\n`;
    for (const domain of Object.keys(grouped[dateKey])) {
      const domainNotes = grouped[dateKey][domain];
      dateSection += `\n### 🌐 ${domain}\n`;
      domainNotes.forEach((note, idx) => {
        const timeLabel = formatTime(note.timestamp);
        const sourceLink = `[${note.title || note.url}](${note.url})`;
        const quoteLines = note.text
          .split("\n")
          .map((l) => `> ${l}`)
          .join("\n");
        dateSection += `\n**Note ${idx + 1}** · ${timeLabel}  \n`;
        dateSection += `**Source:** ${sourceLink}\n\n`;
        dateSection += `${quoteLines}\n`;
      });
    }
    sections.push(dateSection);
  }
  return header + sections.join("\n---\n\n") + "\n";
}

function formatDateLabel(dateKey) {
  const d = new Date(dateKey + "T00:00:00");
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatTime(iso) {
  return new Date(iso).toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function downloadMarkdown(content) {
  const blob = new Blob([content], { type: "text/markdown" });
  const url = URL.createObjectURL(blob);
  chrome.downloads.download({
    url,
    filename: `notes-${new Date().toISOString().slice(0, 10)}.md`,
    saveAs: false,
  });
}