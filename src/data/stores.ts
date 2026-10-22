import type { Game, PlatformId, StoreId } from '../types';

export interface StoreInfo {
  id: StoreId;
  name: string;
  url: string;
  /** Which platform the keys or downloads work on. */
  sellsFor: PlatformId[];
  kind: 'Official storefront' | 'Authorized reseller' | 'Key marketplace';
  about: string;
  searchUrl: (game: Game) => string;
}

const q = (g: Game) => encodeURIComponent(g.title);

export const STORES: StoreInfo[] = [
  {
    id: 'steam',
    name: 'Steam',
    url: 'https://store.steampowered.com',
    sellsFor: ['steam'],
    kind: 'Official storefront',
    about: "Valve's store. Refunds within 14 days if played under 2 hours.",
    searchUrl: (g) =>
      g.steamAppId
        ? `https://store.steampowered.com/app/${g.steamAppId}`
        : `https://store.steampowered.com/search/?term=${q(g)}`,
  },
  {
    id: 'epic',
    name: 'Epic Games Store',
    url: 'https://store.epicgames.com',
    sellsFor: ['epic'],
    kind: 'Official storefront',
    about: 'Weekly free games. Refunds within 14 days if played under 2 hours.',
    searchUrl: (g) => `https://store.epicgames.com/en-US/browse?q=${q(g)}`,
  },
  {
    id: 'psstore',
    name: 'PlayStation Store',
    url: 'https://store.playstation.com',
    sellsFor: ['playstation'],
    kind: 'Official storefront',
    about: "Sony's store for PS4 and PS5. Extra discounts with PlayStation Plus.",
    searchUrl: (g) => `https://store.playstation.com/en-us/search/${q(g)}`,
  },
  {
    id: 'eshop',
    name: 'Nintendo eShop',
    url: 'https://www.nintendo.com/store/',
    sellsFor: ['switch'],
    kind: 'Official storefront',
    about: "Nintendo's store for Switch and Switch 2. Earns Gold Points on purchases.",
    searchUrl: (g) => `https://www.nintendo.com/us/search/#q=${q(g)}`,
  },
  {
    id: 'gog',
    name: 'GOG',
    url: 'https://www.gog.com',
    sellsFor: ['steam'],
    kind: 'Official storefront',
    about: 'DRM-free PC games you keep as installers. 30-day refunds.',
    searchUrl: (g) => `https://www.gog.com/en/games?query=${q(g)}`,
  },
  {
    id: 'humble',
    name: 'Humble Store',
    url: 'https://www.humblebundle.com/store',
    sellsFor: ['steam'],
    kind: 'Authorized reseller',
    about: 'Sells Steam keys from publishers directly. Part of each sale goes to charity.',
    searchUrl: (g) => `https://www.humblebundle.com/store/search?search=${q(g)}`,
  },
  {
    id: 'fanatical',
    name: 'Fanatical',
    url: 'https://www.fanatical.com',
    sellsFor: ['steam'],
    kind: 'Authorized reseller',
    about: 'Officially licensed Steam keys, often cheaper than Steam outside sales.',
    searchUrl: (g) => `https://www.fanatical.com/en/search?search=${q(g)}`,
  },
  {
    id: 'gmg',
    name: 'Green Man Gaming',
    url: 'https://www.greenmangaming.com',
    sellsFor: ['steam'],
    kind: 'Authorized reseller',
    about: 'Publisher-authorized Steam keys with a loyalty discount for members.',
    searchUrl: (g) => `https://www.greenmangaming.com/search?query=${q(g)}`,
  },
  // Marketplaces where independent sellers list keys. Prices are often lower,
  // but each key comes from a third-party seller, so check seller ratings and
  // the site's buyer protection. None has a public price feed, so Savepoint
  // links to a search instead of showing a price.
  {
    id: 'eneba',
    name: 'Eneba',
    url: 'https://www.eneba.com',
    sellsFor: ['steam', 'epic', 'playstation', 'switch'],
    kind: 'Key marketplace',
    about: 'Large marketplace for game keys and gift cards, with buyer protection on every order.',
    searchUrl: (g) => `https://www.eneba.com/store/all?text=${q(g)}`,
  },
  {
    id: 'g2a',
    name: 'G2A',
    url: 'https://www.g2a.com',
    sellsFor: ['steam', 'epic', 'playstation', 'switch'],
    kind: 'Key marketplace',
    about: 'One of the biggest key marketplaces. G2A Plus adds extra buyer protection.',
    searchUrl: (g) => `https://www.g2a.com/search?query=${q(g)}`,
  },
  {
    id: 'gamivo',
    name: 'Gamivo',
    url: 'https://www.gamivo.com',
    sellsFor: ['steam', 'epic', 'playstation', 'switch'],
    kind: 'Key marketplace',
    about: 'Key marketplace with lower prices for members of its Smart subscription.',
    searchUrl: (g) => `https://www.gamivo.com/search/${q(g)}`,
  },
  {
    id: 'kinguin',
    name: 'Kinguin',
    url: 'https://www.kinguin.net',
    sellsFor: ['steam', 'epic', 'playstation', 'switch'],
    kind: 'Key marketplace',
    about: 'Long-running key marketplace with optional buyer protection.',
    searchUrl: (g) => `https://www.kinguin.net/listing?phrase=${q(g)}`,
  },
  {
    id: 'hrk',
    name: 'HRK Game',
    url: 'https://www.hrkgame.com',
    sellsFor: ['steam'],
    kind: 'Key marketplace',
    about: 'Key shop focused on Steam keys, with a points-based loyalty program.',
    searchUrl: (g) => `https://www.hrkgame.com/en/games/products/?search=${q(g)}`,
  },
];

/** Stores that link out without a price, shown separately from priced stores. */
export const MARKETPLACES = STORES.filter((s) => s.kind === 'Key marketplace');

export const STORE_BY_ID = Object.fromEntries(STORES.map((s) => [s.id, s])) as Record<StoreId, StoreInfo>;

/** What a purchase from each store gets you. */
export const STORE_DELIVERS: Record<StoreId, string> = {
  steam: 'PC, Steam',
  epic: 'PC, Epic',
  psstore: 'PS4 / PS5',
  eshop: 'Switch',
  gog: 'PC, DRM-free',
  humble: 'PC, Steam key',
  fanatical: 'PC, Steam key',
  gmg: 'PC, Steam key',
  eneba: 'PC and console keys',
  g2a: 'PC and console keys',
  gamivo: 'PC and console keys',
  kinguin: 'PC and console keys',
  hrk: 'PC, Steam key',
};
