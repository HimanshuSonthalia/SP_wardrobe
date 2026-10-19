import { db, persist, log } from './db.js';
import { ingest } from './ingest.js';
import { makeSheet, prompt, applyTags } from './tagging.js';
import { generate, ranked } from './stylist.js';
import { exportAll, importAll } from './backup.js';
import { getCfg, setCfg, runAudit } from './ai.js';

const $ = s => document.querySelector(s), view = $('#view'), ICON = '<svg viewBox="0 0 48 48"><path d="M24 14a4 4 0 1 0-4-4M24 14v4L6 32a3 3 0 0 0 2 5h32a3 3 0 0 0 2-5L24 18"/></svg>';
let urls = [], filter = 'all', lookTab = 'for';
const url = b => { const u = URL.createObjectURL(b); urls.push(u); return u; };
const clean = () => { urls.forEach(URL.revokeObjectURL); urls = []; };
const setHead = (t, sub, chips) => { $('#title').textContent = t; $('#sub').textContent = sub; $('#chips').innerHTML = chips || ''; };
const chip = (k, label, cur, attr) => `<button data-${attr}="${k}" class="${cur === k ? 'on' : ''}">${label}</button>`;
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const cap = s => s[0].toUpperCase() + s.slice(1);

async function wardrobe() {
  const all = await db.items.orderBy('added').reverse().toArray(), fresh = all.filter(i => i.status === 'untagged').length;
  const cats = [...new Set(all.map(i => i.category).filter(Boolean))];
  setHead('Her Wardrobe', all.length ? `${all.length} pieces` + (fresh ? `, ${fresh} awaiting tags` : '') : 'Your collection starts here',
    all.length ? chip('all', 'All', filter, 'f') + (fresh ? chip('new', 'New', filter, 'f') : '') + (all.some(i => i.fav) ? chip('fav', 'Favourites', filter, 'f') : '') + (all.some(i => i.laundry) ? chip('laundry', 'Laundry', filter, 'f') : '') + cats.map(c => chip(c, cap(c), filter, 'f')).join('') : '');
  const items = filter === 'all' ? all : filter === 'new' ? all.filter(i => i.status === 'untagged') : filter === 'fav' ? all.filter(i => i.fav) : filter === 'laundry' ? all.filter(i => i.laundry) : all.filter(i => i.category === filter);
  if (!all.length) { view.innerHTML = `<div class="empty">${ICON}<h2>An empty closet</h2>Add photos of her clothes and they will appear here.<br><button class="btn" data-go="add">Add photos</button></div>`; return; }
  view.innerHTML = '<div class="masonry">' + items.map(i => `<figure class="tile" data-id="${i.id}"><img src="${url(i.thumb)}" alt="${esc(i.tags?.name || 'Clothing item')}" onload="this.classList.add('in')"><span class="sw" style="background:${i.color}"></span>${i.tags?.name ? '<figcaption>' + esc(i.tags.name) + '</figcaption>' : ''}${i.laundry ? '<span class="nw ld">Laundry</span>' : i.status === 'untagged' ? '<span class="nw">New</span>' : ''}</figure>`).join('') + '</div>';
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

async function autoTag(manual) {
  const cfg = await getCfg(); if (!cfg.key) return manual === true ? go('settings') : 0;
  const say = t => { const el = $('#msg'); if (el) el.textContent = t; };
  const r = await runAudit((d, n) => say(`Tagging ${d} of ${n}...`));
  say(r.done ? `Tagged ${r.done} pieces. ${r.stop}` : r.stop || 'Everything is already tagged.');
}

async function settings() {
  setHead('Settings', 'Stored only on this phone');
  const c = await getCfg();
  view.innerHTML = `<div class="card">Gemini API key<small>Free from aistudio.google.com</small><input class="fld" id="k" value="${esc(c.key)}" autocomplete="off">
    <div style="margin-top:14px">Model name<small>Change this if Google retires it</small></div><input class="fld" id="m" value="${esc(c.model)}">
    <button class="btn sm" id="sv" style="margin-top:14px">Save</button><small style="margin-top:12px">Only clothing photos are sent. Free-tier keys may let Google use submitted images to improve its products, so never send photos of her. A billing-enabled key avoids that.</small></div>`;
  $('#sv').onclick = async () => { await setCfg({ key: $('#k').value.trim(), model: $('#m').value.trim() || c.model }); go('add'); };
}

async function add() {
  setHead('Add pieces', 'Bulk upload, duplicates are skipped');
  const lb = await db.meta.get('lastBackup');
  view.innerHTML = `<label class="drop"><svg viewBox="0 0 48 48"><path d="M24 32V10M15 19l9-9 9 9M8 32v6h32v-6"/></svg><strong>Choose photos</strong><small>Select as many as you like</small><input id="file" type="file" accept="image/*" multiple></label>
    <div class="bar"><div id="prog"></div></div><p id="msg"></p>
    <button class="card" id="at">Auto-tag with Gemini<small>Uses your free key, one piece at a time</small></button><button class="card" data-go="tag">Tag with sheets<small>No key needed, paste twice per 16 pieces</small></button><button class="card" data-go="settings">Settings<small>Gemini key and model</small></button>
    <button class="card" id="bk">Back up wardrobe<small>${lb ? 'Last backup ' + new Date(lb.ts).toLocaleDateString() : 'No backup yet, make one after each big batch'}</small></button>
    <label class="card" style="cursor:pointer">Restore from backup<small>Choose a backup file</small><input id="rs" type="file" accept=".json" hidden></label>`;
  $('#file').onchange = async e => {
    const files = [...e.target.files]; if (!files.length) return;
    const r = await ingest(files, (d, n) => { $('#prog').style.width = (d / n * 100) + '%'; $('#msg').textContent = `Processing ${d} of ${n}`; });
    if (r.added) setTimeout(autoTag, 1500);
    $('#msg').textContent = `Added ${r.added}` + (r.dupes ? `, skipped ${r.dupes} already in the wardrobe` : '') + (r.failed ? `, ${r.failed} could not be read` : '') + '.';
  };
  $('#at').onclick = () => autoTag(true);
  $('#bk').onclick = async () => { $('#bk').firstChild.textContent = 'Preparing backup…'; await exportAll(); add(); };
  $('#rs').onchange = async e => { const n = await importAll(e.target.files[0]); $('#msg').textContent = `Restored ${n} pieces.`; };
}

const OPT = { category: ['top', 'bottom', 'dress', 'ethnic-set', 'outerwear', 'shoes', 'bag', 'jewellery', 'accessory'], pattern: ['solid', 'striped', 'floral', 'checked', 'printed', 'embellished'], style: ['casual', 'smart', 'party', 'ethnic', 'sporty', 'lounge'], fit: ['fitted', 'relaxed', 'structured'] };
async function openViewer(id) {
  const i = await db.items.get(id), v = $('#viewer'), t = i.tags || {}, cpw = i.price && i.wears ? Math.round(i.price / i.wears) : '-';
  const sel = (k, val) => `<select class="fld" id="f-${k}">${k === 'category' ? '<option value="">choose</option>' : ''}${OPT[k].map(o => `<option${o === val ? ' selected' : ''}>${o}</option>`).join('')}</select>`;
  const inp = (k, val, ty = 'text') => `<input class="fld" id="f-${k}" type="${ty}" value="${esc(val ?? '')}">`;
  v.innerHTML = `<div class="vimg"><img src="${url(i.img)}" alt=""></div><div class="vpanel">
    <label>Name${inp('name', t.name)}</label>
    <div class="two"><label>Category${sel('category', i.category)}</label><label>Brand${inp('brand', t.brand)}</label></div>
    <label>Colours, comma separated${inp('colors', (t.colors || []).join(', '))}</label>
    <div class="two"><label>Pattern${sel('pattern', t.pattern)}</label><label>Style${sel('style', t.style)}</label></div>
    <div class="two"><label>Fit${sel('fit', t.fit)}</label><label>Fabric${inp('fabric', t.fabric)}</label></div>
    <label>Formality, 1 casual to 5 formal<input class="fld" id="f-formality" type="range" min="1" max="5" value="${t.formality || 3}"></label>
    <div>${['spring', 'summer', 'autumn', 'winter'].map(s => `<button class="sc${(t.seasons || []).includes(s) ? ' on' : ''}" data-s="${s}">${cap(s)}</button>`).join('')}</div>
    <div class="two"><label>Price${inp('price', i.price, 'number')}</label><label>Stored in${inp('loc', i.location)}</label></div>
    <div class="stats">Worn ${i.wears || 0} times, cost per wear ${cpw}</div>
    <div class="acts"><button id="wore">Wore it today</button><button id="fav" class="${i.fav ? 'on' : ''}">${i.fav ? '&#9829;' : '&#9825;'} Favourite</button><button id="ldr" class="${i.laundry ? 'on' : ''}">${i.laundry ? 'Mark clean' : 'To laundry'}</button></div>
  </div><div class="vbar"><button id="del">Remove</button><span></span><button id="cls">Close</button><button class="close" id="sv">Save</button></div>`;
  if (!v.open) v.showModal();
  const close = () => { v.close(); go(cur); }, upd = async d => { await db.items.update(id, d); openViewer(id); };
  v.querySelectorAll('.sc').forEach(b => b.onclick = () => b.classList.toggle('on'));
  $('#cls').onclick = close;
  $('#wore').onclick = () => upd({ wears: (i.wears || 0) + 1, worn: [...(i.worn || []), new Date().toISOString().slice(0, 10)] });
  $('#fav').onclick = () => upd({ fav: !i.fav });
  $('#ldr').onclick = () => upd({ laundry: !i.laundry });
  $('#sv').onclick = async () => {
    const g = k => $('#f-' + k).value.trim();
    const tags = { name: g('name'), colors: g('colors').split(',').map(s => s.trim()).filter(Boolean), pattern: g('pattern'), fabric: g('fabric'), formality: +g('formality'), seasons: [...v.querySelectorAll('.sc.on')].map(b => b.dataset.s), style: g('style'), fit: g('fit'), brand: g('brand') || null };
    await db.items.update(id, { category: g('category'), tags, price: +g('price') || null, location: g('loc'), status: tags.name && g('category') ? 'tagged' : 'untagged' });
    close();
  };
  $('#del').onclick = async () => { if (confirm('Remove this piece from the wardrobe?')) { await db.items.delete(id); close(); } };
}

const tabs = { wardrobe, looks, add, tag, settings };
let cur = 'wardrobe';
async function go(t) {
  cur = t;
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
