/* ============================================================
   dash.jsx — DJ CONTROL DASHBOARD
   All editable state lives in ONE isolated object (dash) and is
   mirrored to window.DJConsoleState so it can later be sent to a
   real backend. "Push to crowd" calls the mock pushToCrowd().
   ============================================================ */
const { useState, useEffect, useRef, useMemo } = React;

const VIBE_COLORS = ['#00E5FF', '#FF7A1A', '#FF1A8C', '#B65CFF'];

const GENRES = [
  { id: 'soca', emoji: '🥁', name: 'Soca' },
  { id: 'reggae', emoji: '🌴', name: 'Reggae' },
  { id: 'dancehall', emoji: '🔥', name: 'Dancehall' },
  { id: 'afrobeats', emoji: '🎧', name: 'Afrobeats' },
  { id: 'pop', emoji: '✨', name: 'Pop' },
  { id: 'country', emoji: '🤠', name: 'Country' },
  { id: 'poprock', emoji: '🎸', name: 'Pop Rock' },
  { id: 'tropicalhouse', emoji: '🏝️', name: 'Tropical House' },
];
const genreById = (id) => GENRES.find((g) => g.id === id);

let _nid = 0;
const mkName = (t) => ({ id: ++_nid, text: t });
const SEED_NAMES = ['neon', 'DJ_MAX', 'rain', 'spacecadet', 'heavy', 'luna', 'BASSLINE',
  'mia', 'void', 'strobe', 'ravi', 'glow', 'smoke', 'zara', 'afterdark', 'kojib2b'].map(mkName);

/* the single isolated mock sink (swap for a real backend later) */
function pushToCrowd(channel, payload) {
  // e.g. POST /api/show/{channel}  — for now just log + broadcast if available
  try { console.log('[pushToCrowd]', channel, payload); } catch (e) {}
  try { new BroadcastChannel('dj-console').postMessage({ channel, payload, ts: Date.now() }); } catch (e) {}
}

function App() {
  const [cards, setCards] = useState(['', '', '', '']);
  const [names, setNames] = useState(SEED_NAMES);
  const [removing, setRemoving] = useState({});
  const [query, setQuery] = useState('');
  const [sideA, setSideA] = useState('soca');
  const [sideB, setSideB] = useState('afrobeats');
  const [toast, setToast] = useState({ msg: '', color: '', show: false });
  const [scale, setScale] = useState(1);
  const [clock, setClock] = useState('');
  const toastTimer = useRef(null);

  // mirror all editable state to one isolated place
  useEffect(() => {
    window.DJConsoleState = { cards, names: names.map((n) => n.text), sideA, sideB };
  }, [cards, names, sideA, sideB]);

  // scale to fit
  useEffect(() => {
    const fit = () => setScale(Math.min(window.innerWidth / 1440, window.innerHeight / 900));
    fit(); window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
  }, []);

  // live clock
  useEffect(() => {
    const tick = () => setClock(new Date().toLocaleTimeString('en-GB'));
    tick(); const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);

  const showToast = (msg, color) => {
    setToast({ msg, color: color || '', show: true });
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast((t) => ({ ...t, show: false })), 1900);
  };

  // ---- Panel 1 actions ----
  const setCard = (i, v) => setCards((c) => c.map((x, k) => (k === i ? v : x)));
  const pushCards = () => {
    pushToCrowd('vibe-cards', cards.map((c) => c.trim()));
    showToast('Vibe cards pushed ✓', '');
  };
  const filledCards = cards.filter((c) => c.trim()).length;

  // ---- Panel 2 actions ----
  const removeName = (id) => {
    setRemoving((r) => ({ ...r, [id]: true }));
    setTimeout(() => {
      setNames((ns) => ns.filter((n) => n.id !== id));
      setRemoving((r) => { const c = { ...r }; delete c[id]; return c; });
    }, 190);
  };
  const clearAll = () => { setNames([]); setRemoving({}); showToast('Cleared all names', 'magenta'); };
  const filtered = useMemo(
    () => names.filter((n) => n.text.toLowerCase().includes(query.trim().toLowerCase())),
    [names, query]
  );

  // ---- Panel 3 actions ----
  const pickA = (id) => { if (id !== sideB) setSideA(id); };
  const pickB = (id) => { if (id !== sideA) setSideB(id); };
  const startRound = () => {
    pushToCrowd('tug-genres', { sideA, sideB });
    showToast('Round started ✓', 'magenta');
  };
  const gA = genreById(sideA), gB = genreById(sideB);

  return (
    <div id="viewport">
      <div id="dashRoot" style={{ transform: `scale(${scale})` }}>
        {/* header */}
        <div className="dash-head">
          <div className="dh-left">
            <span className="dh-title">THE SHOW</span>
            <span className="dh-sub">DJ Console</span>
          </div>
          <div className="dh-right">
            <span className="dh-clock">{clock}</span>
            <span className="dh-live"><i className="dh-dot" />LIVE</span>
          </div>
        </div>

        <div className="panels">
          {/* ===== PANEL 1 — VIBE CARDS ===== */}
          <div className="panel">
            <div className="panel-head">
              <div className="panel-num">PANEL 01</div>
              <div className="panel-title">Vibe Cards</div>
              <div className="panel-sub">Suggestions on the crowd's “Pick the Vibe” screen</div>
            </div>
            <div className="panel-body">
              {cards.map((val, i) => (
                <div className="vc-row" key={i} style={{ '--vcolor': VIBE_COLORS[i] }}>
                  <div className="vc-field">
                    <span className="vc-label">Card {i + 1}</span>
                    <input
                      className="vc-input"
                      value={val}
                      maxLength={14}
                      onChange={(e) => setCard(i, e.target.value)}
                      placeholder="type a vibe…"
                    />
                  </div>
                  <div className={'vc-chip' + (val.trim() ? '' : ' empty')}>
                    {val.trim()
                      ? (<React.Fragment><span className="vc-word">{val.trim()}</span><span className="vc-tiny">PREVIEW</span></React.Fragment>)
                      : (<span className="vc-word">EMPTY</span>)}
                  </div>
                </div>
              ))}
            </div>
            <div className="panel-foot">
              <button className="push-btn" onClick={pushCards} disabled={filledCards === 0}
                style={{ '--accent': '#00E5FF' }}>
                Save / Push to crowd{filledCards ? ` · ${filledCards}/4` : ''}
              </button>
            </div>
          </div>

          {/* ===== PANEL 2 — NAME CLOUD ===== */}
          <div className="panel">
            <div className="panel-head">
              <div className="panel-num">PANEL 02</div>
              <div className="panel-title">Name Cloud Moderation</div>
              <div className="panel-sub">Submitted names &amp; words on the crowd wall</div>
            </div>
            <div className="panel-body">
              <div className="nm-tools">
                <input className="nm-search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="filter…" />
                <button className="nm-clear" onClick={clearAll} disabled={!names.length}>Clear all</button>
              </div>
              <div className="nm-count">REMAINING&nbsp; <b>{names.length}</b>{query && ` · ${filtered.length} shown`}</div>
              <div className="nm-grid">
                {filtered.length === 0 && <div className="nm-empty">{names.length ? 'NO MATCHES' : 'CLOUD EMPTY'}</div>}
                {filtered.map((n) => (
                  <span className={'nm-chip' + (removing[n.id] ? ' out' : '')} key={n.id}>
                    {n.text}
                    <button className="nm-x" onClick={() => removeName(n.id)} aria-label={'remove ' + n.text}>
                      <svg width="11" height="11" viewBox="0 0 12 12"><path d="M2 2l8 8M10 2l-8 8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
                    </button>
                  </span>
                ))}
              </div>
            </div>
          </div>

          {/* ===== PANEL 3 — TUG GENRES ===== */}
          <div className="panel">
            <div className="panel-head">
              <div className="panel-num">PANEL 03</div>
              <div className="panel-title">Tug-of-War Genres</div>
              <div className="panel-sub">Pick the two genres that battle</div>
            </div>
            <div className="panel-body">
              <div className="tg-matchup">
                <span className="mu-a">{gA.emoji} {gA.name.toUpperCase()}</span>
                <span className="mu-vs">VS</span>
                <span className="mu-b">{gB.emoji} {gB.name.toUpperCase()}</span>
              </div>
              <div className="tg-cols">
                <div className="tg-col a">
                  <div className="tg-col-head">● Side A</div>
                  <div className="tg-list">
                    {GENRES.map((g) => (
                      <button key={g.id}
                        className={'tg-opt' + (sideA === g.id ? ' sel' : '') + (sideB === g.id ? ' disabled' : '')}
                        onClick={() => pickA(g.id)} disabled={sideB === g.id}>
                        <span className="tg-emoji">{g.emoji}</span>{g.name}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="tg-col b">
                  <div className="tg-col-head">● Side B</div>
                  <div className="tg-list">
                    {GENRES.map((g) => (
                      <button key={g.id}
                        className={'tg-opt' + (sideB === g.id ? ' sel' : '') + (sideA === g.id ? ' disabled' : '')}
                        onClick={() => pickB(g.id)} disabled={sideA === g.id}>
                        <span className="tg-emoji">{g.emoji}</span>{g.name}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>
            <div className="panel-foot">
              <button className="push-btn" onClick={startRound} style={{ '--accent': '#FF1A8C' }}>
                Start round / Push to crowd
              </button>
            </div>
          </div>
        </div>

        <div className={'toast' + (toast.color === 'magenta' ? ' magenta' : '')} data-show={toast.show ? '1' : '0'}>{toast.msg}</div>
      </div>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<App />);
