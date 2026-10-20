import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  ConfigValidationError,
  DEFAULT_CONFIG,
  PostgresConfigStore,
} from './config-store.mjs';

const temporaryDirectories = [];

async function createTemporaryDirectory() {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'home-server-postgres-'));
  temporaryDirectories.push(directory);
  return directory;
}

function createPool() {
  let document = null;
  const query = vi.fn(async (sql, parameters = []) => {
    const statement = sql.replace(/\s+/g, ' ').trim();
    if (statement.startsWith('CREATE TABLE')) {
      return { rows: [] };
    }
    if (statement.startsWith('SELECT id')) {
      return { rows: document ? [{ id: 1 }] : [] };
    }
    if (statement.startsWith('SELECT document')) {
      return { rows: document ? [{ document: structuredClone(document) }] : [] };
    }
    if (statement.startsWith('INSERT INTO')) {
      if (!document || statement.includes('DO UPDATE')) {
        document = JSON.parse(parameters[0]);
      }
      return { rows: statement.includes('RETURNING document') ? [{ document: structuredClone(document) }] : [] };
    }
    if (statement === 'SELECT 1') {
      return { rows: [{ value: 1 }] };
    }
    throw new Error(`Unexpected SQL in test: ${statement}`);
  });
  return {
    query,
    readDocument: () => structuredClone(document),
  };
}

function createStore(pool, dataDir) {
  return new PostgresConfigStore({
    pool,
    dataDir,
    defaults: DEFAULT_CONFIG,
    defaultsFile: path.join(dataDir, 'missing-defaults.json'),
  });
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe('PostgresConfigStore', () => {
  it('creates its schema and returns defaults when the table has no row', async () => {
    const dataDir = await createTemporaryDirectory();
    const pool = createPool();
    const store = createStore(pool, dataDir);

    await expect(store.get()).resolves.toEqual(DEFAULT_CONFIG);
    expect(pool.query.mock.calls.some(([sql]) => sql.includes('CREATE TABLE IF NOT EXISTS'))).toBe(true);
  });

  it('normalizes and atomically upserts configuration', async () => {
    const dataDir = await createTemporaryDirectory();
    const pool = createPool();
    const store = createStore(pool, dataDir);
    const input = {
      settings: { title: 'PostgreSQL dashboard', refreshInterval: 10_000 },
      services: [{ id: 'nas', name: 'NAS', url: 'https://nas.local' }],
      topology: { nodes: [{ id: 'nas', label: 'NAS' }], links: [] },
    };

    const saved = await store.put(input);
    await expect(store.get()).resolves.toEqual(saved);
    expect(pool.readDocument()).toEqual(saved);
    expect(saved.services[0]).toMatchObject({ category: '其他', check: { type: 'none' } });
  });

  it('migrates a legacy config file only when the database row is empty', async () => {
    const dataDir = await createTemporaryDirectory();
    const pool = createPool();
    await writeFile(path.join(dataDir, 'config.json'), JSON.stringify({
      settings: { title: 'Migrated', refreshInterval: 5000 },
      services: [],
      topology: { nodes: [], links: [] },
    }));

    const store = createStore(pool, dataDir);
    await expect(store.get()).resolves.toMatchObject({ settings: { title: 'Migrated' } });
    expect(pool.readDocument()).toMatchObject({ settings: { title: 'Migrated' } });
  });

  it('rejects invalid configuration before writing to PostgreSQL', async () => {
    const dataDir = await createTemporaryDirectory();
    const pool = createPool();
    const store = createStore(pool, dataDir);

    await expect(store.put({
      services: [
        { id: 'duplicate', name: 'One', url: 'http://one.local' },
        { id: 'duplicate', name: 'Two', url: 'http://two.local' },
      ],
    })).rejects.toBeInstanceOf(ConfigValidationError);
    expect(pool.query).not.toHaveBeenCalled();
  });

  it('uses the database for readiness checks', async () => {
    const dataDir = await createTemporaryDirectory();
    const pool = createPool();
    const store = createStore(pool, dataDir);

    await store.healthCheck();
    expect(pool.query.mock.calls.some(([sql]) => sql === 'SELECT 1')).toBe(true);
  });
});
