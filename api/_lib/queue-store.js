import { neon } from "@neondatabase/serverless";

function getSqlClient() {
  const databaseUrl = process.env.DATABASE_URL || process.env.NEON_DATABASE_URL || process.env.NEON_POSTGRES_URL;

  if (!databaseUrl) {
    throw new Error("DATABASE_URL or Neon database URL is not configured.");
  }

  return neon(databaseUrl);
}

async function ensureQueueSnapshotsTable(sql) {
  await sql`
    CREATE TABLE IF NOT EXISTS queue_snapshots (
      workspace_key TEXT PRIMARY KEY,
      snapshot_json JSONB NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
}

function normalizeStoredSnapshot(value) {
  if (!value) {
    return null;
  }

  if (typeof value === "string") {
    return JSON.parse(value);
  }

  return value;
}

export async function loadQueueSnapshot(workspaceKey) {
  const sql = getSqlClient();
  await ensureQueueSnapshotsTable(sql);

  const rows = await sql`
    SELECT snapshot_json, updated_at
    FROM queue_snapshots
    WHERE workspace_key = ${workspaceKey}
    LIMIT 1
  `;

  const row = rows[0];
  if (!row) {
    return null;
  }

  return {
    workspaceKey,
    snapshot: normalizeStoredSnapshot(row.snapshot_json),
    updatedAt: row.updated_at,
  };
}

export async function saveQueueSnapshot(workspaceKey, snapshot) {
  const sql = getSqlClient();
  await ensureQueueSnapshotsTable(sql);

  const rows = await sql`
    INSERT INTO queue_snapshots (workspace_key, snapshot_json, updated_at)
    VALUES (${workspaceKey}, ${JSON.stringify(snapshot)}::jsonb, NOW())
    ON CONFLICT (workspace_key)
    DO UPDATE SET
      snapshot_json = EXCLUDED.snapshot_json,
      updated_at = NOW()
    RETURNING snapshot_json, updated_at
  `;

  return {
    workspaceKey,
    snapshot: normalizeStoredSnapshot(rows[0].snapshot_json),
    updatedAt: rows[0].updated_at,
  };
}

export async function deleteQueueSnapshot(workspaceKey) {
  const sql = getSqlClient();
  await ensureQueueSnapshotsTable(sql);

  await sql`
    DELETE FROM queue_snapshots
    WHERE workspace_key = ${workspaceKey}
  `;
}
