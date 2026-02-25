/**
 * library/api.js  –  Fetch helpers and utility functions.
 */

export const apiGet  = p      => fetch(p).then(r => r.json());
export const apiPost = (p, b) => fetch(p, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(b),
}).then(r => r.json());

export function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

export function uid(list) {
  let id = `c${Date.now()}`;
  while (list.includes(id)) id += "x";
  return id;
}

/** Trigger a browser file-save from a Blob or URL. */
export function downloadBlob(blob, filename) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}

/** Fetch the output-image URL ComfyUI uses after a generation. */
export function comfyImageUrl(info) {
  return `/view?filename=${encodeURIComponent(info.filename)}&subfolder=${encodeURIComponent(info.subfolder ?? "")}&type=${info.type ?? "output"}`;
}
