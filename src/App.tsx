import { useEffect, type ReactElement } from 'react';
import { HashRouter, Navigate, Route, Routes } from 'react-router-dom';
import { db } from './data/db';
import { supabaseRemote } from './data/remote';
import { startSyncLoop } from './data/sync';
import { demoRole } from './dev/demoMode';
import { supabase } from './data/supabase';
import type { Member } from './domain/types';
import { useMe } from './hooks/useMe';
import { ArchivedDogsScreen } from './ui/screens/ArchivedDogsScreen';
import { DogScreen } from './ui/screens/DogScreen';
import { DogsScreen } from './ui/screens/DogsScreen';
import { LogScreen } from './ui/screens/LogScreen';
import { TeamScreen } from './ui/screens/TeamScreen';
import { TimerScreen } from './ui/screens/TimerScreen';
import { WelcomeScreen } from './ui/screens/WelcomeScreen';

export default function App() {
  const me = useMe();
  const unitId = me?.unit_id;

  useEffect(() => {
    if (!unitId || demoRole()) return; // demo mode (dev only) never syncs
    try {
      return startSyncLoop({ db, remote: supabaseRemote(supabase), unitId }, supabase);
    } catch (e) {
      // No server configured (a dev build without .env.local): the app still works from the local store.
      console.warn('Sync not started:', e instanceof Error ? e.message : e);
    }
  }, [unitId]);

  if (me === undefined) return null;
  if (me === null) return <WelcomeScreen />;

  return (
    <HashRouter>
      <AppRoutes me={me} />
    </HashRouter>
  );
}

/** Trainer-only screens: a handler who types the address is sent back to the dogs list. */
const trainerOnly = (me: Member, screen: ReactElement) => (me.role === 'trainer' ? screen : <Navigate to="/" replace />);

export function AppRoutes({ me }: { me: Member }) {
  return (
    <Routes>
      <Route path="/" element={<DogsScreen />} />
      <Route path="/dog/:dogId" element={<DogScreen />} />
      <Route path="/dog/:dogId/timer/:odourId" element={<TimerScreen />} />
      <Route path="/dog/:dogId/log" element={<LogScreen />} />
      <Route path="/archived" element={trainerOnly(me, <ArchivedDogsScreen />)} />
      <Route path="/team" element={trainerOnly(me, <TeamScreen />)} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
