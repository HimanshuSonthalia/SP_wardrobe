// Single source of truth. Every item is processed once; hash prevents re-processing.
export const SCHEMA = 1;
export const db = new Dexie('wardrobe');
db.version(1).stores({
  items: 'id,hash,category,status,added',   // status: untagged | tagged
  looks: 'id,occasion,created',
  events: '++id,type,ref,ts',               // views/likes/saves -> powers "improves over time"
  meta: 'key'
});
export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
export const persist = async () => { try { return await navigator.storage?.persist?.(); } catch { return false; } };
export const hasHash = async h => !!(await db.items.where('hash').equals(h).first());
export const log = (type, ref) => db.events.add({ type, ref, ts: Date.now() });
