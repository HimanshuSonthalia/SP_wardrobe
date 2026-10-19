import { db } from './db.js';
const W = 300, H = 400;

// Stitch up to 16 untagged thumbnails into one numbered sheet for a single Gemini chat.
export async function makeSheet() {
  const items = await db.items.where('status').equals('untagged').limit(16).toArray();
  if (!items.length) return null;
  const C = document.createElement('canvas'); C.width = W * 4; C.height = H * Math.ceil(items.length / 4);
  const g = C.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, C.width, C.height);
  for (const [k, i] of items.entries()) {
    const b = await createImageBitmap(i.thumb), x = (k % 4) * W, y = Math.floor(k / 4) * H, s = Math.min(W / b.width, H / b.height);
    g.drawImage(b, x + (W - b.width * s) / 2, y + (H - b.height * s) / 2, b.width * s, b.height * s);
    g.strokeStyle = '#ccc'; g.strokeRect(x, y, W, H);
    g.fillStyle = '#000'; g.beginPath(); g.arc(x + 26, y + 26, 20, 0, 7); g.fill();
    g.fillStyle = '#fff'; g.font = 'bold 22px sans-serif'; g.textAlign = 'center'; g.fillText(k + 1, x + 26, y + 34);
  }
  const blob = await new Promise(r => C.toBlob(r, 'image/jpeg', .88));
  await db.meta.put({ key: 'sheet', ids: items.map(i => i.id) });
  return { blob, count: items.length };
}

export const prompt = n => `You are a fashion stylist cataloguing a wardrobe. The attached image shows ${n} numbered items (number inside the black circle). Return ONLY a JSON array with one object per item, no commentary:
{"n":1,"category":"top|bottom|dress|ethnic-set|outerwear|shoes|bag|jewellery|accessory","name":"short name e.g. Navy silk wrap blouse","colors":["up to 3 colour names"],"pattern":"solid|striped|floral|checked|printed|embellished","fabric":"best guess","formality":1-5 (1 very casual, 5 formal),"seasons":["spring","summer","autumn","winter"],"style":"casual|smart|party|ethnic|sporty|lounge","fit":"fitted|relaxed|structured","brand":null or visible brand text}`;

export async function applyTags(text) {
  const m = text.match(/\[[\s\S]*\]/); if (!m) throw new Error('No JSON list found in the reply.');
  const rows = JSON.parse(m[0]), sheet = await db.meta.get('sheet'); let n = 0;
  for (const r of rows) {
    const id = sheet?.ids[r.n - 1]; if (!id) continue;
    await saveTags(id, r);
    n++;
  }
  return n;
}

export const saveTags = (id, r) => db.items.update(id, {
  category: String(r.category || '').toLowerCase().replace('jewelry', 'jewellery'), status: 'tagged',
  tags: { name: r.name, colors: r.colors || [], pattern: r.pattern || 'solid', fabric: r.fabric, formality: +r.formality || 3,
    seasons: r.seasons || [], style: r.style || 'casual', fit: r.fit || 'relaxed', brand: r.brand || null } });
