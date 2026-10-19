import { db, persist } from './db.js';
import { ingest } from './ingest.js';

const $ = s => document.querySelector(s), view = $('#view');
const ICON = { hanger: '<svg viewBox="0 0 48 48"><path d="M24 14a4 4 0 1 0-4-4M24 14v4L6 32a3 3 0 0 0 2 5h32a3 3 0 0 0 2-5L24 18"/></svg>' };
let urls = [], filter = 'all';
const url = b => { const u = URL.createObjectURL(b); urls.push(u); return u; };
const clean = () => { urls.forEach(URL.revokeObjectURL); urls = []; };
const setHead = (t, sub, chips) => { $('#title').textContent = t; $('#sub').textContent = sub; $('#chips').innerHTML = chips || ''; };

async function wardrobe() {
  const all = await db.items.orderBy('added').reverse().toArray();
  const fresh = all.filter(i => i.status === 'untagged').length;
  setHead('Her Wardrobe', all.length ? `${all.length} pieces` + (fresh ? `, ${fresh} awaiting tags` : '') : 'Your collection starts here',
    all.length ? `<button data-f="all" class="${filter === 'all' ? 'on' : ''}">All</button><button data-f="new" class="${filter === 'new' ? 'on' : ''}">New</button>` : '');
  const items = filter === 'new' ? all.filter(i => i.status === 'untagged') : all;
  if (!all.length) {
    view.innerHTML = `<div class="empty">${ICON.hanger}<h2>An empty closet</h2>Add photos of her clothes and they will appear here.<br><button class="btn" data-go="add">Add photos</button></div>`;
    return;
  }
  view.innerHTML = '<div class="masonry">' + items.map(i =>
    `<figure class="tile" data-id="${i.id}"><img src="${url(i.thumb)}" alt="${i.category || 'Clothing item'}" onload="this.classList.add('in')"><span class="sw" style="background:${i.color}"></span>${i.status === 'untagged' ? '<span class="nw">New</span>' : ''}</figure>`
  ).join('') + '</div>';
}

function looks() {
  setHead('Looks', 'Outfits made from her own pieces');
  view.innerHTML = `<div class="empty"><svg viewBox="0 0 48 48"><path d="M24 8l3.6 9.2L37 20l-9.4 2.8L24 32l-3.6-9.2L11 20l9.4-2.8zM38 32l1.6 4.4L44 38l-4.4 1.6L38 44l-1.6-4.4L32 38l4.4-1.6z"/></svg><h2>Looks are on their way</h2>Once her pieces are tagged, curated outfits appear here.</div>`;
}

function add() {
  setHead('Add pieces', 'Bulk upload, duplicates are skipped');
  view.innerHTML = `<label class="drop"><svg viewBox="0 0 48 48"><path d="M24 32V10M15 19l9-9 9 9M8 32v6h32v-6"/></svg><strong>Choose photos</strong><small>Select as many as you like</small>
    <input id="file" type="file" accept="image/*" multiple></label><div class="bar"><div id="prog"></div></div><p id="msg"></p>`;
  $('#file').onchange = async e => {
    const files = [...e.target.files]; if (!files.length) return;
    const r = await ingest(files, (d, n) => { $('#prog').style.width = (d / n * 100) + '%'; $('#msg').textContent = `Processing ${d} of ${n}`; });
    $('#msg').textContent = `Added ${r.added}` + (r.dupes ? `, skipped ${r.dupes} already in the wardrobe` : '') + (r.failed ? `, ${r.failed} could not be read` : '') + '.';
  };
}

async function openViewer(id) {
  const i = await db.items.get(id), v = $('#viewer');
  v.innerHTML = `<div class="vimg"><img src="${url(i.img)}" alt=""></div><div class="vbar"><i class="sw" style="background:${i.color}"></i>
    <span>Added ${new Date(i.added).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}</span><button id="del">Remove</button><button class="close" id="cls">Done</button></div>`;
  v.showModal();
  $('#cls').onclick = () => v.close();
  $('#del').onclick = async () => { if (confirm('Remove this piece from the wardrobe?')) { await db.items.delete(id); v.close(); go('wardrobe'); } };
}

const tabs = { wardrobe, looks, add };
async function go(t) {
  clean();
  document.querySelectorAll('#nav button').forEach(b => b.classList.toggle('on', b.dataset.tab === t));
  await tabs[t]();
  scrollTo(0, 0);
}
$('#nav').onclick = e => { const b = e.target.closest('button'); b && go(b.dataset.tab); };
$('#chips').onclick = e => { if (e.target.dataset.f) { filter = e.target.dataset.f; go('wardrobe'); } };
view.onclick = e => {
  if (e.target.dataset.go) return go(e.target.dataset.go);
  const t = e.target.closest('.tile'); t && openViewer(t.dataset.id);
};

persist(); go('wardrobe');