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
  /* Past Sets panel */
  .ps-empty { margin: auto; text-align: center; font-family: var(--mono); font-size: 13px; color: var(--dim-2); padding: 30px; }
  .ps-set { border: 1px solid var(--line); border-radius: 11px; background: var(--surface-2); overflow: hidden; }
  .ps-set-head { width: 100%; display: flex; align-items: center; gap: 10px; padding: 10px 13px; background: transparent; border: 0; color: var(--text); cursor: pointer; font-family: var(--disp); }
  .ps-set-head:hover { background: var(--surface-3); }
  .ps-caret { color: var(--dim); font-size: 11px; transition: transform .15s; }
  .ps-caret.open { transform: rotate(90deg); color: var(--cyan); }
  .ps-set-title { font-weight: 600; font-size: 13px; }
  .ps-set-count { margin-left: auto; font-family: var(--mono); font-size: 10px; color: var(--dim); text-transform: uppercase; }
  .ps-tracks { display: flex; flex-direction: column; gap: 4px; padding: 4px 8px 8px; }
  .ps-track { display: flex; align-items: center; gap: 10px; padding: 7px 8px; border-radius: 8px; background: rgba(255,255,255,0.02); }
  .ps-track.is-playing { background: color-mix(in srgb, var(--cyan) 12%, var(--surface-2)); }
  .ps-play { flex: none; width: 30px; height: 30px; border-radius: 50%; border: 1px solid var(--line-2); background: var(--surface-3); color: var(--cyan); font-size: 10px; cursor: pointer; display: grid; place-items: center; }
  .ps-play:hover { border-color: var(--cyan); }
  .ps-copy { min-width: 0; flex: 1; }
  .ps-title { font-family: var(--disp); font-weight: 600; font-size: 12.5px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .ps-meta { margin-top: 2px; font-family: var(--mono); font-size: 9px; letter-spacing: 0.04em; color: var(--dim); text-transform: uppercase; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .ps-dl { flex: none; height: 28px; padding: 0 10px; border-radius: 7px; border: 1px solid var(--line-2); background: var(--surface-3); color: var(--text); font-family: var(--disp); font-weight: 600; font-size: 9.5px; letter-spacing: 0.06em; text-transform: uppercase; cursor: pointer; }
  .ps-dl:hover { border-color: rgba(0,229,255,0.5); }
  .ps-foot { font-family: var(--mono); font-size: 11px; letter-spacing: 0.1em; color: var(--dim); text-transform: uppercase; }
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

  /* ---- tighter density so panels fit without scrolling (setlist may still scroll) ---- */
  .dash-head { height: 54px; }
  .panels { gap: 16px; padding: 14px 22px 18px; }
  .panel-head { padding: 11px 18px 8px; }
  .panel-title { font-size: 16px; margin-top: 2px; }
  .panel-sub { font-size: 9.5px; margin-top: 3px; }
  .panel-body { padding: 12px 16px; gap: 8px; }
  .panel-foot { padding: 9px 16px 11px; }
  .push-btn { min-height: 40px; font-size: 12px; }
  /* vibe cards */
  .vc-row { gap: 0; grid-template-columns: 1fr; }
  .vc-field { gap: 4px; }
  .vc-label { font-size: 9px; }
  .vc-input { height: 36px; font-size: 13px; border-radius: 8px; }
  .vc-chip { min-height: 36px; }
  .vc-chip .vc-word { font-size: 12px; }
  /* tug genres — shrink so all 8 fit without scrolling */
  .tg-matchup { margin-bottom: 7px; }
  .tg-matchup .mu-a, .tg-matchup .mu-b { font-size: 15px; }
  .tg-matchup .mu-vs { font-size: 11px; }
  .tg-col-head { font-size: 9px; padding-bottom: 5px; }
  .tg-cols { gap: 10px; }
  .tg-list { gap: 3px; overflow: visible; padding-right: 0; }
  .tg-opt { padding: 4px 9px; font-size: 11.5px; gap: 6px; border-radius: 7px; }
  .tg-opt .tg-emoji { font-size: 13px; }
  /* single-grid genre picker (replaces the two duplicate columns) */
  .tg-hint { font-family: var(--mono); font-size: 9.5px; letter-spacing: 0.05em; color: var(--dim); margin-bottom: 9px; }
  .tg-hint .hint-a { color: var(--cyan); }
  .tg-hint .hint-b { color: var(--magenta); }
  .tg-pick { display: grid; grid-template-columns: 1fr 1fr; gap: 7px; }
  .tg-chip { display: flex; align-items: center; gap: 8px; padding: 8px 11px; border-radius: 9px;
    background: var(--surface-2); border: 1.5px solid var(--line); color: var(--text);
    font-family: var(--disp); font-weight: 600; font-size: 13px; text-align: left; min-width: 0;
    transition: border-color .12s, background .12s, color .12s; }
  .tg-chip .tg-emoji { font-size: 15px; flex: none; }
  .tg-chip-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .tg-chip:hover { background: var(--surface-3); }
  .tg-chip.sel-a { border-color: var(--cyan); color: var(--cyan); background: color-mix(in srgb, var(--cyan) 13%, var(--surface-2)); }
  .tg-chip.sel-b { border-color: var(--magenta); color: var(--magenta); background: color-mix(in srgb, var(--magenta) 13%, var(--surface-2)); }
  .tg-badge { margin-left: auto; flex: none; font-family: var(--mono); font-weight: 700; font-size: 9px;
    padding: 1px 6px; border-radius: 999px; background: currentColor; }
  .tg-chip.sel-a .tg-badge { color: #061018; }
  .tg-chip.sel-b .tg-badge { color: #0A0A0F; }
  .tg-chip.off { opacity: 0.4; }
  .tg-chip.off .tg-chip-name { text-decoration: line-through; }
  .tg-chip.off.sel-a, .tg-chip.off.sel-b { border-color: var(--line); color: var(--dim); background: var(--surface-2); }
  .tg-toggle { margin-left: auto; flex: none; width: 22px; height: 22px; border-radius: 6px; border: 1px solid var(--line); background: transparent; color: var(--dim-2); font-size: 12px; cursor: pointer; display: grid; place-items: center; }
  .tg-toggle.on { color: #2DD36F; border-color: rgba(45,211,111,0.4); }
  .tg-toggle:hover { border-color: var(--line-2); }
  /* opener field */
  .opener-field { margin-bottom: 7px; gap: 4px; }
  .opener-label { font-size: 8.5px; }
  .opener-input { height: 34px; font-size: 12px; }
  /* ---- blended, subtle scrollbars ---- */
  #dashRoot ::-webkit-scrollbar { width: 6px; height: 6px; }
  #dashRoot ::-webkit-scrollbar-track { background: transparent; }
  #dashRoot ::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.07); border-radius: 999px; }
  #dashRoot ::-webkit-scrollbar-thumb:hover { background: rgba(255,255,255,0.16); }
  #dashRoot * { scrollbar-width: thin; scrollbar-color: rgba(255,255,255,0.12) transparent; }
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

  // Only THIS set's songs (cleared on reset/start), not the whole cross-set archive.
  const refresh = () => fetch('/api/session-songs')
    .then((r) => (r.ok ? r.json() : { songs: [] }))
    .then((d) => setSongs(Array.isArray(d.songs) ? d.songs : []))
    .catch(() => {});

  useEffect(() => {
    refresh();
    const N = window.Net;
    if (!N || !N.on) return;
    const offSaved = N.on('song_saved', refresh);
    const offDeleted = N.on('song_deleted', refresh);
    // A new set (reset) or a fresh start empties the backend's set list — re-pull
    // so the dashboard Session Setlist clears too.
    const offReset = N.on('show_reset', refresh);
    const offShow = N.on('show_state', (m) => { if (m && m.round <= 1) refresh(); });
    const offPlay = N.on('playback_state', (m) => setCurrentId(m && m.song ? m.song.id : null));
    return () => { offSaved && offSaved(); offDeleted && offDeleted(); offReset && offReset(); offShow && offShow(); offPlay && offPlay(); };
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

/* ===== PANEL 01 — PAST SETS =====
   Browse previously generated sets (the archive clustered into "sets" by gaps in
   creation time) and preview/play or download any track. */
function PastSets() {
  const [songs, setSongs] = useState([]);
  const [open, setOpen] = useState({});      // setKey -> expanded
  const [playId, setPlayId] = useState(null); // currently previewing track id
  const audioRef = useRef(null);

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
    return () => { offSaved && offSaved(); offDeleted && offDeleted(); };
  }, []);

  // cluster the archive into "sets" by >25-min gaps in creation time
  const sets = useMemo(() => {
    const sorted = [...songs].sort((a, b) => a.createdAt.localeCompare(b.createdAt)); // oldest first
    const GAP = 25 * 60 * 1000;
    const out = [];
    let cur = null;
    for (const s of sorted) {
      const t = Date.parse(s.createdAt);
      if (!cur || t - cur.last > GAP) { cur = { startedAt: s.createdAt, last: t, tracks: [] }; out.push(cur); }
      cur.tracks.push(s); cur.last = t;
    }
    return out.reverse(); // newest set first
  }, [songs]);

  useEffect(() => { if (sets.length) setOpen((o) => (o.__init ? o : { __init: true, [sets[0].startedAt]: true })); }, [sets.length]);

  const fmtSet = (iso) => {
    const d = new Date(iso);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) + ' · ' + d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  };
  const togglePlay = (track) => {
    const a = audioRef.current;
    if (!a) return;
    if (playId === track.id) { a.pause(); setPlayId(null); return; }
    a.src = track.downloadUrl;
    a.play().then(() => setPlayId(track.id)).catch(() => setPlayId(null));
  };
  const download = (s) => {
    const a = document.createElement('a');
    a.href = s.downloadUrl; a.download = s.fileName || '';
    document.body.appendChild(a); a.click(); a.remove();
  };

  return (
    <div className="panel">
      <div className="panel-head">
        <div className="panel-num">PANEL 01</div>
        <div className="panel-title">Past Sets</div>
        <div className="panel-sub">Browse previous sets — preview, play, or download any track</div>
      </div>
      <div className="panel-body">
        <audio ref={audioRef} onEnded={() => setPlayId(null)} onPause={() => setPlayId(null)} />
        {sets.length === 0
          ? <div className="ps-empty">No sets yet — generated tracks gather here.</div>
          : sets.map((set, si) => {
            const isOpen = !!open[set.startedAt];
            return (
              <div className="ps-set" key={set.startedAt}>
                <button className="ps-set-head" onClick={() => setOpen((o) => ({ ...o, [set.startedAt]: !o[set.startedAt] }))}>
                  <span className={'ps-caret' + (isOpen ? ' open' : '')}>▸</span>
                  <span className="ps-set-title">{si === 0 ? 'Latest set' : 'Set'} · {fmtSet(set.startedAt)}</span>
                  <span className="ps-set-count">{set.tracks.length} track{set.tracks.length === 1 ? '' : 's'}</span>
                </button>
                {isOpen && (
                  <div className="ps-tracks">
                    {[...set.tracks].reverse().map((t) => (
                      <div className={'ps-track' + (playId === t.id ? ' is-playing' : '')} key={t.id}>
                        <button className="ps-play" onClick={() => togglePlay(t)} aria-label={playId === t.id ? 'Pause' : 'Play'}>
                          {playId === t.id ? '❚❚' : '▶'}
                        </button>
                        <div className="ps-copy">
                          <div className="ps-title">{t.title}</div>
                          <div className="ps-meta">{t.genre} · {t.bpm} BPM · for {t.name}</div>
                        </div>
                        <button className="ps-dl" onClick={() => download(t)}>Download</button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
      </div>
      <div className="panel-foot">
        <div className="ps-foot">{songs.length} track{songs.length === 1 ? '' : 's'} · {sets.length} set{sets.length === 1 ? '' : 's'} archived</div>
      </div>
    </div>
  );
}

function App() {
  // Pre-filled with the phone's default Pick-the-Vibe options so the dashboard and
  // crowd screen are visibly in sync from the start (edit + push to change them).
  const [cards, setCards] = useState(['DANCE', 'DRINK', 'FLIRT', 'MAKE MEMORIES']);
  const [opener, setOpener] = useState(''); // optional first-song (opener) brief
  const [sideA, setSideA] = useState('soca');
  const [sideB, setSideB] = useState('afrobeats');
  const [disabledGenres, setDisabledGenres] = useState({}); // id -> true = toggled OFF (unavailable)
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
  // Single-grid picker: tap a chip to fill Side A (cyan) then Side B (magenta);
  // tapping a selected chip clears that slot; both full → replace Side B.
  const pickGenre = (id) => {
    if (disabledGenres[id]) return; // toggled-off genres aren't selectable
    if (sideA === id) setSideA('');
    else if (sideB === id) setSideB('');
    else if (!sideA) setSideA(id);
    else if (!sideB) setSideB(id);
    else setSideB(id);
  };
  // toggle a genre on/off (off = unavailable in the picker). Deselect it if it was a side.
  const toggleGenre = (id) => {
    const turningOff = !disabledGenres[id];
    setDisabledGenres((d) => ({ ...d, [id]: turningOff }));
    if (turningOff) {
      if (sideA === id) setSideA('');
      if (sideB === id) setSideB('');
    }
  };
  const startRound = () => {
    if (!sideA || !sideB) { showToast('Pick two genres first', 'magenta'); return; }
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
          {/* ===== PANEL 1 — PAST SETS (vibe-cards code retained above, unused) ===== */}
          <PastSets />

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
                <span className="mu-a">{gA ? gA.emoji + ' ' + gA.name.toUpperCase() : 'PICK SIDE A'}</span>
                <span className="mu-vs">VS</span>
                <span className="mu-b">{gB ? gB.emoji + ' ' + gB.name.toUpperCase() : 'PICK SIDE B'}</span>
              </div>
              <div className="tg-hint">Tap to pick (<b className="hint-a">A</b> then <b className="hint-b">B</b>) · ⏻ toggles a genre off</div>
              <div className="tg-pick">
                {GENRES.map((g) => {
                  const sel = sideA === g.id ? 'a' : sideB === g.id ? 'b' : '';
                  const off = !!disabledGenres[g.id];
                  return (
                    <div key={g.id} className={'tg-chip' + (sel ? ' sel-' + sel : '') + (off ? ' off' : '')}
                      role="button" onClick={() => pickGenre(g.id)}>
                      <span className="tg-emoji">{g.emoji}</span><span className="tg-chip-name">{g.name}</span>
                      {sel && <span className="tg-badge">{sel.toUpperCase()}</span>}
                      <button className={'tg-toggle' + (off ? '' : ' on')}
                        onClick={(e) => { e.stopPropagation(); toggleGenre(g.id); }}
                        title={off ? 'Enable genre' : 'Disable genre'} aria-label="toggle genre">⏻</button>
                    </div>
                  );
                })}
              </div>
            </div>
            <div className="panel-foot">
              <div className="opener-field">
                <span className="opener-label">First song · opener brief <i>(optional — plays in {gA ? gA.name : 'Side A genre'})</i></span>
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
