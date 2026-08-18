import React, { useEffect, useRef, useState } from 'react';
import { Pencil, AlertTriangle, Loader } from 'lucide-react';
import { MediaItem } from '../../types';
import { updateAdminMediaApi, replaceMediaPosterApi } from '../../api/media';

interface MediaEditModalProps {
  item: MediaItem | null;
  onClose: () => void;
  /** Called after a successful PATCH so the library can refresh. */
  onSaved: () => void;
}

/** Phase C: edit dialog for media metadata (title, description, download
 *  allowed) plus an optional poster replacement (JPEG/PNG streamed to the
 *  server — the generated thumbnail can always be swapped by an admin).
 *  Publishing is a separate row action (publish/unpublish). */
export const MediaEditModal: React.FC<MediaEditModalProps> = ({ item, onClose, onSaved }) => {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [downloadAllowed, setDownloadAllowed] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [posterNote, setPosterNote] = useState<string | null>(null);
  const posterInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (item) {
      setTitle(item.title);
      setDescription(item.description ?? '');
      setDownloadAllowed(item.downloadAllowed);
      setError(null);
      setBusy(false);
      setPosterNote(null);
    }
  }, [item]);

  if (!item) return null;

  const handlePoster = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || busy) return;
    if (file.type !== 'image/jpeg' && file.type !== 'image/png') {
      setError('Poster must be a JPEG or PNG image.');
      return;
    }
    setError(null);
    setBusy(true);
    const res = await replaceMediaPosterApi(item.id, file, file.type);
    setBusy(false);
    if (!res.item) {
      setError(res.error?.message ?? 'The poster could not be replaced.');
      return;
    }
    setPosterNote('Poster updated.');
    onSaved();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) {
      setError('A title is required.');
      return;
    }
    if (busy) return;
    setError(null);
    setBusy(true);

    const res = await updateAdminMediaApi(item.id, {
      title: title.trim(),
      description: description.trim(),
      downloadAllowed,
    });
    setBusy(false);
    if (!res.item) {
      setError(res.error?.message ?? 'Could not save changes.');
      return;
    }
    onSaved();
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-xs p-4 select-none animate-fade-in">
      <div className="w-full max-w-md float-surface p-6 relative text-[var(--text-primary)] pop-in">
        <button
          onClick={() => (busy ? undefined : onClose())}
          className="absolute top-4 right-4 text-[#5C5C64] hover:text-[#EDEDEF] transition-colors cursor-pointer"
          aria-label="Close edit dialog"
        >
          ✕
        </button>

        <h2 className="font-['Sora',sans-serif] text-base font-bold text-[#EDEDEF] mb-1">
          Edit Media
        </h2>
        <p className="text-xs text-[#9A9AA2] mb-5">Update the metadata for this item.</p>

        <form onSubmit={handleSubmit} className="space-y-4" noValidate>
          <div>
            <label className="block text-[11px] font-semibold text-[#9A9AA2] uppercase tracking-wider mb-1.5">
              Title
            </label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
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
              rows={2}
              className="field w-full text-[13px] resize-none"
            />
          </div>

          <label className="flex items-center gap-2 text-xs text-[var(--text-secondary)] cursor-pointer">
            <input
              type="checkbox"
              checked={downloadAllowed}
              onChange={(e) => setDownloadAllowed(e.target.checked)}
              className="accent-[var(--text-primary)]"
            />
            Allow download
          </label>

          <div>
            <label className="block text-[11px] font-semibold text-[#9A9AA2] uppercase tracking-wider mb-1.5">
              Poster image (optional)
            </label>
            <input
              ref={posterInputRef}
              type="file"
              accept="image/jpeg,image/png"
              onChange={handlePoster}
              disabled={busy}
              className="field w-full text-[13px] file:mr-3 file:rounded-md file:border-0 file:bg-[var(--emphasis-dim)] file:px-3 file:py-1.5 file:text-[11px] file:font-semibold file:text-[var(--text-primary)] file:cursor-pointer"
              aria-label="Replace poster image"
            />
            {posterNote && <p className="text-[11px] text-[var(--text-tertiary)] mt-1">{posterNote}</p>}
          </div>

          {error && (
            <div className="flex items-center gap-2.5 text-xs font-medium text-[#F59E0B] bg-[#F59E0B]/10 border border-[#F59E0B]/25 rounded-xl px-4 py-3">
              <AlertTriangle className="w-4 h-4 shrink-0" aria-hidden="true" />
              <span>{error}</span>
            </div>
          )}

          <div className="pt-3 flex justify-end gap-2.5">
            <button
              type="button"
              onClick={onClose}
              disabled={busy}
              className="btn-secondary text-xs px-4 py-2 disabled:opacity-60"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={busy}
              className="btn-primary text-xs px-5 py-2 disabled:opacity-60"
            >
              {busy ? (
                <Loader className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
              ) : (
                <Pencil className="w-3.5 h-3.5" aria-hidden="true" />
              )}
              {busy ? 'Saving…' : 'Save changes'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};