export function Loading({ label = 'Loading…' }) {
  return (
    <div className="status">
      <div className="spinner" />
      <p className="muted">{label}</p>
    </div>
  );
}

export function ErrorState({ error }) {
  return (
    <div className="status">
      <p>Couldn’t load products.</p>
      <p className="muted small">{error?.message}</p>
      <button className="btn" onClick={() => window.location.reload()}>Try again</button>
    </div>
  );
}

export function SkeletonGrid({ count = 8 }) {
  return (
    <div className="grid">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="card skeleton">
          <div className="skeleton__media" />
          <div className="card__body">
            <div className="skeleton__line" style={{ width: '40%' }} />
            <div className="skeleton__line" style={{ width: '80%' }} />
            <div className="skeleton__line" style={{ width: '30%' }} />
          </div>
        </div>
      ))}
    </div>
  );
}
