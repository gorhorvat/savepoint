// Gaming news for the homepage: the newest headlines from big gaming sites,
// read from their public RSS feeds (no keys). Each feed is kept for 30 minutes.

const USER_AGENT = 'Mozilla/5.0 (compatible; Savepoint/0.1; +self-hosted game library)';

export const NEWS_SOURCES = {
  ign: { name: 'IGN', url: 'https://www.ign.com/rss/v2/articles/feed' },
  gamespot: { name: 'GameSpot', url: 'https://www.gamespot.com/feeds/mashup/' },
  pcgamer: { name: 'PC Gamer', url: 'https://www.pcgamer.com/feeds.xml' },
  eurogamer: { name: 'Eurogamer', url: 'https://www.eurogamer.net/feed' },
  polygon: { name: 'Polygon', url: 'https://www.polygon.com/rss/index.xml' },
  kotaku: { name: 'Kotaku', url: 'https://kotaku.com/feed' },
  rps: { name: 'Rock Paper Shotgun', url: 'https://www.rockpapershotgun.com/feed' },
  gamesradar: { name: 'GamesRadar+', url: 'https://www.gamesradar.com/feeds.xml' },
};

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

function decode(s) {
  return String(s ?? '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
      if (e[0] === '#') {
        const code = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : Number(e.slice(1));
        return Number.isFinite(code) ? String.fromCodePoint(code) : m;
      }
      return ENTITIES[e.toLowerCase()] ?? m;
    });
}

const text = (html) =>
  decode(html)
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const tag = (xml, name) => xml.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, 'i'))?.[1];
const attr = (xml, name, attribute) =>
  xml.match(new RegExp(`<${name}\\b[^>]*\\b${attribute}=["']([^"']+)["']`, 'i'))?.[1];

/** One RSS <item> or Atom <entry> -> { title, url, publishedAt, image, summary }. */
function parseItem(xml) {
  const title = text(tag(xml, 'title'));
  const link = decode(tag(xml, 'link')?.trim() || attr(xml, 'link', 'href') || tag(xml, 'guid') || '').trim();
  const date = tag(xml, 'pubDate') ?? tag(xml, 'published') ?? tag(xml, 'updated') ?? tag(xml, 'dc:date');
  const description = tag(xml, 'description') ?? tag(xml, 'summary') ?? tag(xml, 'content:encoded') ?? '';
  const image =
    attr(xml, 'media:content', 'url') ??
    attr(xml, 'media:thumbnail', 'url') ??
    attr(xml, 'enclosure', 'url') ??
    decode(description).match(/<img[^>]+src=["']([^"']+)["']/i)?.[1];
  const published = date ? new Date(text(date)) : null;
  return {
    title,
    url: /^https?:\/\//.test(link) ? link : undefined,
    publishedAt: published && !Number.isNaN(published.getTime()) ? published.toISOString() : undefined,
    image: image && /^https?:\/\//.test(decode(image)) ? decode(image) : undefined,
    summary: text(description).slice(0, 220) || undefined,
  };
}

const feedCache = new Map();

async function readFeed(id) {
  const hit = feedCache.get(id);
  if (hit && hit.at > Date.now() - 30 * 60 * 1000) return hit.items;
  const source = NEWS_SOURCES[id];
  const r = await fetch(source.url, {
    headers: { 'User-Agent': USER_AGENT, Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml' },
    signal: AbortSignal.timeout(8000),
  });
  if (!r.ok) throw new Error(`${source.name}: HTTP ${r.status}`);
  const xml = await r.text();
  const blocks = [...xml.matchAll(/<(item|entry)\b[\s\S]*?<\/\1>/gi)].map((m) => m[0]);
  const items = blocks
    .slice(0, 25)
    .map(parseItem)
    .filter((i) => i.title && i.url)
    .map((i) => ({ ...i, source: source.name, sourceId: id }));
  feedCache.set(id, { at: Date.now(), items });
  return items;
}

/** The newest headlines across `ids` (all sources when empty), newest first. */
export async function latestNews(ids, limit = 20) {
  const wanted = (ids.length ? ids : Object.keys(NEWS_SOURCES)).filter((id) => id in NEWS_SOURCES);
  const lists = await Promise.all(wanted.map((id) => readFeed(id).catch(() => [])));
  // A few from each site first, so one busy site doesn't fill the list.
  const perSource = Math.max(3, Math.ceil(limit / Math.max(1, wanted.length)) + 1);
  return lists
    .flatMap((list) => list.slice(0, perSource))
    .sort((a, b) => (b.publishedAt ?? '').localeCompare(a.publishedAt ?? ''))
    .slice(0, limit);
}
