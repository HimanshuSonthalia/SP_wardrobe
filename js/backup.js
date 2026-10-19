import { db, hasHash } from './db.js';
const b2d = b => new Promise(r => { const f = new FileReader(); f.onload = () => r(f.result); f.readAsDataURL(b); });
const d2b = async d => (await fetch(d)).blob();

export async function exportAll() {
  const items = [];
  for (const i of await db.items.toArray()) items.push({ ...i, img: await b2d(i.img), thumb: await b2d(i.thumb) });
  const data = JSON.stringify({ v: 1, items, looks: await db.looks.toArray(), events: await db.events.toArray() });
  const file = new File([data], 'wardrobe-backup-' + new Date().toISOString().slice(0, 10) + '.json', { type: 'application/json' });
  await db.meta.put({ key: 'lastBackup', ts: Date.now() });
  if (navigator.canShare?.({ files: [file] })) { try { await navigator.share({ files: [file] }); return; } catch (e) { if (e.name === 'AbortError') return; } }
  const a = document.createElement('a'); a.href = URL.createObjectURL(file); a.download = file.name; a.click();
}

export async function importAll(file) {
  const d = JSON.parse(await file.text()); let n = 0;
  for (const i of d.items) if (!(await hasHash(i.hash))) { await db.items.put({ ...i, img: await d2b(i.img), thumb: await d2b(i.thumb) }); n++; }
  await db.looks.bulkPut(d.looks || []);
  for (const e of d.events || []) { delete e.id; await db.events.add(e); }
  return n;
}
