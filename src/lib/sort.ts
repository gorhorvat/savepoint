/** Alphabetical, ignoring case and accents, with numbers in number order (Halo 2 before Halo 10). */
const collator = new Intl.Collator(undefined, { sensitivity: 'base', numeric: true });

export function compareTitles(a: string, b: string) {
  return collator.compare(a, b);
}
