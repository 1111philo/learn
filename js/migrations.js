// Data migration system for 1111 Learn
// Migrations transform stored data when the schema changes between versions.
// Each migration must be idempotent (safe to run twice).

const SCHEMA_VERSION_KEY = 'schemaVersion';

const migrations = [
  {
    version: 1,
    description: 'Baseline — stamp schema version on existing installs',
    async run() {
      // No data transformation. Existing data is already in "v1" shape.
      // This migration exists to mark existing installs so future
      // migrations run from v2 onward.
    }
  }
];

const LATEST_VERSION = migrations[migrations.length - 1].version;

export async function runMigrations() {
  const result = await chrome.storage.local.get(SCHEMA_VERSION_KEY);
  const currentVersion = result[SCHEMA_VERSION_KEY] || 0;

  if (currentVersion >= LATEST_VERSION) return;

  for (const migration of migrations) {
    if (migration.version <= currentVersion) continue;
    console.log(`[migrations] Running v${migration.version}: ${migration.description}`);
    await migration.run();
    await chrome.storage.local.set({ [SCHEMA_VERSION_KEY]: migration.version });
  }

  console.log(`[migrations] Schema at v${LATEST_VERSION}`);
}

export { SCHEMA_VERSION_KEY, LATEST_VERSION, migrations };
