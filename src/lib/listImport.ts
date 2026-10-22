export interface ParsedLine {
  /** The line as typed, for showing next to the match. */
  line: string;
  title: string;
  minutes: number;
  physical: boolean;
  /** ISO date from "last played 2026-08-12" (or 12/08/2026), if given. */
  lastPlayed: string | null;
}

/**
 * One game per line: "Super Mario Odyssey — 25 h", "Hades: 31 hours",
 * "Celeste 6h", "Tetris 99 | 45 min". Add "(physical)" for a cartridge or disc.
 * The last number on the line is the play time. An optional
 * "last played 2026-08-12" (or 12/08/2026, day first) sets the date.
 */
export function parseList(text: string): ParsedLine[] {
  const out: ParsedLine[] = [];
  for (const raw of text.split('\n')) {
    let line = raw.replace(/^\s*([-*•]|\d+[.)])\s+/, '').trim();
    if (!line) continue;
    let lastPlayed: string | null = null;
    const date =
      /[\s,;(]*last played:?\s*(\d{4})-(\d{1,2})-(\d{1,2})\)?|[\s,;(]*last played:?\s*(\d{1,2})[./](\d{1,2})[./](\d{4})\)?/i.exec(
        line,
      );
    if (date) {
      const [y, m, d] = date[1] ? [date[1], date[2], date[3]] : [date[6], date[5], date[4]];
      const iso = `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}T20:00:00Z`;
      if (!Number.isNaN(Date.parse(iso))) lastPlayed = iso;
      line = (line.slice(0, date.index) + line.slice(date.index + date[0].length)).trim();
    }
    const physical = /\(?\bphysical\b\)?/i.test(line);
    line = line.replace(/\(?\bphysical\b\)?/gi, ' ').trim();
    let minutes = 0;
    const time = /([\s,:|\t–—-]+)(\d+(?:[.,]\d+)?)\s*\+?\s*(h|hrs?|hours?|m|mins?|minutes?)?\s*(or more)?\s*$/i.exec(
      line,
    );
    // A bare number after a space is part of the title ("Mario Kart 8");
    // it's play time only with a unit or a separator like "—", ":" or "|".
    if (time && (time[3] || /[,:|\t–—-]/.test(time[1]))) {
      const n = Number(time[2].replace(',', '.'));
      minutes = /^m/i.test(time[3] ?? '') ? Math.round(n) : Math.round(n * 60);
      line = line.slice(0, time.index);
    }
    const title = line.replace(/[\s,:|\t–—-]+$/, '').trim();
    if (title) out.push({ line: raw.trim(), title, minutes, physical, lastPlayed });
  }
  return out;
}
