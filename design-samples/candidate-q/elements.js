// All coordinates are in viewBox units. The artwork uses no filters or SVG IDs.
const ink = '#282722';
const red = '#ab302e';
const paper = '#f7ecd5';
const serif = "Georgia, 'Times New Roman', serif";

const suits = {
  spades: [ink, 'M0-20C-4-13-21-4-21 7C-21 17-7 20-2 11Q-3 18-8 22H8Q3 18 2 11C8 20 21 17 21 7C21-4 7-12 0-20Z'],
  hearts: [red, 'M0 20C-5 13-21 3-21-7C-21-19-6-23 0-12C6-23 21-19 21-7C21 3 6 14 0 20Z'],
  diamonds: [red, 'M0-22Q9-8 17 0Q9 9 0 22Q-9 8-17 0Q-9-9 0-22Z'],
  clubs: [ink, 'M0-21C10-21 15-10 8-3C21-8 26 8 17 14Q9 20 2 12Q3 19 8 22H-8Q-3 19-2 12Q-9 20-17 14C-26 8-21-8-8-3C-15-10-10-21 0-21Z'],
};

const chips = {
  1: ['#f2ead9', '#b5a789', '#353d44', '#eee2ca'],
  5: ['#b94135', '#792c28', '#f1d7a7', '#f3dec1'],
  10: ['#38628c', '#263f60', '#dfebde', '#e0e6d2'],
  25: ['#37765c', '#254f43', '#e6dcad', '#e6e5c8'],
  100: ['#363637', '#222323', '#e8d8b3', '#e9dec6'],
  500: ['#75537e', '#493751', '#f0cdac', '#eedcc8'],
  1000: ['#e6a736', '#9f641f', '#713b2d', '#f5dcaa'],
};

const n = (number) => Number(number.toFixed(2));
const point = (x, y) => `${n(x)} ${n(y)}`;

function random(seed) {
  return () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
}

// Pack the speckles into two paths, with a safe margin from the artwork's edge.
function grain(seed, count, sample, colors = ['#473624', '#fff9df']) {
  const next = random(seed);
  const paths = ['', ''];
  for (let i = 0; i < count; i++) {
    const [x, y] = sample(next);
    const length = .4 + next() * 2.1;
    paths[i % 2] += `M${point(x, y)}l${n(length)} ${n(next() * 1.8 - .9)}`;
  }
  return paths.map((path, i) =>
    `<path d="${path}" stroke="${colors[i]}" stroke-opacity="${i ? '.33' : '.21'}" stroke-width=".8" stroke-linecap="round" fill="none"/>`,
  ).join('');
}

function svg(viewBox, label, content) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}" role="img" aria-label="${label}">${content}</svg>`;
}

function chipPoint(angle, radius, depth = 0) {
  return point(56 + Math.cos(angle) * radius, 51 + Math.sin(angle) * radius * .88 + depth);
}

function chipArc(to, radius, depth = 0, sweep = 1) {
  return `A${radius} ${n(radius * .88)} 0 0 ${sweep} ${chipPoint(to, radius, depth)}`;
}

export function chipSVG({ value }) {
  if (!Object.hasOwn(chips, value)) throw new RangeError('Unsupported chip denomination');
  value = Number(value);
  const [body, edge, insert, inlay] = chips[value];
  const radius = 49;
  const depth = 8;
  const rim = `M${chipPoint(0, radius)}${chipArc(Math.PI, radius)}
    L${chipPoint(Math.PI, radius, depth)}${chipArc(0, radius, depth, 0)}Z`;
  let spots = '';
  let sideSpots = '';
  let hatch = '';
  for (let i = 0; i < 8; i++) {
    const angle = (i + .5) * Math.PI / 4;
    const left = angle - .125;
    const right = angle + .125;
    spots += `M${chipPoint(left, 35.5)}L${chipPoint(left, radius)}${chipArc(right, radius)}L${chipPoint(right, 35.5)}Z`;
    if (i < 4) {
      sideSpots += `M${chipPoint(left, radius)}${chipArc(right, radius)}
        L${chipPoint(right, radius, depth)}${chipArc(left, radius, depth, 0)}Z`;
    }
    for (let j = 0; j < 6; j++) {
      const tick = angle + .18 + j * .068;
      hatch += `M${chipPoint(tick, 37 + j % 2)}L${chipPoint(tick + .018, 41.8 + j % 3)}`;
    }
  }
  const texture = grain(value * 83, 120, (next) => {
    const angle = next() * Math.PI * 2;
    const distance = Math.sqrt(next()) * 44;
    return [56 + Math.cos(angle) * distance, 51 + Math.sin(angle) * distance * .88];
  });
  const stitches = Array.from({ length: 4 }, (_, i) => {
    const y = i * .42;
    return `M${point(33 + i * .6, 48 + y)}l-4 2l4 2M${point(79 - i * .6, 48 + y)}l4 2l-4 2`;
  }).join('');
  return svg('0 0 112 112', `${value} chip`, `
    <ellipse cx="56" cy="98" rx="42" ry="8" fill="#151a17" opacity=".25"/>
    <path d="${rim}" fill="${edge}" stroke="${ink}" stroke-width="2.1"/>
    <path d="${sideSpots}" fill="${insert}" opacity=".79" stroke="${edge}" stroke-width=".8"/>
    <ellipse cx="56" cy="51" rx="49" ry="43.12" fill="${body}"/>
    <path d="${spots}" fill="${insert}" stroke="${ink}" stroke-opacity=".54" stroke-width="1"/>
    <path d="${hatch}" fill="none" stroke="${insert}" stroke-opacity=".73" stroke-width=".8" stroke-linecap="round"/>
    <ellipse cx="56" cy="51" rx="49" ry="43.12" fill="none" stroke="${ink}" stroke-width="2"/>
    <path d="M8 51C8 26 32 8 57 9S103 27 104 51" fill="none" stroke="#fff4d3" stroke-opacity=".58" stroke-width="1.5"/>
    <path d="M21 51C21 33 38 20 56 20C76 20 91 33 91 51C91 68 76 82 56 82C36 83 21 68 21 51Z"
      fill="none" stroke="${ink}" stroke-width="1.4"/>
    <path d="M25 51C25 35 39 24 56 24C73 24 87 36 87 51C87 66 73 78 56 78C39 79 25 66 25 51Z"
      fill="${inlay}" stroke="${ink}" stroke-width="1.3"/>
    ${texture}
    <path d="M41 38q15-5 30 0M41 64q15 5 30 0" fill="none" stroke="${edge}" stroke-opacity=".65" stroke-width="1"/>
    <path d="${stitches}" fill="none" stroke="${edge}" stroke-width=".65" opacity=".7"/>
    <text x="56" y="58" text-anchor="middle" font-family="${serif}" font-size="${value === 1000 ? 19 : 23}"
      font-weight="bold" letter-spacing="-.8" fill="${ink}">${value}</text>
  `);
}

function pip(suit, x, y, scale, angle = 0, color = suits[suit][0]) {
  return `<path d="${suits[suit][1]}" fill="${color}" transform="translate(${x} ${y}) rotate(${angle}) scale(${scale})"/>`;
}

const pairs = (rows) => rows.flatMap((y) => [[76, y], [174, y]]);
const pipLayouts = {
  2: [[125, 61], [125, 287]],
  3: [[125, 61], [125, 174], [125, 287]],
  4: pairs([61, 287]),
  5: [...pairs([61, 287]), [125, 174]],
  6: pairs([61, 174, 287]),
  7: [...pairs([61, 174, 287]), [125, 117]],
  8: [...pairs([61, 174, 287]), [125, 117], [125, 231]],
  9: [...pairs([61, 136, 212, 287]), [125, 174]],
  10: [...pairs([61, 136, 212, 287]), [125, 98], [125, 250]],
};

const cardTexture = grain(17981, 365, (next) => [9 + next() * 229, 8 + next() * 327]);
const backTexture = grain(61921, 450, (next) => [28 + next() * 190, 28 + next() * 290], ['#261e23', '#f8cfa5']);

function cardStock(content) {
  return `
    <path d="M17 7H231Q246 7 246 22L247 329Q247 346 231 347L18 347Q3 346 3 331L3 23Q3 7 17 7Z"
      fill="#b5a184" stroke="${ink}" stroke-width="2"/>
    <path d="M6 330Q8 343 21 343H229Q242 343 244 332" stroke="#e0ccb0" stroke-width="1.4" fill="none"/>
    <path d="M18 3Q100 2 231 3Q246 3 246 19L245 326Q246 341 231 341L18 342Q3 342 3 327L3 18Q3 4 18 3Z"
      fill="${paper}" stroke="${ink}" stroke-width="2.2"/>
    <path d="M17 7Q77 6 114 7M243 24L242 111M6 250L7 324Q7 336 20 337" stroke="#fffaf0" stroke-width="2" fill="none"/>
    ${cardTexture}${content}`;
}

function index(rank, suit) {
  return `<g fill="${suits[suit][0]}">
    <text x="27" y="43" text-anchor="middle" font-family="${serif}" font-weight="bold"
      font-size="${rank === '10' ? 28 : 36}" letter-spacing="-1.6">${rank}</text>
    ${pip(suit, 27, 61, .38)}
  </g>`;
}

function ace(suit) {
  if (suit !== 'spades') return pip(suit, 125, 173, 2.05);
  const rays = Array.from({ length: 32 }, (_, i) => {
    const angle = i * 11.25;
    const inner = i % 2 ? 50 : 47;
    return `<path d="M125 ${174 - inner}v-${i % 2 ? 6 : 12}" transform="rotate(${angle} 125 174)"/>`;
  }).join('');
  return `<g fill="none" stroke="#98744d" stroke-width="1.4" stroke-linecap="round">${rays}
    <path d="M116 104l9-10 9 10-9 9Z M116 244l9-9 9 9-9 10Z"/>
    <path d="M117 226C100 235 79 219 78 208Q71 197 63 203M133 226C150 235 171 219 172 208Q179 197 187 203"/>
  </g>
  ${pip(suit, 125, 173, 2.13)}
  <g fill="none" stroke="${paper}" stroke-opacity=".8" stroke-width="1.45" stroke-linecap="round">
    <path d="M125 141C122 152 99 159 95 172C87 194 115 199 123 177C126 169 125 160 125 156
      M125 141C128 152 151 159 155 172C163 194 135 199 127 177
      M101 179c3-9 12-3 8 2q-4 6-9 0m49-2c-3-9-12-3-8 2q4 6 9 0m-25 7-3 17m4-8 3 8"/>
    <path d="M113 160l-8 5m29-5 11 7m-47 18 6 5m48-5-6 5" opacity=".65"/>
  </g>`;
}

const crowns = {
  K: '<path d="M84 91L78 64L96 75L109 57L123 73L138 57L152 74L169 63L162 92Z" fill="#dfb463"/><path d="M84 83Q121 77 165 83L162 92H84Z" fill="#ba493b"/>',
  Q: '<path d="M86 94L84 71L100 80L124 59L146 80L162 69L158 94Z" fill="#dfb463"/><path d="M91 86L157 86L158 94H86Z" fill="#b6463b"/><path d="M119 76l5-6 5 6-5 8Z" fill="#aa3533"/>',
  J: '<path d="M82 91Q82 65 109 66Q132 62 154 80L166 91Q123 85 82 94Z" fill="#b8473a"/><path d="M129 83Q136 63 158 55Q158 71 145 84M139 77l16-15" fill="#dfb463"/><path d="M82 91Q122 84 164 89L159 97Q118 89 83 98Z" fill="#dfb463"/>',
};

const regalia = {
  K: '<path d="M178 81l3 82m-9-68 8-32 7 31-6 49M166 142l28-2m-17 17 9-1" fill="#dfb463"/>',
  Q: '<path d="M179 151q4-30 4-57m0 30q-13-3-13-13 9 0 13 9m0 15q9-14 16-13-2 10-16 13" fill="#648172"/><path d="M183 100q-17-6-11-17 5-4 10 4 4-11 10-5 5 8-9 18Z" fill="#b8473a"/>',
  J: '<path d="M179 158l3-84m-10 15 10-24 9 24-9 15Z" fill="#dfb463"/><path d="M174 141l14 1m-9 9 9-1" fill="none"/>',
};

function court(rank, suit) {
  const queen = rank === 'Q';
  const trim = { K: '#506c80', Q: '#647f70', J: '#43677a' }[rank];
  const brocade = { K: '#b54a3c', Q: '#973b4c', J: '#b85b36' }[rank];
  const portrait = `<g stroke="${ink}" stroke-width="1.85" stroke-linecap="round" stroke-linejoin="round">
    <path d="M51 174V151Q62 138 100 131L107 122L142 125L150 132Q184 138 199 151V174Z" fill="${trim}"/>
    <path d="M51 154Q65 139 101 131L112 142L85 174H51ZM199 154Q180 139 150 132L141 143L165 174H199Z" fill="${brocade}"/>
    <path d="M64 144l31-8-29 38H53Zm121 1-30-9 29 38h13Z" fill="#dfb463"/>
    <path d="M103 124L124 136L146 124L152 136L137 154L124 145L112 154L96 136Z" fill="#efe0bd"/>
    <path d="M105 143l8 15 11-9 12 9 10-15m-22 10v18m-14-8h28" fill="none"/>
    <path d="M88 95Q78 119 89 138L110 133L142 134L160 139Q169 121 157 92Z" fill="${queen ? '#b17e49' : '#78553a'}"/>
    <path d="M99 93Q119 89 151 96L149 118Q146 127 131 135Q119 138 107 130L101 119Q90 118 93 109Q95 106 100 110Z" fill="#ebc69e"/>
    <path d="${queen ? 'M105 106q6-5 12 0m15 0q6-5 12 0m-19 1-3 11 5 1m-12 6q8 4 18-1'
      : rank === 'J' ? 'M105 105q6-3 11 0m17-1q6-3 11 1m-18 0-4 12 6 1m-12 5q5 6 15 1'
      : 'M104 104q6-3 13 0m15 1q6-3 12 1m-18 0-4 12 6 1'}" fill="none"/>
    <path d="M110 108h2m26 0h2" stroke-width="2.8"/>
    ${rank === 'K' ? '<path d="M103 118Q108 124 118 121L125 124L134 121L146 119Q143 133 128 138Q111 137 103 118Z" fill="#78553a"/><path d="M116 124q10 5 21-1m-14 6 3 4" fill="none" stroke="#dfb463"/>' : ''}
    ${queen ? '<path d="M92 119l-4 8 4 6 4-6ZM155 119l-4 8 4 6 4-6Z" fill="#dfb463"/>' : ''}
    ${crowns[rank]}
    <path d="M91 102l-4 12m1 4 1 10m68-26 4 13m-2 4v10m-84 18-12 17m17-18-13 20m104-20 12 17m-7-17 13 20" fill="none" opacity=".55"/>
    ${regalia[rank]}
    <path d="M56 170h137" stroke="#f0ce86" stroke-width="1.1"/>
  </g>`;
  return `
    <path d="M48 46Q123 44 201 46L202 301Q128 303 48 301Z" fill="#ecdfbf" stroke="${ink}" stroke-width="1.75"/>
    <path d="M53 52L196 51L197 297L53 296Z" fill="none" stroke="#9b7043" stroke-width="1.2"/>
    ${pip(suit, 66, 70, .48)}${pip(suit, 184, 278, .48, 180)}
    ${portrait}<g transform="rotate(180 125 174)">${portrait}</g>
    <path d="M49 174q80 1 152 0" stroke="${ink}" stroke-width="1.7"/>
    ${grain(327, 190, (next) => [54 + next() * 140, 53 + next() * 240])}`;
}

export function cardSVG({ rank, suit }) {
  rank = String(rank).toUpperCase();
  const names = { A: 'Ace', J: 'Jack', Q: 'Queen', K: 'King' };
  if (!Object.hasOwn(suits, suit) || (!Object.hasOwn(pipLayouts, rank) && !Object.hasOwn(names, rank))) {
    throw new RangeError('Unsupported playing card');
  }
  const corner = index(rank, suit);
  const design = rank === 'A' ? ace(suit)
    : Object.hasOwn(pipLayouts, rank) ? pipLayouts[rank].map(([x, y]) => pip(suit, x, y, .87, y > 174 ? 180 : 0)).join('')
    : court(rank, suit);
  return svg('0 0 250 350', `${names[rank] ?? rank} of ${suit}`, cardStock(`
    ${design}${corner}<g transform="rotate(180 125 173)">${corner}</g>`));
}

export function cardBackSVG() {
  let lattice = '';
  for (let y = 37; y <= 311; y += 18) {
    for (let x = 35; x <= 215; x += 18) {
      lattice += `M${x - 8} ${y}q8-3 8-8 2 5 8 8-6 2-8 8-2-6-8-8Z`;
    }
  }
  const rosette = `<g fill="none" stroke="#efd4a8" stroke-width="1.6">
    ${Array.from({ length: 12 }, (_, i) =>
      `<ellipse cx="125" cy="153" rx="13" ry="36" transform="rotate(${i * 30} 125 174)"/>`).join('')}
    <circle cx="125" cy="174" r="60"/><circle cx="125" cy="174" r="64" stroke-dasharray="1 4"/>
    <path d="M125 153q5 16 21 21-16 5-21 21-5-16-21-21 16-5 21-21Z" fill="#762f3b"/>
    <path d="M125 165v18m-9-9h18"/>
  </g>`;
  return svg('0 0 250 350', 'Card back', cardStock(`
    <path d="M22 14Q126 13 225 14Q235 14 235 25L235 320Q235 331 224 331L24 330Q14 330 14 319L14 25Q14 15 22 14Z" fill="#762f3b" stroke="${ink}" stroke-width="1.8"/>
    <path d="M23 23L226 22L226 322L23 323Z" fill="none" stroke="#efd4a8" stroke-width="2"/>
    <path d="${lattice}" fill="none" stroke="#edbb91" stroke-opacity=".53" stroke-width=".9"/>
    <circle cx="125" cy="174" r="67" fill="#762f3b" stroke="#efd4a8" stroke-width="1.1"/>
    ${rosette}${backTexture}
  `));
}
