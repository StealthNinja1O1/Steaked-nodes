"""
Shared LoRA application logic.

Entry shape:
{
  "active": "free" | combo id,
  "free": [entry, ...],
  "combo": { "name": str, "entries": [entry, ...] }   # snapshot of active combo
}
entry = { "lora": str, "on": bool, "strength": float, "clip_strength": float|None }
"""


def normalize_entry(entry):
    if not isinstance(entry, dict):
        return None
    lora = entry.get("lora")
    if not isinstance(lora, str) or not lora.strip():
        return None
    try:
        strength = float(entry.get("strength", 1.0))
    except (TypeError, ValueError):
        strength = 1.0
    clip_raw = entry.get("clip_strength")
    if clip_raw is None or clip_raw == "":
        clip_strength = strength
    else:
        try:
            clip_strength = float(clip_raw)
        except (TypeError, ValueError):
            clip_strength = strength
    return {
        "lora": lora,
        "on": bool(entry.get("on", True)),
        "strength": strength,
        "clip_strength": clip_strength,
    }


def parse_stack(raw):
    if isinstance(raw, str):
        try:
            import json
            raw = json.loads(raw) if raw.strip() else {}
        except ValueError:
            return []
    if not isinstance(raw, dict):
        return []

    if isinstance(raw.get("combo"), dict):
        combo = raw["combo"]
        entries = [normalize_entry(e) for e in combo.get("entries", [])]
    else:
        entries = [normalize_entry(e) for e in raw.get("free", [])]
    return [e for e in entries if e is not None]


def apply_loras(model, clip, entries):
    import folder_paths
    from nodes import LoraLoader

    loader = LoraLoader()
    for entry in entries:
        if not entry["on"]:
            continue
        path = folder_paths.get_full_path("loras", entry["lora"])
        if path is None:
            print(f"[SteakedLoraLoader] LoRA not found: {entry['lora']}")
            continue
        try:
            model, clip = loader.load_lora(
                model, clip, entry["lora"], entry["strength"], entry["clip_strength"]
            )
        except Exception as e:
            print(f"[SteakedLoraLoader] Failed to apply LoRA '{entry['lora']}': {e}")
    return model, clip
