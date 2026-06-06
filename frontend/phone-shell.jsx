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

function PhoneShell() {
  const crowd = useCrowdState();
  const [joined, setJoined] = useState(!!window.__participantId);
  const [participated, setParticipated] = useState(false); // completed one full pass
  const [step, setStep] = useState(0);
  const [loading, setLoading] = useState(false);
  const [reveal, setReveal] = useState(null); // {name, genre, answer} from round_result
  const [scale, setScale] = useState(1);

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

  // ---- responsive scale-to-fit (same math as the partner shell) ----
  useEffect(() => {
    const fit = () => setScale(Math.min(window.innerWidth / 402, window.innerHeight / 874, 1));
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
    const offTug = window.Net.on('tug', (m) => {
      if (m && m.phase === 'collecting' && m.round > formedRound.current) {
        formedRound.current = m.round;
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
    return () => { offJoined(); offGen(); offRR(); offTug(); };
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

  // ---- render ----
  const Stage = (
    <div id="stage">
      <div style={{ transform: `scale(${scale})`, transformOrigin: 'center center' }}>
        <IOSDevice dark width={402} height={874}>
          <div className="phone">
            <Background />

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
                  <ScreenTug active />
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
          </div>
        </IOSDevice>
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

ReactDOM.createRoot(document.getElementById('root')).render(<PhoneShell />);
