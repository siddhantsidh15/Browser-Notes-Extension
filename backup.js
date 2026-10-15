// backup.js — full JSON backup of the extension's data, and a strict importer.
//
// File format (version 1):
// {
//   "format": "save-to-notes-backup",
//   "version": 1,
//   "exportedAt": "<ISO date>",
//   "appVersion": "2.3.0",                       (optional)
//   "notebooks": [                               every notebook, with its notes inside
//     { "id": "nb_…", "name": "Interview Prep",
//       "notes": [ <typed note>, … ] }
//   ],
//   "unfiledNotes": [ <typed note>, … ],         typed notes that aren't in a notebook
//   "savedSelections": [ <saved selection>, … ]  the first tab (right-click → Save to Notes)
// }
//
// <typed note>       { id, text, url, title, domain, timestamp, updatedAt?, images, imagesHD? }
// <saved selection>  { id, text, url, title, domain, timestamp, copyCount? }
//
// validate() is deliberately strict: any missing field, wrong type, unknown field,
// duplicate id or non-image "image" rejects the WHOLE file — nothing is imported.

const NotesBackup = (() => {
  const FORMAT = "save-to-notes-backup";
  const VERSION = 1;

  const LIMITS = {
    fileBytes: 300 * 1024 * 1024,
    notebooks: 500,
    notes: 100000,
    text: 2000000,
    short: 8192,
    name: 200,
    imageChars: 14000000,
  };

  const ID_RE = /^[\w-]{1,64}$/;
  const IMG_RE = /^data:image\/(?:png|jpeg|webp|gif);base64,[A-Za-z0-9+/]+={0,2}$/;
  const BAD_KEYS = new Set(["__proto__", "constructor", "prototype"]);

  const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
  const isIso = (v) => typeof v === "string" && v.length <= 40 && !Number.isNaN(Date.parse(v));
  const isStr = (v, max) => typeof v === "string" && v.length <= max;
  const isImageKey = (k) => ID_RE.test(k) && !BAD_KEYS.has(k);
  const isImage = (v) => typeof v === "string" && v.length <= LIMITS.imageChars && IMG_RE.test(v);

  // ── Validation ─────────────────────────────────────────────────────────────
  function validate(data) {
    const errors = [];
    const err = (msg) => {
      if (errors.length < 8) errors.push(msg);
    };
    const noExtraKeys = (obj, allowed, path) => {
      for (const k of Object.keys(obj)) if (!allowed.includes(k)) err(`${path}: unexpected field "${k}"`);
    };
    const need = (obj, keys, path) => {
      let ok = true;
      for (const k of keys) {
        if (!Object.prototype.hasOwnProperty.call(obj, k)) {
          err(`${path}: missing "${k}"`);
          ok = false;
        }
      }
      return ok;
    };

    if (!isObj(data)) return { ok: false, errors: ["The file is not a JSON object."] };

    noExtraKeys(data, ["format", "version", "exportedAt", "appVersion", "notebooks", "unfiledNotes", "savedSelections"], "file");
    if (data.format !== FORMAT) {
      err(`"format" must be "${FORMAT}" — this isn't a Save to Notes backup.`);
      return { ok: false, errors };
    }
    if (!Number.isInteger(data.version) || data.version < 1) err(`"version" must be a whole number ≥ 1.`);
    else if (data.version > VERSION) {
      err(`This backup is version ${data.version}, newer than this extension supports (${VERSION}). Update the extension first.`);
      return { ok: false, errors };
    }
    if (!need(data, ["exportedAt", "notebooks", "unfiledNotes", "savedSelections"], "file")) return { ok: false, errors };
    if (!isIso(data.exportedAt)) err(`"exportedAt" must be a date string.`);
    if (data.appVersion !== undefined && !isStr(data.appVersion, 40)) err(`"appVersion" must be a string.`);
    if (!Array.isArray(data.notebooks)) err(`"notebooks" must be a list.`);
    if (!Array.isArray(data.unfiledNotes)) err(`"unfiledNotes" must be a list.`);
    if (!Array.isArray(data.savedSelections)) err(`"savedSelections" must be a list.`);
    if (errors.length) return { ok: false, errors };

    if (data.notebooks.length > LIMITS.notebooks) err(`Too many notebooks (max ${LIMITS.notebooks}).`);
    const typedCount = data.notebooks.reduce((a, nb) => a + (Array.isArray(nb?.notes) ? nb.notes.length : 0), 0) + data.unfiledNotes.length;
    if (typedCount + data.savedSelections.length > LIMITS.notes) err(`Too many notes (max ${LIMITS.notes}).`);
    if (errors.length) return { ok: false, errors };

    const typedIds = new Set();
    const nbIds = new Set();
    const nbNames = new Set();

    const checkImages = (obj, path) => {
      if (!isObj(obj)) {
        err(`${path} must be an object.`);
        return false;
      }
      for (const [k, v] of Object.entries(obj)) {
        if (!isImageKey(k)) err(`${path}: invalid image id "${String(k).slice(0, 30)}"`);
        else if (!isImage(v)) err(`${path}["${k}"] is not a PNG/JPEG/WebP/GIF data URL.`);
      }
      return true;
    };

    const checkBase = (n, path, extra) => {
      if (!isObj(n)) return err(`${path} must be an object.`);
      noExtraKeys(n, ["id", "text", "url", "title", "domain", "timestamp", ...extra], path);
      if (!need(n, ["id", "text", "url", "title", "domain", "timestamp"], path)) return;
      if (!Number.isSafeInteger(n.id) || n.id <= 0) err(`${path}.id must be a positive whole number.`);
      if (!isStr(n.text, LIMITS.text)) err(`${path}.text must be text (max ${LIMITS.text} characters).`);
      for (const f of ["url", "title", "domain"]) if (!isStr(n[f], LIMITS.short)) err(`${path}.${f} must be text.`);
      if (!isIso(n.timestamp)) err(`${path}.timestamp must be a date string.`);
    };

    const checkTyped = (n, path) => {
      checkBase(n, path, ["updatedAt", "images", "imagesHD"]);
      if (!isObj(n)) return;
      if (Number.isSafeInteger(n.id)) {
        if (typedIds.has(n.id)) err(`${path}.id ${n.id} appears more than once.`);
        typedIds.add(n.id);
      }
      if (!Object.prototype.hasOwnProperty.call(n, "images")) err(`${path}: missing "images"`);
      else checkImages(n.images, `${path}.images`);
      if (n.updatedAt !== undefined && !isIso(n.updatedAt)) err(`${path}.updatedAt must be a date string.`);
      if (n.imagesHD !== undefined && checkImages(n.imagesHD, `${path}.imagesHD`) && isObj(n.images)) {
        for (const k of Object.keys(n.imagesHD)) if (!Object.prototype.hasOwnProperty.call(n.images, k)) err(`${path}.imagesHD["${k}"] has no matching entry in images.`);
      }
    };

    data.notebooks.forEach((nb, i) => {
      const path = `notebooks[${i}]`;
      if (!isObj(nb)) return err(`${path} must be an object.`);
      noExtraKeys(nb, ["id", "name", "notes"], path);
      if (!need(nb, ["id", "name", "notes"], path)) return;
      if (typeof nb.id !== "string" || !ID_RE.test(nb.id) || BAD_KEYS.has(nb.id)) err(`${path}.id is not a valid id.`);
      else if (nbIds.has(nb.id)) err(`${path}.id "${nb.id}" appears more than once.`);
      else nbIds.add(nb.id);
      if (!isStr(nb.name, LIMITS.name) || nb.name.trim() === "") err(`${path}.name must be non-empty text.`);
      else {
        const key = nb.name.trim().toLowerCase();
        if (nbNames.has(key)) err(`${path}.name "${nb.name}" is used by two notebooks.`);
        nbNames.add(key);
      }
      if (!Array.isArray(nb.notes)) return err(`${path}.notes must be a list.`);
      nb.notes.forEach((n, j) => checkTyped(n, `${path}.notes[${j}]`));
    });

    data.unfiledNotes.forEach((n, i) => checkTyped(n, `unfiledNotes[${i}]`));

    const selIds = new Set();
    data.savedSelections.forEach((n, i) => {
      const path = `savedSelections[${i}]`;
      checkBase(n, path, ["copyCount"]);
      if (!isObj(n)) return;
      if (Number.isSafeInteger(n.id)) {
        if (selIds.has(n.id)) err(`${path}.id ${n.id} appears more than once.`);
        selIds.add(n.id);
      }
      if (n.copyCount !== undefined && !(Number.isInteger(n.copyCount) && n.copyCount >= 0 && n.copyCount <= 1000000)) {
        err(`${path}.copyCount must be a whole number ≥ 0.`);
      }
    });

    return { ok: errors.length === 0, errors };
  }

  // ── Export ─────────────────────────────────────────────────────────────────
  // stored = { notebooks, typedNotes, notes, hd: { "<imageId>": dataUrl } }
  // Everything is normalised so our own file always passes validate().
  function buildExport(stored, appVersion) {
    const str = (v, max) => (typeof v === "string" ? v.slice(0, max) : "");
    const toId = (v) => {
      const n = typeof v === "string" && /^\d+$/.test(v) ? Number(v) : v;
      return Number.isSafeInteger(n) && n > 0 ? n : null;
    };
    const iso = (v, id) => (isIso(v) ? v : new Date(id).toISOString());

    const notebooks = [];
    const seenNames = new Set();
    for (const nb of Array.isArray(stored.notebooks) ? stored.notebooks : []) {
      if (!isObj(nb) || typeof nb.id !== "string" || !ID_RE.test(nb.id) || BAD_KEYS.has(nb.id)) continue;
      if (notebooks.some((x) => x.id === nb.id)) continue;
      let name = str(nb.name, LIMITS.name).trim() || "Untitled notebook";
      while (seenNames.has(name.toLowerCase())) name += " (2)";
      seenNames.add(name.toLowerCase());
      notebooks.push({ id: nb.id, name, notes: [] });
    }
    const byId = new Map(notebooks.map((n) => [n.id, n]));
    const unfiledNotes = [];
    const seenTyped = new Set();
    let skipped = 0;

    for (const n of Array.isArray(stored.typedNotes) ? stored.typedNotes : []) {
      const id = isObj(n) ? toId(n.id) : null;
      if (id === null || seenTyped.has(id)) {
        skipped++;
        continue;
      }
      seenTyped.add(id);
      const images = {};
      const imagesHD = {};
      for (const [k, v] of Object.entries(isObj(n.images) ? n.images : {})) {
        if (!isImageKey(k) || !isImage(v)) continue;
        images[k] = v;
        const hd = stored.hd?.[k];
        if (isImage(hd)) imagesHD[k] = hd;
      }
      const out = {
        id,
        text: str(n.text, LIMITS.text),
        url: str(n.url, LIMITS.short),
        title: str(n.title, LIMITS.short),
        domain: str(n.domain, LIMITS.short),
        timestamp: iso(n.timestamp, id),
        images,
      };
      if (isIso(n.updatedAt)) out.updatedAt = n.updatedAt;
      if (Object.keys(imagesHD).length) out.imagesHD = imagesHD;
      (byId.get(n.notebookId)?.notes || unfiledNotes).push(out);
    }

    const savedSelections = [];
    const seenSel = new Set();
    for (const n of Array.isArray(stored.notes) ? stored.notes : []) {
      const id = isObj(n) ? toId(n.id) : null;
      if (id === null || seenSel.has(id)) {
        skipped++;
        continue;
      }
      seenSel.add(id);
      const out = {
        id,
        text: str(n.text, LIMITS.text),
        url: str(n.url, LIMITS.short),
        title: str(n.title, LIMITS.short),
        domain: str(n.domain, LIMITS.short),
        timestamp: iso(n.timestamp, id),
      };
      if (Number.isInteger(n.copyCount) && n.copyCount > 0) out.copyCount = n.copyCount;
      savedSelections.push(out);
    }

    const file = {
      format: FORMAT,
      version: VERSION,
      exportedAt: new Date().toISOString(),
      ...(appVersion ? { appVersion: String(appVersion).slice(0, 40) } : {}),
      notebooks,
      unfiledNotes,
      savedSelections,
    };
    return { file, skipped };
  }

  // ── Import planning (pure: decides what to write, writes nothing) ─────────
  // existing = { notebooks, typedNotes, notes, hdIndex }
  function plan(data, existing) {
    const exNotebooks = Array.isArray(existing.notebooks) ? existing.notebooks.filter(isObj) : [];
    const exTyped = Array.isArray(existing.typedNotes) ? existing.typedNotes : [];
    const exSel = Array.isArray(existing.notes) ? existing.notes : [];
    const nbById = new Map(exNotebooks.map((n) => [n.id, n]));
    const nbByName = new Map(exNotebooks.map((n) => [String(n.name).trim().toLowerCase(), n]));

    const notebooks = exNotebooks.slice();
    const idMap = new Map();
    let notebooksNew = 0;
    let notebooksMerged = 0;
    for (const nb of data.notebooks) {
      let target = nbById.get(nb.id) || nbByName.get(nb.name.trim().toLowerCase());
      if (target) notebooksMerged++;
      else {
        target = { id: nb.id, name: nb.name.trim() };
        notebooks.push(target);
        nbById.set(target.id, target);
        nbByName.set(target.name.toLowerCase(), target);
        notebooksNew++;
      }
      idMap.set(nb.id, target.id);
    }

    const haveTyped = new Set(exTyped.map((n) => n?.id));
    const incomingTyped = [];
    const hd = {};
    let typedSkipped = 0;
    let images = 0;
    const addTyped = (n, notebookId) => {
      if (haveTyped.has(n.id)) {
        typedSkipped++;
        return;
      }
      haveTyped.add(n.id);
      const note = { id: n.id, text: n.text, url: n.url, title: n.title, domain: n.domain, timestamp: n.timestamp, images: { ...n.images }, notebookId };
      if (n.updatedAt) note.updatedAt = n.updatedAt;
      images += Object.keys(note.images).length;
      for (const [k, v] of Object.entries(n.imagesHD || {})) hd[k] = v;
      incomingTyped.push(note);
    };
    for (const nb of data.notebooks) for (const n of nb.notes) addTyped(n, idMap.get(nb.id));
    for (const n of data.unfiledNotes) addTyped(n, null);

    const haveSel = new Set(exSel.map((n) => n?.id));
    const incomingSel = [];
    let selectionsSkipped = 0;
    for (const n of data.savedSelections) {
      if (haveSel.has(n.id)) {
        selectionsSkipped++;
        continue;
      }
      haveSel.add(n.id);
      const note = { id: n.id, text: n.text, url: n.url, title: n.title, domain: n.domain, timestamp: n.timestamp };
      if (n.copyCount) note.copyCount = n.copyCount;
      incomingSel.push(note);
    }

    const byTime = (a, b) => (Date.parse(a.timestamp) || 0) - (Date.parse(b.timestamp) || 0) || a.id - b.id;
    const typedNotes = incomingTyped.length ? exTyped.concat(incomingTyped).sort(byTime) : exTyped;
    const notes = incomingSel.length ? exSel.concat(incomingSel).sort(byTime) : exSel;

    const hdIndex = Array.from(new Set([...(existing.hdIndex || []), ...Object.keys(hd)]));
    return {
      notebooks,
      typedNotes,
      notes,
      hd,
      hdIndex,
      summary: {
        notebooksNew,
        notebooksMerged,
        typedNew: incomingTyped.length,
        typedSkipped,
        selectionsNew: incomingSel.length,
        selectionsSkipped,
        images,
      },
    };
  }

  return { FORMAT, VERSION, LIMITS, validate, buildExport, plan };
})();

if (typeof module !== "undefined") module.exports = NotesBackup;