/* ============================================================
   screen-recap.jsx — phase: ended. "The set you made tonight."
   A playlist PLAYER: tap any track to play it inline (mocked
   playback with a progress ticker + auto-advance), a master
   PLAY ALL transport, a docked now-playing bar, and per-track
   download for saving specific songs.

   MERGED FROM design-handoff (reference only). Adapted for the live app:
     - the orb spinner class is `.recap-orb` (NOT `.ls-orb`) so it does
       not collide with the linear shell's existing `.ls-orb` loader.
     - `tracks` may be passed as a prop (the real `show_ended` payload,
       mapped to {id,title,genre,by,dur,downloadUrl}); falls back to the
       placeholder window.SetList when absent.
     - per-track + save-all downloads hit the real /api/songs/:id/download
       endpoint when a track carries a `downloadUrl`; otherwise they toast.
       Playback is still a simulated ticker (no inline audio yet).
   ============================================================ */
function DownloadIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M12 3.5 V14" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
      <path d="M7 10 L12 15 L17 10" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M5 19.5 H19" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
    </svg>
  );
}
function CheckIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M5 12.5 L10 17.5 L19.5 7" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
function PlayIcon() {
  return (<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M7 4.5 L19 12 L7 19.5 Z" /></svg>);
}
function PauseIcon() {
  return (<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="6" y="4.5" width="4.4" height="15" rx="1.2" /><rect x="13.6" y="4.5" width="4.4" height="15" rx="1.2" /></svg>);
}
function ShareIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M9.5 14.5 L14.5 9.5" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" />
      <path d="M13 7 L14.6 5.4 a3.4 3.4 0 0 1 4.8 4.8 L17.8 11.8" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M11 16.2 L9.4 17.8 a3.4 3.4 0 0 1-4.8-4.8 L6.2 11.4" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// trigger a real browser download for a saved song's audio file
function downloadFile(url, name) {
  try {
    const a = document.createElement('a');
    a.href = url;
    if (name) a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
  } catch (e) {}
}

function ScreenRecap({ onBack, tracks: propTracks, playlistUrl }) {
  const SL = window.SetList || { tracks: [], genreColor: () => '#00E5FF', fmtTime: () => '0:00' };
  const tracks = (Array.isArray(propTracks) && propTracks.length) ? propTracks : SL.tracks;
  const fmt = SL.fmtTime;

  const [stage, setStage] = useState('building');                       // building | ready | empty
  const [currentId, setCurrentId] = useState(tracks.length ? tracks[0].id : null);
  const [playing, setPlaying] = useState(false);
  const [elapsed, setElapsed] = useState(0);                            // seconds into current track
  const [savedIds, setSavedIds] = useState({});
  const [allSaved, setAllSaved] = useState(false);
  const [linkCopied, setLinkCopied] = useState(false);
  const [toast, setToast] = useState({ msg: '', show: false });
  const toastTimer = useRef(null);
  const curRef = useRef(currentId); curRef.current = currentId;

  useEffect(() => {
    const id = setTimeout(() => setStage(tracks.length ? 'ready' : 'empty'), 1400);
    return () => clearTimeout(id);
  }, [tracks.length]);

  // mocked playback ticker — advances elapsed, auto-plays the next track
  useEffect(() => {
    if (!playing) return;
    const id = setInterval(() => {
      setElapsed((e) => {
        const cur = tracks.find((t) => t.id === curRef.current);
        const dur = cur ? cur.dur : 0;
        const ne = e + 0.25;
        if (dur && ne >= dur) {
          const idx = tracks.findIndex((t) => t.id === curRef.current);
          if (idx < tracks.length - 1) { const nx = tracks[idx + 1]; curRef.current = nx.id; setCurrentId(nx.id); return 0; }
          setPlaying(false); return dur;                                // reached end of set
        }
        return ne;
      });
    }, 250);
    return () => clearInterval(id);
  }, [playing, tracks]);

  const ping = (msg) => {
    setToast({ msg, show: true }); haptic(12);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast((t) => ({ ...t, show: false })), 1900);
  };

  const playTrack = (t) => {
    if (t.id === currentId) { setPlaying((p) => !p); haptic(8); return; }
    curRef.current = t.id; setCurrentId(t.id); setElapsed(0); setPlaying(true); haptic(10);
  };
  const masterToggle = () => { if (!currentId) return; setPlaying((p) => !p); haptic(10); };

  const saveOne = (t) => {
    if (savedIds[t.id]) return;
    if (t.downloadUrl) downloadFile(t.downloadUrl, t.fileName);
    setSavedIds((s) => ({ ...s, [t.id]: true }));
    ping('Track saved ✓');
  };
  const saveAll = () => {
    const all = {};
    tracks.forEach((t) => { all[t.id] = true; if (t.downloadUrl) downloadFile(t.downloadUrl, t.fileName); });
    setSavedIds(all); setAllSaved(true); ping('All tracks saved ✓'); haptic([10, 40, 10]);
  };
  const copyLink = () => {
    const url = playlistUrl || (location.origin + '/phone-live.html');
    try { navigator.clipboard && navigator.clipboard.writeText(url); } catch (e) {}
    setLinkCopied(true); ping('Link copied ✓');
  };

  const current = tracks.find((t) => t.id === currentId) || null;
  const dur = current ? current.dur : 0;
  const pct = dur ? Math.min(100, (elapsed / dur) * 100) : 0;
  const masterLabel = playing ? 'PAUSE' : (elapsed > 0 ? 'RESUME' : 'PLAY ALL');

  return (
    <React.Fragment>
      <div className="topbar">
        <span className="live-pill steady"><i className="live-dot" />SET COMPLETE</span>
        <span className="room-stat"><b>{tracks.length}</b>&nbsp;TRACKS</span>
      </div>

      <div className="screen recap">
        <div className="recap-hero">
          <div className="screen-kicker">THAT'S A WRAP</div>
          <h1 className="screen-title">THE SET YOU<br /><span className="accent">MADE TONIGHT</span></h1>

          {stage === 'ready' && (
            <div className="recap-actions">
              <button className="play-all" onClick={masterToggle}>
                {playing ? <PauseIcon /> : <PlayIcon />}{masterLabel}
              </button>
              <button className={'act-icon' + (allSaved ? ' saved' : '')} onClick={saveAll} aria-label="Download all tracks">
                {allSaved ? <CheckIcon /> : <DownloadIcon />}
              </button>
              <button className={'act-icon' + (linkCopied ? ' saved' : '')} onClick={copyLink} aria-label="Copy playlist link">
                <ShareIcon />
              </button>
            </div>
          )}
        </div>

        {stage === 'building' && (
          <div className="recap-mid">
            <div className="recap-orb" aria-hidden="true" />
            <p className="vibe-help">Gathering tonight's tracks…</p>
          </div>
        )}

        {stage === 'empty' && (
          <div className="recap-mid">
            <p className="vibe-help">No tracks finished this session</p>
            {onBack && <button className="recap-ghost" onClick={onBack}>BACK TO THE ROOM</button>}
          </div>
        )}

        {stage === 'ready' && (
          <div className="rc-list">
            {tracks.map((t, i) => {
              const gc = SL.genreColor(t.genre);
              const saved = !!savedIds[t.id];
              const isCur = t.id === currentId;
              return (
                <div className={'rc-row' + (isCur ? ' current' : '')} key={t.id}>
                  {isCur && <span className="rc-prog" style={{ width: pct + '%' }} />}
                  <button className="rc-lead" onClick={() => playTrack(t)} aria-label={isCur && playing ? 'Pause' : 'Play ' + t.title}>
                    {isCur && playing
                      ? <span className="eq" aria-hidden="true"><i /><i /><i /></span>
                      : isCur ? <PlayIcon /> : String(i + 1).padStart(2, '0')}
                  </button>
                  <div className="rc-main">
                    <span className="rc-title">{t.title}</span>
                    <span className="rc-meta">
                      <span className="rc-genre" style={{ '--gc': gc }}>{t.genre}</span>
                      <span className="rc-by">by {t.by}</span>
                      <span className="rc-dur">{fmt(t.dur)}</span>
                    </span>
                  </div>
                  <button className={'rc-dl' + (saved ? ' saved' : '')} onClick={() => saveOne(t)} aria-label={saved ? 'Saved' : 'Download ' + t.title}>
                    {saved ? <CheckIcon /> : <DownloadIcon />}
                  </button>
                </div>
              );
            })}
          </div>
        )}

        {stage === 'ready' && current && (
          <div className="np-bar">
            <div className="np-prog"><i style={{ width: pct + '%' }} /></div>
            <div className="np-main">
              <button className="np-play" onClick={masterToggle} aria-label={playing ? 'Pause' : 'Play'}>
                {playing ? <PauseIcon /> : <PlayIcon />}
              </button>
              <div className="np-info">
                <span className="np-title">{current.title}</span>
                <span className="np-sub">by {current.by} · {fmt(elapsed)} / {fmt(dur)}</span>
              </div>
              <button className={'np-dl' + (savedIds[current.id] ? ' saved' : '')} onClick={() => saveOne(current)} aria-label="Download this track">
                {savedIds[current.id] ? <CheckIcon /> : <DownloadIcon />}
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="phone-toast" data-show={toast.show ? '1' : '0'}>{toast.msg}</div>
    </React.Fragment>
  );
}

window.ScreenRecap = ScreenRecap;
