// notes.js — full-page notes viewer with pagination, double/single layout,
// dark/light theme, and three-panel tabs: Notes | Notepad | Typed

// ── DOM refs ──────────────────────────────────────────────────────────────────
const leftCol = document.getElementById("leftCol");
const rightCol = document.getElementById("rightCol");
const searchInput = document.getElementById("searchInput");
const exportBtn = document.getElementById("exportBtn");
const clearBtn = document.getElementById("clearBtn");
const topbarStats = document.getElementById("topbarStats");
const pageInfo = document.getElementById("pageInfo");
const paginationEl = document.getElementById("pagination");
const toast = document.getElementById("toast");
const themeToggle = document.getElementById("themeToggle");
const storageIndicator = document.getElementById("storageIndicator");
const layoutToggle = document.getElementById("layoutToggle");

// ── State ─────────────────────────────────────────────────────────────────────
let allNotes = [];
let currentPage = 1;
const PER_PAGE = 20;
let isCaseSensitive = false;
let currentFilteredNotes = [];
let allTypedNotes = [];
const TYPED_PER_PAGE = 10;
let typedPage = 1;
let typedFilter = "all"; // "all" | "none" | <notebook id>
let notebooks = []; // [{ id, name }]
let activeNotebookId = null; // notebook new notes are saved into
let editingNoteId = null; // id of the typed note being edited, or null

// ── Persist preferences in chrome.storage.local ───────────────────────────────
async function loadPrefs() {
  return new Promise((resolve) => {
    chrome.storage.local.get(["prefs"], (r) => resolve(r.prefs || {}));
  });
}
async function savePrefs(patch) {
  const prefs = await loadPrefs();
  chrome.storage.local.set({ prefs: { ...prefs, ...patch } });
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function getDateKey(isoTimestamp) {
  const d = new Date(isoTimestamp);
  const y = d.getFullYear();
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

function formatDateHeading(dateKey) {
  const nd = new Date(dateKey + "T00:00:00");
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const yest = new Date(today);
  yest.setDate(today.getDate() - 1);
  if (nd.toDateString() === today.toDateString()) return "Today";
  if (nd.toDateString() === yest.toDateString()) return "Yesterday";
  return nd.toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
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

function esc(str = "") {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function faviconUrl(domain) {
  return `https://www.google.com/s2/favicons?domain=${domain}&sz=32`;
}

function showToast(msg, dur = 2500) {
  toast.textContent = msg;
  toast.classList.add("show");
  setTimeout(() => toast.classList.remove("show"), dur);
}

function debounce(fn, delay) {
  let timer;
  return function (...args) {
    clearTimeout(timer);
    timer = setTimeout(() => fn.apply(this, args), delay);
  };
}

// ── Markdown renderer ─────────────────────────────────────────────────────────
const Markdown = {
  rules: [
    {
      name: "codeBlock",
      pattern: /```([\s\S]*?)```/g,
      render: (_match, code) =>
        `<pre class="md-code"><code>${code}</code></pre>`,
    },
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
    {
      name: "underline",
      pattern: /:([^:\n]+):/g,
      render: (_match, text) => `<u>${text}</u>`,
    },
  ],

  render(rawText, images = {}) {
    let html = esc(rawText || "");
    html = html.replace(/\[\[img:([\w-]+)\]\]/g, "\u0000IMG$1\u0000");
    for (const rule of this.rules) {
      html = html.replace(rule.pattern, (...args) => rule.render(...args));
    }
    return html.replace(/\u0000IMG([\w-]+)\u0000/g, (_m, id) =>
      images[id] ? `<img class="md-image" src="${images[id]}" alt="pasted image" />` : ""
    );
  },
};

// ── Grouping ──────────────────────────────────────────────────────────────────
function groupNotes(notes) {
  const map = {};
  for (const note of notes) {
    const dk = getDateKey(note.timestamp);
    const domain = note.domain || getDomain(note.url || "");
    if (!map[dk]) map[dk] = {};
    if (!map[dk][domain]) map[dk][domain] = [];
    map[dk][domain].push(note);
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

// ── Build HTML for one saved note card ───────────────────────────────────────
function noteCardHTML(note, idx) {
  const paragraphs = note.text
    .split(/\n{2,}/)
    .map((p) => `<p>${esc(p.trim())}</p>`)
    .join("");

  const count = note.copyCount || 0;
  const d1 = count >= 1 ? "active" : "";
  const d2 = count >= 2 ? "active" : "";
  const d3 = count >= 3 ? "active" : "";

  return `
  <div class="note-card" data-id="${note.id}">
    <button class="note-delete" data-id="${note.id}" title="Delete">✕</button>
    <button class="note-copy" data-id="${note.id}" title="Copy note text" aria-label="Copy">
      <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
        <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
      </svg>
    </button>
    <div class="note-meta-row">
      <span class="note-index">Note ${idx + 1}</span>
      <span class="note-time">${formatTime(note.timestamp)}</span>
      <a class="note-source-link" href="${esc(note.url)}" target="_blank"
         title="${esc(note.url)}">↗ ${esc(note.title || note.url)}</a>
      <div class="copy-indicators" title="Copied ${count} times">
        <div class="copy-dot ${d1}"></div>
        <div class="copy-dot ${d2}"></div>
        <div class="copy-dot ${d3}"></div>
      </div>
    </div>
    <div class="note-body">${paragraphs}</div>
  </div>`;
}

// ── Build HTML for a date→domain group ───────────────────────────────────────
function dateBlockHTML(group, animDelay) {
  const totalNotes = group.domains.reduce((s, d) => s + d.notes.length, 0);
  let html = `
  <div class="date-block" style="animation-delay:${animDelay}s">
    <div class="date-heading">
      <span class="date-label">${formatDateHeading(group.dateKey)}</span>
      <div class="date-rule"></div>
      <span class="date-count">${totalNotes} note${totalNotes !== 1 ? "s" : ""}</span>
    </div>`;

  for (const { domain, notes } of group.domains) {
    html += `
    <div class="domain-block">
      <div class="domain-heading">
        <img class="domain-favicon" src="${faviconUrl(domain)}" alt="" data-favicon="1"/>
        <span class="domain-name">${esc(domain)}</span>
        <span class="domain-note-count">· ${notes.length} note${notes.length !== 1 ? "s" : ""}</span>
      </div>`;
    notes.forEach((note, i) => {
      html += noteCardHTML(note, i);
    });
    html += `</div>`; // domain-block
  }
  html += `</div>`; // date-block
  return html;
}

// ── Pagination helpers ────────────────────────────────────────────────────────
function getPageNotes() {
  const start = (currentPage - 1) * PER_PAGE;
  return currentFilteredNotes.slice(start, start + PER_PAGE);
}

function totalPages() {
  return Math.max(1, Math.ceil(currentFilteredNotes.length / PER_PAGE));
}

// ── Render saved notes ────────────────────────────────────────────────────────
function render(filtered) {
  const total = allNotes.length;
  const fTotal = filtered.length;
  const pages = totalPages();
  const isDouble = document.documentElement.dataset.layout === "double";

  topbarStats.textContent =
    total === 0 ? "" : `${total} note${total !== 1 ? "s" : ""}`;

  if (currentPage > pages) currentPage = pages;

  if (fTotal === 0) {
    const q = searchInput.value.trim();
    leftCol.innerHTML = `
      <div class="empty-state">
        <div class="big-icon">${q ? "🔍" : "📋"}</div>
        <h2>${q ? "No matches found" : "No notes yet"}</h2>
        <p>${
          q
            ? `No notes match "<strong>${esc(q)}</strong>"`
            : `Select text on any page, right-click,<br/>choose <kbd>Save to Notes</kbd>`
        }</p>
      </div>`;
    rightCol.innerHTML = "";
    paginationEl.style.display = "none";
    paginationEl.innerHTML = "";
    pageInfo.textContent = "";
    return;
  }

  const pageNotes = getPageNotes();
  const startN = (currentPage - 1) * PER_PAGE + 1;
  const endN = Math.min(currentPage * PER_PAGE, fTotal);
  pageInfo.textContent = `${startN}–${endN} of ${fTotal} note${fTotal !== 1 ? "s" : ""}`;

  if (isDouble) {
    const leftNotes = pageNotes.slice(0, PER_PAGE / 2);
    const rightNotes = pageNotes.slice(PER_PAGE / 2, PER_PAGE);
    leftCol.innerHTML = groupNotes(leftNotes)
      .map((g, i) => dateBlockHTML(g, i * 0.06))
      .join("");
    const rg = groupNotes(rightNotes);
    rightCol.innerHTML = rg.length
      ? rg.map((g, i) => dateBlockHTML(g, i * 0.06)).join("")
      : "";
  } else {
    leftCol.innerHTML = groupNotes(pageNotes)
      .map((g, i) => dateBlockHTML(g, i * 0.06))
      .join("");
    rightCol.innerHTML = "";
  }

  // Attach delete handlers
  document.querySelectorAll(".note-delete").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = parseInt(btn.dataset.id);
      chrome.runtime.sendMessage({ action: "deleteNote", id }, () => {
        loadNotes();
        showToast("🗑 Note deleted");
      });
    });
  });

  // Attach copy handlers
  document.querySelectorAll(".note-copy").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = parseInt(btn.dataset.id);
      const noteToCopy = allNotes.find((n) => n.id === id);
      if (!noteToCopy) return;

      navigator.clipboard
        .writeText(noteToCopy.text)
        .then(() => {
          showToast("📋 Copied to clipboard!");
          noteToCopy.copyCount = (noteToCopy.copyCount || 0) + 1;

          const card = document.querySelector(`.note-card[data-id="${id}"]`);
          if (card) {
            const dots = card.querySelectorAll(".copy-dot");
            if (noteToCopy.copyCount >= 1 && dots[0])
              dots[0].classList.add("active");
            if (noteToCopy.copyCount >= 2 && dots[1])
              dots[1].classList.add("active");
            if (noteToCopy.copyCount >= 3 && dots[2])
              dots[2].classList.add("active");
            card.querySelector(".copy-indicators").title =
              `Copied ${noteToCopy.copyCount} times`;
          }

          chrome.storage.local.get(["notes"], (res) => {
            const dbNotes = res.notes || [];
            const dbNote = dbNotes.find((n) => n.id === id);
            if (dbNote) {
              dbNote.copyCount = noteToCopy.copyCount;
              chrome.storage.local.set({ notes: dbNotes });
            }
          });
        })
        .catch(() => showToast("❌ Failed to copy"));
    });
  });

  renderPagination(pages);
}

// ── Pagination bar ────────────────────────────────────────────────────────────
function renderPagination(pages) {
  if (pages <= 1) {
    paginationEl.style.display = "none";
    paginationEl.innerHTML = "";
    return;
  }

  paginationEl.style.display = "flex";
  const makeBtn = (label, page, disabled = false, active = false) => {
    const cls = ["pg-btn", active ? "active" : ""].filter(Boolean).join(" ");
    return `<button class="${cls}" data-page="${page}" ${disabled ? "disabled" : ""}>${label}</button>`;
  };

  let html = makeBtn("←", currentPage - 1, currentPage === 1);

  const range = [];
  if (pages <= 7) {
    for (let i = 1; i <= pages; i++) range.push(i);
  } else {
    range.push(1);
    if (currentPage > 3) range.push("…");
    for (
      let i = Math.max(2, currentPage - 1);
      i <= Math.min(pages - 1, currentPage + 1);
      i++
    )
      range.push(i);
    if (currentPage < pages - 2) range.push("…");
    range.push(pages);
  }

  for (const r of range) {
    if (r === "…") html += `<span class="pg-ellipsis">…</span>`;
    else html += makeBtn(r, r, false, r === currentPage);
  }

  html += makeBtn("→", currentPage + 1, currentPage === pages);
  paginationEl.innerHTML = html;

  paginationEl.querySelectorAll(".pg-btn:not([disabled])").forEach((btn) => {
    btn.addEventListener("click", () => {
      currentPage = parseInt(btn.dataset.page);
      filterAndRender();
      window.scrollTo({ top: 0, behavior: "smooth" });
    });
  });
}

// ── Search ────────────────────────────────────────────────────────────────────
const caseSensitiveBtn = document.getElementById("caseSensitiveBtn");
const copyAllBtn = document.getElementById("copyAllBtn");

if (copyAllBtn) {
  copyAllBtn.innerHTML = `
    <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
      <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
    </svg>`;
  copyAllBtn.disabled = true;
}

function filterAndRender() {
  const query = searchInput.value.trim();

  if (copyAllBtn) copyAllBtn.disabled = query === "";

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

  render(currentFilteredNotes);
}

if (copyAllBtn) {
  copyAllBtn.addEventListener("click", () => {
    if (currentFilteredNotes.length === 0) {
      showToast("❌ No notes to copy");
      return;
    }
    const textDump = currentFilteredNotes.map((n) => n.text).join("\n\n");
    navigator.clipboard
      .writeText(textDump)
      .then(() => showToast(`📋 Copied ${currentFilteredNotes.length} notes!`))
      .catch(() => showToast("❌ Failed to copy notes"));
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

searchInput.addEventListener(
  "input",
  debounce(() => {
    currentPage = 1;
    filterAndRender();
  }, 200)
);

// ── Load saved notes ──────────────────────────────────────────────────────────
function loadNotes() {
  chrome.runtime.sendMessage({ action: "getNotes" }, (response) => {
    allNotes = (response?.notes || []).reverse();
    updateStorageIndicator();
    filterAndRender();
  });
}

// ── Theme toggle ──────────────────────────────────────────────────────────────
function applyTheme(dark) {
  document.documentElement.dataset.theme = dark ? "dark" : "light";
  themeToggle.checked = dark;
}

themeToggle.addEventListener("change", () => {
  const dark = themeToggle.checked;
  applyTheme(dark);
  savePrefs({ theme: dark ? "dark" : "light" });
});

// ── Layout toggle ─────────────────────────────────────────────────────────────
function applyLayout(double_) {
  document.documentElement.dataset.layout = double_ ? "double" : "single";
  layoutToggle.checked = double_;
  filterAndRender();
}

layoutToggle.addEventListener("change", () => {
  const double_ = layoutToggle.checked;
  applyLayout(double_);
  savePrefs({ layout: double_ ? "double" : "single" });
});

// ── Export / Clear ────────────────────────────────────────────────────────────
exportBtn.addEventListener("click", () => {
  chrome.runtime.sendMessage({ action: "exportNotes" });
  showToast("📄 Exported as .md file!");
  exportBtn.textContent = "✓ Exported!";
  setTimeout(() => {
    exportBtn.textContent = "⬇ Export .md";
  }, 2200);
});

clearBtn.addEventListener("click", () => {
  if (confirm("Delete all saved notes permanently?")) {
    chrome.runtime.sendMessage({ action: "clearNotes" }, () => {
      allNotes = [];
      currentPage = 1;
      render([]);
      showToast("🗑 All notes cleared");
    });
  }
});

// Auto-refresh when a new note is saved from context menu
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.action === "refreshNotes") loadNotes();
});

// ── Storage indicator ─────────────────────────────────────────────────────────
function updateStorageIndicator() {
  chrome.storage.local.getBytesInUse(null, (bytesUsed) => {
    if (chrome.runtime.lastError || bytesUsed === undefined) return;
    const kb = bytesUsed / 1024;
    const mb = kb / 1024;
    const LIMIT_MB = 10;

    let label,
      cls = "";
    if (mb >= 1) {
      label = `💾 ${mb.toFixed(2)} MB used`;
      if (mb > LIMIT_MB * 0.8) cls = "alert";
      else if (mb > LIMIT_MB * 0.5) cls = "warn";
    } else {
      label = `💾 ${kb.toFixed(1)} KB used`;
    }

    storageIndicator.textContent = label;
    storageIndicator.className = "storage-indicator" + (cls ? ` ${cls}` : "");
  });
}

// ═════════════════════════════════════════════════════════════════════════════
//  VIEW TABS — Notes | Notepad | Typed
// ═════════════════════════════════════════════════════════════════════════════
const viewTabBtns = document.querySelectorAll(".view-tab-btn");
const viewPanels = document.querySelectorAll(".view-panel");

function switchView(viewName) {
  viewTabBtns.forEach((btn) =>
    btn.classList.toggle("active", btn.dataset.view === viewName)
  );
  viewPanels.forEach((panel) =>
    panel.classList.toggle("active", panel.id === `view-${viewName}`)
  );
  if (viewName === "typed") loadTypedNotes();
  if (viewName === "notepad") document.getElementById("notepadTextarea")?.focus();
}

viewTabBtns.forEach((btn) => {
  btn.addEventListener("click", () => switchView(btn.dataset.view));
});

// ═════════════════════════════════════════════════════════════════════════════
//  NOTEPAD
// ═════════════════════════════════════════════════════════════════════════════
const notepadTextarea = document.getElementById("notepadTextarea");
const notepadTarget = document.getElementById("notepadTarget");
const saveNoteBtn = document.getElementById("saveNoteBtn");
const cancelEditBtn = document.getElementById("cancelEditBtn");
const editBadge = document.getElementById("editBadge");

// notes.html is a full-page tab — no active-browser-tab context, leave target blank
if (notepadTarget) notepadTarget.textContent = "";

// Intercept Tab key in the notepad textarea to insert indentation
if (notepadTextarea) {
  notepadTextarea.addEventListener("keydown", (e) => {
    if (e.key === "Tab") {
      e.preventDefault();
      const start = notepadTextarea.selectionStart;
      const end = notepadTextarea.selectionEnd;
      const indent = "  "; // 2-space indentation
      notepadTextarea.value =
        notepadTextarea.value.substring(0, start) +
        indent +
        notepadTextarea.value.substring(end);
      // Move cursor to after the inserted indentation
      notepadTextarea.selectionStart = notepadTextarea.selectionEnd =
        start + indent.length;
    }
  });
}

if (saveNoteBtn) {
  saveNoteBtn.addEventListener("click", () => {
    const text = notepadTextarea.value.trim();
    if (!text) {
      showToast("Nothing to save");
      return;
    }

    saveNoteBtn.disabled = true;

    // ── Editing an existing typed note → update it in place ──
    // (only text + notebook are sent; images, date and source are untouched)
    if (editingNoteId !== null) {
      chrome.runtime.sendMessage(
        {
          action: "updateTypedNote",
          id: editingNoteId,
          updates: { text, notebookId: activeNotebookId },
        },
        (response) => {
          saveNoteBtn.disabled = false;
          if (response?.success) {
            finishEditing();
            showToast("✅ Note updated");
            switchView("typed");
          } else {
            showToast("❌ Update failed");
          }
        }
      );
      return;
    }

    const note = {
      id: Date.now(),
      text,
      url: "",
      title: "",
      domain: "",
      timestamp: new Date().toISOString(),
      notebookId: activeNotebookId,
    };

    chrome.runtime.sendMessage(
      { action: "saveTypedNote", note },
      (response) => {
        saveNoteBtn.disabled = false;
        if (response?.success) {
          notepadTextarea.value = "";
          showToast("✅ Note saved");
          const typedPanel = document.getElementById("view-typed");
          if (typedPanel?.classList.contains("active")) loadTypedNotes();
        } else {
          showToast("❌ Save failed");
        }
      }
    );
  });
}

// ═════════════════════════════════════════════════════════════════════════════
//  TYPED NOTES
// ═════════════════════════════════════════════════════════════════════════════
// ── Notebooks (shared with the popup via chrome.storage) ─────────────────────
const NOTEBOOKS_KEY = "notebooks";
const ACTIVE_NOTEBOOK_KEY = "activeNotebook";
const nbDropdown = document.getElementById("nbDropdown");
const nbTrigger = document.getElementById("nbTrigger");
const nbTriggerLabel = document.getElementById("nbTriggerLabel");
const nbMenu = document.getElementById("nbMenu");
const typedFilterEl = document.getElementById("typedFilter");
const typedCountEl = document.getElementById("typedCount");
const typedPaginationEl = document.getElementById("typedPagination");

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

// persist=false while editing a note, so choosing a notebook for that note
// doesn't change where *new* notes are saved.
function setActiveNotebook(id, persist = true) {
  activeNotebookId = id || null;
  if (persist) {
    chrome.storage.local.set({ [ACTIVE_NOTEBOOK_KEY]: activeNotebookId });
  }
  renderNotebookUI();
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
        showToast("✏️ Notebook renamed");
      }
    }
    renderNotebookUI();
    renderTypedNotes(); // chips + filter pick up the new name
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
  if (saveNoteBtn) saveNoteBtn.textContent = editing ? "Update note" : "Save note";
  if (cancelEditBtn) cancelEditBtn.hidden = !editing;
  if (editBadge) editBadge.hidden = !editing;
}

function startEditingNote(note) {
  if (
    notepadTextarea.value.trim() !== "" &&
    notepadTextarea.value !== note.text &&
    !confirm("Replace what's currently in the Notepad with this note?")
  ) {
    return;
  }
  editingNoteId = note.id;
  notepadTextarea.value = note.text;
  setActiveNotebook(
    notebooks.some((n) => n.id === note.notebookId) ? note.notebookId : null,
    false
  );
  updateEditUI();
  switchView("notepad");
  const end = notepadTextarea.value.length;
  notepadTextarea.setSelectionRange(end, end);
}

function finishEditing() {
  editingNoteId = null;
  notepadTextarea.value = "";
  updateEditUI();
  restoreActiveNotebook();
}

if (cancelEditBtn) {
  cancelEditBtn.addEventListener("click", () => {
    finishEditing();
    switchView("typed");
  });
}

// Keep this page in step with the popup: if notebooks or typed notes change in
// storage from somewhere else, pick the change up. Changes this page made
// itself are already reflected in memory, so they're skipped.
chrome.storage.onChanged?.addListener((changes, area) => {
  if (area !== "local") return;
  if (changes[NOTEBOOKS_KEY]) {
    const next = changes[NOTEBOOKS_KEY].newValue || [];
    if (JSON.stringify(next) !== JSON.stringify(notebooks)) {
      notebooks = next;
      if (!notebooks.some((n) => n.id === activeNotebookId)) {
        activeNotebookId = null;
      }
      if (!nbMenu.querySelector(".nb-rename-input")) renderNotebookUI();
      if (document.getElementById("view-typed")?.classList.contains("active")) {
        renderTypedNotes();
      }
    }
  }
  if (changes.typedNotes) {
    const next = (changes.typedNotes.newValue || []).slice().reverse();
    if (
      JSON.stringify(next) !== JSON.stringify(allTypedNotes) &&
      document.getElementById("view-typed")?.classList.contains("active")
    ) {
      allTypedNotes = next;
      renderTypedNotes();
    }
  }
});

const typedLeftCol = document.getElementById("typedLeftCol");
const typedRightCol = document.getElementById("typedRightCol");
const clearTypedBtn = document.getElementById("clearTypedBtn");

function typedNoteCardHTML(note) {
  const COPY_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>`;
  return `
  <div class="note-card" data-id="${note.id}">
    <button class="typed-note-edit" data-id="${note.id}" title="Edit note" aria-label="Edit">✎</button>
    <button class="typed-note-delete" data-id="${note.id}" title="Delete">✕</button>
    <div class="note-meta-row">
      <span class="note-time">${formatTime(note.timestamp)}</span>
      ${notebookName(note.notebookId) ? `<span class="nb-chip" title="Notebook">${esc(notebookName(note.notebookId))}</span>` : ""}
      ${note.url ? `<a class="note-source-link" href="${esc(note.url)}" target="_blank" title="${esc(note.url)}">↗ ${esc(note.title || note.url)}</a>` : ""}
    </div>
    <div class="typed-note-body">
      <div class="md-content" data-raw="${esc(note.text)}">${Markdown.render(note.text, note.images || {})}</div>
    </div>
    <div class="typed-card-actions">
      <button class="typed-expand-btn" title="Expand / collapse">Show more</button>
      <button class="typed-copy-btn" data-id="${note.id}" title="Copy note text">${COPY_SVG}</button>
    </div>
  </div>`;
}

function buildTypedColHTML(grouped) {
  return grouped
    .map((g) => {
      const totalNotes = g.domains.reduce((s, d) => s + d.notes.length, 0);
      let html = `<div class="date-block">
      <div class="date-heading">
        <span class="date-label">${formatDateHeading(g.dateKey)}</span>
        <div class="date-rule"></div>
        <span class="date-count">${totalNotes} note${totalNotes !== 1 ? "s" : ""}</span>
      </div>`;
      for (const { domain, notes: dn } of g.domains) {
        if (domain) {
          html += `<div class="domain-block">
          <div class="domain-heading">
            <img class="domain-favicon" src="${faviconUrl(domain)}" alt="" />
            <span class="domain-name">${esc(domain)}</span>
          </div>`;
          dn.forEach((n) => {
            html += typedNoteCardHTML(n);
          });
          html += `</div>`;
        } else {
          dn.forEach((n) => {
            html += typedNoteCardHTML(n);
          });
        }
      }
      html += `</div>`;
      return html;
    })
    .join("");
}

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

function getFilteredTypedNotes() {
  if (typedFilter === "all") return allTypedNotes;
  if (typedFilter === "none") {
    return allTypedNotes.filter((n) => !notebookName(n.notebookId));
  }
  return allTypedNotes.filter((n) => n.notebookId === typedFilter);
}

if (typedFilterEl) {
  typedFilterEl.addEventListener("change", () => {
    typedFilter = typedFilterEl.value;
    typedPage = 1;
    renderTypedNotes();
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
  const makeBtn = (label, page, disabled = false, active = false) =>
    `<button class="pg-btn${active ? " active" : ""}" data-page="${page}" ${disabled ? "disabled" : ""}>${label}</button>`;

  let html = makeBtn("←", typedPage - 1, typedPage === 1);
  const range = [];
  if (pages <= 7) {
    for (let i = 1; i <= pages; i++) range.push(i);
  } else {
    range.push(1);
    if (typedPage > 3) range.push("…");
    for (
      let i = Math.max(2, typedPage - 1);
      i <= Math.min(pages - 1, typedPage + 1);
      i++
    )
      range.push(i);
    if (typedPage < pages - 2) range.push("…");
    range.push(pages);
  }
  for (const r of range) {
    html +=
      r === "…"
        ? `<span class="pg-ellipsis">…</span>`
        : makeBtn(r, r, false, r === typedPage);
  }
  html += makeBtn("→", typedPage + 1, typedPage === pages);
  typedPaginationEl.innerHTML = html;

  typedPaginationEl.querySelectorAll(".pg-btn:not([disabled])").forEach((btn) => {
    btn.addEventListener("click", () => {
      typedPage = parseInt(btn.dataset.page);
      renderTypedNotes();
      window.scrollTo({ top: 0, behavior: "smooth" });
    });
  });
}

function renderTypedNotes() {
  if (!typedLeftCol || !typedRightCol) return;

  renderTypedFilter();
  const filtered = getFilteredTypedNotes();
  const pages = Math.max(1, Math.ceil(filtered.length / TYPED_PER_PAGE));
  if (typedPage > pages) typedPage = pages;

  if (typedCountEl) {
    typedCountEl.textContent = `${filtered.length} note${filtered.length !== 1 ? "s" : ""}`;
  }

  if (filtered.length === 0) {
    const none = allTypedNotes.length === 0;
    typedLeftCol.innerHTML = `
      <div class="typed-empty-state">
        <div class="big-icon">✎</div>
        <h2>${none ? "No typed notes yet" : "No notes in this notebook"}</h2>
        <p>${
          none
            ? "Switch to the <strong>Notepad</strong> tab and write your first note."
            : "Pick another notebook from the dropdown, or choose <strong>All notebooks</strong>."
        }</p>
      </div>`;
    typedRightCol.innerHTML = "";
    renderTypedPagination(0);
    return;
  }

  const pageNotes = filtered.slice(
    (typedPage - 1) * TYPED_PER_PAGE,
    typedPage * TYPED_PER_PAGE
  );

  // Split evenly across the two book-layout columns (5 + 5 for a full page)
  const mid = Math.ceil(pageNotes.length / 2);
  typedLeftCol.innerHTML = buildTypedColHTML(groupNotes(pageNotes.slice(0, mid)));
  typedRightCol.innerHTML = buildTypedColHTML(groupNotes(pageNotes.slice(mid)));

  // ── Hide expand button when content doesn't overflow the cap ──
  document.querySelectorAll("#view-typed .md-content").forEach((el) => {
    // scrollHeight === clientHeight means no overflow — content fits
    if (el.scrollHeight <= el.clientHeight) {
      const btn = el.closest(".note-card")?.querySelector(".typed-expand-btn");
      if (btn) btn.style.display = "none";
    }
  });

  // ── Expand / collapse ──────────────────────────────────────────
  document.querySelectorAll("#view-typed .typed-expand-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const mdEl = btn.closest(".note-card")?.querySelector(".md-content");
      if (!mdEl) return;
      const expanded = mdEl.classList.toggle("expanded");
      btn.textContent = expanded ? "Show less" : "Show more";
    });
  });

  // ── Copy ──────────────────────────────────────────────────────
  document.querySelectorAll("#view-typed .typed-copy-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const mdEl = btn.closest(".note-card")?.querySelector(".md-content");
      if (!mdEl) return;
      // Use data-raw for the original plain text
      const rawText = mdEl.dataset.raw || mdEl.textContent;
      navigator.clipboard
        .writeText(rawText)
        .then(() => {
          btn.classList.add("copied");
          showToast("📋 Copied!");
          setTimeout(() => btn.classList.remove("copied"), 1800);
        })
        .catch(() => showToast("❌ Failed to copy"));
    });
  });

  // ── Edit ──────────────────────────────────────────────────────
  document.querySelectorAll("#view-typed .typed-note-edit").forEach((btn) => {
    btn.addEventListener("click", () => {
      const note = allTypedNotes.find((n) => n.id === parseInt(btn.dataset.id));
      if (note) startEditingNote(note);
    });
  });

  // ── Delete ────────────────────────────────────────────────────
  document.querySelectorAll("#view-typed .typed-note-delete").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = parseInt(btn.dataset.id);
      chrome.runtime.sendMessage({ action: "deleteTypedNote", id }, () => {
        loadTypedNotes();
        showToast("🗑 Note deleted");
      });
    });
  });

  renderTypedPagination(filtered.length);
}

function loadTypedNotes() {
  chrome.runtime.sendMessage({ action: "getTypedNotes" }, (response) => {
    allTypedNotes = (response?.notes || []).slice().reverse();
    renderTypedNotes();
    updateStorageIndicator();
  });
}

if (clearTypedBtn) {
  clearTypedBtn.addEventListener("click", () => {
    if (confirm("Delete all typed notes permanently?")) {
      chrome.runtime.sendMessage({ action: "clearTypedNotes" }, () => {
        allTypedNotes = [];
        typedPage = 1;
        renderTypedNotes();
        showToast("🗑 All typed notes cleared");
      });
    }
  });
}

// ── Init ──────────────────────────────────────────────────────────────────────
(async () => {
  const prefs = await loadPrefs();
  applyTheme(prefs.theme === "dark");
  applyLayout(prefs.layout !== "single"); // double unless explicitly "single"
  await loadNotebooks();
  loadNotes();
})();