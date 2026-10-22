import { useEffect, useState } from 'react';
import { requestCover } from '../lib/covers';
import { useStore } from '../lib/store';
import { upcomingLabel } from '../lib/format';
import type { Game } from '../types';

function hue(s: string) {
  let h = 0;
  for (const c of s) h = (h * 31 + c.charCodeAt(0)) % 360;
  return h;
}

/** Image URLs to try in order: the game's own, one looked up later, then Steam's classic header path. */
function coverUrls(game: Game, lookedUp?: string): string[] {
  const urls: string[] = [];
  if (game.imageUrl) urls.push(game.imageUrl);
  if (lookedUp && lookedUp !== game.imageUrl) urls.push(lookedUp);
  if (game.steamAppId) urls.push(`https://cdn.cloudflare.steamstatic.com/steam/apps/${game.steamAppId}/header.jpg`);
  return urls;
}

/**
 * Store header art when we have it, otherwise a typographic tile. Aspect
 * 460:215. Unreleased games get their release date on the cover.
 */
export function Cover({ game, width, radius = 8 }: { game: Game; width: number | string; radius?: number }) {
  // Games shown outside your library (recommendations, search) may not have
  // been looked up yet; their cover arrives in the store once it is.
  const lookedUp = useStore((s) => s.details[game.id]?.imageUrl);
  const urls = coverUrls(game, lookedUp);
  // Index of the URL that failed last, tagged with the URL list it belongs to.
  const [failed, setFailed] = useState<{ key: string; index: number } | null>(null);
  const key = urls.join('|');
  const attempt = failed?.key === key ? failed.index + 1 : 0;
  const url = urls[attempt];
  useEffect(() => {
    if (!url) requestCover(game);
  }, [url, game]);
  const h = hue(game.title);
  const numericWidth = typeof width === 'number' ? width : 200;
  const upcoming = upcomingLabel(game);
  return (
    <div className="cover" style={{ width, aspectRatio: '460 / 215', borderRadius: radius }}>
      {url ? (
        <img src={url} alt="" loading="lazy" onError={() => setFailed({ key, index: attempt })} />
      ) : (
        <div
          className="cover-fallback"
          aria-hidden
          style={{
            background: `linear-gradient(135deg, hsl(${h} 45% 34%), hsl(${(h + 40) % 360} 55% 22%))`,
            fontSize: Math.max(9, Math.min(22, numericWidth / 9)),
          }}
        >
          {game.title}
        </div>
      )}
      {upcoming && (
        <span className="cover-release" style={{ fontSize: numericWidth < 110 ? 9 : 11 }}>
          {upcoming}
        </span>
      )}
    </div>
  );
}
