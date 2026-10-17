/**
 * booru/styles.js – Shared CSS for tooltip, detail modal and explorer.
 */

export const BOORU_STYLES = `
.booru-tooltip {
  position: fixed;
  background: var(--booru-bg, #1e1e1e);
  border: 1px solid #3a3a3a;
  border-radius: 4px;
  max-width: 400px;
  max-height: 600px;
  overflow-y: auto;
  z-index: 99999;
  color: #e0e0e0;
  font-size: 13px;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.6);
  animation: booru-fade-in 0.15s ease-out;
  line-height: 1.4;
}
@keyframes booru-fade-in {
  from { opacity: 0; transform: translateY(-5px); }
  to { opacity: 1; transform: translateY(0); }
}
.booru-tooltip-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  background: #242424;
  padding: 8px 10px;
  border-bottom: 1px solid #3a3a3a;
}
.booru-tag-info { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.booru-tag-name { font-weight: 600; font-size: 14px; }
.booru-tag-category {
  font-size: 10px;
  padding: 1px 5px;
  border-radius: 2px;
  color: #fff;
  font-weight: 600;
  text-transform: uppercase;
}
.booru-post-count { color: #999; font-size: 12px; }
.booru-provider-chip {
  font-size: 10px;
  color: #aaa;
  background: #333;
  border-radius: 2px;
  padding: 2px 6px;
}
.booru-tooltip-actions { display: flex; gap: 4px; }
.booru-icon-btn {
  background: #333;
  color: #ccc;
  border: 1px solid #444;
  border-radius: 3px;
  padding: 3px 8px;
  cursor: pointer;
  font-size: 12px;
  line-height: 1.4;
}
.booru-icon-btn:hover { background: #3f3f3f; color: #fff; border-color: #555; }
.booru-tooltip-body { padding: 10px; }
.booru-thumbnail {
  margin-bottom: 10px;
  text-align: center;
  background: #000;
  border-radius: 2px;
  overflow: hidden;
}
.booru-thumbnail img { max-width: 100%; max-height: 200px; display: block; margin: 0 auto; }
.booru-wiki-excerpt { color: #ccc; margin-bottom: 12px; line-height: 1.5; }
.booru-related-tags { margin-bottom: 12px; color: #999; }
.booru-related-tags a, .booru-wikilink { color: #6ea8fe; cursor: pointer; text-decoration: none; }
.booru-related-tags a:hover, .booru-wikilink:hover { text-decoration: underline; }
.booru-error { color: #f88; padding: 8px 0; }
.booru-loading { color: #aaa; padding: 8px 0; }
.booru-spinner { display: inline-block; animation: booru-spin 1s linear infinite; }
@keyframes booru-spin { to { transform: rotate(360deg); } }

/* ── Overlay (detail modal + explorer) ──────────────────────────────────── */
.booru-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.65);
  z-index: 99998;
  display: flex;
  align-items: center;
  justify-content: center;
  animation: booru-fade-in 0.12s ease-out;
}
.booru-overlay-inner { animation: booru-pop-in 0.15s ease-out; }
@keyframes booru-pop-in {
  from { opacity: 0; transform: scale(0.97); }
  to { opacity: 1; transform: scale(1); }
}
.booru-panel {
  background: var(--booru-bg, #1e1e1e);
  border: 1px solid #3a3a3a;
  border-radius: 4px;
  color: #e0e0e0;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.7);
}

/* ── Detail modal ───────────────────────────────────────────────────────── */
.booru-detail { width: min(980px, 92vw); height: min(780px, 88vh); }
.booru-detail-topbar {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 12px;
  border-bottom: 1px solid #3a3a3a;
  background: #242424;
  flex-shrink: 0;
}
.booru-detail-topbar .booru-tag-name { font-size: 15px; }
.booru-detail-tabs {
  display: flex;
  gap: 2px;
  flex: 1;
  overflow-x: auto;
  scrollbar-width: none; /* firefox */
}
.booru-detail-tabs::-webkit-scrollbar { display: none; } /* chrome */
.booru-tab {
  background: transparent;
  border: none;
  border-bottom: 2px solid transparent;
  color: #999;
  padding: 7px 10px 5px;
  cursor: pointer;
  font-size: 12px;
  white-space: nowrap;
  flex-shrink: 0;
}
.booru-tab:hover { color: #fff; background: #2e2e2e; }
.booru-tab.active { color: #fff; border-bottom-color: #6ea8fe; background: #2a2a33; }
.booru-tab .booru-tab-count { opacity: 0.55; margin-left: 4px; font-size: 10px; }
.booru-detail-content { flex: 1; overflow-y: auto; padding: 14px; }
.booru-detail-grid { display: grid; grid-template-columns: minmax(0, 1fr) 250px; gap: 14px; }
.booru-posts-strip-label {
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.6px;
  color: #777;
  margin-bottom: 6px;
}
.booru-posts-strip { display: flex; gap: 6px; overflow-x: auto; padding-bottom: 6px; }
.booru-posts-strip img {
  height: 130px;
  border-radius: 2px;
  cursor: pointer;
  flex-shrink: 0;
  border: 1px solid #333;
}
.booru-posts-strip img:hover { border-color: #6ea8fe; }
.booru-detail-sidebar { display: flex; flex-direction: column; gap: 10px; }
.booru-wiki-full h2.booru-h, h3.booru-h, h4.booru-h { color: #fff; margin: 14px 0 6px; }
.booru-wiki-full p { margin: 7px 0; color: #ccc; line-height: 1.55; }
.booru-wiki-full ul, .booru-wiki-full ol { margin: 7px 0 7px 20px; color: #ccc; }
.booru-wiki-full li { margin: 3px 0; }
.booru-quote { border-left: 3px solid #555; margin: 8px 0; padding: 4px 10px; color: #999; }
.booru-tn { color: #888; font-size: 11px; }
.booru-table { border-collapse: collapse; margin: 10px 0; color: #ccc; }
.booru-table th, .booru-table td { border: 1px solid #3a3a3a; padding: 5px 10px; font-size: 12px; text-align: left; }
.booru-sidebar-box {
  background: #242424;
  border: 1px solid #333;
  border-radius: 3px;
  padding: 10px 12px;
  font-size: 12px;
}
.booru-sidebar-box h4 { margin: 0 0 8px; color: #ddd; font-size: 10px; text-transform: uppercase; letter-spacing: 0.6px; }
.booru-sidebar-box .booru-alias { color: #aaa; display: block; margin: 2px 0; }
.booru-sidebar-box a { color: #6ea8fe; text-decoration: none; }
.booru-sidebar-box a:hover { text-decoration: underline; }
.booru-no-wiki { color: #777; font-style: italic; }
.booru-tab-error { padding: 60px 20px; text-align: center; }
.booru-tab-error-title { color: #fff; font-weight: 600; margin-bottom: 10px; font-size: 15px; }

/* ── Explorer ────────────────────────────────────────────────────────────── */
.booru-explorer { width: min(1200px, 96vw); height: min(860px, 92vh); }
.booru-explorer-topbar {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 12px;
  border-bottom: 1px solid #3a3a3a;
  background: #242424;
  flex-shrink: 0;
}
.booru-explorer-search {
  flex: 1;
  background: #1a1a1a;
  border: 1px solid #3a3a3a;
  border-radius: 3px;
  color: #e0e0e0;
  padding: 7px 12px;
  font-size: 13px;
  outline: none;
}
.booru-explorer-search:focus { border-color: #6ea8fe; }
.booru-select {
  background: #1a1a1a;
  border: 1px solid #3a3a3a;
  border-radius: 3px;
  color: #e0e0e0;
  padding: 7px 10px;
  font-size: 13px;
  cursor: pointer;
}
.booru-explorer-body { flex: 1; overflow-y: auto; padding: 14px; }
.booru-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
  gap: 10px;
}
.booru-grid-item {
  position: relative;
  border-radius: 3px;
  overflow: hidden;
  background: #111;
  cursor: pointer;
  aspect-ratio: 3 / 4;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 1px solid #2a2a2a;
}
.booru-grid-item:hover { border-color: #6ea8fe; }
.booru-grid-item img { max-width: 100%; max-height: 100%; object-fit: contain; }
.booru-grid-item .booru-grid-meta {
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  background: linear-gradient(transparent, rgba(0, 0, 0, 0.85));
  color: #ddd;
  font-size: 10px;
  padding: 14px 6px 4px;
  display: flex;
  justify-content: space-between;
}
.booru-grid-item .booru-grid-rating {
  position: absolute;
  top: 4px;
  right: 4px;
  font-size: 9px;
  font-weight: 700;
  padding: 1px 5px;
  border-radius: 2px;
  text-transform: uppercase;
  color: #fff;
}
.booru-rating-general { background: #0a7d32; }
.booru-rating-sensitive { background: #b48a00; }
.booru-rating-questionable { background: #c2571a; }
.booru-rating-explicit { background: #c01f1f; }
.booru-sentinel { height: 10px; }
.booru-load-more {
  display: block;
  margin: 14px auto;
  background: #2e2e2e;
  color: #ddd;
  border: 1px solid #444;
  border-radius: 3px;
  padding: 8px 24px;
  cursor: pointer;
  font-size: 13px;
}
.booru-load-more:hover { background: #3a3a3a; }
.booru-explorer-empty { color: #888; text-align: center; padding: 60px 0; }

/* ── Image lightbox ─────────────────────────────────────────────────────── */
.booru-lightbox {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.9);
  z-index: 99999;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-direction: column;
  gap: 10px;
}
.booru-lightbox img { max-width: 94vw; max-height: 84vh; border-radius: 4px; }
.booru-lightbox-info { color: #ccc; font-size: 12px; display: flex; gap: 14px; align-items: center; }
.booru-lightbox-info a { color: #6ea8fe; }

/* rating color legend chip in tooltip */
.booru-rating-chip { font-size: 10px; padding: 1px 6px; border-radius: 3px; color: #fff; text-transform: capitalize; }
`;
