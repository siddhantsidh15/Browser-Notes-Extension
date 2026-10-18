// images.js — image compression + storage helpers, shared by the popup / side panel
// and the full-page note viewer. (Moved out of popup.js unchanged.)

const IMG_MAX_DIM = 1000; // longest side in px; smaller images are never enlarged
const IMG_QUALITY = 0.5; // WebP quality, 0–1

// A second, sharper copy of every image is kept ONLY for exports (PDF / Markdown).
// It lives under its own storage key ("hd:<id>"), so notes, lists and the editor
// keep using the small copy and stay fast.
const IMG_HD_MAX_DIM = 1920;
const IMG_HD_QUALITY = 0.8;

function encodeImage(src, maxDim, quality) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, maxDim / Math.max(img.naturalWidth, img.naturalHeight));
      const w = Math.max(1, Math.round(img.naturalWidth * scale));
      const h = Math.max(1, Math.round(img.naturalHeight * scale));
      const c = document.createElement("canvas");
      c.width = w;
      c.height = h;
      const ctx = c.getContext("2d");
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(img, 0, 0, w, h);
      let out = c.toDataURL("image/webp", quality);
      if (!out.startsWith("data:image/webp")) out = c.toDataURL("image/jpeg", quality);
      // Tiny images (icons etc.) can come out bigger — keep the original then
      resolve(scale === 1 && out.length >= src.length ? src : out);
    };
    img.onerror = () => reject(new Error("Could not decode image"));
    img.src = src;
  });
}

// Stored one write at a time so the small "hdIndex" list never gets clobbered
let hdQueue = Promise.resolve();
function storeHdImage(id, dataUrl) {
  hdQueue = hdQueue
    .then(async () => {
      const r = await chrome.storage.local.get(["hdIndex"]);
      const index = r.hdIndex || [];
      if (!index.includes(id)) index.push(id);
      await chrome.storage.local.set({ ["hd:" + id]: dataUrl, hdIndex: index });
    })
    .catch((err) => console.error("Could not store export image:", err));
  return hdQueue;
}

const kbOf = (dataUrl) => Math.max(1, Math.round((dataUrl.length * 0.75) / 1024));

// Only keep images whose [[img:<id>]] token still appears in the given text —
// drops anything the user pasted then deleted before saving.
function pruneImages(text, images) {
  const used = {};
  const re = /\[\[img:([\w-]+)\]\]/g;
  let m;
  while ((m = re.exec(text))) {
    if (images[m[1]]) used[m[1]] = images[m[1]];
  }
  return used;
}