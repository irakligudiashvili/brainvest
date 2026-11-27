import { useEffect, useRef, useState } from 'react';
import { VIEW3D, view3dUrl } from '../view3d';
import { CloseIcon, CubeIcon } from './Icons';

// "View in 3D" button + full-screen dialog with the avegeany room editor in an iframe.
// The editor reports back with postMessage (avegeany:ready / placed / error).
export default function ViewIn3D({ product, className = '' }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className={`btn btn--lg btn--3d ${className}`} onClick={() => setOpen(true)}>
        <CubeIcon size={22} /> View in 3D
        <span className="btn--3d__sub">see it in a room</span>
      </button>
      {open && <Viewer product={product} onClose={() => setOpen(false)} />}
    </>
  );
}

function Viewer({ product, onClose }) {
  const frame = useRef(null);
  const [status, setStatus] = useState({ state: 'loading' });

  useEffect(() => {
    const onMessage = (e) => {
      if (e.origin !== window.location.origin || e.source !== frame.current?.contentWindow) return;
      const { type, ...data } = e.data || {};
      if (type === 'avegeany:placed') setStatus({ state: 'placed', ...data });
      else if (type === 'avegeany:error') setStatus({ state: 'error', message: data.message });
      else if (type === 'avegeany:ready') setStatus((s) => (s.state === 'loading' ? { state: 'ready' } : s));
    };
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('message', onMessage);
    window.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('message', onMessage);
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [onClose]);

  const missingModel = status.state === 'error' && /no model at/.test(status.message || '');

  return (
    <div className="v3d-backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="v3d" role="dialog" aria-modal="true" aria-label={`${product.title} in 3D`}>
        <div className="v3d__head">
          <CubeIcon size={22} />
          <div className="v3d__title">
            <strong>{product.title}</strong>
            <span className="muted small">
              {status.state === 'placed' && status.size
                ? `${status.size.map((v) => v.toFixed(2)).join(' × ')} m · drag it or the arrows to move, the green ring (or Q / E) to turn · drag the room to look around, scroll to zoom`
                : 'Loading the room…'}
            </span>
          </div>
          <button type="button" className="v3d__close" onClick={onClose} aria-label="Close 3D view">
            <CloseIcon />
          </button>
        </div>
        <div className="v3d__frame">
          <iframe ref={frame} src={view3dUrl(product)} title={`${product.title} in a room (3D)`} allow="fullscreen" />
          {status.state === 'loading' && <div className="v3d__status">Loading the room…</div>}
          {status.state === 'error' && (
            <div className="v3d__status v3d__status--error">
              <div>
                <strong>{missingModel ? 'No 3D model yet' : 'The 3D view could not load'}</strong>
                {missingModel ? (
                  <p>
                    Put the prepared model at <code>public{VIEW3D.model.url.replace(import.meta.env.BASE_URL, '/')}</code> and
                    open this again. See <code>public/models/README.md</code>.
                  </p>
                ) : (
                  <p>{status.message}</p>
                )}
                <button type="button" className="btn" onClick={() => setStatus({ state: 'dismissed' })}>
                  Show the room anyway
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
