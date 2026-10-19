import { db } from './db.js';

function hsl(hex) {
  const r = parseInt(hex.slice(1, 3), 16) / 255, g = parseInt(hex.slice(3, 5), 16) / 255, b = parseInt(hex.slice(5, 7), 16) / 255;
  const M = Math.max(r, g, b), m = Math.min(r, g, b), l = (M + m) / 2, d = M - m; let h = 0, s = 0;
  if (d) { s = d / (1 - Math.abs(2 * l - 1)); h = M === r ? ((g - b) / d) % 6 : M === g ? (b - r) / d + 2 : (r - g) / d + 4; h = (h * 60 + 360) % 360; }
  return { h, s, l };
}
const neutral = c => c.s < .18 || c.l < .14 || c.l > .88;
function harmony(a, b) {
  const A = hsl(a.color), B = hsl(b.color); if (neutral(A) || neutral(B)) return 1;
  const d = Math.abs(A.h - B.h), x = Math.min(d, 360 - d);
  return x < 35 ? .9 : x > 150 ? .7 : x > 90 ? -.5 : .1;
}
const pick = a => a[Math.floor(Math.random() * a.length)];

function score(its) {
  let s = 0, p = 0; const core = its.slice(0, 3);
  for (let i = 0; i < its.length; i++) for (let j = i + 1; j < its.length; j++) s += harmony(its[i], its[j]) / (its.length - 1);
  const f = its.map(i => i.tags.formality), spread = Math.max(...f) - Math.min(...f);
  s -= spread > 1 ? spread * .6 : 0;
  if (!its.every(i => !i.tags.seasons.length || i.tags.seasons.some(x => its[0].tags.seasons.includes(x) || !its[0].tags.seasons.length))) s -= 1;
  p = its.filter(i => i.tags.pattern !== 'solid').length; s -= p > 1 ? (p - 1) * 1.2 : 0;
  const fits = core.map(i => i.tags.fit); if (fits.includes('fitted') && fits.includes('relaxed')) s += .3; if (fits.filter(x => x === 'relaxed').length > 1) s -= .3;
  return s;
}
function occasion(its) {
  const f = its.reduce((a, i) => a + i.tags.formality, 0) / its.length;
  if (its.some(i => i.tags.style === 'ethnic')) return 'Festive';
  return f >= 4 ? 'Evening' : f >= 3 ? 'Smart' : f >= 2 ? 'Everyday' : 'Relaxed';
}

export async function generate() {
  const all = await db.items.where('status').equals('tagged').toArray(), by = c => all.filter(i => c.includes(i.category));
  const G = { dress: by(['dress', 'ethnic-set']), top: by(['top']), bottom: by(['bottom']), out: by(['outerwear']), shoes: by(['shoes']), bag: by(['bag']), jew: by(['jewellery']) };
  const seen = new Map();
  for (let n = 0; n < 2500; n++) {
    const useDress = G.dress.length && (!G.top.length || !G.bottom.length || Math.random() < .4);
    if (!useDress && !(G.top.length && G.bottom.length)) break;
    const its = useDress ? [pick(G.dress)] : [pick(G.top), pick(G.bottom)];
    if (G.out.length && Math.random() < .3) its.push(pick(G.out));
    if (G.shoes.length) its.push(pick(G.shoes));
    if (G.bag.length && Math.random() < .6) its.push(pick(G.bag));
    if (G.jew.length && Math.random() < .6) its.push(pick(G.jew));
    const ids = its.map(i => i.id).sort().join('-');
    if (!seen.has(ids)) seen.set(ids, { id: ids, items: its.map(i => i.id), occasion: occasion(its), score: score(its), created: Date.now() });
  }
  const use = new Map(), keep = [];
  for (const l of [...seen.values()].sort((a, b) => b.score - a.score)) {
    if (l.items.every(i => (use.get(i) || 0) < 4)) { l.items.forEach(i => use.set(i, (use.get(i) || 0) + 1)); keep.push(l); }
    if (keep.length >= 60) break;
  }
  const old = await db.looks.toArray(), saved = new Set(old.filter(l => l.saved).map(l => l.id));
  await db.looks.bulkDelete(old.filter(l => !l.saved).map(l => l.id));
  await db.looks.bulkPut(keep.filter(l => !saved.has(l.id)));
  return keep.length;
}

// Ranking learns from what she saves, skips and opens.
export async function ranked(savedOnly) {
  const [ls, ev] = await Promise.all([db.looks.toArray(), db.events.toArray()]);
  const byId = new Map(ls.map(l => [l.id, l])), w = {}, W = { save: 1, skip: -1, view: .1 };
  for (const e of ev) { const l = byId.get(e.ref); if (l && W[e.type]) l.items.forEach(i => w[i] = (w[i] || 0) + W[e.type]); }
  const pref = l => l.items.reduce((a, i) => a + (w[i] || 0), 0) / l.items.length;
  return ls.filter(l => !l.hidden && (!savedOnly || l.saved)).sort((a, b) => (b.score + pref(b) * .5) - (a.score + pref(a) * .5));
}
