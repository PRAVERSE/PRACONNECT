import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Search,
  Upload,
  Film,
  Play,
  Download,
  Loader,
  AlertTriangle,
  Pencil,
  Trash2,
  Eye,
  EyeOff,
  X
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { EmptyState } from '../common/EmptyState';
import { ConfirmDialog } from '../common/ConfirmDialog';
import { UploadMediaModal } from '../modals/UploadMediaModal';
import { MediaEditModal } from '../modals/MediaEditModal';
import { MediaPlaybackModal } from '../modals/MediaPlaybackModal';
import {
  fetchMediaLibraryApi,
  fetchAdminMediaApi,
  publishAdminMediaApi,
  unpublishAdminMediaApi,
  deleteAdminMediaApi,
  downloadMediaFile
} from '../../api/media';
import { MediaItem, MediaLibraryState, MediaStatus } from '../../types';

const PAGE_SIZE = 20;

/** 'video/mp4' → 'MP4' (format chip); falls back to '—' when unknown. */
function formatLabel(mimeType: string | null): string {
  if (!mimeType) return '—';
  const match = /video\/([a-z0-9]+)/i.exec(mimeType);
  if (match) return match[1].toUpperCase();
  return mimeType.split('/').pop()?.toUpperCase() ?? '—';
}

/** 2_576_980_384 → '2.4 GB' */
function formatSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '—';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  const rounded = value >= 100 ? Math.round(value) : value.toFixed(1);
  return `${rounded} ${units[unit]}`;
}

/** 7245 → '2:00:45' / 125 → '2:05' / null → '—' */
function formatDuration(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds)) return '—';
  const total = Math.floor(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = h > 0 ? String(m).padStart(2, '0') : String(m);
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

const STATUS_LABEL: Record<MediaStatus, string> = {
  draft: 'Draft',
  uploading: 'Uploading',
  uploaded: 'Uploaded',
  processing: 'Processing',
  ready: 'Ready',
  failed: 'Failed',
};

export const MediaLibraryView: React.FC = () => {
  const { isAdmin, currentUser } = useApp();

  // DEV-only diagnostic: trace the role chain into the view.
  if (process.env.NODE_ENV !== 'production') {
    // eslint-disable-next-line no-console
    console.log('[AUTH ROLE] MediaLibraryView', {
      role: currentUser?.role ?? null,
      isAdmin,
    });
  }

  const [state, setState] = useState<MediaLibraryState>('loading');
  const [items, setItems] = useState<MediaItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

  const [uploadOpen, setUploadOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<MediaItem | null>(null);
  const [playingItem, setPlayingItem] = useState<MediaItem | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<MediaItem | null>(null);
  const [actionBusyId, setActionBusyId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);

  const requestIdRef = useRef(0);

  // Phase B: real server search (title/description) with debounce. The query
  // is sent to the API — results are never fabricated client-side.
  const load = useCallback(
    async (targetPage: number, q: string, mode: 'initial' | 'append' | 'replace') => {
      const rid = ++requestIdRef.current;
      if (mode === 'initial') {
        setState('loading');
        setError(null);
      }
      if (mode === 'append') setLoadingMore(true);

      const res = isAdmin
        ? await fetchAdminMediaApi({ q, page: targetPage, pageSize: PAGE_SIZE })
        : await fetchMediaLibraryApi({ q, page: targetPage, pageSize: PAGE_SIZE });

      if (rid !== requestIdRef.current) return;
      if (mode === 'append') setLoadingMore(false);

      if (res.error) {
        if (mode !== 'append') {
          setItems([]);
          setTotal(0);
          setHasMore(false);
          setError(res.error.message);
          setState('error');
        }
        return;
      }

      setItems((prev) => (mode === 'append' ? [...prev, ...res.items] : res.items));
      setTotal(res.total);
      setHasMore(res.hasMore);
      setPage(res.page);
      if (mode !== 'append') {
        setState(res.items.length > 0 ? 'ready' : 'empty');
      }
    },
    [isAdmin]
  );

  const activeSearch = searchQuery.trim();

  useEffect(() => {
    const timer = setTimeout(() => load(1, searchQuery.trim(), 'initial'), 300);
    return () => clearTimeout(timer);
  }, [searchQuery, load]);

  const reloadQuietly = useCallback(() => {
    load(page, activeSearch, 'replace');
  }, [load, page, activeSearch]);

  const handlePlay = (item: MediaItem) => {
    if (item.status !== 'ready') return;
    if (isAdmin && !item.storageKey) return;
    setPlayingItem(item);
  };

  const handleDownload = async (item: MediaItem) => {
    if (downloadingId) return;
    setDownloadingId(item.id);
    const fallback = item.originalFilename ?? `${item.title}.mp4`;
    const res = await downloadMediaFile(item.id, fallback);
    setDownloadingId(null);
    if (!res.ok) setActionError(res.error ?? 'The download could not be started.');
  };

  const handleTogglePublish = async (item: MediaItem) => {
    if (actionBusyId) return;
    setActionBusyId(item.id);
    setActionError(null);
    const res = item.published ? await unpublishAdminMediaApi(item.id) : await publishAdminMediaApi(item.id);
    setActionBusyId(null);
    if (!res.item) {
      setActionError(res.error?.message ?? 'Could not update the published state.');
      return;
    }
    reloadQuietly();
  };

  const handleDelete = async () => {
    if (!deleteTarget || deleting) return;
    setDeleting(true);
    setActionError(null);
    const res = await deleteAdminMediaApi(deleteTarget.id);
    setDeleting(false);
    if (!res.ok) {
      setActionError(res.error ?? 'Could not delete this media.');
      setDeleteTarget(null);
      return;
    }
    setDeleteTarget(null);
    reloadQuietly();
  };

  const renderStatusPill = (item: MediaItem) => {
    if (item.status === 'processing') {
      return (
        <span className="flex items-center gap-1.5 text-[10px] font-mono font-bold uppercase tracking-[0.06em] text-[#F59E0B] shrink-0">
          <Loader className="w-3 h-3 animate-spin" aria-hidden="true" />
          {STATUS_LABEL.processing}
        </span>
      );
    }
    if (item.status === 'failed') {
      return (
        <span className="flex items-center gap-1.5 text-[10px] font-mono font-bold uppercase tracking-[0.06em] text-[#EF4444] shrink-0">
          <AlertTriangle className="w-3 h-3" aria-hidden="true" />
          {STATUS_LABEL.failed}
        </span>
      );
    }
    return (
      <span className="pill-glass px-2.5 py-0.5 text-[10px] font-mono font-medium uppercase tracking-[0.06em] text-[var(--text-tertiary)] shrink-0">
        {STATUS_LABEL[item.status]}
      </span>
    );
  };

  const renderMediaRow = (item: MediaItem, index: number) => {
    const canPlay = item.status === 'ready' && (isAdmin ? Boolean(item.storageKey) : true);
    const showDownload = isAdmin || item.downloadAllowed;
    const busy = actionBusyId === item.id;
    const downloading = downloadingId === item.id;

    return (
      <div
        key={item.id}
        className={`flex items-center gap-4 py-4 group ${
          index > 0 ? 'border-t border-[var(--border-hairline)]' : ''
        }`}
      >
        {/* Poster / placeholder thumbnail */}
        <div className="w-16 h-10 rounded-lg bg-[var(--bg-glass)] border border-[var(--border-hairline)] flex items-center justify-center text-[var(--text-tertiary)] shrink-0 overflow-hidden">
          {item.posterUrl ? (
            <img
              src={item.posterUrl}
              alt=""
              className="w-full h-full object-cover"
              loading="lazy"
            />
          ) : (
            <Film className="w-4 h-4" strokeWidth={1.5} aria-hidden="true" />
          )}
        </div>

        {/* Identity */}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2.5 min-w-0">
            <span className="font-display text-[15px] font-semibold text-[var(--text-primary)] truncate">
              {item.title}
            </span>
            {isAdmin && renderStatusPill(item)}
            {item.published ? (
              <span className="pill-glass px-2.5 py-0.5 text-[10px] font-mono font-medium uppercase tracking-[0.06em] text-[var(--text-secondary)] shrink-0">
                Published
              </span>
            ) : (
              <span className="pill-glass px-2.5 py-0.5 text-[10px] font-mono font-medium uppercase tracking-[0.06em] text-[var(--text-tertiary)] shrink-0">
                Unpublished
              </span>
            )}
          </div>
          <div className="text-xs text-[var(--text-tertiary)] mt-0.5 font-mono truncate">
            {formatDuration(item.duration)} · {formatLabel(item.mimeType)} · {formatSize(item.sizeBytes)}
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2 shrink-0">
          <button
            className="btn-secondary text-xs px-3.5 py-2 disabled:opacity-40 disabled:cursor-not-allowed"
            aria-label={`Play ${item.title}`}
            disabled={!canPlay}
            onClick={() => handlePlay(item)}
          >
            <Play className="w-3.5 h-3.5" aria-hidden="true" />
          </button>
          {showDownload && (
            <button
              className="btn-secondary text-xs px-3.5 py-2 disabled:opacity-40 disabled:cursor-not-allowed"
              aria-label={`Download ${item.title}`}
              disabled={downloading}
              onClick={() => handleDownload(item)}
            >
              {downloading ? (
                <Loader className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
              ) : (
                <Download className="w-3.5 h-3.5" aria-hidden="true" />
              )}
            </button>
          )}

          {/* Admin-only controls — UI gating; requireAdmin enforces the same
              rule server-side, so a hidden button grants nothing. */}
          {isAdmin && (
            <>
              <button
                className="btn-ghost text-xs px-3 py-2"
                aria-label={`Edit ${item.title}`}
                onClick={() => setEditingItem(item)}
              >
                <Pencil className="w-3.5 h-3.5" aria-hidden="true" />
              </button>
              <button
                className="btn-ghost text-xs px-3 py-2 disabled:opacity-40 disabled:cursor-not-allowed"
                aria-label={item.published ? `Unpublish ${item.title}` : `Publish ${item.title}`}
                disabled={busy}
                onClick={() => handleTogglePublish(item)}
              >
                {busy ? (
                  <Loader className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
                ) : item.published ? (
                  <EyeOff className="w-3.5 h-3.5" aria-hidden="true" />
                ) : (
                  <Eye className="w-3.5 h-3.5" aria-hidden="true" />
                )}
              </button>
              <button
                className="btn-ghost text-xs px-3 py-2 text-[#EF4444]"
                aria-label={`Delete ${item.title}`}
                onClick={() => setDeleteTarget(item)}
              >
                <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
              </button>
            </>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="w-full text-[var(--text-primary)] font-['Inter',sans-serif] select-none">
      {/* ─── PAGE HEADER ────────────────────────────────────────────────────── */}
      <header
        className="flex flex-col md:flex-row md:items-start justify-between gap-6 mb-10"
        style={{ animation: 'rise 640ms var(--ease) both' }}
      >
        <div className="max-w-[620px]">
          <h1
            className="font-display font-bold tracking-[-0.02em] text-[clamp(2rem,3.4vw,2.7rem)] leading-[1.1] mb-3"
            style={{ animation: 'rise 640ms var(--ease) 80ms both' }}
          >
            Media Library
          </h1>
          <p
            className="text-[15px] leading-relaxed text-[var(--text-secondary)] max-w-[520px]"
            style={{ animation: 'rise 640ms var(--ease) 150ms both' }}
          >
            {isAdmin
              ? 'Manage the media your community watches — upload, publish, and organize.'
              : 'Browse published media ready to watch with your circle.'}
          </p>
        </div>

        {/* Upload Media — admin only (UI gating; requireAdmin enforces it
            server-side). */}
        {isAdmin && (
          <div
            className="flex items-center gap-3 shrink-0"
            style={{ animation: 'rise 640ms var(--ease) 220ms both' }}
          >
            <button
              onClick={() => setUploadOpen(true)}
              className="btn-primary text-sm"
              aria-haspopup="dialog"
              aria-expanded={uploadOpen}
            >
              <Upload className="w-4 h-4" aria-hidden="true" />
              <span>Upload Media</span>
            </button>
          </div>
        )}
      </header>

      {/* ─── SEARCH (real server search — title/description) ───────────────── */}
      <div
        className="mb-6 max-w-[520px]"
        style={{ animation: 'rise 640ms var(--ease) 220ms both' }}
      >
        <div className="relative">
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search media..."
            className="field w-full pl-12 pr-10"
            aria-label="Search media"
          />
          <Search
            className="w-4 h-4 text-[var(--text-tertiary)] absolute left-[18px] top-1/2 -translate-y-1/2 pointer-events-none"
            aria-hidden="true"
          />
          {activeSearch && (
            <button
              onClick={() => setSearchQuery('')}
              className="absolute right-4 top-1/2 -translate-y-1/2 p-0.5 text-[var(--text-tertiary)] hover:text-[var(--text-primary)] rounded-full cursor-pointer transition-colors"
              aria-label="Clear search"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
        {activeSearch && !loadingMore && state === 'ready' && (
          <p className="text-[11px] font-mono text-[var(--text-tertiary)] mt-2">
            {total} result{total === 1 ? '' : 's'} for “{activeSearch}”
          </p>
        )}
      </div>

      {/* ─── ACTION ERROR (publish/delete/download failures) ───────────────── */}
      {actionError && (
        <div className="mb-6 flex items-center gap-2.5 text-xs font-medium text-[#F59E0B] bg-[#F59E0B]/10 border border-[#F59E0B]/25 rounded-xl px-4 py-3">
          <AlertTriangle className="w-4 h-4 shrink-0" aria-hidden="true" />
          <span>{actionError}</span>
        </div>
      )}

      {/* ─── CONTENT ───────────────────────────────────────────────────────── */}
      {state === 'loading' && (
        <div className="w-full space-y-4 py-2" style={{ animation: 'rise 640ms var(--ease) 220ms both' }}>
          <div className="flex items-center justify-center gap-2 py-4 text-xs text-[var(--text-tertiary)]">
            <Loader className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
            <span>Loading your library...</span>
          </div>
          {[1, 2, 3, 4].map((n) => (
            <div
              key={n}
              className={`flex items-center gap-4 py-4 ${n > 1 ? 'border-t border-[var(--border-hairline)]' : ''} animate-pulse`}
            >
              <div className="w-16 h-10 rounded-lg bg-[var(--bg-glass)] border border-[var(--border-hairline)] shrink-0" />
              <div className="flex-1 min-w-0 space-y-2">
                <div className="h-4 bg-[var(--bg-glass)] rounded-md w-1/3" />
                <div className="h-3 bg-[var(--bg-glass)] rounded-md w-1/4" />
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <div className="w-8 h-8 rounded-full bg-[var(--bg-glass)]" />
              </div>
            </div>
          ))}
        </div>
      )}

      {state === 'error' && (
        <EmptyState
          icon={AlertTriangle}
          title="Could not load the media library."
          description={error ?? 'Something went wrong while fetching your library.'}
          action={
            <button onClick={() => load(1, activeSearch, 'initial')} className="btn-secondary text-sm">
              Try again
            </button>
          }
        />
      )}

      {state === 'empty' && (
        <EmptyState
          icon={Film}
          title={
            activeSearch
              ? 'No media matches your search.'
              : isAdmin
                ? 'No media in your library.'
                : 'No media available yet.'
          }
          description={
            activeSearch
              ? 'Try a different title or description.'
              : isAdmin
                ? 'Upload your first video — it will appear here for everyone once published.'
                : 'Published media will show up here when your community adds it.'
          }
          action={
            isAdmin && !activeSearch ? (
              <button
                onClick={() => setUploadOpen(true)}
                className="btn-primary text-sm"
                aria-haspopup="dialog"
                aria-expanded={uploadOpen}
              >
                <Upload className="w-4 h-4" aria-hidden="true" />
                <span>Upload Media</span>
              </button>
            ) : undefined
          }
        />
      )}

      {state === 'ready' && (
        <div className="w-full" style={{ animation: 'rise 640ms var(--ease) 300ms both' }}>
          {items.map(renderMediaRow)}

          {hasMore && (
            <div className="flex justify-center pt-8">
              <button
                onClick={() => load(page + 1, activeSearch, 'append')}
                disabled={loadingMore}
                className="btn-secondary text-xs px-5 py-2.5 disabled:opacity-60"
              >
                {loadingMore ? (
                  <Loader className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
                ) : (
                  'Load more'
                )}
              </button>
            </div>
          )}
        </div>
      )}

      {/* ─── Modals ───────────────────────────────────────────────────────── */}
      <UploadMediaModal
        open={uploadOpen}
        onClose={() => setUploadOpen(false)}
        onUploaded={() => load(1, activeSearch, 'initial')}
      />
      <MediaEditModal
        item={editingItem}
        onClose={() => setEditingItem(null)}
        onSaved={reloadQuietly}
      />
      <MediaPlaybackModal item={playingItem} onClose={() => setPlayingItem(null)} />
      <ConfirmDialog
        open={deleteTarget !== null}
        title="Delete media"
        message={
          deleteTarget
            ? `"${deleteTarget.title}" and its stored file will be permanently removed.`
            : ''
        }
        confirmLabel="Delete"
        danger
        busy={deleting}
        onConfirm={handleDelete}
        onClose={() => (deleting ? undefined : setDeleteTarget(null))}
      />
    </div>
  );
};