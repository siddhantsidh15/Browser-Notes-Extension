// note-view.js — full-page reader / editor for one typed note.
// Opened from the Typed tab ("open in a full tab") as note-view.html?id=<noteId>&from=<tabId>

(() => {
  const $ = (id) => document.getElementById(id);
  const params = new URLSearchParams(location.search);
  const noteId = Number(params.get("id"));
  const fromTab = Number(params.get("from"));
  const isMac = /Mac|iPhone|iPad/.test(navigator.platform);

  const reader = $("reader");
  const editor = $("editor");
  let note = null;
  let notebooks = [];
  let images = {}; // id -> data URL, for the note while it is being edited
  let editing = false;
  let isDark = true;

  $("saveKeys").textContent = isMac ? "⌘S" : "Ctrl+S";

  // ── Small helpers ──────────────────────────────────────────────────────────
  let toastTimer = 0;
  function toast(msg, ms = 1800) {
    const t = $("toast");
    t.textContent = msg;
    t.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove("show"), ms);
  }

  const fmt = (iso) => new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });

  // Words / read time ignore the formatting markers
  function noteStats(text, imgs) {
    const clean = String(text || "")
      .replace(/\[\[img:[\w-]+\]\]/g, " ")
      .replace(/\[[cC][oO][dD][eE]\]/g, " ")
      .replace(/>C/g, " ")
      .replace(/^#{1,3}[ \t]+/gm, "");
    const words = clean.split(/\s+/).filter(Boolean).length;
    const imgCount = Object.keys(imgs || {}).length;
    const mins = Math.max(1, Math.round(words / 200));
    return `${words.toLocaleString()} word${words === 1 ? "" : "s"} · ${String(text).length.toLocaleString()} characters` +
      (imgCount ? ` · ${imgCount} image${imgCount === 1 ? "" : "s"}` : "") +
      ` · ~${mins} min read`;
  }

  const notebookName = (id) => notebooks.find((n) => n.id === id)?.name || "";
  const isDirty = () => editing && editor.value !== note.text;

  // ── Theme (shares the popup's saved preference) ────────────────────────────
  function applyTheme(dark) {
    isDark = dark;
    document.documentElement.dataset.theme = dark ? "dark" : "light";
    $("themeBtn").textContent = dark ? "☀" : "☽";
    $("themeBtn").title = dark ? "Light mode" : "Dark mode";
  }
  $("themeBtn").addEventListener("click", async () => {
    applyTheme(!isDark);
    const r = await chrome.storage.local.get(["prefs"]);
    await chrome.storage.local.set({ prefs: { ...(r.prefs || {}), theme: isDark ? "dark" : "light" } });
  });

  // ── Rendering ──────────────────────────────────────────────────────────────
  function showMissing(msg) {
    $("article").hidden = true;
    $("viewActions").hidden = true;
    $("state").hidden = false;
    if (msg) $("stateText").textContent = msg;
  }

  function render() {
    if (!note) return showMissing();
    $("state").hidden = true;
    $("article").hidden = false;

    const title = (note.title || "").trim() || note.domain || "Untitled note";
    const link = $("titleLink");
    link.textContent = title;
    if (note.url) link.href = note.url;
    else link.removeAttribute("href");
    document.title = `${title} — Save to Notes`;

    const sub = $("noteSub");
    sub.textContent = "";
    const bits = [`Saved ${fmt(note.timestamp)}`];
    if (note.updatedAt) bits.push(`edited ${fmt(note.updatedAt)}`);
    for (const b of bits) {
      const s = document.createElement("span");
      s.textContent = b;
      sub.append(s);
    }
    const nb = notebookName(note.notebookId);
    if (nb) {
      const chip = document.createElement("span");
      chip.className = "nb-chip";
      chip.textContent = nb;
      sub.append(chip);
    }
    if (note.url) {
      const a = document.createElement("a");
      a.href = note.url;
      a.target = "_blank";
      a.rel = "noopener";
      a.textContent = (note.domain || note.url) + " ↗";
      sub.append(a);
    }

    // The newline after a heading / code block / box / image would show as an extra blank line
    reader.innerHTML = Markdown.render(note.text, note.images || {}).replace(/(<\/(?:h[123]|pre|div)>|<img [^>]*>)\n/g, "$1");
    $("stats").textContent = noteStats(note.text, note.images);
  }

  function setMode(edit) {
    editing = edit;
    reader.hidden = edit;
    editor.hidden = !edit;
    $("editHint").hidden = !edit;
    $("endMarker").hidden = edit;
    $("stats").hidden = edit;
    $("viewActions").hidden = edit;
    $("editActions").hidden = !edit;
    $("dirtyLabel").textContent = "";
  }

  // ── Editing ────────────────────────────────────────────────────────────────
  function enterEdit() {
    if (editing || !note) return;
    images = { ...(note.images || {}) };
    setMode(true);
    editor.value = note.text;
    editor.resetHistory();
    editor.focus();
    const end = editor.value.length;
    editor.setSelectionRange(end, end);
    editor.scrollTop = editor.scrollHeight;
    editor.keepCaretVisible();
  }

  function leaveEdit() {
    setMode(false);
    render();
    window.scrollTo({ top: 0 });
  }

  function cancelEdit() {
    if (isDirty() && !confirm("Discard your changes to this note?")) return;
    leaveEdit();
  }

  const refreshDirty = () => {
    $("dirtyLabel").textContent = isDirty() ? "● Unsaved changes" : "";
    editor.refreshImages();
  };

  async function save() {
    if (!editing) return;
    const text = editor.value.trim();
    if (!text) return toast("A note can’t be empty");
    if (text === note.text) return leaveEdit();

    $("saveBtn").disabled = true;
    const imgs = pruneImages(text, { ...(note.images || {}), ...images });
    chrome.runtime.sendMessage({ action: "updateTypedNote", id: note.id, updates: { text, images: imgs } }, (res) => {
      $("saveBtn").disabled = false;
      if (res?.success) {
        note = { ...note, text, images: imgs, updatedAt: new Date().toISOString() };
        leaveEdit();
        toast("Saved");
      } else {
        toast("Couldn’t save — your edits are still here");
      }
    });
  }

  // Images pasted while editing: same compression + export copy as the notepad
  async function addImage(src) {
    try {
      const [small, hd] = await Promise.all([
        encodeImage(src, IMG_MAX_DIM, IMG_QUALITY),
        encodeImage(src, IMG_HD_MAX_DIM, IMG_HD_QUALITY),
      ]);
      const id = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
      images[id] = small;
      if (hd.length > small.length * 1.15) await storeHdImage(id, hd);
      insertAtCursor(editor, `[[img:${id}]]`, refreshDirty);
      editor.refreshImages();
      editor.keepCaretVisible();
      toast(`Image added · ${kbOf(small)} KB`);
    } catch {
      toast("Couldn’t add that image");
    }
  }

  // ── Back to the extension ──────────────────────────────────────────────────
  // Return to the tab you came from (a docked side panel is still open there), and
  // when you use the dropdown popup, reopen it on the Typed tab.
  async function goBack() {
    if (isDirty() && !confirm("You have unsaved changes. Leave without saving?")) return;
    editing = false; // don't trigger the beforeunload prompt after confirming

    let returned = false;
    if (Number.isInteger(fromTab) && fromTab > 0) {
      try {
        const tab = await chrome.tabs.get(fromTab);
        await chrome.tabs.update(fromTab, { active: true });
        await chrome.windows.update(tab.windowId, { focused: true });
        returned = true;
        const s = await chrome.storage.local.get(["dockMode"]);
        if (!s.dockMode) {
          await chrome.storage.local.set({ popupStartTab: { tab: "typed", ts: Date.now() } });
          try {
            await chrome.action.openPopup({ windowId: tab.windowId });
          } catch {
            /* the popup can't be opened from here on some setups — one click on the icon does it */
          }
        }
      } catch {
        /* the original tab is gone */
      }
    }

    if (returned) {
      const me = await chrome.tabs.getCurrent();
      if (me?.id != null) return chrome.tabs.remove(me.id);
    }
    location.href = chrome.runtime.getURL("notes.html"); // original tab closed: the full notes page
  }

  // ── Wiring ─────────────────────────────────────────────────────────────────
  $("backBtn").addEventListener("click", goBack);
  $("stateBackBtn").addEventListener("click", goBack);
  $("editBtn").addEventListener("click", enterEdit);
  $("cancelBtn").addEventListener("click", cancelEdit);
  $("saveBtn").addEventListener("click", save);
  $("copyBtn").addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(note.text);
      toast("Copied");
    } catch {
      toast("Couldn’t copy");
    }
  });

  RichEditor.attach(editor, { getImage: (id) => images[id] });
  EditorKeys.attach(editor, refreshDirty);
  editor.addEventListener("input", refreshDirty);
  editor.addEventListener("paste", (e) => {
    const item = [...(e.clipboardData?.items || [])].find((i) => i.type.startsWith("image/"));
    const file = item?.getAsFile();
    if (!file) return;
    e.preventDefault();
    const fr = new FileReader();
    fr.onload = () => addImage(fr.result);
    fr.readAsDataURL(file);
  });

  document.addEventListener("keydown", (e) => {
    const mod = e.metaKey || e.ctrlKey;
    if (mod && e.code === "KeyS") {
      e.preventDefault();
      if (editing) save();
      return;
    }
    if (editing) return;
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName) || e.target.isContentEditable;
    if (e.key === "Escape") goBack();
    else if ((e.key === "e" || e.key === "E") && !mod && !e.altKey && !typing && note) {
      e.preventDefault();
      enterEdit();
    }
  });

  window.addEventListener("beforeunload", (e) => {
    if (isDirty()) {
      e.preventDefault();
      e.returnValue = "";
    }
  });

  // The note changed somewhere else (e.g. edited in the popup): refresh what's on screen
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local" || editing || !changes.typedNotes) return;
    const fresh = (changes.typedNotes.newValue || []).find((n) => n.id === noteId);
    if (fresh) {
      note = fresh;
      render();
    } else {
      note = null;
      showMissing("This note was deleted.");
    }
  });

  // ── Start ──────────────────────────────────────────────────────────────────
  (async () => {
    const r = await chrome.storage.local.get(["typedNotes", "notebooks", "prefs"]);
    applyTheme((r.prefs || {}).theme !== "light");
    notebooks = Array.isArray(r.notebooks) ? r.notebooks : [];
    note = Number.isFinite(noteId) ? (r.typedNotes || []).find((n) => n.id === noteId) || null : null;
    render();
    if (params.get("edit") === "1" && note) enterEdit();
  })();
})();