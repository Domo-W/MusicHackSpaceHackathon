/* ============================================================
   shared.jsx — hooks, background texture, icon set, helpers
   Shared across all screen files via window.*
   ============================================================ */
const { useState, useEffect, useRef, useCallback, useLayoutEffect } = React;

/* haptics — guarded; silently no-ops where unsupported */
function haptic(pattern) {
  try { if (navigator.vibrate) navigator.vibrate(pattern); } catch (e) {}
}

/* subscribe to the low-rate 'state' tick; returns a snapshot object
   that updates ~8x/sec (good for numbers, lists, labels). */
function useCrowdState() {
  const [, force] = useState(0);
  const ref = useRef(window.CrowdSim.getState());
  useEffect(() => {
    let raf = null;
    const off = window.CrowdSim.on('state', (s) => {
      ref.current = s;
      if (!raf) raf = requestAnimationFrame(() => { raf = null; force((n) => n + 1); });
    });
    return () => { off(); if (raf) cancelAnimationFrame(raf); };
  }, []);
  return ref.current;
}

/* beat counter — re-renders only on the beat (≈2–3x/sec). */
function useBeat() {
  const [beat, setBeat] = useState(0);
  useEffect(() => window.CrowdSim.on('beat', setBeat), []);
  return beat;
}

/* run a callback on every beat without re-rendering. */
function useOnBeat(fn) {
  const f = useRef(fn); f.current = fn;
  useEffect(() => window.CrowdSim.on('beat', (b) => f.current(b)), []);
}

/* ---- Background: all texture layers ----------------------- */
function Background() {
  return (
    <div className="tex" aria-hidden="true">
      <div className="tex tex-blobs" />
      <div className="tex tex-wash" />
      <div className="tex tex-scan" />
      <div className="tex tex-grain" />
      <div className="tex tex-vignette" />
    </div>
  );
}

/* ---- Vibe icons (simple geometric only) ------------------- */
function VibeIcon({ vibe, size = 40 }) {
  const c = 'currentColor';
  const common = { width: size, height: size, viewBox: '0 0 40 40', fill: 'none' };
  if (vibe === 'dance') { // burst of motion (sun-like)
    const rays = [];
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      rays.push(<line key={i} x1={20 + Math.cos(a) * 12} y1={20 + Math.sin(a) * 12}
        x2={20 + Math.cos(a) * 18} y2={20 + Math.sin(a) * 18} stroke={c} strokeWidth="2.4" strokeLinecap="round" />);
    }
    return (<svg {...common}><circle cx="20" cy="20" r="7" fill={c} />{rays}</svg>);
  }
  if (vibe === 'drink') { // glass — downward triangle on a stem
    return (<svg {...common}>
      <path d="M9 9 L31 9 L20 23 Z" stroke={c} strokeWidth="2.6" strokeLinejoin="round" />
      <line x1="20" y1="23" x2="20" y2="31" stroke={c} strokeWidth="2.6" strokeLinecap="round" />
      <line x1="13" y1="31" x2="27" y2="31" stroke={c} strokeWidth="2.6" strokeLinecap="round" />
    </svg>);
  }
  if (vibe === 'flirt') { // two overlapping circles (a connection / wink)
    return (<svg {...common}>
      <circle cx="15" cy="20" r="8" stroke={c} strokeWidth="2.6" />
      <circle cx="25" cy="20" r="8" stroke={c} strokeWidth="2.6" />
    </svg>);
  }
  // make memories — a photo frame (square + lens)
  return (<svg {...common}>
    <rect x="7" y="10" width="26" height="22" rx="3" stroke={c} strokeWidth="2.6" />
    <circle cx="20" cy="21" r="5.5" fill={c} />
    <rect x="15" y="6.5" width="10" height="4.5" rx="1.5" fill={c} />
  </svg>);
}

/* ---- Tab icons -------------------------------------------- */
function TabIcon({ mode, size = 22 }) {
  const c = 'currentColor';
  const p = { width: size, height: size, viewBox: '0 0 24 24', fill: 'none' };
  if (mode === 'vibe') // diamond vote
    return (<svg {...p}><path d="M12 3 L20 12 L12 21 L4 12 Z" stroke={c} strokeWidth="2" strokeLinejoin="round" /><path d="M12 9 L15 12 L12 15 L9 12 Z" fill={c} /></svg>);
  if (mode === 'texture') // person / name
    return (<svg {...p}>
      <circle cx="12" cy="8" r="4.2" fill={c} />
      <path d="M4.5 20c0-4.7 3.4-7.5 7.5-7.5s7.5 2.8 7.5 7.5" fill="none" stroke={c} strokeWidth="2.2" strokeLinecap="round" />
    </svg>);
  if (mode === 'tug') // two opposing arrows meeting at center
    return (<svg {...p}>
      <line x1="3" y1="12" x2="21" y2="12" stroke={c} strokeWidth="2" />
      <path d="M9 7 L4 12 L9 17" stroke={c} strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M15 7 L20 12 L15 17" stroke={c} strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
    </svg>);
  // drop — ring with core
  return (<svg {...p}><circle cx="12" cy="12" r="8.5" stroke={c} strokeWidth="2" /><circle cx="12" cy="12" r="3.5" fill={c} /></svg>);
}

/* clamp helper */
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

Object.assign(window, {
  haptic, useCrowdState, useBeat, useOnBeat, Background, VibeIcon, TabIcon, clamp,
});
