'use strict';
(async () => {
  // Reuse PolyCraft's original bitmap lettering; keep real text for accessibility.
  try {
    const response = await fetch('/staticmax/bikraplain-64_SYEfICtxZYjbQrTYDKeeFA.fnt.json');
    if (!response.ok) return;
    const font = Object.values((await response.json()).bitmapfontlayouts)[0];
    const atlas = new Image(); atlas.src = '/staticmax/bikraplain-64_0_6parUtfadNFk4wq4JuXmdA.png';
    await atlas.decode();
    function decorate(element) {
      if (element.dataset.polycraftText || !element.textContent.trim()) return;
      const text = element.textContent.trim();
      const letters = [...text.toUpperCase()];
      if (letters.some(letter => !font.glyphs[letter.codePointAt(0)])) return;
      const size = /^H[123]$/.test(element.tagName) ? 32 : 23;
      const scale = size / font.lineheight;
      let width = 8;
      for (const letter of letters) width += (font.glyphs[letter.codePointAt(0)] || font.glyphs[63]).awidth;
      const canvas = document.createElement('canvas');
      canvas.className = 'polycraft-label'; canvas.setAttribute('aria-hidden', 'true');
      canvas.width = Math.ceil(width * scale * 2); canvas.height = size * 2;
      canvas.style.width = (canvas.width / 2) + 'px'; canvas.style.height = size + 'px';
      const context = canvas.getContext('2d'); context.scale(scale * 2, scale * 2);
      let x = 4;
      for (const letter of letters) {
        const glyph = font.glyphs[letter.codePointAt(0)] || font.glyphs[63];
        context.drawImage(atlas, Math.round(glyph.left * font.pagewidth), Math.round(glyph.top * font.pageheight), glyph.width, glyph.height, x + glyph.xoffset, glyph.yoffset, glyph.width, glyph.height);
        x += glyph.awidth;
      }
      context.setTransform(1, 0, 0, 1, 0, 0); context.globalCompositeOperation = 'source-in';
      context.fillStyle = getComputedStyle(element).color; context.fillRect(0, 0, canvas.width, canvas.height);
      const accessible = document.createElement('span'); accessible.className = 'sr-only'; accessible.textContent = text;
      element.dataset.polycraftText = 'true'; element.replaceChildren(canvas, accessible);
    }
    const update = () => document.querySelectorAll('button,h1,h2,h3,summary').forEach(decorate);
    new MutationObserver(update).observe(document.body, { childList: true, subtree: true });
    update();
  } catch { /* Keep readable system text if an original font asset cannot load. */ }
})();
