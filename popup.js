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

// ── State ─────────────────────────────────────────────────────────────────────
let allNotes = [];
let currentPage = 1;
const PER_PAGE = 10;
let isDark = true;

// ── SVG Icons ─────────────────────────────────────────────────────────────────
const COPY_SVG = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>`;
const DEL_SVG = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/></svg>`;

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
        html += `
        <div class="note-card" data-id="${note.id}">
          <div class="note-top">
            <span class="note-time">${time}</span>
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

const caseSensitiveBtn = document.getElementById("caseSensitiveBtn");
const copyAllBtn = document.getElementById("copyAllBtn");

if (copyAllBtn) {
  copyAllBtn.innerHTML = COPY_SVG;
  copyAllBtn.disabled = true; // Initially disabled since the search bar starts empty
}

// ── State ─────────────────────────────────────────────────────────────────────
// (Keep your existing state variables and add this toggle tracking)
let isCaseSensitive = false;
let currentFilteredNotes = []; // Keeps track of exactly what is visible to the user

// Add the Copy SVG icon to your copy all button programmatically
if (copyAllBtn) copyAllBtn.innerHTML = COPY_SVG;

// ── Filter & Render ───────────────────────────────────────────────────────────
// ── Filter & Render ───────────────────────────────────────────────────────────
function filterAndRender() {
  const query = searchInput.value.trim();

  // Disable the copy button if the search bar is empty
  if (query === "") {
    copyAllBtn.disabled = true;
  } else {
    copyAllBtn.disabled = false;
  }

  // Apply filtering with respect to case sensitivity flag
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
copyAllBtn.addEventListener("click", () => {
  if (currentFilteredNotes.length === 0) {
    showToast("No notes to copy");
    return;
  }

  // Concatenate only the plain text bodies, separated cleanly by line breaks
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

// ── Case Sensitivity Toggle ───────────────────────────────────────────────────
caseSensitiveBtn.addEventListener("click", () => {
  isCaseSensitive = !isCaseSensitive;
  caseSensitiveBtn.classList.toggle("active", isCaseSensitive);
  currentPage = 1;
  filterAndRender();
});

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
      if (note)
        navigator.clipboard
          .writeText(note.text)
          .then(() => showToast("copied"));
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
searchInput.addEventListener("input", debounce(() => {
  currentPage = 1;
  filterAndRender();
}, 200));

// ── Full View ─────────────────────────────────────────────────────────────────
openFullBtn.addEventListener("click", async () => {
  const url = chrome.runtime.getURL("notes.html");
  const existing = await chrome.tabs.query({ url });
  if (existing.length > 0) {
    await chrome.tabs.update(existing[0].id, { active: true });
    await chrome.windows.update(existing[0].windowId, { focused: true });
  } else {
    await chrome.tabs.create({ url });
  }
  window.close();
});

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
const STORAGE_MAX_KB = 5120; // Chrome local storage ~5MB

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

// ── Init ──────────────────────────────────────────────────────────────────────
(async () => {
  const prefs = await loadPrefs();
  applyTheme(prefs.theme !== "light");
  loadNotes();
})();
