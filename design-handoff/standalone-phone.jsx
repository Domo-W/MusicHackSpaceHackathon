/* ============================================================
   standalone-phone.jsx — renders ONE phone screen in isolation
   (no deck, no tabs, no dev stepper). Which screen is chosen by
   window.__SCREEN = 'wait' | 'recap'. Reuses the real components.
   ============================================================ */
function StandalonePhone() {
  const MODE = window.__SCREEN || 'wait';
  const [scale, setScale] = useState(1);
  const [waitStatus, setWaitStatus] = useState('connecting');

  useEffect(() => { window.CrowdSim.start(); }, []);

  // opening "connecting -> waiting" beat (wait screen only)
  useEffect(() => { const id = setTimeout(() => setWaitStatus('waiting'), 1400); return () => clearTimeout(id); }, []);

  // per-frame energy -> CSS vars (drives glow/color like the live app)
  useEffect(() => window.CrowdSim.on('frame', (s) => {
    const r = document.documentElement.style;
    r.setProperty('--energy', s.energy.toFixed(4));
    r.setProperty('--ecolor', s.color);
  }), []);

  // scale-to-fit the device on black
  useEffect(() => {
    const fit = () => setScale(Math.min(window.innerWidth / 402, window.innerHeight / 874, 1));
    fit(); window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
  }, []);

  return (
    <div id="stage">
      <div style={{ transform: `scale(${scale})`, transformOrigin: 'center center' }}>
        <IOSDevice dark width={402} height={874}>
          <div className="phone">
            <Background />
            {MODE === 'recap' ? <ScreenRecap /> : <ScreenWait status={waitStatus} />}
          </div>
        </IOSDevice>
      </div>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<StandalonePhone />);
