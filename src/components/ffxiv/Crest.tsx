/** A Free Company or PvP team crest: up to three stacked image layers. */
export function Crest({ layers, size = 48 }: { layers: string[] | undefined; size?: number }) {
  if (!layers?.length) return null;
  return (
    <div style={{ position: 'relative', width: size, height: size, flexShrink: 0 }} aria-hidden>
      {layers.map((src, i) => (
        <img key={i} src={src} alt="" width={size} height={size} style={{ position: 'absolute', inset: 0 }} />
      ))}
    </div>
  );
}
