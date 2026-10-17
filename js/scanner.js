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
    if ('BarcodeDetector' in window) {
      const det = new BarcodeDetector({ formats: mode === 'product' ? ['ean_13', 'upc_a', 'ean_8', 'qr_code'] : ['ean_13', 'qr_code'] });
      const tick = async () => {
        if (!running) return;
        try { const c = await det.detect(video); if (c.length) accept(c[0].rawValue, onCode, c[0].format); else if (Date.now() - startedAt > 10000) say('Still looking. Hold the phone 15 to 20 cm away, keep the barcode flat inside the box, and try the torch.'); } catch (e) {}
        if (running) setTimeout(tick, 150);
      };
      tick();
    } else if (window.ZXing) {
      const hints = new Map([[ZXing.DecodeHintType.POSSIBLE_FORMATS, mode === 'product' ? [ZXing.BarcodeFormat.EAN_13, ZXing.BarcodeFormat.UPC_A, ZXing.BarcodeFormat.EAN_8, ZXing.BarcodeFormat.QR_CODE] : [ZXing.BarcodeFormat.EAN_13, ZXing.BarcodeFormat.QR_CODE]], [ZXing.DecodeHintType.TRY_HARDER, true]]);
      reader = new ZXing.BrowserMultiFormatReader(hints, 150);
      reader.decodeFromStream(stream, video, res => {
        if (res && running) accept(res.getText(), onCode, ZXing.BarcodeFormat[res.getBarcodeFormat()]);
        else if (!res && running && Date.now() - startedAt > 10000) say('Still looking. Hold the phone 15 to 20 cm away, keep the barcode flat inside the box, and try the torch.');
      });
    }
  }
  function stop() {
    running = false;
    if (reader) { try { reader.reset(); } catch (e) {} reader = null; }
    if (stream) { stream.getTracks().forEach(t => t.stop()); stream = null; }
  }
  return { start, stop, isValidIsbn13 };
})();
