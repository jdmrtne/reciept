import { Hint, Row } from './ui';
import type { AdminCtx, SectionDef } from './types';

function Pin({ busy, actions }: AdminCtx) {
  return (
    <>
      <Hint>The PIN keeps customers out of this panel. You will be asked to type the new PIN twice.</Hint>
      <Row label="OWNER PIN" hint="Required each time this panel is opened">
        <button type="button" className="btn ghost" disabled={busy} onClick={actions.changePin}>CHANGE PIN</button>
      </Row>
    </>
  );
}

export const securitySection: SectionDef = {
  id: 'security',
  label: 'Security',
  icon: 'lock',
  description: 'Who can open these settings.',
  cards: [
    { id: 'security-pin', title: 'Owner PIN', keywords: ['change pin', 'pin', 'password', 'lock', 'access', 'security', 'owner', 'admin', 'user', 'code'], render: (c) => <Pin {...c} /> }
  ]
};
