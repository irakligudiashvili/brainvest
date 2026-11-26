export default function Rating({ value, count }) {
  const pct = Math.max(0, Math.min(100, (value / 5) * 100));
  return (
    <span className="rating" title={`${value.toFixed(1)} out of 5`}>
      <span className="rating__stars" style={{ '--pct': `${pct}%` }} aria-hidden="true">★★★★★</span>
      <span className="rating__value">{value.toFixed(1)}</span>
      {count != null && <span className="muted">({count})</span>}
    </span>
  );
}
