import { getShareStore } from '../../share/backend';
import { Hint, SwitchRow, TextField } from './ui';
import type { AdminCtx, SectionDef } from './types';

function Toggle({ s, set }: AdminCtx) {
  return <SwitchRow label="SHARE QR" hint="After printing, show a QR code that opens the colour photo and GIF on the customer's phone" checked={s.share.enabled} onChange={(v) => set({ share: { ...s.share, enabled: v } })} />;
}

function Links({ s, set, busy, actions }: AdminCtx) {
  if (!s.share.enabled) return <Hint>Turn on SHARE QR to set where the QR code points.</Hint>;
  const cloud = !!getShareStore();
  const bridgeOnPrinter = s.printer === 'network' || s.printer === 'windows';
  return (
    <>
      {cloud ? (
        <>
          <Hint>STORAGE: SUPABASE (photobooth-media)</Hint>
          <TextField label="SITE URL (WHAT THE QR OPENS; BLANK = THIS SITE)" inputMode="url" value={s.share.publicBaseUrl} placeholder="https://booth.example.com" disabled={busy}
            onChange={(v) => set({ share: { ...s.share, publicBaseUrl: v } })} />
        </>
      ) : (
        <>
          <TextField label="PUBLIC URL (WHAT PHONES OPEN)" inputMode="url" value={s.share.publicBaseUrl} placeholder="https://photos.example.com" disabled={busy}
            onChange={(v) => set({ share: { ...s.share, publicBaseUrl: v } })} />
          {bridgeOnPrinter
            ? <Hint>Photos are uploaded through the print bridge. Its address is set under Printer {'\u203A'} Connection details.</Hint>
            : <TextField label="BRIDGE URL (UPLOADS)" inputMode="url" value={s.network.bridgeUrl} placeholder="http://localhost:9101" disabled={busy}
                onChange={(v) => set({ network: { ...s.network, bridgeUrl: v } })} />}
        </>
      )}
      <div className="test-actions"><button type="button" className="btn ghost" disabled={busy} onClick={actions.testShare}>CHECK SHARE</button></div>
    </>
  );
}

export const sharingSection: SectionDef = {
  id: 'sharing',
  label: 'Photo sharing',
  icon: 'qr',
  description: 'Let customers scan a QR code to get their photo on their phone.',
  cards: [
    { id: 'share-toggle', title: 'Share QR', keywords: ['share qr', 'qr', 'qr code', 'phone', 'digital', 'gif', 'photo', 'sharing', 'download'], render: (c) => <Toggle {...c} /> },
    { id: 'share-links', title: 'Photo links', description: 'Where photos are stored and what the QR code opens.', keywords: ['site url', 'public url', 'bridge url', 'uploads', 'supabase', 'check share', 'link', 'address', 'domain', 'tunnel'], render: (c) => <Links {...c} /> }
  ]
};
