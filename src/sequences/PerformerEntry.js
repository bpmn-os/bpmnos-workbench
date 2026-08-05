import { createCollapsibleEntry } from 'bpmn-js-side-panel';

/**
 * One sequential performer rendered as a side-panel entry, on the pattern of `bpmn-js-animation`'s token
 * entry and in its classes, so that the lists of this application are one appearance rather than several
 * that resemble each other.
 *
 * The summary says which performer this is: the symbol of the node it stands at, marked with its token, the
 * name of that node, and the instance of the token standing there. Expanding it shows what it holds, which
 * the caller gives ready-made, the list being the reader's order and therefore the panel's to arrange.
 *
 * @param {Object} performer  `{ key, node, instanceId, color, kind }`, `kind` being `process`,
 *                            `subProcess` or `adHocSubProcess`
 * @param {Object} [options]
 * @param {boolean} [options.open=false]  whether the row starts expanded
 * @param {Function} [options.onToggle]   (open) => void
 * @param {Element} [options.body]        what the expanded row shows
 * @param {Function} [options.onClick]    (originalEvent) => void, a click on the row rather than the caret
 */
export default function createPerformerEntry(performer, options = {}) {
  const summary = el('span', 'bjs-token-summary'),
        info = el('span', 'bjs-token-info');

  info.appendChild(labelEl(performer.node || ''));
  info.appendChild(text('span', 'bjs-token-node', performer.instanceId || ''));

  summary.appendChild(markEl(performer));
  summary.appendChild(info);

  const entry = createCollapsibleEntry({
    id: performer.key,
    label: summary,
    open: !!options.open,
    toggleOn: 'caret',
    onToggle: options.onToggle
  });

  entry.element.classList.add('bjs-token-entry');

  if (options.body) {
    entry.contentEl.appendChild(options.body);
  }

  // A click on the row selects the token standing at the performing node, as a click on a token row does,
  // which is what `toggleOn: 'caret'` leaves free. The click is not given to the entry itself: that would
  // bind it to the whole entry, body included, and what the body holds acts on itself rather than on the
  // performer — reordering the tokens waiting under it is not an act of selection. So a click that starts
  // inside the body is left to the body, exactly as the token entry leaves it.
  if (options.onClick) {
    entry.element.classList.add('bjs-token-clickable');
    entry.element.addEventListener('click', (event) => {
      if (entry.contentEl && entry.contentEl.contains(event.target)) {
        return;
      }
      options.onClick(event);
    });
  }

  return entry;
}

/**
 * The performer drawn as the node it stands at, marked with its token.
 *
 * A performer is a process, a sub-process or an ad hoc sub-process, and it is drawn with BPMN's own symbol
 * for whichever it is, the participant, the collapsed sub-process and the ad hoc sub-process of
 * `bpmn-font`, so that a reader recognises it from the diagram rather than learning a second vocabulary.
 * The token standing there is a bullet centred on the symbol's upper boundary, in that token's colour.
 *
 * Symbol and bullet are one drawing rather than an icon with something placed over it, as the message row
 * draws BPMN's envelope with the sender's bullet, which is what keeps the two together at any size and
 * needs nothing of a stylesheet.
 */
function markEl(performer) {
  const symbol = SYMBOLS[performer.kind] || SYMBOLS.adHocSubProcess,
        svg = document.createElementNS(SVG, 'svg');

  // The box hugs the drawing, the bullet included, so the symbol fills the height it is given rather than
  // sitting in the empty margin of the font's own square. The lane it is drawn in is one width for all
  // three and the drawing is centred in it, so that the names beside the symbols line up whichever symbol a
  // performer carries, and so that the middle of every symbol falls on the middle of the lane, which is
  // where `sequences.css` puts the reorder arrows of the list beneath.
  svg.setAttribute('viewBox', symbol.viewBox);
  svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
  svg.setAttribute('width', String(LANE));
  svg.setAttribute('height', String(HEIGHT));
  svg.setAttribute('class', 'wb-performer-symbol');
  svg.setAttribute('aria-hidden', 'true');

  const glyph = document.createElementNS(SVG, 'path');

  glyph.setAttribute('d', symbol.d);
  glyph.setAttribute('fill', 'currentColor');

  if (symbol.transform) {
    glyph.setAttribute('transform', symbol.transform);
  }

  const bullet = document.createElementNS(SVG, 'circle');

  bullet.setAttribute('cx', '1024');
  bullet.setAttribute('cy', String(symbol.top));
  bullet.setAttribute('r', String(BULLET));
  bullet.setAttribute('fill', performer.color || '#888');
  bullet.setAttribute('stroke', 'rgba(0, 0, 0, 0.2)');
  bullet.setAttribute('stroke-width', '60');

  svg.appendChild(glyph);
  svg.appendChild(bullet);

  return svg;
}

/**
 * The lane a symbol is drawn in and the height it is drawn at, in pixels, and the radius of the token on
 * its boundary, on the font's own 2048 square. The lane is what `sequences.css` centres the reorder arrows
 * of the list beneath, so the two are read together.
 */
const LANE = 28;
const HEIGHT = 24;
const BULLET = 420;

/**
 * The three symbols a performer is drawn with, taken from `bpmn-font`'s sources, `participant.svg`,
 * `subprocess-collapsed.svg` and `ad-hoc-subprocess.svg`, each on that font's 2048 square. `top` is the
 * middle of the upper boundary line rather than its outer edge, which is where a token on a boundary sits;
 * these symbols are outlines, so the two differ by half the line's thickness and a token placed on the edge
 * reads as sitting above the shape. `viewBox` is the drawing with the token on it, which is what the lane
 * shows.
 */
const SYMBOLS = {
  process: {
    d: 'm 96,-593.63783 0,1280 1856,0 0,-1280 z m 1756,97.69925 0,1091.54297 -1372,0 0,-1091.54103 '
      + '1372,-0.002 z m -1660,0.002 192,-2.1e-4 0,1091.54108 -192,2.1e-4 z',
    transform: 'translate(0,995.63783)',
    top: 451,
    viewBox: '96 0 1856 1682'
  },
  subProcess: {
    d: 'M 441.30078 273.61133 C 266.57475 273.61133 124.34961 415.83646 124.34961 590.5625 L 124.34961 '
      + '1457.4395 C 124.34961 1632.1655 266.57475 1774.3906 441.30078 1774.3906 L 1606.6992 1774.3906 C '
      + '1781.4253 1774.3906 1923.6504 1632.1655 1923.6504 1457.4395 L 1923.6504 590.5625 C 1923.6504 '
      + '415.83646 1781.4253 273.61133 1606.6992 273.61133 L 441.30078 273.61133 z M 441.30078 373.61133 L '
      + '1606.6992 373.61133 C 1727.755 373.61133 1823.6504 469.50674 1823.6504 590.5625 L 1823.6504 '
      + '1457.4395 C 1823.6504 1578.4952 1727.755 1674.3906 1606.6992 1674.3906 L 1370.457 1674.3906 L '
      + '1370.457 1043.6445 L 677.54297 1043.6445 L 677.54297 1075.3809 L 677.54297 1674.3906 L 441.30078 '
      + '1674.3906 C 320.24502 1674.3906 224.34961 1578.4952 224.34961 1457.4395 L 224.34961 590.5625 C '
      + '224.34961 469.50674 320.24502 373.61133 441.30078 373.61133 z M 741.01562 1107.1172 L 1306.9844 '
      + '1107.1172 L 1306.9844 1673.0859 L 741.01562 1673.0859 L 741.01562 1107.1172 z M 976.52148 '
      + '1187.6191 L 976.52148 1235.0996 L 976.52148 1345.3203 L 866.29688 1345.3203 L 818.81641 1345.3203 '
      + 'L 818.81641 1440.2832 L 866.29688 1440.2832 L 976.52148 1440.2832 L 976.52148 1550.5098 L '
      + '976.52148 1597.9844 L 1071.4785 1597.9844 L 1071.4785 1550.5098 L 1071.4785 1440.2832 L 1181.7031 '
      + '1440.2832 L 1229.1836 1440.2832 L 1229.1836 1345.3203 L 1181.7031 1345.3203 L 1071.4785 1345.3203 '
      + 'L 1071.4785 1235.0996 L 1071.4785 1187.6191 L 976.52148 1187.6191 z',
    transform: null,
    top: 323.61,
    viewBox: '124 -127 1800 1902'
  },
  adHocSubProcess: {
    d: 'M441.139 273.613C266.445 273.613 124.314 415.744 124.314 590.438L124.314 1457.56C124.314 1632.26 '
      + '266.445 1774.39 441.139 1774.39L1606.86 1774.39C1781.56 1774.39 1923.69 1632.26 1923.69 '
      + '1457.56L1923.69 590.438C1923.69 415.744 1781.56 273.613 1606.86 273.613L441.139 273.613ZM441.139 '
      + '373.555L1606.86 373.555C1727.9 373.555 1823.74 469.402 1823.74 590.438L1823.74 1457.56C1823.74 '
      + '1578.6 1727.9 1674.44 1606.86 1674.44L441.139 1674.44C320.102 1674.44 224.256 1578.6 224.256 '
      + '1457.56L224.256 590.438C224.256 469.402 320.102 373.555 441.139 373.555ZM727.04 1450.48C751.815 '
      + '1391.85 784.226 1330.76 840.139 1297.76C881.629 1272.98 932.876 1288.26 970.971 1312.52C1029.6 '
      + '1348.67 1075.42 1402.37 1133.28 1439.62C1168.24 1460.07 1211.68 1443.27 1237.13 1414.93C1267.85 '
      + '1379.13 1302.97 1345.36 1320.96 1300.39C1320.96 1347.05 1320.96 1393.72 1320.96 1440.47C1294.91 '
      + '1492.06 1261.48 1545.68 1207.95 1570.71C1164.17 1589.63 1113.26 1578.26 1075.33 1550.94C1019.76 '
      + '1513.69 978.862 1456.08 918.452 1425.96C889.095 1410.69 851.678 1414.25 827.073 1437.25C782.784 '
      + '1476.44 757.415 1531.93 727.04 1582.08C727.04 1538.21 727.04 1494.35 727.04 1450.48Z',
    transform: null,
    top: 323.61,
    viewBox: '124 -127 1800 1902'
  }
};

const SVG = 'http://www.w3.org/2000/svg';

function el(tag, className) {
  const node = document.createElement(tag);

  if (className) {
    node.className = className;
  }

  return node;
}

function text(tag, className, string) {
  const node = el(tag, className);

  node.textContent = string;

  return node;
}

// the name truncates in the middle, as a token's label does, so that its head and its tail both stay
// visible however narrow the panel is
function labelEl(label) {
  const wrap = el('span', 'bjs-token-label'),
        tail = Math.min(6, Math.floor(label.length / 2));

  wrap.title = label;
  wrap.appendChild(text('span', 'bjs-token-label-head', label.slice(0, label.length - tail)));
  wrap.appendChild(text('span', 'bjs-token-label-tail', label.slice(label.length - tail)));

  return wrap;
}
