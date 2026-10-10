// export.js — Typed-notes export: PDF (light theme), Markdown, plain text.
//
// Every note is exported with its title linked to the page it was saved from.
// The note body uses this extension's own mini-syntax, which is translated here:
//   ### text  -> big heading      ## text -> medium heading     # text -> small heading
//   :text:    -> underline        >C text >C -> boxed note
//   [code]...[code] -> code block [[img:<id>]] -> pasted image (looked up in note.images)

const NoteExport = (() => {
  // ── Small helpers ──────────────────────────────────────────────────────────
  function fmtDateTime(ts) {
    return new Date(ts).toLocaleString(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    });
  }

  function noteTitle(n) {
    return (n.title || "").trim() || n.domain || n.url || "Untitled note";
  }

  function slug(s) {
    return (
      String(s || "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 40) || ""
    );
  }

  function fileName(ext, notebook) {
    const day = new Date().toISOString().slice(0, 10);
    const nb = slug(notebook);
    return `typed-notes${nb ? "-" + nb : ""}-${day}.${ext}`;
  }

  function download(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 15000);
  }

  // ── Parse the note syntax into blocks ──────────────────────────────────────
  // Block types: h {level,text} | p {text} | gap | code {text} | box {text} | image {id}
  function parseTextLines(segment) {
    const out = [];
    for (const line of segment.split("\n")) {
      let m;
      if ((m = line.match(/^###[ \t]+(.+)$/))) out.push({ type: "h", level: 1, text: m[1] });
      else if ((m = line.match(/^##[ \t]+(.+)$/))) out.push({ type: "h", level: 2, text: m[1] });
      else if ((m = line.match(/^#[ \t]+(.+)$/))) out.push({ type: "h", level: 3, text: m[1] });
      else if (line.trim() === "") out.push({ type: "gap" });
      else out.push({ type: "p", text: line });
    }
    return out;
  }

  function parseBlocks(raw) {
    const text = String(raw || "").replace(/\r\n?/g, "\n");
    const re =
      /\[[cC][oO][dD][eE]\]([\s\S]*?)\[[cC][oO][dD][eE]\]|>C([\s\S]*?)>C|\[\[img:([\w-]+)\]\]/g;
    const blocks = [];
    let last = 0;
    let m;
    while ((m = re.exec(text))) {
      if (m.index > last) blocks.push(...parseTextLines(text.slice(last, m.index)));
      if (m[1] !== undefined) blocks.push({ type: "code", text: m[1].replace(/^\n+|\n+$/g, "") });
      else if (m[2] !== undefined) blocks.push({ type: "box", text: m[2].trim() });
      else blocks.push({ type: "image", id: m[3] });
      last = re.lastIndex;
    }
    if (last < text.length) blocks.push(...parseTextLines(text.slice(last)));

    // collapse runs of blank lines and trim blanks at both ends
    const cleaned = [];
    for (const b of blocks) {
      if (b.type === "gap" && (cleaned.length === 0 || cleaned[cleaned.length - 1].type === "gap")) continue;
      cleaned.push(b);
    }
    while (cleaned.length && cleaned[cleaned.length - 1].type === "gap") cleaned.pop();
    return cleaned;
  }

  // ":text:" -> [{text, u}] runs (same rule the app uses for underline).
  // "://" is protected so pasted URLs (https://…) are never treated as underline markers.
  function inlineRuns(str) {
    const P = "\u0000";
    const safe = String(str).replace(/:\/\//g, P);
    const back = (t) => t.replace(/\u0000/g, "://");
    const runs = [];
    const re = /:([^:\n]+):/g;
    let last = 0;
    let m;
    while ((m = re.exec(safe))) {
      if (m.index > last) runs.push({ text: back(safe.slice(last, m.index)), u: false });
      runs.push({ text: back(m[1]), u: true });
      last = re.lastIndex;
    }
    if (last < safe.length) runs.push({ text: back(safe.slice(last)), u: false });
    return runs;
  }
  const mdInline = (str) => inlineRuns(str).map((r) => (r.u ? `<u>${r.text}</u>` : r.text)).join("");
  const plainInline = (str) => inlineRuns(str).map((r) => r.text).join("");

  // ── Markdown ───────────────────────────────────────────────────────────────
  function mdLink(text, url) {
    const t = String(text).replace(/([\[\]])/g, "\\$1");
    if (!url) return t;
    const u = String(url).replace(/ /g, "%20").replace(/\(/g, "%28").replace(/\)/g, "%29");
    return `[${t}](${u})`;
  }

  function toMarkdown(notes, meta, images = (n) => n.images || {}) {
    let md = `# Typed Notes${meta.notebook ? ` — ${meta.notebook}` : ""}\n\n`;
    md += `_Exported ${fmtDateTime(Date.now())} · ${notes.length} note${notes.length === 1 ? "" : "s"}_\n\n`;

    for (const n of notes) {
      const imgs = images(n);
      md += `---\n\n## ${mdLink(noteTitle(n), n.url)}\n\n`;
      const bits = [`**Saved:** ${fmtDateTime(n.timestamp)}`];
      if (n.notebook) bits.push(`**Notebook:** ${n.notebook}`);
      if (n.domain) bits.push(`**Site:** ${n.domain}`);
      md += bits.join(" · ") + "\n\n";

      const lines = [];
      const blocks = parseBlocks(n.text);
      blocks.forEach((b, i) => {
        if (b.type === "h") lines.push("", "#".repeat(b.level + 2) + " " + mdInline(b.text), "");
        else if (b.type === "p") {
          const next = blocks[i + 1];
          const txt = mdInline(b.text);
          lines.push(next && next.type === "p" ? txt + "  " : txt);
        } else if (b.type === "gap") lines.push("");
        else if (b.type === "code") lines.push("```", b.text, "```", "");
        else if (b.type === "box") lines.push(...b.text.split("\n").map((l) => "> " + l), "");
        else if (b.type === "image") {
          const src = imgs[b.id];
          if (src) lines.push(`![image](${src})`, "");
        }
      });
      md += lines.join("\n").replace(/\n{3,}/g, "\n\n").trim() + "\n\n";
    }
    return md;
  }

  // ── Plain text ─────────────────────────────────────────────────────────────
  function toText(notes, meta) {
    const bar = "=".repeat(64);
    const thin = "-".repeat(64);
    let out = `TYPED NOTES${meta.notebook ? " — " + meta.notebook : ""}\n`;
    out += `Exported ${fmtDateTime(Date.now())} · ${notes.length} note${notes.length === 1 ? "" : "s"}\n\n`;

    notes.forEach((n, i) => {
      out += `${bar}\n${i + 1}. ${noteTitle(n)}\n`;
      if (n.url) out += `Link: ${n.url}\n`;
      out += `Saved: ${fmtDateTime(n.timestamp)}`;
      if (n.notebook) out += `  |  Notebook: ${n.notebook}`;
      out += `\n${thin}\n`;

      const lines = [];
      for (const b of parseBlocks(n.text)) {
        if (b.type === "h") lines.push(plainInline(b.text));
        else if (b.type === "p") lines.push(plainInline(b.text));
        else if (b.type === "gap") lines.push("");
        else if (b.type === "code") lines.push(...b.text.split("\n").map((l) => "    " + l));
        else if (b.type === "box") lines.push(...b.text.split("\n").map((l) => "  | " + plainInline(l)));
        else if (b.type === "image") lines.push("[image]");
      }
      out += lines.join("\n").trim() + "\n\n";
    });
    return out;
  }

  // ── PDF (always light theme: white page, dark ink) ─────────────────────────
  // jsPDF's built-in fonts only cover Latin text (WinAnsi); anything else
  // (emoji, Devanagari, CJK…) would come out as garbage, so it becomes "?".
  const WIN_ANSI_EXTRA = new Set([0x2018, 0x2019, 0x201c, 0x201d, 0x2013, 0x2014, 0x2026, 0x2022, 0x2122, 0x20ac, 0x2020, 0x2021, 0x2030]);
  function pdfSafe(str) {
    let s = String(str).normalize("NFC").replace(/[\u200b-\u200d\ufeff]/g, "").replace(/\t/g, "    ");
    s = s.replace(/→/g, "->").replace(/←/g, "<-").replace(/≥/g, ">=").replace(/≤/g, "<=").replace(/\u2212/g, "-");
    let out = "";
    for (const ch of s) {
      const c = ch.codePointAt(0);
      out += (c >= 0x20 && c <= 0x7e) || (c >= 0xa0 && c <= 0xff) || WIN_ANSI_EXTRA.has(c) ? ch : "?";
    }
    return out;
  }

  const C = {
    ink: [34, 34, 48],
    muted: [112, 112, 128],
    accent: [112, 68, 190],
    link: [76, 50, 168],
    rule: [222, 218, 232],
    boxFill: [246, 242, 252],
    codeFill: [244, 245, 248],
    codeLine: [224, 226, 232],
  };

  async function toPdf(notes, meta, { jsPDF, prepareImage }) {
    const doc = new jsPDF({ unit: "pt", format: "a4", compress: true });
    const PW = doc.internal.pageSize.getWidth();
    const PH = doc.internal.pageSize.getHeight();
    const M = 52;
    const CW = PW - M * 2;
    const BOTTOM = PH - M - 10;
    let y = M;

    const font = (style, size, family = "helvetica") => {
      doc.setFont(family, style);
      doc.setFontSize(size);
    };
    const ink = (c) => doc.setTextColor(c[0], c[1], c[2]);
    const ensure = (h) => {
      if (y + h > BOTTOM) {
        doc.addPage();
        y = M;
      }
    };

    // Word-wrap a list of {text,u} runs into lines of items [{text,u,w}]
    function wrapRuns(runs, width, preserve = false) {
      const lines = [];
      let cur = [];
      let w = 0;
      const flush = () => {
        while (cur.length && /^\s+$/.test(cur[cur.length - 1].text)) cur.pop();
        lines.push(cur);
        cur = [];
        w = 0;
      };
      for (const run of runs) {
        for (const piece of pdfSafe(run.text).split(/(\s+)/)) {
          let tok = piece;
          if (tok === "") continue;
          const isSpace = /^\s+$/.test(tok);
          let tw = doc.getTextWidth(tok);
          if (isSpace) {
            if (cur.length === 0 && !preserve) continue; // no leading whitespace on a line
            cur.push({ text: tok, u: run.u, w: tw });
            w += tw;
            continue;
          }
          if (w + tw > width && cur.length) flush();
          // a single word wider than the line (long URL etc.): break by characters
          while (tw > width) {
            let n = 1;
            while (n < tok.length && doc.getTextWidth(tok.slice(0, n + 1)) <= width) n++;
            cur.push({ text: tok.slice(0, n), u: run.u, w: doc.getTextWidth(tok.slice(0, n)) });
            flush();
            tok = tok.slice(n);
            tw = doc.getTextWidth(tok);
          }
          cur.push({ text: tok, u: run.u, w: tw });
          w += tw;
        }
      }
      if (cur.length || lines.length === 0) flush();
      return lines;
    }

    function drawItems(items, x, baseline, size) {
      let cx = x;
      for (const it of items) {
        doc.text(it.text, cx, baseline);
        if (it.u && it.text.trim()) {
          doc.setDrawColor(...C.ink);
          doc.setLineWidth(0.6);
          doc.line(cx, baseline + 1.6, cx + it.w, baseline + 1.6);
        }
        cx += it.w;
      }
    }

    // Lines drawn inside a shaded panel (used for code blocks and boxed notes)
    function panel(lines, { size, lh, pad, fill, edge, bar, family = "helvetica" }) {
      const padV = 5;
      const total = lines.length;
      for (let i = 0; i < total; i++) {
        const first = i === 0;
        const lastLine = i === total - 1;
        const h = lh + (first ? padV : 0) + (lastLine ? padV : 0);
        ensure(h);
        doc.setFillColor(...fill);
        doc.rect(M, y, CW, h, "F");
        doc.setDrawColor(...edge);
        doc.setLineWidth(0.7);
        doc.line(M, y, M, y + h);
        doc.line(M + CW, y, M + CW, y + h);
        if (first) doc.line(M, y, M + CW, y);
        if (lastLine) doc.line(M, y + h, M + CW, y + h);
        if (bar) {
          doc.setFillColor(...bar);
          doc.rect(M, y, 3, h, "F");
        }
        font("normal", size, family);
        ink(C.ink);
        drawItems(lines[i], M + pad, y + (first ? padV : 0) + size, size);
        y += h;
      }
      y += 8;
    }

    // ── Document header ──
    font("bold", 22);
    ink(C.ink);
    doc.text("Typed Notes", M, y + 20);
    y += 30;
    font("normal", 9.5);
    ink(C.muted);
    const sub = [meta.notebook ? `Notebook: ${meta.notebook}` : "All notebooks", `${notes.length} note${notes.length === 1 ? "" : "s"}`, `Exported ${fmtDateTime(Date.now())}`].join("   ·   ");
    doc.text(pdfSafe(sub), M, y + 8);
    y += 18;
    doc.setDrawColor(...C.accent);
    doc.setLineWidth(2);
    doc.line(M, y, M + CW, y);
    y += 22;

    // ── Notes ──
    for (let ni = 0; ni < notes.length; ni++) {
      const n = notes[ni];
      const imgs = n.images || {};

      ensure(86);
      if (ni > 0) {
        doc.setDrawColor(...C.rule);
        doc.setLineWidth(0.8);
        doc.line(M, y, M + CW, y);
        y += 18;
      }

      // Title — a clickable link to the page the note was saved from
      font("bold", 13.5);
      const tLines = wrapRuns([{ text: noteTitle(n), u: false }], CW);
      for (const items of tLines) {
        ensure(19);
        ink(n.url ? C.link : C.ink);
        font("bold", 13.5);
        drawItems(items, M, y + 13.5, 13.5);
        if (n.url) {
          const w = items.reduce((a, it) => a + it.w, 0);
          doc.link(M, y, w, 18, { url: n.url });
        }
        y += 18;
      }

      // Meta
      font("normal", 8.5);
      ink(C.muted);
      const meta1 = [fmtDateTime(n.timestamp)];
      if (n.notebook) meta1.push(`Notebook: ${n.notebook}`);
      if (n.domain) meta1.push(n.domain);
      doc.text(pdfSafe(meta1.join("   ·   ")), M, y + 9);
      y += 14;

      // Full URL under the title (so the link survives printing)
      if (n.url) {
        font("normal", 8);
        ink(C.link);
        for (const items of wrapRuns([{ text: n.url, u: false }], CW)) {
          ensure(12);
          font("normal", 8);
          ink(C.link);
          drawItems(items, M, y + 8, 8);
          const w = items.reduce((a, it) => a + it.w, 0);
          doc.link(M, y, w, 11, { url: n.url });
          y += 11;
        }
      }
      y += 8;

      // Body
      for (const b of parseBlocks(n.text)) {
        if (b.type === "gap") {
          y += 6;
        } else if (b.type === "h") {
          const size = [0, 15, 12.5, 11][b.level];
          font("bold", size);
          const lines = wrapRuns(inlineRuns(b.text), CW);
          y += 4;
          for (const items of lines) {
            ensure(size * 1.45 + 6);
            font("bold", size);
            ink(C.ink);
            drawItems(items, M, y + size, size);
            y += size * 1.45;
          }
          y += 2;
        } else if (b.type === "p") {
          font("normal", 10);
          const lines = wrapRuns(inlineRuns(b.text), CW);
          for (const items of lines) {
            ensure(14.5);
            font("normal", 10);
            ink(C.ink);
            drawItems(items, M, y + 10, 10);
            y += 14.5;
          }
        } else if (b.type === "code") {
          font("normal", 8.8, "courier");
          const lines = [];
          for (const raw of b.text.split("\n")) lines.push(...wrapRuns([{ text: raw === "" ? " " : raw, u: false }], CW - 20, true));
          y += 3;
          panel(lines, { size: 8.8, lh: 12.2, pad: 10, fill: C.codeFill, edge: C.codeLine, family: "courier" });
        } else if (b.type === "box") {
          font("normal", 10);
          const lines = [];
          for (const raw of b.text.split("\n")) lines.push(...wrapRuns(inlineRuns(raw === "" ? " " : raw), CW - 26));
          y += 3;
          panel(lines, { size: 10, lh: 14.5, pad: 14, fill: C.boxFill, edge: [214, 200, 238], bar: C.accent });
        } else if (b.type === "image") {
          const src = imgs[b.id];
          const img = src ? await prepareImage(src) : null;
          if (!img) continue;
          let w = Math.min(CW, img.width * 0.75);
          let h = (img.height / img.width) * w;
          if (h > 320) {
            h = 320;
            w = (img.width / img.height) * h;
          }
          ensure(h + 10);
          doc.addImage(img.dataUrl, img.format, M, y, w, h, undefined, "FAST");
          doc.setDrawColor(...C.rule);
          doc.setLineWidth(0.6);
          doc.rect(M, y, w, h);
          y += h + 10;
        }
      }
      y += 16;
    }

    // ── Footer / page numbers ──
    const pages = doc.getNumberOfPages();
    for (let i = 1; i <= pages; i++) {
      doc.setPage(i);
      font("normal", 8);
      ink(C.muted);
      doc.text("Save to Notes", M, PH - 26);
      doc.text(`Page ${i} of ${pages}`, PW - M, PH - 26, { align: "right" });
    }
    return doc.output("blob");
  }

  return { toMarkdown, toText, toPdf, fileName, download, parseBlocks };
})();

if (typeof module !== "undefined") module.exports = NoteExport;