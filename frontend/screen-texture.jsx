/* ============================================================
   screen-texture.jsx — Screen 2: SHOUT THE TEXTURE (word wall)
   ============================================================ */
const TEX_EMOJI = ['🙌', '🔥', '❤️', '🥂', '✨'];

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

  // listen to the crowd
  useEffect(() => window.CrowdSim.on('word', (d) => ingest(d.text, d.mine)), [ingest]);

  const submit = (e) => {
    e && e.preventDefault();
    if (!val.trim()) return;
    ingest(val, true);
    window.CrowdSim.addWord(val);
    haptic(16);
    setVal('');
  };
  const tapEmoji = (em) => { ingest(em, true); window.CrowdSim.addWord(em); haptic(12); };

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
