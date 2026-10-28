// Inside heic.html: takes { id, blob } from the app (same origin only), sends
// back { id, blob } as JPEG or { id, error }.
window.addEventListener('message', async e => {
  if (e.origin !== location.origin || !e.data || !e.data.heicId) return;
  const { heicId, blob } = e.data;
  try {
    let out = await heic2any({ blob, toType: 'image/jpeg', quality: 0.9 });
    if (Array.isArray(out)) out = out[0]; // a burst / live photo: take the first frame
    e.source.postMessage({ heicId, blob: out }, location.origin);
  } catch (err) {
    e.source.postMessage({ heicId, error: String((err && err.message) || err) }, location.origin);
  }
});
parent.postMessage({ heicReady: true }, location.origin);
