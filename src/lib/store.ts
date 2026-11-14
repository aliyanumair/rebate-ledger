import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

export type StoredFileRole = 'agreement' | 'purchases' | 'credits';
export type StoredFileRef = { role: StoredFileRole; originalName: string; mimeType: string; size: number };
export type IntakeRecord = {
  id: string; createdAt: string; company: string; name: string; email: string; supplier: string;
  pdfName: string; csvName: string; files?: StoredFileRef[]; status: 'queued' | 'reviewing' | 'complete';
};
export type DraftRecord = {
  id: string; createdAt: string; owner: string; supplier: string; status: 'verified-draft' | 'reconciled';
  files: StoredFileRef[]; columnMap: Record<string, string>; rules: unknown;
  result?: import('./reconciliation').ReconciliationResult;
  statement?: import('./reconciliation').CreditStatementReconciliation;
};

const localDataDir = () => process.env.REBATE_DATA_DIR || path.join(process.cwd(), 'data', 'runtime');
const onNetlify = () => process.env.NETLIFY === 'true';
const namespace = () => process.env.CONTEXT === 'production' ? 'production' : 'nonproduction';
const storeName = 'rebate-ledger-v1';

async function blobs() {
  if (!onNetlify()) return null;
  try {
    const { getStore } = await import('@netlify/blobs');
    return getStore(storeName, { consistency: 'strong' });
  } catch (error) {
    throw new Error(`Netlify Blobs is unavailable in this function runtime: ${error instanceof Error ? error.message : 'unknown error'}`);
  }
}
function objectKey(collection: string, id: string, name = 'record.json') { return `${namespace()}/${collection}/${id}/${name}`; }
function assertSafeKeyPart(value: string) { if (!/^[a-zA-Z0-9_-]{1,100}$/.test(value)) throw new Error('Invalid storage key.'); }

async function putJson(collection: string, id: string, value: unknown) {
  assertSafeKeyPart(collection); assertSafeKeyPart(id);
  const store = await blobs();
  const key = objectKey(collection, id);
  if (store) { await store.setJSON(key, value); return; }
  const file = path.join(localDataDir(), collection, id, 'record.json');
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(value), 'utf8');
}
async function getJson<T>(collection: string, id: string): Promise<T | null> {
  assertSafeKeyPart(collection); assertSafeKeyPart(id);
  const store = await blobs();
  if (store) {
    const value = await store.get(objectKey(collection, id), { type: 'json' }) as T | null;
    return value;
  }
  try { return JSON.parse(await readFile(path.join(localDataDir(), collection, id, 'record.json'), 'utf8')) as T; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error; }
}
async function listJson<T>(collection: string): Promise<T[]> {
  assertSafeKeyPart(collection);
  const store = await blobs();
  if (store) {
    const prefix = `${namespace()}/${collection}/`;
    const result = await store.list({ prefix });
    const records: T[] = [];
    for (const blob of result.blobs) if (blob.key.endsWith('/record.json')) {
      const record = await store.get(blob.key, { type: 'json' }) as T | null;
      if (record) records.push(record);
    }
    return records;
  }
  const dir = path.join(localDataDir(), collection);
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    const records = await Promise.all(entries.filter(entry => entry.isDirectory()).map(entry => getJson<T>(collection, entry.name)));
    return records.filter(record => record !== null) as T[];
  } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error; }
}

export async function putStoredFile(collection: 'intakes' | 'drafts', id: string, role: StoredFileRole, bytes: Uint8Array) {
  assertSafeKeyPart(id);
  const store = await blobs();
  const name = `${role}.bin`;
  if (store) { await store.set(objectKey(collection, id, name), new Blob([Uint8Array.from(bytes)])); return; }
  const file = path.join(localDataDir(), collection, id, name);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, bytes);
}
export async function getStoredFile(collection: 'intakes' | 'drafts', id: string, role: StoredFileRole): Promise<Buffer | null> {
  assertSafeKeyPart(id);
  const store = await blobs();
  if (store) {
    const value = await store.get(objectKey(collection, id, `${role}.bin`), { type: 'arrayBuffer' }) as ArrayBuffer | null;
    return value ? Buffer.from(value) : null;
  }
  try { return await readFile(path.join(localDataDir(), collection, id, `${role}.bin`)); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error; }
}

export async function listIntakes() { return (await listJson<IntakeRecord>('intakes')).sort((a, b) => b.createdAt.localeCompare(a.createdAt)); }
export async function getIntake(id: string) { return getJson<IntakeRecord>('intakes', id); }
export async function addIntake(item: IntakeRecord) { await putJson('intakes', item.id, item); return item; }
export async function listDrafts(owner?: string) {
  const records = await listJson<DraftRecord>('drafts');
  return records.filter(item => !owner || item.owner === owner).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
export async function getDraft(id: string) { return getJson<DraftRecord>('drafts', id); }
export async function addDraft(item: DraftRecord) { await putJson('drafts', item.id, item); return item; }
export async function updateDraft(item: DraftRecord) { await putJson('drafts', item.id, item); return item; }
