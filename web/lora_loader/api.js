export async function getLoras() {
  const r = await fetch("/steaked/library/loras");
  if (!r.ok) throw new Error(`Failed to list loras (${r.status})`);
  return r.json();
}

export async function getCombos() {
  const r = await fetch("/steaked/lora/combos");
  if (!r.ok) throw new Error(`Failed to load combos (${r.status})`);
  return r.json();
}

export async function saveCombos(data) {
  const r = await fetch("/steaked/lora/combos", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(body.error || `Failed to save combos (${r.status})`);
  return body;
}

export async function getLocalInfo(loraName) {
  const r = await fetch(`/steaked/lora/local-info/${encodeURIComponent(loraName)}`);
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(body.error || `Failed to read info (${r.status})`);
  return body;
}

export async function fetchCivitai(loraName) {
  const r = await fetch("/steaked/library/lora/fetch-civitai", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ lora_name: loraName }),
  });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(body.error || `Civitai fetch failed (${r.status})`);
  return body;
}
