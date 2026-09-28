import { useEffect, useRef, useState } from 'react';
import { useCamera, type CameraStatus } from '../hooks/useCamera';
import { grabFrame } from '../lib/capture';
import { sessionStore, useSession } from '../state/session';
import { getLayout } from '../layouts/registry';
import { slotCount } from '../layouts/engine';
import { loadSettings } from '../config/settings';
import { Icon } from '../components/Icon';

type Phase = 'live' | 'countdown' | 'review';

const CAM_MESSAGES: Record<Exclude<CameraStatus, 'starting' | 'ready'>, string> = {
  denied: 'Camera is blocked. Allow camera access in your browser or tablet settings, then try again.',
  unavailable: 'No camera found. Check that a camera is connected, then try again.',
  lost: 'The camera was disconnected. Reconnect it, then try again.'
};

export function Camera() {
  const { countdownSeconds } = loadSettings();
  const { photos, cameraFacing, layoutId } = useSession();
  const shotsPerSession = slotCount(getLayout(layoutId));
  const cam = useCamera(cameraFacing);
  const [phase, setPhase] = useState<Phase>(photos.length >= shotsPerSession ? 'review' : 'live'); // coming back from Edit's RETAKE lands on review
  const [count, setCount] = useState(countdownSeconds);
  const [flash, setFlash] = useState(false);
  const [error, setError] = useState('');
  const target = useRef<number | null>(null); // index being retaken, null = sequential
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []); // re-arm on mount: StrictMode's dev remount would otherwise leave it false

  const begin = (retakeIdx: number | null = null) => {
    target.current = retakeIdx;
    setError('');
    setCount(countdownSeconds);
    setPhase('countdown');
  };

  useEffect(() => {
    if (phase !== 'countdown') return;
    if (count > 0) {
      const t = setTimeout(() => setCount((c) => c - 1), 1000);
      return () => clearTimeout(t);
    }
    (async () => {
      const video = cam.videoRef.current;
      try {
        if (!video) throw new Error('no-video');
        setFlash(true);
        const url = await grabFrame(video, cam.facing === 'user');
        const list = [...sessionStore.get().photos];
        const idx = target.current ?? list.length;
        if (list[idx]) URL.revokeObjectURL(list[idx]);
        list[idx] = url;
        sessionStore.update({ photos: list, editor: null });
        setTimeout(() => {
          if (!alive.current) return;
          setFlash(false);
          if (target.current === null && list.length < shotsPerSession) begin(null);
          else setPhase('review');
        }, 650);
      } catch {
        setFlash(false);
        setError('Could not take the photo. Please try again.');
        setPhase(sessionStore.get().photos.length ? 'review' : 'live');
      }
    })();
  }, [phase, count]); // eslint-disable-line react-hooks/exhaustive-deps

  const shown = photos.length;
  const problem = cam.status !== 'ready' && cam.status !== 'starting' ? CAM_MESSAGES[cam.status] : '';

  return (
    <main className="cam">
      <div className="cam-stage">
        <video ref={cam.videoRef} playsInline muted className={cam.facing === 'user' ? 'mirror' : ''} />
        {phase === 'countdown' && count > 0 && <div key={count} className="count">{count}</div>}
        {flash && <div className="flash" />}
        <div className="vf" aria-hidden="true"><i /><i /><i /><i /></div>
        {problem && (
          <div className="cam-msg">
            <p>{problem}</p>
            <button className="btn" onClick={cam.retry}><Icon name="retry" />TRY AGAIN</button>
          </div>
        )}
        {phase !== 'review' && <div className="shots">PHOTO {Math.min(shown + 1, shotsPerSession)} / {shotsPerSession}</div>}
      </div>

      {phase === 'live' && (
        <div className="cam-bar">
          <button className="btn ghost" onClick={() => sessionStore.update({ photos: [], editor: null, carry: null, screen: 'layout' })}><Icon name="back" />BACK</button>
          <button className="btn big" disabled={cam.status !== 'ready'} onClick={() => begin(null)}>
            <Icon name="camera" />{shown ? 'CONTINUE' : 'START'}
          </button>
          {cam.canSwitch ? <button className="btn ghost" onClick={cam.flip}><Icon name="flip" />FLIP</button> : <span />}
        </div>
      )}

      {phase === 'review' && (
        <div className="review">
          <div className="thumbs">
            {photos.slice(0, shotsPerSession).map((p, i) => (
              <button key={p} className="thumb" onClick={() => begin(i)} aria-label={`Retake photo ${i + 1}`}>
                <img src={p} alt="" /><span>RETAKE</span>
              </button>
            ))}
          </div>
          {error && <p className="err">{error}</p>}
          <div className="cam-bar">
            <button className="btn ghost" onClick={() => { photos.forEach((u) => URL.revokeObjectURL(u)); sessionStore.update({ photos: [], editor: null }); setPhase('live'); }}><Icon name="reset" />START OVER</button>
            <button className="btn big" onClick={() => sessionStore.go('edit')}><Icon name="check" />LOOKS GOOD</button>
          </div>
        </div>
      )}
      {phase === 'live' && error && <p className="err">{error}</p>}
    </main>
  );
}
