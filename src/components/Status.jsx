export function Loading({ label = 'Loading…' }) {
  return (
    <div className="status">
      <p className="muted">{label}</p>
    </div>
  );
}

export function ErrorState({ error }) {
  return (
    <div className="status">
      <p>Couldn’t load products.</p>
      <p className="muted small">{error?.message}</p>
      <button type="button" className="btn" onClick={() => window.location.reload()}>Try again</button>
    </div>
  );
}

/** Static grey placeholders shown while products load. */
export function SkeletonGrid({ count = 4 }) {
  return (
    <div className="grid">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="skeleton">
          <div className="skeleton__media" />
          <div className="skeleton__body">
            <div className="skeleton__line" style={{ width: '80%' }} />
            <div className="skeleton__line" style={{ width: '40%' }} />
          </div>
        </div>
      ))}
    </div>
  );
}
