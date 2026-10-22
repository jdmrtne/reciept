import { useEffect, useState } from 'react';
import { lookupDigitalPhoto, supabaseSource, type DigitalLookup, type DigitalPhoto, type DigitalSource } from '../share/digital';
import { supabaseConfigFromEnv } from '../share/supabaseConfig';

/** Where the files live for the backend this build was made for. null = no cloud storage configured, so there is nothing to show. */
export const defaultSource = (): DigitalSource | null => { const c = supabaseConfigFromEnv(); return c ? supabaseSource(c) : null; };

type Props = { lookup: DigitalLookup | 'loading'; source: DigitalSource | null; onRetry: () => void };

/** The customer-facing result (pure: state in, markup out). Mobile first: one column, big tap targets, colour photo then GIF. */
export function DigitalPhotoView({ lookup, source, onRetry }: Props) {
  const [broken, setBroken] = useState<{ img: boolean; gif: boolean }>({ img: false, gif: false });
  if (lookup === 'loading') return <main className="dp"><p className="dp-state" role="status">LOADING YOUR PHOTO...</p></main>;
  if (lookup.state === 'error') return (
    <main className="dp">
      <h1 className="dp-title">COULD NOT LOAD</h1>
      <p className="dp-note" role="alert">Something went wrong while loading your photo. Please check your connection and try again.</p>
      <button className="btn" onClick={onRetry}>TRY AGAIN</button>
    </main>
  );
  const p: DigitalPhoto | null = lookup.state === 'ok' ? lookup.photo : null;
  const img = p && p.coloredImage && !broken.img ? p.coloredImage : null;
  const gif = p && p.gif && !broken.gif ? p.gif : null;
  if (!p || !source || (!img && !gif)) return (
    <main className="dp">
      <h1 className="dp-title">PHOTO NOT FOUND</h1>
      <p className="dp-note">This digital photo is no longer available.</p>
    </main>
  );
  return (
    <main className="dp">
      <h1 className="dp-title">YOUR PHOTO</h1>
      {img ? (
        <section className="dp-card" aria-label="Color photo">
          <h2>COLOR PHOTO</h2>
          <img className="dp-img" src={img} alt="Your color photo" onError={() => setBroken((b) => ({ ...b, img: true }))} />
          <a className="btn dp-dl" href={source.downloadUrl(p.id, 'photo.jpg', 'photobooth.jpg')} download="photobooth.jpg">DOWNLOAD IMAGE</a>
        </section>
      ) : <p className="dp-note">The color photo is not available.</p>}
      {gif ? (
        <section className="dp-card" aria-label="Animated GIF">
          <h2>ANIMATED GIF</h2>
          <img className="dp-img" src={gif} alt="Your animated GIF" onError={() => setBroken((b) => ({ ...b, gif: true }))} />
          <a className="btn dp-dl" href={source.downloadUrl(p.id, 'photo.gif', 'photobooth.gif')} download="photobooth.gif">DOWNLOAD GIF</a>
        </section>
      ) : <p className="dp-note">The animated GIF is not available.</p>}
      <p className="dp-hint">Tip: if a download does not go to your gallery, press and hold the picture and choose Save.</p>
    </main>
  );
}

/** Route component for `/p/<id>`: looks the id up, then renders the view. Refresh-safe (everything comes from the URL). */
export function DigitalPhotoPage({ id, source = defaultSource(), fetchImpl }: { id: string; source?: DigitalSource | null; fetchImpl?: typeof fetch }) {
  const [lookup, setLookup] = useState<DigitalLookup | 'loading'>('loading');
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const ac = new AbortController();
    setLookup('loading');
    lookupDigitalPhoto(id, source, fetchImpl, ac.signal).then((r) => { if (!ac.signal.aborted) setLookup(r); });
    return () => ac.abort();
  }, [id, attempt]); // eslint-disable-line react-hooks/exhaustive-deps
  return <DigitalPhotoView lookup={lookup} source={source} onRetry={() => setAttempt((n) => n + 1)} />;
}
