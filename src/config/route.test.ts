import { describe, expect, it } from 'vitest';
import { homePath, isAdminPath } from './route';

describe('/admin route', () => {
  it('matches only the admin path', () => {
    for (const ok of ['/admin', '/admin/', '/booth/admin', '/booth/admin/']) expect(isAdminPath(ok)).toBe(true);
    for (const no of ['/', '', '/administrator', '/admins', '/x/adminx', '/admin/x', '/badmin']) expect(isAdminPath(no)).toBe(false);
  });
  it('homePath strips it', () => {
    expect(homePath('/admin')).toBe('/');
    expect(homePath('/admin/')).toBe('/');
    expect(homePath('/booth/admin')).toBe('/booth/');
  });
});
