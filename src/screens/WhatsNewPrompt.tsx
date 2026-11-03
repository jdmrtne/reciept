import { useState } from 'react';
import { Modal } from '../components/Modal';
import { INSTALLED, showVersion, type BuildInfo } from '../pwa/version';
import { pendingAnnouncement, recordSeen } from '../pwa/whatsNew';
import type { KeyValue } from '../pwa/updateSource';

/** Shown on STANDBY after the booth restarted into a new version: what changed in every version it skipped, from the history compiled into this build. OK (or a tap outside) hides it for good. */
export function WhatsNewPrompt({ installed = INSTALLED, store }: { installed?: BuildInfo; store?: KeyValue | null }) {
  const [a, setA] = useState(() => pendingAnnouncement(installed, store));
  if (!a) return null;
  const close = () => { recordSeen(installed, store); setA(null); };
  return (
    <Modal label="BOOTH UPDATED" closeLabel="OK" className="compact" onClose={close}>
      <p><strong>{a.from && a.from !== a.to ? `${showVersion(a.from)} \u2192 ${showVersion(a.to)}` : showVersion(a.to)}</strong></p>
      {a.entries.length === 0 && <p>The booth is now running the new version.</p>}
      {a.entries.map((e) => (
        <div key={e.version} style={{ marginTop: '1.2em' }}>
          <p><strong>{showVersion(e.version)}</strong></p>
          <p style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{e.notes}</p>
        </div>
      ))}
    </Modal>
  );
}
