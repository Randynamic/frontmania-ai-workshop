import { createClient, type Client, type InValue, type Row } from '@libsql/client';

/**
 * SQLite (libsql) store for everything the room produces: key hashes, blind
 * picks, profiles, run ids and feedback. Personal data never enters: keys are
 * hashed, participants are pseudonyms, profiles have no identity fields.
 */

export interface KeyRecord {
  readonly keyHash: string;
  readonly pseudonym: string;
  readonly revokedAt: number | null;
  /** null until the key is linked to a page-issued id (page variant); set at creation in the slip variant. */
  readonly linkedAt: number | null;
}
export interface RunRecord {
  readonly traceId: string;
  readonly participantId: string;
  readonly kind: string;
  readonly createdAt: number;
}
export interface FeedbackRecord {
  readonly id: number;
  readonly participantId: string;
  readonly traceId: string;
  readonly slot: string;
  readonly thumb: string;
  readonly reason: string;
  readonly createdAt: number;
  readonly attachedAt: number | null;
}
export interface Stats {
  readonly keys: number;
  readonly keysRevoked: number;
  readonly picks: number;
  readonly profiles: number;
  readonly runs: number;
  readonly feedback: number;
  readonly feedbackAttached: number;
}
export interface ExportRow {
  readonly participantId: string;
  readonly profile: unknown;
  readonly picks: Record<string, string> | null;
  readonly feedback: readonly { slot: string; thumb: string; reason: string; traceId: string }[];
}

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS keys (key_hash TEXT PRIMARY KEY, pseudonym TEXT UNIQUE NOT NULL, created_at INTEGER NOT NULL, revoked_at INTEGER, linked_at INTEGER)`,
  `CREATE TABLE IF NOT EXISTS ids (pseudonym TEXT PRIMARY KEY, issued_at INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS picks (participant_id TEXT PRIMARY KEY, picks_json TEXT NOT NULL, updated_at INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS profiles (id INTEGER PRIMARY KEY AUTOINCREMENT, participant_id TEXT NOT NULL, profile_json TEXT NOT NULL, created_at INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS runs (trace_id TEXT PRIMARY KEY, participant_id TEXT NOT NULL, kind TEXT NOT NULL, created_at INTEGER NOT NULL, expectations_attached_at INTEGER)`,
  `CREATE TABLE IF NOT EXISTS feedback (id INTEGER PRIMARY KEY AUTOINCREMENT, participant_id TEXT NOT NULL, trace_id TEXT NOT NULL, slot TEXT NOT NULL, thumb TEXT NOT NULL, reason TEXT NOT NULL, created_at INTEGER NOT NULL, attached_at INTEGER, attach_attempts INTEGER NOT NULL DEFAULT 0)`,
];
const TABLES = ['keys', 'ids', 'picks', 'profiles', 'runs', 'feedback'] as const;

const asString = (value: unknown): string =>
  typeof value === 'string' ? value : String(value ?? '');
const asNumber = (value: unknown): number =>
  typeof value === 'number' ? value : Number(value ?? 0);
const asNullableNumber = (value: unknown): number | null =>
  value === null || value === undefined ? null : asNumber(value);
const count = (row: Row | undefined): number => asNumber(row?.['n']);

const toFeedback = (row: Row): FeedbackRecord => ({
  id: asNumber(row['id']),
  participantId: asString(row['participant_id']),
  traceId: asString(row['trace_id']),
  slot: asString(row['slot']),
  thumb: asString(row['thumb']),
  reason: asString(row['reason']),
  createdAt: asNumber(row['created_at']),
  attachedAt: asNullableNumber(row['attached_at']),
});

const toRun = (row: Row): RunRecord => ({
  traceId: asString(row['trace_id']),
  participantId: asString(row['participant_id']),
  kind: asString(row['kind']),
  createdAt: asNumber(row['created_at']),
});

export class Store {
  private constructor(private readonly db: Client) {}

  static async open(url: string): Promise<Store> {
    const db = createClient({ url });
    await db.batch(
      SCHEMA.map((sql) => ({ sql, args: [] })),
      'write',
    );
    return new Store(db);
  }

  private async one(sql: string, args: InValue[] = []): Promise<Row | undefined> {
    return (await this.db.execute(sql, args)).rows[0];
  }

  /** `linked` is true in the slip variant (id printed with the key) and false in the page variant (linked later by /api/register). */
  async addKey(
    keyHash: string,
    pseudonym: string,
    linked: boolean,
    now = Date.now(),
  ): Promise<void> {
    await this.db.execute(
      `INSERT INTO keys (key_hash, pseudonym, created_at, linked_at) VALUES (?, ?, ?, ?)`,
      [keyHash, pseudonym, now, linked ? now : null],
    );
  }

  async findKey(keyHash: string): Promise<KeyRecord | undefined> {
    const row = await this.one(
      `SELECT key_hash, pseudonym, revoked_at, linked_at FROM keys WHERE key_hash = ?`,
      [keyHash],
    );
    if (!row) return undefined;
    return {
      keyHash: asString(row['key_hash']),
      pseudonym: asString(row['pseudonym']),
      revokedAt: asNullableNumber(row['revoked_at']),
      linkedAt: asNullableNumber(row['linked_at']),
    };
  }

  /** Page variant: links a key to an id the backend issued. Idempotent for the same key and id. */
  async linkKey(keyHash: string, pseudonym: string, now = Date.now()): Promise<void> {
    await this.db.execute(
      `UPDATE keys SET pseudonym = ?, linked_at = COALESCE(linked_at, ?) WHERE key_hash = ?`,
      [pseudonym, now, keyHash],
    );
  }

  async issueId(pseudonym: string, now = Date.now()): Promise<void> {
    await this.db.execute(`INSERT OR IGNORE INTO ids (pseudonym, issued_at) VALUES (?, ?)`, [
      pseudonym,
      now,
    ]);
  }

  async countIssuedIds(): Promise<number> {
    return count(await this.one(`SELECT COUNT(*) AS n FROM ids`));
  }

  async hasIssuedId(pseudonym: string): Promise<boolean> {
    return (
      (await this.one(`SELECT 1 AS n FROM ids WHERE pseudonym = ?`, [pseudonym])) !== undefined
    );
  }

  /** True when a key (linked or still a placeholder) already carries this pseudonym. */
  async isKeyPseudonym(pseudonym: string): Promise<boolean> {
    return (
      (await this.one(`SELECT 1 AS n FROM keys WHERE pseudonym = ?`, [pseudonym])) !== undefined
    );
  }

  async listPseudonyms(): Promise<readonly string[]> {
    const result = await this.db.execute(`SELECT pseudonym FROM keys ORDER BY created_at`);
    return result.rows.map((row) => asString(row['pseudonym']));
  }

  async revokeAllKeys(now = Date.now()): Promise<number> {
    const result = await this.db.execute(
      `UPDATE keys SET revoked_at = ? WHERE revoked_at IS NULL`,
      [now],
    );
    return result.rowsAffected;
  }

  /** Picks are write-once: returns false (and changes nothing) when this id already has picks. */
  async savePicks(
    participantId: string,
    picks: Record<string, string>,
    now = Date.now(),
  ): Promise<boolean> {
    const result = await this.db.execute(
      `INSERT INTO picks (participant_id, picks_json, updated_at) VALUES (?, ?, ?) ON CONFLICT(participant_id) DO NOTHING`,
      [participantId, JSON.stringify(picks), now],
    );
    return result.rowsAffected > 0;
  }

  async getPicks(participantId: string): Promise<Record<string, string> | null> {
    const row = await this.one(`SELECT picks_json FROM picks WHERE participant_id = ?`, [
      participantId,
    ]);
    return row ? (JSON.parse(asString(row['picks_json'])) as Record<string, string>) : null;
  }

  async saveProfile(participantId: string, profile: unknown, now = Date.now()): Promise<void> {
    await this.db.execute(
      `INSERT INTO profiles (participant_id, profile_json, created_at) VALUES (?, ?, ?)`,
      [participantId, JSON.stringify(profile), now],
    );
  }

  async saveRun(
    traceId: string,
    participantId: string,
    kind: string,
    now = Date.now(),
  ): Promise<void> {
    await this.db.execute(
      `INSERT INTO runs (trace_id, participant_id, kind, created_at) VALUES (?, ?, ?, ?) ON CONFLICT(trace_id) DO UPDATE SET kind = excluded.kind`,
      [traceId, participantId, kind, now],
    );
  }

  async findRun(traceId: string): Promise<RunRecord | undefined> {
    const row = await this.one(
      `SELECT trace_id, participant_id, kind, created_at FROM runs WHERE trace_id = ?`,
      [traceId],
    );
    return row ? toRun(row) : undefined;
  }

  async runsAwaitingExpectations(): Promise<readonly RunRecord[]> {
    const result = await this.db.execute(
      `SELECT r.trace_id, r.participant_id, r.kind, r.created_at FROM runs r JOIN picks p ON p.participant_id = r.participant_id WHERE r.kind = 'plan' AND r.expectations_attached_at IS NULL`,
    );
    return result.rows.map(toRun);
  }

  async markExpectationsAttached(traceId: string, now = Date.now()): Promise<void> {
    await this.db.execute(`UPDATE runs SET expectations_attached_at = ? WHERE trace_id = ?`, [
      now,
      traceId,
    ]);
  }

  async saveFeedback(
    input: { participantId: string; traceId: string; slot: string; thumb: string; reason: string },
    now = Date.now(),
  ): Promise<number> {
    const result = await this.db.execute(
      `INSERT INTO feedback (participant_id, trace_id, slot, thumb, reason, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
      [input.participantId, input.traceId, input.slot, input.thumb, input.reason, now],
    );
    return Number(result.lastInsertRowid ?? 0);
  }

  async listFeedbackByTrace(
    traceId: string,
    participantId: string,
  ): Promise<readonly FeedbackRecord[]> {
    const result = await this.db.execute(
      `SELECT * FROM feedback WHERE trace_id = ? AND participant_id = ? ORDER BY id`,
      [traceId, participantId],
    );
    return result.rows.map(toFeedback);
  }

  async pendingFeedback(maxAttempts: number): Promise<readonly FeedbackRecord[]> {
    const result = await this.db.execute(
      `SELECT * FROM feedback WHERE attached_at IS NULL AND attach_attempts < ? ORDER BY id`,
      [maxAttempts],
    );
    return result.rows.map(toFeedback);
  }

  async markFeedbackAttached(id: number, now = Date.now()): Promise<void> {
    await this.db.execute(
      `UPDATE feedback SET attached_at = ?, attach_attempts = attach_attempts + 1 WHERE id = ?`,
      [now, id],
    );
  }

  async markFeedbackAttempt(id: number): Promise<void> {
    await this.db.execute(
      `UPDATE feedback SET attach_attempts = attach_attempts + 1 WHERE id = ?`,
      [id],
    );
  }

  async stats(): Promise<Stats> {
    const [keys, keysRevoked, picks, profiles, runs, feedback, feedbackAttached] =
      await this.db.batch(
        [
          'SELECT COUNT(*) AS n FROM keys',
          'SELECT COUNT(*) AS n FROM keys WHERE revoked_at IS NOT NULL',
          'SELECT COUNT(*) AS n FROM picks',
          'SELECT COUNT(*) AS n FROM profiles',
          'SELECT COUNT(*) AS n FROM runs',
          'SELECT COUNT(*) AS n FROM feedback',
          'SELECT COUNT(*) AS n FROM feedback WHERE attached_at IS NOT NULL',
        ].map((sql) => ({ sql, args: [] })),
        'read',
      );
    return {
      keys: count(keys?.rows[0]),
      keysRevoked: count(keysRevoked?.rows[0]),
      picks: count(picks?.rows[0]),
      profiles: count(profiles?.rows[0]),
      runs: count(runs?.rows[0]),
      feedback: count(feedback?.rows[0]),
      feedbackAttached: count(feedbackAttached?.rows[0]),
    };
  }

  /** Latest profile, picks and feedback per pseudonym; input for optimize/build_dataset.py. */
  async exportAll(): Promise<readonly ExportRow[]> {
    const profiles = await this.db.execute(
      `SELECT participant_id, profile_json FROM profiles WHERE id IN (SELECT MAX(id) FROM profiles GROUP BY participant_id)`,
    );
    const picks = await this.db.execute(`SELECT participant_id, picks_json FROM picks`);
    const feedback = await this.db.execute(
      `SELECT participant_id, trace_id, slot, thumb, reason FROM feedback ORDER BY id`,
    );
    const picksBy = new Map(
      picks.rows.map((row) => [
        asString(row['participant_id']),
        JSON.parse(asString(row['picks_json'])) as Record<string, string>,
      ]),
    );
    return profiles.rows.map((row) => {
      const participantId = asString(row['participant_id']);
      return {
        participantId,
        profile: JSON.parse(asString(row['profile_json'])) as unknown,
        picks: picksBy.get(participantId) ?? null,
        feedback: feedback.rows
          .filter((f) => asString(f['participant_id']) === participantId)
          .map((f) => ({
            slot: asString(f['slot']),
            thumb: asString(f['thumb']),
            reason: asString(f['reason']),
            traceId: asString(f['trace_id']),
          })),
      };
    });
  }

  /** Deletes every row in every table; returns the number of rows removed. */
  async wipe(): Promise<number> {
    const results = await this.db.batch(
      TABLES.map((table) => ({ sql: `DELETE FROM ${table}`, args: [] })),
      'write',
    );
    return results.reduce((sum, result) => sum + result.rowsAffected, 0);
  }

  close(): void {
    this.db.close();
  }
}
