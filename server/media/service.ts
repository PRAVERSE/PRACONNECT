// server/media/service.ts
// Phase B: Media Library service — DB queries, validation, lifecycle
// transitions, and response sanitizers. Routes stay thin; storage lives in
// server/storage (MediaStorage). No binary video data ever lives here.
//
// Visibility rule: normal users only ever see rows where
//   status = 'ready' AND published = 1
// Admin endpoints see every row (any status / published flag).

import { db } from '../db/index';
import { generateId } from '../auth/auth';
import { MAX_ADMIN_MEDIA_BYTES } from './config';

// ─── Lifecycle ───────────────────────────────────────────────────────────────

export const MEDIA_STATUSES = ['draft', 'uploading', 'uploaded', 'processing', 'ready', 'failed'] as const;
export type MediaStatus = (typeof MEDIA_STATUSES)[number];

/** Allowed status transitions. Phase C inserts 'processing' between
 *  'uploaded' and 'ready' for FFmpeg/conversion pipelines. */
export const MEDIA_TRANSITIONS: Record<MediaStatus, MediaStatus[]> = {
  draft: ['uploading', 'ready', 'failed'],
  uploading: ['uploaded', 'failed'],
  uploaded: ['processing', 'ready', 'failed'],
  processing: ['ready', 'failed'],
  ready: ['uploading', 'failed'],
  // 'failed' can go back to 'uploaded' to retry the conversion with the
  // retained chunk objects (complete → convert again).
  failed: ['uploading', 'ready', 'uploaded'],
};

// ─── Limits & defaults ───────────────────────────────────────────────────────

export const MEDIA_TITLE_MAX = 200;
export const MEDIA_DESCRIPTION_MAX = 2000;
export const MEDIA_FILENAME_MAX = 200;
export const MEDIA_PAGE_SIZE_DEFAULT = 20;
export const MEDIA_PAGE_SIZE_MAX = 100;

/** Hard cap for a single library file (Phase C: 10 GiB default via
 *  MAX_ADMIN_MEDIA_BYTES — a safe upper bound, never unlimited). */
export const MEDIA_MAX_SIZE_BYTES: number = MAX_ADMIN_MEDIA_BYTES;

// ─── Row shape ───────────────────────────────────────────────────────────────

export interface MediaRow {
  id: string;
  title: string;
  description: string;
  originalFilename: string | null;
  storageKey: string | null;
  playableKey: string | null;
  mimeType: string | null;
  sizeBytes: number;
  durationSeconds: number | null;
  posterKey: string | null;
  status: MediaStatus;
  published: boolean;
  downloadAllowed: boolean;
  createdByUserId: string;
  createdAt: string;
  updatedAt: string;
  creatorName?: string;
}

export interface MediaPage<T = MediaRow> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
}

// ─── Validation ──────────────────────────────────────────────────────────────

export interface MediaCreateInput {
  title: string;
  description?: string;
  originalFilename?: string | null;
  mimeType?: string | null;
  sizeBytes?: number | null;
  downloadAllowed?: boolean;
  published?: boolean;
}

export type MediaUpdateInput = Partial<MediaCreateInput>;

/** Validate a video MIME string. Returns a normalized value or null. */
export function validateVideoMimeType(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const mime = value.trim().toLowerCase();
  if (!/^video\/[a-z0-9.+-]+$/i.test(mime)) return null;
  return mime;
}

const EXTENSION_MIME: Record<string, string> = {
  mp4: 'video/mp4',
  webm: 'video/webm',
  mkv: 'video/x-matroska',
  mov: 'video/quicktime',
  avi: 'video/x-msvideo',
  m4v: 'video/x-m4v',
  mpeg: 'video/mpeg',
  mpg: 'video/mpeg',
  '3gp': 'video/3gpp',
  ogv: 'video/ogg',
  ts: 'video/mp2t',
  mts: 'video/mp2t',
  m2ts: 'video/mp2t',
  flv: 'video/x-flv',
  wmv: 'video/x-ms-wmv',
};

/** Derive a video MIME from a filename extension, or null when unknown. */
export function mimeFromExtension(filename: string | null): string | null {
  if (!filename) return null;
  const ext = filename.split('.').pop()?.toLowerCase();
  return ext && EXTENSION_MIME[ext] ? EXTENSION_MIME[ext] : null;
}

/** Strip directory parts / control characters from a client-supplied
 *  filename. Display metadata only — never used to build filesystem paths. */
export function sanitizeOriginalFilename(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  let base = value.split(/[\\/]/).pop() ?? '';
  base = base.replace(/[\u0000-\u001f\u007f]/g, '').trim();
  if (!base || base === '.' || base === '..') return null;
  return base.slice(0, MEDIA_FILENAME_MAX);
}

/** Lowercased, charset-limited extension of a filename (or null). */
export function safeExtensionFromFilename(filename: string | null): string | null {
  if (!filename) return null;
  const ext = filename.split('.').pop()?.toLowerCase();
  return ext && /^[a-z0-9]{1,8}$/.test(ext) ? ext : null;
}

/** Server-generated storage key — opaque, no user input, can never traverse. */
export function generateStorageKey(ext: string | null): string {
  const random = Array.from(crypto.getRandomValues(new Uint8Array(8)))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  return `m-${generateId()}-${random}${ext ? `.${ext}` : ''}`;
}

/** Validate create/update metadata. Returns a list of human-readable errors. */
export function validateMediaMetadata(
  input: MediaCreateInput | MediaUpdateInput,
  opts: { partial: boolean }
): string[] {
  const errors: string[] = [];
  const { partial } = opts;

  const checkTitle = () => {
    if (typeof input.title !== 'string') {
      if (!partial) errors.push('Title is required.');
      return;
    }
    const title = input.title.trim();
    if (title.length < 1) errors.push('Title is required.');
    else if (title.length > MEDIA_TITLE_MAX) {
      errors.push(`Title must be at most ${MEDIA_TITLE_MAX} characters.`);
    }
  };
  if (!partial || input.title !== undefined) checkTitle();

  if (input.description !== undefined && typeof input.description !== 'string') {
    errors.push('Description must be a string.');
  } else if (
    typeof input.description === 'string' &&
    input.description.trim().length > MEDIA_DESCRIPTION_MAX
  ) {
    errors.push(`Description must be at most ${MEDIA_DESCRIPTION_MAX} characters.`);
  }

  if (input.mimeType !== undefined && input.mimeType !== null) {
    if (!validateVideoMimeType(input.mimeType)) {
      errors.push('MIME type must be a video/* type.');
    }
  }

  if (input.sizeBytes !== undefined && input.sizeBytes !== null) {
    if (typeof input.sizeBytes !== 'number' || !Number.isFinite(input.sizeBytes)) {
      errors.push('Size must be a number.');
    } else if (input.sizeBytes < 0) {
      errors.push('Size cannot be negative.');
    } else if (input.sizeBytes > MEDIA_MAX_SIZE_BYTES) {
      errors.push('Size exceeds the maximum allowed file size.');
    }
  }

  if (input.downloadAllowed !== undefined && typeof input.downloadAllowed !== 'boolean') {
    errors.push('downloadAllowed must be a boolean.');
  }
  if (input.published !== undefined && typeof input.published !== 'boolean') {
    errors.push('published must be a boolean.');
  }

  return errors;
}

// ─── Queries ─────────────────────────────────────────────────────────────────

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

function rowToMedia(row: Record<string, unknown>): MediaRow {
  return {
    id: row.id as string,
    title: row.title as string,
    description: (row.description as string) ?? '',
    originalFilename: (row.originalFilename as string | null) ?? null,
    storageKey: (row.storageKey as string | null) ?? null,
    playableKey: (row.playableKey as string | null) ?? null,
    mimeType: (row.mimeType as string | null) ?? null,
    sizeBytes: (row.sizeBytes as number) ?? 0,
    durationSeconds: (row.durationSeconds as number) ?? null,
    posterKey: (row.posterKey as string | null) ?? null,
    status: (row.status as MediaStatus) ?? 'draft',
    published: (row.published as number) === 1,
    downloadAllowed: (row.downloadAllowed as number) === 1,
    createdByUserId: row.createdByUserId as string,
    createdAt: row.createdAt as string,
    updatedAt: row.updatedAt as string,
    creatorName: row.creatorName as string | undefined,
  };
}

function normalizePage(pageRaw: unknown, pageSizeRaw: unknown): { page: number; pageSize: number } | null {
  const page = pageRaw === undefined || pageRaw === '' ? 1 : Number(pageRaw);
  const pageSize = pageSizeRaw === undefined || pageSizeRaw === '' ? MEDIA_PAGE_SIZE_DEFAULT : Number(pageSizeRaw);
  if (!Number.isInteger(page) || page < 1) return null;
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > MEDIA_PAGE_SIZE_MAX) return null;
  return { page, pageSize };
}

function whereForQuery(q: string): { clause: string; params: string[] } {
  if (!q) return { clause: '', params: [] };
  const pattern = `%${escapeLike(q)}%`;
  return {
    clause: " AND (m.title LIKE ? ESCAPE '\\' OR m.description LIKE ? ESCAPE '\\')",
    params: [pattern, pattern],
  };
}

// ─── Pre-compiled statements for media queries ────────────────────────────────
const countPublishedMediaStmt = db.prepare<[], { n: number }>(
  "SELECT COUNT(*) AS n FROM media m WHERE m.published = 1 AND m.status = 'ready'"
);

const getPublishedMediaPageStmt = db.prepare<[number, number], Record<string, unknown>>(`
  SELECT m.* FROM media m
  WHERE m.published = 1 AND m.status = 'ready'
  ORDER BY m.createdAt DESC, m.id DESC
  LIMIT ? OFFSET ?
`);

const getPublishedMediaByIdStmt = db.prepare<[string], Record<string, unknown>>(`
  SELECT * FROM media WHERE id = ? AND published = 1 AND status = 'ready'
`);

const getAdminMediaByIdStmt = db.prepare<[string], Record<string, unknown>>(`
  SELECT m.*, u.name AS creatorName FROM media m JOIN users u ON u.id = m.createdByUserId WHERE m.id = ?
`);

/** Published + ready items for normal users, newest first. */
export function listPublishedMedia(opts: {
  q?: string;
  page?: unknown;
  pageSize?: unknown;
}): MediaPage | null {
  const p = normalizePage(opts.page, opts.pageSize);
  if (!p) return null;
  const q = (opts.q ?? '').trim();

  let total: number;
  let rows: Record<string, unknown>[];

  if (!q) {
    total = countPublishedMediaStmt.get()?.n ?? 0;
    rows = getPublishedMediaPageStmt.all(p.pageSize, (p.page - 1) * p.pageSize);
  } else {
    const { clause, params } = whereForQuery(q);
    total = (
      db
        .prepare(`SELECT COUNT(*) AS n FROM media m WHERE m.published = 1 AND m.status = 'ready'${clause}`)
        .get(...params) as { n: number }
    ).n;
    rows = db
      .prepare(
        `SELECT m.* FROM media m
         WHERE m.published = 1 AND m.status = 'ready'${clause}
         ORDER BY m.createdAt DESC, m.id DESC
         LIMIT ? OFFSET ?`
      )
      .all(...params, p.pageSize, (p.page - 1) * p.pageSize) as unknown as Record<string, unknown>[];
  }

  return {
    items: rows.map(rowToMedia),
    total,
    page: p.page,
    pageSize: p.pageSize,
    hasMore: p.page * p.pageSize < total,
  };
}

/** Every library item (admin view), newest first, with the creator's name. */
export function listAdminMedia(opts: {
  q?: string;
  page?: unknown;
  pageSize?: unknown;
}): MediaPage | null {
  const p = normalizePage(opts.page, opts.pageSize);
  if (!p) return null;
  const q = (opts.q ?? '').trim();
  const { clause, params } = whereForQuery(q);

  const total = (
    db
      .prepare(`SELECT COUNT(*) AS n FROM media m${clause ? ` WHERE ${clause.trim().replace(/^AND/, '')}` : ''}`)
      .get(...params) as { n: number }
  ).n;

  const rows = db
    .prepare(
      `SELECT m.*, u.name AS creatorName FROM media m
       JOIN users u ON u.id = m.createdByUserId
       ${clause.trim().replace(/^AND/, 'WHERE')}
       ORDER BY m.createdAt DESC, m.id DESC
       LIMIT ? OFFSET ?`
    )
    .all(...params, p.pageSize, (p.page - 1) * p.pageSize) as unknown as Record<string, unknown>[];

  return {
    items: rows.map(rowToMedia),
    total,
    page: p.page,
    pageSize: p.pageSize,
    hasMore: p.page * p.pageSize < total,
  };
}

/** A single item visible to normal users (published + ready), or null. */
export function getPublishedMedia(id: string): MediaRow | null {
  const row = getPublishedMediaByIdStmt.get(id);
  return row ? rowToMedia(row) : null;
}

/** Any item by id, with the creator's name (admin view), or null. */
export function getAdminMedia(id: string): MediaRow | null {
  const row = getAdminMediaByIdStmt.get(id);
  return row ? rowToMedia(row) : null;
}

// ─── Mutations ───────────────────────────────────────────────────────────────

export function createMediaRecord(userId: string, input: MediaCreateInput): MediaRow {
  const now = new Date().toISOString();
  const row = {
    id: generateId(),
    title: input.title.trim(),
    description: (input.description ?? '').trim(),
    originalFilename: sanitizeOriginalFilename(input.originalFilename ?? null),
    storageKey: null,
    mimeType: input.mimeType && validateVideoMimeType(input.mimeType) ? validateVideoMimeType(input.mimeType) : null,
    sizeBytes: typeof input.sizeBytes === 'number' && Number.isFinite(input.sizeBytes) ? Math.max(0, input.sizeBytes) : 0,
    durationSeconds: null,
    posterKey: null,
    status: 'draft' as MediaStatus,
    published: input.published === true ? 1 : 0,
    downloadAllowed: input.downloadAllowed !== false ? 1 : 0,
    createdByUserId: userId,
    createdAt: now,
    updatedAt: now,
  };
  db.prepare(
    `INSERT INTO media (id, title, description, originalFilename, storageKey, mimeType, sizeBytes, durationSeconds, posterKey, status, published, downloadAllowed, createdByUserId, createdAt, updatedAt)
     VALUES (@id, @title, @description, @originalFilename, @storageKey, @mimeType, @sizeBytes, @durationSeconds, @posterKey, @status, @published, @downloadAllowed, @createdByUserId, @createdAt, @updatedAt)`
  ).run(row as unknown as Record<string, unknown>);
  return rowToMedia(row as unknown as Record<string, unknown>);
}

/** Apply a metadata patch. Returns the updated row, or null when missing. */
export function updateMediaRecord(id: string, patch: MediaUpdateInput): MediaRow | null {
  const existing = getAdminMedia(id);
  if (!existing) return null;

  const now = new Date().toISOString();
  const fields: string[] = [];
  const values: unknown[] = [];

  if (patch.title !== undefined) {
    fields.push('title = ?');
    values.push(patch.title.trim());
  }
  if (patch.description !== undefined) {
    fields.push('description = ?');
    values.push(patch.description.trim());
  }
  if (patch.originalFilename !== undefined) {
    fields.push('originalFilename = ?');
    values.push(sanitizeOriginalFilename(patch.originalFilename ?? null));
  }
  if (patch.mimeType !== undefined && patch.mimeType !== null) {
    fields.push('mimeType = ?');
    values.push(validateVideoMimeType(patch.mimeType));
  }
  if (patch.sizeBytes !== undefined && patch.sizeBytes !== null) {
    fields.push('sizeBytes = ?');
    values.push(Math.max(0, Math.round(patch.sizeBytes)));
  }
  if (patch.downloadAllowed !== undefined) {
    fields.push('downloadAllowed = ?');
    values.push(patch.downloadAllowed ? 1 : 0);
  }
  if (patch.published !== undefined) {
    fields.push('published = ?');
    values.push(patch.published ? 1 : 0);
  }

  if (fields.length === 0) return existing;
  fields.push('updatedAt = ?');
  values.push(now);
  values.push(id);

  db.prepare(`UPDATE media SET ${fields.join(', ')} WHERE id = ?`).run(...values);
  return getAdminMedia(id);
}

/** Delete the row; returns the deleted row so callers can remove stored files. */
export function deleteMediaRecord(id: string): MediaRow | null {
  const existing = getAdminMedia(id);
  if (!existing) return null;
  db.prepare('DELETE FROM media WHERE id = ?').run(id);
  return existing;
}

export function setMediaPublished(id: string, published: boolean): MediaRow | null {
  const existing = getAdminMedia(id);
  if (!existing) return null;
  db.prepare('UPDATE media SET published = ?, updatedAt = ? WHERE id = ?').run(
    published ? 1 : 0,
    new Date().toISOString(),
    id
  );
  return getAdminMedia(id);
}

/** Guarded lifecycle transition. `from` is the set of statuses that may move
 *  to `to`. Returns the reason when the transition is not allowed. */
export function transitionMediaStatus(
  id: string,
  to: MediaStatus
): { ok: boolean; row: MediaRow | null; reason?: string } {
  const row = getAdminMedia(id);
  if (!row) return { ok: false, row: null, reason: 'not_found' };
  const allowed = MEDIA_TRANSITIONS[row.status];
  if (!allowed.includes(to)) {
    return { ok: false, row, reason: `Cannot transition ${row.status} → ${to}` };
  }
  db.prepare('UPDATE media SET status = ?, updatedAt = ? WHERE id = ?').run(
    to,
    new Date().toISOString(),
    id
  );
  return { ok: true, row: getAdminMedia(id) };
}

/** Record a finished conversion: the playable MP4 (+ optional retained
 *  original + poster) now live in storage and the item is ready. */
export function applyConversionResult(
  id: string,
  result: {
    playableKey: string;
    storageKey: string | null;
    posterKey: string | null;
    sizeBytes: number;
    mimeType: string;
    durationSeconds: number | null;
  }
): MediaRow | null {
  db.prepare(
    `UPDATE media
     SET storageKey = ?, playableKey = ?, posterKey = ?, sizeBytes = ?, mimeType = ?, durationSeconds = ?, status = 'ready', updatedAt = ?
     WHERE id = ?`
  ).run(
    result.storageKey,
    result.playableKey,
    result.posterKey,
    result.sizeBytes,
    result.mimeType,
    result.durationSeconds,
    new Date().toISOString(),
    id
  );
  return getAdminMedia(id);
}

// ─── Response sanitizers ─────────────────────────────────────────────────────

/** Shape sent to normal users — never leaks storageKey/posterKey. */
export function toPublicMedia(row: MediaRow) {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    posterUrl: null,
    duration: row.durationSeconds,
    sizeBytes: row.sizeBytes,
    mimeType: row.mimeType,
    status: row.status,
    published: row.published,
    downloadAllowed: row.downloadAllowed,
    createdAt: row.createdAt,
    originalFilename: row.originalFilename,
    createdByUserId: row.createdByUserId,
    creatorName: row.creatorName,
  };
}

/** Admin shape — includes storage bookkeeping fields. */
export function toAdminMedia(row: MediaRow) {
  return {
    ...toPublicMedia(row),
    storageKey: row.storageKey,
    playableKey: row.playableKey,
    posterKey: row.posterKey,
    updatedAt: row.updatedAt,
  };
}

// ─── HTTP Range parsing ──────────────────────────────────────────────────────

export type RangeResult =
  | { start: number; end: number }
  | { error: 'unsatisfiable' }
  | null; // no range header / malformed → serve full body

/** Parse a `Range: bytes=...` header against a known size. */
export function parseRange(header: string | undefined, size: number): RangeResult {
  if (!header) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m) return null;
  const [, a, b] = m;
  if (a === '' && b === '') return null;
  if (size <= 0) return { error: 'unsatisfiable' };
  if (a === '') {
    const suffix = Number.parseInt(b, 10);
    if (!Number.isFinite(suffix) || suffix <= 0) return { error: 'unsatisfiable' };
    return { start: Math.max(0, size - suffix), end: size - 1 };
  }
  const start = Number.parseInt(a, 10);
  const end = b === '' ? size - 1 : Number.parseInt(b, 10);
  if (!Number.isFinite(start) || start >= size || start > end) return { error: 'unsatisfiable' };
  return { start, end: Math.min(end, size - 1) };
}