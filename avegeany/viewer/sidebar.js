// Left floating sidebar: Catalog | Split tabs, collapsible to a thin rail.
// The open state and active tab are remembered per browser (localStorage).

const KEY = 'avegeany.sidebar';

function load() {
  try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; }
}
function save(state) {
  try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* private mode etc. */ }
}

// `force`: state that wins over the remembered one for this page load (e.g. {open: false}
// from the `sidebar=0` embed option); it is only saved once the user changes something.
export function initSidebar(editor, force = {}) {
  const $ = editor.$;
  const bar = $('leftbar'), view = $('view');
  const state = { open: true, tab: 'catalog', ...load(), ...force };
  const listeners = [];

  function render() {
    bar.classList.toggle('collapsed', !state.open);
    view.classList.toggle('lb-open', state.open);
    view.classList.toggle('lb-closed', !state.open);
    $('lbToggle').textContent = state.open ? '‹' : '›';
    for (const t of bar.querySelectorAll('.tab')) t.classList.toggle('on', t.dataset.tab === state.tab);
    for (const p of bar.querySelectorAll('.pane')) p.hidden = p.id !== `pane-${state.tab}`;
    dispatchEvent(new Event('resize'));          // the 3D view re-centres around the open / closed sidebar
  }
  function open(tab) {
    const changed = tab && tab !== state.tab;
    if (tab) state.tab = tab;
    state.open = true;
    save(state); render();
    if (changed) listeners.forEach(fn => fn(state.tab));
  }
  function toggle() { state.open = !state.open; save(state); render(); }

  for (const t of bar.querySelectorAll('.tab')) {
    t.onclick = () => (state.open && state.tab === t.dataset.tab ? toggle() : open(t.dataset.tab));
  }
  $('lbToggle').onclick = toggle;
  // keep the sidebar's own clicks / drags from reaching the 3D view behind it
  for (const ev of ['pointerdown', 'wheel', 'click']) bar.addEventListener(ev, e => e.stopPropagation());
  render();

  return {
    open, toggle,
    get tab() { return state.tab; },
    get isOpen() { return state.open; },
    onTab(fn) { listeners.push(fn); },
    ready() { listeners.forEach(fn => fn(state.tab)); },
  };
}
