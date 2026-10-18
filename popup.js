// ── Mode: dropdown popup vs. docked side panel ───────────────────────────────
// sidepanel.html redirects here with ?mode=panel
const IS_PANEL = new URLSearchParams(location.search).get("mode") === "panel";
document.documentElement.classList.toggle("is-panel", IS_PANEL);

// ── DOM refs ──────────────────────────────────────────────────────────────────
const notesList = document.getElementById("notesList");
const searchInput = document.getElementById("searchInput");
const themeBtn = document.getElementById("themeBtn");
const openFullBtn = document.getElementById("openFullBtn");
const storageText = document.getElementById("storageText");
const storageBar = document.getElementById("storageBar");
const noteCount = document.getElementById("noteCount");
const paginationEl = document.getElementById("pagination");
const toast = document.getElementById("toast");
const caseSensitiveBtn = document.getElementById("caseSensitiveBtn");
const copyAllBtn = document.getElementById("copyAllBtn");

const tabBtns = document.querySelectorAll(".tab-btn");
const tabPanels = document.querySelectorAll(".tab-panel");
const notepadTextarea = document.getElementById("notepadTextarea");
const notepadTarget = document.getElementById("notepadTarget");
const notepadPreview = document.getElementById("notepadPreview");
const saveNoteBtn = document.getElementById("saveNoteBtn");
const typedNotesList = document.getElementById("typedNotesList");
const typedFilterEl = document.getElementById("typedFilter");
const typedCountEl = document.getElementById("typedCount");
const typedPaginationEl = document.getElementById("typedPagination");
const nbDropdown = document.getElementById("nbDropdown");
const nbTrigger = document.getElementById("nbTrigger");
const nbTriggerLabel = document.getElementById("nbTriggerLabel");
const nbMenu = document.getElementById("nbMenu");
const editBadge = document.getElementById("editBadge");
const cancelEditBtn = document.getElementById("cancelEditBtn");

// ── State ─────────────────────────────────────────────────────────────────────
let allNotes = [];
let currentFilteredNotes = [];
let currentPage = 1;
const PER_PAGE = 10;
let isDark = true;
let isCaseSensitive = false;
let allTypedNotes = [];
let activeTabInfo = null; // { url, title, domain } of the page focused when popup opened
let draftImages = {}; // id -> base64 data URL, for images pasted into the notepad this session

// The notepad is a contenteditable that shows [[img:…]] tokens as inline thumbnails
// but behaves like a <textarea> (.value, .selectionStart, …) for everything below.
RichEditor.attach(notepadTextarea, { getImage: (id) => draftImages[id] });
const TYPED_PER_PAGE = 10;
let typedPage = 1;
let typedFilter = "all"; // "all" | "none" | <notebook id>
let refreshFindSoon = null; // set up with the notepad find bar below
let notebooks = []; // [{ id, name }]
let activeNotebookId = null; // notebook new notes are saved into
let editingNoteId = null; // id of the typed note being edited, or null

// ── SVG Icons ─────────────────────────────────────────────────────────────────
const COPY_SVG = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>`;
const DEL_SVG = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/></svg>`;

const EDIT_SVG = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>`;

if (copyAllBtn) {
  copyAllBtn.innerHTML = COPY_SVG;
  copyAllBtn.disabled = true;
}

// ── Prefs ─────────────────────────────────────────────────────────────────────
async function loadPrefs() {
  return new Promise((r) =>
    chrome.storage.local.get(["prefs"], (d) => r(d.prefs || {}))
  );
}
async function savePrefs(patch) {
  const p = await loadPrefs();
  chrome.storage.local.set({ prefs: { ...p, ...patch } });
}

// ── Utils ─────────────────────────────────────────────────────────────────────
function esc(str = "") {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// ── Markdown (Notepad) ───────────────────────────────────────────────────────
// Central place for typed-note formatting rules. Add new rules to the `rules`
// array to extend supported syntax — each rule runs in order against
// already-HTML-escaped text, so replacement strings may safely contain tags.
const Markdown = {
  rules: [
    // Code block: [Code]...[Code] — case-insensitive, checked first so
    // heading / underline rules don't fire inside a code block.
    {
      name: "codeBlock",
      pattern: /\[code\]([\s\S]*?)\[code\]/gi,
      render: (_match, code) =>
        `<pre class="md-code"><code>${code}</code></pre>`,
    },
    // Pasted image placeholder: [[img:<id>]] — the actual base64 data lives
    // in a separate `images` map (never inline in the text itself), passed
    // in as the last argument by render() below.
    {
      name: "image",
      pattern: /\[\[img:([\w-]+)\]\]/g,
      render: (_match, id, _offset, _str, images) => {
        const src = images && images[id];
        if (!src) return "";
        return `<img class="md-image" src="${src}" alt="pasted image" />`;
      },
    },
    // >C text >C → boxed rectangle (the >C markers are omitted from output)
    {
      name: "box",
      pattern: /&gt;C([\s\S]*?)&gt;C/g,
      render: (_match, inner) => `<div class="md-box">${inner.trim()}</div>`,
    },
    // Headings — order matters: longest marker first so "### x" isn't
    // partially matched by the "##" or "#" rule.
    {
      name: "h1",
      pattern: /^###[ \t]+(.+)$/gm,
      render: (_match, text) => `<h1>${text}</h1>`,
    },
    {
      name: "h2",
      pattern: /^##[ \t]+(.+)$/gm,
      render: (_match, text) => `<h2>${text}</h2>`,
    },
    {
      name: "h3",
      pattern: /^#[ \t]+(.+)$/gm,
      render: (_match, text) => `<h3>${text}</h3>`,
    },
    // :text: → underline
    {
      name: "underline",
      pattern: /:([^:\n]+):/g,
      render: (_match, text) => `<u>${text}</u>`,
    },
  ],

  // Converts raw typed-note text into safe HTML. `images` maps
  // [[img:<id>]] placeholders to their base64 data URLs.
  render(rawText, images = {}) {
    let html = esc(rawText || "");
    for (const rule of this.rules) {
      html = html.replace(rule.pattern, (...args) =>
        rule.render(...args, images)
      );
    }
    return html;
  },
};

function faviconUrl(domain) {
  return `https://www.google.com/s2/favicons?domain=${domain}&sz=32`;
}

function getDomain(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function getDateKey(ts) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function formatDateHeading(dateKey) {
  const nd = new Date(dateKey + "T00:00:00");
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const yest = new Date(today);
  yest.setDate(today.getDate() - 1);
  if (nd.toDateString() === today.toDateString()) return "Today";
  if (nd.toDateString() === yest.toDateString()) return "Yesterday";
  return nd.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function showToast(msg, dur = 1800) {
  toast.textContent = msg;
  toast.classList.add("show");
  setTimeout(() => toast.classList.remove("show"), dur);
}

// ── Grouping ──────────────────────────────────────────────────────────────────
function groupNotes(notes) {
  const map = {};
  for (const n of notes) {
    const dk = getDateKey(n.timestamp);
    const domain = n.domain || getDomain(n.url);
    if (!map[dk]) map[dk] = {};
    if (!map[dk][domain]) map[dk][domain] = [];
    map[dk][domain].push(n);
  }
  return Object.keys(map)
    .sort()
    .reverse()
    .map((dk) => ({
      dateKey: dk,
      domains: Object.keys(map[dk]).map((d) => ({
        domain: d,
        notes: map[dk][d],
      })),
    }));
}

// ── Render ────────────────────────────────────────────────────────────────────
function render(pageNotes, totalFiltered) {
  noteCount.textContent = totalFiltered;

  if (pageNotes.length === 0) {
    notesList.innerHTML = `
      <div class="empty">
        <div class="empty-icon">✦</div>
        <div class="empty-text">No notes here yet.</div>
      </div>`;
    paginationEl.style.display = "none";
    return;
  }

  const grouped = groupNotes(pageNotes);
  let html = "";

  for (const group of grouped) {
    html += `<div class="date-group">
      <div class="date-heading">${formatDateHeading(group.dateKey)}</div>`;

    for (const { domain, notes } of group.domains) {
      html += `<div class="domain-row">
        <img class="domain-favicon" src="${faviconUrl(domain)}" alt="" />
        <span class="domain-label">${esc(domain)}</span>
      </div>`;

      for (const note of notes) {
        const time = new Date(note.timestamp).toLocaleTimeString(undefined, {
          hour: "2-digit",
          minute: "2-digit",
        });

        // Calculate dot states based on how many times the note was copied
        const count = note.copyCount || 0;
        const d1 = count >= 1 ? "active" : "";
        const d2 = count >= 2 ? "active" : "";
        const d3 = count >= 3 ? "active" : "";

        html += `
        <div class="note-card" data-id="${note.id}">
          <div class="note-top">
            <div style="display: flex; align-items: center;">
              <span class="note-time">${time}</span>
              <div class="copy-indicators" title="Copied ${count} times">
                <div class="copy-dot ${d1}"></div>
                <div class="copy-dot ${d2}"></div>
                <div class="copy-dot ${d3}"></div>
              </div>
            </div>
            <a class="note-source" href="${esc(note.url)}" target="_blank">source ↗</a>
          </div>
          <p class="note-body">${esc(note.text)}</p>
          <div class="note-actions">
            <button class="card-btn copy-btn" data-id="${note.id}" title="Copy">${COPY_SVG}</button>
            <button class="card-btn del delete-btn" data-id="${note.id}" title="Delete">${DEL_SVG}</button>
          </div>
        </div>`;
      }
    }
    html += `</div>`;
  }

  notesList.innerHTML = html;
  attachCardListeners();
  renderPagination(totalFiltered);
}

// ── Pagination ─────────────────────────────────────────────────────────────────
function renderPagination(total) {
  const pages = Math.ceil(total / PER_PAGE);
  if (pages <= 1) {
    paginationEl.style.display = "none";
    return;
  }

  paginationEl.style.display = "flex";
  paginationEl.innerHTML = `
    <button class="pg-btn" id="prevPage" ${currentPage === 1 ? "disabled" : ""}>← prev</button>
    <span class="pg-info">${currentPage} / ${pages}</span>
    <button class="pg-btn" id="nextPage" ${currentPage === pages ? "disabled" : ""}>next →</button>`;

  document.getElementById("prevPage")?.addEventListener("click", () => {
    if (currentPage > 1) {
      currentPage--;
      filterAndRender();
      notesList.scrollTop = 0;
    }
  });
  document.getElementById("nextPage")?.addEventListener("click", () => {
    if (currentPage < pages) {
      currentPage++;
      filterAndRender();
      notesList.scrollTop = 0;
    }
  });
}

// ── Filter & Render ───────────────────────────────────────────────────────────
function filterAndRender() {
  const query = searchInput.value.trim();

  if (copyAllBtn) {
    copyAllBtn.disabled = query === "";
  }

  currentFilteredNotes = query
    ? allNotes.filter((n) => {
        const text = n.text || "";
        const title = n.title || "";
        const domain = n.domain || "";
        const url = n.url || "";

        if (isCaseSensitive) {
          return (
            text.includes(query) ||
            title.includes(query) ||
            domain.includes(query) ||
            url.includes(query)
          );
        } else {
          const q = query.toLowerCase();
          return (
            text.toLowerCase().includes(q) ||
            title.toLowerCase().includes(q) ||
            domain.toLowerCase().includes(q) ||
            url.toLowerCase().includes(q)
          );
        }
      })
    : allNotes;

  const totalPages = Math.max(
    1,
    Math.ceil(currentFilteredNotes.length / PER_PAGE)
  );
  if (currentPage > totalPages) currentPage = totalPages;

  const start = (currentPage - 1) * PER_PAGE;
  render(
    currentFilteredNotes.slice(start, start + PER_PAGE),
    currentFilteredNotes.length
  );
}

// ── Bulk Actions ──────────────────────────────────────────────────────────────
if (copyAllBtn) {
  copyAllBtn.addEventListener("click", () => {
    if (currentFilteredNotes.length === 0) {
      showToast("No notes to copy");
      return;
    }

    const compiledText = currentFilteredNotes.map((n) => n.text).join("\n\n");

    navigator.clipboard
      .writeText(compiledText)
      .then(() => {
        showToast(`Copied ${currentFilteredNotes.length} notes`);
      })
      .catch(() => {
        showToast("Copy failed");
      });
  });
}

if (caseSensitiveBtn) {
  caseSensitiveBtn.addEventListener("click", () => {
    isCaseSensitive = !isCaseSensitive;
    caseSensitiveBtn.classList.toggle("active", isCaseSensitive);
    currentPage = 1;
    filterAndRender();
  });
}

function loadNotes() {
  chrome.runtime.sendMessage({ action: "getNotes" }, (response) => {
    allNotes = (response?.notes || []).reverse();
    filterAndRender();
    updateStorage();
  });
}

// ── Card Actions ──────────────────────────────────────────────────────────────
function attachCardListeners() {
  document.querySelectorAll(".delete-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = parseInt(btn.dataset.id);
      chrome.runtime.sendMessage({ action: "deleteNote", id }, () => {
        loadNotes();
        showToast("deleted");
      });
    });
  });

  document.querySelectorAll(".copy-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = parseInt(btn.dataset.id);
      const note = allNotes.find((n) => n.id === id);

      if (note) {
        navigator.clipboard.writeText(note.text).then(() => {
          showToast("copied");

          // Increment the copy counter in memory
          note.copyCount = (note.copyCount || 0) + 1;

          // Update the UI immediately without fully re-rendering the list
          const card = document.querySelector(`.note-card[data-id="${id}"]`);
          if (card) {
            const dots = card.querySelectorAll(".copy-dot");
            if (note.copyCount >= 1 && dots[0]) dots[0].classList.add("active");
            if (note.copyCount >= 2 && dots[1]) dots[1].classList.add("active");
            if (note.copyCount >= 3 && dots[2]) dots[2].classList.add("active");
            card.querySelector(".copy-indicators").title =
              `Copied ${note.copyCount} times`;
          }

          // Save the updated copy count permanently to Chrome Storage
          chrome.storage.local.get(["notes"], (res) => {
            const dbNotes = res.notes || [];
            const dbNote = dbNotes.find((n) => n.id === id);
            if (dbNote) {
              dbNote.copyCount = note.copyCount;
              chrome.storage.local.set({ notes: dbNotes });
            }
          });
        });
      }
    });
  });
}

function debounce(fn, delay) {
  let timer;
  return function (...args) {
    clearTimeout(timer);
    timer = setTimeout(() => fn.apply(this, args), delay);
  };
}

// ── Search ────────────────────────────────────────────────────────────────────
searchInput.addEventListener(
  "input",
  debounce(() => {
    currentPage = 1;
    filterAndRender();
  }, 200)
);

// ── Full View ─────────────────────────────────────────────────────────────────
async function openFullNotesView() {
  const url = chrome.runtime.getURL("notes.html");
  const existing = await chrome.tabs.query({ url });
  if (existing.length > 0) {
    await chrome.tabs.update(existing[0].id, { active: true });
    await chrome.windows.update(existing[0].windowId, { focused: true });
  } else {
    await chrome.tabs.create({ url });
  }
  window.close();
}

openFullBtn.addEventListener("click", openFullNotesView);

// ── Theme ─────────────────────────────────────────────────────────────────────
function applyTheme(dark) {
  isDark = dark;
  document.documentElement.dataset.theme = dark ? "dark" : "light";
  themeBtn.textContent = dark ? "☀" : "☽";
  themeBtn.title = dark ? "Light mode" : "Dark mode";
}

themeBtn.addEventListener("click", () => {
  applyTheme(!isDark);
  savePrefs({ theme: isDark ? "dark" : "light" });
});

// ── Dock toggle ───────────────────────────────────────────────────────────────
// ON  -> toolbar icon / Cmd+M open the docked side panel (see background.js)
// OFF -> toolbar icon / Cmd+M open the normal dropdown popup
const DOCK_KEY = "dockMode";
const dockToggle = document.getElementById("dockToggle");

async function initDockToggle() {
  const r = await chrome.storage.local.get([DOCK_KEY]);
  dockToggle.checked = r[DOCK_KEY] === true;
}

dockToggle.addEventListener("change", async () => {
  const on = dockToggle.checked;

  if (!on) {
    // Turning it off: save, then close the panel. Next click gives the popup back.
    await chrome.storage.local.set({ [DOCK_KEY]: false });
    window.close();
    return;
  }

  // Turning it on from the dropdown popup: dock right away.
  // Start the lookup + save first so sidePanel.open() still counts as a user gesture.
  const tabQuery = chrome.tabs.query({ active: true, currentWindow: true });
  chrome.storage.local.set({ [DOCK_KEY]: true });
  try {
    const [tab] = await tabQuery;
    chrome.sidePanel.setOptions({
      tabId: tab.id,
      path: "sidepanel.html",
      enabled: true,
    });
    await chrome.sidePanel.open({ tabId: tab.id });
    window.close();
  } catch (err) {
    console.error("Could not open side panel:", err);
    showToast("Dock enabled — press ⌘M / Ctrl+M to open", 2600);
  }
});

initDockToggle();

if (IS_PANEL) {
  // The panel is tab-specific (see background.js): Chrome hides it when you
  // switch to another tab and shows it again when you come back to this one.

  // The panel stays open while you keep selecting text on the page, so pick up
  // notes saved through the right-click menu without needing to reopen it.
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local" || !changes.notes) return;
    const before = changes.notes.oldValue?.length ?? 0;
    const after = changes.notes.newValue?.length ?? 0;
    if (after > before) loadNotes();
  });
}

// ── Storage ───────────────────────────────────────────────────────────────────
const STORAGE_MAX_KB = 51200; // Display reference: 50 MB (actual limit is unlimited via unlimitedStorage permission)

function updateStorage() {
  chrome.storage.local.getBytesInUse(null, (bytes) => {
    if (chrome.runtime.lastError || bytes === undefined) return;
    const kb = bytes / 1024;
    const mb = kb / 1024;
    storageText.textContent =
      mb >= 1 ? `${mb.toFixed(2)} MB` : `${kb.toFixed(1)} KB`;
    const pct = Math.min(100, (kb / STORAGE_MAX_KB) * 100);
    storageBar.style.width = pct + "%";
  });
}

// ── Tabs ──────────────────────────────────────────────────────────────────────
function focusNotepad() {
  if (!notepadTextarea) return;
  notepadTextarea.focus();
}

function switchTab(tabName) {
  tabBtns.forEach((btn) =>
    btn.classList.toggle("active", btn.dataset.tab === tabName)
  );
  tabPanels.forEach((panel) =>
    panel.classList.toggle("active", panel.id === `panel-${tabName}`)
  );
  if (tabName === "typed") loadTypedNotes();
  if (tabName === "notepad") focusNotepad();
}

tabBtns.forEach((btn) => {
  btn.addEventListener("click", () => switchTab(btn.dataset.tab));
});

// ── Notepad (Tab 2) ───────────────────────────────────────────────────────────
// Finds the page that was focused in the browser when the popup was opened —
// that's "the website the note was taken from".
async function detectActiveTab() {
  try {
    const [tab] = await chrome.tabs.query({
      active: true,
      currentWindow: true,
    });
    if (!tab) return null;
    return {
      url: tab.url || "",
      title: tab.title || "",
      domain: getDomain(tab.url || ""),
    };
  } catch {
    return null;
  }
}

function renderNotepadTarget() {
  if (!notepadTarget) return;
  // While editing, the note keeps its original source, so don't claim otherwise
  notepadTarget.textContent =
    editingNoteId === null && activeTabInfo?.domain
      ? `saving from ${activeTabInfo.domain}`
      : "";
}

// ── Live preview ──────────────────────────────────────────────────────────────
function updateNotepadPreview() {
  notepadTextarea?.refreshImages?.(); // (re)attach image data to the inline thumbnails
  if (refreshFindSoon) refreshFindSoon();
  if (!notepadPreview) return;
  const text = notepadTextarea.value;
  if (!text.trim()) {
    notepadPreview.innerHTML = `<span class="notepad-preview-placeholder">Nothing to preview yet…</span>`;
    return;
  }
  notepadPreview.innerHTML = Markdown.render(text, draftImages);
}

// ── Draft persistence ─────────────────────────────────────────────────────────
// Auto-save the notepad draft and cursor position to chrome.storage.local so it
// survives the popup being closed without saving.
const DRAFT_KEY = "notepadDraft";

function saveDraft() {
  if (!notepadTextarea) return;
  chrome.storage.local.set({
    [DRAFT_KEY]: {
      text: notepadTextarea.value,
      start: notepadTextarea.selectionStart,
      end: notepadTextarea.selectionEnd,
      editingId: editingNoteId,
      notebookId: editingNoteId !== null ? activeNotebookId : undefined,
    },
  });
}

// Images live in their own key and are only written when they change
// (they're far bigger than the text, which is saved on every keystroke).
const DRAFT_IMAGES_KEY = "notepadDraftImages";

function saveDraftImages() {
  chrome.storage.local.set({
    [DRAFT_IMAGES_KEY]: pruneImages(notepadTextarea.value, draftImages),
  });
}

function clearDraft() {
  chrome.storage.local.remove([DRAFT_KEY, DRAFT_IMAGES_KEY]);
}

function loadDraft(callback) {
  chrome.storage.local.get([DRAFT_KEY], (result) => {
    const raw = result[DRAFT_KEY];
    if (typeof raw === "string") {
      callback({ text: raw, start: raw.length, end: raw.length });
    } else if (raw && typeof raw === "object") {
      const text = raw.text || "";
      const start = typeof raw.start === "number" ? raw.start : text.length;
      const end = typeof raw.end === "number" ? raw.end : text.length;
      callback({
        text,
        start,
        end,
        editingId: raw.editingId ?? null,
        notebookId: raw.notebookId,
      });
    } else {
      callback({ text: "", start: 0, end: 0 });
    }
  });
}

if (notepadTextarea) {
  notepadTextarea.addEventListener("input", () => {
    updateNotepadPreview();
    saveDraft();
  });
  notepadTextarea.addEventListener("keyup", saveDraft);
  notepadTextarea.addEventListener("mouseup", saveDraft);
  notepadTextarea.addEventListener("select", saveDraft);
}

// ── Auto-closing bracket pairs ────────────────────────────────────────────────
// Works in the notepad textarea only. Behaviour:
//  • Typing an opener  →  inserts pair, cursor lands between them.
//  • Selecting text + typing opener  →  wraps the selection.
//  • Typing a closer when it's already the next char  →  skip over (no double).
const BRACKET_PAIRS = { "(": ")", "{": "}", "[": "]", "<": ">" };
// Quotes close themselves too (" ' `). Skipped right after/before a letter or digit
// so apostrophes (don't, it's) and closing quotes type normally.
const QUOTE_CHARS = new Set(['"', "'", "`"]);
const isWordChar = (c) => !!c && /[\p{L}\p{N}_]/u.test(c);
const CLOSERS = new Set(Object.values(BRACKET_PAIRS));

if (notepadTextarea) {
  notepadTextarea.addEventListener("keydown", (e) => {
    // Symbol repetition expansion (e.g. -*5 + Space/Enter expands to -----)
    if (e.key === " " || e.key === "Enter") {
      const ta = notepadTextarea;
      if (ta.selectionStart === ta.selectionEnd) {
        const pos = ta.selectionStart;
        const textBefore = ta.value.slice(0, pos);
        // Matches non-whitespace character before '*' followed by digits at the end of textBefore
        const match =
          textBefore.match(/(\S)\*(\d+)$/) || textBefore.match(/(\S)\x(\d+)$/);
        if (match) {
          e.preventDefault();
          const symbol = match[1];
          const count = parseInt(match[2], 10);
          const repeatStr = symbol.repeat(count);
          const startReplace = pos - match[0].length;
          ta.value =
            ta.value.slice(0, startReplace) + repeatStr + ta.value.slice(pos);
          ta.selectionStart = ta.selectionEnd = startReplace + repeatStr.length;
          saveDraft();
          updateNotepadPreview();
          return;
        }
      }
    }

    // Tab → insert indentation instead of moving focus
    if (e.key === "Tab") {
      e.preventDefault();
      const ta = notepadTextarea;
      const start = ta.selectionStart;
      const end = ta.selectionEnd;
      const indent = "  "; // 2-space indentation
      ta.value = ta.value.slice(0, start) + indent + ta.value.slice(end);
      ta.selectionStart = ta.selectionEnd = start + indent.length;
      saveDraft();
      updateNotepadPreview();
      return;
    }

    const closer = BRACKET_PAIRS[e.key];

    if (closer) {
      // Opening bracket pressed
      e.preventDefault();
      const ta = notepadTextarea;
      const start = ta.selectionStart;
      const end = ta.selectionEnd;
      const val = ta.value;
      const hasSelection = start !== end;

      if (hasSelection) {
        // Wrap the selected text
        ta.value =
          val.slice(0, start) +
          e.key +
          val.slice(start, end) +
          closer +
          val.slice(end);
        ta.selectionStart = start + 1;
        ta.selectionEnd = end + 1;
      } else {
        // Insert pair, park cursor in the middle
        ta.value = val.slice(0, start) + e.key + closer + val.slice(start);
        ta.selectionStart = ta.selectionEnd = start + 1;
      }
      saveDraft();
      updateNotepadPreview();
      return;
    }

    if (
      QUOTE_CHARS.has(e.key) &&
      !e.metaKey &&
      !e.ctrlKey &&
      !e.altKey &&
      !e.isComposing
    ) {
      const ta = notepadTextarea;
      const start = ta.selectionStart;
      const end = ta.selectionEnd;
      const val = ta.value;
      const q = e.key;

      if (start !== end) {
        // Wrap the selected text in quotes
        e.preventDefault();
        ta.value =
          val.slice(0, start) + q + val.slice(start, end) + q + val.slice(end);
        ta.selectionStart = start + 1;
        ta.selectionEnd = end + 1;
        saveDraft();
        updateNotepadPreview();
        return;
      }
      if (val[start] === q) {
        // Closing quote already there — type over it
        e.preventDefault();
        ta.selectionStart = ta.selectionEnd = start + 1;
        return;
      }
      if (!isWordChar(val[start - 1]) && !isWordChar(val[start])) {
        e.preventDefault();
        ta.value = val.slice(0, start) + q + q + val.slice(start);
        ta.selectionStart = ta.selectionEnd = start + 1;
        saveDraft();
        updateNotepadPreview();
        return;
      }
      // otherwise (apostrophe / closing quote after a word): normal typing
    }

    if (CLOSERS.has(e.key)) {
      // Closing bracket pressed — skip over if it's already the next char
      const ta = notepadTextarea;
      if (
        ta.selectionStart === ta.selectionEnd &&
        ta.value[ta.selectionStart] === e.key
      ) {
        e.preventDefault();
        ta.selectionStart = ta.selectionEnd = ta.selectionStart + 1;
      }
    }
  });
}

// ── Insert text at the current cursor position, replacing any selection ──────
function insertAtCursor(el, text) {
  const start = el.selectionStart ?? el.value.length;
  const end = el.selectionEnd ?? el.value.length;
  el.value = el.value.slice(0, start) + text + el.value.slice(end);
  const pos = start + text.length;
  el.selectionStart = el.selectionEnd = pos;
  el.focus();
  saveDraft();
}

// ── Images: compression, paste, page snapshot ────────────────────────────────
// Every image (pasted or snapshotted) is downscaled and re-encoded as a small
// WebP before it is stored. Tweak these two numbers to trade quality for size.
const IMG_MAX_DIM = 1000; // longest side in px; smaller images are never enlarged
const IMG_QUALITY = 0.5; // WebP quality, 0–1

// A second, sharper copy of every image is kept ONLY for exports (PDF / Markdown).
// It lives under its own storage key ("hd:<id>"), so notes, lists and the editor
// keep using the small copy and stay fast.
const IMG_HD_MAX_DIM = 1920;
const IMG_HD_QUALITY = 0.8;

function encodeImage(src, maxDim, quality) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(
        1,
        maxDim / Math.max(img.naturalWidth, img.naturalHeight)
      );
      const w = Math.max(1, Math.round(img.naturalWidth * scale));
      const h = Math.max(1, Math.round(img.naturalHeight * scale));
      const c = document.createElement("canvas");
      c.width = w;
      c.height = h;
      const ctx = c.getContext("2d");
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(img, 0, 0, w, h);
      let out = c.toDataURL("image/webp", quality);
      if (!out.startsWith("data:image/webp"))
        out = c.toDataURL("image/jpeg", quality);
      // Tiny images (icons etc.) can come out bigger — keep the original then
      resolve(scale === 1 && out.length >= src.length ? src : out);
    };
    img.onerror = () => reject(new Error("Could not decode image"));
    img.src = src;
  });
}

// Stored one write at a time so the small "hdIndex" list never gets clobbered
let hdQueue = Promise.resolve();
function storeHdImage(id, dataUrl) {
  hdQueue = hdQueue
    .then(async () => {
      const r = await chrome.storage.local.get(["hdIndex"]);
      const index = r.hdIndex || [];
      if (!index.includes(id)) index.push(id);
      await chrome.storage.local.set({ ["hd:" + id]: dataUrl, hdIndex: index });
    })
    .catch((err) => console.error("Could not store export image:", err));
  return hdQueue;
}

// Drop export copies whose image no longer appears in any note or the current draft.
// Only ever called once the typed notes have actually loaded.
async function sweepHdImages() {
  const r = await chrome.storage.local.get(["hdIndex", DRAFT_IMAGES_KEY]);
  const index = r.hdIndex || [];
  if (!index.length) return;
  const used = new Set(Object.keys(draftImages));
  Object.keys(r[DRAFT_IMAGES_KEY] || {}).forEach((id) => used.add(id));
  for (const n of allTypedNotes)
    Object.keys(n.images || {}).forEach((id) => used.add(id));
  const orphans = index.filter((id) => !used.has(id));
  if (!orphans.length) return;
  await chrome.storage.local.remove(orphans.map((id) => "hd:" + id));
  await chrome.storage.local.set({
    hdIndex: index.filter((id) => used.has(id)),
  });
}

const kbOf = (dataUrl) =>
  Math.max(1, Math.round((dataUrl.length * 0.75) / 1024));

// Compress, store in draftImages, and drop a [[img:<id>]] token into the text.
// The editor shows the token as an inline thumbnail.
async function addImageToDraft(src, { label = "Image" } = {}) {
  const [compressed, hd] = await Promise.all([
    encodeImage(src, IMG_MAX_DIM, IMG_QUALITY),
    encodeImage(src, IMG_HD_MAX_DIM, IMG_HD_QUALITY),
  ]);
  const id = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
  draftImages[id] = compressed;
  if (hd.length > compressed.length * 1.15) await storeHdImage(id, hd); // export copy
  insertAtCursor(notepadTextarea, `[[img:${id}]]`); // exactly where the cursor is
  notepadTextarea.keepCaretVisible();
  saveDraftImages();
  updateNotepadPreview();
  showToast(`${label} added · ${kbOf(compressed)} KB`);
}

if (notepadTextarea) {
  notepadTextarea.addEventListener("paste", (e) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (const item of items) {
      if (!item.type.startsWith("image/")) continue;
      const file = item.getAsFile();
      if (!file) continue;
      e.preventDefault();
      const reader = new FileReader();
      reader.onload = () =>
        addImageToDraft(reader.result).catch(() =>
          showToast("Couldn't add image")
        );
      reader.readAsDataURL(file);
      break; // one image per paste
    }
  });
}

// ── Snapshot of the page you're on ────────────────────────────────────────────
// Button, Cmd/Ctrl+Shift+S inside the popup/panel, and the global shortcut from
// background.js (works while the page itself has focus) all end up here.
const snapshotBtn = document.getElementById("snapshotBtn");
const isMac = /Mac|iPhone|iPad/.test(navigator.platform);
const SNAP_KEYS = isMac ? "⌘⇧S" : "Ctrl+Shift+S";
let snapBusy = false;

if (snapshotBtn) {
  snapshotBtn.title = `Snapshot this page into the note (${SNAP_KEYS})`;
  const hint = document.getElementById("snapKeyHint");
  if (hint) hint.textContent = SNAP_KEYS;
}

async function takeSnapshot() {
  if (snapBusy) return; // Chrome also rate-limits captureVisibleTab
  snapBusy = true;
  if (snapshotBtn) snapshotBtn.disabled = true;
  try {
    const [tab] = await chrome.tabs.query({
      active: true,
      currentWindow: true,
    });
    if (!tab) throw new Error("No active tab");
    const shot = await chrome.tabs.captureVisibleTab(tab.windowId, {
      format: "jpeg",
      quality: 90,
    });
    await addImageToDraft(shot, { label: "Snapshot" });
  } catch (err) {
    console.error("Snapshot failed:", err);
    showToast("Can't snapshot this page");
  } finally {
    snapBusy = false;
    if (snapshotBtn) snapshotBtn.disabled = false;
  }
}

const notepadActive = () =>
  document.getElementById("panel-notepad")?.classList.contains("active");

if (snapshotBtn) snapshotBtn.addEventListener("click", takeSnapshot);

document.addEventListener("keydown", (e) => {
  if (
    (e.metaKey || e.ctrlKey) &&
    e.shiftKey &&
    !e.altKey &&
    e.code === "KeyS" &&
    notepadActive()
  ) {
    e.preventDefault(); // also stops the browser-level command from firing twice
    takeSnapshot();
  }
});

chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.action !== "takeSnapshot") return;
  if (!notepadActive()) switchTab("notepad");
  takeSnapshot();
});

// Only keep images whose [[img:<id>]] token still appears in the given text —
// drops anything the user pasted then deleted before saving.
function pruneImages(text, images) {
  const used = {};
  const re = /\[\[img:([\w-]+)\]\]/g;
  let m;
  while ((m = re.exec(text))) {
    if (images[m[1]]) used[m[1]] = images[m[1]];
  }
  return used;
}

if (saveNoteBtn) {
  saveNoteBtn.addEventListener("click", async () => {
    const text = notepadTextarea.value.trim();
    if (!text) {
      showToast("Nothing to save");
      return;
    }

    saveNoteBtn.disabled = true;

    // ── Editing an existing typed note → update it in place ──
    if (editingNoteId !== null) {
      const original = allTypedNotes.find((n) => n.id === editingNoteId);
      const images = pruneImages(text, {
        ...(original?.images || {}),
        ...draftImages,
      });
      chrome.runtime.sendMessage(
        {
          action: "updateTypedNote",
          id: editingNoteId,
          updates: { text, images, notebookId: activeNotebookId },
        },
        (response) => {
          saveNoteBtn.disabled = false;
          if (response?.success) {
            finishEditing();
            showToast("Note updated");
            switchTab("typed");
          } else {
            showToast("Update failed");
          }
        }
      );
      return;
    }

    // Re-detect in case the user switched tabs/windows while typing.
    const target = (await detectActiveTab()) || activeTabInfo;
    const images = pruneImages(text, draftImages);

    const note = {
      id: Date.now(),
      text,
      url: target?.url || "",
      title: target?.title || "",
      domain: target?.domain || "",
      timestamp: new Date().toISOString(),
      images,
      notebookId: activeNotebookId,
    };

    chrome.runtime.sendMessage(
      { action: "saveTypedNote", note },
      (response) => {
        saveNoteBtn.disabled = false;
        if (response?.success) {
          notepadTextarea.value = "";
          notepadTextarea.resetHistory();
          draftImages = {};
          clearDraft();
          updateNotepadPreview();
          showToast("Note saved");
          if (
            document.getElementById("panel-typed")?.classList.contains("active")
          ) {
            loadTypedNotes();
          }
        } else {
          showToast("Save failed");
        }
      }
    );
  });
}

// ── Notebooks ─────────────────────────────────────────────────────────────────
const NOTEBOOKS_KEY = "notebooks";
const ACTIVE_NOTEBOOK_KEY = "activeNotebook";

function loadNotebooks() {
  return new Promise((resolve) => {
    chrome.storage.local.get([NOTEBOOKS_KEY, ACTIVE_NOTEBOOK_KEY], (r) => {
      notebooks = Array.isArray(r[NOTEBOOKS_KEY]) ? r[NOTEBOOKS_KEY] : [];
      const active = r[ACTIVE_NOTEBOOK_KEY];
      activeNotebookId = notebooks.some((n) => n.id === active) ? active : null;
      renderNotebookUI();
      resolve();
    });
  });
}

function persistNotebooks() {
  chrome.storage.local.set({ [NOTEBOOKS_KEY]: notebooks });
}

function notebookName(id) {
  return notebooks.find((n) => n.id === id)?.name || null;
}

// persist=false is used while editing a note, so picking a notebook for that
// note doesn't change the notebook new notes are saved into.
function setActiveNotebook(id, persist = true) {
  activeNotebookId = id || null;
  if (persist) {
    chrome.storage.local.set({ [ACTIVE_NOTEBOOK_KEY]: activeNotebookId });
  }
  renderNotebookUI();
  if (editingNoteId !== null) saveDraft();
}

function restoreActiveNotebook() {
  chrome.storage.local.get([ACTIVE_NOTEBOOK_KEY], (r) => {
    const id = r[ACTIVE_NOTEBOOK_KEY];
    activeNotebookId = notebooks.some((n) => n.id === id) ? id : null;
    renderNotebookUI();
  });
}

function renderNotebookUI() {
  if (nbTriggerLabel) {
    const name = notebookName(activeNotebookId);
    nbTriggerLabel.textContent = name || "No notebook";
    nbTriggerLabel.classList.toggle("placeholder", !name);
  }
  renderNotebookMenu();
  renderTypedFilter();
}

function renderNotebookMenu() {
  if (!nbMenu) return;
  let html = "";
  if (notebooks.length > 0) {
    const sel = !activeNotebookId;
    html += `<div class="nb-item ${sel ? "selected" : ""}" data-id="" role="option">
      <span class="nb-check">${sel ? "✓" : ""}</span>
      <span class="nb-item-name muted">No notebook</span>
    </div>`;
  }
  for (const nb of notebooks) {
    const sel = nb.id === activeNotebookId;
    html += `<div class="nb-item ${sel ? "selected" : ""}" data-id="${esc(nb.id)}" role="option" title="Double-click to rename">
      <span class="nb-check">${sel ? "✓" : ""}</span>
      <span class="nb-item-name">${esc(nb.name)}</span>
    </div>`;
  }
  html += `<div class="nb-add" role="option">+ Add notebook</div>`;
  nbMenu.innerHTML = html;
}

function openNbMenu() {
  nbMenu.hidden = false;
  nbDropdown.classList.add("open");
  nbTrigger.setAttribute("aria-expanded", "true");
}

function closeNbMenu() {
  nbMenu.hidden = true;
  nbDropdown.classList.remove("open");
  nbTrigger.setAttribute("aria-expanded", "false");
}

function addNotebook() {
  let n = notebooks.length + 1;
  let name = `Notebook ${n}`;
  while (notebooks.some((nb) => nb.name.toLowerCase() === name.toLowerCase())) {
    name = `Notebook ${++n}`;
  }
  const nb = { id: `nb_${Date.now()}`, name };
  notebooks.push(nb);
  persistNotebooks();
  setActiveNotebook(nb.id, editingNoteId === null);
  startRename(nb.id); // let them name it straight away
}

function startRename(id) {
  const item = nbMenu.querySelector(`.nb-item[data-id="${id}"]`);
  const nb = notebooks.find((n) => n.id === id);
  const nameEl = item?.querySelector(".nb-item-name");
  if (!item || !nb || !nameEl) return;

  const input = document.createElement("input");
  input.className = "nb-rename-input";
  input.value = nb.name;
  input.maxLength = 40;
  nameEl.replaceWith(input);
  input.focus();
  input.select();

  let done = false;
  const finish = (commit) => {
    if (done) return;
    done = true;
    if (commit) {
      const name = input.value.trim();
      const clash = notebooks.some(
        (n) => n.id !== id && n.name.toLowerCase() === name.toLowerCase()
      );
      if (!name) showToast("Name can't be empty");
      else if (clash) showToast("A notebook with that name exists");
      else if (name !== nb.name) {
        nb.name = name;
        persistNotebooks();
        showToast("Notebook renamed");
      }
    }
    renderNotebookUI();
    renderTypedNotes(); // chips + filter show the new name
  };

  input.addEventListener("keydown", (e) => {
    e.stopPropagation();
    if (e.key === "Enter") finish(true);
    if (e.key === "Escape") finish(false);
  });
  input.addEventListener("blur", () => finish(true));
  input.addEventListener("click", (e) => e.stopPropagation());
  input.addEventListener("dblclick", (e) => e.stopPropagation());
}

if (nbTrigger && nbMenu) {
  nbTrigger.addEventListener("click", () =>
    nbMenu.hidden ? openNbMenu() : closeNbMenu()
  );

  // Single click selects; double click renames. The select is delayed slightly
  // so a double click doesn't also close the menu on its first click.
  let nbClickTimer = null;
  nbMenu.addEventListener("click", (e) => {
    if (e.target.closest(".nb-rename-input")) return;
    if (e.target.closest(".nb-add")) {
      addNotebook();
      return;
    }
    const item = e.target.closest(".nb-item");
    if (!item) return;
    clearTimeout(nbClickTimer);
    nbClickTimer = setTimeout(() => {
      setActiveNotebook(item.dataset.id || null, editingNoteId === null);
      closeNbMenu();
    }, 220);
  });

  nbMenu.addEventListener("dblclick", (e) => {
    const item = e.target.closest(".nb-item");
    if (!item || !item.dataset.id) return;
    clearTimeout(nbClickTimer);
    startRename(item.dataset.id);
  });

  document.addEventListener("click", (e) => {
    if (!nbDropdown.contains(e.target)) closeNbMenu();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !nbMenu.hidden) closeNbMenu();
  });
}

// ── Editing a typed note ─────────────────────────────────────────────────────
function updateEditUI() {
  const editing = editingNoteId !== null;
  if (saveNoteBtn)
    saveNoteBtn.textContent = editing ? "Update note" : "Save note";
  if (cancelEditBtn) cancelEditBtn.hidden = !editing;
  if (editBadge) editBadge.hidden = !editing;
  renderNotepadTarget();
}

function startEditingNote(note) {
  const hasDraft = notepadTextarea.value.trim() !== "";
  if (
    hasDraft &&
    notepadTextarea.value !== note.text &&
    !confirm("Replace what's currently in the Notepad with this note?")
  ) {
    return;
  }
  editingNoteId = note.id;
  notepadTextarea.value = note.text;
  notepadTextarea.resetHistory();
  draftImages = { ...(note.images || {}) };
  setActiveNotebook(
    notebooks.some((n) => n.id === note.notebookId) ? note.notebookId : null,
    false
  );
  updateNotepadPreview();
  updateEditUI();
  saveDraft();
  switchTab("notepad");
  const end = notepadTextarea.value.length;
  notepadTextarea.setSelectionRange(end, end);
}

function finishEditing() {
  editingNoteId = null;
  notepadTextarea.value = "";
  notepadTextarea.resetHistory();
  draftImages = {};
  clearDraft();
  updateNotepadPreview();
  updateEditUI();
  restoreActiveNotebook();
}

// If the popup was closed mid-edit, pick the edit back up (and make sure the
// note still exists) so "Update" doesn't silently become a duplicate save.
function restoreEditState(editingId, notebookId) {
  chrome.runtime.sendMessage({ action: "getTypedNotes" }, (res) => {
    const note = (res?.notes || []).find((n) => n.id === editingId);
    if (!note) return; // note was deleted — treat the draft as a new note
    editingNoteId = editingId;
    draftImages = { ...(note.images || {}), ...draftImages };
    if (notebookId !== undefined) {
      setActiveNotebook(
        notebooks.some((n) => n.id === notebookId) ? notebookId : null,
        false
      );
    }
    updateNotepadPreview();
    updateEditUI();
  });
}

if (cancelEditBtn) {
  cancelEditBtn.addEventListener("click", () => {
    finishEditing();
    switchTab("typed");
  });
}

// ── Typed Notes (Tab 3) ──────────────────────────────────────────────────────
function renderTypedFilter() {
  if (!typedFilterEl) return;
  let opts = `<option value="all">All notebooks</option>`;
  for (const nb of notebooks) {
    opts += `<option value="${esc(nb.id)}">${esc(nb.name)}</option>`;
  }
  opts += `<option value="none">No notebook</option>`;
  typedFilterEl.innerHTML = opts;
  if (![...typedFilterEl.options].some((o) => o.value === typedFilter)) {
    typedFilter = "all";
  }
  typedFilterEl.value = typedFilter;
}

// ── Typed tab search ──────────────────────────────────────────────────────────
// Several words = all must match (anywhere in text / title / URL / notebook);
// "quoted words" match as a phrase. Works together with the notebook dropdown.
const typedSearchInput = document.getElementById("typedSearchInput");
const typedCaseBtn = document.getElementById("typedCaseBtn");
let typedCaseSensitive = false;

const typedTerms = () =>
  Search.parseQuery(typedSearchInput ? typedSearchInput.value : "");

function notebookScopedTypedNotes() {
  if (typedFilter === "all") return allTypedNotes;
  if (typedFilter === "none") {
    return allTypedNotes.filter((n) => !notebookName(n.notebookId));
  }
  return allTypedNotes.filter((n) => n.notebookId === typedFilter);
}

// What's shown (and what PDF / Markdown / text export): notebook filter + search
function getFilteredTypedNotes() {
  const scoped = notebookScopedTypedNotes();
  const terms = typedTerms();
  if (!terms.length) return scoped;
  return scoped.filter((n) =>
    Search.noteMatches(n, terms, typedCaseSensitive, notebookName(n.notebookId))
  );
}

function applyTypedHighlights() {
  const terms = typedTerms();
  if (!terms.length || !typedNotesList) {
    Search.paint("typed-hit", []);
    return;
  }
  const ranges = Search.rangesIn(
    typedNotesList.querySelectorAll(".md-content, .domain-label"),
    terms,
    typedCaseSensitive
  );
  Search.paint("typed-hit", ranges);

  // A collapsed card can hide its match below the fold — open those cards
  typedNotesList.querySelectorAll(".md-content").forEach((el) => {
    if (el.classList.contains("expanded")) return;
    const first = ranges.find((r) => el.contains(r.startContainer));
    if (!first) return;
    if (
      first.getBoundingClientRect().bottom >
      el.getBoundingClientRect().bottom + 1
    ) {
      el.classList.add("expanded");
      const btn = el.closest(".note-card")?.querySelector(".typed-expand-btn");
      if (btn) {
        btn.style.display = "";
        btn.textContent = "Show less";
      }
    }
  });
}

function renderTypedPagination(total) {
  if (!typedPaginationEl) return;
  const pages = Math.ceil(total / TYPED_PER_PAGE);
  if (pages <= 1) {
    typedPaginationEl.style.display = "none";
    typedPaginationEl.innerHTML = "";
    return;
  }
  typedPaginationEl.style.display = "flex";
  typedPaginationEl.innerHTML = `
    <button class="pg-btn" id="typedPrev" ${typedPage === 1 ? "disabled" : ""}>← prev</button>
    <span class="pg-info">${typedPage} / ${pages}</span>
    <button class="pg-btn" id="typedNext" ${typedPage === pages ? "disabled" : ""}>next →</button>`;

  document.getElementById("typedPrev")?.addEventListener("click", () => {
    if (typedPage > 1) {
      typedPage--;
      renderTypedNotes();
      typedNotesList.scrollTop = 0;
    }
  });
  document.getElementById("typedNext")?.addEventListener("click", () => {
    if (typedPage < pages) {
      typedPage++;
      renderTypedNotes();
      typedNotesList.scrollTop = 0;
    }
  });
}

if (typedFilterEl) {
  typedFilterEl.addEventListener("change", () => {
    typedFilter = typedFilterEl.value;
    typedPage = 1;
    renderTypedNotes();
  });
}

function renderTypedNotes() {
  renderTypedNotesCore();
  applyTypedHighlights();
}

function renderTypedNotesCore() {
  if (!typedNotesList) return;

  renderTypedFilter();
  const filtered = getFilteredTypedNotes();
  const pages = Math.max(1, Math.ceil(filtered.length / TYPED_PER_PAGE));
  if (typedPage > pages) typedPage = pages;

  if (typedCountEl) {
    typedCountEl.textContent = typedTerms().length
      ? `${filtered.length} of ${notebookScopedTypedNotes().length} notes`
      : `${filtered.length} note${filtered.length !== 1 ? "s" : ""}`;
  }

  if (filtered.length === 0) {
    typedNotesList.innerHTML = `
      <div class="empty">
        <div class="empty-icon">✎</div>
        <div class="empty-text">${
          allTypedNotes.length === 0
            ? "No typed notes yet."
            : typedTerms().length
              ? `No notes match “${esc(typedSearchInput.value.trim())}”.`
              : "No notes in this notebook."
        }</div>
      </div>`;
    renderTypedPagination(0);
    return;
  }

  const start = (typedPage - 1) * TYPED_PER_PAGE;
  const pageNotes = filtered.slice(start, start + TYPED_PER_PAGE);
  const grouped = groupNotes(pageNotes);
  let html = "";

  for (const group of grouped) {
    html += `<div class="date-group">
      <div class="date-heading">${formatDateHeading(group.dateKey)}</div>`;

    for (const { domain, notes: domainNotes } of group.domains) {
      html += `<div class="domain-row">
        <img class="domain-favicon" src="${faviconUrl(domain)}" alt="" />
        <span class="domain-label">${esc(domain)}</span>
      </div>`;

      for (const note of domainNotes) {
        const time = new Date(note.timestamp).toLocaleTimeString(undefined, {
          hour: "2-digit",
          minute: "2-digit",
        });

        html += `
        <div class="note-card" data-id="${note.id}">
          <div class="note-top">
            <span class="note-time">${time}${
              notebookName(note.notebookId)
                ? `<span class="nb-chip" title="Notebook">${esc(notebookName(note.notebookId))}</span>`
                : ""
            }</span>
            <a class="note-source" href="${esc(note.url)}" target="_blank">source ↗</a>
          </div>
          <div class="md-content" data-raw="${esc(note.text)}">${Markdown.render(note.text, note.images || {})}</div>
          <div class="typed-card-actions">
            <button class="typed-expand-btn" title="Expand / collapse">Show more</button>
            <button class="typed-copy-btn" data-id="${note.id}" title="Copy note text">${COPY_SVG}</button>
            <button class="typed-copy-btn typed-edit-btn" data-id="${note.id}" title="Edit note">${EDIT_SVG}</button>
            <button class="card-btn del typed-delete-btn" data-id="${note.id}" title="Delete" style="margin-left:auto;">${DEL_SVG}</button>
          </div>
        </div>`;
      }
    }
    html += `</div>`;
  }

  typedNotesList.innerHTML = html;

  // ── Hide expand button when content doesn't overflow ──
  typedNotesList.querySelectorAll(".md-content").forEach((el) => {
    if (el.scrollHeight <= el.clientHeight) {
      const btn = el.closest(".note-card")?.querySelector(".typed-expand-btn");
      if (btn) btn.style.display = "none";
    }
  });

  // ── Expand / collapse ──
  typedNotesList.querySelectorAll(".typed-expand-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const mdEl = btn.closest(".note-card")?.querySelector(".md-content");
      if (!mdEl) return;
      const expanded = mdEl.classList.toggle("expanded");
      btn.textContent = expanded ? "Show less" : "Show more";
    });
  });

  // ── Copy ──
  typedNotesList
    .querySelectorAll(".typed-copy-btn:not(.typed-edit-btn)")
    .forEach((btn) => {
      btn.addEventListener("click", () => {
        const mdEl = btn.closest(".note-card")?.querySelector(".md-content");
        if (!mdEl) return;
        const rawText = mdEl.dataset.raw || mdEl.textContent;
        navigator.clipboard
          .writeText(rawText)
          .then(() => {
            btn.classList.add("copied");
            showToast("copied");
            setTimeout(() => btn.classList.remove("copied"), 1800);
          })
          .catch(() => showToast("copy failed"));
      });
    });

  // ── Edit ──
  typedNotesList.querySelectorAll(".typed-edit-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const note = allTypedNotes.find((n) => n.id === parseInt(btn.dataset.id));
      if (note) startEditingNote(note);
    });
  });

  // ── Delete ──
  typedNotesList.querySelectorAll(".typed-delete-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = parseInt(btn.dataset.id);
      chrome.runtime.sendMessage({ action: "deleteTypedNote", id }, () => {
        loadTypedNotes();
        showToast("deleted");
      });
    });
  });

  renderTypedPagination(filtered.length);
}

// ── Export typed notes (PDF / Markdown / TXT) ────────────────────────────────
// Exports whatever the notebook dropdown is currently showing (all pages).
// The PDF is always rendered in a light theme, whatever theme the popup uses.
const exportBtn = document.getElementById("exportBtn");
const exportMenu = document.getElementById("exportMenu");

function setExportMenu(open) {
  exportMenu.hidden = !open;
  exportBtn.setAttribute("aria-expanded", String(open));
}

exportBtn.addEventListener("click", (e) => {
  e.stopPropagation();
  setExportMenu(exportMenu.hidden);
});
document.addEventListener("click", () => setExportMenu(false));
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") setExportMenu(false);
});
exportMenu.querySelectorAll("button").forEach((b) =>
  b.addEventListener("click", (e) => {
    e.stopPropagation();
    setExportMenu(false);
    runExport(b.dataset.format);
  })
);

// jsPDF (~400 KB) is only loaded the first time a PDF is requested
let jsPdfPromise = null;
function loadJsPdf() {
  if (window.jspdf?.jsPDF) return Promise.resolve(window.jspdf.jsPDF);
  if (!jsPdfPromise) {
    jsPdfPromise = new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = "lib/jspdf.umd.min.js";
      s.onload = () => resolve(window.jspdf.jsPDF);
      s.onerror = () => {
        jsPdfPromise = null;
        reject(new Error("Could not load lib/jspdf.umd.min.js"));
      };
      document.head.appendChild(s);
    });
  }
  return jsPdfPromise;
}

// Re-encode pasted images on a white background so transparency can't turn black in the PDF
function prepareImageForPdf(dataUrl) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const c = document.createElement("canvas");
      c.width = img.naturalWidth;
      c.height = img.naturalHeight;
      const ctx = c.getContext("2d");
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, c.width, c.height);
      ctx.drawImage(img, 0, 0);
      resolve({
        dataUrl: c.toDataURL("image/jpeg", 0.92),
        format: "JPEG",
        width: c.width,
        height: c.height,
      });
    };
    img.onerror = () => resolve(null);
    img.src = dataUrl;
  });
}

async function withExportImages(notes) {
  const ids = new Set();
  for (const n of notes) {
    for (const m of (n.text || "").matchAll(/\[\[img:([\w-]+)\]\]/g))
      ids.add(m[1]);
  }
  if (ids.size === 0) return notes;
  const hd = await chrome.storage.local.get([...ids].map((id) => "hd:" + id));
  return notes.map((n) => {
    const images = { ...(n.images || {}) };
    for (const id of Object.keys(images))
      if (hd["hd:" + id]) images[id] = hd["hd:" + id];
    return { ...n, images };
  });
}

// ── JSON backup: export everything / import with strict validation ───────────
// Unlike PDF / Markdown / text (which export the notebook shown in the dropdown),
// the JSON backup always contains EVERYTHING: every notebook with its notes, the
// notes that aren't in a notebook, and the saved selections from the first tab.
async function exportJson() {
  exportBtn.disabled = true;
  try {
    const stored = await chrome.storage.local.get([
      "notebooks",
      "typedNotes",
      "notes",
    ]);
    const ids = new Set();
    for (const n of stored.typedNotes || [])
      for (const k of Object.keys(n?.images || {})) ids.add(k);
    const hdRaw = ids.size
      ? await chrome.storage.local.get([...ids].map((id) => "hd:" + id))
      : {};
    const hd = {};
    for (const id of ids) if (hdRaw["hd:" + id]) hd[id] = hdRaw["hd:" + id];

    const { file, skipped } = NotesBackup.buildExport(
      { ...stored, hd },
      chrome.runtime.getManifest().version
    );
    const check = NotesBackup.validate(file); // our own file must pass our own importer
    if (!check.ok) {
      console.error("Backup failed its own validation:", check.errors);
      showToast("Backup failed — see console");
      return;
    }
    const typed =
      file.unfiledNotes.length +
      file.notebooks.reduce((a, nb) => a + nb.notes.length, 0);
    const blob = new Blob([JSON.stringify(file, null, 2)], {
      type: "application/json",
    });
    NoteExport.download(
      blob,
      `save-to-notes-backup-${new Date().toISOString().slice(0, 10)}.json`
    );
    showToast(
      `Backup saved · ${file.notebooks.length} notebooks, ${typed} notes, ${file.savedSelections.length} selections` +
        (skipped ? ` (${skipped} unreadable skipped)` : ""),
      3200
    );
  } catch (err) {
    console.error("Backup failed:", err);
    showToast("Backup failed");
  } finally {
    exportBtn.disabled = false;
  }
}

const importBtn = document.getElementById("importBtn");
const importFile = document.getElementById("importFile");
importBtn.addEventListener("click", () => importFile.click());
importFile.addEventListener("change", async () => {
  const file = importFile.files[0];
  importFile.value = ""; // so picking the same file again still fires
  if (file) await importBackup(file);
});

function rejectImport(lines) {
  alert("Import rejected — nothing was changed.\n\n" + lines.join("\n"));
}

async function importBackup(file) {
  importBtn.disabled = true;
  try {
    if (file.size > NotesBackup.LIMITS.fileBytes)
      return rejectImport(["The file is too large to be a backup."]);
    let data;
    try {
      data = JSON.parse(await file.text());
    } catch {
      return rejectImport(["The file is not valid JSON."]);
    }
    const check = NotesBackup.validate(data);
    if (!check.ok) {
      return rejectImport([
        "This is not a valid Save to Notes backup:",
        ...check.errors.map((e) => "• " + e),
      ]);
    }

    const existing = await chrome.storage.local.get([
      "notebooks",
      "typedNotes",
      "notes",
      "hdIndex",
    ]);
    const plan = NotesBackup.plan(data, existing);
    const s = plan.summary;
    if (s.typedNew + s.selectionsNew + s.notebooksNew === 0) {
      showToast("Nothing new — everything in this file is already here", 3000);
      return;
    }

    const lines = [];
    if (s.notebooksNew || s.notebooksMerged) {
      lines.push(
        `• ${s.notebooksNew} new notebook${s.notebooksNew === 1 ? "" : "s"}` +
          (s.notebooksMerged
            ? ` (${s.notebooksMerged} matched an existing notebook)`
            : "")
      );
    }
    lines.push(
      `• ${s.typedNew} new note${s.typedNew === 1 ? "" : "s"}` +
        (s.typedSkipped ? ` (${s.typedSkipped} already here, skipped)` : ""),
      `• ${s.selectionsNew} saved selection${s.selectionsNew === 1 ? "" : "s"} for the first tab` +
        (s.selectionsSkipped
          ? ` (${s.selectionsSkipped} already here, skipped)`
          : "")
    );
    if (s.images) lines.push(`• ${s.images} image${s.images === 1 ? "" : "s"}`);
    if (
      !confirm(
        `Import this backup?\n\n${lines.join("\n")}\n\nNothing is deleted — everything is added to what you already have.`
      )
    )
      return;

    const hdEntries = {};
    for (const [id, url] of Object.entries(plan.hd))
      hdEntries["hd:" + id] = url;
    await chrome.storage.local.set({
      notebooks: plan.notebooks,
      typedNotes: plan.typedNotes,
      notes: plan.notes,
    });
    if (Object.keys(hdEntries).length)
      await chrome.storage.local.set({ ...hdEntries, hdIndex: plan.hdIndex });

    await loadNotebooks();
    loadNotes();
    loadTypedNotes();
    showToast(
      `Imported ${s.typedNew} notes, ${s.selectionsNew} selections, ${s.notebooksNew} notebooks`,
      3200
    );
  } catch (err) {
    console.error("Import failed:", err);
    alert("Import failed — nothing was changed.\n\n" + (err?.message || err));
  } finally {
    importBtn.disabled = false;
  }
}

// ── Typed tab search: events ──────────────────────────────────────────────────
if (typedSearchInput) {
  typedSearchInput.addEventListener(
    "input",
    debounce(() => {
      typedPage = 1;
      renderTypedNotes();
    }, 200)
  );
  typedSearchInput.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    if (typedSearchInput.value) {
      typedSearchInput.value = "";
      typedPage = 1;
      renderTypedNotes();
    } else typedSearchInput.blur();
  });
  typedCaseBtn.addEventListener("click", () => {
    typedCaseSensitive = !typedCaseSensitive;
    typedCaseBtn.classList.toggle("active", typedCaseSensitive);
    typedPage = 1;
    renderTypedNotes();
  });
}

// ── Notepad: find in the note you're writing ──────────────────────────────────
// Cmd/Ctrl+F (or the magnifier button) opens a find bar above the editor. Every
// match is highlighted; Enter / Shift+Enter step through them; Esc closes it and
// leaves the current match selected in the editor.
const findBar = document.getElementById("findBar");
const findInput = document.getElementById("findInput");
const findCount = document.getElementById("findCount");
const findCaseBtn = document.getElementById("findCaseBtn");
const findToggleBtn = document.getElementById("findToggleBtn");
const notepadWrapEl = document.querySelector(".notepad-wrap");
let findMatches = [];
let findIdx = -1;
let findCaseSensitive = false;

function paintFind() {
  const cur = findMatches[findIdx];
  Search.paint(
    "find-hit",
    findMatches.filter((_, i) => i !== findIdx).map((m) => m.range)
  );
  Search.paint("find-current", cur ? [cur.range] : [], 1);
  findCount.textContent = !findInput.value
    ? ""
    : findMatches.length
      ? `${findIdx + 1}/${findMatches.length}`
      : "No results";
  findCount.classList.toggle(
    "none",
    !!findInput.value && findMatches.length === 0
  );
}

// Scroll the editor only if the current match isn't comfortably in view
function revealFindMatch() {
  const m = findMatches[findIdx];
  if (!m) return;
  const el = notepadTextarea;
  const r = m.range.getBoundingClientRect();
  if (!r.height) return;
  const lh = parseFloat(getComputedStyle(el).lineHeight) || 20;
  const top = el.getBoundingClientRect().top + el.clientTop;
  if (r.top < top + lh || r.bottom > top + el.clientHeight - lh * 2) {
    el.scrollTop += (r.top + r.bottom) / 2 - (top + el.clientHeight / 2);
  }
}

function runFind({ keepCurrent = false, reveal = true } = {}) {
  const q = findInput.value;
  const prev = findMatches[findIdx];
  findMatches = q ? notepadTextarea.findAll(q, findCaseSensitive) : [];
  if (findMatches.length === 0) findIdx = -1;
  else if (keepCurrent && prev) {
    const i = findMatches.findIndex((m) => m.start >= prev.start);
    findIdx = i === -1 ? findMatches.length - 1 : i;
  } else {
    const caret = notepadTextarea.selectionStart;
    const i = findMatches.findIndex((m) => m.start >= caret);
    findIdx = i === -1 ? 0 : i; // first match at/after the caret, wrapping to the top
  }
  paintFind();
  if (reveal) revealFindMatch();
}

function stepFind(dir) {
  if (!findMatches.length) return;
  findIdx = (findIdx + dir + findMatches.length) % findMatches.length;
  paintFind();
  revealFindMatch();
}

function openFind() {
  const ta = notepadTextarea;
  const picked = ta.value.slice(ta.selectionStart, ta.selectionEnd);
  if (picked && picked.length <= 100 && !/\n|\[\[img:/.test(picked))
    findInput.value = picked;
  findBar.hidden = false;
  notepadWrapEl.classList.add("finding");
  findInput.focus();
  findInput.select();
  runFind();
}

function closeFind() {
  const m = findMatches[findIdx];
  findBar.hidden = true;
  notepadWrapEl.classList.remove("finding");
  Search.paint("find-hit", []);
  Search.paint("find-current", []);
  findMatches = [];
  findIdx = -1;
  notepadTextarea.focus();
  if (m) notepadTextarea.setSelectionRange(m.start, m.end);
  notepadTextarea.keepCaretVisible();
}

// Edits made while the bar is open refresh the highlights (without scrolling away)
refreshFindSoon = debounce(() => {
  if (!findBar.hidden) runFind({ keepCurrent: true, reveal: false });
}, 120);

findInput.addEventListener("input", () => runFind());
findInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    stepFind(e.shiftKey ? -1 : 1);
  } else if (e.key === "Escape") {
    e.preventDefault();
    closeFind();
  }
});
document
  .getElementById("findNextBtn")
  .addEventListener("click", () => stepFind(1));
document
  .getElementById("findPrevBtn")
  .addEventListener("click", () => stepFind(-1));
document.getElementById("findCloseBtn").addEventListener("click", closeFind);
findCaseBtn.addEventListener("click", () => {
  findCaseSensitive = !findCaseSensitive;
  findCaseBtn.classList.toggle("active", findCaseSensitive);
  runFind();
});
findToggleBtn.addEventListener("click", () =>
  findBar.hidden ? openFind() : closeFind()
);

// Cmd/Ctrl+F focuses the search that belongs to the tab you're on
document.addEventListener("keydown", (e) => {
  if (!(e.metaKey || e.ctrlKey) || e.altKey || e.shiftKey || e.code !== "KeyF")
    return;
  const active = document.querySelector(".tab-panel.active")?.id;
  if (active === "panel-notepad") {
    e.preventDefault();
    openFind();
  } else if (active === "panel-typed" && typedSearchInput) {
    e.preventDefault();
    typedSearchInput.focus();
    typedSearchInput.select();
  } else if (active === "panel-notes") {
    e.preventDefault();
    searchInput.focus();
    searchInput.select();
  }
});

async function runExport(format) {
  if (format === "json") return exportJson();
  const filtered = getFilteredTypedNotes();
  if (filtered.length === 0) {
    showToast("No notes to export");
    return;
  }
  const notebook =
    typedFilter === "all"
      ? null
      : typedFilter === "none"
        ? "No notebook"
        : notebookName(typedFilter);
  const meta = { notebook };

  exportBtn.disabled = true;
  try {
    // Swap in the sharper export copy of each image where one exists
    const notes = await withExportImages(
      filtered.map((n) => ({ ...n, notebook: notebookName(n.notebookId) }))
    );
    let blob;
    if (format === "pdf") {
      showToast("Building PDF…", 5000);
      const jsPDF = await loadJsPdf();
      blob = await NoteExport.toPdf(notes, meta, {
        jsPDF,
        prepareImage: prepareImageForPdf,
      });
    } else if (format === "md") {
      blob = new Blob([NoteExport.toMarkdown(notes, meta)], {
        type: "text/markdown;charset=utf-8",
      });
    } else {
      blob = new Blob([NoteExport.toText(notes, meta)], {
        type: "text/plain;charset=utf-8",
      });
    }
    NoteExport.download(blob, NoteExport.fileName(format, notebook));
    showToast(`Exported ${notes.length} note${notes.length !== 1 ? "s" : ""}`);
  } catch (err) {
    console.error("Export failed:", err);
    showToast("Export failed");
  } finally {
    exportBtn.disabled = false;
  }
}

function loadTypedNotes() {
  chrome.runtime.sendMessage({ action: "getTypedNotes" }, (response) => {
    allTypedNotes = (response?.notes || []).slice().reverse();
    renderTypedNotes();
    updateStorage();
    if (Array.isArray(response?.notes)) sweepHdImages().catch(() => {});
  });
}

// ── Init ──────────────────────────────────────────────────────────────────────
(async () => {
  const prefs = await loadPrefs();
  applyTheme(prefs.theme !== "light");
  loadNotes();
  await loadNotebooks();
  activeTabInfo = await detectActiveTab();
  renderNotepadTarget();

  // Restore unsaved draft and cursor position so state isn't lost when the popup closes
  if (notepadTextarea) {
    loadDraft(async ({ text, start, end, editingId, notebookId }) => {
      const saved = await chrome.storage.local.get([DRAFT_IMAGES_KEY]);
      draftImages = { ...(saved[DRAFT_IMAGES_KEY] || {}) };
      notepadTextarea.value = text;
      notepadTextarea.resetHistory();
      updateNotepadPreview();
      notepadTextarea.focus();
      const validStart = Math.min(Math.max(0, start), text.length);
      const validEnd = Math.min(Math.max(0, end), text.length);
      notepadTextarea.setSelectionRange(validStart, validEnd);
      if (editingId != null) restoreEditState(editingId, notebookId);
    });
  } else {
    updateNotepadPreview();
  }
})();
