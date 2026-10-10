import { useEffect, type ReactElement } from 'react';
import { HashRouter, Navigate, Route, Routes, useParams } from 'react-router-dom';
import { db } from './data/db';
import { supabaseRemote } from './data/remote';
import { startSyncLoop } from './data/sync';
import { demoRole } from './dev/demoMode';
import { supabase } from './data/supabase';
import type { Member } from './domain/types';
import { useMe } from './hooks/useMe';
import { ArchivedScreen } from './ui/screens/ArchivedScreen';
import { DogScreen } from './ui/screens/DogScreen';
import { LogScreen } from './ui/screens/LogScreen';
import { MembersScreen } from './ui/screens/MembersScreen';
import { OdoursScreen } from './ui/screens/OdoursScreen';
import { TeamDogsScreen } from './ui/screens/TeamDogsScreen';
import { TeamsScreen } from './ui/screens/TeamsScreen';
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

/** Trainer-only screens: a handler who types the address is sent back to the teams. */
const trainerOnly = (me: Member, screen: ReactElement) => (me.role === 'trainer' ? screen : <Navigate to="/" replace />);

/** The log is for trainers (spec §13.5): a handler who types the address lands on the dog screen. */
function LogRoute({ me }: { me: Member }) {
  const { dogId = '' } = useParams();
  return me.role === 'trainer' ? <LogScreen /> : <Navigate to={`/dog/${dogId}`} replace />;
}

export function AppRoutes({ me }: { me: Member }) {
  return (
    <Routes>
      <Route path="/" element={<TeamsScreen />} />
      <Route path="/team/:teamId" element={<TeamDogsScreen />} />
      <Route path="/dog/:dogId" element={<DogScreen />} />
      <Route path="/dog/:dogId/timer/:odourId" element={<TimerScreen />} />
      <Route path="/dog/:dogId/log" element={<LogRoute me={me} />} />
      <Route path="/members" element={trainerOnly(me, <MembersScreen />)} />
      <Route path="/odours" element={trainerOnly(me, <OdoursScreen />)} />
      <Route path="/archived" element={trainerOnly(me, <ArchivedScreen />)} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
