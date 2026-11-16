// Checkpoints of your own village: the whole state of the world at some tick, kept in IndexedDB (too big for localStorage), so that loading a big saved village
// does not have to replay its whole history (a long history takes a minute). The history stays the truth: a checkpoint is only a shortcut, used when it provably
// belongs to the saved history, and thrown away when anything differs (another build, another site, a history that does not start with the same commands).

export interface CheckpointMeta {
  /** The core's rules fingerprint and the sync protocol it was written by: a checkpoint of other rules would play on differently. */
  rules: string; v: number;
  site: number;
  /** The epoch of the history it belongs to (how many times the village was restarted; absent = 0). A restart starts a new history: nothing of an older epoch may stand in for it. */
  epoch?: number;
  /** How many commands of the saved history the world had applied, and the text of the last of them (to be sure it is the same history). */
  cmds: number; lastCmd: string;
  tick: number; savedAt: number;
  /** The core's state hash of the world when the checkpoint was taken (as text: it is a 64-bit number). It must come out again after restoring, or the bytes are not trusted. */
  hash: string;
  /** A checksum of the bytes themselves: the state hash only covers what the rules read, so a damaged byte in display data would slip past it. */
  sum: number;
}
export interface Checkpoint { meta: CheckpointMeta; bytes: Uint8Array }

/** FNV-1a over the bytes. */
export function checksum(b: Uint8Array): number { let h = 0x811c9dc5; for (let i = 0; i < b.length; i++) { h ^= b[i]; h = Math.imul(h, 0x01000193); } return h >>> 0; }

/** Can this checkpoint stand in for replaying the first `cmds` commands of this history? */
export function checkpointFits(cp: Checkpoint | null | undefined, now: { rules: string; v: number; site: number; epoch?: number }, history: readonly { cmd: string; tick: number }[]): boolean {
  if (!cp || !cp.bytes?.length) return false;
  const m = cp.meta;
  if (m.rules !== now.rules || m.v !== now.v || m.site !== now.site || (m.epoch ?? 0) !== (now.epoch ?? 0)) return false;
  if (!Number.isInteger(m.cmds) || m.cmds < 1 || m.cmds > history.length) return false;
  const last = history[m.cmds - 1];
  return last.cmd === m.lastCmd && m.tick >= last.tick;   // (the world cannot be earlier than the last command it applied)
}

/** The world a checkpoint holds, or null when it cannot be trusted (it belongs to another history, rules or site, the bytes do not restore, or the restored world's hash is not the recorded one). Never throws:
 *  the caller falls back to replaying the whole history. */
export function resumeFromCheckpoint<W extends { state_hash(): bigint; free(): void }>(cp: Checkpoint | null | undefined, now: { rules: string; v: number; site: number; epoch?: number }, history: readonly { cmd: string; tick: number }[], restore: (bytes: Uint8Array) => W | undefined | null): W | null {
  if (!checkpointFits(cp, now, history)) return null;
  try {
    if (checksum(cp!.bytes) !== cp!.meta.sum) return null;
    const w = restore(cp!.bytes);
    if (!w) return null;
    if (String(w.state_hash()) !== cp!.meta.hash) { w.free(); return null; }
    return w;
  } catch { return null; }
}

const DB = 'flanders', STORE = 'checkpoints';
function open(): Promise<IDBDatabase> {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => { r.result.createObjectStore(STORE); };
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  });
}

export async function loadCheckpoint(key: string): Promise<Checkpoint | null> {
  try {
    const db = await open();
    return await new Promise(res => { const q = db.transaction(STORE).objectStore(STORE).get(key); q.onsuccess = () => res((q.result as Checkpoint) ?? null); q.onerror = () => res(null); });
  } catch { return null; }
}

export async function saveCheckpoint(key: string, cp: Checkpoint): Promise<void> {
  try {
    const db = await open();
    await new Promise<void>(res => { const t = db.transaction(STORE, 'readwrite'); t.objectStore(STORE).put(cp, key); t.oncomplete = () => res(); t.onerror = () => res(); t.onabort = () => res(); });
  } catch { /* private mode or storage full: the history alone still loads, only slower */ }
}

export async function deleteCheckpoint(key: string): Promise<void> {
  try { const db = await open(); await new Promise<void>(res => { const t = db.transaction(STORE, 'readwrite'); t.objectStore(STORE).delete(key); t.oncomplete = () => res(); t.onerror = () => res(); }); } catch { /* ignore */ }
}

/** Things the game keeps next to its checkpoints under their own keys (the village archived by a restart: see restart.ts). Plain data, copied by IndexedDB. */
export async function saveKept(key: string, value: unknown): Promise<boolean> {
  try {
    const db = await open();
    return await new Promise<boolean>(res => { const t = db.transaction(STORE, 'readwrite'); t.objectStore(STORE).put(value, key); t.oncomplete = () => res(true); t.onerror = () => res(false); t.onabort = () => res(false); });
  } catch { return false; }
}
export async function loadKept(key: string): Promise<unknown> {
  try {
    const db = await open();
    return await new Promise(res => { const q = db.transaction(STORE).objectStore(STORE).get(key); q.onsuccess = () => res(q.result ?? null); q.onerror = () => res(null); });
  } catch { return null; }
}
export const deleteKept = deleteCheckpoint;
