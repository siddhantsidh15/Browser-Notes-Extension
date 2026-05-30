// background.js - Service worker for Save to Notes extension

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: "saveToNotes",
    title: "Save to Notes",
    contexts: ["selection"],
  });
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
