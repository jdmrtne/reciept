import { useState } from 'react';
import { sessionStore } from '../state/session';
import { PinGate } from './PinGate';
import { AdminPanel } from './admin/AdminPanel';
import type { SectionId } from './admin/types';

/**
 * Owner-only door: PIN keypad first (first visit = create a PIN), then the settings panel (screens/admin/).
 * Leaving (EXIT/idle reset) remounts the screen, so it is locked again next time.
 */
export function AdminScreen() {
  const [stage, setStage] = useState<'lock' | 'panel' | 'change'>('lock');
  const [back, setBack] = useState<SectionId>('printer'); // the panel remounts after the PIN keypad: reopen where the owner was
  if (stage === 'lock') return <PinGate onDone={() => setStage('panel')} onCancel={() => sessionStore.reset()} />;
  if (stage === 'change') return <PinGate forceSet onDone={() => setStage('panel')} onCancel={() => setStage('panel')} />;
  return <AdminPanel initialSection={back} onChangePin={() => { setBack('security'); setStage('change'); }} />;
}
