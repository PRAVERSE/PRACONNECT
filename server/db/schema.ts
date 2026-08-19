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
    -- Phase A: admin role. Default is 'user' — only the server-side bootstrap
    -- (ADMIN_EMAIL) promotes the designated owner account to 'admin'. A role
    -- sent from the client is never accepted.
    role         TEXT NOT NULL DEFAULT 'user',
    createdAt    TEXT NOT NULL,
    updatedAt    TEXT NOT NULL,
    -- Phase 1 realtime: ISO time the user last went fully offline, set by the
    -- presence system when their last live connection closes.
    lastSeenAt   TEXT
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
    removedAt     TEXT,
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

  -- ─── Phase 6.2: Upload ownership metadata ─────────────────────────────────
  -- Created only for finalized uploads — media serving authorizes against the
  -- owning room. The filename PK doubles as the UNIQUE constraint.

  CREATE TABLE IF NOT EXISTS uploads (
    filename  TEXT PRIMARY KEY,
    roomId    TEXT NOT NULL,
    userId    TEXT NOT NULL,
    size      INTEGER NOT NULL,
    mimeType  TEXT,
    createdAt TEXT NOT NULL,
    -- Phase 6.9: MKV source files are converted to a browser-playable MP4.
    -- The playable file has its own row whose sourceFilename points at the
    -- stored source, and the source row tracks the conversion lifecycle.
    sourceFilename    TEXT,
    playableFilename  TEXT,
    conversionStatus  TEXT NOT NULL DEFAULT 'uploaded',
    FOREIGN KEY (roomId) REFERENCES rooms (id) ON DELETE CASCADE,
    FOREIGN KEY (userId) REFERENCES users (id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_uploads_room
    ON uploads (roomId);

  -- ─── Persistent room history / user statistics ─────────────────────────────
  -- Active room state (rooms, roomMembers, roomEvents, uploads) is deleted by
  -- the 5-minute empty-room cleanup. These tables are the durable record of
  -- every room session and every participation, so profile/dashboard
  -- statistics survive active-room cleanup. They intentionally have NO foreign
  -- key to the rooms table - history must outlive the active room row. Room
  -- ids are 32-hex random values (never reused), but each history row still
  -- gets its own immutable history id.

  CREATE TABLE IF NOT EXISTS roomHistory (
    id                 TEXT PRIMARY KEY,
    roomId             TEXT NOT NULL,
    roomCode           TEXT NOT NULL,
    roomName           TEXT NOT NULL,
    hostUserId         TEXT NOT NULL,
    category           TEXT NOT NULL DEFAULT 'Other',
    createdAt          TEXT NOT NULL,
    emptySince         TEXT,
    endedAt            TEXT,
    durationSeconds    INTEGER NOT NULL DEFAULT 0,
    participantCount   INTEGER NOT NULL DEFAULT 0,
    maxParticipants    INTEGER NOT NULL DEFAULT 8,
    createdMediaTitle  TEXT,
    createdMediaType   TEXT,
    FOREIGN KEY (hostUserId) REFERENCES users (id) ON DELETE CASCADE
  );

  CREATE UNIQUE INDEX IF NOT EXISTS idx_room_history_room
    ON roomHistory (roomId);

  CREATE INDEX IF NOT EXISTS idx_room_history_host
    ON roomHistory (hostUserId);

  CREATE TABLE IF NOT EXISTS roomHistoryMembers (
    id              TEXT PRIMARY KEY,
    historyId       TEXT NOT NULL,
    roomId          TEXT NOT NULL,
    userId          TEXT NOT NULL,
    role            TEXT NOT NULL DEFAULT 'member',
    joinedAt        TEXT NOT NULL,
    leftAt          TEXT,
    durationSeconds INTEGER NOT NULL DEFAULT 0,
    FOREIGN KEY (historyId) REFERENCES roomHistory (id) ON DELETE CASCADE,
    FOREIGN KEY (userId) REFERENCES users (id) ON DELETE CASCADE,
    -- One historical participation per user per room session: reconnects and
    -- re-joins update the same row instead of duplicating it.
    UNIQUE (historyId, userId)
  );

  CREATE INDEX IF NOT EXISTS idx_room_history_members_history
    ON roomHistoryMembers (historyId);

  CREATE INDEX IF NOT EXISTS idx_room_history_members_user
    ON roomHistoryMembers (userId);

  CREATE INDEX IF NOT EXISTS idx_room_history_members_room
    ON roomHistoryMembers (roomId);

  -- ─── Social: friendships, direct messages, watch invites ─────────────────
  -- One canonical row per relationship (never A->B + B->A duplicates). The
  -- expression-based unique index enforces a single active row for the pair in
  -- either direction — rejected rows are excluded so a fresh request is
  -- possible after a rejection.

  CREATE TABLE IF NOT EXISTS friendships (
    id          TEXT PRIMARY KEY,
    requesterId TEXT NOT NULL,
    recipientId TEXT NOT NULL,
    status      TEXT NOT NULL DEFAULT 'pending',
    createdAt   TEXT NOT NULL,
    updatedAt   TEXT NOT NULL,
    acceptedAt  TEXT,
    FOREIGN KEY (requesterId) REFERENCES users (id) ON DELETE CASCADE,
    FOREIGN KEY (recipientId) REFERENCES users (id) ON DELETE CASCADE
  );

  CREATE UNIQUE INDEX IF NOT EXISTS idx_friendships_pair
    ON friendships (
      CASE WHEN requesterId < recipientId THEN requesterId ELSE recipientId END,
      CASE WHEN requesterId < recipientId THEN recipientId ELSE requesterId END
    )
    WHERE status IN ('pending', 'accepted');

  CREATE INDEX IF NOT EXISTS idx_friendships_requester
    ON friendships (requesterId, status);

  CREATE INDEX IF NOT EXISTS idx_friendships_recipient
    ON friendships (recipientId, status);

  CREATE TABLE IF NOT EXISTS directMessages (
    id          TEXT PRIMARY KEY,
    senderId    TEXT NOT NULL,
    recipientId TEXT NOT NULL,
    text        TEXT NOT NULL,
    createdAt   TEXT NOT NULL,
    -- Phase 1 realtime: canonical pair id (sorted user ids joined ':') and the
    -- per-conversation monotonically increasing sequence assigned at insert.
    -- Ordering across the whole app is by sequenceId, never by client clocks.
    conversationId TEXT,
    sequenceId     INTEGER,
    replyToMessageId TEXT,
    forwardedFromMessageId TEXT,
    deletedForEveryone INTEGER NOT NULL DEFAULT 0,
    deletedAt TEXT,
    deletedByUserId TEXT,
    -- Phase 2 advanced messaging: attachment, editing, disappearing, vanish & E2E preparation
    attachmentId TEXT,
    editedAt TEXT,
    expiresAt TEXT,
    vanish INTEGER NOT NULL DEFAULT 0,
    contentType TEXT,
    encryptionVersion TEXT,
    ciphertext TEXT,
    keyVersion TEXT,
    FOREIGN KEY (senderId) REFERENCES users (id) ON DELETE CASCADE,
    FOREIGN KEY (recipientId) REFERENCES users (id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_direct_messages_conversation
    ON directMessages (senderId, recipientId, createdAt);

  CREATE INDEX IF NOT EXISTS idx_direct_messages_recipient
    ON directMessages (recipientId, createdAt);

  -- Realtime sync/resume: fetch messages after a watermark or order by sequence.
  CREATE INDEX IF NOT EXISTS idx_direct_messages_conversation_sequence
    ON directMessages (conversationId, sequenceId);

  CREATE INDEX IF NOT EXISTS idx_direct_messages_expires
    ON directMessages (expiresAt)
    WHERE expiresAt IS NOT NULL;

  -- Per-conversation sequence counters (Phase 1 realtime). One row per
  -- conversation: lastSequence is consumed transactionally with each insert.
  CREATE TABLE IF NOT EXISTS dmConversationSequences (
    conversationId TEXT PRIMARY KEY,
    lastSequence   INTEGER NOT NULL DEFAULT 0
  );

  -- ─── Phase 2: Rich Chat Media ──────────────────────────────────────────────
  CREATE TABLE IF NOT EXISTS chatMedia (
    id             TEXT PRIMARY KEY,
    uploaderUserId TEXT NOT NULL,
    conversationId TEXT NOT NULL,
    storageKey     TEXT NOT NULL,
    thumbnailKey   TEXT,
    mimeType       TEXT NOT NULL,
    sizeBytes      INTEGER NOT NULL,
    originalName   TEXT NOT NULL,
    createdAt      TEXT NOT NULL,
    FOREIGN KEY (uploaderUserId) REFERENCES users (id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_chat_media_conversation
    ON chatMedia (conversationId);

  CREATE INDEX IF NOT EXISTS idx_chat_media_uploader
    ON chatMedia (uploaderUserId);

  -- Resumable/chunked chat media upload sessions
  CREATE TABLE IF NOT EXISTS chatMediaUploads (
    id                 TEXT PRIMARY KEY,
    uploaderUserId     TEXT NOT NULL,
    conversationId     TEXT NOT NULL,
    originalName       TEXT NOT NULL,
    mimeType           TEXT NOT NULL,
    sizeBytes          INTEGER NOT NULL,
    expectedChunks     INTEGER NOT NULL,
    receivedChunksMask TEXT NOT NULL,
    createdAt          TEXT NOT NULL,
    expiresAt          TEXT NOT NULL,
    FOREIGN KEY (uploaderUserId) REFERENCES users (id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_chat_media_uploads_expires
    ON chatMediaUploads (expiresAt);

  -- ─── Phase 2: WebPush Subscriptions ────────────────────────────────────────
  CREATE TABLE IF NOT EXISTS pushSubscriptions (
    id         TEXT PRIMARY KEY,
    userId     TEXT NOT NULL,
    endpoint   TEXT NOT NULL UNIQUE,
    p256dh     TEXT NOT NULL,
    auth       TEXT NOT NULL,
    userAgent  TEXT,
    createdAt  TEXT NOT NULL,
    FOREIGN KEY (userId) REFERENCES users (id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_push_subscriptions_user
    ON pushSubscriptions (userId);

  CREATE TABLE IF NOT EXISTS watchInvites (
    id             TEXT PRIMARY KEY,
    senderUserId   TEXT NOT NULL,
    recipientUserId TEXT NOT NULL,
    roomId         TEXT NOT NULL,
    roomCode       TEXT NOT NULL,
    roomName       TEXT NOT NULL,
    status         TEXT NOT NULL DEFAULT 'pending',
    createdAt      TEXT NOT NULL,
    expiresAt      TEXT NOT NULL,
    respondedAt    TEXT,
    FOREIGN KEY (senderUserId) REFERENCES users (id) ON DELETE CASCADE,
    FOREIGN KEY (recipientUserId) REFERENCES users (id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_watch_invites_recipient
    ON watchInvites (recipientUserId, status);

  CREATE INDEX IF NOT EXISTS idx_watch_invites_sender
    ON watchInvites (senderUserId, createdAt);

  -- ─── Direct-message context features ───────────────────────────────────────
  -- Per-user pin rows: a user can pin several messages in a conversation. The
  -- UNIQUE(messageId, pinnedByUserId) pair prevents duplicate pins of the same
  -- message by the same user. Pinned state is visible to both participants
  -- (shared message state), like WhatsApp.

  CREATE TABLE IF NOT EXISTS messagePins (
    id             TEXT PRIMARY KEY,
    messageId      TEXT NOT NULL,
    conversationId TEXT NOT NULL,
    pinnedByUserId TEXT NOT NULL,
    createdAt      TEXT NOT NULL,
    FOREIGN KEY (messageId) REFERENCES directMessages (id) ON DELETE CASCADE,
    FOREIGN KEY (pinnedByUserId) REFERENCES users (id) ON DELETE CASCADE,
    UNIQUE (messageId, pinnedByUserId)
  );

  CREATE INDEX IF NOT EXISTS idx_message_pins_message
    ON messagePins (messageId);

  CREATE INDEX IF NOT EXISTS idx_message_pins_conversation
    ON messagePins (conversationId, pinnedByUserId);

  -- Stars are strictly user-specific: only the starring user ever sees them.

  CREATE TABLE IF NOT EXISTS starredMessages (
    id        TEXT PRIMARY KEY,
    userId    TEXT NOT NULL,
    messageId TEXT NOT NULL,
    createdAt TEXT NOT NULL,
    FOREIGN KEY (userId) REFERENCES users (id) ON DELETE CASCADE,
    FOREIGN KEY (messageId) REFERENCES directMessages (id) ON DELETE CASCADE,
    UNIQUE (userId, messageId)
  );

  CREATE INDEX IF NOT EXISTS idx_starred_messages_user
    ON starredMessages (userId);

  CREATE INDEX IF NOT EXISTS idx_starred_messages_message
    ON starredMessages (messageId);

  -- "Delete for me" is a per-user tombstone: shared rows are never destroyed,
  -- each user's message queries exclude rows tombstoned for them.

  CREATE TABLE IF NOT EXISTS messageDeletions (
    id        TEXT PRIMARY KEY,
    messageId TEXT NOT NULL,
    userId    TEXT NOT NULL,
    deletedAt TEXT NOT NULL,
    FOREIGN KEY (messageId) REFERENCES directMessages (id) ON DELETE CASCADE,
    FOREIGN KEY (userId) REFERENCES users (id) ON DELETE CASCADE,
    UNIQUE (messageId, userId)
  );

  CREATE INDEX IF NOT EXISTS idx_message_deletions_user
    ON messageDeletions (userId);

  CREATE INDEX IF NOT EXISTS idx_message_deletions_message
    ON messageDeletions (messageId);

  -- Per-user conversation preferences. conversationId is the canonical pair id
  -- of the two participants (sorted-user ids joined with ':'), so both users
  -- address the same conversation while every column stays user-specific.

  CREATE TABLE IF NOT EXISTS conversationUserSettings (
    userId            TEXT NOT NULL,
    conversationId    TEXT NOT NULL,
    archived          INTEGER NOT NULL DEFAULT 0,
    pinned            INTEGER NOT NULL DEFAULT 0,
    favourite         INTEGER NOT NULL DEFAULT 0,
    locked            INTEGER NOT NULL DEFAULT 0,
    lastReadAt        TEXT,
    lastReadMessageId TEXT,
    -- Phase 1 realtime: receipt watermarks. deliveredThroughSequenceId is the
    -- highest message sequence this user has acked as delivered/read (read
    -- implies delivered). Values are per-user, so each side's sent-message
    -- status comes from the OTHER side's row.
    deliveredThroughSequenceId INTEGER NOT NULL DEFAULT 0,
    readThroughSequenceId      INTEGER NOT NULL DEFAULT 0,
    -- Phase 2 advanced messaging: disappearing message timer in seconds (0 = off, 86400 = 24h, 604800 = 7d, 7776000 = 90d)
    disappearingDuration       INTEGER NOT NULL DEFAULT 0,
    updatedAt         TEXT NOT NULL,
    PRIMARY KEY (userId, conversationId),
    FOREIGN KEY (userId) REFERENCES users (id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_conv_user_settings_user
    ON conversationUserSettings (userId);

  CREATE INDEX IF NOT EXISTS idx_conv_user_settings_conversation
    ON conversationUserSettings (conversationId);

  -- Per-user application-level chat locks. Only a server-side hash of the PIN
  -- is stored — never the plaintext PIN. This is app-level locking only.

  CREATE TABLE IF NOT EXISTS chatLocks (
    id             TEXT PRIMARY KEY,
    userId         TEXT NOT NULL,
    conversationId TEXT NOT NULL,
    pinHash        TEXT NOT NULL,
    createdAt      TEXT NOT NULL,
    updatedAt      TEXT NOT NULL,
    FOREIGN KEY (userId) REFERENCES users (id) ON DELETE CASCADE,
    UNIQUE (userId, conversationId)
  );

  -- "Delete chat" hides the conversation for the current user only.

  CREATE TABLE IF NOT EXISTS conversationDeletions (
    id             TEXT PRIMARY KEY,
    userId         TEXT NOT NULL,
    conversationId TEXT NOT NULL,
    deletedAt      TEXT NOT NULL,
    FOREIGN KEY (userId) REFERENCES users (id) ON DELETE CASCADE,
    UNIQUE (userId, conversationId)
  );

  CREATE INDEX IF NOT EXISTS idx_conversation_deletions_user
    ON conversationDeletions (userId);

  -- Private user-created custom conversation lists (owner-only visibility).

  CREATE TABLE IF NOT EXISTS conversationLists (
    id        TEXT PRIMARY KEY,
    userId    TEXT NOT NULL,
    name      TEXT NOT NULL,
    createdAt TEXT NOT NULL,
    FOREIGN KEY (userId) REFERENCES users (id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_conversation_lists_user
    ON conversationLists (userId);

  CREATE TABLE IF NOT EXISTS conversationListMembers (
    id             TEXT PRIMARY KEY,
    listId         TEXT NOT NULL,
    conversationId TEXT NOT NULL,
    createdAt      TEXT NOT NULL,
    FOREIGN KEY (listId) REFERENCES conversationLists (id) ON DELETE CASCADE,
    UNIQUE (listId, conversationId)
  );

  CREATE INDEX IF NOT EXISTS idx_conversation_list_members_list
    ON conversationListMembers (listId);

  CREATE INDEX IF NOT EXISTS idx_conversation_list_members_conversation
    ON conversationListMembers (conversationId);

  -- ─── Phase 1 realtime: user privacy settings ───────────────────────────────
  -- Server-side mirrors of the client preferences that the realtime system
  -- must honor (presence visibility, read receipts). DEFAULT 1 = visible.

  CREATE TABLE IF NOT EXISTS userPrivacySettings (
    userId             TEXT PRIMARY KEY,
    showActivityStatus INTEGER NOT NULL DEFAULT 1,
    readReceipts       INTEGER NOT NULL DEFAULT 1,
    updatedAt          TEXT NOT NULL,
    FOREIGN KEY (userId) REFERENCES users (id) ON DELETE CASCADE
  );

  -- ─── Phase B: Media Library ────────────────────────────────────────────────
  -- Durable library items. The status column is the processing lifecycle
  -- (draft/uploading/uploaded/processing/ready/failed) and published is a
  -- SEPARATE visibility flag — normal users only ever see rows where
  -- status='ready' AND published=1. storageKey is the retained ORIGINAL file
  -- (only written when MEDIA_RETAIN_ORIGINAL is enabled), playableKey is the
  -- FFmpeg-produced browser-ready MP4 that users stream and download, posterKey
  -- is the generated thumbnail. All keys are server-generated opaque strings
  -- (never client paths), binary bytes live only in MediaStorage. No
  -- semicolons inside these comments (the startup schema splitter relies on
  -- the semicolon as the statement terminator).

  CREATE TABLE IF NOT EXISTS media (
    id               TEXT PRIMARY KEY,
    title            TEXT NOT NULL,
    description      TEXT NOT NULL DEFAULT '',
    originalFilename TEXT,
    storageKey       TEXT,
    playableKey      TEXT,
    mimeType         TEXT,
    sizeBytes        INTEGER NOT NULL DEFAULT 0,
    durationSeconds  INTEGER,
    posterKey        TEXT,
    status           TEXT NOT NULL DEFAULT 'draft',
    published        INTEGER NOT NULL DEFAULT 0,
    downloadAllowed  INTEGER NOT NULL DEFAULT 1,
    createdByUserId  TEXT NOT NULL,
    createdAt        TEXT NOT NULL,
    updatedAt        TEXT NOT NULL,
    FOREIGN KEY (createdByUserId) REFERENCES users (id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_media_visibility
    ON media (published, status, createdAt DESC);

  CREATE INDEX IF NOT EXISTS idx_media_creator
    ON media (createdByUserId);

  -- Phase C: resumable chunked upload sessions. One active session per media
  -- item at a time. Chunk bytes live in MediaStorage under keys prefixed
  -- 'chunk-<uploadId>-', and the DB row tracks progress so a client can resume
  -- after a disconnect. Expired sessions are swept by the cleanup worker.
  -- receivedChunks is the count of chunk objects currently in storage.

  CREATE TABLE IF NOT EXISTS mediaUploadSessions (
    id             TEXT PRIMARY KEY,
    mediaId        TEXT NOT NULL,
    totalBytes     INTEGER NOT NULL,
    chunkSize      INTEGER NOT NULL,
    chunkCount     INTEGER NOT NULL,
    receivedBytes  INTEGER NOT NULL DEFAULT 0,
    receivedChunks INTEGER NOT NULL DEFAULT 0,
    status         TEXT NOT NULL DEFAULT 'active',
    previousStatus TEXT,
    expiresAt      TEXT NOT NULL,
    createdAt      TEXT NOT NULL,
    updatedAt      TEXT NOT NULL,
    FOREIGN KEY (mediaId) REFERENCES media (id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_media_upload_sessions_media
    ON mediaUploadSessions (mediaId);

  CREATE INDEX IF NOT EXISTS idx_media_upload_sessions_expiry
    ON mediaUploadSessions (status, expiresAt);
`;
