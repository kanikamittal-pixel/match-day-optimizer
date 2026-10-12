/** Tiny bar chart of recent fantasy scores. `values` are newest first; bars are drawn oldest to newest. */
export default function Sparkline({ values, max = 160 }: { values: number[]; max?: number }) {
  const bars = [...values].reverse();
  const w = 6, gap = 3, h = 34;
  return (
    <svg width={bars.length * (w + gap)} height={h} viewBox={`0 0 ${bars.length * (w + gap)} ${h}`} role="img" aria-label={`Last ${bars.length} scores: ${values.join(', ')}`}>
      {bars.map((v, i) => {
        const bh = Math.max(2, Math.min(h, (v / max) * h));
        const fill = v >= 90 ? 'var(--good)' : v >= 40 ? 'var(--blue)' : 'var(--mute)';
        return <rect key={i} x={i * (w + gap)} y={h - bh} width={w} height={bh} rx={2} fill={fill} opacity={i === bars.length - 1 ? 1 : 0.8} />;
      })}
    </svg>
  );
}
