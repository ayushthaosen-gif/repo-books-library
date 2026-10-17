// Camera barcode scanning: native BarcodeDetector when present, ZXing otherwise.
// A code is accepted only if it is a valid ISBN (checksum) read twice in a row, which filters misreads.
const Scanner = (() => {
  let stream = null, running = false, reader = null, lastSeen = null;

  function isValidIsbn13(s) {
    if (!/^97[89]\d{10}$/.test(s)) return false;
    let sum = 0;
    for (let i = 0; i < 12; i++) sum += +s[i] * (i % 2 ? 3 : 1);
    return (10 - (sum % 10)) % 10 === +s[12];
  }
  // Any retail barcode (EAN-13, UPC-A, EAN-8) with a correct check digit.
  function isValidEan(s) {
    if (!/^(\d{8}|\d{12}|\d{13})$/.test(s)) return false;
    let sum = 0;
    for (let i = s.length - 2, w = 3; i >= 0; i--, w = 4 - w) sum += +s[i] * w;
    return (10 - (sum % 10)) % 10 === +s[s.length - 1];
  }
  let mode = 'isbn', note = () => {}, noteAt = 0, startedAt = 0;
  const valid = c => (mode === 'product' ? isValidEan(c) : isValidIsbn13(c));
  const say = text => { const t = Date.now(); if (t - noteAt > 2500) { noteAt = t; note(text); } };
  function accept(raw, onCode, format) {
    raw = raw || '';
    let code = raw.replace(/\D/g, '');
    if (/qr/i.test(format || '')) {
      // A QR code: use it only if it carries a valid book (or product) number.
      const hit = (raw.replace(/[-\s]/g, '').match(/\d{13}|\d{12}|\d{8}/g) || []).find(valid);
      if (!hit) { lastSeen = null; return say('Read a QR code, but it has no book number in it (' + raw.slice(0, 40) + ').'); }
      code = hit;
    } else if (!valid(code)) {
      lastSeen = null;
      return say(code.length >= 8 ? 'Read ' + code + ', but it is not a ' + (mode === 'product' ? 'product' : 'book (ISBN)') + ' barcode. ' + (mode === 'product' ? '' : 'Use the one that starts with 978 or 979.') : 'Barcode partly read, hold steady.');
    }
    if (code !== lastSeen) { lastSeen = code; return; }
    running = false;
    if (navigator.vibrate) navigator.vibrate(60);
    onCode(code);
  }

  async function start(video, onCode, onTorch, scanMode, onNote) {
    mode = scanMode === 'product' ? 'product' : 'isbn';
    note = onNote || (() => {}); noteAt = 0; startedAt = Date.now();
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) throw new Error('Camera not available (needs https).');
    lastSeen = null;
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
      audio: false,
    });
    const track = stream.getVideoTracks()[0];
    const caps = (track.getCapabilities && track.getCapabilities()) || {};
    try {
      if (caps.focusMode && caps.focusMode.includes('continuous')) await track.applyConstraints({ advanced: [{ focusMode: 'continuous' }] });
    } catch (e) {}
    if (caps.torch && onTorch) {
      let on = false;
      onTorch(async () => {
        on = !on;
        try { await track.applyConstraints({ advanced: [{ torch: on }] }); } catch (e) { on = !on; }
        return on;
      });
    }
    video.srcObject = stream;
    await video.play();
    running = true;
    // Decode only what is inside the on-screen box (a wide, short band), enlarged, so small bars are big enough
    // to read. Every third pass looks at the whole frame instead, in case the code is held outside the box.
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const FORMATS = mode === 'product' ? ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'qr_code'] : ['ean_13', 'ean_8', 'upc_a', 'code_128', 'qr_code'];
    let det = null, zx = null;
    if ('BarcodeDetector' in window) { try { det = new BarcodeDetector({ formats: FORMATS }); } catch (e) { det = null; } }
    if (!det && window.ZXing) {
      const F = ZXing.BarcodeFormat;
      zx = new ZXing.MultiFormatReader();
      zx.setHints(new Map([[ZXing.DecodeHintType.POSSIBLE_FORMATS, [F.EAN_13, F.EAN_8, F.UPC_A, F.UPC_E, F.CODE_128, F.QR_CODE]], [ZXing.DecodeHintType.TRY_HARDER, true]]));
    }
    // The box on screen, mapped to video pixels (the video is shown with object-fit: cover).
    function boxRegion(wide) {
      const vw = video.videoWidth, vh = video.videoHeight;
      if (!wide) return { x: 0, y: 0, w: vw, h: vh };
      const ca = (video.clientWidth || 4) / (video.clientHeight || 3), fa = vw / vh;
      const visW = fa > ca ? vh * ca : vw, visH = fa > ca ? vh : vw / ca;
      const w = Math.min(vw, visW * 0.84 * 1.1), h = Math.min(vh, visH * 0.4 * 1.2);
      return { x: (vw - w) / 2, y: (vh - h) / 2, w, h };
    }
    function grab(r) {
      const scale = Math.min(2, 1600 / r.w);
      canvas.width = Math.max(1, Math.round(r.w * scale)); canvas.height = Math.max(1, Math.round(r.h * scale));
      ctx.drawImage(video, r.x, r.y, r.w, r.h, 0, 0, canvas.width, canvas.height);
    }
    function decodeCanvas() {
      if (!zx) return null;
      try {
        const src = new ZXing.HTMLCanvasElementLuminanceSource(canvas);
        const res = zx.decode(new ZXing.BinaryBitmap(new ZXing.HybridBinarizer(src)));
        return res ? { text: res.getText(), format: ZXing.BarcodeFormat[res.getBarcodeFormat()] } : null;
      } catch (e) { return null; }
      finally { zx.reset && zx.reset(); }
    }
    let n = 0;
    const tick = async () => {
      if (!running) return;
      try {
        if (video.videoWidth) {
          grab(boxRegion(n++ % 3 !== 2));
          let hit = null;
          if (det) { const c = await det.detect(canvas); if (c.length) hit = { text: c[0].rawValue, format: c[0].format }; }
          else hit = decodeCanvas();
          if (hit && running) accept(hit.text, onCode, hit.format);
          else if (!hit && running && Date.now() - startedAt > 10000) say('Still looking. Hold the phone 15 to 20 cm away, keep the barcode flat inside the box, and try the torch.');
        }
      } catch (e) {}
      if (running) setTimeout(tick, 90);
    };
    tick();
  }
  function stop() {
    running = false;
    if (reader) { try { reader.reset(); } catch (e) {} reader = null; }
    if (stream) { stream.getTracks().forEach(t => t.stop()); stream = null; }
  }
  return { start, stop, isValidIsbn13 };
})();
