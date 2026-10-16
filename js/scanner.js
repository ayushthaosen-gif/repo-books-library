// Camera barcode scanning: native BarcodeDetector when present, ZXing otherwise.
const Scanner = (() => {
  let stream = null, running = false, reader = null;

  async function start(video, onCode) {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) throw new Error('Camera not available (needs https).');
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
    video.srcObject = stream;
    await video.play();
    running = true;
    if ('BarcodeDetector' in window) {
      const det = new BarcodeDetector({ formats: ['ean_13', 'ean_8', 'upc_a'] });
      const tick = async () => {
        if (!running) return;
        try { const c = await det.detect(video); if (c.length) return onCode(c[0].rawValue); } catch (e) {}
        setTimeout(tick, 200);
      };
      tick();
    } else if (window.ZXing) {
      const hints = new Map([[ZXing.DecodeHintType.POSSIBLE_FORMATS, [ZXing.BarcodeFormat.EAN_13, ZXing.BarcodeFormat.EAN_8, ZXing.BarcodeFormat.UPC_A]]]);
      reader = new ZXing.BrowserMultiFormatReader(hints);
      reader.decodeFromStream(stream, video, (res) => { if (res && running) onCode(res.getText()); });
    }
  }
  function stop() {
    running = false;
    if (reader) { try { reader.reset(); } catch (e) {} reader = null; }
    if (stream) { stream.getTracks().forEach(t => t.stop()); stream = null; }
  }
  return { start, stop };
})();
