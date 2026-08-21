-- migrations/0001_initial_schema.sql
-- PraConnect Initial Database Schema for Cloudflare D1 / SQLite

-- 1. Users & Authentication
CREATE TABLE IF NOT EXISTS users (
  id               TEXT PRIMARY KEY,
  name             TEXT NOT NULL,
  username         TEXT NOT NULL,
  email            TEXT NOT NULL,
  passwordHash     TEXT,
  avatarUrl        TEXT,
  emailVerified    INTEGER NOT NULL DEFAULT 0,
  googleProviderId TEXT,
  role             TEXT NOT NULL DEFAULT 'user',
  createdAt        TEXT NOT NULL,
  updatedAt        TEXT NOT NULL,
  lastSeenAt       TEXT,
  bio              TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email ON users (email);
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username ON users (username);
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_google_provider_id ON users (googleProviderId) WHERE googleProviderId IS NOT NULL;

CREATE TABLE IF NOT EXISTS sessions (
  id          TEXT PRIMARY KEY,
  userId      TEXT NOT NULL,
  tokenHash   TEXT NOT NULL,
  expiresAt   TEXT NOT NULL,
  createdAt   TEXT NOT NULL,
  lastUsedAt  TEXT NOT NULL,
  FOREIGN KEY (userId) REFERENCES users (id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_sessions_token_hash ON sessions (tokenHash);
CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions (userId);
CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions (expiresAt);

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

CREATE INDEX IF NOT EXISTS idx_email_otps_lookup ON emailOtps (email, purpose, consumedAt);

CREATE TABLE IF NOT EXISTS passwordResetTokens (
  id        TEXT PRIMARY KEY,
  userId    TEXT NOT NULL,
  tokenHash TEXT NOT NULL,
  expiresAt TEXT NOT NULL,
  usedAt    TEXT,
  createdAt TEXT NOT NULL,
  FOREIGN KEY (userId) REFERENCES users (id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_prt_token_hash ON passwordResetTokens (tokenHash);

CREATE TABLE IF NOT EXISTS loginActivity (
  id                   TEXT PRIMARY KEY,
  userId               TEXT NOT NULL,
  loginTime            TEXT NOT NULL,
  location             TEXT NOT NULL,
  authenticationMethod TEXT NOT NULL,
  FOREIGN KEY (userId) REFERENCES users (id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_login_activity_user_id ON loginActivity (userId);

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

CREATE UNIQUE INDEX IF NOT EXISTS idx_pending_signups_email ON pendingSignups (email);
CREATE UNIQUE INDEX IF NOT EXISTS idx_pending_signups_username ON pendingSignups (username);

-- 2. Real-time Watch Rooms
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

CREATE UNIQUE INDEX IF NOT EXISTS idx_rooms_code ON rooms (code);
CREATE INDEX IF NOT EXISTS idx_rooms_host_user ON rooms (hostUserId);
CREATE INDEX IF NOT EXISTS idx_rooms_empty_since ON rooms (emptySince) WHERE emptySince IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_rooms_last_activity ON rooms (lastActivityAt DESC);
CREATE INDEX IF NOT EXISTS idx_rooms_privacy_activity ON rooms (privacy, lastActivityAt DESC);

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

CREATE INDEX IF NOT EXISTS idx_room_members_room ON roomMembers (roomId);
CREATE INDEX IF NOT EXISTS idx_room_members_user ON roomMembers (userId);
CREATE INDEX IF NOT EXISTS idx_room_members_user_active ON roomMembers (userId, leftAt);
CREATE INDEX IF NOT EXISTS idx_room_members_active ON roomMembers (roomId, leftAt);

CREATE TABLE IF NOT EXISTS roomEvents (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  roomId       TEXT NOT NULL,
  type         TEXT NOT NULL,
  actorUserId  TEXT,
  payloadJson  TEXT NOT NULL,
  createdAt    TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_room_events_room ON roomEvents (roomId, id);
CREATE INDEX IF NOT EXISTS idx_room_events_cleanup ON roomEvents (roomId, createdAt);

CREATE TABLE IF NOT EXISTS uploads (
  filename          TEXT PRIMARY KEY,
  roomId            TEXT NOT NULL,
  userId            TEXT NOT NULL,
  size              INTEGER NOT NULL,
  mimeType          TEXT,
  createdAt         TEXT NOT NULL,
  sourceFilename    TEXT,
  playableFilename  TEXT,
  conversionStatus  TEXT NOT NULL DEFAULT 'uploaded',
  FOREIGN KEY (roomId) REFERENCES rooms (id) ON DELETE CASCADE,
  FOREIGN KEY (userId) REFERENCES users (id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_uploads_room ON uploads (roomId);

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

CREATE UNIQUE INDEX IF NOT EXISTS idx_room_history_room ON roomHistory (roomId);
CREATE INDEX IF NOT EXISTS idx_room_history_host ON roomHistory (hostUserId);
CREATE INDEX IF NOT EXISTS idx_room_history_created ON roomHistory (createdAt DESC);

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
  UNIQUE (historyId, userId)
);

CREATE INDEX IF NOT EXISTS idx_room_history_members_history ON roomHistoryMembers (historyId);
CREATE INDEX IF NOT EXISTS idx_room_history_members_user ON roomHistoryMembers (userId);
CREATE INDEX IF NOT EXISTS idx_room_history_members_room ON roomHistoryMembers (roomId);

-- 3. Social & Messaging
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

CREATE INDEX IF NOT EXISTS idx_friendships_requester ON friendships (requesterId, status);
CREATE INDEX IF NOT EXISTS idx_friendships_recipient ON friendships (recipientId, status);

CREATE TABLE IF NOT EXISTS directMessages (
  id                     TEXT PRIMARY KEY,
  senderId               TEXT NOT NULL,
  recipientId            TEXT NOT NULL,
  text                   TEXT NOT NULL,
  createdAt              TEXT NOT NULL,
  conversationId         TEXT,
  sequenceId             INTEGER,
  replyToMessageId       TEXT,
  forwardedFromMessageId TEXT,
  deletedForEveryone     INTEGER NOT NULL DEFAULT 0,
  deletedAt              TEXT,
  deletedByUserId        TEXT,
  attachmentId           TEXT,
  editedAt               TEXT,
  expiresAt              TEXT,
  vanish                 INTEGER NOT NULL DEFAULT 0,
  contentType            TEXT,
  encryptionVersion      TEXT,
  ciphertext             TEXT,
  keyVersion             TEXT,
  FOREIGN KEY (senderId) REFERENCES users (id) ON DELETE CASCADE,
  FOREIGN KEY (recipientId) REFERENCES users (id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_direct_messages_conversation ON directMessages (senderId, recipientId, createdAt);
CREATE INDEX IF NOT EXISTS idx_direct_messages_sender ON directMessages (senderId, createdAt);
CREATE INDEX IF NOT EXISTS idx_direct_messages_recipient ON directMessages (recipientId, createdAt);
CREATE INDEX IF NOT EXISTS idx_direct_messages_conversation_sequence ON directMessages (conversationId, sequenceId);
CREATE INDEX IF NOT EXISTS idx_direct_messages_conv_seq ON directMessages (conversationId, sequenceId DESC, createdAt DESC);
CREATE INDEX IF NOT EXISTS idx_direct_messages_expires ON directMessages (expiresAt) WHERE expiresAt IS NOT NULL;

CREATE TABLE IF NOT EXISTS dmConversationSequences (
  conversationId TEXT PRIMARY KEY,
  lastSequence   INTEGER NOT NULL DEFAULT 0
);

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

CREATE INDEX IF NOT EXISTS idx_chat_media_conversation ON chatMedia (conversationId);
CREATE INDEX IF NOT EXISTS idx_chat_media_uploader ON chatMedia (uploaderUserId);

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

CREATE INDEX IF NOT EXISTS idx_chat_media_uploads_expires ON chatMediaUploads (expiresAt);

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

CREATE INDEX IF NOT EXISTS idx_push_subscriptions_user ON pushSubscriptions (userId);

CREATE TABLE IF NOT EXISTS watchInvites (
  id              TEXT PRIMARY KEY,
  senderUserId    TEXT NOT NULL,
  recipientUserId TEXT NOT NULL,
  roomId          TEXT NOT NULL,
  roomCode        TEXT NOT NULL,
  roomName        TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'pending',
  createdAt       TEXT NOT NULL,
  expiresAt       TEXT NOT NULL,
  respondedAt     TEXT,
  FOREIGN KEY (senderUserId) REFERENCES users (id) ON DELETE CASCADE,
  FOREIGN KEY (recipientUserId) REFERENCES users (id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_watch_invites_recipient ON watchInvites (recipientUserId, status);
CREATE INDEX IF NOT EXISTS idx_watch_invites_sender ON watchInvites (senderUserId, createdAt);

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

CREATE INDEX IF NOT EXISTS idx_message_pins_message ON messagePins (messageId);
CREATE INDEX IF NOT EXISTS idx_message_pins_conversation ON messagePins (conversationId, pinnedByUserId);

CREATE TABLE IF NOT EXISTS starredMessages (
  id        TEXT PRIMARY KEY,
  userId    TEXT NOT NULL,
  messageId TEXT NOT NULL,
  createdAt TEXT NOT NULL,
  FOREIGN KEY (userId) REFERENCES users (id) ON DELETE CASCADE,
  FOREIGN KEY (messageId) REFERENCES directMessages (id) ON DELETE CASCADE,
  UNIQUE (userId, messageId)
);

CREATE INDEX IF NOT EXISTS idx_starred_messages_user ON starredMessages (userId);
CREATE INDEX IF NOT EXISTS idx_starred_messages_message ON starredMessages (messageId);

CREATE TABLE IF NOT EXISTS messageReactions (
  id             TEXT PRIMARY KEY,
  messageId      TEXT NOT NULL,
  conversationId TEXT NOT NULL,
  userId         TEXT NOT NULL,
  emoji          TEXT NOT NULL,
  createdAt      TEXT NOT NULL,
  FOREIGN KEY (messageId) REFERENCES directMessages (id) ON DELETE CASCADE,
  FOREIGN KEY (userId) REFERENCES users (id) ON DELETE CASCADE,
  UNIQUE (messageId, userId, emoji)
);

CREATE INDEX IF NOT EXISTS idx_message_reactions_message ON messageReactions (messageId);
CREATE INDEX IF NOT EXISTS idx_message_reactions_conv ON messageReactions (conversationId);

CREATE TABLE IF NOT EXISTS messageDeletions (
  id        TEXT PRIMARY KEY,
  messageId TEXT NOT NULL,
  userId    TEXT NOT NULL,
  deletedAt TEXT NOT NULL,
  FOREIGN KEY (messageId) REFERENCES directMessages (id) ON DELETE CASCADE,
  FOREIGN KEY (userId) REFERENCES users (id) ON DELETE CASCADE,
  UNIQUE (messageId, userId)
);

CREATE INDEX IF NOT EXISTS idx_message_deletions_user ON messageDeletions (userId);
CREATE INDEX IF NOT EXISTS idx_message_deletions_message ON messageDeletions (messageId);

CREATE TABLE IF NOT EXISTS conversationUserSettings (
  userId                     TEXT NOT NULL,
  conversationId             TEXT NOT NULL,
  archived                   INTEGER NOT NULL DEFAULT 0,
  pinned                     INTEGER NOT NULL DEFAULT 0,
  favourite                  INTEGER NOT NULL DEFAULT 0,
  locked                     INTEGER NOT NULL DEFAULT 0,
  lastReadAt                 TEXT,
  lastReadMessageId          TEXT,
  deliveredThroughSequenceId INTEGER NOT NULL DEFAULT 0,
  readThroughSequenceId      INTEGER NOT NULL DEFAULT 0,
  disappearingDuration       INTEGER NOT NULL DEFAULT 0,
  updatedAt                  TEXT NOT NULL,
  PRIMARY KEY (userId, conversationId),
  FOREIGN KEY (userId) REFERENCES users (id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_conv_user_settings_user ON conversationUserSettings (userId);
CREATE INDEX IF NOT EXISTS idx_conv_user_settings_conversation ON conversationUserSettings (conversationId);

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

CREATE TABLE IF NOT EXISTS conversationDeletions (
  id             TEXT PRIMARY KEY,
  userId         TEXT NOT NULL,
  conversationId TEXT NOT NULL,
  deletedAt      TEXT NOT NULL,
  FOREIGN KEY (userId) REFERENCES users (id) ON DELETE CASCADE,
  UNIQUE (userId, conversationId)
);

CREATE INDEX IF NOT EXISTS idx_conversation_deletions_user ON conversationDeletions (userId);

CREATE TABLE IF NOT EXISTS conversationLists (
  id        TEXT PRIMARY KEY,
  userId    TEXT NOT NULL,
  name      TEXT NOT NULL,
  createdAt TEXT NOT NULL,
  FOREIGN KEY (userId) REFERENCES users (id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_conversation_lists_user ON conversationLists (userId);

CREATE TABLE IF NOT EXISTS conversationListMembers (
  id             TEXT PRIMARY KEY,
  listId         TEXT NOT NULL,
  conversationId TEXT NOT NULL,
  createdAt      TEXT NOT NULL,
  FOREIGN KEY (listId) REFERENCES conversationLists (id) ON DELETE CASCADE,
  UNIQUE (listId, conversationId)
);

CREATE INDEX IF NOT EXISTS idx_conversation_list_members_list ON conversationListMembers (listId);
CREATE INDEX IF NOT EXISTS idx_conversation_list_members_conversation ON conversationListMembers (conversationId);

CREATE TABLE IF NOT EXISTS userPrivacySettings (
  userId             TEXT PRIMARY KEY,
  showActivityStatus INTEGER NOT NULL DEFAULT 1,
  readReceipts       INTEGER NOT NULL DEFAULT 1,
  updatedAt          TEXT NOT NULL,
  FOREIGN KEY (userId) REFERENCES users (id) ON DELETE CASCADE
);

-- 4. Media Library
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

CREATE INDEX IF NOT EXISTS idx_media_visibility ON media (published, status, createdAt DESC);
CREATE INDEX IF NOT EXISTS idx_media_creator ON media (createdByUserId);

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

CREATE INDEX IF NOT EXISTS idx_media_upload_sessions_media ON mediaUploadSessions (mediaId);
CREATE INDEX IF NOT EXISTS idx_media_upload_sessions_expiry ON mediaUploadSessions (status, expiresAt);
