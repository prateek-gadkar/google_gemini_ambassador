/**
 * Certificate rendering.
 *
 * Kept free of DOM access so it can be unit-tested in Node with a stub
 * 2D context, and so the same maths runs in the browser.
 *
 * Placement is stored as fractions of the template size, which means the
 * numbers survive the template being replaced with a higher-resolution copy.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.CertRender = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  function clamp(value, lo, hi) {
    return Math.min(hi, Math.max(lo, value));
  }

  /**
   * Works out where the name goes for a given template size.
   * Returns integer-ish pixel values ready for ctx.fillText.
   */
  function computeNamePlacement(width, height, cfg) {
    var c = cfg || {};
    var align = c.align === 'left' || c.align === 'right' ? c.align : 'center';
    var x = clamp(Number(c.x), 0, 1) * width;
    var y = clamp(Number(c.y), 0, 1) * height;
    var fontSize = Math.max(8, Math.round(clamp(Number(c.size), 0.005, 1) * height));
    var weight = String(c.weight || '600');
    var family = c.font === 'sans-serif' ? 'sans-serif' : 'serif';
    return {
      x: x,
      y: y,
      fontSize: fontSize,
      font: weight + ' ' + fontSize + 'px ' + family,
      align: align,
      color: /^#[0-9a-fA-F]{6}$/.test(String(c.color)) ? c.color : '#111111',
      maxWidth: Math.max(1, clamp(Number(c.maxWidth) || 0.8, 0.05, 1) * width),
    };
  }

  /**
   * Draws the template and the student's name on it.
   * `image` is any drawable with width/height (Image, canvas, or a stub).
   */
  function drawCertificate(ctx, image, name, cfg) {
    var width = image.width;
    var height = image.height;
    ctx.clearRect(0, 0, width, height);
    ctx.drawImage(image, 0, 0, width, height);

    var place = computeNamePlacement(width, height, cfg);
    ctx.fillStyle = place.color;
    ctx.textAlign = place.align;
    ctx.textBaseline = 'middle';

    var fontSize = place.fontSize;
    var font = place.font;
    ctx.font = font;

    // Shrink long names so they stay inside the calibrated text box instead of
    // spilling across the artwork.
    if (typeof ctx.measureText === 'function') {
      var guard = 0;
      while (guard < 40 && fontSize > 8) {
        var measured = ctx.measureText(name).width;
        if (!isFinite(measured) || measured <= place.maxWidth) break;
        fontSize = Math.max(8, Math.floor(fontSize * 0.94));
        font = place.font.replace(/\d+px/, fontSize + 'px');
        ctx.font = font;
        guard++;
      }
    }

    ctx.fillText(name, place.x, place.y);
    return { width: width, height: height, fontSize: fontSize, x: place.x, y: place.y };
  }

  return {
    computeNamePlacement: computeNamePlacement,
    drawCertificate: drawCertificate,
  };
});
