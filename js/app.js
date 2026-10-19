import { db, persist, log } from './db.js';
import { ingest } from './ingest.js';
import { makeSheet, prompt, applyTags } from './tagging.js';
import { generate, ranked } from './stylist.js';
import { exportAll, importAll } from './backup.js';

const $ = s => document.querySelector(s), view = $('#view'), ICON = '<svg viewBox="0 0 48 48"><path d="M24 14a4 4 0 1 0-4-4M24 14v4L6 32a3 3 0 0 0 2 5h32a3 3 0 0 0 2-5L24 18"/></svg>';
let urls = [], filter = 'all', lookTab = 'for';
const url = b => { const u = URL.createObjectURL(b); urls.push(u); return u; };
const clean = () => { urls.forEach(URL.revokeObjectURL); urls = []; };
const setHead = (t, sub, chips) => { $('#title').textContent = t; $('#sub').textContent = sub; $('#chips').innerHTML = chips || ''; };
const chip = (k, label, cur, attr) => `<button data-${attr}="${k}" class="${cur === k ? 'on' : ''}">${label}</button>`;
const cap = s => s[0].toUpperCase() + s.slice(1);

async function wardrobe() {
  const all = await db.items.orderBy('added').reverse().toArray(), fresh = all.filter(i => i.status === 'untagged').length;
  const cats = [...new Set(all.map(i => i.category).filter(Boolean))];
  setHead('Her Wardrobe', all.length ? `${all.length} pieces` + (fresh ? `, ${fresh} awaiting tags` : '') : 'Your collection starts here',
    all.length ? chip('all', 'All', filter, 'f') + (fresh ? chip('new', 'New', filter, 'f') : '') + cats.map(c => chip(c, cap(c), filter, 'f')).join('') : '');
  const items = filter === 'all' ? all : filter === 'new' ? all.filter(i => i.status === 'untagged') : all.filter(i => i.category === filter);
  if (!all.length) { view.innerHTML = `<div class="empty">${ICON}<h2>An empty closet</h2>Add photos of her clothes and they will appear here.<br><button class="btn" data-go="add">Add photos</button></div>`; return; }
  view.innerHTML = '<div class="masonry">' + items.map(i => `<figure class="tile" data-id="${i.id}"><img src="${url(i.thumb)}" alt="${i.tags?.name || 'Clothing item'}" onload="this.classList.add('in')"><span class="sw" style="background:${i.color}"></span>${i.status === 'untagged' ? '<span class="nw">New</span>' : ''}</figure>`).join('') + '</div>';
}

async function looks() {
  const tagged = await db.items.where('status').equals('tagged').count();
  setHead('Looks', 'Outfits made from her own pieces', chip('for', 'For her', lookTab, 'l') + chip('saved', 'Saved', lookTab, 'l'));
  if (tagged < 4) { view.innerHTML = `<div class="empty">${ICON}<h2>Tag a few pieces first</h2>Looks appear once at least a top and bottom, or a dress, are tagged.<br><button class="btn" data-go="tag">Tag pieces</button></div>`; return; }
  let ls = await ranked(lookTab === 'saved');
  if (!ls.length && lookTab === 'for') { await generate(); ls = await ranked(); }
  if (!ls.length) { view.innerHTML = `<div class="empty"><h2>Nothing saved yet</h2>Tap the heart on a look you love.</div>`; return; }
  const ids = [...new Set(ls.slice(0, 30).flatMap(l => l.items))], map = new Map((await db.items.bulkGet(ids)).filter(Boolean).map(i => [i.id, i]));
  view.innerHTML = ls.slice(0, 30).map(l => `<article class="look" data-look="${l.id}"><div class="strip" data-act="view">${l.items.map(i => map.get(i)).filter(Boolean).map(i => `<img src="${url(i.thumb)}" alt="${i.tags?.name || ''}">`).join('')}</div>
    <div class="lf"><b>${l.occasion}</b><button data-act="skip" aria-label="Not for me">&times;</button><button data-act="save" class="${l.saved ? 'on' : ''}" aria-label="Save">&#9825;</button></div></article>`).join('')
    + `<div class="empty"><button class="btn ghost" data-act="refresh">Create fresh looks</button></div>`;
}

async function tag() {
  setHead('Tag pieces', 'Gemini does the describing, you paste twice');
  const n = await db.items.where('status').equals('untagged').count();
  if (!n) { view.innerHTML = `<div class="empty">${ICON}<h2>All tagged</h2>Every piece is described. Add more photos any time.</div>`; return; }
  let cnt = Math.min(16, n);
  view.innerHTML = `<ol class="steps"><li>Make a numbered sheet of the next ${cnt} pieces.<br><button class="btn sm" id="mk">Make sheet</button><div id="sh"></div></li>
    <li>Open Gemini, attach the sheet (press and hold it to save), then paste this prompt.<br><button class="btn sm" id="cp">Copy prompt</button></li>
    <li>Paste Gemini's reply here.<textarea id="rep" placeholder="[ { &quot;n&quot;: 1, ... } ]"></textarea><button class="btn sm" id="ap">Apply tags</button></li></ol><p id="msg" style="text-align:center;color:var(--mute)"></p>`;
  $('#mk').onclick = async () => { const s = await makeSheet(); cnt = s.count; const u = url(s.blob); $('#sh').innerHTML = `<img src="${u}" alt="Sheet"><a class="btn sm ghost" style="display:inline-block;text-decoration:none" href="${u}" download="sheet.jpg">Download</a>`; };
  $('#cp').onclick = async () => { await navigator.clipboard.writeText(prompt(cnt)); $('#cp').textContent = 'Copied'; };
  $('#ap').onclick = async () => { try { const k = await applyTags($('#rep').value); $('#msg').textContent = `Tagged ${k} pieces.`; setTimeout(tag, 900); } catch (e) { $('#msg').textContent = 'Could not read that reply: ' + e.message; } };
}

async function add() {
  setHead('Add pieces', 'Bulk upload, duplicates are skipped');
  const lb = await db.meta.get('lastBackup');
  view.innerHTML = `<label class="drop"><svg viewBox="0 0 48 48"><path d="M24 32V10M15 19l9-9 9 9M8 32v6h32v-6"/></svg><strong>Choose photos</strong><small>Select as many as you like</small><input id="file" type="file" accept="image/*" multiple></label>
    <div class="bar"><div id="prog"></div></div><p id="msg"></p>
    <button class="card" data-go="tag">Tag new pieces<small>Describe them with Gemini</small></button>
    <button class="card" id="bk">Back up wardrobe<small>${lb ? 'Last backup ' + new Date(lb.ts).toLocaleDateString() : 'No backup yet, make one after each big batch'}</small></button>
    <label class="card" style="cursor:pointer">Restore from backup<small>Choose a backup file</small><input id="rs" type="file" accept=".json" hidden></label>`;
  $('#file').onchange = async e => {
    const files = [...e.target.files]; if (!files.length) return;
    const r = await ingest(files, (d, n) => { $('#prog').style.width = (d / n * 100) + '%'; $('#msg').textContent = `Processing ${d} of ${n}`; });
    $('#msg').textContent = `Added ${r.added}` + (r.dupes ? `, skipped ${r.dupes} already in the wardrobe` : '') + (r.failed ? `, ${r.failed} could not be read` : '') + '.';
  };
  $('#bk').onclick = async () => { $('#bk').firstChild.textContent = 'Preparing backup…'; await exportAll(); add(); };
  $('#rs').onchange = async e => { const n = await importAll(e.target.files[0]); $('#msg').textContent = `Restored ${n} pieces.`; };
}

async function openViewer(id) {
  const i = await db.items.get(id), v = $('#viewer'), t = i.tags;
  v.innerHTML = `<div class="vimg"><img src="${url(i.img)}" alt=""></div><div class="vbar"><i class="sw" style="background:${i.color}"></i>
    <span>${t ? t.name + (t.brand ? ', ' + t.brand : '') : 'Added ' + new Date(i.added).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}</span><button id="del">Remove</button><button class="close" id="cls">Done</button></div>`;
  v.showModal(); $('#cls').onclick = () => v.close();
  $('#del').onclick = async () => { if (confirm('Remove this piece from the wardrobe?')) { await db.items.delete(id); v.close(); go('wardrobe'); } };
}

const tabs = { wardrobe, looks, add, tag };
async function go(t) {
  clean();
  document.querySelectorAll('#nav button').forEach(b => b.classList.toggle('on', b.dataset.tab === t));
  await tabs[t](); scrollTo(0, 0);
}
$('#nav').onclick = e => { const b = e.target.closest('button'); b && go(b.dataset.tab); };
$('#chips').onclick = e => { const d = e.target.dataset; if (d.f) { filter = d.f; go('wardrobe'); } if (d.l) { lookTab = d.l; go('looks'); } };
view.onclick = async e => {
  if (e.target.dataset.go) return go(e.target.dataset.go);
  const t = e.target.closest('.tile'); if (t) return openViewer(t.dataset.id);
  const b = e.target.closest('[data-act]'); if (!b) return;
  if (b.dataset.act === 'refresh') { await generate(); return go('looks'); }
  const card = b.closest('.look'), id = card.dataset.look, l = await db.looks.get(id);
  if (b.dataset.act === 'view') log('view', id);
  if (b.dataset.act === 'save') { await db.looks.update(id, { saved: !l.saved }); log(l.saved ? 'skip' : 'save', id); b.classList.toggle('on'); }
  if (b.dataset.act === 'skip') { await db.looks.update(id, { hidden: 1 }); log('skip', id); card.remove(); }
};

if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
persist(); go('wardrobe');
