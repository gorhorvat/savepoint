// Shops to search for physical wants, set in Settings as plain domains
// ("amazon.de", "vinted.hr"). Shops with a known search page are searched
// directly; any other domain is searched through Google ("site:shop.com …").

/** Search pages we know, by the shop's name in the domain (any country ending). */
const SEARCH_PAGES: { match: RegExp; url: (domain: string, q: string) => string }[] = [
  { match: /^ebay\./, url: (d, q) => `https://www.${d}/sch/i.html?_nkw=${q}` },
  { match: /^amazon\./, url: (d, q) => `https://www.${d}/s?k=${q}` },
  { match: /^vinted\./, url: (d, q) => `https://www.${d}/catalog?search_text=${q}` },
  { match: /^njuskalo\.hr$/, url: (d, q) => `https://www.${d}/search/?keywords=${q}` },
];

/** Offered in the Settings picker; you can type any other domain too. */
export const SHOP_SUGGESTIONS = [
  'ebay.com',
  'ebay.de',
  'ebay.co.uk',
  'amazon.de',
  'amazon.com',
  'amazon.co.uk',
  'amazon.it',
  'vinted.hr',
  'vinted.de',
  'vinted.com',
  'njuskalo.hr',
];

/** "https://www.Amazon.de/some/page" -> "amazon.de"; empty when it isn't a domain. */
export function normalizeVendor(input: string): string {
  const domain = input
    .trim()
    .toLowerCase()
    .replace(/^[a-z]+:\/\//, '')
    .replace(/^www\./, '')
    .split(/[/?#\s]/)[0];
  return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(domain) ? domain : '';
}

/** True when Savepoint can open the shop's own search page (not a Google search). */
export const searchesDirectly = (domain: string) => SEARCH_PAGES.some((p) => p.match.test(domain));

export function vendorSearchUrl(domain: string, query: string): string {
  const page = SEARCH_PAGES.find((p) => p.match.test(domain));
  if (page) return page.url(domain, encodeURIComponent(query));
  return `https://www.google.com/search?q=${encodeURIComponent(`site:${domain} ${query}`)}`;
}
