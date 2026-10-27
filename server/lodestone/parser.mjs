// Reads a Lodestone page with XIVAPI's CSS selector files (./selectors, from
// https://github.com/xivapi/lodestone-css-selectors, public domain). The same
// approach as XIVAPI's Nodestone: when Square Enix changes the Lodestone
// layout, updating those JSON files is usually all that's needed.
//
// A selector file is a tree: a leaf has `selector` (plus optional `attribute`,
// `regex` with named groups, `multiple`); a branch with ROOT is a list (one
// entry per ROOT match, the rest read inside it); any other branch is an object.
import { parseHTML } from 'linkedom';

const isLeaf = (def) => def && typeof def === 'object' && typeof def.selector === 'string';

/** The selector files use Python's (?P<name>...) groups; JavaScript writes (?<name>...). */
const toRegExp = (pattern) => new RegExp(pattern.replace(/\(\?P</g, '(?<'));

// Long IDs (Free Company IDs have 19 digits) stay text so they aren't rounded.
const asNumber = (v) => {
  if (typeof v !== 'string' || !/^-?\d+(\.\d+)?$/.test(v.trim())) return v;
  const n = Number(v);
  return Number.isSafeInteger(Math.trunc(n)) ? n : v.trim();
};

function leafValue(el, def) {
  if (!el) return null;
  if (def.regex) {
    const raw = def.attribute ? (el.getAttribute(def.attribute) ?? '') : el.innerHTML;
    const match = toRegExp(def.regex).exec(raw);
    if (!match?.groups) return null;
    return Object.fromEntries(
      Object.entries(match.groups).map(([k, v]) => [k, v == null ? null : asNumber(decode(v))]),
    );
  }
  if (def.attribute) return el.getAttribute(def.attribute) || null;
  const text = el.textContent?.replace(/\s+/g, ' ').trim();
  return text ? asNumber(text) : null;
}

/** Turns &amp; and friends in regex captures (taken from HTML) into text. */
function decode(s) {
  return s
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]*>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .trim();
}

function read(def, scope) {
  if (!def || typeof def !== 'object') return null;
  if (isLeaf(def)) {
    if (def.multiple) return [...scope.querySelectorAll(def.selector)].map((el) => leafValue(el, def));
    return leafValue(scope.querySelector(def.selector), def);
  }
  const { ROOT, ...rest } = def;
  if (ROOT) {
    if (ROOT.multiple) {
      return [...scope.querySelectorAll(ROOT.selector)].map((el) => readObject(rest, el));
    }
    const inner = scope.querySelector(ROOT.selector);
    return inner ? readObject(rest, inner) : null;
  }
  return readObject(def, scope);
}

function readObject(def, scope) {
  const out = {};
  for (const [key, child] of Object.entries(def)) {
    const value = read(child, scope);
    if (value !== null && value !== undefined) out[key] = value;
  }
  return out;
}

/** Everything the selector file describes, read from the page's HTML. */
export function parsePage(html, selectors) {
  const { document } = parseHTML(html);
  return read(selectors, document) ?? {};
}
