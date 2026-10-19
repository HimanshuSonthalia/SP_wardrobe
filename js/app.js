import { db, persist } from './db.js';
import { ingest } from './ingest.js';

const $ = s => document.querySelector(s), view = $('#view');
let urls = [];
const url = b => { const u = URL.createObjectURL(b); urls.push(u); return u; };
const clean = () => { urls.forEach(URL.revokeObjectURL); urls = []; };

async function updateCount() {
  const n = await db.items.count();
  $('#count').textContent = n ? n + ' pieces' : '';
}

async function wardrobe() {
  const items = await db.items.orderBy('added').reverse().toArray();
  if (!items.length) {
    view.innerHTML = `<div class="empty"><h2>Nothing here yet</h2>Add photos of her clothes to start the collection.<br><button class="btn" data-go="add">Add photos</button></div>`;
    return;
  }
  view.innerHTML = '<div class="grid">' + items.map(i =>
    `<div class="tile"><img loading="lazy" src="${url(i.thumb)}" alt="${i.category || 'clothing item'}"><i style="background:${i.color}"></i>${i.status === 'untagged' ? '<b>new</b>' : ''}</div>`
  ).join('') + '</div>';
}

function looks() {
  view.innerHTML = `<div class="empty"><h2>Looks are coming</h2>Once pieces are tagged, outfit combinations will appear here.</div>`;
}

function add() {
  view.innerHTML = `<label class="drop">Choose photos<small>Select as many as you like. Duplicates are skipped automatically.</small>
    <input id="file" type="file" accept="image/*" multiple></label>
    <div class="bar"><div id="prog"></div></div><p id="msg"></p>`;
  $('#file').onchange = async e => {
    const files = [...e.target.files]; if (!files.length) return;
    const r = await ingest(files, (d, n) => {
      $('#prog').style.width = (d / n * 100) + '%';
      $('#msg').textContent = `Processing ${d} of ${n}`;
    });
    $('#msg').textContent = `Added ${r.added}` + (r.dupes ? `, skipped ${r.dupes} already in the wardrobe` : '') + (r.failed ? `, ${r.failed} could not be read` : '') + '.';
    updateCount();
  };
}

const tabs = { wardrobe, looks, add };
async function go(t) {
  clean();
  document.querySelectorAll('nav button').forEach(b => b.classList.toggle('on', b.dataset.tab === t));
  await tabs[t]();
}
document.querySelector('nav').onclick = e => e.target.dataset.tab && go(e.target.dataset.tab);
view.onclick = e => e.target.dataset.go && go(e.target.dataset.go);

persist(); updateCount(); go('wardrobe');
