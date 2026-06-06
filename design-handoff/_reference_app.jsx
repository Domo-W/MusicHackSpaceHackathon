/* ============================================================
   app.jsx — shell: LIVE pill, DJ auto-cycle, tabs + swipe,
   tweaks, and the per-frame energy→CSS-var driver.
   ============================================================ */

const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
  "accents": ["#FF1A8C", "#00E5FF"],
  "glow": 1,
  "grain": 0.07,
  "liveliness": 1.2,
  "font": "Space Grotesk"
}/*EDITMODE-END*/;

const MODES = [
  { id: 'vibe', label: 'VIBE', Comp: window.ScreenVibe },
  { id: 'intent', label: 'INTENT', Comp: window.ScreenIntent },
  { id: 'texture', label: 'NAME', Comp: window.ScreenTexture },
  { id: 'tug', label: 'TUG', Comp: window.ScreenTug },
];

/* dev-only phase stepper (prototype demo aid, not product UI) */
function PhaseDev({ phase, onIdle, onLive, onEnded }) {
  return (
    <div className="dev-step" role="group" aria-label="Demo phase stepper">
      <span className="dev-lbl">DEMO</span>
      <button className={phase === 'idle' ? 'on' : ''} onClick={onIdle}>Wait</button>
      <button className={phase === 'live' ? 'on' : ''} onClick={onLive}>Live</button>
      <button className={phase === 'ended' ? 'on' : ''} onClick={onEnded}>Recap</button>
    </div>
  );
}

function App() {
  const [t, setTweak] = useTweaks(TWEAK_DEFAULTS);
  const crowd = useCrowdState();
  const [idx, setIdx] = useState(0);        // start on VIBE (the join screen)
  const [scale, setScale] = useState(1);
  const [paneW, setPaneW] = useState(402);

  // drag/swipe
  const trackRef = useRef(null);
  const [dragPx, setDragPx] = useState(0);
  const [dragging, setDragging] = useState(false);
  const drag = useRef({ active: false, decided: false, x0: 0, y0: 0, w: 1 });
  const lastManualNav = useRef(-9999);

  // ---- show phase: idle (waiting) -> live (the set) -> ended (recap) ----
  const [phase, setPhase] = useState('idle');
  const [waitStatus, setWaitStatus] = useState('connecting');
  const goTimer = useRef(null);

  const goIdle = () => {
    if (goTimer.current) clearTimeout(goTimer.current);
    setPhase('idle'); setWaitStatus('connecting');
    goTimer.current = setTimeout(() => setWaitStatus('waiting'), 1400);
  };
  const goLive = (animate) => {
    if (goTimer.current) clearTimeout(goTimer.current);
    if (animate) {
      setPhase('idle'); setWaitStatus('go'); haptic(20);
      goTimer.current = setTimeout(() => { setIdx(0); setWaitStatus('waiting'); setPhase('live'); }, 850);
    } else { setIdx(0); setPhase('live'); }
  };
  const goEnded = () => { if (goTimer.current) clearTimeout(goTimer.current); setPhase('ended'); haptic(18); };

  // settle the opening "connecting -> waiting" beat on first load
  useEffect(() => { const id = setTimeout(() => setWaitStatus('waiting'), 1400); return () => clearTimeout(id); }, []);

  // dev keyboard shortcuts: 1 idle · 2 live · 3 ended
  useEffect(() => {
    const onKey = (e) => {
      if (e.target.closest && e.target.closest('input, textarea')) return;
      if (e.key === '1') goIdle();
      else if (e.key === '2') goLive(phase === 'idle');
      else if (e.key === '3') goEnded();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [phase]);

  // ---- start the sims once ----
  useEffect(() => { window.CrowdSim.start(); window.Tug.start('follower'); }, []);

  // ---- apply tweaks to CSS vars + sim ----
  useLayoutEffect(() => {
    const r = document.documentElement.style;
    r.setProperty('--magenta', t.accents[0]);
    r.setProperty('--cyan', t.accents[1]);
    r.setProperty('--glow', t.glow);
    r.setProperty('--grain', t.grain);
    r.setProperty('--disp', `'${t.font}', system-ui, sans-serif`);
  }, [t]);
  useEffect(() => { window.CrowdSim.setLiveliness(t.liveliness); }, [t.liveliness]);

  // ---- per-frame energy→color driver (no React churn) ----
  useEffect(() => window.CrowdSim.on('frame', (s) => {
    const r = document.documentElement.style;
    r.setProperty('--energy', s.energy.toFixed(4));
    r.setProperty('--ecolor', s.color);
  }), []);

  // ---- the "DJ ENABLED" indicator simply reflects the screen the
  // phone is currently on (no independent auto-cycling). ----

  // ---- responsive scale-to-fit ----
  useEffect(() => {
    const fit = () => {
      const s = Math.min(window.innerWidth / 402, window.innerHeight / 874, 1);
      setScale(s);
      if (trackRef.current) setPaneW(trackRef.current.offsetWidth || 402);
    };
    fit();
    window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
  }, []);

  const goTo = (i) => { lastManualNav.current = performance.now(); setIdx(clamp(i, 0, MODES.length - 1)); haptic(12); };

  // ---- swipe handlers (guarded so the hero hold + text input keep working) ----
  const onDown = (e) => {
    if (e.target.closest('.hype, .word-input, .pull-btn, .intent-input')) return;
    drag.current = { active: true, decided: false, x0: e.clientX, y0: e.clientY, w: trackRef.current.offsetWidth };
  };
  const onMove = (e) => {
    const d = drag.current; if (!d.active) return;
    const dx = e.clientX - d.x0, dy = e.clientY - d.y0;
    if (!d.decided) {
      if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
      d.decided = true;
      if (Math.abs(dx) > Math.abs(dy) * 1.25) {
        d.swiping = true; setDragging(true);
        try { trackRef.current.setPointerCapture(e.pointerId); } catch (err) {}
      } else { d.active = false; return; }
    }
    if (d.swiping) {
      e.preventDefault();
      let v = dx;
      if ((idx === 0 && dx > 0) || (idx === MODES.length - 1 && dx < 0)) v = dx * 0.35; // edge resistance
      setDragPx(v);
    }
  };
  const onUp = (e) => {
    const d = drag.current;
    if (d.swiping) {
      const dx = e.clientX - d.x0;
      if (dx < -55 && idx < MODES.length - 1) goTo(idx + 1);
      else if (dx > 55 && idx > 0) goTo(idx - 1);
    }
    drag.current = { active: false };
    setDragging(false); setDragPx(0);
  };

  const trackStyle = {
    transform: `translateX(${-idx * paneW + dragPx}px)`,
    transition: dragging ? 'none' : undefined,
  };

  return (
    <div id="stage">
      <div style={{ transform: `scale(${scale})`, transformOrigin: 'center center' }}>
        <IOSDevice dark width={402} height={874}>
          <div className="phone">
            <Background />

            {phase === 'idle' && <ScreenWait status={waitStatus} />}
            {phase === 'ended' && <ScreenRecap onBack={() => goLive(false)} />}

            {phase === 'live' && (
            <React.Fragment>
            {/* top chrome */}
            <div className="topbar">
              <span className="live-pill">
                <i className="live-dot" />LIVE<span className="sep">—</span><span className="show">THE SHOW</span>
              </span>
              <span className="room-stat"><b>{crowd.crowdSize}</b>&nbsp;HERE · <b>{crowd.bpm}</b>&nbsp;BPM</span>
            </div>

            {/* mode banner reflects the current screen */}
            <div className="dj-banner">
              <span className="pip" />DJ ENABLED&nbsp;<b>{MODES[idx].label}</b>
            </div>

            {/* swipeable deck */}
            <div
              className="deck"
              ref={trackRef}
              onPointerDown={onDown}
              onPointerMove={onMove}
              onPointerUp={onUp}
              onPointerCancel={onUp}
            >
              <div className={'deck-track' + (dragging ? ' dragging' : '')} style={trackStyle}>
                {MODES.map((m, i) => (
                  <div className="deck-pane" key={m.id}>
                    {Math.abs(i - idx) <= 1 ? <m.Comp active={i === idx} onAdvance={() => goTo(i + 1)} /> : null}
                  </div>
                ))}
              </div>
            </div>

            {/* dots */}
            <div className="dots">
              {MODES.map((m, i) => <i key={m.id} className={i === idx ? 'on' : ''} />)}
            </div>

            {/* bottom tabs */}
            <div className="tabbar">
              {MODES.map((m, i) => (
                <button
                  key={m.id}
                  className={'tab' + (i === idx ? ' active' : '') + (i === idx ? ' live-mode' : '')}
                  onClick={() => goTo(i)}
                >
                  <span className="tab-ico"><TabIcon mode={m.id} /></span>
                  <span className="tab-lbl">{m.label}</span>
                </button>
              ))}
            </div>
            </React.Fragment>
            )}
          </div>
        </IOSDevice>
      </div>

      <PhaseDev phase={phase}
        onIdle={goIdle}
        onLive={() => goLive(phase === 'idle')}
        onEnded={goEnded} />

      {/* Tweaks */}
      <TweaksPanel>
        <TweakSection label="Look" />
        <TweakColor label="Accent pair" value={t.accents}
          options={[["#FF1A8C", "#00E5FF"], ["#C9FF3B", "#B65CFF"], ["#FF3B30", "#2E7BFF"], ["#FF7A1A", "#00E5A8"]]}
          onChange={(v) => setTweak('accents', v)} />
        <TweakSlider label="Bloom / glow" value={t.glow} min={0} max={2} step={0.1}
          onChange={(v) => setTweak('glow', v)} />
        <TweakSlider label="Film grain" value={t.grain} min={0} max={0.2} step={0.01}
          onChange={(v) => setTweak('grain', v)} />
        <TweakSection label="Crowd" />
        <TweakSlider label="Liveliness" value={t.liveliness} min={0.5} max={1.8} step={0.1}
          onChange={(v) => setTweak('liveliness', v)} />
        <TweakSection label="Type" />
        <TweakSelect label="Display font" value={t.font}
          options={["Space Grotesk", "Archivo", "Chakra Petch", "Orbitron"]}
          onChange={(v) => setTweak('font', v)} />
      </TweaksPanel>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<App />);
