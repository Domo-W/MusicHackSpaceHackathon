/* ============================================================
   setlist.js — the session SET the crowd "wrote" tonight.
   PLACEHOLDER / FALLBACK DATA. The live recap is driven by the
   real saved songs that arrive on the `show_ended` message (see
   phone-shell.jsx). This list only renders if that payload is
   empty (e.g. opening the recap with no songs saved yet).

   Each track:  { id, title, genre, by, dur }
   `genre` keys into GENRES below for the pill colour.
   ============================================================ */
(function () {
  'use strict';

  // genre -> pill colour (matches the room palette; cyan/magenta lead)
  const GENRES = {
    'NU FUNK':   '#00E5FF',
    'NU SOUL':   '#FF1A8C',
    'NEW FUNK':  '#00E5FF',
    'NEW SOUL':  '#FF1A8C',
    'DISCO':     '#FF7A1A',
    'HOUSE':     '#2E7BFF',
    'DREAM POP': '#B65CFF',
    'BREAKS':    '#00E5A8',
  };

  // ---- PLACEHOLDER tracklist (original/fictional titles) -----
  const tracks = [
    { id: 't01', title: 'OPENING PRESSURE',  genre: 'HOUSE',     by: 'SARAH',  dur: 228 },
    { id: 't02', title: 'GLASS CORRIDOR',    genre: 'NU FUNK',   by: 'MARCUS', dur: 252 },
    { id: 't03', title: 'VELVET STATIC',     genre: 'NU SOUL',   by: 'LUNA',   dur: 201 },
    { id: 't04', title: 'ROOM TEMPERATURE',  genre: 'DISCO',     by: 'OMAR',   dur: 274 },
    { id: 't05', title: 'HALF LIGHT HOLD',   genre: 'DREAM POP', by: 'MIA',    dur: 188 },
    { id: 't06', title: 'NORTH OF MIDNIGHT', genre: 'BREAKS',    by: 'RAVI',   dur: 246 },
    { id: 't07', title: 'PAPER ENGINES',     genre: 'NU FUNK',   by: 'ZARA',   dur: 215 },
    { id: 't08', title: 'SLOW DETONATION',   genre: 'HOUSE',     by: 'THEO',   dur: 263 },
    { id: 't09', title: 'LAST CALL THEORY',  genre: 'NU SOUL',   by: 'CARMEN', dur: 232 },
  ];

  function genreColor(g) { return GENRES[String(g || '').toUpperCase()] || '#00E5FF'; }

  // mm:ss
  function fmtTime(s) {
    s = Math.max(0, Math.floor(s || 0));
    return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
  }

  function filename(track, i) {
    const slug = String(track.title).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
    return `between-sets-${String(i + 1).padStart(2, '0')}-${slug}.m4a`;
  }

  window.SetList = { GENRES, tracks, genreColor, fmtTime, filename };
})();
