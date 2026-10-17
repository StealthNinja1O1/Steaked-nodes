/**
 * booru/dtext.js – Render danbooru DText wiki markup to safe HTML.
 * Supports: headers, bold/italic, [[wikilinks]], "label":url links, lists,
 * quotes, basic tables, <>, [spoilers]. Everything else passes as plain text.
 */

function inline(text) {
  let s = text;
  s = s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  // [[tag]] or [[tag|label]]
  s = s.replace(
    /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g,
    (_, link, label) =>
      `<a href="#" class="booru-wikilink" data-tag="${link.trim().replace(/\s+/g, "_").toLowerCase()}">${label || link}</a>`,
  );
  // "label":url
  s = s.replace(
    /"([^"]+)":((?:https?|\/)[^\s]+)/g,
    '<a href="$2" target="_blank" rel="noopener">$1</a>',
  );
  s = s.replace(/\[b\]([\s\S]*?)\[\/b\]/g, "<strong>$1</strong>");
  s = s.replace(/\[i\]([\s\S]*?)\[\/i\]/g, "<em>$1</em>");
  s = s.replace(/\[tn\]([\s\S]*?)\[\/tn\]/g, '<span class="booru-tn">$1</span>');
  // inline [[#id|comment]] notes are rare in tag wikis, strip them
  s = s.replace(/\[\[#\d+\|[^\]]*\]\]/g, "");
  return s;
}

export function renderDText(body) {
  if (!body) return "";
  const lines = body.split(/\r?\n/);
  const out = [];
  let listStack = [];
  let inQuote = false;
  let tableBuffer = null;

  const closeLists = () => {
    while (listStack.length) out.push(listStack.pop() === "ul" ? "</ul>" : "</ol>");
  };
  const closeQuote = () => {
    if (inQuote) {
      out.push("</blockquote>");
      inQuote = false;
    }
  };
  const closeTable = () => {
    if (tableBuffer) {
      out.push("</tbody></table>");
      tableBuffer = null;
    }
  };

  for (const raw of lines) {
    const line = raw.trimEnd();

    if (/^\s*\|.+\|\s*$/.test(line)) {
      const cells = line.split("|").map((c) => c.trim()).filter((c, i, arr) => !(c === "" && (i === 0 || i === arr.length - 1)));
      if (!tableBuffer) {
        closeLists();
        closeQuote();
        out.push('<table class="booru-table"><tbody>');
        tableBuffer = [];
      }
      if (cells.every((c) => /^h[.]/.test(c))) {
        out.push("<tr>" + cells.map((c) => `<th>${inline(c.replace(/^h\./, ""))}</th>`).join("") + "</tr>");
      } else {
        out.push("<tr>" + cells.map((c) => `<td>${inline(c)}</td>`).join("") + "</tr>");
      }
      continue;
    }
    closeTable();

    const h = line.match(/^h([1-6])\.\s*(.*)$/);
    if (h) {
      closeLists();
      closeQuote();
      out.push(`<h${+h[1] + 1} class="booru-h">${inline(h[2])}</h${+h[1] + 1}>`);
      continue;
    }

    const ul = line.match(/^\*\s+(.*)$/);
    if (ul) {
      if (listStack[listStack.length - 1] !== "ul") {
        closeLists();
        out.push("<ul>");
        listStack.push("ul");
      }
      out.push(`<li>${inline(ul[1])}</li>`);
      continue;
    }

    const ol = line.match(/^#\s+(.*)$/);
    if (ol) {
      if (listStack[listStack.length - 1] !== "ol") {
        closeLists();
        out.push("<ol>");
        listStack.push("ol");
      }
      out.push(`<li>${inline(ol[1])}</li>`);
      continue;
    }

    if (/^>\s?/.test(line)) {
      closeLists();
      if (!inQuote) {
        out.push('<blockquote class="booru-quote">');
        inQuote = true;
      }
      out.push(inline(line.replace(/^>\s?/, "")) + "<br>");
      continue;
    }
    closeQuote();

    if (line.trim() === "") {
      closeLists();
      continue;
    }

    out.push(`<p>${inline(line)}</p>`);
  }
  closeTable();
  closeLists();
  closeQuote();
  return out.join("\n");
}

/** First-paragraph plain text excerpt, for the compact tooltip. */
export function dtextExcerpt(body, maxLen = 250) {
  if (!body) return "";
  let text = body.replace(/^h[1-6]\.\s+/gm, "");
  text = text.replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_, l, label) => label || l);
  text = text.replace(/"([^"]+)":\S+/g, "$1");
  text = text.replace(/\[\/?[bice]\]|\[\/?tn\]/g, "");
  const paragraphs = text.split(/\n\n+/).filter((p) => p.trim());
  let excerpt = (paragraphs[0] || "").trim();
  if (excerpt.length > maxLen) excerpt = excerpt.slice(0, maxLen) + "...";
  return excerpt;
}

/** Tags from the "See also" wiki section. */
export function dtextRelatedTags(body, limit = 5) {
  if (!body) return [];
  const m = body.match(/h[1-6]\.\s*See [Aa]lso\s*\n+([\s\S]*?)(?=\n\nh[1-6.]|$)/);
  if (!m) return [];
  const tags = [];
  for (const link of m[1].match(/\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g) || []) {
    const tag = link.replace(/\[\[([^\]|]+)(\|[^\]]+)?\]\]/, "$1").trim().toLowerCase().replace(/\s+/g, "_");
    if (tag && !tags.includes(tag)) tags.push(tag);
  }
  return tags.slice(0, limit);
}
