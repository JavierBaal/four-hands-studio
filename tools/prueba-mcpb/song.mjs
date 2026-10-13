// Datos de prueba: "Dilatación" (Dilatacion.mid), extraídos del archivo real.
// La autoría es real: la compuso Claude entera (@ai 100 %).
export const SONG = {
  title: "Dilatación",
  revision: 1,
  tempo: 72,
  tempoNote: "rit. to 66 in bar 51 and 58 in bar 52",
  meter: "4/4",
  key: "A minor",
  bars: 52,
  sections: [
    { id: "s1", name: "Intro", from: 1, to: 8 },
    { id: "s2", name: "Verso", from: 9, to: 16 },
    { id: "s3", name: "Precoro", from: 17, to: 20 },
    { id: "s4", name: "Verso 2", from: 21, to: 28 },
    { id: "s5", name: "Puente", from: 29, to: 36 },
    { id: "s6", name: "Coro", from: 37, to: 44 },
    { id: "s7", name: "Outro", from: 45, to: 52 },
  ],
  tracks: [
    { id: "t1", name: "Órgano", instrument: "organ", low: "E2", high: "F4", notes: 220 },
    { id: "t2", name: "Piano ostinato", instrument: "piano", low: "A2", high: "B5", notes: 477 },
    { id: "t3", name: "Melodía (cuerdas)", instrument: "strings", low: "D4", high: "C6", notes: 105 },
    { id: "t4", name: "Contramelodía (cello)", instrument: "cello", low: "A2", high: "A4", notes: 34 },
    { id: "t5", name: "Bajo (contrabajo)", instrument: "contrabass", low: "E1", high: "D2", notes: 77 },
    { id: "t6", name: "Batería", instrument: "cinematic drums (timpani)", low: "C2", high: "C#3", notes: 111 },
  ],
  harmony: ["Am","Am","F","F","C","C","Gsus4","G","Am","F","C","G","Am","F","Dm","Esus4","Dm","F","G","Esus4","Am","F","C","G","Am","F","Dm","Esus4","F","C","Dm","Am","F","G","Esus4","E","Am","F","C","G","Dm","F","Esus4","E","Am","F","C","G","Am","F","Asus2","Asus2"],
  annotations: [],
  proposals: [],
};

function harmonyRuns(h) {
  const out = []; let start = 0;
  for (let i = 1; i <= h.length; i++) {
    if (i === h.length || h[i] !== h[start]) {
      out.push(start + 1 === i ? `${start + 1} ${h[start]}` : `${start + 1}-${i} ${h[start]}`);
      start = i;
    }
  }
  return out;
}

export function overviewText(s = SONG) {
  const L = [];
  L.push(`Four Hands · r${s.revision} · "${s.title}" (TEST DATA)`);
  L.push(`Tempo ${s.tempo} (${s.tempoNote}) · ${s.meter} · ${s.key} · ${s.bars} bars`);
  L.push(`Form: ${s.sections.map((x) => `${x.name} ${x.from}-${x.to}`).join(" · ")}`);
  L.push(`Tracks:`);
  for (const t of s.tracks) L.push(`${t.id} ${t.name} · ${t.instrument} · ${t.low}–${t.high} · ${t.notes} notes · @ai 100%`);
  L.push(`Harmony (bar chord): ${harmonyRuns(s.harmony).join(" | ")}`);
  L.push(`Annotations: none · Pending proposals: none`);
  return L.join("\n");
}

export function overviewStructured(s = SONG) {
  return {
    title: s.title, revision: `r${s.revision}`, tempo: s.tempo, meter: s.meter, key: s.key, bars: s.bars,
    sections: s.sections, tracks: s.tracks.map((t) => ({ ...t, authorShare: { user: 0, ai: 100 } })),
    harmony: s.harmony.map((chord, i) => ({ bar: i + 1, chord })), annotations: [], proposals: [], testData: true,
  };
}

const norm = (x) => String(x).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

// Devuelve { ok, from, to, label } o { ok:false, error }
export function parseRange(range, s = SONG) {
  const r = norm(range);
  if (r === "selection" || r === "loop")
    return { ok: false, error: `In this test build there is no ${r} yet. Use bars ('17-24') or 'section:<name>'.` };
  if (r === "all") return { ok: true, from: 1, to: s.bars, label: "all" };
  if (r.startsWith("section:")) {
    const name = r.slice(8).trim();
    const sec = s.sections.find((x) => norm(x.name) === name) || s.sections.find((x) => norm(x.name).startsWith(name));
    if (!sec) return { ok: false, error: `There is no section "${range.slice(8).trim()}". Sections: ${s.sections.map((x) => x.name).join(", ")}.` };
    return { ok: true, from: sec.from, to: sec.to, label: `${sec.name} (${sec.from}-${sec.to})` };
  }
  const m = r.match(/^(\d+)(?:\.(\d+)(?:\+\d+\/\d+)?)?(?:\s*-\s*(\d+)(?:\.(\d+)(?:\+\d+\/\d+)?)?)?$/);
  if (!m) return { ok: false, error: `"${range}" is not a range I understand. Use '17-24', '17.3-18.2' or 'section:Coro'.` };
  const from = +m[1], to = m[3] ? +m[3] : from;
  for (const b of [from, to]) if (b < 1 || b > s.bars) return { ok: false, error: `Bar ${b} does not exist: the song has ${s.bars} bars.` };
  if (to < from) return { ok: false, error: `The range ${range} goes backwards: start with the lower bar.` };
  return { ok: true, from, to, label: range };
}

export function resolveTracks(list, s = SONG) {
  if (!list || !list.length) return { ok: true, tracks: [] };
  const found = [];
  for (const q of list) {
    const n = norm(q);
    const t = s.tracks.find((x) => x.id === n) || s.tracks.find((x) => norm(x.name) === n) || s.tracks.find((x) => norm(x.name).includes(n));
    if (!t) return { ok: false, error: `There is no track "${q}". Tracks: ${s.tracks.map((x) => `${x.id} ${x.name}`).join(", ")}.` };
    found.push(t);
  }
  return { ok: true, tracks: found };
}
