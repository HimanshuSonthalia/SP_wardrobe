import { db } from './db.js';
import { saveTags } from './tagging.js';

const P = `Catalogue this single clothing or accessory photo for a personal stylist app. Return ONLY JSON: {"category":"top|bottom|dress|ethnic-set|outerwear|shoes|bag|jewellery|accessory","name":"short descriptive name e.g. Navy silk wrap blouse","colors":["up to 3 colour names"],"pattern":"solid|striped|floral|checked|printed|embellished","fabric":"best guess","formality":1-5,"seasons":["spring","summer","autumn","winter"],"style":"casual|smart|party|ethnic|sporty|lounge","fit":"fitted|relaxed|structured","brand":"only if a label or logo is clearly visible, else null"}`;
export const getCfg = async () => (await db.meta.get('cfg')) || { key: '', model: 'gemini-flash-lite-latest' };
export const setCfg = c => db.meta.put({ key: 'cfg', ...c });
const b64 = b => new Promise(r => { const f = new FileReader(); f.onload = () => r(f.result.split(',')[1]); f.readAsDataURL(b); });
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function tagOne(item, cfg) {
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${cfg.model}:generateContent`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': cfg.key },
    body: JSON.stringify({ contents: [{ parts: [{ text: P }, { inline_data: { mime_type: 'image/webp', data: await b64(item.img) } }] }], generationConfig: { responseMimeType: 'application/json', temperature: .2 } })
  });
  if (!res.ok) { const e = new Error('api'); e.status = res.status; throw e; }
  const j = await res.json();
  return JSON.parse(j.candidates[0].content.parts[0].text.replace(/```json|```/g, ''));
}

let running = false;
// Tags every untagged piece once, ~13 per minute. Progress is saved per item, so it can stop and resume any time.
export async function runAudit(onTick) {
  if (running) return { done: 0, stop: 'Already running.' };
  const cfg = await getCfg(); if (!cfg.key) return { done: 0, stop: 'Add your Gemini key in Settings.' };
  running = true; let done = 0, stop = '';
  try {
    const items = await db.items.where('status').equals('untagged').toArray();
    for (const it of items) {
      let r;
      for (let a = 0; a < 2 && !r; a++) {
        try { r = await tagOne(it, cfg); }
        catch (e) {
          if (e.status === 429 && !a) { await sleep(25000); continue; }
          stop = e.status === 429 ? 'Limit reached for now. Progress is saved, run it again later.' : [400, 401, 403, 404].includes(e.status) ? 'Check the key and model name in Settings.' : 'Could not reach Gemini. Progress is saved.';
          break;
        }
      }
      if (!r) break;
      await saveTags(it.id, r); onTick?.(++done, items.length); await sleep(4500);
    }
  } finally { running = false; }
  return { done, stop };
}
