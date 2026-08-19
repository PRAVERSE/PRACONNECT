export type NavigationTab =
  | 'dashboard'
  | 'explore'
  | 'games'
  | 'friends'
  | 'messages'
  | 'library'
  | 'settings'
  | 'profile'
  | 'room'
  | 'auth';

export type RoomCategory = 'Movie' | 'Gaming' | 'Study' | 'Music' | 'Other';
export type RoomPrivacy = 'public' | 'private';
export type RoomStatus = 'IDLE' | 'LIVE';
export type RoomTab = 'Watch' | 'Game' | 'Board' | 'Notes' | 'Files';

export interface MediaTrack {
  title: string;
  url?: string;
  poster?: string;
  duration?: number;
  type?: 'video' | 'stream';
  /** 'local-movie' = shared peer-to-peer via WebRTC (never has a url); 'library' = admin media library (mediaId, streamed from the server by every participant); 'url' = direct URL; 'hosted' = server upload. */
  mediaType?: 'local-movie' | 'library' | 'url' | 'hosted' | string;
  /** Admin library reference — present when mediaType === 'library'. */
  mediaId?: string;
  sourceUserId?: string;
  mimeType?: string;
}

export interface RoomItem {
  id: string;
  name: string;
  code: string;
  hostUserId?: string;
  hostName: string;
  hostAvatar: string;
  isHost?: boolean;
  category: RoomCategory;
  privacy: RoomPrivacy;
  status: RoomStatus;
  memberCount: number;
  maxMembers: number;
  /** Number of members currently active in the room (never counts left/removed). */
  activeMemberCount?: number;
  /** True when no member is currently active in the room. */
  isEmpty?: boolean;
  /** True when the room is empty but still inside its 5-minute rejoin window. */
  isRejoinable?: boolean;
  /** ISO timestamp (emptySince + 5 min) when the rejoin window closes; null when the room is active. */
  rejoinExpiresAt?: string | null;
  currentMedia: MediaTrack | null;
  playback?: { isPlaying: boolean; position: number; updatedAt?: string };
  screenShareActive?: boolean;
  lastActive: string;
  emptySince?: string | null;
  emptyTimeRemaining?: number | null; // 5 min countdown when empty
  isCustom?: boolean;
  description?: string;
  activeMembers?: { name: string; avatar: string }[];
}

export interface Participant {
  id: string;
  userId?: string;
  name: string;
  username?: string;
  avatar: string;
  isLocal: boolean;
  isHost: boolean;
  role?: 'host' | 'co-host' | 'viewer';
  micOn: boolean;
  cameraOn: boolean;
  screenShareOn: boolean;
  status: 'online' | 'idle' | 'speaking';
  videoStreamUrl?: string;
}

export interface ChatMessage {
  id: string;
  senderId: string;
  senderName: string;
  senderAvatar: string;
  text: string;
  timestamp: string;
  isSystem?: boolean;
}

export interface Friend {
  id: string;
  name: string;
  username: string;
  avatar: string;
  status: 'online' | 'offline' | 'idle';
  currentRoomCode?: string;
  currentRoomName?: string;
  currentActivityMedia?: { title: string; poster?: string; type?: string };
  mutualFriendsCount?: number;
  unreadCount?: number;
  requestPending?: boolean;
  isSuggestion?: boolean;
}

export interface ScheduledParty {
  id: string;
  title: string;
  category: RoomCategory;
  scheduledFor: string;
  hostName: string;
  hostAvatar: string;
  invitedFriendsCount: number;
  description?: string;
  mediaTitle?: string;
  roomCode: string;
}

export interface WatchHistoryItem {
  id: string;
  title: string;
  poster: string;
  watchedAt: string;
  roomName: string;
  durationWatched: string;
}

/** A single durable room session from the server (survives active-room cleanup). */
export interface RoomHistoryEntry {
  id: string;
  roomId: string;
  roomCode: string;
  roomName: string;
  role: 'host' | 'member';
  hostUserId: string;
  hostName: string;
  category: RoomCategory;
  createdAt: string;
  emptySince: string | null;
  endedAt: string | null;
  durationSeconds: number;
  participantCount: number;
  maxParticipants: number;
  createdMediaTitle: string | null;
  createdMediaType: string | null;
}

/** Server-authoritative profile statistics (GET /api/profile/stats). */
export interface RoomHistoryStats {
  hostedRooms: number;
  joinedRooms: number;
  totalWatchSeconds: number;
  recentRooms: RoomHistoryEntry[];
}

/** Preview of the message this message replies to / forwards from (the body
 *  is never shipped for messages deleted for everyone or deleted for me). */
export interface MessageOriginPreview {
  text: string;
  senderId: string;
  createdAt: string;
  deleted: boolean;
}

export interface ChatMediaAttachment {
  mediaId: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  hasThumbnail?: boolean;
}

export interface DirectMessage {
  id: string;
  senderId: string;
  text: string;
  timestamp: string;
  /** Server ISO timestamp — the info dialog formats from this, not the
   *  locale-display `timestamp`. */
  createdAt?: string;
  conversationId?: string;
  sequenceId?: number;
  status?: 'sending' | 'sent' | 'delivered' | 'read' | 'failed';
  clientMessageId?: string;
  replyToMessageId?: string | null;
  forwardedFromMessageId?: string | null;
  /** Set when the sender deleted the message for everyone (body already
   *  stripped server-side — never trust text for deleted messages). */
  deletedForEveryone?: boolean;
  replyTo?: MessageOriginPreview | null;
  forwardedFrom?: MessageOriginPreview | null;
  attachmentId?: string | null;
  attachment?: ChatMediaAttachment | null;
  editedAt?: string | null;
  expiresAt?: string | null;
  vanish?: boolean;
  reaction?: string | null;
}

export interface DMConversation {
  friendId: string;
  messages: DirectMessage[];
  typing?: boolean;
}

export interface NotificationItem {
  id: string;
  title: string;
  message: string;
  time: string;
  read: boolean;
  type: 'invite' | 'friend_request' | 'system';
  roomCode?: string;
  /** Peer user id for friend-accepted toasts — renders a "Message" action. */
  friendId?: string;
}

export interface UserSettings {
  theme: 'Dark' | 'Light';
  language: string;
  soundEffects: boolean;
  showActivityStatus: boolean;
  whoCanSendFriendRequests: 'Everyone' | 'Friends of Friends' | 'Nobody';
  privateProfile: boolean;
  autoplayNext: boolean;
  defaultMicOn: boolean;
  defaultCamOn: boolean;
}

export interface UserProfile {
  name: string;
  username: string;
  avatar: string;
  joinedDate: string;
  roomsCount: number;
  gamesPlayed: number;
  friendsCount: number;
  bio: string;
  email: string;
}

export interface RoomFile {
  id: string;
  name: string;
  size: string;
  uploadedBy: string;
  uploadedAt: string;
  type: 'pdf' | 'image' | 'video' | 'doc';
  url?: string;
}

export interface RecentActivityItem {
  id: string;
  title: string;
  action: string;
  time: string;
  type: 'room' | 'game' | 'friend';
}

export interface FloatingReaction {
  id: string;
  emoji: string;
  senderName: string;
  x: number;
  rotation: number;
  scale: number;
  timestamp: number;
}

// ─── Phase B: Media Library ─────────────────────────────────────────────────
// Typed, metadata-only structures. Binary video data never lives in these UI
// objects — bytes live in server-side MediaStorage and arrive via the
// authorized download endpoint.

/** Server-reported processing lifecycle of a library item. */
export type MediaStatus = 'draft' | 'uploading' | 'uploaded' | 'processing' | 'ready' | 'failed';

export interface MediaItem {
  id: string;
  title: string;
  description: string;
  /** Poster image URL (null/'' = placeholder thumbnail). */
  posterUrl: string | null;
  /** Duration in seconds (null until Phase C metadata extraction). */
  duration: number | null;
  sizeBytes: number;
  /** Video container/codec format, e.g. 'video/mp4'. */
  mimeType: string | null;
  status: MediaStatus;
  published: boolean;
  downloadAllowed: boolean;
  createdAt: string;
  /** Original client filename (display only — never a path). */
  originalFilename: string | null;
  createdByUserId: string;
  creatorName?: string;
  /** Admin-only storage bookkeeping (never shipped to normal users). */
  storageKey?: string | null;
  /** Admin-only: key of the playable MP4 produced by the FFmpeg pipeline. */
  playableKey?: string | null;
}

/** Resumable chunked upload session (Phase C). */
export interface MediaUploadSession {
  id: string;
  mediaId: string;
  totalBytes: number;
  chunkSize: number;
  chunkCount: number;
  receivedBytes: number;
  receivedChunks: number;
  status: 'active' | 'completed';
  missingChunks?: number[];
  expiresAt: string;
  createdAt: string;
  updatedAt: string;
}

export interface MediaPage {
  items: MediaItem[];
  total: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
}

/** Phase A UI state machine for the Media Library page. */
export type MediaLibraryState = 'loading' | 'ready' | 'empty' | 'error';

/** Payload for the upload form (metadata create + file). */
export interface MediaUploadInput {
  title: string;
  description: string;
  file: File | null;
  downloadAllowed: boolean;
  published: boolean;
}

