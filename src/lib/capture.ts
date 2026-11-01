/** Grabs the current video frame as a JPEG blob URL. Mirrors when using the front camera (matches preview). */
export function grabFrame(video: HTMLVideoElement, mirror: boolean): Promise<string> {
  return new Promise((resolve, reject) => {
    const w = video.videoWidth, h = video.videoHeight;
    if (!w || !h) return reject(new Error('no-frame'));
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const ctx = c.getContext('2d');
    if (!ctx) return reject(new Error('no-canvas'));
    if (mirror) { ctx.translate(w, 0); ctx.scale(-1, 1); }
    ctx.drawImage(video, 0, 0, w, h);
    c.toBlob((b) => (b ? resolve(URL.createObjectURL(b)) : reject(new Error('encode'))), 'image/jpeg', 0.92);
  });
}
