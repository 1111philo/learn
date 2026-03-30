import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

// Platform detection relies on globals. Save originals and restore after each test.
let originalChrome;
let originalWindow;

beforeEach(() => {
  originalChrome = globalThis.chrome;
  // Reset the cached platform so each test gets a fresh detection
  // platform.js caches in _platform; reimporting resets it
});

afterEach(() => {
  globalThis.chrome = originalChrome;
  delete globalThis.Capacitor;
  delete globalThis.electronAPI;
});

// Dynamically import so each test can set up globals first.
// Because platform.js caches the result, we need a fresh module per test group.
async function freshImport() {
  // Bust the module cache by appending a unique query param
  const mod = await import(`../js/platform.js?t=${Date.now()}-${Math.random()}`);
  return mod;
}

describe('getPlatform', () => {
  it('detects extension when chrome.runtime.id exists', async () => {
    globalThis.chrome = { runtime: { id: 'test-extension-id', getURL: (p) => `chrome-extension://test/${p}` } };
    const { getPlatform } = await freshImport();
    assert.equal(getPlatform(), 'extension');
  });

  it('detects capacitor when window.Capacitor exists', async () => {
    globalThis.chrome = undefined;
    globalThis.Capacitor = { isNativePlatform: () => true };
    const { getPlatform } = await freshImport();
    assert.equal(getPlatform(), 'capacitor');
  });

  it('detects electron when window.electronAPI exists', async () => {
    globalThis.chrome = undefined;
    globalThis.electronAPI = { kvGet: () => {} };
    const { getPlatform } = await freshImport();
    assert.equal(getPlatform(), 'electron');
  });

  it('falls back to web when no platform globals exist', async () => {
    globalThis.chrome = undefined;
    const { getPlatform } = await freshImport();
    assert.equal(getPlatform(), 'web');
  });
});

describe('resolveAssetURL', () => {
  it('calls chrome.runtime.getURL in extension mode', async () => {
    globalThis.chrome = {
      runtime: { id: 'ext-id', getURL: (p) => `chrome-extension://ext-id/${p}` },
    };
    const { resolveAssetURL } = await freshImport();
    assert.equal(resolveAssetURL('prompts/coach.md'), 'chrome-extension://ext-id/prompts/coach.md');
  });

  it('returns relative path in web mode', async () => {
    globalThis.chrome = undefined;
    const { resolveAssetURL } = await freshImport();
    assert.equal(resolveAssetURL('prompts/coach.md'), 'prompts/coach.md');
  });

  it('returns relative path in capacitor mode', async () => {
    globalThis.chrome = undefined;
    globalThis.Capacitor = {};
    const { resolveAssetURL } = await freshImport();
    assert.equal(resolveAssetURL('lib/sql-wasm.wasm'), 'lib/sql-wasm.wasm');
  });

  it('returns relative path in electron mode', async () => {
    globalThis.chrome = undefined;
    globalThis.electronAPI = {};
    const { resolveAssetURL } = await freshImport();
    assert.equal(resolveAssetURL('data/courses/index.json'), 'data/courses/index.json');
  });
});

describe('kvStorage (extension mode)', () => {
  it('delegates get to chrome.storage.local.get', async () => {
    let calledWith;
    globalThis.chrome = {
      runtime: { id: 'ext' },
      storage: { local: { get: async (key) => { calledWith = key; return { [key]: [1, 2, 3] }; } } },
    };
    const { kvStorage } = await freshImport();
    const result = await kvStorage.get('_sqliteDb');
    assert.equal(calledWith, '_sqliteDb');
    assert.deepEqual(result, { _sqliteDb: [1, 2, 3] });
  });

  it('delegates set to chrome.storage.local.set', async () => {
    let calledWith;
    globalThis.chrome = {
      runtime: { id: 'ext' },
      storage: { local: { set: async (data) => { calledWith = data; } } },
    };
    const { kvStorage } = await freshImport();
    await kvStorage.set({ _sqliteDb: [4, 5, 6] });
    assert.deepEqual(calledWith, { _sqliteDb: [4, 5, 6] });
  });

  it('delegates remove to chrome.storage.local.remove', async () => {
    let calledWith;
    globalThis.chrome = {
      runtime: { id: 'ext' },
      storage: { local: { remove: async (key) => { calledWith = key; } } },
    };
    const { kvStorage } = await freshImport();
    await kvStorage.remove('_sqliteDb');
    assert.equal(calledWith, '_sqliteDb');
  });
});
