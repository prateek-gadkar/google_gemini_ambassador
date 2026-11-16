'use strict';

/**
 * Inline icons, in the shape Material Symbols draws them.
 *
 * They are inlined instead of loaded from a font or an icon CDN because the
 * site has to work with no network beyond its own origin: a missing icon font
 * would leave empty squares on the one page that matters.
 *
 * Usage from the other scripts:  gsaIcon('check_circle', 18)
 * The markup is trusted (nothing here is user input), so it can go straight
 * into innerHTML.
 */
(function () {
  var PATHS = {
    check_circle:
      'M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 ' +
      '1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z',
    schedule:
      'M11.99 2C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 ' +
      '11.99 2zM12 20c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zm.5-13H11v6l5.25 ' +
      '3.15.75-1.23-4.5-2.67z',
    cancel:
      'M12 2C6.47 2 2 6.47 2 12s4.47 10 10 10 10-4.47 10-10S17.53 2 12 2zm5 13.59L15.59 17 ' +
      '12 13.41 8.41 17 7 15.59 10.59 12 7 8.41 8.41 7 12 10.59 15.59 7 17 8.41 13.41 12 ' +
      '17 15.59z',
    lock:
      'M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 ' +
      '0 2-.9 2-2V10c0-1.1-.9-2-2-2zM12 17c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2zm3.1-9H8.9V6c0-1.71 ' +
      '1.39-3.1 3.1-3.1 1.71 0 3.1 1.39 3.1 3.1v2z',
    verified:
      'M23 12l-2.44-2.79.34-3.69-3.61-.82-1.89-3.2L12 2.96 8.6 1.5 6.71 4.6 3.1 5.41l.34 ' +
      '3.7L1 12l2.44 2.79-.34 3.7 3.61.82L8.6 22.5l3.4-1.47 3.4 1.46 1.89-3.19 3.61-.82-.34-3.69L23 ' +
      '12zm-12.91 4.72l-3.8-3.81 1.48-1.48 2.32 2.33 5.85-5.87 1.48 1.48-7.33 7.35z',
    open_in_new:
      'M19 19H5V5h7V3H5c-1.11 0-2 .9-2 2v14c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2v-7h-2v7zM14 ' +
      '3v2h3.59l-9.83 9.83 1.41 1.41L19 6.41V10h2V3h-7z',
    download: 'M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z',
    upload: 'M9 16h6v-6h4l-7-7-7 7h4v6zm-4 2h14v2H5v-2z',
    refresh:
      'M17.65 6.35C16.2 4.9 14.21 4 12 4c-4.42 0-7.99 3.58-8 8s3.57 8 8 8c3.73 0 ' +
      '6.84-2.55 7.73-6h-2.08c-.82 2.33-3.04 4-5.65 4-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 ' +
      '0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z',
    table_chart:
      'M10 10.02h5V21h-5zM17 21h3c1.1 0 2-.9 2-2v-9h-5v11zm3-18H5c-1.1 0-2 .9-2 2v3h19V5c0-1.1-.9-2-2-2zM3 ' +
      '19c0 1.1.9 2 2 2h3V10H3v9z',
    person:
      'M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z',
    key:
      'M12.65 10C11.83 7.67 9.61 6 7 6c-3.31 0-6 2.69-6 6s2.69 6 6 6c2.61 0 4.83-1.67 ' +
      '5.65-4H17v4h4v-4h2v-4H12.65zM7 14c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2z',
    image:
      'M21 19V5c0-1.1-.9-2-2-2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2zM8.5 ' +
      '13.5l2.5 3.01L14.5 12l4.5 6H5l3.5-4.5z',
    tune:
      'M3 17v2h6v-2H3zM3 5v2h10V5H3zm10 16v-2h8v-2h-8v-2h-2v6h2zM7 9v2H3v2h4v2h2V9H7zm14 ' +
      '4v-2H11v2h10zm-6-4h2V7h4V5h-4V3h-2v6z',
    logout:
      'M17 7l-1.41 1.41L18.17 11H8v2h10.17l-2.58 2.58L17 17l5-5zM4 5h8V3H4c-1.1 0-2 .9-2 ' +
      '2v14c0 1.1.9 2 2 2h8v-2H4V5z',
    warning: 'M1 21h22L12 2 1 21zm12-3h-2v-2h2v2zm0-4h-2v-4h2v4z',
    info: 'M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z',
    arrow_back: 'M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z',
    description:
      'M14 2H6c-1.1 0-1.99.9-1.99 2L4 20c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8l-6-6zm2 16H8v-2h8v2zm0-4H8v-2h8v2zm-3-5V3.5L18.5 9H13z',
  };

  function gsaIcon(name, size) {
    var d = PATHS[name];
    if (!d) return '';
    var px = size || 18;
    return (
      '<svg class="ico" width="' + px + '" height="' + px + '" viewBox="0 0 24 24" ' +
      'fill="currentColor" aria-hidden="true" focusable="false"><path d="' + d + '"/></svg>'
    );
  }

  window.gsaIcon = gsaIcon;
  window.gsaIconNames = Object.keys(PATHS);

  /**
   * Static markup asks for an icon with <span data-icon="refresh"></span>, so a
   * button keeps its label in the HTML where it can be read and translated,
   * and the drawing lives in one place.
   */
  function hydrate(root) {
    var nodes = (root || document).querySelectorAll('[data-icon]');
    for (var i = 0; i < nodes.length; i += 1) {
      var node = nodes[i];
      if (node.getAttribute('data-icon-done') === '1') continue;
      var size = Number(node.getAttribute('data-icon-size')) || 18;
      node.innerHTML = gsaIcon(node.getAttribute('data-icon'), size);
      node.setAttribute('data-icon-done', '1');
    }
  }

  window.gsaHydrateIcons = hydrate;
  hydrate(document);
  document.addEventListener('DOMContentLoaded', function () { hydrate(document); });
})();
