// server/db/schema.ts
// Idempotent schema. All CREATE TABLE statements use IF NOT EXISTS.

export const schema = `
  CREATE TABLE IF NOT EXISTS users (
    id           TEXT PRIMARY KEY,
    name         TEXT NOT NULL,
    username     TEXT NOT NULL,
    email        TEXT NOT NULL,
    passwordHash TEXT,
    avatarUrl    TEXT,
    emailVerified INTEGER NOT NULL DEFAULT 0,
    googleProviderId TEXT,
    createdAt    TEXT NOT NULL,
    updatedAt    TEXT NOT NULL
  );

  CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email
    ON users (email);

  CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username
    ON users (username);

  CREATE UNIQUE INDEX IF NOT EXISTS idx_users_google_provider_id
    ON users (googleProviderId)
    WHERE googleProviderId IS NOT NULL;

  CREATE TABLE IF NOT EXISTS sessions (
    id          TEXT PRIMARY KEY,
    userId      TEXT NOT NULL,
    tokenHash   TEXT NOT NULL,
    expiresAt   TEXT NOT NULL,
    createdAt   TEXT NOT NULL,
    lastUsedAt  TEXT NOT NULL,
    FOREIGN KEY (userId) REFERENCES users (id) ON DELETE CASCADE
  );

  CREATE UNIQUE INDEX IF NOT EXISTS idx_sessions_token_hash
    ON sessions (tokenHash);

  CREATE INDEX IF NOT EXISTS idx_sessions_user_id
    ON sessions (userId);

  CREATE TABLE IF NOT EXISTS emailOtps (
    id          TEXT PRIMARY KEY,
    userId      TEXT NOT NULL,
    email       TEXT NOT NULL,
    purpose     TEXT NOT NULL,
    otpHash     TEXT NOT NULL,
    expiresAt   TEXT NOT NULL,
    attempts    INTEGER NOT NULL DEFAULT 0,
    consumedAt  TEXT,
    createdAt   TEXT NOT NULL,
    FOREIGN KEY (userId) REFERENCES users (id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_email_otps_lookup
    ON emailOtps (email, purpose, consumedAt);

  CREATE TABLE IF NOT EXISTS passwordResetTokens (
    id        TEXT PRIMARY KEY,
    userId    TEXT NOT NULL,
    tokenHash TEXT NOT NULL,
    expiresAt TEXT NOT NULL,
    usedAt    TEXT,
    createdAt TEXT NOT NULL,
    FOREIGN KEY (userId) REFERENCES users (id) ON DELETE CASCADE
  );

  CREATE UNIQUE INDEX IF NOT EXISTS idx_prt_token_hash
    ON passwordResetTokens (tokenHash);

  CREATE TABLE IF NOT EXISTS loginActivity (
    id                   TEXT PRIMARY KEY,
    userId               TEXT NOT NULL,
    loginTime            TEXT NOT NULL,
    location             TEXT NOT NULL,
    authenticationMethod TEXT NOT NULL,
    FOREIGN KEY (userId) REFERENCES users (id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_login_activity_user_id
    ON loginActivity (userId);

  CREATE TABLE IF NOT EXISTS pendingSignups (
    id           TEXT PRIMARY KEY,
    name         TEXT NOT NULL,
    username     TEXT NOT NULL,
    email        TEXT NOT NULL,
    passwordHash TEXT NOT NULL,
    otpHash      TEXT NOT NULL,
    expiresAt    TEXT NOT NULL,
    attempts     INTEGER NOT NULL DEFAULT 0,
    createdAt    TEXT NOT NULL,
    updatedAt    TEXT NOT NULL
  );

  CREATE UNIQUE INDEX IF NOT EXISTS idx_pending_signups_email
    ON pendingSignups (email);

  CREATE UNIQUE INDEX IF NOT EXISTS idx_pending_signups_username
    ON pendingSignups (username);

  -- ─── Phase 3: Real-time rooms ────────────────────────────────────────────

  CREATE TABLE IF NOT EXISTS rooms (
    id                 TEXT PRIMARY KEY,
    name               TEXT NOT NULL,
    code               TEXT NOT NULL,
    hostUserId         TEXT NOT NULL,
    category           TEXT NOT NULL DEFAULT 'Other',
    privacy            TEXT NOT NULL DEFAULT 'public',
    maxParticipants    INTEGER NOT NULL DEFAULT 8,
    status             TEXT NOT NULL DEFAULT 'LIVE',
    currentMediaJson   TEXT,
    playbackStateJson  TEXT,
    screenShareActive  INTEGER NOT NULL DEFAULT 0,
    description        TEXT,
    createdAt          TEXT NOT NULL,
    lastActivityAt     TEXT NOT NULL,
    emptySince         TEXT,
    FOREIGN KEY (hostUserId) REFERENCES users (id) ON DELETE CASCADE
  );

  CREATE UNIQUE INDEX IF NOT EXISTS idx_rooms_code
    ON rooms (code);

  CREATE INDEX IF NOT EXISTS idx_rooms_host_user
    ON rooms (hostUserId);

  CREATE INDEX IF NOT EXISTS idx_rooms_empty_since
    ON rooms (emptySince)
    WHERE emptySince IS NOT NULL;

  CREATE TABLE IF NOT EXISTS roomMembers (
    id            TEXT PRIMARY KEY,
    roomId        TEXT NOT NULL,
    userId        TEXT NOT NULL,
    role          TEXT NOT NULL DEFAULT 'member',
    micOn         INTEGER NOT NULL DEFAULT 0,
    cameraOn      INTEGER NOT NULL DEFAULT 0,
    screenShareOn INTEGER NOT NULL DEFAULT 0,
    joinedAt      TEXT NOT NULL,
    leftAt        TEXT,
    FOREIGN KEY (roomId) REFERENCES rooms (id) ON DELETE CASCADE,
    FOREIGN KEY (userId) REFERENCES users (id) ON DELETE CASCADE,
    UNIQUE (roomId, userId)
  );

  CREATE INDEX IF NOT EXISTS idx_room_members_room
    ON roomMembers (roomId);

  CREATE INDEX IF NOT EXISTS idx_room_members_user
    ON roomMembers (userId);

  CREATE TABLE IF NOT EXISTS roomEvents (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    roomId       TEXT NOT NULL,
    type         TEXT NOT NULL,
    actorUserId  TEXT,
    payloadJson  TEXT NOT NULL,
    createdAt    TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_room_events_room
    ON roomEvents (roomId, id);
`;
