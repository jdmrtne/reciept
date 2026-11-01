import { beforeEach, describe, expect, it } from 'vitest';
import { dismissLost, lostSnapshot, reportHealth, resetLostStore, shouldPromptReconnect } from './lostStore';
import { shouldShowLostPrompt } from '../screens/PrinterLostPrompt';

beforeEach(() => resetLostStore());

describe('lost-printer store (one popup per disconnect)', () => {
  it('nothing is prompted until the printer is reported offline', () => {
    expect(shouldPromptReconnect(lostSnapshot())).toBe(false);
    reportHealth({ level: 'ready' }); expect(shouldPromptReconnect(lostSnapshot())).toBe(false);
    reportHealth({ level: 'attention', detail: 'paper low' }); expect(shouldPromptReconnect(lostSnapshot())).toBe(false);
  });
  it('ready → offline prompts; coming back hides it', () => {
    reportHealth({ level: 'ready' }); reportHealth({ level: 'offline' });
    expect(shouldPromptReconnect(lostSnapshot())).toBe(true);
    reportHealth({ level: 'ready' });
    expect(shouldPromptReconnect(lostSnapshot())).toBe(false);
  });
  it('repeated offline reports are one episode; NOT NOW silences it until the NEXT disconnect', () => {
    reportHealth({ level: 'ready' }); reportHealth({ level: 'offline' }); reportHealth({ level: 'offline' });
    expect(lostSnapshot().episode).toBe(1);
    dismissLost(); expect(shouldPromptReconnect(lostSnapshot())).toBe(false);
    reportHealth({ level: 'offline' }); expect(shouldPromptReconnect(lostSnapshot())).toBe(false); // still the same episode
    reportHealth({ level: 'ready' }); reportHealth({ level: 'offline' }); // lost again
    expect(lostSnapshot().episode).toBe(2); expect(shouldPromptReconnect(lostSnapshot())).toBe(true);
  });
  it('a printer that was never reachable (first report is offline) is one episode too', () => {
    reportHealth({ level: 'offline' }); expect(lostSnapshot().episode).toBe(1); expect(shouldPromptReconnect(lostSnapshot())).toBe(true);
  });
  it('offline → attention → offline counts as a new episode (it answered in between)', () => {
    reportHealth({ level: 'offline' }); dismissLost(); reportHealth({ level: 'attention' }); reportHealth({ level: 'offline' });
    expect(shouldPromptReconnect(lostSnapshot())).toBe(true);
  });
});

describe('where the popup shows', () => {
  const lost = () => { resetLostStore(); reportHealth({ level: 'offline' }); return lostSnapshot(); };
  it('only for a USB printer, on screens where printing is still ahead', () => {
    for (const s of ['layout', 'edit', 'camera', 'preview']) expect(shouldShowLostPrompt('usb', s, lost())).toBe(true);
    for (const s of ['standby', 'print', 'share', 'success', 'admin']) expect(shouldShowLostPrompt('usb', s, lost())).toBe(false);
    for (const k of ['bluetooth', 'network', 'windows', 'system', 'mock']) expect(shouldShowLostPrompt(k, 'camera', lost())).toBe(false);
  });
});
