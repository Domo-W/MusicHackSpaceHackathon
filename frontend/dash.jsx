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

/* the single isolated mock sink (swap for a real backend later) */
function pushToCrowd(channel, payload) {
  // e.g. POST /api/show/{channel}  — for now just log + broadcast if available
  try { console.log('[pushToCrowd]', channel, payload); } catch (e) {}
  try { new BroadcastChannel('dj-console').postMessage({ channel, payload, ts: Date.now() }); } catch (e) {}
}

/* Fluid layout + Session Setlist styles. Injected from JSX so the dashboard
   fills the whole screen (no fixed 1440×900 letterbox) without editing dash.css. */
const DASH_CSS = `
  /* fill the viewport instead of centering a fixed-size board */
  #viewport { display: block !important; }
  #dashRoot {
    width: 100% !important; height: calc(100vh - 98px) !important;
    transform: none !important; border-radius: 0 !important;
  }
  /* Session Setlist (Panel 02) */
  .sl-row { display: flex; align-items: center; gap: 12px; padding: 11px 14px; border-radius: 12px;
    background: var(--surface-2); border: 1px solid var(--line); }
  .sl-row.is-now { border-color: rgba(45,211,111,0.55); background: rgba(45,211,111,0.08); }
  .sl-num { width: 26px; flex: none; text-align: center; font-family: var(--mono); font-weight: 700; font-size: 14px; color: var(--dim); }
  .sl-row.is-now .sl-num { color: #2DD36F; }
  .sl-copy { min-width: 0; flex: 1; }
  .sl-title { font-family: var(--disp); font-weight: 600; font-size: 15px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .sl-meta { margin-top: 3px; font-family: var(--mono); font-size: 11px; letter-spacing: 0.04em; color: var(--dim);
    text-transform: uppercase; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .sl-row.is-now .sl-meta { color: #2DD36F; }
  .sl-btn { flex: none; height: 34px; padding: 0 13px; border-radius: 9px; border: 1px solid var(--line-2);
    background: var(--surface-3); color: var(--text); font-family: var(--disp); font-weight: 600; font-size: 11px;
    letter-spacing: 0.06em; text-transform: uppercase; cursor: pointer; transition: border-color .15s, background .15s; }
  .sl-btn:hover { border-color: rgba(0,229,255,0.5); background: #20202C; }
  .sl-del { width: 38px; padding: 0; color: var(--dim); }
  .sl-del:hover { border-color: rgba(255,77,109,0.6); color: #FF4D6D; background: rgba(255,77,109,0.08); }
  .sl-del.is-confirm { width: auto; padding: 0 12px; background: #FF4D6D; border-color: #FF4D6D; color: #0A0A0F; }
  .sl-empty { margin: auto; text-align: center; font-family: var(--mono); font-size: 13px; color: var(--dim-2); padding: 30px; }
  .sl-foot { font-family: var(--mono); font-size: 11px; letter-spacing: 0.1em; color: var(--dim); text-transform: uppercase; }
  /* opener brief field in Panel 03 */
  .opener-field { display: flex; flex-direction: column; gap: 7px; margin-bottom: 12px; }
  .opener-label { font-family: var(--mono); font-size: 10px; letter-spacing: 0.1em; color: var(--dim); text-transform: uppercase; }
  .opener-label i { color: var(--dim-2); font-style: normal; text-transform: none; letter-spacing: 0.04em; }
  .opener-input { height: 42px; padding: 0 14px; background: var(--surface-2); border: 1px solid var(--line-2);
    border-radius: 10px; color: var(--text); font-family: var(--disp); font-size: 14px; outline: none; }
  .opener-input:focus { border-color: var(--magenta); }
  .opener-input::placeholder { color: var(--dim-2); }
  /* live Pick-the-Vibe tally under each card */
  .vc-votes { color: var(--cyan); font-weight: 700; letter-spacing: 0.02em; }
  .vc-bar { display: block; margin-top: 7px; height: 5px; border-radius: 3px; background: rgba(255,255,255,0.08); overflow: hidden; }
  .vc-bar i { display: block; height: 100%; border-radius: 3px; transition: width .4s ease; }
`;

/* ===== PANEL 02 — SESSION SETLIST =====
   The live archive of generated songs (GET /api/songs), updated as the crowd
   makes them (song_saved / song_deleted) with the looping track marked from
   playback_state. Per-track Download + a two-step Delete so the DJ can prune. */
function Setlist() {
  const [songs, setSongs] = useState([]);
  const [currentId, setCurrentId] = useState(null);
  const [confirmId, setConfirmId] = useState(null);
  const confirmTimer = useRef(null);

  const refresh = () => fetch('/api/songs')
    .then((r) => (r.ok ? r.json() : { songs: [] }))
    .then((d) => setSongs(Array.isArray(d.songs) ? d.songs : []))
    .catch(() => {});

  useEffect(() => {
    refresh();
    const N = window.Net;
    if (!N || !N.on) return;
    const offSaved = N.on('song_saved', refresh);
    const offDeleted = N.on('song_deleted', refresh);
    const offPlay = N.on('playback_state', (m) => setCurrentId(m && m.song ? m.song.id : null));
    return () => { offSaved && offSaved(); offDeleted && offDeleted(); offPlay && offPlay(); };
  }, []);

  const download = (s) => {
    const a = document.createElement('a');
    a.href = s.downloadUrl; a.download = s.fileName || '';
    document.body.appendChild(a); a.click(); a.remove();
  };
  const del = (s) => {
    if (confirmId !== s.id) { // first click arms, second within 3s confirms
      setConfirmId(s.id);
      if (confirmTimer.current) clearTimeout(confirmTimer.current);
      confirmTimer.current = setTimeout(() => setConfirmId(null), 3000);
      return;
    }
    if (confirmTimer.current) clearTimeout(confirmTimer.current);
    setConfirmId(null);
    fetch('/api/songs/' + encodeURIComponent(s.id), { method: 'DELETE' }).then(refresh).catch(() => {});
  };

  return (
    <div className="panel">
      <div className="panel-head">
        <div className="panel-num">PANEL 02</div>
        <div className="panel-title">Session Setlist</div>
        <div className="panel-sub">Every track the crowd generated — download or remove before the set ends</div>
      </div>
      <div className="panel-body">
        {songs.length === 0
          ? <div className="sl-empty">No songs yet — they appear here as the crowd generates them.</div>
          : songs.map((s, i) => {
            const now = s.id === currentId;
            return (
              <div className={'sl-row' + (now ? ' is-now' : '')} key={s.id}>
                <div className="sl-num">{now ? '▶' : String(i + 1).padStart(2, '0')}</div>
                <div className="sl-copy">
                  <div className="sl-title">{s.title}</div>
                  <div className="sl-meta">{(now ? 'Now playing · ' : '') + s.genre + ' · ' + s.bpm + ' BPM · for ' + s.name}</div>
                </div>
                <button className="sl-btn" onClick={() => download(s)}>Download</button>
                <button className={'sl-btn sl-del' + (confirmId === s.id ? ' is-confirm' : '')}
                  onClick={() => del(s)} aria-label={'delete ' + s.title}>
                  {confirmId === s.id ? 'Delete?' : '✕'}
                </button>
              </div>
            );
          })}
      </div>
      <div className="panel-foot">
        <div className="sl-foot">{songs.length} track{songs.length === 1 ? '' : 's'} this session · saved locally</div>
      </div>
    </div>
  );
}

function App() {
  const [cards, setCards] = useState(['', '', '', '']);
  const [opener, setOpener] = useState(''); // optional first-song (opener) brief
  const [sideA, setSideA] = useState('soca');
  const [sideB, setSideB] = useState('afrobeats');
  const [toast, setToast] = useState({ msg: '', color: '', show: false });
  const [clock, setClock] = useState('');
  const toastTimer = useRef(null);

  // mirror all editable state to one isolated place
  useEffect(() => {
    window.DJConsoleState = { cards, sideA, sideB };
  }, [cards, sideA, sideB]);

  // live clock
  useEffect(() => {
    const tick = () => setClock(new Date().toLocaleTimeString('en-GB'));
    tick(); const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);

  // live Pick-the-Vibe tally (real picks from phones, per card index)
  const [vibeTally, setVibeTally] = useState({ counts: [], total: 0 });
  useEffect(() => {
    const N = window.Net;
    if (!N || !N.on) return;
    return N.on('vibe_tally', (m) => setVibeTally({ counts: (m && m.counts) || [], total: (m && m.total) || 0 }));
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

  // ---- Panel 3 actions ----
  const pickA = (id) => { if (id !== sideB) setSideA(id); };
  const pickB = (id) => { if (id !== sideA) setSideB(id); };
  const startRound = () => {
    pushToCrowd('tug-genres', { sideA, sideB, opener: opener.trim() });
    showToast(opener.trim() ? 'Opener + genres sent ✓' : 'Genres sent ✓', 'magenta');
  };
  const gA = genreById(sideA), gB = genreById(sideB);

  return (
    <div id="viewport">
      <style>{DASH_CSS}</style>
      <div id="dashRoot">
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
              {cards.map((val, i) => {
                const n = (vibeTally.counts && vibeTally.counts[i]) || 0;
                const pct = vibeTally.total ? Math.round((n / vibeTally.total) * 100) : 0;
                const live = vibeTally.total > 0;
                return (
                  <div className="vc-row" key={i} style={{ '--vcolor': VIBE_COLORS[i] }}>
                    <div className="vc-field">
                      <span className="vc-label">
                        Card {i + 1}
                        {live && <span className="vc-votes"> · {n} {n === 1 ? 'vote' : 'votes'} ({pct}%)</span>}
                      </span>
                      <input
                        className="vc-input"
                        value={val}
                        maxLength={14}
                        onChange={(e) => setCard(i, e.target.value)}
                        placeholder="type a vibe…"
                      />
                      {live && <span className="vc-bar"><i style={{ width: pct + '%', background: VIBE_COLORS[i] }} /></span>}
                    </div>
                    <div className={'vc-chip' + (val.trim() ? '' : ' empty')}>
                      {val.trim()
                        ? (<React.Fragment><span className="vc-word">{val.trim()}</span><span className="vc-tiny">{live ? pct + '%' : 'PREVIEW'}</span></React.Fragment>)
                        : (<span className="vc-word">EMPTY</span>)}
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="panel-foot">
              <button className="push-btn" onClick={pushCards} disabled={filledCards === 0}
                style={{ '--accent': '#00E5FF' }}>
                Save / Push to crowd{filledCards ? ` · ${filledCards}/4` : ''}
              </button>
            </div>
          </div>

          {/* ===== PANEL 2 — SESSION SETLIST ===== */}
          <Setlist />

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
              <div className="opener-field">
                <span className="opener-label">First song · opener brief <i>(optional — plays in {gA.name})</i></span>
                <input
                  className="opener-input"
                  value={opener}
                  maxLength={120}
                  onChange={(e) => setOpener(e.target.value)}
                  placeholder="e.g. welcome to the show, lights down, here we go"
                />
              </div>
              <button id="genreRoundButton" className="push-btn" onClick={startRound} style={{ '--accent': '#FF1A8C' }}>
                {opener.trim() ? 'Generate opener & start' : 'Start show with selected genres'}
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
