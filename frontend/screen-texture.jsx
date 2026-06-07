/* ============================================================
   screen-texture.jsx — Screen 2: SHOUT THE TEXTURE (word wall)
   ============================================================ */
function ScreenTexture({ active }) {
  const [words, setWords] = useState([]);      // [{text,count,mine,ts,bump}]
  const [ghosts, setGhosts] = useState([]);    // ephemeral rising tokens
  const [val, setVal] = useState('');
  const ghostId = useRef(0);

  const ingest = useCallback((text, mine) => {
    const t = String(text).trim().toUpperCase().slice(0, 16);
    if (!t) return;
    setWords((prev) => {
      const next = prev.map((w) => ({ ...w, bump: false }));
      const i = next.findIndex((w) => w.text === t);
      if (i >= 0) {
        next[i] = { ...next[i], count: next[i].count + 1, ts: Date.now(), mine: next[i].mine || mine, bump: true };
      } else {
        next.push({ text: t, count: 1, mine, ts: Date.now(), bump: true });
      }
      // keep the wall tidy: cap unique words, drop the quietest
      next.sort((a, b) => b.count - a.count || b.ts - a.ts);
      return next.slice(0, 26);
    });
    // spawn a rising ghost
    const id = ghostId.current++;
    const x = mine ? 50 : 12 + Math.random() * 76;
    setGhosts((g) => [...g, { id, text: t, x, mine }]);
    setTimeout(() => setGhosts((g) => g.filter((gh) => gh.id !== id)), 1700);
  }, []);

  const norm = (s) => String(s || '').trim().toUpperCase().slice(0, 16);
  // Reconcile the wall to the REAL submitted names (no simulated chatter): add
  // missing, drop names that cleared — e.g. at the start of a new round.
  const syncNames = useCallback((list) => {
    const me = norm(window.__participantName);
    const wanted = (list || []).map(norm).filter(Boolean);
    const wantedSet = new Set(wanted);
    setWords((prev) => {
      const next = prev.filter((w) => wantedSet.has(w.text));
      wanted.forEach((t) => { if (!next.find((w) => w.text === t)) next.push({ text: t, count: 1, mine: t === me, ts: Date.now(), bump: false }); });
      return next.slice(0, 26);
    });
  }, []);

  // Real names only — they appear live as people join and clear each round.
  useEffect(() => {
    const N = window.Net;
    if (!N || !N.on) return;
    const off1 = N.on('name', (m) => { if (m && m.name) ingest(m.name, norm(m.name) === norm(window.__participantName)); });
    const off2 = N.on('names', (m) => syncNames((m && m.names) || []));
    return () => { off1 && off1(); off2 && off2(); };
  }, [ingest, syncNames]);

  const submit = (e) => {
    e && e.preventDefault();
    if (!val.trim()) return;
    if (window.submitName) window.submitName(val); // join + broadcast the real name to everyone
    haptic(16);
    setVal('');
  };

  const maxCount = words.reduce((m, w) => Math.max(m, w.count), 0);
  const trend = words.length ? words[0] : null; // already sorted desc

  return (
    <div className="screen texture">
      <div className="screen-kicker">SHOUT-OUTS</div>
      <h1 className="screen-title">SHOUT A<br /><span className="accent">NAME</span></h1>

      <div className="wall">
        {words.length === 0 && (
          <div className="wall-empty">
            <span className="we-big">QUIET…</span>
            <span className="we-sub">BE THE FIRST TO SHOUT SOMEONE OUT</span>
          </div>
        )}
        <div className="wall-cloud">
          {words.map((w) => {
            const ratio = maxCount ? w.count / maxCount : 0;
            const size = 15 + ratio * 30;                 // 15 → 45px
            const isTrend = trend && w.text === trend.text && w.count > 1;
            return (
              <span
                key={w.text}
                className={'word' + (w.mine ? ' mine' : '') + (isTrend ? ' trend' : '') + (w.bump ? ' bump' : '')}
                style={{
                  fontSize: size + 'px',
                  '--wglow': (0.2 + ratio * 0.8).toFixed(2),
                  opacity: (0.5 + ratio * 0.5).toFixed(2),
                }}
              >
                {w.text}
                {isTrend && <i className="word-tag">TRENDING</i>}
              </span>
            );
          })}
        </div>
        {/* rising ghosts */}
        {ghosts.map((g) => (
          <span key={g.id} className={'ghost' + (g.mine ? ' mine' : '')} style={{ left: g.x + '%' }}>{g.text}</span>
        ))}
      </div>

      {/* input dock (thumb zone) — emoji quick-taps removed (confusing, didn't add). */}
      <div className="dock">
        <form className="word-form" onSubmit={submit}>
          <input
            className="word-input"
            value={val}
            onChange={(e) => setVal(e.target.value)}
            placeholder="Drop a name — shout someone out."
            maxLength={16}
            enterKeyHint="send"
            autoComplete="off"
          />
          <button type="submit" className="word-send" aria-label="send word" disabled={!val.trim()}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none"><path d="M5 12h13M12 5l7 7-7 7" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" /></svg>
          </button>
        </form>
      </div>
    </div>
  );
}

window.ScreenTexture = ScreenTexture;
