import React, { useState } from 'react';
import { AppProvider, useApp } from './context/AppContext';
import { Sidebar } from './components/Sidebar';
import { DashboardView } from './components/views/DashboardView';
import { ExploreView } from './components/views/ExploreView';
import { GamesView } from './components/views/GamesView';
import { FriendsView } from './components/views/FriendsView';
import { MessagesView } from './components/views/MessagesView';
import { SettingsView } from './components/views/SettingsView';
import { ProfileView } from './components/views/ProfileView';
import { AuthView } from './components/views/AuthView';
import { RoomView } from './components/room/RoomView';

import { CreateRoomModal } from './components/modals/CreateRoomModal';
import { JoinRoomModal } from './components/modals/JoinRoomModal';
import { InviteModal } from './components/modals/InviteModal';
import { NotificationsModal } from './components/modals/NotificationsModal';
import { ScheduleRoomModal } from './components/modals/ScheduleRoomModal';

import { AmbientBackground } from './components/common/AmbientBackground';
import { ToastContainer } from './components/common/ToastContainer';
import { PortalTransition } from './components/room/PortalTransition';
import { WatchPartyRecapModal } from './components/room/WatchPartyRecapModal';

const MainContent: React.FC = () => {
  const { activeTab } = useApp();

  return (
    <main className="flex-1 overflow-y-auto min-w-0 w-full bg-[var(--bg-canvas)] text-[var(--text-primary)] relative z-10 transition-colors duration-200">
      <div key={activeTab} className="animate-fade-in-up h-full w-full px-4 sm:px-8 md:px-16 py-8 md:py-10 md:pb-20">
        {activeTab === 'dashboard' && <DashboardView />}
        {activeTab === 'explore' && <ExploreView />}
        {activeTab === 'games' && <GamesView />}
        {activeTab === 'friends' && <FriendsView />}
        {activeTab === 'messages' && <MessagesView />}
        {activeTab === 'settings' && <SettingsView />}
        {activeTab === 'profile' && <ProfileView />}
        {activeTab === 'auth' && <AuthView />}
        {activeTab === 'room' && <RoomView />}
      </div>
    </main>
  );
};

const AppShell: React.FC = () => {
  const { notifications, markNotificationRead, joinRoom } = useApp();
  const [portalActive, setPortalActive] = useState(false);
  const [recapModalOpen, setRecapModalOpen] = useState(false);

  const recapData = {
    roomName: 'Watch Party Lounge',
    durationWatched: '0m',
    mediaWatched: 'Live Stream',
    poster: '',
    attendeesCount: 1,
    topReactions: ['🔥', '👏', '❤️'],
    totalReactions: 0
  };

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-[var(--bg-canvas)] text-[var(--text-primary)] font-sans antialiased select-none relative transition-colors duration-200">
      <AmbientBackground />
      <Sidebar />
      <MainContent />

      {/* Global Toast Notifications */}
      <ToastContainer
        notifications={notifications}
        onDismiss={(id) => markNotificationRead(id)}
        onAction={(item) => {
          if (item.roomCode) {
            setPortalActive(true);
            setTimeout(() => {
              joinRoom(item.roomCode!);
            }, 300);
          }
        }}
      />

      {/* Room Portal Transition */}
      <PortalTransition
        active={portalActive}
        posterUrl=""
        roomName="Watch Party Portal"
        onComplete={() => setPortalActive(false)}
      />

      {/* Watch Party Recap Modal */}
      <WatchPartyRecapModal
        isOpen={recapModalOpen}
        onClose={() => setRecapModalOpen(false)}
        recapData={recapData}
      />

      {/* Global Modals */}
      <CreateRoomModal />
      <JoinRoomModal />
      <InviteModal />
      <NotificationsModal />
      <ScheduleRoomModal />
    </div>
  );
};

const AuthGate: React.FC = () => {
  const { authState } = useApp();

  if (authState === 'loading') {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-[var(--bg-canvas)] text-[var(--text-primary)] select-none">
        <div className="flex flex-col items-center gap-3 animate-fade-in">
          <div className="w-11 h-11 rounded-xl bg-[var(--emphasis)] text-[var(--bg)] flex items-center justify-center font-black text-2xl shadow-[0_0_15px_rgba(255,255,255,0.2)]">
            P
          </div>
          <div className="flex items-center gap-2 text-xs font-mono text-[var(--text-secondary)]">
            <span className="w-2 h-2 rounded-full bg-[var(--text-primary)] animate-pulse" />
            <span>Connecting to PraConnect...</span>
          </div>
        </div>
      </div>
    );
  }

  if (authState === 'unauthenticated') {
    return <AuthView />;
  }

  return <AppShell />;
};

export default function App() {
  return (
    <AppProvider>
      <AuthGate />
    </AppProvider>
  );
}
