import React, { useEffect, useRef, useState } from 'react';
import { Upload, AlertTriangle, Loader, RotateCcw } from 'lucide-react';
import {
  createAdminMediaApi,
  deleteAdminMediaApi,
  startMediaUploadSessionApi,
  uploadMediaChunkApi,
  getMediaUploadSessionApi,
  completeMediaUploadSessionApi,
  cancelMediaUploadSessionApi,
  fetchAdminMediaItemApi,
  MediaSessionResponse,
} from '../../api/media';
import { MediaUploadSession } from '../../types';

interface UploadMediaModalProps {
  open: boolean;
  onClose: () => void;
  /** Called after a successful create+upload so the library can refresh. */
  onUploaded: () => void;
}

type Phase = 'idle' | 'uploading' | 'converting' | 'done';

const CHUNK_RETRY_ATTEMPTS = 3;
const MAX_IN_FLIGHT_CHUNKS = 4;
const RETRY_BACKOFF_MS = 500;

const IS_DEV = ((import.meta as unknown as { env?: { DEV?: boolean } }).env?.DEV) ?? false;
const debug = (...args: unknown[]): void => {
  if (IS_DEV) console.log('[MEDIA UPLOAD DEBUG]', ...args);
};

/**
 * Phase C upload dialog. Creates the metadata, then runs the resumable
 * chunked pipeline: start → PUT every missing chunk (file.slice Blobs, never
 * the whole file in memory) → verify against the server → complete → server
 * conversion.
 *
 * Chunk sequencing:
 *   - The index list comes from the SERVER session (missingChunks). A fresh
 *     session with zero progress means EVERY index is missing — an empty
 *     list is never treated as "nothing to upload".
 *   - Chunks are uploaded with bounded concurrency (MAX_IN_FLIGHT_CHUNKS);
 *     a failed chunk stops the batch — complete is NEVER called after a
 *     chunk failure.
 *   - Each chunk retries up to CHUNK_RETRY_ATTEMPTS; after that the upload
 *     stops with "Upload stopped at chunk N. Please retry." and the session
 *     stays resumable (Retry Upload re-fetches only the missing chunks).
 *   - Cancel (Stop) aborts in-flight requests via AbortController, keeps the
 *     session resumable, and never calls complete.
 *
 * Progress is REAL: uploadedBytes is the sum of server-acknowledged chunk
 * bytes (initialized from the session's receivedBytes on resume).
 */
export const UploadMediaModal: React.FC<UploadMediaModalProps> = ({ open, onClose, onUploaded }) => {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [downloadAllowed, setDownloadAllowed] = useState(true);
  const [published, setPublished] = useState(false);

  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [phase, setPhase] = useState<Phase>('idle');
  const [session, setSession] = useState<MediaUploadSession | null>(null);
  const [mediaId, setMediaId] = useState<string | null>(null);
  const [uploadId, setUploadId] = useState<string | null>(null);
  const [uploadedBytes, setUploadedBytes] = useState(0);
  const abortRef = useRef<AbortController | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setError(null);
      setBusy(false);
      setPhase('idle');
      setSession(null);
      setMediaId(null);
      setUploadId(null);
      setUploadedBytes(0);
      abortRef.current = null;
    }
  }, [open]);

  if (!open) return null;

  const resetForm = () => {
    setTitle('');
    setDescription('');
    setFile(null);
    setDownloadAllowed(true);
    setPublished(false);
    setError(null);
    setPhase('idle');
    setSession(null);
    setMediaId(null);
    setUploadId(null);
    setUploadedBytes(0);
    abortRef.current = null;
  };

  const cleanupAndClose = async () => {
    const id = mediaId;
    const upId = uploadId;
    abortRef.current?.abort();
    abortRef.current = null;
    if (id && upId) {
      await cancelMediaUploadSessionApi(id, upId).catch(() => {});
    }
    if (id) {
      await deleteAdminMediaApi(id).catch(() => {});
    }
    resetForm();
    onClose();
  };

  const handleClose = () => {
    if (phase === 'converting') return;
    if (busy) {
      // Stopping an in-flight upload: abort the requests, keep the session so
      // Retry Upload can resume from the last acknowledged chunk.
      abortRef.current?.abort();
      abortRef.current = null;
      setBusy(false);
      setPhase('idle');
      setError('Upload cancelled. Your progress was kept — click Retry Upload to resume.');
      return;
    }
    void cleanupAndClose();
  };

  /** Upload one chunk with up to CHUNK_RETRY_ATTEMPTS attempts; resolves with
   *  the server session. Server-side rejections (validation/conflict/not-found)
   *  are authoritative and are NOT retried — only transient network failures
   *  are. Throws when the chunk can never succeed. */
  const uploadChunkWithRetry = async (
    id: string,
    uploadId: string,
    index: number,
    start: number,
    end: number,
    chunk: Blob,
    signal: AbortSignal
  ): Promise<MediaUploadSession> => {
    for (let attempt = 1; attempt <= CHUNK_RETRY_ATTEMPTS; attempt++) {
      if (signal.aborted) throw new Error('Upload cancelled.');
      debug('CHUNK START', { index, start, end, bytes: end - start, attempt });
      let res: MediaSessionResponse;
      try {
        res = await uploadMediaChunkApi(id, uploadId, index, chunk, signal);
      } catch (err) {
        if (signal.aborted || (err instanceof DOMException && err.name === 'AbortError')) {
          throw new Error('Upload cancelled.');
        }
        const message = err instanceof Error ? err.message : `Chunk ${index} could not be uploaded.`;
        debug('CHUNK FAILED', { index, attempt, error: message });
        if (attempt < CHUNK_RETRY_ATTEMPTS) {
          await new Promise((r) => setTimeout(r, RETRY_BACKOFF_MS * attempt));
        }
        continue;
      }
      if (res.session) {
        debug('CHUNK SUCCESS', { index, bytes: end - start, status: 200 });
        return res.session;
      }
      const code = res.error?.code;
      const message = res.error?.message ?? `Chunk ${index} could not be uploaded.`;
      debug('CHUNK FAILED', { index, status: code ?? 'error', attempt, error: message });
      if (code && code !== 'NETWORK_ERROR') {
        throw new Error(`Upload failed while sending chunk ${index}: ${message}`);
      }
      if (attempt < CHUNK_RETRY_ATTEMPTS) {
        await new Promise((r) => setTimeout(r, RETRY_BACKOFF_MS * attempt));
      }
    }
    throw new Error(`Upload stopped at chunk ${index}. Please retry.`);
  };

  /** Upload every missing chunk with bounded concurrency. Every chunk PUT is
   *  awaited before the next batch; if ANY chunk exhausts its retries the
   *  whole batch rejects and complete is never called. */
  const uploadAllChunks = async (
    id: string,
    file: File,
    initial: MediaUploadSession,
    signal: AbortSignal
  ): Promise<MediaUploadSession> => {
    const { chunkSize, totalBytes, chunkCount } = initial;

    // Resolve which indexes still need bytes — always from the SERVER-returned
    // session, never from the client's own assumptions about chunk size.
    let indexes: number[] = [];
    if (initial.missingChunks && initial.missingChunks.length > 0) {
      indexes = initial.missingChunks.filter((i) => Number.isInteger(i) && i >= 0 && i < chunkCount);
    } else if (initial.receivedBytes > 0 || initial.receivedChunks > 0) {
      // Progress exists but no missing list (legacy server) — ask the server.
      const state = await getMediaUploadSessionApi(id, initial.id);
      if (!state.session) throw new Error(state.error?.message ?? 'Could not read the upload session.');
      indexes = (state.session.missingChunks ?? []).filter((i) => Number.isInteger(i) && i >= 0 && i < chunkCount);
    } else {
      // Fresh session: zero progress + empty/absent missing list = everything
      // is missing. An empty list on a fresh session is NOT "nothing to do".
      for (let i = 0; i < chunkCount; i++) indexes.push(i);
    }

    // Defense in depth: incomplete progress with an empty missing list is
    // contradictory — never trust it, upload every index.
    if (indexes.length === 0 && chunkCount > 0 && initial.receivedChunks < chunkCount) {
      for (let i = 0; i < chunkCount; i++) indexes.push(i);
    }

    let latest = initial;
    let cursor = 0;
    let failedIndex: number | null = null;
    const next = (): number | null => {
      if (signal.aborted || failedIndex !== null) return null;
      while (cursor < indexes.length) {
        const i = indexes[cursor];
        cursor += 1;
        return i;
      }
      return null;
    };

    const uploadOne = async (index: number): Promise<void> => {
      const start = index * chunkSize;
      const end = Math.min(start + chunkSize, totalBytes);
      const chunk = file.slice(start, end);
      try {
        const uploaded = await uploadChunkWithRetry(id, initial.id, index, start, end, chunk, signal);
        latest = uploaded;
        setSession(uploaded);
        setUploadedBytes((prev) => prev + (end - start));
      } catch (err) {
        failedIndex = index;
        throw err;
      }
    };

    const workers = Array.from(
      { length: Math.min(MAX_IN_FLIGHT_CHUNKS, indexes.length) },
      async () => {
        for (let index = next(); index !== null; index = next()) {
          await uploadOne(index);
        }
      }
    );

    await Promise.all(workers);
    if (signal.aborted) throw new Error('Upload cancelled.');
    if (failedIndex !== null) {
      throw new Error(`Upload stopped at chunk ${failedIndex}. Please retry.`);
    }
    return latest;
  };

  const handleSubmit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (busy) return;
    if (!title.trim()) {
      setError('A title is required.');
      return;
    }
    if (!file) {
      setError('Choose a video file to upload.');
      return;
    }

    setError(null);
    setBusy(true);
    setPhase('uploading');
    const controller = new AbortController();
    abortRef.current = controller;
    const signal = controller.signal;

    let id = mediaId;
    try {
      // 1. Create metadata once (status: draft); Retry reuses the row.
      if (!id) {
        const created = await createAdminMediaApi({
          title: title.trim(),
          description: description.trim(),
          downloadAllowed,
          published,
        });
        if (!created.item) throw new Error(created.error?.message ?? 'Could not create the media entry.');
        id = created.item.id;
        setMediaId(id);
      }

      // 2. Begin (or resume) the chunked upload session. chunkSize is taken
      //    from the SERVER response — never assumed.
      const started = await startMediaUploadSessionApi(id, {
        totalBytes: file.size,
        filename: file.name,
        mimeType: file.type || '',
      });
      if (!started.session) throw new Error(started.error?.message ?? 'Could not start the upload.');
      setUploadId(started.session.id);
      setSession(started.session);
      setUploadedBytes(started.session.receivedBytes);
      debug('START', {
        mediaId: id,
        uploadId: started.session.id,
        fileSize: file.size,
        chunkSize: started.session.chunkSize,
        totalChunks: started.session.chunkCount,
      });

      // 3. Stream every missing chunk — one request per chunk, never the
      //    whole file.
      const finalState = await uploadAllChunks(id, file, started.session, signal);

      // 4. Final verification against the server before finalizing.
      const verified = await getMediaUploadSessionApi(id, finalState.id);
      if (!verified.session) throw new Error(verified.error?.message ?? 'Could not verify the upload session.');
      const stillMissing = verified.session.missingChunks ?? [];
      if (stillMissing.length > 0) {
        debug('COMPLETE FAILED', { status: 409, missingChunks: stillMissing });
        throw new Error('Upload could not be completed. Some parts were not uploaded.');
      }
      debug('COMPLETE', { uploadId: finalState.id, expectedChunks: verified.session.chunkCount });

      // 5. Finalize; the server validates chunks and starts conversion.
      const completed = await completeMediaUploadSessionApi(id, finalState.id);
      if (!completed.item) {
        debug('COMPLETE FAILED', { status: completed.error?.code ?? 'error', missingChunks: stillMissing });
        if (completed.error?.code === 'MEDIA_CONFLICT') {
          throw new Error('Upload could not be completed. Some parts were not uploaded.');
        }
        throw new Error(completed.error?.message ?? 'The upload could not be finalized.');
      }

      // 6. Wait for the FFmpeg pipeline (processing → ready | failed).
      setPhase('converting');
      const pollUntilSettled = async (): Promise<void> => {
        for (let attempt = 0; attempt < 120; attempt++) {
          const check = await fetchAdminMediaItemApi(id as string);
          if (!check.item) return; // deleted server-side — treat as done
          if (check.item.status === 'ready' || check.item.status === 'failed') return;
          await new Promise((r) => setTimeout(r, 1000));
        }
      };
      await pollUntilSettled();

      setPhase('done');
      resetForm();
      onUploaded();
      onClose();
    } catch (err) {
      if (abortRef.current !== controller) return; // a newer run took over
      if (signal.aborted) {
        setError('Upload cancelled. Your progress was kept — click Retry Upload to resume.');
      } else {
        setError(err instanceof Error ? err.message : 'The upload could not be completed.');
      }
      setPhase('idle');
      setBusy(false);
      abortRef.current = null;
    }
  };

  const retryUpload = (e: React.MouseEvent) => {
    e.preventDefault();
    void handleSubmit();
  };

  // Progress is REAL and monotonic: the larger of the server-acknowledged
  // ratio (session.receivedBytes / session.totalBytes) and the locally
  // accumulated sum of successful chunk bytes — never fabricated.
  const serverRatio = session && session.totalBytes > 0 ? session.receivedBytes / session.totalBytes : 0;
  const localRatio = session && session.totalBytes > 0 ? uploadedBytes / session.totalBytes : 0;
  const percent = Math.min(100, Math.floor(Math.max(serverRatio, localRatio) * 100));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-xs p-4 select-none animate-fade-in">
      <div className="w-full max-w-md float-surface p-6 relative text-[var(--text-primary)] pop-in">
        <button
          onClick={handleClose}
          disabled={phase === 'converting'}
          className="absolute top-4 right-4 text-[#5C5C64] hover:text-[#EDEDEF] transition-colors cursor-pointer disabled:opacity-50"
          aria-label="Close upload dialog"
        >
          ✕
        </button>

        <h2 className="font-['Sora',sans-serif] text-base font-bold text-[#EDEDEF] mb-1">
          Upload Media
        </h2>
        <p className="text-xs text-[#9A9AA2] mb-5">
          Add a video to the Media Library.
        </p>

        <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4" noValidate>
          <div>
            <label className="block text-[11px] font-semibold text-[#9A9AA2] uppercase tracking-wider mb-1.5">
              Title
            </label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Summer Watch Party Reel"
              className="field w-full text-[13px]"
            />
          </div>

          <div>
            <label className="block text-[11px] font-semibold text-[#9A9AA2] uppercase tracking-wider mb-1.5">
              Description
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What is this media about?"
              rows={2}
              className="field w-full text-[13px] resize-none"
            />
          </div>

          <div>
            <label className="block text-[11px] font-semibold text-[#9A9AA2] uppercase tracking-wider mb-1.5">
              Video file
            </label>
            <input
              ref={fileInputRef}
              type="file"
              accept="video/*"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              disabled={busy || mediaId !== null}
              className="field w-full text-[13px] file:mr-3 file:rounded-md file:border-0 file:bg-[var(--emphasis-dim)] file:px-3 file:py-1.5 file:text-[11px] file:font-semibold file:text-[var(--text-primary)] file:cursor-pointer"
              aria-label="Choose a video file"
            />
            {file && (
              <p className="text-[11px] text-[var(--text-tertiary)] mt-1 font-mono truncate">
                {file.name} · {(file.size / (1024 * 1024)).toFixed(1)} MB
              </p>
            )}
          </div>

          <div className="flex items-center gap-6">
            <label className="flex items-center gap-2 text-xs text-[var(--text-secondary)] cursor-pointer">
              <input
                type="checkbox"
                checked={downloadAllowed}
                onChange={(e) => setDownloadAllowed(e.target.checked)}
                disabled={busy}
                className="accent-[var(--text-primary)]"
              />
              Allow download
            </label>
            <label className="flex items-center gap-2 text-xs text-[var(--text-secondary)] cursor-pointer">
              <input
                type="checkbox"
                checked={published}
                onChange={(e) => setPublished(e.target.checked)}
                disabled={busy}
                className="accent-[var(--text-primary)]"
              />
              Publish now
            </label>
          </div>

          {busy && phase === 'uploading' && (
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-[11px] text-[var(--text-secondary)]">
                <span className="flex items-center gap-2">
                  <Loader className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
                  Uploading chunks…
                </span>
                <span className="font-mono">{percent}%</span>
              </div>
              <div className="h-1.5 rounded-full bg-[var(--emphasis-dim)] overflow-hidden" role="progressbar" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100}>
                <div className="h-full bg-[var(--accent)] transition-all duration-300" style={{ width: `${percent}%` }} />
              </div>
              {session && (
                <p className="text-[10px] text-[var(--text-tertiary)] font-mono">
                  {session.receivedBytes} / {session.totalBytes} bytes · {session.chunkSize / (1024 * 1024)} MiB chunks
                </p>
              )}
            </div>
          )}

          {busy && phase === 'converting' && (
            <div className="flex items-center gap-2.5 text-xs font-medium text-[var(--text-secondary)]">
              <Loader className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
              Converting to a playable format…
            </div>
          )}

          {error && (
            <div className="flex items-start gap-2.5 text-xs font-medium text-[#F59E0B] bg-[#F59E0B]/10 border border-[#F59E0B]/25 rounded-xl px-4 py-3">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" />
              <span>{error}</span>
            </div>
          )}

          {error && !busy && mediaId && (
            <button
              type="button"
              onClick={retryUpload}
              className="btn-primary text-xs px-5 py-2 inline-flex items-center gap-2"
            >
              <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" />
              Retry Upload
            </button>
          )}

          <div className="pt-3 flex justify-end gap-2.5">
            <button
              type="button"
              onClick={handleClose}
              disabled={phase === 'converting'}
              className="btn-secondary text-xs px-4 py-2 disabled:opacity-60"
            >
              {phase === 'uploading' ? 'Stop' : 'Cancel'}
            </button>
            <button
              type="submit"
              disabled={busy}
              className="btn-primary text-xs px-5 py-2 disabled:opacity-60"
            >
              {busy ? (
                <Loader className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
              ) : (
                <Upload className="w-3.5 h-3.5" aria-hidden="true" />
              )}
              {busy ? 'Uploading…' : 'Create / Upload'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
