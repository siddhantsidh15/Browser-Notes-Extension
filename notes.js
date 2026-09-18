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
      render: (_match, code) => `<pre class="md-code"><code>${code}</code></pre>`,
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

  render(rawText) {
    let html = esc(rawText || "");
    for (const rule of this.rules) {
      html = html.replace(rule.pattern, (...args) => rule.render(...args));
    }
    return html;
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
    notes.forEach((note, i) => { html += noteCardHTML(note, i); });
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
    leftCol.innerHTML = groupNotes(leftNotes).map((g, i) => dateBlockHTML(g, i * 0.06)).join("");
    const rg = groupNotes(rightNotes);
    rightCol.innerHTML = rg.length ? rg.map((g, i) => dateBlockHTML(g, i * 0.06)).join("") : "";
  } else {
    leftCol.innerHTML = groupNotes(pageNotes).map((g, i) => dateBlockHTML(g, i * 0.06)).join("");
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

      navigator.clipboard.writeText(noteToCopy.text).then(() => {
        showToast("📋 Copied to clipboard!");
        noteToCopy.copyCount = (noteToCopy.copyCount || 0) + 1;

        const card = document.querySelector(`.note-card[data-id="${id}"]`);
        if (card) {
          const dots = card.querySelectorAll(".copy-dot");
          if (noteToCopy.copyCount >= 1 && dots[0]) dots[0].classList.add("active");
          if (noteToCopy.copyCount >= 2 && dots[1]) dots[1].classList.add("active");
          if (noteToCopy.copyCount >= 3 && dots[2]) dots[2].classList.add("active");
          card.querySelector(".copy-indicators").title = `Copied ${noteToCopy.copyCount} times`;
        }

        chrome.storage.local.get(["notes"], (res) => {
          const dbNotes = res.notes || [];
          const dbNote = dbNotes.find((n) => n.id === id);
          if (dbNote) {
            dbNote.copyCount = noteToCopy.copyCount;
            chrome.storage.local.set({ notes: dbNotes });
          }
        });
      }).catch(() => showToast("❌ Failed to copy"));
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
    for (let i = Math.max(2, currentPage - 1); i <= Math.min(pages - 1, currentPage + 1); i++)
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
          return text.includes(query) || title.includes(query) || domain.includes(query) || url.includes(query);
        } else {
          const q = query.toLowerCase();
          return text.toLowerCase().includes(q) || title.toLowerCase().includes(q) || domain.toLowerCase().includes(q) || url.toLowerCase().includes(q);
        }
      })
    : allNotes;

  render(currentFilteredNotes);
}

if (copyAllBtn) {
  copyAllBtn.addEventListener("click", () => {
    if (currentFilteredNotes.length === 0) { showToast("❌ No notes to copy"); return; }
    const textDump = currentFilteredNotes.map((n) => n.text).join("\n\n");
    navigator.clipboard.writeText(textDump)
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

searchInput.addEventListener("input", debounce(() => { currentPage = 1; filterAndRender(); }, 200));

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
  setTimeout(() => { exportBtn.textContent = "⬇ Export .md"; }, 2200);
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

    let label, cls = "";
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

// notes.html is a full-page tab — no active-browser-tab context, leave target blank
if (notepadTarget) notepadTarget.textContent = "";

if (saveNoteBtn) {
  saveNoteBtn.addEventListener("click", () => {
    const text = notepadTextarea.value.trim();
    if (!text) { showToast("Nothing to save"); return; }

    saveNoteBtn.disabled = true;

    const note = {
      id: Date.now(),
      text,
      url: "",
      title: "",
      domain: "",
      timestamp: new Date().toISOString(),
    };

    chrome.runtime.sendMessage({ action: "saveTypedNote", note }, (response) => {
      saveNoteBtn.disabled = false;
      if (response?.success) {
        notepadTextarea.value = "";
        showToast("✅ Note saved");
        const typedPanel = document.getElementById("view-typed");
        if (typedPanel?.classList.contains("active")) loadTypedNotes();
      } else {
        showToast("❌ Save failed");
      }
    });
  });
}

// ═════════════════════════════════════════════════════════════════════════════
//  TYPED NOTES
// ═════════════════════════════════════════════════════════════════════════════
const typedLeftCol = document.getElementById("typedLeftCol");
const typedRightCol = document.getElementById("typedRightCol");
const clearTypedBtn = document.getElementById("clearTypedBtn");

function typedNoteCardHTML(note) {
  const COPY_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>`;
  return `
  <div class="note-card" data-id="${note.id}">
    <button class="typed-note-delete" data-id="${note.id}" title="Delete">✕</button>
    <div class="note-meta-row">
      <span class="note-time">${formatTime(note.timestamp)}</span>
      ${note.url ? `<a class="note-source-link" href="${esc(note.url)}" target="_blank" title="${esc(note.url)}">↗ ${esc(note.title || note.url)}</a>` : ""}
    </div>
    <div class="typed-note-body">
      <div class="md-content" data-raw="${esc(note.text)}">${Markdown.render(note.text)}</div>
    </div>
    <div class="typed-card-actions">
      <button class="typed-expand-btn" title="Expand / collapse">Show more</button>
      <button class="typed-copy-btn" data-id="${note.id}" title="Copy note text">${COPY_SVG}</button>
    </div>
  </div>`;
}

function buildTypedColHTML(grouped) {
  return grouped.map((g) => {
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
        dn.forEach((n) => { html += typedNoteCardHTML(n); });
        html += `</div>`;
      } else {
        dn.forEach((n) => { html += typedNoteCardHTML(n); });
      }
    }
    html += `</div>`;
    return html;
  }).join("");
}

function renderTypedNotes(notes) {
  if (!typedLeftCol || !typedRightCol) return;

  if (notes.length === 0) {
    typedLeftCol.innerHTML = `
      <div class="typed-empty-state">
        <div class="big-icon">✎</div>
        <h2>No typed notes yet</h2>
        <p>Switch to the <strong>Notepad</strong> tab and write your first note.</p>
      </div>`;
    typedRightCol.innerHTML = "";
    return;
  }

  // Split evenly across the two book-layout columns
  const mid = Math.ceil(notes.length / 2);
  typedLeftCol.innerHTML = buildTypedColHTML(groupNotes(notes.slice(0, mid)));
  typedRightCol.innerHTML = buildTypedColHTML(groupNotes(notes.slice(mid)));

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
      navigator.clipboard.writeText(rawText).then(() => {
        btn.classList.add("copied");
        showToast("📋 Copied!");
        setTimeout(() => btn.classList.remove("copied"), 1800);
      }).catch(() => showToast("❌ Failed to copy"));
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
}

function loadTypedNotes() {
  chrome.runtime.sendMessage({ action: "getTypedNotes" }, (response) => {
    allTypedNotes = (response?.notes || []).slice().reverse();
    renderTypedNotes(allTypedNotes);
    updateStorageIndicator();
  });
}

if (clearTypedBtn) {
  clearTypedBtn.addEventListener("click", () => {
    if (confirm("Delete all typed notes permanently?")) {
      chrome.runtime.sendMessage({ action: "clearTypedNotes" }, () => {
        allTypedNotes = [];
        renderTypedNotes([]);
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
  loadNotes();
})();
