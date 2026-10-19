/**
 * API helpers for the Smart Model Loader.
 */

export async function getModels() {
  const r = await fetch("/steaked/model/list");
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(body.error || `Failed to list models (${r.status})`);
  return body.models ?? [];
}

export async function fetchModelCivitai(name, folder) {
  const r = await fetch("/steaked/model/fetch-civitai", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, folder }),
  });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(body.error || `Civitai fetch failed (${r.status})`);
  return body;
}

export async function getVaes() {
  const r = await fetch("/steaked/model/vaes");
  if (!r.ok) throw new Error(`Failed to list VAEs (${r.status})`);
  return r.json();
}

export async function getClips() {
  const r = await fetch("/steaked/model/clips");
  if (!r.ok) throw new Error(`Failed to list CLIPs (${r.status})`);
  return r.json();
}
