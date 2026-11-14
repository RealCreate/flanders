// Backup and restore. Everything about your village lives in this browser (your signing key and the signed history of what you built), so clearing site data,
// switching browser or a new computer loses it. A backup is one JSON file with those two things plus your name and banner; restoring puts them back.
//
// A backup file holds your PRIVATE signing key: whoever has it can play as you. The export says so. The import treats the file as untrusted: only known keys are
// accepted, sizes are limited, the key must be a real Ed25519 key whose public half matches, and the saved history is re-checked command by command when the game loads it.

const FORMAT = 'flanders-backup';
const ALLOWED = /^flanders:(identity(:[A-Za-z0-9_-]{1,32})?|save:v\d{1,3}:[^:\s]{1,64}(:[A-Za-z0-9_-]{1,32})?|name|flag)$/;
const MAX_TOTAL = 24 * 1024 * 1024;
const KEY = /^[A-Za-z0-9+/_=-]{20,100}$/;

export interface BackupFile { format: typeof FORMAT; version: 1; created: string; items: Record<string, string> }

/** Collect what a backup holds from local storage. */
export function collectBackup(storage: Storage = localStorage, now = new Date()): BackupFile {
  const items: Record<string, string> = {};
  for (let i = 0; i < storage.length; i++) { const k = storage.key(i)!; if (ALLOWED.test(k)) { const v = storage.getItem(k); if (v !== null) items[k] = v; } }
  return { format: FORMAT, version: 1, created: now.toISOString(), items };
}

/** Check a parsed backup. Returns the items to restore, or throws an Error with a message fit to show the player. */
export async function checkBackup(raw: unknown): Promise<Record<string, string>> {
  const f = raw as Partial<BackupFile> | null;
  if (!f || typeof f !== 'object' || f.format !== FORMAT || f.version !== 1 || typeof f.items !== 'object' || f.items === null) throw new Error('This is not a Flanders backup file.');
  const out: Record<string, string> = {}; let total = 0;
  for (const [k, v] of Object.entries(f.items)) {
    if (!ALLOWED.test(k) || typeof v !== 'string') throw new Error(`The backup holds something unexpected (${k.slice(0, 40)}). Nothing was restored.`);
    total += k.length + v.length; if (total > MAX_TOTAL) throw new Error('The backup file is too large.');
    if (k.startsWith('flanders:identity')) await checkIdentity(v);
    else if (k.startsWith('flanders:save:')) checkSave(v);
    out[k] = v;
  }
  if (!Object.keys(out).length) throw new Error('The backup is empty.');
  return out;
}

const fromB64url = (s: string) => { const t = s.replace(/-/g, '+').replace(/_/g, '/'); return Uint8Array.from(atob(t + '='.repeat((4 - t.length % 4) % 4)), c => c.charCodeAt(0)); };
const toB64 = (a: Uint8Array) => { let s = ''; for (const b of a) s += String.fromCharCode(b); return btoa(s); };

async function checkIdentity(v: string) {
  let o: { priv?: JsonWebKey; pub?: unknown };
  try { o = JSON.parse(v); } catch { throw new Error('The signing key in the backup is damaged.'); }
  const jwk = o.priv;
  if (!jwk || jwk.kty !== 'OKP' || jwk.crv !== 'Ed25519' || typeof jwk.d !== 'string' || typeof jwk.x !== 'string' || typeof o.pub !== 'string' || !KEY.test(o.pub)) throw new Error('The signing key in the backup is not valid.');
  try { await crypto.subtle.importKey('jwk', jwk, 'Ed25519', false, ['sign']); } catch { throw new Error('The signing key in the backup could not be read by this browser.'); }
  if (toB64(fromB64url(jwk.x)) !== o.pub) throw new Error('The signing key in the backup does not match its public key.');
}

function checkSave(v: string) {
  let o: { log?: unknown; site?: unknown; tick?: unknown };
  try { o = JSON.parse(v); } catch { throw new Error('A saved village in the backup is damaged.'); }
  if (!o || !Array.isArray(o.log) || o.log.length > 60000 || o.log.some(e => !e || typeof e.cmd !== 'string' || typeof e.sig !== 'string' || e.cmd.length > 65536 || e.sig.length > 200)) throw new Error('A saved village in the backup is not valid.');
  if (typeof o.site !== 'number' || !Number.isInteger(o.site) || o.site < 0 || o.site > 4096 || typeof o.tick !== 'number' || !Number.isFinite(o.tick)) throw new Error('A saved village in the backup is not valid.');
}

/** Offer the backup as a file download. */
export function downloadBackup() {
  const file = collectBackup();
  const blob = new Blob([JSON.stringify(file)], { type: 'application/json' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `flanders-backup-${file.created.slice(0, 10)}.json`;
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 10000);
  return Object.keys(file.items).length;
}

/** Read a chosen file, check it, and (after the caller's confirmation) write it to local storage. Resolves to the number of items restored. */
export async function restoreBackup(file: File, confirmOverwrite: (n: number) => boolean): Promise<number> {
  if (file.size > MAX_TOTAL) throw new Error('The backup file is too large.');
  let raw: unknown; try { raw = JSON.parse(await file.text()); } catch { throw new Error('This file is not a Flanders backup.'); }
  const items = await checkBackup(raw);
  if (!confirmOverwrite(Object.keys(items).length)) return 0;
  for (const [k, v] of Object.entries(items)) localStorage.setItem(k, v);
  return Object.keys(items).length;
}
