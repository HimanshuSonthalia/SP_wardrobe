import { db, hasHash, uid, SCHEMA } from './db.js';

const toBlob = (c, q) => new Promise(r => c.toBlob(r, 'image/webp', q));

async function sha1(file) {
  const buf = await file.arrayBuffer();
  const h = await crypto.subtle.digest('SHA-1', buf);
  return [...new Uint8Array(h)].map(b => b.toString(16).padStart(2, '0')).join('');
}

async function resize(bmp, max, q) {
  const s = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * s); c.height = Math.round(bmp.height * s);
  c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
  return { blob: await toBlob(c, q), canvas: c };
}

// Average colour of the centre of the image (ignores edges/background).
function dominant(canvas) {
  const w = canvas.width, h = canvas.height, x = w * .3, y = h * .3;
  const t = document.createElement('canvas'); t.width = t.height = 8;
  const g = t.getContext('2d');
  g.drawImage(canvas, x, y, w * .4, h * .4, 0, 0, 8, 8);
  const d = g.getImageData(0, 0, 8, 8).data; let r = 0, gr = 0, b = 0;
  for (let i = 0; i < d.length; i += 4) { r += d[i]; gr += d[i + 1]; b += d[i + 2]; }
  const n = d.length / 4, hx = v => Math.round(v / n).toString(16).padStart(2, '0');
  return '#' + hx(r) + hx(gr) + hx(b);
}

export async function ingest(files, onProgress) {
  const out = { added: 0, dupes: 0, failed: 0 };
  let done = 0;
  for (const f of files) {
    try {
      const hash = await sha1(f);
      if (await hasHash(hash)) out.dupes++;
      else {
        const bmp = await createImageBitmap(f, { imageOrientation: 'from-image' });
        const main = await resize(bmp, 1024, .82);
        const thumb = await resize(bmp, 320, .7);
        bmp.close?.();
        await db.items.add({
          id: uid(), hash, img: main.blob, thumb: thumb.blob, color: dominant(main.canvas),
          category: null, tags: null, status: 'untagged', schema: SCHEMA, added: Date.now()
        });
        out.added++;
      }
    } catch (e) { console.error(e); out.failed++; }
    onProgress?.(++done, files.length);
  }
  return out;
}
