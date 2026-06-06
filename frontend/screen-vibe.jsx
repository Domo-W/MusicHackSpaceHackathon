/* ============================================================
   screen-vibe.jsx — Screen 1: PICK THE VIBE (live poll)
   ============================================================ */
function ScreenVibe({ active }) {
  const crowd = useCrowdState();
  const [myVote, setMyVote] = useState(null);
  const VIBES = window.CrowdSim.VIBES;

  // displayed tally = live crowd votes + this phone's single vote (+1)
  const votes = {};
  let total = 0;
  for (const v of VIBES) {
    votes[v.key] = crowd.votes[v.key] + (myVote === v.key ? 1 : 0);
    total += votes[v.key];
  }
  total = total || 1;

  // leader (for the trending tag)
  let leader = VIBES[0].key, leadN = -1;
  for (const v of VIBES) if (votes[v.key] > leadN) { leadN = votes[v.key]; leader = v.key; }

  const cast = (key) => {
    setMyVote((prev) => (prev === key ? prev : key));
    haptic(prev_for(key, myVote));
  };

  return (
    <div className="screen vibe">
      <div className="screen-kicker">LIVE POLL</div>
      <h1 className="screen-title">PICK THE<br /><span className="accent">VIBE</span></h1>
      <p className="vibe-help">{myVote ? 'TAP ANOTHER TO SWITCH YOUR VOTE' : 'TAP A CARD TO STEER THE ROOM'}</p>

      <div className="vibe-grid thumb">
        {VIBES.map((v) => {
          const sel = myVote === v.key;
          const pct = Math.round((votes[v.key] / total) * 100);
          return (
            <button
              key={v.key}
              className={'vibe-card' + (sel ? ' sel' : '')}
              style={{ '--vc': v.color }}
              onClick={() => cast(v.key)}
              aria-pressed={sel}
            >
              <span className="vc-ico"><VibeIcon vibe={v.key} size={38} /></span>
              <span className="vc-label">{v.label}</span>
              <span className="vc-sub">{v.sub}</span>
              <span className="vc-pct">{pct}<i>%</i></span>
              {leader === v.key && leadN > 0 && <span className="vc-lead">LEADING</span>}
              {sel && <span className="vc-check">● YOUR VOTE</span>}
            </button>
          );
        })}
      </div>

      {/* live tally bar */}
      <div className="tally">
        <div className="tally-head">
          <span>ROOM SPLIT</span>
          <span className="tally-total">{total.toLocaleString()} VOTES</span>
        </div>
        <div className="tally-bar">
          {VIBES.map((v) => {
            const w = (votes[v.key] / total) * 100;
            return <span key={v.key} className="tally-seg" style={{ width: w + '%', background: v.color, boxShadow: `0 0 calc(10px * var(--glow)) ${v.color}` }} />;
          })}
        </div>
        <div className="tally-legend">
          {VIBES.map((v) => (
            <span key={v.key} className="leg">
              <i style={{ background: v.color }} />{v.label}&nbsp;<b>{Math.round((votes[v.key] / total) * 100)}%</b>
            </span>
          ))}
        </div>
      </div>
    </div>
  );

  function prev_for(key, prev) { return prev === key ? 8 : (prev ? [10, 30, 14] : 18); }
}

window.ScreenVibe = ScreenVibe;
