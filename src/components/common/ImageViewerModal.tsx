import React from 'react';
import { X, Download } from 'lucide-react';

interface ImageViewerModalProps {
  open: boolean;
  src: string;
  originalName?: string;
  onClose: () => void;
}

export const ImageViewerModal: React.FC<ImageViewerModalProps> = ({ open, src, originalName, onClose }) => {
  if (!open || !src) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 backdrop-blur-md p-4 animate-fadeIn"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="relative max-w-4xl max-h-[90vh] flex flex-col items-center justify-center"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="absolute top-4 right-4 flex items-center gap-2 z-10">
          <a
            href={src}
            download={originalName || 'image'}
            className="p-2 rounded-full bg-zinc-800/80 text-zinc-300 hover:text-white hover:bg-zinc-700 transition-colors cursor-pointer"
            title="Download image"
            target="_blank"
            rel="noreferrer"
          >
            <Download className="w-4 h-4" />
          </a>
          <button
            onClick={onClose}
            className="p-2 rounded-full bg-zinc-800/80 text-zinc-300 hover:text-white hover:bg-zinc-700 transition-colors cursor-pointer"
            title="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <img
          src={src}
          alt={originalName || 'Chat image preview'}
          className="max-w-full max-h-[85vh] object-contain rounded-lg shadow-2xl"
        />
        {originalName && (
          <div className="mt-2 text-xs text-zinc-400 font-mono truncate max-w-md">
            {originalName}
          </div>
        )}
      </div>
    </div>
  );
};
