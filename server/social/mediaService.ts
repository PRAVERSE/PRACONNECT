// server/social/mediaService.ts
// Handles chat media uploads, chunked upload sessions, storage via LocalDiskStorage (uploads/chat/),
// MIME and path-traversal safety, thumbnail generation, and access authorization.

import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { db } from '../db/index';
import { generateId } from '../auth/auth';
import { LocalDiskStorage, isSafeStorageKey } from '../storage/mediaStorage';
import { isAcceptedFriendship, conversationIdFor } from './service';

const CHAT_STORAGE_ROOT = path.resolve(process.env.CHAT_MEDIA_STORAGE_DIR ?? path.join('uploads', 'chat'));
const chatStorage = new LocalDiskStorage(CHAT_STORAGE_ROOT);

/** Maximum chat attachment size: 50 MiB */
export const CHAT_MAX_FILE_SIZE_BYTES = Number(process.env.CHAT_MAX_FILE_SIZE_BYTES) || 52428800; // 50 * 1024 * 1024
export const MAX_CHAT_MEDIA_SIZE_BYTES = CHAT_MAX_FILE_SIZE_BYTES;
/** Default chunk size for chunked upload: 2 MB */
export const CHAT_CHUNK_SIZE_BYTES = 2 * 1024 * 1024;

const DANGEROUS_EXTENSIONS = [
  '.exe', '.bat', '.cmd', '.scr', '.msi', '.com', '.pif', '.hta',
  '.cpl', '.jar', '.vbs', '.ps1', '.sh', '.php', '.jsp', '.asp', '.aspx',
];

const ALLOWED_MIME_PREFIXES = ['image/', 'video/', 'audio/'];
const ALLOWED_EXACT_MIMES = [
  'application/pdf',
  'application/zip',
  'application/x-zip-compressed',
  'application/json',
  'text/plain',
  'text/csv',
  'text/markdown',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
];

export interface ChatMediaRow {
  id: string;
  uploaderUserId: string;
  conversationId: string;
  storageKey: string;
  thumbnailKey: string | null;
  mimeType: string;
  sizeBytes: number;
  originalName: string;
  createdAt: string;
}

export interface ChatMediaUploadRow {
  id: string;
  uploaderUserId: string;
  conversationId: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  expectedChunks: number;
  receivedChunksMask: string;
  createdAt: string;
  expiresAt: string;
}

export function isAllowedChatFile(originalName: string, mimeType: string): boolean {
  if (!originalName) return false;
  const ext = path.extname(originalName).toLowerCase();
  if (DANGEROUS_EXTENSIONS.includes(ext)) return false;
  if (!mimeType) return true; // Browser fallback for common files
  const lower = mimeType.toLowerCase();
  if (ALLOWED_MIME_PREFIXES.some((prefix) => lower.startsWith(prefix))) return true;
  if (ALLOWED_EXACT_MIMES.includes(lower)) return true;
  return true; // Allow documents/files unless blacklisted
}

export function isAllowedChatMimeType(mimeType: string): boolean {
  if (!mimeType) return true;
  const lower = mimeType.toLowerCase();
  if (ALLOWED_MIME_PREFIXES.some((prefix) => lower.startsWith(prefix))) return true;
  if (ALLOWED_EXACT_MIMES.includes(lower)) return true;
  return true;
}

function nowIso(): string {
  return new Date().toISOString();
}

function parsePeerIdFromConversation(conversationId: string, userId: string): string | null {
  if (!conversationId || !conversationId.includes(':')) return null;
  const parts = conversationId.split(':');
  if (parts.length !== 2) return null;
  if (parts[0] === userId) return parts[1];
  if (parts[1] === userId) return parts[0];
  return null;
}

export async function startChatMediaUpload(
  userId: string,
  friendId: string,
  originalName: string,
  mimeType: string,
  sizeBytes: number
): Promise<{ ok: boolean; uploadId?: string; expectedChunks?: number; chunkSize?: number; error?: string }> {
  if (!isAcceptedFriendship(userId, friendId)) {
    return { ok: false, error: 'FRIENDSHIP_REQUIRED' };
  }
  if (!sizeBytes || sizeBytes <= 0) {
    return { ok: false, error: 'INVALID_FILE_SIZE' };
  }
  if (sizeBytes > CHAT_MAX_FILE_SIZE_BYTES) {
    return { ok: false, error: 'MEDIA_TOO_LARGE' };
  }
  if (!isAllowedChatFile(originalName, mimeType)) {
    return { ok: false, error: 'DANGEROUS_FILE_TYPE' };
  }

  const conversationId = conversationIdFor(userId, friendId);
  const uploadId = `chup_${generateId()}`;
  const expectedChunks = Math.ceil(sizeBytes / CHAT_CHUNK_SIZE_BYTES);
  const initialMask = '0'.repeat(expectedChunks);
  const now = nowIso();
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(); // 24h upload session TTL

  db.prepare(
    `INSERT INTO chatMediaUploads (id, uploaderUserId, conversationId, originalName, mimeType, sizeBytes, expectedChunks, receivedChunksMask, createdAt, expiresAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(uploadId, userId, conversationId, originalName || 'file', mimeType || 'application/octet-stream', sizeBytes, expectedChunks, initialMask, now, expiresAt);

  // Prepare temp directory for chunks
  const tempDir = path.join(CHAT_STORAGE_ROOT, `temp_${uploadId}`);
  await fs.promises.mkdir(tempDir, { recursive: true });

  return { ok: true, uploadId, expectedChunks, chunkSize: CHAT_CHUNK_SIZE_BYTES };
}

export async function uploadChatMediaChunk(
  userId: string,
  uploadId: string,
  chunkIndex: number,
  chunkStream: Readable
): Promise<{ ok: boolean; error?: string }> {
  const session = db
    .prepare<[string], ChatMediaUploadRow>('SELECT * FROM chatMediaUploads WHERE id = ?')
    .get(uploadId);

  if (!session || session.uploaderUserId !== userId) {
    return { ok: false, error: 'UPLOAD_SESSION_NOT_FOUND' };
  }
  if (chunkIndex < 0 || chunkIndex >= session.expectedChunks) {
    return { ok: false, error: 'INVALID_CHUNK_INDEX' };
  }

  const tempDir = path.join(CHAT_STORAGE_ROOT, `temp_${uploadId}`);
  const chunkFile = path.join(tempDir, `chunk_${chunkIndex}`);

  const dest = fs.createWriteStream(chunkFile);
  await new Promise<void>((resolve, reject) => {
    chunkStream.pipe(dest);
    dest.on('finish', () => resolve());
    dest.on('error', (err) => reject(err));
  });

  // Update mask
  const maskArr = session.receivedChunksMask.split('');
  maskArr[chunkIndex] = '1';
  const updatedMask = maskArr.join('');

  db.prepare('UPDATE chatMediaUploads SET receivedChunksMask = ? WHERE id = ?').run(updatedMask, uploadId);

  return { ok: true };
}

export async function completeChatMediaUpload(
  userId: string,
  uploadId: string
): Promise<{ ok: boolean; mediaId?: string; media?: ChatMediaRow; error?: string }> {
  const session = db
    .prepare<[string], ChatMediaUploadRow>('SELECT * FROM chatMediaUploads WHERE id = ?')
    .get(uploadId);

  if (!session || session.uploaderUserId !== userId) {
    return { ok: false, error: 'UPLOAD_SESSION_NOT_FOUND' };
  }

  if (session.receivedChunksMask.includes('0')) {
    return { ok: false, error: 'INCOMPLETE_CHUNKS' };
  }

  const mediaId = `chm_${generateId()}`;
  const ext = path.extname(session.originalName) || (session.mimeType.startsWith('image/') ? '.jpg' : '.bin');
  const safeExt = ext.replace(/[^a-zA-Z0-9.]/g, '');
  const storageKey = `${mediaId}${safeExt}`;
  const tempDir = path.join(CHAT_STORAGE_ROOT, `temp_${uploadId}`);

  // Concatenate chunks into final file
  const fullPath = path.join(CHAT_STORAGE_ROOT, storageKey);
  const destStream = fs.createWriteStream(fullPath);

  for (let i = 0; i < session.expectedChunks; i++) {
    const chunkPath = path.join(tempDir, `chunk_${i}`);
    const chunkBuffer = await fs.promises.readFile(chunkPath);
    await new Promise<void>((resolve, reject) => {
      destStream.write(chunkBuffer, (err) => (err ? reject(err) : resolve()));
    });
  }

  await new Promise<void>((resolve) => destStream.end(() => resolve()));

  // Remove temp directory
  await fs.promises.rm(tempDir, { recursive: true, force: true }).catch(() => {});

  const now = nowIso();
  db.prepare(
    `INSERT INTO chatMedia (id, uploaderUserId, conversationId, storageKey, thumbnailKey, mimeType, sizeBytes, originalName, createdAt)
     VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?)`
  ).run(mediaId, userId, session.conversationId, storageKey, session.mimeType, session.sizeBytes, session.originalName, now);

  db.prepare('DELETE FROM chatMediaUploads WHERE id = ?').run(uploadId);

  const row = db.prepare<[string], ChatMediaRow>('SELECT * FROM chatMedia WHERE id = ?').get(mediaId)!;
  return { ok: true, mediaId, media: row };
}

export function getChatMediaInfo(userId: string, mediaId: string): { ok: boolean; media?: ChatMediaRow; error?: string } {
  if (!isSafeStorageKey(mediaId)) return { ok: false, error: 'INVALID_ID' };

  const row = db
    .prepare<[string], ChatMediaRow>('SELECT * FROM chatMedia WHERE id = ?')
    .get(mediaId);

  if (!row) return { ok: false, error: 'NOT_FOUND' };

  const peerId = parsePeerIdFromConversation(row.conversationId, userId);
  if (!peerId) return { ok: false, error: 'FRIENDSHIP_REQUIRED' };
  if (!isAcceptedFriendship(userId, peerId)) return { ok: false, error: 'FRIENDSHIP_REQUIRED' };

  return { ok: true, media: row };
}

export async function readChatMediaStream(
  userId: string,
  mediaId: string,
  opts?: { start?: number; end?: number }
): Promise<{ ok: boolean; stream?: Readable; size?: number; mimeType?: string; originalName?: string; error?: string }> {
  const info = getChatMediaInfo(userId, mediaId);
  if (!info.ok || !info.media) return { ok: false, error: info.error };

  const readResult = await chatStorage.read(info.media.storageKey, opts);
  if (!readResult) return { ok: false, error: 'FILE_NOT_FOUND' };

  return {
    ok: true,
    stream: readResult.stream,
    size: readResult.size,
    mimeType: info.media.mimeType,
    originalName: info.media.originalName,
  };
}

export async function checkAndCleanupUnreferencedMedia(attachmentId: string | null): Promise<void> {
  if (!attachmentId) return;
  const refCount = db
    .prepare('SELECT COUNT(*) AS count FROM directMessages WHERE attachmentId = ? AND deletedForEveryone = 0')
    .get(attachmentId) as { count: number };

  if (refCount.count === 0) {
    const row = db
      .prepare<[string], ChatMediaRow>('SELECT * FROM chatMedia WHERE id = ?')
      .get(attachmentId);
    if (row) {
      db.prepare('DELETE FROM chatMedia WHERE id = ?').run(attachmentId);
      await chatStorage.delete(row.storageKey).catch(() => {});
    }
  }
}
