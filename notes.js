// notes.js — full-page notes viewer with pagination, double/single layout, dark/light theme

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

// ── Grouping ──────────────────────────────────────────────────────────────────
// Returns: [ { dateKey, domains: [ { domain, notes:[] } ] } ] sorted newest first
function groupNotes(notes) {
  const map = {};
  for (const note of notes) {
    const dk = getDateKey(note.timestamp);
    const domain = note.domain || getDomain(note.url);
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

// ── Build HTML for one note card ──────────────────────────────────────────────
function noteCardHTML(note, idx) {
  const paragraphs = note.text
    .split(/\n{2,}/)
    .map((p) => `<p>${esc(p.trim())}</p>`)
    .join("");

  // Calculate copy dot states
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

// ── Build HTML for a full date→domain group ───────────────────────────────────
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
        <img class="domain-favicon" src="${faviconUrl(domain)}" alt=""
               data-favicon="1"/>
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
// Paginate over a flat list of notes; each page = up to PER_PAGE notes.
// Then re-group the page's notes for display.
function getPageNotes(filtered) {
  const start = (currentPage - 1) * PER_PAGE;
  return currentFilteredNotes.slice(start, start + PER_PAGE);
}

function totalPages(filtered) {
  return Math.max(1, Math.ceil(currentFilteredNotes.length / PER_PAGE));
}

// ── Render ────────────────────────────────────────────────────────────────────
function render(filtered) {
  const total = allNotes.length;
  const fTotal = filtered.length;
  const pages = totalPages(filtered);
  const isDouble = document.documentElement.dataset.layout === "double";

  topbarStats.textContent =
    total === 0 ? "" : `${total} note${total !== 1 ? "s" : ""}`;

  // Clamp currentPage
  if (currentPage > pages) currentPage = pages;

  // Empty state — put in leftCol spanning both
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

  // Slice notes for current page
  const pageNotes = getPageNotes(filtered);

  // Page info
  const startN = (currentPage - 1) * PER_PAGE + 1;
  const endN = Math.min(currentPage * PER_PAGE, fTotal);
  pageInfo.textContent = `${startN}–${endN} of ${fTotal} note${fTotal !== 1 ? "s" : ""}`;

  if (isDouble) {
    // FIX: Split the 20 individual notes directly down the middle first
    const leftNotes = pageNotes.slice(0, PER_PAGE / 2);
    const rightNotes = pageNotes.slice(PER_PAGE / 2, PER_PAGE);

    // Then group them separately so the layout engines processes them per-column
    const leftGrouped = groupNotes(leftNotes);
    const rightGrouped = groupNotes(rightNotes);

    leftCol.innerHTML = leftGrouped
      .map((g, i) => dateBlockHTML(g, i * 0.06))
      .join("");
    rightCol.innerHTML = rightGrouped.length
      ? rightGrouped.map((g, i) => dateBlockHTML(g, i * 0.06)).join("")
      : "";
  } else {
    // Single page mode: group all 20 together
    const grouped = groupNotes(pageNotes);
    leftCol.innerHTML = grouped
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

  document.querySelectorAll(".note-copy").forEach((btn) => {
    btn.addEventListener("click", () => {
      // Find the specific note by its ID
      const id = parseInt(btn.dataset.id);
      const noteToCopy = allNotes.find((n) => n.id === id);

      if (noteToCopy) {
        // Use the browser's Clipboard API to copy the pure text
        navigator.clipboard
          .writeText(noteToCopy.text)
          .then(() => {
            showToast("📋 Copied to clipboard!");

            // 1. Increment the copy counter in memory
            noteToCopy.copyCount = (noteToCopy.copyCount || 0) + 1;

            // 2. Update the UI immediately without re-rendering the whole page
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

            // 3. Save the updated copy count permanently to Chrome Storage
            chrome.storage.local.get(["notes"], (res) => {
              const dbNotes = res.notes || [];
              const dbNote = dbNotes.find((n) => n.id === id);
              if (dbNote) {
                dbNote.copyCount = noteToCopy.copyCount;
                chrome.storage.local.set({ notes: dbNotes });
              }
            });
          })
          .catch((err) => {
            showToast("❌ Failed to copy");
          });
      }
    });
  });

  // Pagination bar
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

  // Show at most 7 page buttons with ellipsis
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

const caseSensitiveBtn = document.getElementById("caseSensitiveBtn");
const copyAllBtn = document.getElementById("copyAllBtn");

// ── State ─────────────────────────────────────────────────────────────────────
// (Keep your existing state references, and append these two below)
let isCaseSensitive = false;
let currentFilteredNotes = [];

// Clean programmatic inject of standard SVG Copy structure
if (copyAllBtn) {
  copyAllBtn.innerHTML = `
    <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
      <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
    </svg>`;
  copyAllBtn.disabled = true; // Initialize disabled when search is blank
}

// ── Filter + render ───────────────────────────────────────────────────────────
function filterAndRender() {
  const query = searchInput.value.trim();

  // Handle the Copy All button state based on search query presence
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

  render(currentFilteredNotes);
}

// ── Search Action Handlers ────────────────────────────────────────────────────
if (copyAllBtn) {
  copyAllBtn.addEventListener("click", () => {
    if (currentFilteredNotes.length === 0) {
      showToast("❌ No notes to copy");
      return;
    }

    // Concatenate only the plain text body contents without headings or dates
    const textDump = currentFilteredNotes.map((n) => n.text).join("\n\n");

    navigator.clipboard
      .writeText(textDump)
      .then(() => {
        showToast(`📋 Copied ${currentFilteredNotes.length} notes!`);
      })
      .catch(() => {
        showToast("❌ Failed to copy notes");
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
  filterAndRender(); // re-split columns
}

layoutToggle.addEventListener("change", () => {
  const double_ = layoutToggle.checked;
  applyLayout(double_);
  savePrefs({ layout: double_ ? "double" : "single" });
});

function debounce(fn, delay) {
  let timer;
  return function (...args) {
    clearTimeout(timer);
    timer = setTimeout(() => fn.apply(this, args), delay);
  };
}

// ── Other events ──────────────────────────────────────────────────────────────
searchInput.addEventListener(
  "input",
  debounce(() => {
    currentPage = 1;
    filterAndRender();
  }, 200)
);

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

// Auto-refresh when a new note is saved
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.action === "refreshNotes") loadNotes();
});

// ── Init ──────────────────────────────────────────────────────────────────────
(async () => {
  const prefs = await loadPrefs();

  // Apply saved theme (default light)
  applyTheme(prefs.theme === "dark");

  // Apply saved layout (default double)
  applyLayout(prefs.layout !== "single"); // double unless explicitly "single"

  loadNotes();
})();

// ── Storage usage display ──────────────────────────────────────────────────────
function updateStorageIndicator() {
  chrome.storage.local.getBytesInUse(null, (bytesUsed) => {
    if (chrome.runtime.lastError || bytesUsed === undefined) return;

    const kb = bytesUsed / 1024;
    const mb = kb / 1024;
    const LIMIT_MB = 10; // default cap (unlimitedStorage removes this, but useful reference)

    let label,
      cls = "";
    if (mb >= 1) {
      const pct = ((mb / LIMIT_MB) * 100).toFixed(0);
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
