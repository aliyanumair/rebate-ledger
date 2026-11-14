import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

export type IntakeRecord = {
  id: string;
  createdAt: string;
  company: string;
  name: string;
  email: string;
  supplier: string;
  pdfName: string;
  csvName: string;
  status: 'queued' | 'reviewing' | 'complete';
};

type Store = { intakes: IntakeRecord[] };
const memoryKey = Symbol.for('rebate-ledger.store');
type GlobalStore = typeof globalThis & { [memoryKey]?: Store };

function dataDir() {
  return process.env.REBATE_DATA_DIR || (process.env.VERCEL ? '/tmp/rebate-ledger' : path.join(process.cwd(), 'data', 'runtime'));
}

async function readStore(): Promise<Store> {
  const file = path.join(dataDir(), 'store.json');
  try {
    return JSON.parse(await readFile(file, 'utf8')) as Store;
  } catch {
    const globalStore = globalThis as GlobalStore;
    return globalStore[memoryKey] ?? { intakes: [] };
  }
}

async function writeStore(store: Store) {
  const globalStore = globalThis as GlobalStore;
  globalStore[memoryKey] = store;
  const dir = dataDir();
  try {
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, 'store.json'), JSON.stringify(store, null, 2), 'utf8');
  } catch {
    // Vercel functions only provide ephemeral writable storage. The process memory
    // fallback keeps the demo usable when durable storage is not configured.
  }
}

export async function listIntakes() {
  return (await readStore()).intakes;
}

export async function getIntake(id: string) {
  return (await readStore()).intakes.find((item) => item.id === id) ?? null;
}

export async function addIntake(item: IntakeRecord) {
  const store = await readStore();
  store.intakes.unshift(item);
  await writeStore(store);
  return item;
}
