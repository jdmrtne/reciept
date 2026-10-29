import { useEffect, useState } from 'react';
import { loadStandbyPhoto } from '../lib/standbyPhoto';

/** Object URL of the owner's standby photo, or null (off, still loading, missing or unreadable). Loaded once per `version`; revoked on unmount. */
export function useStandbyPhoto(enabled: boolean, version: number): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    setUrl(null);
    if (!enabled) return;
    let alive = true, made: string | null = null;
    loadStandbyPhoto().then((blob) => {
      if (!alive || !blob) return;
      try { made = URL.createObjectURL(blob); setUrl(made); } catch { /* no photo: standby keeps its normal look */ }
    }).catch(() => { /* same */ });
    return () => { alive = false; if (made) URL.revokeObjectURL(made); };
  }, [enabled, version]);
  return url;
}
