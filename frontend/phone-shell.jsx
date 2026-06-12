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

// Vibe ("Pick the Vibe") step removed from the flow for now (code kept, unused).
// EVERYONE walks the whole flow every round — name → intent → vote. Returning
// participants don't auto-skip the name screen; they re-confirm with a Continue
// tap (their join is idempotent, so no duplicate) before stating a fresh intent.
const SEQ_NEW = ['name', 'intent', 'vote'];
const SEQ_RETURNING = ['name', 'intent', 'vote'];

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
    lyrics: s.lyrics || '', // shown in the full-screen lyrics view when a track is tapped
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
  const [round, setRound] = useState(0);       // current backend round (drives per-round re-join)
  const [needCode, setNeedCode] = useState(() => !window.PhoneRoom || (!window.PhoneRoom.hasCode() && !window.__participantId));
  const [codeInput, setCodeInput] = useState('');
  const [codeError, setCodeError] = useState('');
  const [isHost, setIsHost] = useState(() => !!(window.PhoneRoom && window.PhoneRoom.isHost()));
  const [hostName, setHostName] = useState(null);
  const [started, setStarted] = useState(false); // reactive show-started flag (drives host buttons)

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
      setStarted(!!(m && m.started));
      if (m.phase === 'idle') {
        formedRound.current = 0;
        setRound(0);
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
      // 'gathering' (name-cloud window) is the START of a round — same reset as
      // collecting: drop the loading screen and put the user into name/intent.
      if (m.phase === 'gathering' || m.phase === 'collecting') {
        const changedRound = m.round !== formedRound.current;
        formedRound.current = m.round;
        setRound(m.round);
        // A new round means a new set is live again — leave the recap.
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
        setRound(0);
        setLoading(false);
        setReveal(null);
      } else if (m && (m.phase === 'gathering' || m.phase === 'collecting') && m.round !== formedRound.current) {
        formedRound.current = m.round;
        setRound(m.round);
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

  // A new round (>1) clears everyone on the backend — re-join: forget the old id
  // and drop to the NAME screen so the user re-types their name into the mix.
  useEffect(() => {
    if (round > 1) {
      if (window.__resetJoinState) window.__resetJoinState();
      setJoined(false);
      setStep(0);
    }
  }, [round]);

  // ---- host/room/rejection event subscriptions ----
  useEffect(() => {
    const onHost = () => setIsHost(!!(window.PhoneRoom && window.PhoneRoom.isHost()));
    const onRoom = (e) => {
      const m = e.detail;
      setHostName(m ? m.hostName : null);
      // Self-heal: a room is open/live → phone-net has adopted its code, so skip
      // the manual code screen and let the user join the current room.
      if (m && (m.lobbyState === 'open' || m.lobbyState === 'live') && m.code) {
        setCodeError('');
        setNeedCode(false);
      }
    };
    const onRej = (e) => { setNeedCode(true); setCodeError(e.detail === 'busy' ? 'A show is already running' : 'Wrong code — try again'); };
    window.addEventListener('bs:hoststate', onHost);
    window.addEventListener('bs:roomstate', onRoom);
    window.addEventListener('bs:joinrejected', onRej);
    return () => {
      window.removeEventListener('bs:hoststate', onHost);
      window.removeEventListener('bs:roomstate', onRoom);
      window.removeEventListener('bs:joinrejected', onRej);
    };
  }, []);

  // NAME step auto-advances the moment the join registers — typing your name and
  // submitting moves you to "I want to…". `joined` is reset every round, so this
  // fires fresh each time (no instant-skip) for everyone, new or returning.
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

  // ---- code gate: show before the name flow if no code is cached/from URL ----
  if (needCode) {
    return (
      <div className="screen code-screen" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: 14, padding: 20 }}>
        <div className="screen-kicker" style={{ letterSpacing: '0.2em', opacity: 0.6 }}>ENTER ROOM CODE</div>
        <input
          value={codeInput}
          onChange={(e) => { setCodeInput(e.target.value.toUpperCase().slice(0, 4)); setCodeError(''); }}
          placeholder="CODE"
          maxLength={4}
          autoCapitalize="characters"
          style={{ width: 160, textAlign: 'center', fontFamily: 'monospace', fontSize: 34, letterSpacing: '0.3em', padding: '12px 0', borderRadius: 12, border: '1px solid #333', background: '#15151F', color: '#00E5FF' }}
        />
        {codeError ? <div style={{ color: '#FF7A9F', fontSize: 13 }}>{codeError}</div> : null}
        <button
          onClick={() => {
            if (codeInput.length !== 4) { setCodeError('4 letters'); return; }
            window.PhoneRoom.setCode(codeInput);
            setNeedCode(false);
          }}
          style={{ padding: '12px 30px', borderRadius: 999, border: 'none', background: '#00E5FF', color: '#0A0A0F', fontWeight: 700, letterSpacing: '0.06em' }}
        >JOIN</button>
      </div>
    );
  }

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

      {/* host controls — shown on the name screen pre-show, or End button during show */}
      {!loading && screen === 'name' && !started && isHost ? (
        <div className="shell-foot">
          <button
            onClick={() => window.PhoneRoom.startShow()}
            style={{ marginTop: 14, padding: '14px 24px', borderRadius: 999, border: 'none', background: '#FF1A8C', color: '#0A0A0F', fontWeight: 700, letterSpacing: '0.05em', width: '100%' }}
          >👑 EVERYBODY'S IN — START</button>
        </div>
      ) : null}
      {!loading && screen === 'name' && !started && !isHost && hostName ? (
        <div style={{ marginTop: 14, textAlign: 'center', fontSize: 12, color: '#8C8C9C', padding: '0 18px 12px' }}>waiting for {hostName} to start the show</div>
      ) : null}

      {/* footer Next — only VIBE needs it (name auto-advances on join;
          intent self-advances on send; vote is round-driven) */}
      {!loading && screen === 'vibe' && (
        <div className="shell-foot">
          <button className="shell-next" onClick={next}>NEXT →</button>
        </div>
      )}

      {/* End show button for host during an active show */}
      {started && isHost ? (
        <button
          onClick={() => { if (confirm('End the show and go to the recap?')) window.PhoneRoom.endShow(); }}
          style={{ position: 'fixed', bottom: 10, right: 10, padding: '8px 14px', borderRadius: 999, border: '1px solid #FF1A8C', background: 'transparent', color: '#FF7A9F', fontSize: 11, letterSpacing: '0.05em', zIndex: 30 }}
        >End show</button>
      ) : null}
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
      <h1 className="screen-title">THE NEXT TRACK<br /><span className="accent">IS COOKING</span></h1>
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

  // TAP ONLY — one pull per tap. Holding is intentionally NOT auto-fired: a held
  // finger used to rapid-pull (setInterval) which is overpowered. Each discrete
  // tap = one pull, so spamming distinct taps is the only way to push your genre.
  const fire = (side) => { try { window.Tug.pull(side, 0.62); } catch (e) {} if (navigator.vibrate) navigator.vibrate(12); };
  const down = (side) => (e) => { e.preventDefault(); fire(side); };
  const up = () => {};

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
        <span className="vs-cta"><i className="vs-dot" />TAP TO PULL</span>
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
      <div className="vs-kicker">TAP FAST TO PULL YOUR GENRE</div>
      <div className="vs-grid">{btn('A')}{btn('B')}</div>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<PhoneShell />);
