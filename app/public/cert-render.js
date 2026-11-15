/**
 * Certificate rendering.
 *
 * The template artwork already carries every official word: the title, the
 * paragraph, the Google mark, the GSA mark and the field labels. This file
 * writes only the three blanks the template leaves open —
 *
 *   name       the student's name, centred over the long rule
 *   date       the date, centred over the rule above the word "Date"
 *   signature  the ambassador's signature image, above the word "Signature"
 *
 * Positions are fractions of the artwork, so the same numbers hold if the
 * template is replaced with a higher-resolution copy. Values were measured
 * off the official JPG (6142 x 4429) by locating the three grey rules:
 *
 *   name rule       y=2354   x=1348..4793   centre 3070.5
 *   date rule       y=3774   x= 685..1574   centre 1129.5
 *   signature rule  y=3774   x=4567..5456   centre 5011.5
 *
 * Kept free of DOM access so it can be unit-tested in Node against a stub
 * context, and so the identical maths runs in the browser.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.CertRender = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var FONT_STACK = {
    google: '"Google Sans", "Product Sans", Roboto, "Helvetica Neue", Arial, sans-serif',
    sans: 'Roboto, "Helvetica Neue", Arial, sans-serif',
    serif: 'Georgia, "Times New Roman", serif',
  };

  function clamp(value, lo, hi, fallback) {
    var n = Number(value);
    if (!isFinite(n)) return fallback;
    return Math.min(hi, Math.max(lo, n));
  }

  /** Where a text field lands, in template pixels. `y` is the text baseline. */
  function computeTextPlacement(width, height, cfg) {
    var c = cfg || {};
    var align = c.align === 'left' || c.align === 'right' ? c.align : 'center';
    var fontSize = Math.max(8, Math.round(clamp(c.size, 0.002, 1, 0.03) * height));
    var family = FONT_STACK[c.font] || FONT_STACK.google;
    return {
      x: clamp(c.x, 0, 1, 0.5) * width,
      y: clamp(c.y, 0, 1, 0.5) * height,
      fontSize: fontSize,
      font: String(c.weight || '400') + ' ' + fontSize + 'px ' + family,
      align: align,
      color: /^#[0-9a-fA-F]{6}$/.test(String(c.color)) ? c.color : '#111111',
      maxWidth: Math.max(1, clamp(c.maxWidth, 0.05, 1, 0.8) * width),
      letterSpacing: clamp(c.letterSpacing, -0.1, 0.5, 0),
    };
  }

  /** Where the signature image lands, in template pixels. */
  function computeImagePlacement(width, height, cfg) {
    var c = cfg || {};
    return {
      x: clamp(c.x, 0, 1, 0.5) * width,
      bottom: clamp(c.y, 0, 1, 0.85) * height,
      width: Math.max(1, clamp(c.width, 0.01, 1, 0.15) * width),
      opacity: clamp(c.opacity, 0.1, 1, 1),
    };
  }

  /**
   * Draws text, shrinking it if the string is wider than its box, so a long
   * name stays inside the space instead of running across the artwork.
   */
  function drawText(ctx, width, height, text, cfg) {
    if (!text) return null;
    var place = computeTextPlacement(width, height, cfg);

    ctx.fillStyle = place.color;
    ctx.textAlign = place.align;
    ctx.textBaseline = 'alphabetic';
    ctx.font = place.font;

    var fontSize = place.fontSize;
    if (typeof ctx.measureText === 'function') {
      var guard = 0;
      while (guard < 60) {
        var measured = ctx.measureText(text).width;
        if (!isFinite(measured) || measured <= place.maxWidth || fontSize <= 8) break;
        fontSize = Math.max(8, Math.floor(fontSize * 0.96));
        ctx.font = place.font.replace(/\d+px/, fontSize + 'px');
        guard++;
      }
    }

    ctx.fillText(text, place.x, place.y);
    return {
      x: place.x, y: place.y, fontSize: fontSize, font: ctx.font,
      align: place.align, color: place.color,
    };
  }

  /** Draws the signature image, centred on x, sitting on its baseline. */
  function drawSignature(ctx, width, height, image, cfg) {
    if (!image) return null;
    var place = computeImagePlacement(width, height, cfg);
    var natural = image.width / image.height;
    var drawWidth = place.width;
    var drawHeight = drawWidth / (natural || 1);

    ctx.save();
    if (typeof ctx.globalAlpha === 'number') ctx.globalAlpha = place.opacity;
    ctx.drawImage(
      image,
      place.x - drawWidth / 2,
      place.bottom - drawHeight,
      drawWidth,
      drawHeight
    );
    ctx.restore();

    return { x: place.x, bottom: place.bottom, width: drawWidth, height: drawHeight };
  }

  /**
   * Draws the whole certificate.
   *
   *   ctx       a 2D canvas context sized to the output image
   *   template  the artwork (Image or canvas)
   *   values    { name, date, signatureImage }
   *   cfg       { name:{...}, date:{...}, signature:{...} }
   */
  function drawCertificate(ctx, template, values, cfg) {
    // Prefer the intrinsic size: an <img> may have been laid out smaller.
    var width = template.naturalWidth || template.width;
    var height = template.naturalHeight || template.height;
    var config = cfg || {};
    var data = values || {};

    ctx.clearRect(0, 0, width, height);
    ctx.drawImage(template, 0, 0, width, height);

    return {
      width: width,
      height: height,
      name: drawText(ctx, width, height, data.name, config.name),
      date: drawText(ctx, width, height, data.date, config.date),
      signature: drawSignature(ctx, width, height, data.signatureImage, config.signature),
    };
  }

  return {
    FONT_STACK: FONT_STACK,
    computeTextPlacement: computeTextPlacement,
    computeImagePlacement: computeImagePlacement,
    drawText: drawText,
    drawSignature: drawSignature,
    drawCertificate: drawCertificate,
  };
});
