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
  WatchHistoryItem
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
  createRoomApi,
  joinRoomApi,
  leaveRoomApi,
  setRoomMediaApi,
  setPlaybackApi,
  setScreenShareApi,
  setSelfDeviceStateApi,
  sendRoomChatApi,
  removeMemberApi,
  muteMemberApi,
  setMemberCameraApi,
  sendSignalApi,
  connectRoomEvents,
  uploadRoomMediaApi,
  ServerRoom,
  ServerRoomMember
} from '../api/rooms';
import { WebRTCManager } from '../webrtc/WebRTCManager';
import { MediaDiagnosticError, logRoomEntryDeviceDiagnostics } from '../webrtc/mediaDeviceDiagnostics';

interface AppContextType {
  activeTab: NavigationTab;
  setActiveTab: (tab: NavigationTab) => void;
  
  // Auth state
  authState: 'loading' | 'authenticated' | 'unauthenticated';
  isAuthenticated: boolean;
  currentUser: AuthUser | null;
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
  
  // WebRTC Media Streams & Error
  localMediaStream: MediaStream | null;
  localScreenStream: MediaStream | null;
  remoteMediaStreams: Map<string, MediaStream>;
  remoteCameraStreams: Map<string, MediaStream>;
  remoteScreenStreams: Map<string, MediaStream>;
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
  uploadRoomMedia: (file: File) => Promise<{ ok: boolean; error?: string }>;
  
  // Friends & DMs
  friends: Friend[];
  activeDMId: string | null;
  setActiveDMId: (id: string | null) => void;
  dmConversations: Record<string, DirectMessage[]>;
  sendDirectMessage: (friendId: string, text: string) => void;
  addFriend: (username: string) => void;
  acceptFriendRequest: (friendId: string) => void;
  
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
    currentMedia: r.currentMedia
      ? {
          title: r.currentMedia.title,
          url: r.currentMedia.url,
          poster: r.currentMedia.poster,
          duration: r.currentMedia.duration,
          type: (r.currentMedia.type as 'video' | 'stream') || 'video',
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

export const AppProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [activeTab, setActiveTab] = useState<NavigationTab>('dashboard');
  
  // Session & Authentication State
  const [authState, setAuthState] = useState<'loading' | 'authenticated' | 'unauthenticated'>('loading');
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(false);
  const [currentUser, setCurrentUser] = useState<AuthUser | null>(null);

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
  const [remoteCameraStreams, setRemoteCameraStreams] = useState<Map<string, MediaStream>>(new Map());
  const [remoteScreenStreams, setRemoteScreenStreams] = useState<Map<string, MediaStream>>(new Map());
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

  // Room Specific State
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [roomNotes, setRoomNotes] = useState<string>('');
  const [roomFiles, setRoomFiles] = useState<RoomFile[]>([]);
  const [floatingReactions, setFloatingReactions] = useState<FloatingReaction[]>([]);

  const [scheduledParties, setScheduledParties] = useState<ScheduledParty[]>(initialScheduledParties);
  const [watchHistory, setWatchHistory] = useState<WatchHistoryItem[]>(initialWatchHistory);
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

  // WebRTC Instance Lifecycle for Active Room
  useEffect(() => {
    if (!currentRoom?.id) {
      webrtcRef.current?.destroy();
      webrtcRef.current = null;
      setLocalMediaStream(null);
      setLocalScreenStream(null);
      setRemoteCameraStreams(new Map());
      setRemoteScreenStreams(new Map());
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
      onRemoteStreamChange: (userId, cameraStream, screenStream) => {
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
      setRemoteCameraStreams(new Map());
      setRemoteScreenStreams(new Map());
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
    }
  }, [isAuthenticated, refreshRooms]);

  const login = (user: AuthUser) => {
    setCurrentUser(user);
    setIsAuthenticated(true);
    setAuthState('authenticated');
    applyUserToProfile(user);
    setActiveTab('dashboard');
    refreshRooms();
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
    setActiveTab('dashboard');
    refreshRooms();
  };

  const sendRoomChatMessage = async (text: string) => {
    if (!text.trim() || !currentRoom) return;
    await sendRoomChatApi(currentRoom.id, text.trim());
  };

  const sendReaction = (emoji: string, senderName?: string) => {
    if (!currentRoom) return;
    const name = senderName || userProfile.name || 'You';

    // Broadcast through room chat
    sendRoomChatApi(currentRoom.id, `${emoji} reacted with ${emoji}`, emoji).catch(() => {});

    const newReaction: FloatingReaction = {
      id: `float-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      emoji,
      senderName: name,
      x: Math.floor(12 + Math.random() * 76),
      rotation: Math.floor(-20 + Math.random() * 40),
      scale: parseFloat((0.95 + Math.random() * 0.45).toFixed(2)),
      timestamp: Date.now(),
    };

    setFloatingReactions((prev) => [...prev, newReaction]);

    setTimeout(() => {
      setFloatingReactions((prev) => prev.filter((r) => r.id !== newReaction.id));
    }, 3000);
  };

  const setRoomMedia = async (media: MediaTrack | null) => {
    if (!currentRoom || !currentRoom.isHost) return;
    await setRoomMediaApi(currentRoom.id, media);
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
    return { ok: true };
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

  const sendDirectMessage = (friendId: string, text: string) => {
    if (!text.trim()) return;
    const newMsg: DirectMessage = {
      id: `dm-${Date.now()}`,
      senderId: 'user',
      text: text.trim(),
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    };
    setDmConversations((prev) => ({
      ...prev,
      [friendId]: [...(prev[friendId] || []), newMsg]
    }));
  };

  const addFriend = (username: string) => {
    if (!username.trim()) return;
    const newFriend: Friend = {
      id: `friend-${Date.now()}`,
      name: username,
      username: username.toLowerCase().replace(/\s+/g, ''),
      avatar: username.charAt(0).toUpperCase(),
      status: 'online'
    };
    setFriends((prev) => [...prev, newFriend]);
  };

  const acceptFriendRequest = (friendId: string) => {
    setFriends((prev) =>
      prev.map((f) => (f.id === friendId ? { ...f, requestPending: false, status: 'online' } : f))
    );
  };

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

  useEffect(() => {
    if (!currentRoom?.id) return;

    const cleanupSse = connectRoomEvents(
      currentRoom.id,
      (type, payload) => {
        const uid = currentUserIdRef.current;

        switch (type) {
          case 'room:update': {
            const updated = payload.room as ServerRoom;
            if (updated) {
              const item = mapServerRoomToItem(updated, uid);
              setCurrentRoom(item);
              if (updated.members) {
                setParticipants(updated.members.map((m) => mapServerMemberToParticipant(m, uid)));
              }
              setScreenShareOn(updated.hostUserId === uid ? updated.screenShareActive : false);
            }
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
              setCurrentRoom(null);
              setParticipants([]);
              setActiveTab('dashboard');
              refreshRooms();
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
        }
      },
      () => {
        // SSE error or reconnecting
      }
    );

    return () => {
      cleanupSse();
    };
  }, [currentRoom?.id, refreshRooms]);

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
        login,
        logout,
        refreshAuth,
        currentRoom,
        activeRoomTab,
        setActiveRoomTab,
        rooms,
        refreshRooms,
        participants,
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
        localMediaStream,
        localScreenStream,
        remoteMediaStreams: remoteCameraStreams,
        remoteCameraStreams,
        remoteScreenStreams,
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
        uploadRoomMedia,
        friends,
        activeDMId,
        setActiveDMId,
        dmConversations,
        sendDirectMessage,
        addFriend,
        acceptFriendRequest,
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
