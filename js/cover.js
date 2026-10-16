// A generated cover (title and author on a coloured, bordered page) for items with no picture.
function genericCover(b) {
  const title = (b.title || 'Untitled').trim(), author = (b.author || '').trim();
  let h = 0;
  for (const c of title) h = (h * 31 + c.charCodeAt(0)) % 360;
  const esc = t => t.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const wrap = (text, width, max) => {
    const lines = [];
    let line = '';
    for (const w of text.split(/\s+/)) {
      if (line && (line + ' ' + w).length > width) { lines.push(line); line = w; } else line = line ? line + ' ' + w : w;
    }
    if (line) lines.push(line);
    if (lines.length > max) { lines.length = max; lines[max - 1] = lines[max - 1].replace(/.{0,2}$/, '') + '…'; }
    return lines;
  };
  const size = title.length > 40 ? 17 : title.length > 22 ? 21 : 26;
  const tl = wrap(title, Math.floor(160 / (size * 0.58)), 6);
  const al = wrap(author, 20, 2);
  const y0 = 120 - (tl.length - 1) * size * 0.6;
  const t = tl.map((l, i) => `<text x="100" y="${(y0 + i * size * 1.2).toFixed(1)}" text-anchor="middle" font-family="Georgia,'Times New Roman',serif" font-weight="bold" font-size="${size}" fill="#fff">${esc(l)}</text>`).join('');
  const a = al.map((l, i) => `<text x="100" y="${(262 + i * 16).toFixed(1)}" text-anchor="middle" font-family="Georgia,serif" font-size="13" fill="#ffffffcc">${esc(l)}</text>`).join('');
  const kind = b.kind === 'game' ? 'GAME' : 'BOOK';
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 300"><rect width="200" height="300" fill="hsl(${h} 38% 30%)"/><rect x="10" y="10" width="180" height="280" fill="none" stroke="#ffffff66" stroke-width="1.5"/><rect x="0" y="0" width="14" height="300" fill="hsl(${h} 38% 22%)"/><text x="107" y="42" text-anchor="middle" font-family="Arial,sans-serif" font-size="11" letter-spacing="4" fill="#ffffff99">${kind}</text>${t}<line x1="70" y1="238" x2="140" y2="238" stroke="#ffffff88"/>${a}</svg>`;
  return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
}
