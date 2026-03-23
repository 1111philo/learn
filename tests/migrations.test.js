import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// -- Chrome storage mock ------------------------------------------------------

function createMockStorage() {
  return {
    _store: {},
    async get(keys) {
      if (keys === null) return { ...this._store };
      if (typeof keys === 'string') keys = [keys];
      const result = {};
      for (const k of keys) {
        if (k in this._store) result[k] = this._store[k];
      }
      return result;
    },
    async set(items) {
      Object.assign(this._store, items);
    }
  };
}

beforeEach(() => {
  globalThis.chrome = { storage: { local: createMockStorage() } };
});

// -- Tests --------------------------------------------------------------------

describe('migrations', () => {
  it('stamps schemaVersion when starting from empty storage', async () => {
    const { runMigrations, LATEST_VERSION } = await reimport();

    await runMigrations();

    const result = await chrome.storage.local.get('schemaVersion');
    assert.equal(result.schemaVersion, LATEST_VERSION);
  });

  it('is a no-op when already at latest version', async () => {
    const { runMigrations, LATEST_VERSION } = await reimport();
    await chrome.storage.local.set({ schemaVersion: LATEST_VERSION });

    await runMigrations();

    const result = await chrome.storage.local.get('schemaVersion');
    assert.equal(result.schemaVersion, LATEST_VERSION);
  });

  it('runs migrations in ascending order', async () => {
    const { runMigrations, migrations } = await reimport();

    await runMigrations();

    for (let i = 1; i < migrations.length; i++) {
      assert.ok(
        migrations[i].version > migrations[i - 1].version,
        `Migration ${i} version should be greater than migration ${i - 1}`
      );
    }
  });

  it('LATEST_VERSION equals the last migration version', async () => {
    const { LATEST_VERSION, migrations } = await reimport();

    assert.equal(LATEST_VERSION, migrations[migrations.length - 1].version);
  });

  it('baseline migration is idempotent', async () => {
    const { runMigrations, LATEST_VERSION } = await reimport();

    await runMigrations();
    const storeAfterFirst = { ...chrome.storage.local._store };

    // Reset version to force re-run
    await chrome.storage.local.set({ schemaVersion: 0 });
    await runMigrations();
    const storeAfterSecond = { ...chrome.storage.local._store };

    assert.deepEqual(storeAfterFirst, storeAfterSecond);
  });

  it('skips already-applied migrations', async () => {
    const { runMigrations, LATEST_VERSION } = await reimport();
    await chrome.storage.local.set({ schemaVersion: LATEST_VERSION });

    // Seed a marker to confirm no migration touched storage beyond schemaVersion
    await chrome.storage.local.set({ _marker: true });
    await runMigrations();

    const result = await chrome.storage.local.get(null);
    assert.equal(result.schemaVersion, LATEST_VERSION);
    assert.equal(result._marker, true);
  });

  it('v3 adds messages array to existing activities', async () => {
    const { runMigrations } = await reimport();
    await chrome.storage.local.set({
      schemaVersion: 2,
      'unit-course1': {
        unitId: 'course1',
        currentActivityIndex: 1,
        activities: [
          { id: 'a1', type: 'explore', instruction: 'Do something' },
          { id: 'a2', type: 'apply', instruction: 'Do another thing' }
        ],
        drafts: []
      }
    });

    await runMigrations();

    const result = await chrome.storage.local.get('unit-course1');
    const progress = result['unit-course1'];
    assert.deepEqual(progress.activities[0].messages, []);
    assert.deepEqual(progress.activities[1].messages, []);
  });

  it('v3 is idempotent — does not overwrite existing messages', async () => {
    const { runMigrations } = await reimport();
    const existingMessages = [{ role: 'user', content: 'hello' }];
    await chrome.storage.local.set({
      schemaVersion: 2,
      'unit-course1': {
        unitId: 'course1',
        currentActivityIndex: 0,
        activities: [
          { id: 'a1', type: 'explore', instruction: 'Do something', messages: existingMessages }
        ],
        drafts: []
      }
    });

    await runMigrations();

    const result = await chrome.storage.local.get('unit-course1');
    assert.deepEqual(result['unit-course1'].activities[0].messages, existingMessages);
  });

  it('every migration has required fields', async () => {
    const { migrations } = await reimport();

    for (const m of migrations) {
      assert.equal(typeof m.version, 'number', `Migration must have a numeric version`);
      assert.equal(typeof m.description, 'string', `Migration v${m.version} must have a description`);
      assert.equal(typeof m.run, 'function', `Migration v${m.version} must have a run function`);
    }
  });
});

// Dynamic reimport to get a fresh module with the current chrome mock
async function reimport() {
  const url = new URL(`../js/migrations.js?t=${Date.now()}${Math.random()}`, import.meta.url);
  return import(url.href);
}
