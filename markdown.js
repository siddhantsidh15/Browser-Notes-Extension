// markdown.js — the note formatting renderer, shared by the popup / side panel and
// the full-page note viewer. (Moved out of popup.js unchanged.)

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

if (typeof module !== "undefined") module.exports = { esc, Markdown };
