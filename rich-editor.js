// rich-editor.js — turns a <div contenteditable="plaintext-only"> into a notepad
// that shows pasted images / snapshots INLINE, right where the cursor was.
//
// The note text format does not change: an image is still stored as a
// [[img:<id>]] token (the pixels live in a separate id -> dataURL map). This
// file only changes how the token is *displayed* while you write: as a small
// thumbnail you can double-click to enlarge.
//
// To keep the rest of popup.js untouched, the element is given the same API a
// <textarea> has: .value, .selectionStart, .selectionEnd and .setSelectionRange().
// Offsets always refer to the serialized text (an image counts as its token).

const RichEditor = (() => {
  const newTokenRe = () => /\[\[img:([\w-]+)\]\]/g;
  const tokenLen = (id) => 8 + id.length; // "[[img:" + id + "]]"

  function attach(el, { getImage }) {
    const isChip = (n) => n.nodeType === 1 && n.classList.contains("img-chip");
    let lastStart = 0;
    let lastEnd = 0;

    // ── DOM -> text ──────────────────────────────────────────────────────────
    function serialize(root) {
      let out = "";
      const kids = root.childNodes;
      // A lone <br> is just the browser's "empty line" placeholder
      if (root === el && kids.length === 1 && kids[0].nodeName === "BR")
        return "";
      for (const n of kids) {
        if (n.nodeType === 3) out += n.data;
        else if (isChip(n)) out += `[[img:${n.dataset.id}]]`;
        else if (n.nodeName === "BR") out += "\n";
        else if (n.nodeType === 1) out += serialize(n);
      }
      return out;
    }

    // ── text -> DOM (existing image elements are reused, so nothing flickers) ─
    function makeChip(id) {
      const chip = document.createElement("span");
      chip.className = "img-chip";
      chip.contentEditable = "false";
      chip.dataset.id = id;
      const img = document.createElement("img");
      img.draggable = false;
      img.alt = "image";
      const del = document.createElement("span");
      del.className = "img-del";
      del.title = "Remove image";
      chip.append(img, del);
      return chip;
    }

    function syncChip(chip) {
      const src = getImage(chip.dataset.id);
      const img = chip.querySelector("img");
      if (src) {
        if (img.getAttribute("src") !== src) img.src = src;
        chip.classList.remove("missing");
      } else {
        img.removeAttribute("src");
        chip.classList.add("missing");
      }
    }

    // Chrome needs one extra "\n" at the very end for the caret to be able to sit
    // on a trailing empty line. It is not part of the note, so it's hidden here
    // (and re-added by render()).
    function getValue() {
      const raw = serialize(el);
      return raw.endsWith("\n") ? raw.slice(0, -1) : raw;
    }

    function updateEmpty() {
      el.classList.toggle("is-empty", getValue() === "");
    }

    function render(value) {
      if (value.endsWith("\n")) value += "\n"; // see getValue()
      const pool = new Map();
      el.querySelectorAll(".img-chip").forEach((c) => {
        if (!pool.has(c.dataset.id)) pool.set(c.dataset.id, []);
        pool.get(c.dataset.id).push(c);
      });
      const frag = document.createDocumentFragment();
      const re = newTokenRe();
      let last = 0;
      let m;
      while ((m = re.exec(value))) {
        if (m.index > last)
          frag.append(document.createTextNode(value.slice(last, m.index)));
        const chip = pool.get(m[1])?.shift() || makeChip(m[1]);
        chip.classList.remove("expanded");
        syncChip(chip);
        frag.append(chip);
        last = re.lastIndex;
      }
      if (last < value.length)
        frag.append(document.createTextNode(value.slice(last)));
      el.replaceChildren(frag);
      updateEmpty();
    }

    // ── offsets <-> DOM points ───────────────────────────────────────────────
    function pointToOffset(container, offset) {
      // A point inside a chip counts as "just before" it
      const host =
        container.nodeType === 1 ? container : container.parentElement;
      const chip = host && host !== el ? host.closest(".img-chip") : null;
      if (chip && el.contains(chip)) {
        container = el;
        offset = [...el.childNodes].indexOf(chip);
      }
      const r = document.createRange();
      r.setStart(el, 0);
      r.setEnd(container, offset);
      return serialize(r.cloneContents()).length;
    }

    function offsetToPoint(off) {
      let acc = 0;
      const kids = el.childNodes;
      for (let i = 0; i < kids.length; i++) {
        const n = kids[i];
        if (n.nodeType === 3) {
          if (off <= acc + n.data.length) return [n, off - acc];
          acc += n.data.length;
        } else {
          const len = isChip(n)
            ? tokenLen(n.dataset.id)
            : serialize({ childNodes: [n] }).length;
          if (off <= acc) return [el, i];
          if (off < acc + len) return [el, i + 1]; // inside a token: snap to after it
          acc += len;
        }
      }
      return [el, kids.length];
    }

    function readSelection() {
      const sel = window.getSelection();
      if (sel.rangeCount) {
        const r = sel.getRangeAt(0);
        if (el.contains(r.startContainer) && el.contains(r.endContainer)) {
          lastStart = pointToOffset(r.startContainer, r.startOffset);
          lastEnd = pointToOffset(r.endContainer, r.endOffset);
        }
      }
      const len = getValue().length;
      return [Math.min(lastStart, len), Math.min(lastEnd, len)];
    }

    function writeSelection(s, e) {
      const len = getValue().length;
      s = Math.min(Math.max(0, s), len);
      e = Math.min(Math.max(s, e), len);
      lastStart = s;
      lastEnd = e;
      const [sc, so] = offsetToPoint(s);
      const [ec, eo] = offsetToPoint(e);
      const r = document.createRange();
      r.setStart(sc, so);
      r.setEnd(ec, eo);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(r);
    }

    // Keep the remembered cursor fresh even while the editor isn't focused
    document.addEventListener("selectionchange", () => {
      const sel = window.getSelection();
      if (
        sel.rangeCount &&
        el.contains(sel.anchorNode) &&
        el.contains(sel.focusNode)
      )
        readSelection();
    });

    // ── textarea-compatible API ──────────────────────────────────────────────
    Object.defineProperty(el, "value", {
      configurable: true,
      get: () => getValue(),
      set: (v) => {
        render(String(v ?? ""));
        const end = getValue().length;
        lastStart = lastEnd = end;
        if (document.activeElement === el) writeSelection(end, end);
      },
    });
    Object.defineProperty(el, "selectionStart", {
      configurable: true,
      get: () => readSelection()[0],
      set: (v) => writeSelection(v, Math.max(v, readSelection()[1])),
    });
    Object.defineProperty(el, "selectionEnd", {
      configurable: true,
      get: () => readSelection()[1],
      set: (v) => writeSelection(Math.min(readSelection()[0], v), v),
    });
    el.setSelectionRange = (s, e) => writeSelection(s, e);

    // Re-apply image data after the id -> dataURL map changed
    el.refreshImages = () => el.querySelectorAll(".img-chip").forEach(syncChip);

    // ── Interaction ──────────────────────────────────────────────────────────
    const collapseAll = (except) =>
      el.querySelectorAll(".img-chip.expanded").forEach((c) => {
        if (c !== except) c.classList.remove("expanded");
      });

    // Double-click a thumbnail: enlarge it (double-click again to shrink)
    el.addEventListener("dblclick", (e) => {
      const chip = e.target.closest?.(".img-chip");
      if (!chip || chip.classList.contains("missing")) return;
      e.preventDefault();
      collapseAll(chip);
      chip.classList.toggle("expanded");
      window.getSelection().removeAllRanges();
    });

    // Click anywhere else (inside or outside the editor): shrink again
    document.addEventListener(
      "mousedown",
      (e) => collapseAll(e.target.closest?.(".img-chip.expanded")),
      true
    );
    el.addEventListener("keydown", () => collapseAll(null));

    // × on a thumbnail removes it
    el.addEventListener("click", (e) => {
      if (!e.target.classList?.contains("img-del")) return;
      e.preventDefault();
      e.target.closest(".img-chip")?.remove();
      updateEmpty();
      el.dispatchEvent(new Event("input", { bubbles: true }));
    });

    // Thumbnails are not draggable; dropped files shouldn't navigate the popup
    el.addEventListener("dragstart", (e) => {
      if (e.target.closest?.(".img-chip")) e.preventDefault();
    });
    el.addEventListener("drop", (e) => {
      if (e.dataTransfer?.files?.length) e.preventDefault();
    });

    // Copy / cut keep the [[img:…]] tokens as text so images survive a paste
    const copyHandler = (cut) => (e) => {
      const sel = window.getSelection();
      if (!sel.rangeCount || !el.contains(sel.anchorNode)) return;
      const text = serialize(sel.getRangeAt(0).cloneContents());
      if (!text) return;
      e.clipboardData.setData("text/plain", text);
      e.preventDefault();
      if (cut) document.execCommand("delete");
    };
    el.addEventListener("copy", copyHandler(false));
    el.addEventListener("cut", copyHandler(true));

    // Typed / pasted tokens (e.g. pasting a copied image) turn into thumbnails
    el.addEventListener("input", () => {
      updateEmpty();
      let textOnly = "";
      el.childNodes.forEach((n) => {
        if (n.nodeType === 3) textOnly += n.data;
      });
      if (newTokenRe().test(textOnly)) {
        const [s, e] = readSelection();
        render(getValue());
        writeSelection(s, e);
      }
    });

    updateEmpty();
  }

  return { attach };
})();
