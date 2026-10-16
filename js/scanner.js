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
  function accept(raw, onCode) {
    const code = (raw || '').replace(/\D/g, '');
    if (!isValidIsbn13(code)) { lastSeen = null; return; }
    if (code !== lastSeen) { lastSeen = code; return; }
    running = false;
    if (navigator.vibrate) navigator.vibrate(60);
    onCode(code);
  }

  async function start(video, onCode, onTorch) {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) throw new Error('Camera not available (needs https).');
    lastSeen = null;
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
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
    if ('BarcodeDetector' in window) {
      const det = new BarcodeDetector({ formats: ['ean_13'] });
      const tick = async () => {
        if (!running) return;
        try { const c = await det.detect(video); if (c.length) accept(c[0].rawValue, onCode); } catch (e) {}
        if (running) setTimeout(tick, 150);
      };
      tick();
    } else if (window.ZXing) {
      const hints = new Map([[ZXing.DecodeHintType.POSSIBLE_FORMATS, [ZXing.BarcodeFormat.EAN_13]], [ZXing.DecodeHintType.TRY_HARDER, true]]);
      reader = new ZXing.BrowserMultiFormatReader(hints, 150);
      reader.decodeFromStream(stream, video, res => { if (res && running) accept(res.getText(), onCode); });
    }
  }
  function stop() {
    running = false;
    if (reader) { try { reader.reset(); } catch (e) {} reader = null; }
    if (stream) { stream.getTracks().forEach(t => t.stop()); stream = null; }
  }
  return { start, stop, isValidIsbn13 };
})();
