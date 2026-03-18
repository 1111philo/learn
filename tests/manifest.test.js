import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const manifest = JSON.parse(readFileSync(resolve(root, 'manifest.json'), 'utf8'));

describe('manifest.json', () => {
  it('has manifest_version 3', () => {
    assert.equal(manifest.manifest_version, 3);
  });

  it('has a name', () => {
    assert.ok(manifest.name && typeof manifest.name === 'string');
  });

  it('has a valid version (3 or 4 dot-separated integers)', () => {
    assert.match(manifest.version, /^\d+\.\d+\.\d+(\.\d+)?$/);
  });

  it('has version_name as a non-empty string if present', () => {
    if ('version_name' in manifest) {
      assert.ok(manifest.version_name && typeof manifest.version_name === 'string');
    }
  });

  it('has required permissions', () => {
    assert.ok(Array.isArray(manifest.permissions));
    const required = ['sidePanel', 'storage', 'activeTab'];
    for (const perm of required) {
      assert.ok(manifest.permissions.includes(perm), `Missing permission: ${perm}`);
    }
  });

  it('has a side_panel.default_path that points to an existing file', () => {
    assert.ok(manifest.side_panel?.default_path, 'Missing side_panel.default_path');
    const panelPath = resolve(root, manifest.side_panel.default_path);
    assert.ok(existsSync(panelPath), `File not found: ${manifest.side_panel.default_path}`);
  });

  it('has a background service_worker', () => {
    assert.ok(manifest.background?.service_worker, 'Missing background.service_worker');
  });

  it('has icon entries', () => {
    assert.ok(manifest.icons && typeof manifest.icons === 'object');
    assert.ok(Object.keys(manifest.icons).length > 0, 'No icons defined');
  });
});
