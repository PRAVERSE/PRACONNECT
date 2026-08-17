export type NavigationTab =
  | 'dashboard'
  | 'explore'
  | 'games'
  | 'friends'
  | 'messages'
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
  /** 'local-movie' = shared peer-to-peer via WebRTC (never has a url); 'url' = direct URL; 'hosted' = server upload. */
  mediaType?: 'local-movie' | 'url' | 'hosted' | string;
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
  reaction?: string;
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

export interface DirectMessage {
  id: string;
  senderId: string;
  text: string;
  timestamp: string;
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

