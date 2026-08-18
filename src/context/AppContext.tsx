import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import {
  NavigationTab,
  RoomItem,
  RoomTab,
  Participant,
  ChatMessage,
  Friend,
  DirectMessage,
  NotificationItem,
  UserProfile,
  UserSettings,
  RoomCategory,
  RoomPrivacy,
  RoomStatus,
  MediaTrack,
  RoomFile,
  FloatingReaction,
  ScheduledParty,
  WatchHistoryItem,
  RoomHistoryStats,
  MediaItem,
} from '../types';
import {
  initialUserProfile,
  initialUserSettings,
  initialFriends,
  initialNotifications,
  initialScheduledParties,
  initialWatchHistory
} from '../data/mockData';
import { getCurrentUser, logoutApi, AuthUser } from '../api/auth';
import {
  fetchRoomsApi,
  fetchRoomApi,
  createRoomApi,
  joinRoomApi,
  leaveRoomApi,
  setRoomMediaApi,
  setRoomLibraryMediaApi,
  setPlaybackApi,
  setScreenShareApi,
  setSelfDeviceStateApi,
  sendRoomChatApi,
  sendRoomReactionApi,
  removeMemberApi,
  muteMemberApi,
  setMemberCameraApi,
  sendSignalApi,
  connectRoomEvents,
  uploadRoomMediaApi,
  ServerRoom,
  ServerRoomMember,
  RoomSseState
} from '../api/rooms';
import { WebRTCManager } from '../webrtc/WebRTCManager';
import { MediaDiagnosticError, logRoomEntryDeviceDiagnostics } from '../webrtc/mediaDeviceDiagnostics';
import { fetchProfileStatsApi } from '../api/profile';
import {
  searchUsersApi,
  sendFriendRequestApi,
  fetchFriendsApi,
  fetchFriendRequestsApi,
  acceptFriendRequestApi,
  rejectFriendRequestApi,
  fetchConversationsApi,
  fetchMessagesApi,
  sendDirectMessageApi,
  fetchWatchInvitesApi,
  sendWatchInviteApi,
  acceptWatchInviteApi,
  declineWatchInviteApi,
  connectUserEvents,
  SocialUser,
  FriendRequestItem,
  WatchInviteItem,
  ConversationSummary,
  FriendListItem,
  DirectMessageItem,
  ConversationList,
  forwardMessageApi,
  pinMessageApi,
  unpinMessageApi,
  starMessageApi,
  unstarMessageApi,
  fetchPinnedMessagesApi,
  deleteMessageForMeApi,
  deleteMessageForEveryoneApi,
  setConversationArchivedApi,
  setConversationPinnedApi,
  setConversationFavouriteApi,
  markConversationReadApi,
  markConversationUnreadApi,
  clearChatApi,
  deleteChatApi,
  setChatLockPinApi,
  unlockChatApi,
  verifyChatLockApi,
  fetchConversationListsApi,
  createConversationListApi,
  deleteConversationListApi,
  addConversationToListApi,
  removeConversationFromListApi
} from '../api/social';
import { mapSearchResponse } from '../social/directory';
import { conversationKeyFor } from '../utils/contextMenu';

interface AppContextType {
  activeTab: NavigationTab;
  setActiveTab: (tab: NavigationTab) => void;
  
  // Auth state
  authState: 'loading' | 'authenticated' | 'unauthenticated';
  isAuthenticated: boolean;
  currentUser: AuthUser | null;
  /** Phase A: true when the authenticated session user has role 'admin'.
   *  Derived only from currentUser.role — never from email or local input.
   *  Real authorization is enforced server-side (requireAdmin) in Phase B;
   *  this flag only controls what the UI renders. */
  isAdmin: boolean;
  login: (user: AuthUser) => void;
  logout: () => void;
  refreshAuth: () => Promise<void>;
  
  // Room state
  currentRoom: RoomItem | null;
  activeRoomTab: RoomTab;
  setActiveRoomTab: (tab: RoomTab) => void;
  rooms: RoomItem[];
  refreshRooms: () => Promise<void>;
  participants: Participant[];
  roomSseState: RoomSseState;
  mediaConversion: { status: 'processing' | 'failed' | 'ready' | string; title?: string } | null;
  clearMediaConversion: () => void;
  updateParticipantRole: (participantId: string, role: 'host' | 'co-host' | 'viewer') => void;
  kickParticipant: (participantId: string) => void;
  chatMessages: ChatMessage[];
  roomNotes: string;
  setRoomNotes: React.Dispatch<React.SetStateAction<string>>;
  roomFiles: RoomFile[];
  addRoomFile: (file: RoomFile) => void;
  floatingReactions: FloatingReaction[];
  
  // Moderation & Host controls
  removeParticipant: (userId: string) => Promise<boolean>;
  muteParticipant: (userId: string, muted: boolean) => Promise<boolean>;
  setParticipantCamera: (userId: string, enabled: boolean) => Promise<boolean>;
  setRoomPlayback: (input: { isPlaying: boolean; position?: number }) => Promise<boolean>;
  
  // Scheduled Watch Parties & History
  scheduledParties: ScheduledParty[];
  scheduleParty: (params: {
    title: string;
    category: RoomCategory;
    scheduledFor: string;
    description?: string;
  }) => ScheduledParty;
  watchHistory: WatchHistoryItem[];

  // Server-authoritative room statistics (persistent history)
  roomStats: RoomHistoryStats | null;
  refreshRoomStats: () => Promise<void>;
  
  // WebRTC Media Streams & Error
  localMediaStream: MediaStream | null;
  localScreenStream: MediaStream | null;
  localMovieStream: MediaStream | null;
  remoteMediaStreams: Map<string, MediaStream>;
  remoteCameraStreams: Map<string, MediaStream>;
  remoteScreenStreams: Map<string, MediaStream>;
  remoteMovieStreams: Map<string, MediaStream>;
  mediaErrorMessage: string | null;
  mediaDiagnosticError: MediaDiagnosticError | null;
  clearMediaError: () => void;
  getManagerCameraDiagnostics: () => {
    managerId: string;
    destroyed: boolean;
    cameraState: string;
    cameraRecoveryAttempts: number;
    cameraAcquisitionInFlight: boolean;
    hasCameraStream: boolean;
    hasScreenStream: boolean;
    hasMovieStream: boolean;
  } | null;

  // Controls
  micOn: boolean;
  cameraOn: boolean;
  screenShareOn: boolean;
  toggleMic: () => void;
  toggleCamera: () => void;
  retryCamera: () => Promise<boolean>;
  toggleScreenShare: () => void;
  
  // Actions
  joinRoom: (roomCodeOrId: string) => Promise<boolean>;
  createRoom: (params: {
    name: string;
    category: RoomCategory;
    privacy: RoomPrivacy;
    maxMembers: number;
    description?: string;
  }) => Promise<RoomItem | null>;
  leaveRoom: () => Promise<void>;
  sendRoomChatMessage: (text: string) => void;
  sendReaction: (emoji: string, senderName?: string) => void;
  setRoomMedia: (media: MediaTrack | null) => void;
  /** Phase C: host selects a published Media Library item (mediaId reference —
   *  participants stream the playable MP4 from the library server-side). */
  setRoomLibraryMedia: (mediaId: string) => Promise<{ ok: boolean; error?: string }>;
  uploadRoomMedia: (file: File) => Promise<{ ok: boolean; error?: string }>;
  /** Phase 6.10: start (stream + lightweight metadata) or stop (null) the
   *  peer-to-peer local movie session. The file stays on the device; only
   *  metadata — never a URL — reaches the server. */
  setLocalMovieActive: (stream: MediaStream | null, metadata?: { title?: string; mimeType?: string; duration?: number; sourceUserId?: string }) => Promise<boolean>;
  
  // Friends & DMs
  friends: Friend[];
  activeDMId: string | null;
  setActiveDMId: (id: string | null) => void;
  dmConversations: Record<string, DirectMessage[]>;
  sendDirectMessage: (friendId: string, text: string) => void;
  addFriend: (username: string) => void;
  acceptFriendRequest: (requestId: string) => void;
  rejectFriendRequest: (requestId: string) => void;
  friendRequests: { incoming: FriendRequestItem[]; outgoing: FriendRequestItem[] };
  refreshSocial: () => Promise<void>;

  // Watch invitations
  watchInvites: WatchInviteItem[];
  sendWatchInvite: (recipientUserId: string, roomId: string) => Promise<void>;
  acceptWatchInvite: (inviteId: string) => Promise<boolean>;
  declineWatchInvite: (inviteId: string) => void;

  // Direct message conversations (server-backed)
  conversations: ConversationSummary[];
  openConversation: (friendId: string) => Promise<boolean>;
  /** Open (or create) a DM with an accepted friend and jump to the Messages
   *  page. The server remains authoritative: non-friends are rejected with
   *  FRIENDSHIP_REQUIRED. */
  startDm: (friendId: string) => void;

  // DM context actions (message menu)
  /** Ids of the pinned messages per conversation (shared with the peer). */
  pinnedMessageIds: Record<string, string[]>;
  sendReply: (friendId: string, text: string, replyToMessageId: string) => void;
  sendForward: (messageId: string, toFriendId: string) => Promise<boolean>;
  pinMessage: (messageId: string) => Promise<boolean>;
  unpinMessage: (messageId: string) => Promise<boolean>;
  starMessage: (messageId: string) => Promise<boolean>;
  unstarMessage: (messageId: string) => Promise<boolean>;
  deleteMessageForMe: (messageId: string) => Promise<boolean>;
  deleteMessageForEveryone: (messageId: string) => Promise<boolean>;

  // Conversation context actions (per-user settings)
  setConversationArchived: (friendId: string, archived: boolean) => Promise<boolean>;
  setConversationPinned: (friendId: string, pinned: boolean) => Promise<boolean>;
  setConversationFavourite: (friendId: string, favourite: boolean) => Promise<boolean>;
  markConversationRead: (friendId: string) => Promise<boolean>;
  markConversationUnread: (friendId: string) => Promise<boolean>;
  clearChat: (friendId: string) => Promise<boolean>;
  deleteChat: (friendId: string) => Promise<boolean>;

  // Chat locks (session-scope verification lives client-side; the PIN hash
  // and the locked flag are server-authoritative)
  setChatLockPin: (friendId: string, pin: string) => Promise<boolean>;
  unlockChat: (friendId: string, pin: string) => Promise<boolean>;
  verifyChatLock: (friendId: string, pin: string) => Promise<boolean>;
  isChatVerified: (friendId: string) => boolean;

  // Private conversation lists
  conversationLists: ConversationList[];
  refreshConversationLists: () => Promise<void>;
  createConversationList: (name: string) => Promise<boolean>;
  deleteConversationList: (listId: string) => Promise<boolean>;
  addConversationToList: (listId: string, friendId: string) => Promise<boolean>;
  removeConversationFromList: (listId: string, friendId: string) => Promise<boolean>;

  // Find Friends directory
  searchResults: SocialUser[];
  searchTotal: number;
  searchNextOffset: number;
  searchUsers: (query: string, offset?: number) => Promise<void>;
  clearSearch: () => void;
  sendFriendRequestToUser: (userId: string) => Promise<boolean>;
  
  // Notifications
  notifications: NotificationItem[];
  markNotificationRead: (id: string) => void;
  clearAllNotifications: () => void;
  
  // Settings & Profile
  userProfile: UserProfile;
  userSettings: UserSettings;
  updateSettings: (newSettings: Partial<UserSettings>) => void;
  updateProfile: (newProfile: Partial<UserProfile>) => void;
  
  // Modals
  createRoomModalOpen: boolean;
  setCreateRoomModalOpen: (open: boolean) => void;
  joinRoomModalOpen: boolean;
  setJoinRoomModalOpen: (open: boolean) => void;
  inviteModalOpen: boolean;
  setInviteModalOpen: (open: boolean) => void;
  scheduleModalOpen: boolean;
  setScheduleModalOpen: (open: boolean) => void;
  notificationsOpen: boolean;
  setNotificationsOpen: (open: boolean) => void;
}

const AppContext = createContext<AppContextType | undefined>(undefined);

function mapServerRoomToItem(r: ServerRoom, currentUserId: string | null): RoomItem {
  const isHost = Boolean(currentUserId && r.hostUserId === currentUserId);
  return {
    id: r.id,
    name: r.name,
    code: r.code,
    hostUserId: r.hostUserId,
    hostName: r.host?.name || 'Host',
    hostAvatar: r.host?.avatarUrl || r.host?.name?.charAt(0).toUpperCase() || 'H',
    isHost,
    category: (r.category as RoomCategory) || 'Other',
    privacy: (r.privacy as RoomPrivacy) || 'public',
    status: (r.status as RoomStatus) || 'LIVE',
    memberCount: r.memberCount,
    maxMembers: r.maxParticipants,
    activeMemberCount: r.activeMemberCount,
    isEmpty: r.isEmpty,
    isRejoinable: r.isRejoinable,
    rejoinExpiresAt: r.rejoinExpiresAt,
    currentMedia: r.currentMedia
      ? {
          title: r.currentMedia.title,
          url: r.currentMedia.url,
          poster: r.currentMedia.poster,
          duration: r.currentMedia.duration,
          type: (r.currentMedia.type as 'video' | 'stream') || 'video',
          mediaType: r.currentMedia.mediaType,
          sourceUserId: r.currentMedia.sourceUserId,
          mimeType: r.currentMedia.mimeType,
        }
      : null,
    playback: r.playback,
    screenShareActive: r.screenShareActive,
    lastActive: 'Just now',
    emptySince: r.emptySince,
    description: r.description || undefined,
  };
}

function mapServerMemberToParticipant(m: ServerRoomMember, currentUserId: string | null): Participant {
  const isLocal = Boolean(currentUserId && m.userId === currentUserId);
  return {
    id: m.userId,
    userId: m.userId,
    name: m.name,
    username: m.username,
    avatar: m.avatarUrl || m.name?.charAt(0).toUpperCase() || 'U',
    isLocal,
    isHost: m.role === 'host',
    role: m.role === 'host' ? 'host' : 'viewer',
    micOn: m.micOn,
    cameraOn: m.cameraOn,
    screenShareOn: m.screenShareOn,
    status: 'online',
  };
}

function mapFriendListItemToFriend(item: FriendListItem): Friend {
  return {
    id: item.id,
    name: item.name,
    username: item.username,
    avatar: item.avatar,
    status: item.online ? 'online' : 'offline',
    currentRoomCode: item.currentRoomCode ?? undefined,
    currentRoomName: item.currentRoomName ?? undefined,
  };
}

function mapDirectMessageItem(item: DirectMessageItem): DirectMessage {
  return {
    id: item.id,
    senderId: item.senderId,
    text: item.text,
    timestamp: new Date(item.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    createdAt: item.createdAt,
    replyToMessageId: item.replyToMessageId,
    forwardedFromMessageId: item.forwardedFromMessageId,
    deletedForEveryone: Boolean(item.deletedForEveryone),
    replyTo: item.replyTo ?? null,
    forwardedFrom: item.forwardedFrom ?? null,
  };
}

export const AppProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [activeTab, setActiveTab] = useState<NavigationTab>('dashboard');
  
  // Session & Authentication State
  const [authState, setAuthState] = useState<'loading' | 'authenticated' | 'unauthenticated'>('loading');
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(false);
  const [currentUser, setCurrentUser] = useState<AuthUser | null>(null);

  // Phase A: the UI role flag comes exclusively from the authenticated session
  // user — never from an email match or any client-supplied value.
  const isAdmin = currentUser?.role === 'admin';

  const [rooms, setRooms] = useState<RoomItem[]>([]);
  const [currentRoom, setCurrentRoom] = useState<RoomItem | null>(null);
  const [activeRoomTab, setActiveRoomTab] = useState<RoomTab>('Watch');

  const [micOn, setMicOn] = useState<boolean>(false);
  const [cameraOn, setCameraOn] = useState<boolean>(false);
  const [screenShareOn, setScreenShareOn] = useState<boolean>(false);

  // Real WebRTC Media Streams & Error Management
  const webrtcRef = useRef<WebRTCManager | null>(null);
  const [localMediaStream, setLocalMediaStream] = useState<MediaStream | null>(null);
  const [localScreenStream, setLocalScreenStream] = useState<MediaStream | null>(null);
  const [localMovieStream, setLocalMovieStream] = useState<MediaStream | null>(null);
  const [remoteCameraStreams, setRemoteCameraStreams] = useState<Map<string, MediaStream>>(new Map());
  const [remoteScreenStreams, setRemoteScreenStreams] = useState<Map<string, MediaStream>>(new Map());
  const [remoteMovieStreams, setRemoteMovieStreams] = useState<Map<string, MediaStream>>(new Map());
  const [mediaErrorMessage, setMediaErrorMessage] = useState<string | null>(null);
  const [mediaDiagnosticError, setMediaDiagnosticError] = useState<MediaDiagnosticError | null>(null);
  const clearMediaError = useCallback(() => {
    setMediaErrorMessage(null);
    setMediaDiagnosticError(null);
  }, []);
  const getManagerCameraDiagnostics = useCallback(
    () => (webrtcRef.current ? webrtcRef.current.getCameraDiagnostics() : null),
    []
  );

  const [userProfile, setUserProfile] = useState<UserProfile>(initialUserProfile);
  const [userSettings, setUserSettings] = useState<UserSettings>(initialUserSettings);
  const [friends, setFriends] = useState<Friend[]>(initialFriends);
  const [notifications, setNotifications] = useState<NotificationItem[]>(initialNotifications);

  // Direct Messages State
  const [activeDMId, setActiveDMId] = useState<string | null>(null);
  const [dmConversations, setDmConversations] = useState<Record<string, DirectMessage[]>>({});
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [pinnedMessageIds, setPinnedMessageIds] = useState<Record<string, string[]>>({});
  /** Conversation keys verified with a PIN this session (6h server window). */
  const [verifiedChatKeys, setVerifiedChatKeys] = useState<Set<string>>(new Set());
  const [conversationLists, setConversationLists] = useState<ConversationList[]>([]);

  // Social state (server-backed)
  const [friendRequests, setFriendRequests] = useState<{
    incoming: FriendRequestItem[];
    outgoing: FriendRequestItem[];
  }>({ incoming: [], outgoing: [] });
  const [watchInvites, setWatchInvites] = useState<WatchInviteItem[]>([]);

  // Find Friends directory
  const [searchResults, setSearchResults] = useState<SocialUser[]>([]);
  const [searchTotal, setSearchTotal] = useState(0);
  const [searchNextOffset, setSearchNextOffset] = useState(0);
  const searchQueryRef = useRef<string>('');
  const searchRequestIdRef = useRef(0);

  // Room Specific State
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [roomSseState, setRoomSseState] = useState<RoomSseState>('CLOSED');
  const [mediaConversion, setMediaConversion] = useState<{
    status: 'processing' | 'failed' | 'ready' | string;
    title?: string;
  } | null>(null);
  const clearMediaConversion = useCallback(() => setMediaConversion(null), []);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [roomNotes, setRoomNotes] = useState<string>('');
  const [roomFiles, setRoomFiles] = useState<RoomFile[]>([]);
  const [floatingReactions, setFloatingReactions] = useState<FloatingReaction[]>([]);

  const [scheduledParties, setScheduledParties] = useState<ScheduledParty[]>(initialScheduledParties);
  const [watchHistory, setWatchHistory] = useState<WatchHistoryItem[]>(initialWatchHistory);
  const [roomStats, setRoomStats] = useState<RoomHistoryStats | null>(null);
  const [scheduleModalOpen, setScheduleModalOpen] = useState<boolean>(false);

  // Synchronize authenticated user with profile
  const applyUserToProfile = useCallback((user: AuthUser) => {
    const joinedDateStr = user.createdAt
      ? new Date(user.createdAt).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
      : 'Joined recently';

    setUserProfile((prev) => ({
      ...prev,
      name: user.name,
      username: user.username,
      email: user.email,
      avatar: user.avatarUrl || user.name.charAt(0).toUpperCase() || 'U',
      joinedDate: joinedDateStr,
    }));
  }, []);

  // Fetch active rooms from server
  const refreshRooms = useCallback(async () => {
    const serverRooms = await fetchRoomsApi();
    const currentUid = currentUser?.id ?? null;
    setRooms(serverRooms.map((r) => mapServerRoomToItem(r, currentUid)));
  }, [currentUser?.id]);

  // Fetch authoritative profile statistics from durable room history. Called
  // after every lifecycle mutation (create/join/leave/room end) so the
  // profile/dashboard never waits for a page reload.
  const refreshRoomStats = useCallback(async () => {
    const res = await fetchProfileStatsApi();
    if (res.stats) setRoomStats(res.stats);
  }, []);

  // WebRTC Instance Lifecycle for Active Room
  useEffect(() => {
    if (!currentRoom?.id) {
      webrtcRef.current?.destroy();
      webrtcRef.current = null;
      setLocalMediaStream(null);
      setLocalScreenStream(null);
      setLocalMovieStream(null);
      setRemoteCameraStreams(new Map());
      setRemoteScreenStreams(new Map());
      setRemoteMovieStreams(new Map());
      return;
    }

    const myUid = currentUser?.id || 'local-user';
    const rtc = new WebRTCManager({
      roomId: currentRoom.id,
      myUserId: myUid,
      onLocalStreamChange: (stream) => {
        setLocalMediaStream(stream ? new MediaStream(stream.getTracks()) : null);
      },
      onLocalScreenStreamChange: (stream) => {
        setLocalScreenStream(stream ? new MediaStream(stream.getTracks()) : null);
      },
      onLocalMovieStreamChange: (stream) => {
        setLocalMovieStream(stream ? new MediaStream(stream.getTracks()) : null);
      },
      onRemoteStreamChange: (userId, cameraStream, screenStream, movieStream) => {
        setRemoteCameraStreams((prev) => {
          const next = new Map(prev);
          if (cameraStream && cameraStream.getTracks().length > 0) {
            next.set(userId, cameraStream);
          } else {
            next.delete(userId);
          }
          return next;
        });

        setRemoteScreenStreams((prev) => {
          const next = new Map(prev);
          if (screenStream && screenStream.getTracks().length > 0) {
            const isNew = !next.has(userId) || next.get(userId) !== screenStream;
            next.set(userId, screenStream);
            if (isNew) {
              console.log('[SCREEN UI] screenStream received:', {
                ts: new Date().toISOString(),
                userId,
                streamId: screenStream.id,
                tracks: screenStream.getTracks().map((t) => `${t.kind}:${t.readyState}`),
              });
            }
          } else {
            next.delete(userId);
          }
          return next;
        });

        // Phase 6.10: movie streams are stored in their own map so the Watch
        // stage can attach the host's movie to a dedicated <video> element.
        setRemoteMovieStreams((prev) => {
          const next = new Map(prev);
          if (movieStream && movieStream.getTracks().length > 0) {
            const isNew = !next.has(userId) || next.get(userId) !== movieStream;
            next.set(userId, movieStream);
            if (isNew) {
              console.log('[MOVIE UI] movieStream received:', {
                ts: new Date().toISOString(),
                userId,
                streamId: movieStream.id,
                tracks: movieStream.getTracks().map((t) => `${t.kind}:${t.readyState}`),
              });
            }
          } else {
            next.delete(userId);
          }
          return next;
        });
      },
      onError: (err) => {
        if (typeof err === 'object' && err !== null && 'actionableHint' in err) {
          setMediaDiagnosticError(err as MediaDiagnosticError);
          setMediaErrorMessage((err as MediaDiagnosticError).message);
        } else {
          setMediaErrorMessage(String(err));
          setMediaDiagnosticError(null);
        }
      },
      sendSignal: async (targetUserId, signal) => {
        await sendSignalApi(currentRoom.id, { targetUserId, signal });
      },
    });

    webrtcRef.current = rtc;

    console.log('[CAMERA DEBUG] room joined:', {
      ts: new Date().toISOString(),
      roomId: currentRoom.id,
      myUserId: myUid,
      hostUserId: currentRoom.hostUserId,
      isHost: currentRoom.isHost,
    });
    console.log('[CAMERA DEBUG] WebRTCManager created:', {
      ts: new Date().toISOString(),
      peerCount: 0,
    });

    return () => {
      rtc.destroy();
      if (webrtcRef.current === rtc) {
        webrtcRef.current = null;
      }
      setLocalMediaStream(null);
      setLocalScreenStream(null);
      setLocalMovieStream(null);
      setRemoteCameraStreams(new Map());
      setRemoteScreenStreams(new Map());
      setRemoteMovieStreams(new Map());
    };
  }, [currentRoom?.id, currentUser?.id]);

  // Sync active remote peers with WebRTC manager whenever participant list changes
  useEffect(() => {
    if (webrtcRef.current && participants.length > 0) {
      const remoteIds = participants
        .filter((p) => !p.isLocal)
        .map((p) => p.userId || p.id)
        .filter(Boolean) as string[];
      webrtcRef.current.syncPeers(remoteIds);
    }
  }, [participants]);

  // Automatic camera initialization on room entry. Runs once per room id.
  // Logs raw device enumeration at entry time, then acquires the camera. If
  // this fails, the [CAMERA DEBUG] / [RAW CAMERA TEST] logs below it prove
  // whether the cause is permission, OS device availability, or app code.
  useEffect(() => {
    if (!currentRoom?.id) return;
    const roomId = currentRoom.id;
    let cancelled = false;

    const initCamera = async () => {
      const rtc = webrtcRef.current;
      if (!rtc) return;
      // Diagnostic A — full device/permission/environment dump on room entry,
      // BEFORE any getUserMedia / getDisplayMedia call.
      await logRoomEntryDeviceDiagnostics('room entry (before screen share)');
      const ok = await rtc.startCamera();
      if (ok && !cancelled) {
        setCameraOn(true);
        setSelfDeviceStateApi(roomId, { cameraOn: true }).catch(() => {});
      }
    };

    initCamera();

    return () => {
      cancelled = true;
    };
  }, [currentRoom?.id]);

  // Notify server cleanly when browser tab closes
  useEffect(() => {
    if (!currentRoom?.id) return;
    const roomId = currentRoom.id;

    const handleBeforeUnload = () => {
      try {
        fetch(`/api/rooms/${roomId}/leave`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          keepalive: true,
        }).catch(() => {});
      } catch {}
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, [currentRoom?.id]);

  // Check existing session on startup (/api/auth/me)
  const refreshAuth = useCallback(async () => {
    try {
      const res = await getCurrentUser();
      if (res.authenticated && res.user) {
        // Dev diagnostic — traces the role chain; never logs password/token/session.
        if (process.env.NODE_ENV !== 'production') {
          console.log('[AUTH ROLE] AppContext refreshAuth', {
            authenticated: res.authenticated,
            email: res.user.email,
            role: res.user.role,
            isAdmin: res.user.role === 'admin',
          });
        }
        setCurrentUser(res.user);
        setIsAuthenticated(true);
        setAuthState('authenticated');
        applyUserToProfile(res.user);
      } else {
        setCurrentUser(null);
        setIsAuthenticated(false);
        setAuthState('unauthenticated');
      }
    } catch {
      setCurrentUser(null);
      setIsAuthenticated(false);
      setAuthState('unauthenticated');
    }
  }, [applyUserToProfile]);

  useEffect(() => {
    refreshAuth();
  }, [refreshAuth]);

  useEffect(() => {
    if (isAuthenticated) {
      refreshRooms();
      refreshRoomStats();
    }
  }, [isAuthenticated, refreshRooms, refreshRoomStats]);

  const login = (user: AuthUser) => {
    // Dev diagnostic — traces role from login API response.
    if (process.env.NODE_ENV !== 'production') {
      console.log('[AUTH ROLE] AppContext login', {
        email: user.email,
        role: user.role,
        isAdmin: user.role === 'admin',
      });
    }
    setCurrentUser(user);
    setIsAuthenticated(true);
    setAuthState('authenticated');
    applyUserToProfile(user);
    setActiveTab('dashboard');
    refreshRooms();
    refreshRoomStats();
  };

  const logout = async () => {
    if (currentRoom) {
      await leaveRoom();
    }
    await logoutApi();
    setCurrentUser(null);
    setIsAuthenticated(false);
    setAuthState('unauthenticated');
    setRooms([]);
    setFriends([]);
    setFriendRequests({ incoming: [], outgoing: [] });
    setWatchInvites([]);
    setConversations([]);
    setDmConversations({});
    setPinnedMessageIds({});
    setVerifiedChatKeys(new Set());
    setConversationLists([]);
    setActiveDMId(null);
    clearSearch();
    setActiveTab('dashboard');
  };

  const scheduleParty = (params: {
    title: string;
    category: RoomCategory;
    scheduledFor: string;
    description?: string;
  }): ScheduledParty => {
    const code = `${params.title.toLowerCase().replace(/[^a-z0-9]/g, '-')}-${Math.floor(
      10 + Math.random() * 90
    )}`;
    const newParty: ScheduledParty = {
      id: `sched-${Date.now()}`,
      title: params.title,
      category: params.category,
      scheduledFor: params.scheduledFor,
      hostName: userProfile.name || 'Host',
      hostAvatar: userProfile.avatar || 'H',
      invitedFriendsCount: 0,
      description: params.description || 'Watch party hangout scheduled on PraConnect.',
      roomCode: code
    };
    setScheduledParties((prev) => [newParty, ...prev]);
    return newParty;
  };

  const updateParticipantRole = (participantId: string, role: 'host' | 'co-host' | 'viewer') => {
    setParticipants((prev) =>
      prev.map((p) => (p.id === participantId ? { ...p, role, isHost: role === 'host' } : p))
    );
  };

  const kickParticipant = (participantId: string) => {
    if (currentRoom) {
      removeParticipant(participantId);
    }
  };

  // Synchronize document theme attribute with userSettings.theme
  useEffect(() => {
    const themeAttr = userSettings.theme.toLowerCase();
    document.documentElement.setAttribute('data-theme', themeAttr);
    if (themeAttr === 'light') {
      document.documentElement.classList.add('light');
    } else {
      document.documentElement.classList.remove('light');
    }
  }, [userSettings.theme]);

  // In-flight operation guards to prevent concurrent toggles
  const isTogglingCameraRef = useRef(false);
  const isTogglingMicRef = useRef(false);
  const isTogglingScreenShareRef = useRef(false);

  // Real-time device state updates for current room with real WebRTC tracks
  const toggleMic = async () => {
    if (!currentRoom || isTogglingMicRef.current) return;
    isTogglingMicRef.current = true;
    try {
      if (!micOn) {
        const ok = await webrtcRef.current?.startMic();
        if (ok) {
          setMicOn(true);
          await setSelfDeviceStateApi(currentRoom.id, { micOn: true });
        }
      } else {
        webrtcRef.current?.stopMic();
        setMicOn(false);
        await setSelfDeviceStateApi(currentRoom.id, { micOn: false });
      }
    } finally {
      isTogglingMicRef.current = false;
    }
  };

  const toggleCamera = async () => {
    if (!currentRoom || isTogglingCameraRef.current) return;
    isTogglingCameraRef.current = true;
    try {
      if (!cameraOn) {
        const ok = await webrtcRef.current?.startCamera();
        if (ok) {
          setCameraOn(true);
          await setSelfDeviceStateApi(currentRoom.id, { cameraOn: true });
        }
      } else {
        webrtcRef.current?.stopCamera();
        setCameraOn(false);
        await setSelfDeviceStateApi(currentRoom.id, { cameraOn: false });
      }
    } finally {
      isTogglingCameraRef.current = false;
    }
  };

  const retryCamera = async (): Promise<boolean> => {
    if (!currentRoom || isTogglingCameraRef.current) return false;
    isTogglingCameraRef.current = true;
    try {
      console.log('[TRIGGER] retryCamera() explicitly stopping previous camera tracks before re-acquisition...');
      webrtcRef.current?.stopCamera();
      setCameraOn(false);
      await setSelfDeviceStateApi(currentRoom.id, { cameraOn: false });

      // Hardware release backoff
      await new Promise((resolve) => setTimeout(resolve, 200));

      const ok = await webrtcRef.current?.startCamera();
      console.log('[CAMERA LIFECYCLE] after retryCamera():', {
        ts: new Date().toISOString(),
        ok: Boolean(ok),
      });
      if (typeof navigator !== 'undefined' && navigator.mediaDevices?.enumerateDevices) {
        const devices = await navigator.mediaDevices.enumerateDevices();
        console.log('[CAMERA LIFECYCLE] enumerateDevices after retryCamera():', {
          videoInputs: devices.filter((d) => d.kind === 'videoinput').length,
          total: devices.length,
        });
      }
      if (ok) {
        setCameraOn(true);
        await setSelfDeviceStateApi(currentRoom.id, { cameraOn: true });
        return true;
      }
      return false;
    } finally {
      isTogglingCameraRef.current = false;
    }
  };

  const toggleScreenShare = async () => {
    if (!currentRoom || !currentRoom.isHost || isTogglingScreenShareRef.current) return;
    isTogglingScreenShareRef.current = true;
    try {
      if (!screenShareOn) {
        const ok = await webrtcRef.current?.startScreenShare(() => {
          setScreenShareOn(false);
          setScreenShareApi(currentRoom.id, false).catch(() => {});
        });
        if (ok) {
          setScreenShareOn(true);
          await setScreenShareApi(currentRoom.id, true);
        }
      } else {
        webrtcRef.current?.stopScreenShare();
        setScreenShareOn(false);
        await setScreenShareApi(currentRoom.id, false);
      }
    } finally {
      isTogglingScreenShareRef.current = false;
    }
  };

  // ─── Real Room Actions ──────────────────────────────────────────────────────

  const joinRoom = async (roomCodeOrId: string): Promise<boolean> => {
    const res = await joinRoomApi(roomCodeOrId);
    if (!res.ok || !res.data) {
      return false;
    }

    const serverRoom = res.data;
    const roomItem = mapServerRoomToItem(serverRoom, currentUser?.id ?? null);
    setCurrentRoom(roomItem);

    // Populate real participants
    const parts = (serverRoom.members || []).map((m) =>
      mapServerMemberToParticipant(m, currentUser?.id ?? null)
    );
    setParticipants(parts);

    // Initial system chat message
    setChatMessages([
      {
        id: `sys-${Date.now()}`,
        senderId: 'system',
        senderName: 'System',
        senderAvatar: '⚡',
        text: `Welcome to ${serverRoom.name}! Room Code: ${serverRoom.code}`,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        isSystem: true,
      },
    ]);

    setMicOn(false);
    setCameraOn(false);
    setScreenShareOn(currentUser?.id === serverRoom.hostUserId ? serverRoom.screenShareActive : false);
    setActiveTab('room');
    refreshRooms();
    refreshRoomStats();
    return true;
  };

  const createRoom = async (params: {
    name: string;
    category: RoomCategory;
    privacy: RoomPrivacy;
    maxMembers: number;
    description?: string;
  }): Promise<RoomItem | null> => {
    const res = await createRoomApi({
      name: params.name,
      category: params.category,
      privacy: params.privacy,
      maxParticipants: params.maxMembers,
      description: params.description,
    });

    if (!res.ok || !res.data) {
      return null;
    }

    const serverRoom = res.data;
    const roomItem = mapServerRoomToItem(serverRoom, currentUser?.id ?? null);
    setCurrentRoom(roomItem);

    const parts = (serverRoom.members || []).map((m) =>
      mapServerMemberToParticipant(m, currentUser?.id ?? null)
    );
    setParticipants(parts);

    setChatMessages([
      {
        id: `sys-${Date.now()}`,
        senderId: 'system',
        senderName: 'System',
        senderAvatar: '⚡',
        text: `Room "${serverRoom.name}" created! Code: ${serverRoom.code}`,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        isSystem: true,
      },
    ]);

    setMicOn(false);
    setCameraOn(false);
    setScreenShareOn(false);
    setActiveTab('room');
    refreshRooms();
    refreshRoomStats();
    return roomItem;
  };

  const leaveRoom = async () => {
    if (currentRoom) {
      await leaveRoomApi(currentRoom.id).catch(() => {});
    }
    setCurrentRoom(null);
    setParticipants([]);
    setChatMessages([]);
    setMicOn(false);
    setCameraOn(false);
    setScreenShareOn(false);
    setMediaConversion(null);
    setActiveTab('dashboard');
    refreshRooms();
    refreshRoomStats();
  };

  const sendRoomChatMessage = async (text: string) => {
    if (!text.trim() || !currentRoom) return;
    await sendRoomChatApi(currentRoom.id, text.trim());
  };

  const pushFloatingReaction = useCallback((emoji: string, senderName: string) => {
    const newReaction: FloatingReaction = {
      id: `float-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      emoji,
      senderName,
      x: Math.floor(12 + Math.random() * 76),
      rotation: Math.floor(-20 + Math.random() * 40),
      scale: parseFloat((0.95 + Math.random() * 0.45).toFixed(2)),
      timestamp: Date.now(),
    };

    setFloatingReactions((prev) => [...prev, newReaction]);

    setTimeout(() => {
      setFloatingReactions((prev) => prev.filter((r) => r.id !== newReaction.id));
    }, 3000);
  }, []);

  const sendReaction = (emoji: string, senderName?: string) => {
    if (!currentRoom) return;
    const name = senderName || userProfile.name || 'You';

    // Transient reaction signaling — a reaction is NEVER a chat message. It is
    // broadcast ephemerally over SSE and must not pollute chat history.
    sendRoomReactionApi(currentRoom.id, emoji).catch(() => {});

    pushFloatingReaction(emoji, name);
  };

  const setRoomMedia = async (media: MediaTrack | null) => {
    if (!currentRoom || !currentRoom.isHost) return;
    await setRoomMediaApi(currentRoom.id, media);
  };

  /** Phase C: host selects a published Media Library item for the room. The
   *  room stores only a mediaId reference — every participant streams the
   *  playable MP4 from the library through their own authenticated session,
   *  never over WebRTC. */
  const setRoomLibraryMedia = async (mediaId: string): Promise<{ ok: boolean; error?: string }> => {
    if (!currentRoom || !currentRoom.isHost) {
      return { ok: false, error: 'Only the room host can change media.' };
    }
    const res = await setRoomLibraryMediaApi(currentRoom.id, mediaId);
    if (!res.ok) {
      const msg = res.error?.message || 'Could not select that media.';
      setMediaErrorMessage(msg);
      return { ok: false, error: msg };
    }
    return { ok: true };
  };

  const uploadRoomMedia = async (file: File): Promise<{ ok: boolean; error?: string }> => {
    if (!currentRoom || !currentRoom.isHost) {
      return { ok: false, error: 'Only the room host can upload media.' };
    }
    const res = await uploadRoomMediaApi(currentRoom.id, file);
    if (!res.ok) {
      const msg = res.error?.message || 'Failed to upload media file.';
      setMediaErrorMessage(msg);
      return { ok: false, error: msg };
    }
    if (res.data?.conversion) {
      setMediaConversion({
        status: res.data.conversion.status,
        title: res.data.conversion.title,
      });
    }
    return { ok: true };
  };

  const setLocalMovieActive = async (
    stream: MediaStream | null,
    metadata?: { title?: string; mimeType?: string; duration?: number; sourceUserId?: string }
  ): Promise<boolean> => {
    if (!currentRoom || !currentRoom.isHost) return false;
    const manager = webrtcRef.current;
    if (!manager) return false;

    if (!stream) {
      // Stop: detach the movie senders (stops the captured tracks) and clear
      // the room's local-movie metadata.
      manager.setLocalMovieStream(null);
      await setRoomMediaApi(currentRoom.id, null).catch(() => {});
      return true;
    }

    // Start: attach the captured stream to every WebRTC peer (this is where
    // the movie bytes flow: host → WebRTC → participants) and announce ONLY
    // lightweight metadata — the file and its blob URL never leave the device.
    if (!manager.setLocalMovieStream(stream)) {
      return false;
    }
    const res = await setRoomMediaApi(currentRoom.id, {
      title: metadata?.title?.trim() || 'Local movie',
      mediaType: 'local-movie',
      mimeType: metadata?.mimeType,
      duration: metadata?.duration,
      sourceUserId: currentUser?.id,
    });
    if (!res.ok) {
      manager.setLocalMovieStream(null);
      return false;
    }
    await setPlaybackApi(currentRoom.id, { isPlaying: true, position: 0 });
    return true;
  };

  const setRoomPlayback = async (input: { isPlaying: boolean; position?: number }): Promise<boolean> => {
    if (!currentRoom || !currentRoom.isHost) return false;
    const res = await setPlaybackApi(currentRoom.id, input);
    return res.ok;
  };

  const removeParticipant = async (userId: string): Promise<boolean> => {
    if (!currentRoom || !currentRoom.isHost) return false;
    const res = await removeMemberApi(currentRoom.id, userId);
    return res.ok;
  };

  const muteParticipant = async (userId: string, muted: boolean): Promise<boolean> => {
    if (!currentRoom || !currentRoom.isHost) return false;
    const res = await muteMemberApi(currentRoom.id, userId, muted);
    return res.ok;
  };

  const setParticipantCamera = async (userId: string, enabled: boolean): Promise<boolean> => {
    if (!currentRoom || !currentRoom.isHost) return false;
    const res = await setMemberCameraApi(currentRoom.id, userId, enabled);
    return res.ok;
  };

  const addRoomFile = (file: RoomFile) => {
    setRoomFiles((prev) => [file, ...prev]);
  };

  const sendDirectMessage = (friendId: string, text: string, replyToMessageId?: string | null) => {
    if (!text.trim()) return;
    const optimistic: DirectMessage = {
      id: `dm-${Date.now()}`,
      senderId: currentUser?.id ?? 'user',
      text: text.trim(),
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    };
    setDmConversations((prev) => ({
      ...prev,
      [friendId]: [...(prev[friendId] || []), optimistic]
    }));
    sendDirectMessageApi(friendId, text.trim(), replyToMessageId ? { replyToMessageId } : undefined).then((res) => {
      if (res.ok && res.data?.message) {
        const serverMsg = mapDirectMessageItem(res.data.message);
        setDmConversations((prev) => ({
          ...prev,
          [friendId]: (prev[friendId] || []).map((m) => (m.id === optimistic.id ? serverMsg : m))
        }));
        fetchConversationsApi().then((r) => {
          if (r.ok && r.data) setConversations(r.data.conversations);
        });
      }
    });
  };

  /** Add a friend by @handle: resolves the username in the directory and sends a request. */
  const addFriend = async (username: string) => {
    const handle = username.trim().replace(/^@/, '');
    if (!handle) return;
    const res = await searchUsersApi(handle, 5, 0);
    if (res.ok && res.data && res.data.users.length > 0) {
      const exact = res.data.users.find((u) => u.username.toLowerCase() === handle.toLowerCase()) ?? res.data.users[0];
      await sendFriendRequestToUser(exact.id);
      refreshSocial();
    }
  };

  const acceptFriendRequest = (requestId: string) => {
    acceptFriendRequestApi(requestId).then(() => refreshSocial());
  };

  const rejectFriendRequest = (requestId: string) => {
    rejectFriendRequestApi(requestId).then(() => refreshSocial());
  };

  /** Send a friend request to a directory user; returns whether the server accepted it. */
  const sendFriendRequestToUser = async (userId: string): Promise<boolean> => {
    const res = await sendFriendRequestApi(userId);
    if (res.ok) {
      refreshSocial();
      return true;
    }
    return false;
  };

  /** Full social-state refresh: friends, requests, conversations, watch invites, lists. */
  const refreshSocial = useCallback(async () => {
    const [friendsRes, requestsRes, conversationsRes, invitesRes, listsRes] = await Promise.all([
      fetchFriendsApi(),
      fetchFriendRequestsApi(),
      fetchConversationsApi(),
      fetchWatchInvitesApi(),
      fetchConversationListsApi(),
    ]);
    if (friendsRes.ok && friendsRes.data) {
      setFriends(friendsRes.data.friends.map(mapFriendListItemToFriend));
    }
    if (requestsRes.ok && requestsRes.data) {
      setFriendRequests({
        incoming: requestsRes.data.incoming,
        outgoing: requestsRes.data.outgoing,
      });
    }
    if (conversationsRes.ok && conversationsRes.data) {
      setConversations(conversationsRes.data.conversations);
    }
    if (invitesRes.ok && invitesRes.data) {
      setWatchInvites(invitesRes.data.invites);
    }
    if (listsRes.ok && listsRes.data) {
      setConversationLists(listsRes.data.lists);
    }
  }, []);

  /** Load (or reload) message history + pinned messages for a conversation.
   *  Resolves false when the conversation is locked and the PIN has not been
   *  verified this session (LOCK_REQUIRED) — the caller should offer the
   *  lock dialog. */
  const openConversation = useCallback(async (friendId: string) => {
    const res = await fetchMessagesApi(friendId, 50);
    if (res.ok && res.data) {
      setDmConversations((prev) => ({
        ...prev,
        [friendId]: res.data!.messages.map(mapDirectMessageItem),
      }));
      const pinned = await fetchPinnedMessagesApi(friendId);
      if (pinned.ok && pinned.data) {
        setPinnedMessageIds((prev) => ({
          ...prev,
          [friendId]: pinned.data!.messages.map((m) => m.id),
        }));
      }
      return true;
    }
    return false;
  }, []);

  /**
   * Start a DM with an accepted friend: jump to the Messages page, select the
   * friend, and load/create the conversation through the existing server flow.
   * If the friendship is not accepted, the server returns FRIENDSHIP_REQUIRED
   * and no conversation is created.
   */
  const startDm = useCallback(
    (friendId: string) => {
      setActiveDMId(friendId);
      void openConversation(friendId);
      setActiveTab('messages');
    },
    [openConversation]
  );

  // ─── DM context actions (message menu) ─────────────────────────────────────

  /** Refresh the conversation list from the server (source of truth after
   *  any per-user setting mutation). */
  const refreshConversationList = useCallback(() => {
    fetchConversationsApi().then((res) => {
      if (res.ok && res.data) setConversations(res.data.conversations);
    });
  }, []);

  const sendReply = (friendId: string, text: string, replyToMessageId: string) => {
    sendDirectMessage(friendId, text, replyToMessageId);
  };

  const sendForward = useCallback(async (messageId: string, toFriendId: string) => {
    const res = await forwardMessageApi(messageId, toFriendId);
    if (res.ok) {
      fetchConversationsApi().then((r) => {
        if (r.ok && r.data) setConversations(r.data.conversations);
      });
    }
    return res.ok;
  }, []);

  const pinMessage = useCallback(async (messageId: string) => {
    const res = await pinMessageApi(messageId);
    return res.ok;
  }, []);

  const unpinMessage = useCallback(async (messageId: string) => {
    const res = await unpinMessageApi(messageId);
    return res.ok;
  }, []);

  const starMessage = useCallback(async (messageId: string) => {
    const res = await starMessageApi(messageId);
    return res.ok;
  }, []);

  const unstarMessage = useCallback(async (messageId: string) => {
    const res = await unstarMessageApi(messageId);
    return res.ok;
  }, []);

  const deleteMessageForMe = useCallback(async (messageId: string) => {
    const res = await deleteMessageForMeApi(messageId);
    if (res.ok) {
      setDmConversations((prev: Record<string, DirectMessage[]>) => {
        const next: Record<string, DirectMessage[]> = {};
        for (const [friendId, messages] of Object.entries(prev)) {
          next[friendId] = messages.filter((m) => m.id !== messageId);
        }
        return next;
      });
      refreshConversationList();
    }
    return res.ok;
  }, [refreshConversationList]);

  const deleteMessageForEveryone = useCallback(async (messageId: string) => {
    const res = await deleteMessageForEveryoneApi(messageId);
    if (res.ok) {
      setDmConversations((prev: Record<string, DirectMessage[]>) => {
        const next: Record<string, DirectMessage[]> = {};
        for (const [friendId, messages] of Object.entries(prev)) {
          next[friendId] = messages.map((m) =>
            m.id === messageId
              ? { ...m, text: '', deletedForEveryone: true, replyToMessageId: null, forwardedFromMessageId: null, replyTo: null, forwardedFrom: null }
              : m
          );
        }
        return next;
      });
      refreshConversationList();
    }
    return res.ok;
  }, [refreshConversationList]);

  // ─── Conversation context actions (per-user settings) ──────────────────────

  const setConversationArchived = useCallback(async (friendId: string, archived: boolean) => {
    const res = await setConversationArchivedApi(friendId, archived);
    refreshConversationList();
    return res.ok;
  }, [refreshConversationList]);

  const setConversationPinned = useCallback(async (friendId: string, pinned: boolean) => {
    const res = await setConversationPinnedApi(friendId, pinned);
    refreshConversationList();
    return res.ok;
  }, [refreshConversationList]);

  const setConversationFavourite = useCallback(async (friendId: string, favourite: boolean) => {
    const res = await setConversationFavouriteApi(friendId, favourite);
    refreshConversationList();
    return res.ok;
  }, [refreshConversationList]);

  const markConversationRead = useCallback(async (friendId: string) => {
    const res = await markConversationReadApi(friendId);
    refreshConversationList();
    return res.ok;
  }, [refreshConversationList]);

  const markConversationUnread = useCallback(async (friendId: string) => {
    const res = await markConversationUnreadApi(friendId);
    refreshConversationList();
    return res.ok;
  }, [refreshConversationList]);

  const clearChat = useCallback(async (friendId: string) => {
    const res = await clearChatApi(friendId);
    if (res.ok) {
      setDmConversations((prev) => ({ ...prev, [friendId]: [] }));
      refreshConversationList();
    }
    return res.ok;
  }, [refreshConversationList]);

  const deleteChat = useCallback(async (friendId: string) => {
    const res = await deleteChatApi(friendId);
    if (res.ok) {
      setDmConversations((prev) => {
        const next = { ...prev };
        delete next[friendId];
        return next;
      });
      setPinnedMessageIds((prev) => {
        const next = { ...prev };
        delete next[friendId];
        return next;
      });
      refreshConversationList();
    }
    return res.ok;
  }, [refreshConversationList]);

  // ─── Chat locks ────────────────────────────────────────────────────────────

  const setChatLockPin = useCallback(async (friendId: string, pin: string) => {
    const res = await setChatLockPinApi(friendId, pin);
    if (res.ok) {
      setVerifiedChatKeys((prev) => new Set(prev).add(conversationKeyFor(friendId, currentUser?.id ?? '')));
      refreshConversationList();
    }
    return res.ok;
  }, [currentUser?.id, refreshConversationList]);

  const unlockChat = useCallback(async (friendId: string, pin: string) => {
    const res = await unlockChatApi(friendId, pin);
    if (res.ok) {
      setVerifiedChatKeys((prev) => {
        const next = new Set(prev);
        next.delete(conversationKeyFor(friendId, currentUser?.id ?? ''));
        return next;
      });
      refreshConversationList();
    }
    return res.ok;
  }, [currentUser?.id, refreshConversationList]);

  const verifyChatLock = useCallback(async (friendId: string, pin: string) => {
    const res = await verifyChatLockApi(friendId, pin);
    if (res.ok) {
      setVerifiedChatKeys((prev) => new Set(prev).add(conversationKeyFor(friendId, currentUser?.id ?? '')));
      await openConversation(friendId);
    }
    return res.ok;
  }, [currentUser?.id, openConversation]);

  const isChatVerified = useCallback(
    (friendId: string) => verifiedChatKeys.has(conversationKeyFor(friendId, currentUser?.id ?? '')),
    [verifiedChatKeys, currentUser?.id]
  );

  // ─── Private conversation lists ────────────────────────────────────────────

  const refreshConversationLists = useCallback(async () => {
    const res = await fetchConversationListsApi();
    if (res.ok && res.data) setConversationLists(res.data.lists);
  }, []);

  const createConversationList = useCallback(async (name: string) => {
    const res = await createConversationListApi(name);
    if (res.ok) await refreshConversationLists();
    return res.ok;
  }, [refreshConversationLists]);

  const deleteConversationList = useCallback(async (listId: string) => {
    const res = await deleteConversationListApi(listId);
    if (res.ok) await refreshConversationLists();
    return res.ok;
  }, [refreshConversationLists]);

  const addConversationToList = useCallback(async (listId: string, friendId: string) => {
    const res = await addConversationToListApi(listId, friendId);
    if (res.ok) await refreshConversationLists();
    return res.ok;
  }, [refreshConversationLists]);

  const removeConversationFromList = useCallback(async (listId: string, friendId: string) => {
    const res = await removeConversationFromListApi(listId, friendId);
    if (res.ok) await refreshConversationLists();
    return res.ok;
  }, [refreshConversationLists]);

  const sendWatchInvite = async (recipientUserId: string, roomId: string) => {
    const res = await sendWatchInviteApi(recipientUserId, roomId);
    if (res.ok && res.data) {
      setWatchInvites((prev) => {
        if (prev.some((i) => i.id === res.data!.invite.id)) return prev;
        return [...prev, res.data!.invite];
      });
    }
  };

  const acceptWatchInvite = async (inviteId: string): Promise<boolean> => {
    const res = await acceptWatchInviteApi(inviteId);
    refreshSocial();
    if (res.ok && res.data?.roomCode) {
      return joinRoom(res.data.roomCode);
    }
    return false;
  };

  const declineWatchInvite = (inviteId: string) => {
    declineWatchInviteApi(inviteId).then(() => refreshSocial());
  };

  /** Push an in-app notification toast/modal item. */
  const pushNotification = useCallback((item: Omit<NotificationItem, 'id' | 'time' | 'read'>) => {
    const now = new Date();
    const notification: NotificationItem = {
      ...item,
      id: `notif-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      time: now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      read: false,
    };
    setNotifications((prev) => [notification, ...prev].slice(0, 50));
  }, []);

  // ─── User-scoped social event stream (SSE) ────────────────────────────────
  const activeDMIdRef = useRef<string | null>(null);
  activeDMIdRef.current = activeDMId;

  useEffect(() => {
    if (!isAuthenticated || !currentUser?.id) return;
    refreshSocial();

    const cleanupSse = connectUserEvents({
      onEvent: (type, rawPayload) => {
        const payload = rawPayload as any;
        const myId = currentUser?.id;
        const currentDMId = activeDMIdRef.current;

        switch (type) {
          case 'friend:request': {
            const requester = payload?.requester as SocialUser | undefined;
            if (requester) {
              pushNotification({
                title: 'New friend request',
                message: `${requester.name} (@${requester.username}) sent you a friend request.`,
                type: 'friend_request',
              });
            }
            refreshSocial();
            break;
          }
          case 'friend:accepted': {
            const friend = payload?.friend as SocialUser | undefined;
            if (friend) {
              pushNotification({
                title: 'Friend request accepted',
                message: `You're now friends with ${friend.name} (@${friend.username}). You can message them now.`,
                type: 'system',
                friendId: friend.id,
              });
            }
            refreshSocial();
            break;
          }
          case 'watch:invite': {
            const invite = payload?.invite as WatchInviteItem | undefined;
            if (invite) {
              setWatchInvites((prev) => {
                if (prev.some((i) => i.id === invite!.id)) return prev;
                return [...prev, invite!];
              });
              if (invite.roomAlive) {
                pushNotification({
                  title: 'Watch invitation',
                  message: `${invite.sender.name} invited you to watch in "${invite.roomName}".`,
                  type: 'invite',
                  roomCode: invite.roomCode,
                });
              }
            }
            break;
          }
          case 'watch:invite:accepted':
          case 'watch:invite:declined': {
            const inviteId = payload?.inviteId as string | undefined;
            const recipientId = payload?.recipientId as string | undefined;
            if (inviteId) {
              setWatchInvites((prev) =>
                prev.map((i) =>
                  i.id === inviteId
                    ? { ...i, status: type === 'watch:invite:accepted' ? 'accepted' : 'declined' }
                    : i
                )
              );
            }
            if (recipientId && recipientId !== myId) {
              refreshSocial();
            }
            break;
          }
          case 'dm:new': {
            const msg = payload?.message as DirectMessageItem | undefined;
            if (msg) {
              const myIdForDm = currentUser?.id;
              const conversationKey =
                msg.recipientId === myIdForDm ? msg.senderId : (msg.recipientId ?? msg.senderId);
              setDmConversations((prev) => {
                if (currentDMId === conversationKey) {
                  return {
                    ...prev,
                    [conversationKey]: [...(prev[conversationKey] || []), mapDirectMessageItem(msg)],
                  };
                }
                return prev;
              });
              fetchConversationsApi().then((res) => {
                if (res.ok && res.data) setConversations(res.data.conversations);
              });
              const senderName = payload?.senderName as string | undefined;
              if (msg.senderId !== myId) {
                pushNotification({
                  title: 'New direct message',
                  message: `${senderName || 'A friend'} sent you a message.`,
                  type: 'system',
                });
              }
            }
            break;
          }
          case 'dm:deleted': {
            const deleted = payload?.message as { id?: string; senderId?: string; deletedForEveryone?: boolean } | undefined;
            if (deleted?.id) {
              setDmConversations((prev: Record<string, DirectMessage[]>) => {
                const next: Record<string, DirectMessage[]> = {};
                for (const [friendId, messages] of Object.entries(prev)) {
                  next[friendId] = messages.map((m) =>
                    m.id === deleted.id
                      ? { ...m, text: '', deletedForEveryone: true, replyToMessageId: null, forwardedFromMessageId: null, replyTo: null, forwardedFrom: null }
                      : m
                  );
                }
                return next;
              });
              setPinnedMessageIds((prev: Record<string, string[]>) => {
                const next: Record<string, string[]> = {};
                for (const [friendId, ids] of Object.entries(prev)) {
                  next[friendId] = ids.filter((id) => id !== deleted.id);
                }
                return next;
              });
              fetchConversationsApi().then((res) => {
                if (res.ok && res.data) setConversations(res.data.conversations);
              });
            }
            break;
          }
          case 'dm:pinned':
          case 'dm:unpinned': {
            const pin = payload as { messageId?: string; friendId?: string } | undefined;
            if (pin?.messageId && pin.friendId) {
              setPinnedMessageIds((prev) => {
                const existing = prev[pin.friendId!] ?? [];
                const has = existing.includes(pin.messageId!);
                if (type === 'dm:pinned' && !has) {
                  return { ...prev, [pin.friendId!]: [...existing, pin.messageId!] };
                }
                if (type === 'dm:unpinned' && has) {
                  return { ...prev, [pin.friendId!]: existing.filter((id) => id !== pin.messageId) };
                }
                return prev;
              });
            }
            break;
          }
          case 'conversation:updated': {
            fetchConversationsApi().then((res) => {
              if (res.ok && res.data) setConversations(res.data.conversations);
            });
            break;
          }
        }
      },
    });

    return () => {
      cleanupSse();
    };
  }, [isAuthenticated, currentUser?.id, refreshSocial, pushNotification]);

  // ─── Find Friends directory ───────────────────────────────────────────────
  const searchUsers = useCallback(async (query: string, offset = 0) => {
    const requestId = ++searchRequestIdRef.current;
    searchQueryRef.current = query.trim();
    console.log('[FRIENDS DEBUG] search request', { query, limit: 50, offset });
    const res = await searchUsersApi(query, 50, offset);
    if (requestId !== searchRequestIdRef.current) return; // stale response
    if (!res.ok || !res.data) {
      console.log('[FRIENDS DEBUG] search response failed', { ok: res.ok, error: res.error });
      return;
    }
    const page = mapSearchResponse(res.data);
    console.log('[FRIENDS DEBUG] search response', {
      status: res.ok ? 200 : 0,
      userCount: page.users.length,
      total: page.total,
      nextOffset: page.nextOffset,
    });
    if (offset === 0) {
      setSearchResults(page.users);
    } else {
      setSearchResults((prev) => [...prev, ...page.users]);
    }
    setSearchTotal(page.total);
    setSearchNextOffset(page.nextOffset);
    console.log('[FRIENDS DEBUG] state updated', {
      query: query.trim(),
      count: page.users.length,
      total: page.total,
    });
  }, []);

  const clearSearch = useCallback(() => {
    searchRequestIdRef.current++;
    searchQueryRef.current = '';
    setSearchResults([]);
    setSearchTotal(0);
    setSearchNextOffset(0);
  }, []);

  const markNotificationRead = (id: string) => {
    setNotifications((prev) =>
      prev.map((n) => (n.id === id ? { ...n, read: true } : n))
    );
  };

  const clearAllNotifications = () => {
    setNotifications([]);
  };

  const updateSettings = (newSettings: Partial<UserSettings>) => {
    setUserSettings((prev) => ({ ...prev, ...newSettings }));
  };

  const updateProfile = (newProfile: Partial<UserProfile>) => {
    setUserProfile((prev) => ({ ...prev, ...newProfile }));
  };

  // ─── Real-Time SSE Listener for Active Room ────────────────────────────────
  const currentRoomIdRef = useRef<string | null>(null);
  currentRoomIdRef.current = currentRoom?.id ?? null;

  const currentUserIdRef = useRef<string | null>(null);
  currentUserIdRef.current = currentUser?.id ?? null;

  const exitRoomState = useCallback(() => {
    setCurrentRoom(null);
    setParticipants([]);
    setRoomSseState('CLOSED');
    setActiveTab('dashboard');
    refreshRooms();
    refreshRoomStats();
  }, [refreshRooms, refreshRoomStats]);

  useEffect(() => {
    if (!currentRoom?.id) return;

    const cleanupSse = connectRoomEvents({
      roomId: currentRoom.id,
      onEvent: (type, rawPayload) => {
        const uid = currentUserIdRef.current;
        const payload = rawPayload as any;

        switch (type) {
          case 'room:update': {
            const updated = payload.room as ServerRoom;
            if (updated) {
              const item = mapServerRoomToItem(updated, uid);
              setCurrentRoom(item);
              if (updated.currentMedia) {
                // Media (re)published — any pending conversion is complete;
                // the room now points at the browser-playable file (or, for
                // local movies, at metadata-only state shared via WebRTC).
                setMediaConversion(null);
              }
              if (updated.members) {
                setParticipants(updated.members.map((m) => mapServerMemberToParticipant(m, uid)));
              }
              setScreenShareOn(updated.hostUserId === uid ? updated.screenShareActive : false);
            }
            break;
          }

          case 'media:conversion': {
            const status = payload.status as string;
            const title = payload.title as string | undefined;
            if (status === 'processing') {
              setMediaConversion({ status, title });
            } else if (status === 'ready') {
              setMediaConversion(null);
            } else if (status === 'failed') {
              setMediaConversion({ status, title });
            }
            break;
          }

          case 'room:resync': {
            // Replay window was truncated: persisted events alone cannot
            // rebuild state, so refetch the authoritative snapshot.
            const roomId = currentRoomIdRef.current;
            if (!roomId) return;
            fetchRoomApi(roomId)
              .then((res) => {
                if (!res.ok || !res.data) return;
                const updated = res.data;
                const item = mapServerRoomToItem(updated, uid);
                setCurrentRoom(item);
                setParticipants(updated.members.map((m) => mapServerMemberToParticipant(m, uid)));
                setScreenShareOn(updated.hostUserId === uid ? updated.screenShareActive : false);
              })
              .catch(() => {});
            break;
          }

          case 'member:join': {
            const member = payload.member as ServerRoomMember | null;
            if (member) {
              setParticipants((prev) => {
                const exists = prev.some((p) => p.userId === member.userId || p.id === member.userId);
                if (exists) return prev;
                return [...prev, mapServerMemberToParticipant(member, uid)];
              });
            }
            break;
          }

          case 'member:leave': {
            const leftUserId = payload.userId as string;
            webrtcRef.current?.closePeerConnection(leftUserId);
            setParticipants((prev) => prev.filter((p) => p.userId !== leftUserId && p.id !== leftUserId));
            break;
          }

          case 'member:removed': {
            const removedUserId = payload.userId as string;
            webrtcRef.current?.closePeerConnection(removedUserId);
            if (removedUserId === uid) {
              // Current user was removed by host
              alert('You were removed from this room by the host.');
              exitRoomState();
            } else {
              setParticipants((prev) => prev.filter((p) => p.userId !== removedUserId && p.id !== removedUserId));
            }
            break;
          }

          case 'member:state': {
            const targetUserId = payload.userId as string;
            setParticipants((prev) =>
              prev.map((p) => {
                if (p.userId === targetUserId || p.id === targetUserId) {
                  return {
                    ...p,
                    micOn: typeof payload.micOn === 'boolean' ? payload.micOn : p.micOn,
                    cameraOn: typeof payload.cameraOn === 'boolean' ? payload.cameraOn : p.cameraOn,
                    screenShareOn: typeof payload.screenShareOn === 'boolean' ? payload.screenShareOn : p.screenShareOn,
                  };
                }
                return p;
              })
            );

            if (targetUserId === uid) {
              if (typeof payload.micOn === 'boolean') {
                if (!payload.micOn) {
                  webrtcRef.current?.stopMic();
                }
                setMicOn(payload.micOn);
              }
              if (typeof payload.cameraOn === 'boolean') {
                if (!payload.cameraOn) {
                  webrtcRef.current?.stopCamera();
                }
                setCameraOn(payload.cameraOn);
              }
              if (typeof payload.screenShareOn === 'boolean' && !payload.screenShareOn) {
                webrtcRef.current?.stopScreenShare();
                setScreenShareOn(false);
              }
            }
            break;
          }

          case 'signal': {
            const data = payload as { fromUserId: string; targetUserId?: string; signal: any };
            if (data && data.fromUserId) {
              if (!data.targetUserId || data.targetUserId === uid) {
                webrtcRef.current?.handleSignal(data.fromUserId, data.signal);
              }
            }
            break;
          }

          case 'host:changed': {
            const newHostId = payload.hostUserId as string;
            setCurrentRoom((prev) =>
              prev
                ? {
                    ...prev,
                    hostUserId: newHostId,
                    isHost: uid === newHostId,
                    hostName: payload.host?.name || prev.hostName,
                    hostAvatar: payload.host?.avatarUrl || prev.hostAvatar,
                  }
                : null
            );
            setParticipants((prev) =>
              prev.map((p) => ({
                ...p,
                isHost: p.userId === newHostId || p.id === newHostId,
                role: p.userId === newHostId || p.id === newHostId ? 'host' : 'viewer',
              }))
            );
            break;
          }

          case 'chat:message': {
            const msg = payload as ChatMessage;
            if (msg && msg.id) {
              setChatMessages((prev) => {
                if (prev.some((m) => m.id === msg.id)) return prev;
                return [...prev, msg];
              });
            }
            break;
          }

          case 'reaction': {
            const data = payload as { fromUserId?: string; senderName?: string; emoji?: string };
            if (data && data.emoji && data.fromUserId && data.fromUserId !== uid) {
              pushFloatingReaction(data.emoji, data.senderName || 'Someone');
            }
            break;
          }
        }
      },
      onStateChange: (state, info) => {
        setRoomSseState(state);
        if (state !== 'CLOSED' || !info?.reason) return;
        // 'closed' fires on every effect cleanup (room switch, leave, exit) and
        // 'leave' means the user intentionally tore the stream down: both are
        // benign. Any other terminal reason exits the room UI.
        if (info.reason === 'closed' || info.reason === 'leave') return;
        const reason = info.reason;
        if (reason === 'auth' || reason === 'UNAUTHENTICATED') {
          // Session expired; the auth layer handles the redirect.
          exitRoomState();
        } else if (reason === 'room-gone' || reason === 'ROOM_NOT_FOUND' || reason === 'ROOM_GONE') {
          alert('This room no longer exists.');
          exitRoomState();
        } else if (reason === 'ROOM_FULL') {
          alert('This room is at full capacity and can no longer be joined.');
          exitRoomState();
        } else if (reason === 'REMOVED_FROM_ROOM' || reason === 'ROOM_MEMBERSHIP_REQUIRED') {
          alert('You were removed from this room by the host.');
          exitRoomState();
        }
      },
      onRoomRecovered: (room) => {
        const uid = currentUserIdRef.current;
        setCurrentRoom(mapServerRoomToItem(room, uid));
        setParticipants(room.members.map((m) => mapServerMemberToParticipant(m, uid)));
        setScreenShareOn(room.hostUserId === uid ? room.screenShareActive : false);
      },
      onRecoveryFailure: (code) => {
        console.log(`[ROOM SSE] recovery abandoned room=${currentRoomIdRef.current} code=${code}`);
      },
    });

    return () => {
      cleanupSse();
    };
  }, [currentRoom?.id, refreshRooms, exitRoomState]);

  // Modals state
  const [createRoomModalOpen, setCreateRoomModalOpen] = useState(false);
  const [joinRoomModalOpen, setJoinRoomModalOpen] = useState(false);
  const [inviteModalOpen, setInviteModalOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);

  return (
    <AppContext.Provider
      value={{
        activeTab,
        setActiveTab,
        authState,
        isAuthenticated,
        currentUser,
        isAdmin,
        login,
        logout,
        refreshAuth,
        currentRoom,
        activeRoomTab,
        setActiveRoomTab,
        rooms,
        refreshRooms,
participants,
        roomSseState,
        mediaConversion,
        clearMediaConversion,
        updateParticipantRole,
        kickParticipant,
        chatMessages,
        roomNotes,
        setRoomNotes,
        roomFiles,
        addRoomFile,
        floatingReactions,
        removeParticipant,
        muteParticipant,
        setParticipantCamera,
        setRoomPlayback,
        scheduledParties,
        scheduleParty,
        watchHistory,
        roomStats,
        refreshRoomStats,
        localMediaStream,
        localScreenStream,
        localMovieStream,
        remoteMediaStreams: remoteCameraStreams,
        remoteCameraStreams,
        remoteScreenStreams,
        remoteMovieStreams,
        mediaErrorMessage,
        mediaDiagnosticError,
        clearMediaError,
        getManagerCameraDiagnostics,
        micOn,
        cameraOn,
        screenShareOn,
        toggleMic,
        toggleCamera,
        retryCamera,
        toggleScreenShare,
        joinRoom,
        createRoom,
        leaveRoom,
        sendRoomChatMessage,
        sendReaction,
        setRoomMedia,
        setRoomLibraryMedia,
        uploadRoomMedia,
        setLocalMovieActive,
        friends,
        activeDMId,
        setActiveDMId,
        dmConversations,
        sendDirectMessage,
        addFriend,
        acceptFriendRequest,
        rejectFriendRequest,
        friendRequests,
        refreshSocial,
        watchInvites,
        sendWatchInvite,
        acceptWatchInvite,
        declineWatchInvite,
        conversations,
        openConversation,
        startDm,
        pinnedMessageIds,
        sendReply,
        sendForward,
        pinMessage,
        unpinMessage,
        starMessage,
        unstarMessage,
        deleteMessageForMe,
        deleteMessageForEveryone,
        setConversationArchived,
        setConversationPinned,
        setConversationFavourite,
        markConversationRead,
        markConversationUnread,
        clearChat,
        deleteChat,
        setChatLockPin,
        unlockChat,
        verifyChatLock,
        isChatVerified,
        conversationLists,
        refreshConversationLists,
        createConversationList,
        deleteConversationList,
        addConversationToList,
        removeConversationFromList,
        searchResults,
        searchTotal,
        searchNextOffset,
        searchUsers,
        clearSearch,
        sendFriendRequestToUser,
        notifications,
        markNotificationRead,
        clearAllNotifications,
        userProfile,
        userSettings,
        updateSettings,
        updateProfile,
        createRoomModalOpen,
        setCreateRoomModalOpen,
        joinRoomModalOpen,
        setJoinRoomModalOpen,
        inviteModalOpen,
        setInviteModalOpen,
        scheduleModalOpen,
        setScheduleModalOpen,
        notificationsOpen,
        setNotificationsOpen
      }}
    >
      {children}
    </AppContext.Provider>
  );
};

export const useApp = () => {
  const context = useContext(AppContext);
  if (!context) {
    throw new Error('useApp must be used within an AppProvider');
  }
  return context;
};
