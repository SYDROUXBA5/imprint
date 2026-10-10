import { useEffect } from 'react';
import { HashRouter, Navigate, Route, Routes } from 'react-router-dom';
import { db } from './data/db';
import { supabaseRemote } from './data/remote';
import { startSyncLoop } from './data/sync';
import { supabase } from './data/supabase';
import { useMe } from './hooks/useMe';
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
    if (!unitId) return;
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
      <Routes>
        <Route path="/" element={<DogsScreen />} />
        <Route path="/dog/:dogId" element={<DogScreen />} />
        <Route path="/dog/:dogId/timer/:odourId" element={<TimerScreen />} />
        <Route path="/dog/:dogId/log" element={<LogScreen />} />
        <Route path="/team" element={me.role === 'trainer' ? <TeamScreen /> : <Navigate to="/" />} />
        <Route path="*" element={<Navigate to="/" />} />
      </Routes>
    </HashRouter>
  );
}
