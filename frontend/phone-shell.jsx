/* ============================================================
   phone-shell.jsx — OUR linear walkthrough shell (replaces the partner's
   swipeable-tab app.jsx on the live page). Reuses the partner's screen
   components verbatim; we only sequence them like a form.

   Flow:
     NEW participant:       NAME -> VIBE -> INTENT -> VOTE -> (loading)
     RETURNING participant: VIBE -> VOTE -> (loading)
   When the collecting round buzzes (backend 'generating'/'round_result'),
   we show a LOADING screen ("your track is being made"). When the next
   collecting round begins, we restart the appropriate sequence.

   Screens advance via: NAME/VIBE -> a "Next" button (they don't self-advance);
   INTENT -> its own onAdvance (after the dissolve); VOTE -> round-driven.
   ============================================================ */
const { useState, useEffect, useRef, useCallback, useLayoutEffect } = React;

const SEQ_NEW = ['name', 'vibe', 'intent', 'vote'];
const SEQ_RETURNING = ['vibe', 'vote'];

/* Map the backend `show_ended` payload (SavedSong[]) to the recap track shape
   ScreenRecap expects: {id,title,genre,by,dur,fileName,downloadUrl}. SavedSong
   carries no duration, so we use a sensible placeholder for the player ticker. */
function mapSavedSongs(songs) {
  if (!Array.isArray(songs)) return [];
  return songs.map((s) => ({
    id: s.id,
    title: (s.title || 'UNTITLED').toUpperCase(),
    genre: (s.genre || '').toUpperCase(),
    by: s.name || '—',
    dur: 200,
    fileName: s.fileName,
    downloadUrl: s.downloadUrl,
  }));
}

function PhoneShell() {
  const crowd = useCrowdState();
  const [joined, setJoined] = useState(!!window.__participantId);
  const [participated, setParticipated] = useState(false); // completed one full pass
  const [step, setStep] = useState(0);
  const [loading, setLoading] = useState(false);
  const [reveal, setReveal] = useState(null); // {name, genre, answer} from round_result
  const [scale, setScale] = useState(1);
  // On a real phone, drop the simulated-iPhone frame and fill the screen; keep the
  // framed preview only on wider (desktop) viewports.
  const [isMobile, setIsMobile] = useState(() => window.matchMedia('(max-width: 600px)').matches);
  const [ended, setEnded] = useState(false);   // show over -> ScreenRecap (merged from design-handoff)
  const [recapTracks, setRecapTracks] = useState([]);

  const seq = participated ? SEQ_RETURNING : SEQ_NEW;
  const screen = seq[Math.min(step, seq.length - 1)];

  // refs for use inside the (once-bound) Net listeners
  const formedRound = useRef(0);
  const loadingRef = useRef(false);
  loadingRef.current = loading;

  // ---- start the networked sims (app.jsx did this on mount) ----
  useEffect(() => {
    try { window.CrowdSim.start && window.CrowdSim.start(); } catch (e) {}
    try { window.Tug.start && window.Tug.start('follower'); } catch (e) {}
  }, []);

  // ---- static CSS vars + per-frame energy color (app.jsx did this via tweaks) ----
  useLayoutEffect(() => {
    const r = document.documentElement.style;
    r.setProperty('--magenta', '#FF1A8C');
    r.setProperty('--cyan', '#00E5FF');
    r.setProperty('--glow', '1');
    r.setProperty('--grain', '0.07');
    r.setProperty('--disp', "'Space Grotesk', system-ui, sans-serif");
  }, []);
  useEffect(() => window.CrowdSim.on('frame', (s) => {
    const r = document.documentElement.style;
    r.setProperty('--energy', (s.energy || 0).toFixed(4));
    r.setProperty('--ecolor', s.color || '#FF1A8C');
  }), []);

  // ---- responsive: scale the framed preview (desktop) + detect real mobile ----
  useEffect(() => {
    const fit = () => {
      setScale(Math.min(window.innerWidth / 402, window.innerHeight / 874, 1));
      setIsMobile(window.matchMedia('(max-width: 600px)').matches);
    };
    fit();
    window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
  }, []);

  // ---- backend-driven transitions ----
  useEffect(() => {
    const offJoined = window.Net.on('joined', () => setJoined(true));
    const toLoading = () => { setLoading(true); setParticipated(true); };
    const offGen = window.Net.on('generating', toLoading);
    const offRR = window.Net.on('round_result', (m) => setReveal(m));
    // SET COMPLETE: the DJ ended the show. Flip to the recap playlist built from
    // the real saved songs in the broadcast payload (falls back to setlist.js).
    const offEnded = window.Net.on('show_ended', (m) => {
      setRecapTracks(mapSavedSongs(m && m.songs));
      setEnded(true);
      setLoading(false);
    });
    // a fresh show (reset) clears the recap so the walkthrough returns.
    const offReset = window.Net.on('show_reset', () => { setEnded(false); setRecapTracks([]); });
    // Authoritative backend flow state — drives loading/reveal/walkthrough.
    const offShow = window.Net.on('show_state', (m) => {
      if (!m) return;
      if (m.phase === 'idle') {
        formedRound.current = 0;
        setLoading(false);
        setReveal(null);
        setStep(0);
        return;
      }
      if (m.phase === 'generating') {
        setLoading(true);
        setParticipated(true);
        if (m.seed) setReveal(m.seed);
        return;
      }
      if (m.phase === 'collecting') {
        const changedRound = m.round !== formedRound.current;
        formedRound.current = m.round;
        // A new collecting round means a new set is live again — leave the recap.
        setEnded(false);
        if (loadingRef.current || changedRound) {
          setLoading(false);
          setReveal(null);
          setStep(0);
        }
      }
    });
    const offTug = window.Net.on('tug', (m) => {
      if (m && m.phase === 'idle') {
        formedRound.current = 0;
        setLoading(false);
        setReveal(null);
      } else if (m && m.phase === 'collecting' && m.round !== formedRound.current) {
        formedRound.current = m.round;
        // A new collecting round means a new set is live again — leave the recap.
        setEnded(false);
        // Only RESET the walkthrough for a brand-new song round (i.e. we were
        // waiting on the loading screen). A pre-start cold-start round must NOT
        // wipe progress the user already made.
        if (loadingRef.current) {
          setLoading(false);
          setReveal(null);
          setStep(0);
        }
      }
    });
    return () => { offJoined(); offGen(); offRR(); offEnded(); offReset(); offShow(); offTug(); };
  }, []);

  const next = useCallback(() => setStep((s) => Math.min(s + 1, seq.length - 1)), [seq.length]);

  // NAME step auto-advances the moment the join registers — typing your name and
  // hitting send moves you forward (form-style), no separate "Next" tap needed.
  useEffect(() => {
    if (!loading && screen === 'name' && joined) {
      const id = setTimeout(() => setStep((s) => (seq[s] === 'name' ? Math.min(s + 1, seq.length - 1) : s)), 400);
      return () => clearTimeout(id);
    }
  }, [loading, screen, joined, seq]);

  // INTENT step: focus the field as soon as it shows so the keyboard is up
  // (desktop). iOS needs a tap to open the soft keyboard — unavoidable there.
  useEffect(() => {
    if (!loading && screen === 'intent') {
      const id = setTimeout(() => { const el = document.querySelector('.intent-input'); if (el) { try { el.focus(); } catch (e) {} } }, 200);
      return () => clearTimeout(id);
    }
  }, [loading, screen]);

  // ---- render ----
  // The actual app surface. On real mobile it fills the screen directly; on desktop
  // it sits inside the simulated-iPhone preview frame.
  const phoneInner = (
    <div className="phone">
      <Background />

      {ended ? (
        <ScreenRecap tracks={recapTracks} onBack={() => setEnded(false)} />
      ) : (
      <React.Fragment>
      <div className="topbar">
        <span className="live-pill"><i className="live-dot" />LIVE<span className="sep">—</span><span className="show">THE SHOW</span></span>
        <span className="room-stat"><b>{crowd.crowdSize}</b>&nbsp;HERE · <b>{crowd.bpm}</b>&nbsp;BPM</span>
      </div>

      <ShellProgress seq={seq} step={step} loading={loading} />

      <div className="deck shell-deck">
        <div className="deck-pane">
          {loading ? (
            <LoadingScreen reveal={reveal} />
          ) : screen === 'name' ? (
            <ScreenTexture active />
          ) : screen === 'vibe' ? (
            <ScreenVibe active />
          ) : screen === 'intent' ? (
            <ScreenIntent active onAdvance={next} />
          ) : (
            <VoteScreen />
          )}
        </div>
      </div>

      {/* footer Next — only VIBE needs it (name auto-advances on join;
          intent self-advances on send; vote is round-driven) */}
      {!loading && screen === 'vibe' && (
        <div className="shell-foot">
          <button className="shell-next" onClick={next}>NEXT →</button>
        </div>
      )}
      </React.Fragment>
      )}
    </div>
  );

  // Real phone → fill the screen (no fake device frame). Desktop → framed preview.
  const Stage = isMobile ? (
    <div id="stage" className="stage-bare">{phoneInner}</div>
  ) : (
    <div id="stage">
      <div style={{ transform: `scale(${scale})`, transformOrigin: 'center center' }}>
        <IOSDevice dark width={402} height={874}>{phoneInner}</IOSDevice>
      </div>
    </div>
  );
  return Stage;
}

/* tiny step indicator (dots) */
function ShellProgress({ seq, step, loading }) {
  return (
    <div className="shell-steps">
      {seq.map((s, i) => (
        <i key={s} className={'shell-dot' + (!loading && i === step ? ' on' : '') + (!loading && i < step ? ' done' : '')} />
      ))}
    </div>
  );
}

/* loading / "awaiting the next song" screen */
function LoadingScreen({ reveal }) {
  return (
    <div className="screen loading-screen">
      <div className="screen-kicker">HANG TIGHT</div>
      <h1 className="screen-title">YOUR TRACK<br /><span className="accent">IS BEING MADE</span></h1>
      <div className="ls-orb" aria-hidden="true"><span /><span /><span /></div>
      {reveal ? (
        <div className="ls-next">
          <span className="ls-next-k">NEXT UP</span>
          <span className="ls-next-name">{reveal.name}</span>
          <span className="ls-next-genre">{reveal.genre}</span>
          {reveal.answer ? <span className="ls-next-line">“{reveal.answer}”</span> : null}
        </div>
      ) : (
        <p className="vibe-help">Cooking the next drop from the crowd…</p>
      )}
    </div>
  );
}

/* VOTE: two big genre buttons — tap or hold either one to pull for that genre.
   Replaces the partner's pick-a-side ScreenTug (no side-select, no localStorage,
   no white-screen). Genre names + live % come from the networked window.Tug. */
function VoteScreen() {
  const [, force] = useState(0);
  const tugRef = useRef(window.Tug.getState());
  useEffect(() => {
    let raf = null;
    const off = window.Tug.on('tug', (s) => {
      tugRef.current = s;
      if (!raf) raf = requestAnimationFrame(() => { raf = null; force((n) => n + 1); });
    });
    return () => { off(); if (raf) cancelAnimationFrame(raf); };
  }, []);

  const holdRef = useRef(null);
  const fire = (side) => { try { window.Tug.pull(side, 0.62); } catch (e) {} if (navigator.vibrate) navigator.vibrate(12); };
  const down = (side) => (e) => {
    e.preventDefault();
    fire(side);
    if (holdRef.current) clearInterval(holdRef.current);
    holdRef.current = setInterval(() => fire(side), 110); // hold = rapid auto-fire
  };
  const up = () => { if (holdRef.current) { clearInterval(holdRef.current); holdRef.current = null; } };
  useEffect(() => () => up(), []);

  const t = tugRef.current;
  const G = window.Tug.GENRES;
  const aPct = Math.round((1 - t.p) * 100);
  const pct = { A: aPct, B: 100 - aPct };

  const btn = (side) => {
    const g = G[side] || { name: side, color: side === 'A' ? '#00E5FF' : '#FF1A8C' };
    return (
      <button
        className={'vs-btn vs-' + side.toLowerCase() + (pct[side] >= 50 ? ' lead' : '')}
        style={{ '--c': g.color }}
        onPointerDown={down(side)}
        onPointerUp={up}
        onPointerLeave={up}
        onPointerCancel={up}
        onContextMenu={(e) => e.preventDefault()}
      >
        <span className="vs-fill" style={{ height: pct[side] + '%' }} />
        <span className="vs-genre">{g.name}</span>
        <span className="vs-pct">{pct[side]}<i>%</i></span>
        <span className="vs-cta"><i className="vs-dot" />HOLD TO PULL</span>
      </button>
    );
  };

  const tr = t.timeRemaining || 0;
  const tt = t.timeTotal || 0;
  const collecting = !!t.collecting;
  const timeFrac = tt > 0 ? Math.max(0, Math.min(1, tr / tt)) : 0;

  return (
    <div className="screen votescreen">
      <div className="vs-timer">
        <div className="vs-timer-head">
          <span>{collecting ? 'VOTE ENDS IN' : 'GET READY'}</span>
          {collecting && <span className="vs-timer-num">{Math.ceil(tr)}s</span>}
        </div>
        <div className="vs-timer-bar"><i style={{ width: (timeFrac * 100) + '%' }} /></div>
      </div>
      <div className="vs-kicker">TAP OR HOLD TO PULL YOUR GENRE</div>
      <div className="vs-grid">{btn('A')}{btn('B')}</div>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<PhoneShell />);
