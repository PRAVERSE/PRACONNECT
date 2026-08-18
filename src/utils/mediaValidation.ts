// src/utils/mediaValidation.ts
// Shared client-side rules for the local movie file picker.
//
// A file is accepted when its MIME type is a supported video MIME value OR
// when its extension is one of the supported extensions. Extension matching
// is case-insensitive. The browser's file.type is frequently empty or generic
// (e.g. application/octet-stream), so extension fallback is required.
//
// Phase 6.10: local movie files NEVER leave the device (they are streamed
// peer-to-peer via WebRTC), so this list is deliberately broad — extension
// matching is a UX convenience, NOT a security boundary. Whether a container
// actually plays is decided by the browser's codec support at load time.

export const SUPPORTED_LOCAL_MOVIE_EXTENSIONS = [
  '.mp4',
  '.webm',
  '.mkv',
  '.mov',
  '.avi',
  '.m4v',
  '.mpeg',
  '.mpg',
  '.3gp',
  '.flv',
  '.ogv',
  '.wmv',
  '.mts',
  '.m2ts',
  '.ts',
  '.divx',
] as const;

export const SUPPORTED_LOCAL_MOVIE_MIMES = [
  'video/mp4',
  'video/webm',
  'video/quicktime',
  'video/x-matroska',
  'video/matroska',
  'application/x-matroska',
  'video/x-msvideo',
  'video/avi',
  'video/mpeg',
  'video/3gpp',
  'video/x-flv',
  'video/ogg',
  'video/x-ms-wmv',
] as const;

/** accept attribute value for the local movie <input type="file">. */
export const LOCAL_MOVIE_ACCEPT = [
  ...SUPPORTED_LOCAL_MOVIE_MIMES,
  ...SUPPORTED_LOCAL_MOVIE_EXTENSIONS,
].join(',');

export function isSupportedLocalMovie(file: { name: string; type: string }): boolean {
  const mime = (file.type ?? '').toLowerCase();
  if ((SUPPORTED_LOCAL_MOVIE_MIMES as readonly string[]).includes(mime)) return true;
  const lowerName = file.name.toLowerCase();
  return (SUPPORTED_LOCAL_MOVIE_EXTENSIONS as readonly string[]).some((ext) => lowerName.endsWith(ext));
}