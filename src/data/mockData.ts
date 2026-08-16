import {
  UserProfile,
  UserSettings,
  RoomItem,
  Friend,
  NotificationItem,
  RecentActivityItem,
  MediaTrack,
  ScheduledParty,
  WatchHistoryItem
} from '../types';

export const initialUserProfile: UserProfile = {
  name: '',
  username: '',
  avatar: 'U',
  joinedDate: '',
  roomsCount: 0,
  gamesPlayed: 0,
  friendsCount: 0,
  bio: '',
  email: ''
};

export const initialUserSettings: UserSettings = {
  theme: 'Dark',
  language: 'English',
  soundEffects: true,
  showActivityStatus: true,
  whoCanSendFriendRequests: 'Everyone',
  privateProfile: false,
  autoplayNext: true,
  defaultMicOn: false,
  defaultCamOn: false
};

// Sample stream tracks for instant synchronized watch parties
export const presetMediaTracks: MediaTrack[] = [
  {
    title: 'Nature Blossom (Flower 4K Short)',
    url: 'https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4',
    poster: 'https://images.unsplash.com/photo-1490750967868-88aa4486c946?w=800&q=80',
    duration: 5,
    type: 'video'
  },
  {
    title: 'Oceans (Wildlife Documentary)',
    url: 'https://vjs.zencdn.net/v/oceans.mp4',
    poster: 'https://images.unsplash.com/photo-1518709268805-4e9042af9f23?w=800&q=80',
    duration: 46,
    type: 'video'
  },
  {
    title: 'Big Buck Bunny (Classic Animation)',
    url: 'https://raw.githubusercontent.com/mediaelement/mediaelement-files/master/big_buck_bunny.mp4',
    poster: 'https://images.unsplash.com/photo-1578632767115-351597cf2477?w=800&q=80',
    duration: 60,
    type: 'video'
  }
];

// Clean real-data collections — populated dynamically by real user action
export const initialRooms: RoomItem[] = [];
export const initialScheduledParties: ScheduledParty[] = [];
export const initialWatchHistory: WatchHistoryItem[] = [];
export const initialFriends: Friend[] = [];
export const initialNotifications: NotificationItem[] = [];
export const initialRecentActivity: RecentActivityItem[] = [];
