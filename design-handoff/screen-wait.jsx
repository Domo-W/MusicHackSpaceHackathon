/* ============================================================
   screen-wait.jsx — phase: idle. "You're in — waiting for the DJ."
   Rendered as the WHOLE phone surface (owns its topbar) before the
   set opens. status: 'connecting' | 'waiting' | 'go'.
   Registered on window like the other screen files.
   ============================================================ */
function ScreenWait({ status = 'waiting' }) {
  const crowd = useCrowdState();
  const connecting = status === 'connecting';
  const go = status === 'go';

  const kicker = connecting ? 'CONNECTING…' : "YOU'RE IN";
  const title = connecting
    ? <React.Fragment>FINDING<br /><span className="accent">THE ROOM</span></React.Fragment>
    : <React.Fragment>WAITING FOR<br /><span className="accent">THE DJ</span></React.Fragment>;
  const help = connecting ? 'Syncing with the room…' : 'The set starts when the DJ drops in';

  return (
    <React.Fragment>
      <div className="topbar">
        <span className="live-pill">
          <i className="live-dot" />LIVE<span className="sep">—</span><span className="show">THE SHOW</span>
        </span>
        <span className="room-stat"><b>{crowd.crowdSize}</b>&nbsp;HERE · <b>—</b>&nbsp;BPM</span>
      </div>

      <div className={'screen wait' + (go ? ' go' : '')}>
        {go ? (
          <div className="wait-go">LET'S GO</div>
        ) : (
          <React.Fragment>
            <div className="screen-kicker">{kicker}</div>
            <h1 className="screen-title">{title}</h1>
            <div className="ls-orb" aria-hidden="true" />
            <p className="vibe-help wait-help">{help}</p>
            {!connecting && (
              <div className="wait-ready"><b>{crowd.crowdSize}</b> PEOPLE READY</div>
            )}
          </React.Fragment>
        )}
      </div>
    </React.Fragment>
  );
}

window.ScreenWait = ScreenWait;
