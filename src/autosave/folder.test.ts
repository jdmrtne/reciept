import { afterEach, describe, expect, it, vi } from 'vitest';
import { chooseFolder, makeStem, SUBFOLDERS, uniqueName, writeOutput } from './folder';

const D = new Date(2026, 9, 26, 15, 30, 12);

describe('uniqueName', () => {
  it('keeps the old shape without a stem (timestamp + 3-char suffix, .jpg / .gif)', () => {
    expect(uniqueName('image', D, () => 0.5)).toBe('MEMORYS-20261026-153012-i00.jpg');
    expect(uniqueName('gif', D, () => 0.5)).toBe('MEMORYS-20261026-153012-i00.gif');
    expect(uniqueName('image')).toMatch(/^MEMORYS-\d{8}-\d{6}-[0-9a-z]{3}\.jpg$/);
  });
  it('names a video .mp4', () => {
    expect(uniqueName('video', D, () => 0.5)).toBe('MEMORYS-20261026-153012-i00.mp4');
  });
  it('a shared stem gives matching names that differ only in the extension', () => {
    const stem = makeStem(D, () => 0.5);
    expect(stem).toBe('MEMORYS-20261026-153012-i00');
    expect(['image', 'gif', 'video'].map((k) => uniqueName(k as 'image', undefined, undefined, stem))).toEqual([`${stem}.jpg`, `${stem}.gif`, `${stem}.mp4`]);
  });
});

/** A tiny in-memory stand-in for the File System Access handles. */
const mkDir = (name = 'base'): any => {
  const dirs = new Map<string, any>(), files = new Map<string, Uint8Array>();
  return {
    name, dirs, files,
    queryPermission: async () => 'granted', requestPermission: async () => 'granted',
    async getDirectoryHandle(n: string, o?: { create?: boolean }) { if (!dirs.has(n)) { if (!o?.create) throw new Error('NotFoundError'); dirs.set(n, mkDir(n)); } return dirs.get(n); },
    async getFileHandle(n: string, o?: { create?: boolean }) {
      if (!files.has(n)) { if (!o?.create) throw new Error('NotFoundError'); files.set(n, new Uint8Array()); }
      return { createWritable: async () => ({ write: async (b: Uint8Array) => { files.set(n, b); }, close: async () => {}, abort: async () => {} }) };
    }
  };
};

describe('folder with a Videos subfolder', () => {
  afterEach(() => { vi.unstubAllGlobals(); });
  it('chooseFolder creates Images, GIFs and Videos; one stem gives three matching files; nothing is overwritten', async () => {
    const base = mkDir();
    vi.stubGlobal('window', { isSecureContext: true, showDirectoryPicker: async () => base });
    expect((await chooseFolder()).s).toBe('ready');
    const root = base.dirs.get('MEMORYS');
    expect([...root.dirs.keys()].sort()).toEqual([SUBFOLDERS.gif, SUBFOLDERS.image, SUBFOLDERS.video].sort());

    const stem = makeStem();
    const a = await writeOutput('image', new Uint8Array([1]), stem), b = await writeOutput('gif', new Uint8Array([2]), stem), c = await writeOutput('video', new Uint8Array([3]), stem);
    expect([a, b, c].map((r) => r.ok && r.name)).toEqual([`${stem}.jpg`, `${stem}.gif`, `${stem}.mp4`]);
    expect(root.dirs.get('Videos').files.get(`${stem}.mp4`)).toEqual(new Uint8Array([3]));

    // the same stem again (name taken): never overwrites, retries with a new suffix and reports the stem it really used
    const again = await writeOutput('video', new Uint8Array([9]), stem);
    expect(again.ok).toBe(true);
    if (again.ok) { expect(again.name).not.toBe(`${stem}.mp4`); expect(again.name).toBe(`${again.stem}.mp4`); }
    expect(root.dirs.get('Videos').files.get(`${stem}.mp4`)).toEqual(new Uint8Array([3]));
    expect(root.dirs.get('Videos').files.size).toBe(2);
  });
  it('a folder chosen before Videos existed still works: the subfolder is created on the first video', async () => {
    const base = mkDir(), root = await base.getDirectoryHandle('MEMORYS', { create: true });
    await root.getDirectoryHandle('Images', { create: true }); await root.getDirectoryHandle('GIFs', { create: true });
    vi.stubGlobal('window', { isSecureContext: true, showDirectoryPicker: async () => base });
    await chooseFolder(); // (re-choosing is not needed in the booth; this only seeds the handle)
    root.dirs.delete('Videos');
    const r = await writeOutput('video', new Uint8Array([7]));
    expect(r.ok).toBe(true);
    expect(root.dirs.has('Videos')).toBe(true);
  });
});
