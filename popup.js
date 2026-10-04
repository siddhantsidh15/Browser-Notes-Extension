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

// ── SVG Icons ─────────────────────────────────────────────────────────────────
const COPY_SVG = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>`;
const DEL_SVG = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/></svg>`;

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
  notepadTarget.textContent = activeTabInfo?.domain
    ? `saving from ${activeTabInfo.domain}`
    : "";
}

// ── Live preview ──────────────────────────────────────────────────────────────
function updateNotepadPreview() {
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
    },
  });
}

function clearDraft() {
  chrome.storage.local.remove(DRAFT_KEY);
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
      callback({ text, start, end });
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

// ── Paste an image from the clipboard into the note ───────────────────────────
// The image is stored as a base64 data URL in `draftImages`, keyed by a short
// id; only a compact [[img:<id>]] token is inserted into the text itself so
// the textarea stays readable. Markdown.render() swaps the token back for an
// <img> at display time.
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
      reader.onload = () => {
        const id = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
        draftImages[id] = reader.result;
        insertAtCursor(notepadTextarea, `[[img:${id}]]`);
        updateNotepadPreview();
      };
      reader.readAsDataURL(file);
      break; // one image per paste
    }
  });
}

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
    };

    chrome.runtime.sendMessage(
      { action: "saveTypedNote", note },
      (response) => {
        saveNoteBtn.disabled = false;
        if (response?.success) {
          notepadTextarea.value = "";
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

// ── Typed Notes (Tab 3) ──────────────────────────────────────────────────────
function renderTypedNotes(notes) {
  if (!typedNotesList) return;

  if (notes.length === 0) {
    typedNotesList.innerHTML = `
      <div class="empty">
        <div class="empty-icon">✎</div>
        <div class="empty-text">No typed notes yet.</div>
      </div>`;
    return;
  }

  const grouped = groupNotes(notes);
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
            <span class="note-time">${time}</span>
            <a class="note-source" href="${esc(note.url)}" target="_blank">source ↗</a>
          </div>
          <div class="md-content" data-raw="${esc(note.text)}">${Markdown.render(note.text, note.images || {})}</div>
          <div class="typed-card-actions">
            <button class="typed-expand-btn" title="Expand / collapse">Show more</button>
            <button class="typed-copy-btn" data-id="${note.id}" title="Copy note text">${COPY_SVG}</button>
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
  typedNotesList.querySelectorAll(".typed-copy-btn").forEach((btn) => {
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
}

function loadTypedNotes() {
  chrome.runtime.sendMessage({ action: "getTypedNotes" }, (response) => {
    allTypedNotes = (response?.notes || []).slice().reverse();
    renderTypedNotes(allTypedNotes);
    updateStorage();
  });
}

// ── Init ──────────────────────────────────────────────────────────────────────
(async () => {
  const prefs = await loadPrefs();
  applyTheme(prefs.theme !== "light");
  loadNotes();
  activeTabInfo = await detectActiveTab();
  renderNotepadTarget();

  // Restore unsaved draft and cursor position so state isn't lost when the popup closes
  if (notepadTextarea) {
    loadDraft(({ text, start, end }) => {
      notepadTextarea.value = text;
      updateNotepadPreview();
      notepadTextarea.focus();
      const validStart = Math.min(Math.max(0, start), text.length);
      const validEnd = Math.min(Math.max(0, end), text.length);
      notepadTextarea.setSelectionRange(validStart, validEnd);
    });
  } else {
    updateNotepadPreview();
  }
})();
