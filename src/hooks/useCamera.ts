import { useCallback, useEffect, useRef, useState } from 'react';

export type CameraStatus = 'starting' | 'ready' | 'denied' | 'unavailable' | 'lost';
export type Facing = 'user' | 'environment';

/** Owns the MediaStream. Attach `videoRef` to a <video>. Stops all tracks on unmount. */
export function useCamera(initial: Facing = 'user') {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [status, setStatus] = useState<CameraStatus>('starting');
  const [facing, setFacing] = useState<Facing>(initial);
  const [canSwitch, setCanSwitch] = useState(false);

  const stop = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);

  const start = useCallback(async (f: Facing) => {
    stop();
    setStatus('starting');
    if (!navigator.mediaDevices?.getUserMedia) return setStatus('unavailable');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: f }, width: { ideal: 1920 }, height: { ideal: 1080 } },
        audio: false
      });
      streamRef.current = stream;
      stream.getVideoTracks()[0]?.addEventListener('ended', () => setStatus('lost'));
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(() => undefined);
      }
      const cams = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'videoinput');
      setCanSwitch(cams.length > 1);
      setStatus('ready');
    } catch (e) {
      const name = (e as DOMException).name;
      setStatus(name === 'NotAllowedError' || name === 'SecurityError' ? 'denied' : 'unavailable');
    }
  }, [stop]);

  useEffect(() => {
    start(facing);
    return stop;
  }, [facing, start, stop]);

  const flip = () => setFacing((f) => (f === 'user' ? 'environment' : 'user'));
  return { videoRef, status, facing, canSwitch, flip, retry: () => start(facing) };
}
