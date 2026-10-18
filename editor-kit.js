// editor-kit.js — typing helpers for the notepad editor, shared by the popup / side
// panel and the full-page note viewer. (Moved out of popup.js; behaviour unchanged.)
//
// EditorKeys.attach(el, onChange): symbol repetition (-*5), Tab indent, auto-closing
// brackets and quotes. `onChange` runs after any edit these shortcuts make (the
// element's own `input` event doesn't fire for programmatic changes).

// ── Auto-closing bracket pairs ────────────────────────────────────────────────
// Works on the notepad editor (any element with the textarea-style API). Behaviour:
//  • Typing an opener  →  inserts pair, cursor lands between them.
//  • Selecting text + typing opener  →  wraps the selection.
//  • Typing a closer when it's already the next char  →  skip over (no double).
const BRACKET_PAIRS = { "(": ")", "{": "}", "[": "]", "<": ">" };
// Quotes close themselves too (" ' `). Skipped right after/before a letter or digit
// so apostrophes (don't, it's) and closing quotes type normally.
const QUOTE_CHARS = new Set(['"', "'", "`"]);
const isWordChar = (c) => !!c && /[\p{L}\p{N}_]/u.test(c);
const CLOSERS = new Set(Object.values(BRACKET_PAIRS));

const EditorKeys = {
  attach(el, onChange) {
    el.addEventListener("keydown", (e) => {
      // Symbol repetition expansion (e.g. -*5 + Space/Enter expands to -----)
      if (e.key === " " || e.key === "Enter") {
        const ta = el;
        if (ta.selectionStart === ta.selectionEnd) {
          const pos = ta.selectionStart;
          const textBefore = ta.value.slice(0, pos);
          // Matches non-whitespace character before '*' followed by digits at the end of textBefore
          const match =
            textBefore.match(/(\S)\*(\d+)$/) ||
            textBefore.match(/(\S)\x(\d+)$/);
          if (match) {
            e.preventDefault();
            const symbol = match[1];
            const count = parseInt(match[2], 10);
            const repeatStr = symbol.repeat(count);
            const startReplace = pos - match[0].length;
            ta.value =
              ta.value.slice(0, startReplace) + repeatStr + ta.value.slice(pos);
            ta.selectionStart = ta.selectionEnd =
              startReplace + repeatStr.length;
            onChange();
            return;
          }
        }
      }

      // Tab → insert indentation instead of moving focus
      if (e.key === "Tab") {
        e.preventDefault();
        const ta = el;
        const start = ta.selectionStart;
        const end = ta.selectionEnd;
        const indent = "  "; // 2-space indentation
        ta.value = ta.value.slice(0, start) + indent + ta.value.slice(end);
        ta.selectionStart = ta.selectionEnd = start + indent.length;
        onChange();
        return;
      }

      const closer = BRACKET_PAIRS[e.key];

      if (closer) {
        // Opening bracket pressed
        e.preventDefault();
        const ta = el;
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
        onChange();
        return;
      }

      if (
        QUOTE_CHARS.has(e.key) &&
        !e.metaKey &&
        !e.ctrlKey &&
        !e.altKey &&
        !e.isComposing
      ) {
        const ta = el;
        const start = ta.selectionStart;
        const end = ta.selectionEnd;
        const val = ta.value;
        const q = e.key;

        if (start !== end) {
          // Wrap the selected text in quotes
          e.preventDefault();
          ta.value =
            val.slice(0, start) +
            q +
            val.slice(start, end) +
            q +
            val.slice(end);
          ta.selectionStart = start + 1;
          ta.selectionEnd = end + 1;
          onChange();
          return;
        }
        if (val[start] === q) {
          // Closing quote already there — type over it
          e.preventDefault();
          ta.selectionStart = ta.selectionEnd = start + 1;
          return;
        }
        if (!isWordChar(val[start - 1]) && !isWordChar(val[start])) {
          e.preventDefault();
          ta.value = val.slice(0, start) + q + q + val.slice(start);
          ta.selectionStart = ta.selectionEnd = start + 1;
          onChange();
          return;
        }
        // otherwise (apostrophe / closing quote after a word): normal typing
      }

      if (CLOSERS.has(e.key)) {
        // Closing bracket pressed — skip over if it's already the next char
        const ta = el;
        if (
          ta.selectionStart === ta.selectionEnd &&
          ta.value[ta.selectionStart] === e.key
        ) {
          e.preventDefault();
          ta.selectionStart = ta.selectionEnd = ta.selectionStart + 1;
        }
      }
    });
  },
};

// ── Insert text at the current cursor position, replacing any selection ──────
function insertAtCursor(el, text, onChange) {
  const start = el.selectionStart ?? el.value.length;
  const end = el.selectionEnd ?? el.value.length;
  el.value = el.value.slice(0, start) + text + el.value.slice(end);
  const pos = start + text.length;
  el.selectionStart = el.selectionEnd = pos;
  el.focus();
  if (onChange) onChange();
}
