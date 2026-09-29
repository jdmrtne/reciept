import { useCallback, useEffect } from 'react';
import { homePath, isAdminPath } from './config/route';
import { Standby } from './screens/Standby';
import { Layout } from './screens/Layout';
import { Edit } from './screens/Edit';
import { Camera } from './screens/Camera';
import { PreviewScreen } from './screens/PreviewScreen';
import { PrintScreen } from './screens/PrintScreen';
import { ShareScreen } from './screens/ShareScreen';
import { SuccessScreen } from './screens/SuccessScreen';
import { AdminScreen } from './screens/AdminScreen';
import { Placeholder } from './screens/Placeholder';
import { sessionStore, useSession } from './state/session';
import { useInactivity } from './hooks/useInactivity';
import { useWakeLock } from './hooks/useWakeLock';
import { loadSettings } from './config/settings';

export default function App() {
  const { screen, id } = useSession();
  const { inactivitySeconds } = loadSettings();
  const onIdle = useCallback(() => sessionStore.reset(), []);
  useInactivity(screen !== 'standby', inactivitySeconds, onIdle);
  useWakeLock();

  // Leaving ADMIN (EXIT / idle reset) also leaves the /admin URL, so a reload boots to standby.
  useEffect(() => {
    if (screen !== 'admin' && isAdminPath(location.pathname)) history.replaceState(null, '', homePath(location.pathname));
  }, [screen]);

  // key={id}: a new session remounts every screen, so no UI state can leak between customers.
  return (
    <div className="app" key={id}>
      <div className="screen" key={screen}>
        {screen === 'standby' ? <Standby /> : screen === 'layout' ? <Layout /> : screen === 'edit' ? <Edit /> : screen === 'camera' ? <Camera /> : screen === 'preview' ? <PreviewScreen /> : screen === 'print' ? <PrintScreen /> : screen === 'share' ? <ShareScreen /> : screen === 'success' ? <SuccessScreen /> : screen === 'admin' ? <AdminScreen /> : <Placeholder title={screen.toUpperCase()} />}
      </div>
    </div>
  );
}
