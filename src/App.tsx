import { useEffect, type ReactElement } from 'react';
import { HashRouter, Navigate, Route, Routes, useParams } from 'react-router-dom';
import { markLost } from './data/access';
import { db } from './data/db';
import { supabaseRemote } from './data/remote';
import { startSyncLoop } from './data/sync';
import { demoMode } from './dev/demoMode';
import { supabase } from './data/supabase';
import type { Me } from './domain/types';
import { useAccess } from './hooks/useMe';
import { ArchivedScreen } from './ui/screens/ArchivedScreen';
import { DogScreen } from './ui/screens/DogScreen';
import { LinkEntryScreen, LinkProblemScreen } from './ui/screens/LinkEntryScreen';
import { LogScreen } from './ui/screens/LogScreen';
import { MembersScreen } from './ui/screens/MembersScreen';
import { OdoursScreen } from './ui/screens/OdoursScreen';
import { TeamDogsScreen } from './ui/screens/TeamDogsScreen';
import { TeamsScreen } from './ui/screens/TeamsScreen';
import { TimerScreen } from './ui/screens/TimerScreen';
import { WelcomeScreen } from './ui/screens/WelcomeScreen';
import { WhoAreYouScreen } from './ui/screens/WhoAreYouScreen';

/** Syncs while the phone is in (entered, with a name). A server that stops letting it in stops the loop and says so. */
function SyncWhenIn() {
  const access = useAccess();
  const unitId = access?.kind === 'in' ? access.me.unit_id : undefined;

  useEffect(() => {
    if (!unitId || demoMode()) return; // demo mode (dev only) never syncs
    try {
      return startSyncLoop({ db, remote: supabaseRemote(supabase), unitId, onLostAccess: () => void markLost() }, supabase);
    } catch (e) {
      // No server configured (a dev build without .env.local): the app still works from the local store.
      console.warn('Sync not started:', e instanceof Error ? e.message : e);
    }
  }, [unitId]);

  return null;
}

/** Everything that is not a link: the screen for where this phone stands. Opening the app needs no network. */
function Gate() {
  const access = useAccess();
  if (access === undefined) return null;
  switch (access.kind) {
    case 'none': return <WelcomeScreen />;
    case 'lost': return <WelcomeScreen lost />;
    case 'pick': return <WhoAreYouScreen scope={access.scope} />;
    case 'in': return <AppRoutes me={access.me} />;
  }
}

export default function App() {
  return (
    <HashRouter>
      <SyncWhenIn />
      <Routes>
        <Route path="/trainer/:token" element={<LinkEntryScreen />} />
        <Route path="/handler/:token" element={<LinkEntryScreen />} />
        <Route path="/link-problem" element={<LinkProblemScreen />} />
        <Route path="*" element={<Gate />} />
      </Routes>
    </HashRouter>
  );
}

/** Trainer-only screens: a handler who types the address is sent back to the teams. */
const trainerOnly = (me: Me, screen: ReactElement) => (me.role === 'trainer' ? screen : <Navigate to="/" replace />);

/** The log is for trainers (spec §13.5): a handler who types the address lands on the dog screen. */
function LogRoute({ me }: { me: Me }) {
  const { dogId = '' } = useParams();
  return me.role === 'trainer' ? <LogScreen /> : <Navigate to={`/dog/${dogId}`} replace />;
}

export function AppRoutes({ me }: { me: Me }) {
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
