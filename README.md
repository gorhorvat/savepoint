# Savepoint

Every game you've played on Steam, Epic Games, PlayStation, Xbox and Nintendo Switch in one library, with play time added up across platforms.

- **Library**: total hours per game, split by platform, with genres and sub-genres. Filter by platform, genre or status, and sort by hours, recency, title, your rating or how well a game fits your taste. The Backlog filter lists games you own but have played for under 2 hours (Steam imports include unplayed games).
- **Play status and ratings**: mark a game Playing, Backlog, Finished, 100% or Dropped, rate it 1 to 5 stars and record when you finished it. Ratings and drops weigh into recommendations.
- **Game pages**: critic score (OpenCritic), typical time to beat (HowLongToBeat, no key needed) and a screenshot gallery (IGDB). Library sorts by shortest to beat, and backlog rows show each game's length.
- **Deals and alerts**: the wishlist shows the best PC deal across official stores and the all-time low (IsThereAnyDeal). With `NTFY_TOPIC` set, the server checks target prices every six hours while it runs and sends a push notification through the ntfy app.
- **Achievements**: Steam achievements, PlayStation trophies and Xbox achievements per game, fetched in the background after a sync (Steam is one request per game, so only games with new play time are re-checked).
- **My Stats**: genres, platforms, play depth, eras and more. Savepoint records play time history from the change between syncs, starting the first time you import, so hours per month this year fill in from then on.
- **Genres** are looked up on Steam first, then IGDB (covers console exclusives), then Wikidata.
- **Discover**: recommendations scored against your taste profile, which is built from the genres you spend the most hours in (weighted by your ratings and drops). Candidates are always live: well-reviewed Steam games and popular Nintendo eShop games in your favourite genres, never a fixed list. "More like this" on game pages and the assistant use the same pool.
- **Assistant**: ask for suggestions in plain language, answered by a free local model through Ollama. Falls back to the built-in recommender when Ollama isn't running.
- **Wishlist**: best price across trusted stores, with a target price for each game.
- **Stores**: official storefronts and authorized resellers only, with a price comparison.

React 19, Vite, Mantine 9, and a small Express server for the APIs that need secrets or block browser requests.

## Run it

Needs Node 22.12 or later.

```bash
npm install
copy .env.example .env   # Windows; use cp on macOS/Linux. Optional.
npm run dev              # web on http://localhost:5173, API on :8787
```

The app works without any keys; live PC prices need none. Suggestions need `STEAM_API_KEY` for Steam games (Switch suggestions need no key).

## Platforms

| Platform        | How play time gets in                      | Needs                                    |
| --------------- | ------------------------------------------ | ---------------------------------------- |
| Steam           | Connect Steam (Steam's login), then import | `STEAM_API_KEY`, public "Game details"   |
| PlayStation     | PSN import (unofficial API via `psn-api`)  | Each user's own NPSSO token, in Settings |
| Xbox            | OpenXBL import (unofficial)                | Each user's own OpenXBL key, in Settings |
| Nintendo Switch | Added by hand                              | Nothing (Nintendo has no public API)     |
| Epic Games      | Added by hand                              | Nothing (Epic doesn't expose play time)  |

Each account connects its own PlayStation and Xbox in Settings, Platforms, following the steps shown there: the NPSSO token from Sony's site, or an API key from xbl.io. Savepoint stores them encrypted (with a key derived from `SESSION_SECRET`, so changing that means connecting again), keeps only PlayStation's renewable token rather than the NPSSO itself, and never shows them again. Disconnect removes the connection and the games imported from it. The PlayStation Store part of game search uses the searching user's own PlayStation connection, and is left out for users without one.

A game played on more than one platform is merged into one entry, matched by Steam app ID or normalized title.

## Prices

PC prices for Steam, Epic, GOG, Humble, Fanatical and Green Man Gaming come live from [CheapShark](https://www.cheapshark.com). Switch prices come live from the Nintendo eShop. The PlayStation Store has no public price API, so it shows the game's typical full price, labelled "Full price".

With a free [GG.deals API key](https://gg.deals/api/) in `GGDEALS_API_KEY`, games on Steam also show the lowest current key-shop price (G2A, Eneba, Kinguin and others) with a link to GG.deals' comparison. GG.deals gives one lowest price, not a per-shop list.

## Assistant

Two free ways to run the assistant:

- **Gemini (recommended, nothing to install):** create a free API key at [Google AI Studio](https://aistudio.google.com) and set `GEMINI_API_KEY` in `.env`. The free tier needs no card and is available in the EU; its daily limit is far more than a personal assistant uses. For users in the EEA, UK and Switzerland, Google's terms apply its paid-tier data protections to free usage. Savepoint tries `gemini-3.5-flash`, then `gemini-3.5-flash-lite`, then `gemini-3.1-flash-lite`, moving on when one is busy or slow; set `GEMINI_MODEL` to use just one.
- **Ollama (offline, on your own GPU):** install [Ollama](https://ollama.com), run `ollama pull qwen3:14b`, and leave `GEMINI_API_KEY` empty (or set `ASSISTANT_PROVIDER=ollama`). `qwen3:14b` fits a 12 GB graphics card such as an RTX 4070 Super.

With Gemini, the assistant can also look games up while answering: release date and platforms (from the store searches), Steam's player review score, and Wikipedia's reception summary. So questions like "Is Control Resonant good?" get current facts rather than the model's training-cutoff knowledge. (Gemini's own Google Search isn't included in the free tier, so Savepoint does the lookups itself.) The local Ollama option doesn't have this.

Either way, each question includes your library, your taste profile, and about 30 candidate games from the live suggestion pool with their real platforms. The model picks from those and explains why, and any game it names outside the suggestions is marked as not checked. Without either, answers come from the built-in recommender.

## Keeping data fresh

When the app opens, it re-syncs each connected source whose last sync is more than 6 hours old: your Steam library, your PlayStation library, and your Steam wishlist. The Sync buttons on the Platforms and Wishlist pages still work any time. Switch and Epic play time is entered by hand. Prices are fetched when a page opens and cached on the server for 30 minutes. Steam's full game list, used for search, is re-downloaded weekly.

## Data

Your library, wishlist, play history and the rest are saved in a Postgres database (Neon's free plan, `DATABASE_URL`), so every device sees the same data. The tables are created automatically on first use; `server/schema.mjs` lists them and how the app's data maps onto them. Disconnecting a platform removes the games imported from it.

You log in with a Savepoint account, with a username and password or through Steam ("Sign in through Steam", Steam's own login page). A Steam account that isn't linked to Savepoint yet gets two choices: create a new account with the invite code (its Steam library is imported right away, and it can set a password in Profile later), or log in to an existing account once, which links Steam to it. Profile can unlink Steam from an account that has a password. People with the invite code can create an account from the login screen ("Create an account"); the super admin sees, changes or turns off that code in Profile, and without a code sign-up is closed. `npm run setup-account` creates accounts from the command line and sets a new password for an existing one (there's no reset email); the first account it creates is the super admin. Only the super admin can use their own PlayStation and Xbox imports and price alerts. Profile has a Change password form.

## Deploy (Vercel)

Pushing to `main` deploys to Vercel (`vercel.json`): the built site from `dist/`, and `/api/*` served by the same Express app as a Vercel function (`api/index.js`). Set the variables from `.env.example` in the Vercel project, plus:

- `DATABASE_URL`: the same Neon connection string as locally.
- `SESSION_SECRET` (required) and `CRON_SECRET`: long random strings.
- An Upstash Redis database from the Vercel Marketplace (free plan), connected to the project. It adds `KV_REST_API_URL` and `KV_REST_API_TOKEN`, and the server caches go there instead of `.cache/`.

Price alerts are checked once a day by Vercel Cron (the free plan's limit) instead of every six hours.
