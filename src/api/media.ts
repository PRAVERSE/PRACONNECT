// src/api/media.ts
// Frontend API client for the PraConnect Media Library.
//
// Normal-user endpoints:      /api/media (list/search/detail/download)
// Admin endpoints:            /api/admin/media (CRUD, publish, resumable upload)
//
// Phase C: resumable chunked uploads. The client slices a File into chunkSize
// pieces (file.slice → Blob) and streams ONE chunk per request — the full
// file is never buffered with file.arrayBuffer(). After a network failure the
// session state is re-fetched and only the missing chunks are re-sent.
// All requests carry credentials: 'include'.

import { MediaItem, MediaPage, MediaUploadSession } from '../types';

export interface MediaListResponse extends MediaPage {
  error?: {
    code: string;
    message: string;
  };
}

export interface MediaItemResponse {
  item?: MediaItem;
  error?: {
    code: string;
    message: string;
  };
}

export interface MediaMutationResponse {
  item?: MediaItem;
  ok?: boolean;
  error?: {
    code: string;
    message: string;
  };
}

export interface MediaSessionResponse {
  session?: MediaUploadSession;
  created?: boolean;
  item?: MediaItem;
  converting?: boolean;
  error?: {
    code: string;
    message: string;
  };
}

export interface MediaCreatePayload {
  title: string;
  description?: string;
  downloadAllowed?: boolean;
  published?: boolean;
}

export interface MediaUpdatePayload {
  title?: string;
  description?: string;
  downloadAllowed?: boolean;
  published?: boolean;
}

/** Chunk size used by the uploader (must match the server's default so
 *  sessions started by other tools resume cleanly). */
export const MEDIA_UPLOAD_CHUNK_BYTES = 8 * 1024 * 1024;

const MEDIA_PAGE_SIZE = 20;

async function readError(res: Response): Promise<{ code: string; message: string }> {
  const body = (await res.json().catch(() => ({}))) as {
    error?: { code: string; message: string };
  };
  return body.error ?? { code: 'MEDIA_ERROR', message: 'Something went wrong.' };
}

function qs(params: Record<string, string | number | undefined>): string {
  const parts = Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== '')
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`);
  return parts.length > 0 ? `?${parts.join('&')}` : '';
}

// ─── Normal-user endpoints ───────────────────────────────────────────────────

/** Published + ready media (search + pagination). */
export async function fetchMediaLibraryApi(opts?: {
  q?: string;
  page?: number;
  pageSize?: number;
}): Promise<MediaListResponse> {
  const query = qs({
    q: opts?.q?.trim() ?? '',
    page: opts?.page ?? 1,
    pageSize: opts?.pageSize ?? MEDIA_PAGE_SIZE,
  });
  try {
    const res = await fetch(`/api/media${query}`, { credentials: 'include' });
    if (!res.ok) {
      return { items: [], total: 0, page: 1, pageSize: MEDIA_PAGE_SIZE, hasMore: false, error: await readError(res) };
    }
    return await res.json();
  } catch {
    return {
      items: [],
      total: 0,
      page: 1,
      pageSize: MEDIA_PAGE_SIZE,
      hasMore: false,
      error: { code: 'NETWORK_ERROR', message: 'Unable to connect to the server.' },
    };
  }
}

/** Single published + ready item. */
export async function fetchMediaItemApi(id: string): Promise<MediaItemResponse> {
  try {
    const res = await fetch(`/api/media/${encodeURIComponent(id)}`, { credentials: 'include' });
    if (!res.ok) return { error: await readError(res) };
    return await res.json();
  } catch {
    return { error: { code: 'NETWORK_ERROR', message: 'Unable to connect to the server.' } };
  }
}

/** Authorized download/stream URL for an item (Range-capable). */
export function buildMediaDownloadUrl(id: string, opts?: { download?: boolean }): string {
  const query = opts?.download ? '?download=1' : '';
  return `/api/media/${encodeURIComponent(id)}/download${query}`;
}

/** Fetch + save the file locally (respects downloadAllowed server-side). */
export async function downloadMediaFile(
  id: string,
  fallbackName: string
): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch(buildMediaDownloadUrl(id, { download: true }), { credentials: 'include' });
    if (!res.ok) {
      const err = await readError(res);
      return { ok: false, error: err.message };
    }
    const blob = await res.blob();
    const disposition = res.headers.get('content-disposition') ?? '';
    const encoded = /filename\*=UTF-8''([^;]+)/.exec(disposition)?.[1];
    const name = encoded ? decodeURIComponent(encoded) : fallbackName;
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = name;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
    return { ok: true };
  } catch {
    return { ok: false, error: 'Unable to connect to the server.' };
  }
}

// ─── Admin endpoints (server-enforced via requireAdmin) ──────────────────────

/** Full library (any status / published flag) + search + pagination. */
export async function fetchAdminMediaApi(opts?: {
  q?: string;
  page?: number;
  pageSize?: number;
}): Promise<MediaListResponse> {
  const query = qs({
    q: opts?.q?.trim() ?? '',
    page: opts?.page ?? 1,
    pageSize: opts?.pageSize ?? MEDIA_PAGE_SIZE,
  });
  try {
    const res = await fetch(`/api/admin/media${query}`, { credentials: 'include' });
    if (!res.ok) {
      return { items: [], total: 0, page: 1, pageSize: MEDIA_PAGE_SIZE, hasMore: false, error: await readError(res) };
    }
    return await res.json();
  } catch {
    return {
      items: [],
      total: 0,
      page: 1,
      pageSize: MEDIA_PAGE_SIZE,
      hasMore: false,
      error: { code: 'NETWORK_ERROR', message: 'Unable to connect to the server.' },
    };
  }
}

/** Any item by id (admin view — any status/published flag). */
export async function fetchAdminMediaItemApi(id: string): Promise<MediaItemResponse> {
  try {
    const res = await fetch(`/api/admin/media/${encodeURIComponent(id)}`, { credentials: 'include' });
    if (!res.ok) return { error: await readError(res) };
    return await res.json();
  } catch {
    return { error: { code: 'NETWORK_ERROR', message: 'Unable to connect to the server.' } };
  }
}

/** Create media metadata (status: draft). */
export async function createAdminMediaApi(payload: MediaCreatePayload): Promise<MediaMutationResponse> {
  try {
    const res = await fetch('/api/admin/media', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(payload),
    });
    if (!res.ok) return { error: await readError(res) };
    return await res.json();
  } catch {
    return { error: { code: 'NETWORK_ERROR', message: 'Unable to connect to the server.' } };
  }
}

/** Update media metadata. */
export async function updateAdminMediaApi(
  id: string,
  payload: MediaUpdatePayload
): Promise<MediaMutationResponse> {
  try {
    const res = await fetch(`/api/admin/media/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(payload),
    });
    if (!res.ok) return { error: await readError(res) };
    return await res.json();
  } catch {
    return { error: { code: 'NETWORK_ERROR', message: 'Unable to connect to the server.' } };
  }
}

/** Delete media (row + stored files). */
export async function deleteAdminMediaApi(id: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch(`/api/admin/media/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      credentials: 'include',
    });
    if (!res.ok) {
      const err = await readError(res);
      return { ok: false, error: err.message };
    }
    return { ok: true };
  } catch {
    return { ok: false, error: 'Unable to connect to the server.' };
  }
}

async function setPublishedApi(id: string, published: boolean): Promise<MediaMutationResponse> {
  try {
    const res = await fetch(`/api/admin/media/${encodeURIComponent(id)}/${published ? 'publish' : 'unpublish'}`, {
      method: 'POST',
      credentials: 'include',
    });
    if (!res.ok) return { error: await readError(res) };
    return await res.json();
  } catch {
    return { error: { code: 'NETWORK_ERROR', message: 'Unable to connect to the server.' } };
  }
}

export function publishAdminMediaApi(id: string): Promise<MediaMutationResponse> {
  return setPublishedApi(id, true);
}

export function unpublishAdminMediaApi(id: string): Promise<MediaMutationResponse> {
  return setPublishedApi(id, false);
}

// ─── Resumable chunked upload (Phase C) ──────────────────────────────────────

/** Begin (or resume) a chunked upload for a media item. */
export async function startMediaUploadSessionApi(
  id: string,
  opts: { totalBytes: number; filename: string; mimeType: string; chunkSize?: number }
): Promise<MediaSessionResponse> {
  try {
    const res = await fetch(`/api/admin/media/${encodeURIComponent(id)}/upload/start`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Filename': encodeURIComponent(opts.filename),
        'X-Mime-Type': opts.mimeType || '',
      },
      credentials: 'include',
      body: JSON.stringify({ totalBytes: opts.totalBytes, chunkSize: opts.chunkSize ?? MEDIA_UPLOAD_CHUNK_BYTES }),
    });
    if (!res.ok) return { error: await readError(res) };
    return await res.json();
  } catch {
    return { error: { code: 'NETWORK_ERROR', message: 'Unable to connect to the server.' } };
  }
}

/** Current session state — used to resume after a failed request. */
export async function getMediaUploadSessionApi(id: string, uploadId: string): Promise<MediaSessionResponse> {
  try {
    const res = await fetch(`/api/admin/media/${encodeURIComponent(id)}/upload/${encodeURIComponent(uploadId)}`, {
      credentials: 'include',
    });
    if (!res.ok) return { error: await readError(res) };
    return await res.json();
  } catch {
    return { error: { code: 'NETWORK_ERROR', message: 'Unable to connect to the server.' } };
  }
}

/** Upload ONE chunk (a Blob slice of the file — never the whole file).
 *  Accepts an optional AbortSignal so a cancelled upload can stop the
 *  in-flight PUT; an aborted request throws (DOMException AbortError). */
export async function uploadMediaChunkApi(
  id: string,
  uploadId: string,
  index: number,
  chunk: Blob,
  signal?: AbortSignal
): Promise<MediaSessionResponse> {
  try {
    const res = await fetch(
      `/api/admin/media/${encodeURIComponent(id)}/upload/${encodeURIComponent(uploadId)}/chunks/${index}`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/octet-stream' },
        credentials: 'include',
        body: chunk,
        signal,
      }
    );
    if (!res.ok) return { error: await readError(res) };
    return await res.json();
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') throw err;
    return { error: { code: 'NETWORK_ERROR', message: 'Unable to connect to the server.' } };
  }
}

/** Finalize the upload: the server verifies chunks and starts conversion. */
export async function completeMediaUploadSessionApi(id: string, uploadId: string): Promise<MediaSessionResponse> {
  try {
    const res = await fetch(`/api/admin/media/${encodeURIComponent(id)}/upload/${encodeURIComponent(uploadId)}/complete`, {
      method: 'POST',
      credentials: 'include',
    });
    if (!res.ok) return { error: await readError(res) };
    return await res.json();
  } catch {
    return { error: { code: 'NETWORK_ERROR', message: 'Unable to connect to the server.' } };
  }
}

/** Cancel an upload: chunks + session are removed server-side. */
export async function cancelMediaUploadSessionApi(id: string, uploadId: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch(`/api/admin/media/${encodeURIComponent(id)}/upload/${encodeURIComponent(uploadId)}`, {
      method: 'DELETE',
      credentials: 'include',
    });
    if (!res.ok) {
      const err = await readError(res);
      return { ok: false, error: err.message };
    }
    return { ok: true };
  } catch {
    return { ok: false, error: 'Unable to connect to the server.' };
  }
}

/** Replace the generated poster with an admin-supplied image. */
export async function replaceMediaPosterApi(
  id: string,
  file: Blob,
  mimeType: string
): Promise<MediaMutationResponse> {
  try {
    const res = await fetch(`/api/admin/media/${encodeURIComponent(id)}/poster`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/octet-stream',
        'X-Mime-Type': mimeType,
      },
      credentials: 'include',
      body: file,
    });
    if (!res.ok) return { error: await readError(res) };
    return await res.json();
  } catch {
    return { error: { code: 'NETWORK_ERROR', message: 'Unable to connect to the server.' } };
  }
}