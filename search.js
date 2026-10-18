// search.js — shared helpers for the Typed-tab search and the notepad's find bar.
//
// Highlighting uses the CSS Custom Highlight API, which paints ranges of text
// WITHOUT touching the DOM — so it can't interfere with editing, undo, or the
// cursor in the notepad. (Styles live in popup.html as ::highlight(...) rules.)

const Search = (() => {
  // 'event loop "check phase"' -> ["event", "loop", "check phase"]
  function parseQuery(str) {
    const terms = [];
    const re = /"([^"]+)"|(\S+)/g;
    let m;
    while ((m = re.exec(str || ""))) {
      const t = (m[1] ?? m[2]).trim();
      if (t) terms.push(t);
    }
    return terms;
  }

  // The note syntax (image tokens, [code] markers, >C boxes, # headings) is
  // formatting, not content — searching "code" shouldn't match every code block.
  function stripSyntax(text) {
    return String(text || "")
      .replace(/\[\[img:[\w-]+\]\]/g, " ")
      .replace(/\[[cC][oO][dD][eE]\]/g, " ")
      .replace(/>C/g, " ")
      .replace(/^#{1,3}[ \t]+/gm, "");
  }

  // Every term must appear somewhere in the note's text, title, domain, URL or notebook
  function noteMatches(note, terms, caseSensitive, notebook) {
    if (!terms.length) return true;
    let hay = [
      stripSyntax(note.text),
      note.title || "",
      note.domain || "",
      note.url || "",
      notebook || "",
    ].join("\n");
    if (!caseSensitive) hay = hay.toLowerCase();
    return terms.every((t) =>
      hay.includes(caseSensitive ? t : t.toLowerCase())
    );
  }

  // DOM ranges for every occurrence of any term inside the given elements' text
  function rangesIn(roots, terms, caseSensitive) {
    const ranges = [];
    const needles = terms.map((t) => (caseSensitive ? t : t.toLowerCase()));
    for (const root of roots) {
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      let node;
      while ((node = walker.nextNode())) {
        const text = node.data;
        const hay = caseSensitive ? text : text.toLowerCase();
        if (hay.length !== text.length) continue; // exotic case-folding: offsets wouldn't line up
        for (const needle of needles) {
          let i = 0;
          while ((i = hay.indexOf(needle, i)) !== -1) {
            const r = document.createRange();
            r.setStart(node, i);
            r.setEnd(node, i + needle.length);
            ranges.push(r);
            i += needle.length;
            if (ranges.length >= 3000) return ranges;
          }
        }
      }
    }
    return ranges;
  }

  // Show (or clear, with an empty list) a named highlight
  function paint(name, ranges, priority = 0) {
    if (typeof CSS === "undefined" || !CSS.highlights) return;
    if (!ranges.length) {
      CSS.highlights.delete(name);
      return;
    }
    const h = new Highlight(...ranges);
    h.priority = priority;
    CSS.highlights.set(name, h);
  }

  return { parseQuery, stripSyntax, noteMatches, rangesIn, paint };
})();

if (typeof module !== "undefined") module.exports = Search;
