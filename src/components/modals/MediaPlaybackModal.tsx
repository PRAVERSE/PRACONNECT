import React, { useEffect } from 'react';
import { X, Film } from 'lucide-react';
import { MediaItem } from '../../types';
import { buildMediaDownloadUrl } from '../../api/media';

interface MediaPlaybackModalProps {
  item: MediaItem | null;
  onClose: () => void;
}

/**
 * Phase B playback shell. The item's file is served by the authorized
 * download endpoint (Range-capable), so the browser <video> can seek. This is
 * NOT Room integration — Room playback remains a Phase C concern.
 */
export const MediaPlaybackModal: React.FC<MediaPlaybackModalProps> = ({ item, onClose }) => {
  const videoRef = React.useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (!item) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (videoRef.current) {
        if (e.key === 'j' || e.key === 'J') {
          e.preventDefault();
          videoRef.current.currentTime = Math.max(0, videoRef.current.currentTime - 10);
        } else if (e.key === 'l' || e.key === 'L') {
          e.preventDefault();
          videoRef.current.currentTime = Math.min(
            videoRef.current.duration || 0,
            videoRef.current.currentTime + 10
          );
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [item, onClose]);

  if (!item) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-xs p-4 select-none animate-fade-in"
      onClick={onClose}
    >
      <div
        className="w-full max-w-3xl float-surface p-5 relative text-[var(--text-primary)] pop-in"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={`Play ${item.title}`}
      >
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-[#5C5C64] hover:text-[#EDEDEF] transition-colors cursor-pointer z-10"
          aria-label="Close player"
        >
          <X className="w-4 h-4" />
        </button>

        <h2 className="font-display text-base font-semibold pr-8 mb-1 truncate">{item.title}</h2>
        <p className="text-xs text-[var(--text-tertiary)] mb-4 font-mono">
          {item.mimeType ?? 'video'} · {(item.sizeBytes / (1024 * 1024)).toFixed(1)} MB
        </p>

        <div className="relative w-full aspect-video bg-black rounded-xl overflow-hidden border border-[var(--border-hairline)]">
          <video
            ref={videoRef}
            key={item.id}
            src={buildMediaDownloadUrl(item.id)}
            controls
            autoPlay
            playsInline
            className="w-full h-full"
          />
          {!item.posterUrl && (
            <div className="absolute inset-0 flex items-center justify-center text-[var(--text-tertiary)] pointer-events-none">
              <Film className="w-8 h-8" strokeWidth={1.5} aria-hidden="true" />
            </div>
          )}
        </div>
      </div>
    </div>
  );
};