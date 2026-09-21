(function (root) {
  'use strict';

  // The neighbourhood is drawn once. The game reveals it with its light mask.
  // All colour belongs to the host stylesheet, including the dawn palette.
  // Shared road data keeps the rendered streets and wire routing graph aligned.
  const roads = [
    { id: 'west', width: 25, points: [{ x: 291, y: 415 }, { x: 365, y: 415 }, { x: 365, y: 204 }, { x: 723, y: 204 }, { x: 723, y: 130 }] },
    { id: 'battery-return', width: 22, points: [{ x: 153, y: 415 }, { x: 199, y: 415 }, { x: 199, y: 551 }] },
    { id: 'main', width: 23, points: [{ x: 365, y: 347 }, { x: 974, y: 347 }] },
    { id: 'pump-return', width: 23, points: [{ x: 1064, y: 347 }, { x: 1064, y: 591 }] },
    { id: 'central', width: 21, points: [{ x: 429, y: 130 }, { x: 429, y: 613 }, { x: 983, y: 613 }] },
    { id: 'east-central', width: 22, points: [{ x: 723, y: 204 }, { x: 723, y: 591 }, { x: 1064, y: 591 }] },
    { id: 'east', width: 20, points: [{ x: 968, y: 132 }, { x: 968, y: 591 }] },
    { id: 'south', width: 20, points: [{ x: 179, y: 551 }, { x: 946, y: 551 }] },
    { id: 'courtyard', width: 20, points: [{ x: 365, y: 473 }, { x: 690, y: 473 }, { x: 690, y: 347 }] },
    { id: 'park', width: 20, points: [{ x: 723, y: 264 }, { x: 968, y: 264 }] },
    { id: 'lamp1-left', width: 20, points: [{ x: 499, y: 347 }, { x: 499, y: 285 }] },
    { id: 'lamp1-right', width: 20, points: [{ x: 591, y: 347 }, { x: 591, y: 285 }] },
    { id: 'lamp2-left', width: 20, points: [{ x: 723, y: 465 }, { x: 754, y: 465 }] },
    { id: 'lamp2-right', width: 20, points: [{ x: 846, y: 465 }, { x: 968, y: 465 }] },
    { id: 'lamp3-left', width: 20, points: [{ x: 804, y: 264 }, { x: 804, y: 180 }] },
    { id: 'lamp3-right', width: 20, points: [{ x: 896, y: 264 }, { x: 896, y: 180 }] },
    { id: 'motor-left', width: 20, points: [{ x: 974, y: 347 }, { x: 974, y: 345 }] },
    { id: 'motor-right', width: 20, points: [{ x: 1064, y: 347 }, { x: 1066, y: 347 }, { x: 1066, y: 345 }] },
  ];

  function building(x, y, w, h, options) {
    const o = options || {};
    const roof = o.flat ? '' : `<path class="city-roof" d="M${x + 7} ${y + h / 2}H${x + w - 7}M${x + 7} ${y + h / 2}l${w / 2 - 7} ${-h / 2 + 7} ${w / 2 - 7} ${h / 2 - 7}M${x + w / 2} ${y + 7}V${y + h - 7}" fill="none" stroke-width=".8"/>`;
    let windows = '';
    for (let i = 0; i < Math.floor((w - 16) / 13); i++) {
      const wx = x + 10 + i * 13;
      windows += `<path class="city-window" d="M${wx} ${y + 3}h5M${wx} ${y + h - 3}h5" stroke-width="2"/>`;
    }
    return `<g><rect class="city-building" x="${x}" y="${y}" width="${w}" height="${h}" rx="2" stroke-width="1"/><rect class="city-roof" x="${x + 5}" y="${y + 5}" width="${w - 10}" height="${h - 10}" rx=".6" fill="none" stroke-width=".6"/>${roof}${windows}</g>`;
  }

  function tree(x, y, r) {
    return `<g><circle class="city-tree" cx="${x}" cy="${y}" r="${r || 7}" stroke-width=".8"/><path class="city-roof" d="M${x} ${y + 3}v-6m-2 2 2 2 2-2" fill="none" stroke-width=".55"/></g>`;
  }

  function road(data) {
    const d = data.points.map((p, i) => `${i ? 'L' : 'M'}${p.x} ${p.y}`).join(' ');
    return `<path class="city-road" d="${d}" fill="none" stroke-width="${data.width}" stroke-linecap="round" stroke-linejoin="round"/><path class="city-road-center" d="${d}" fill="none" stroke-width=".65" stroke-dasharray="3 10"/>`;
  }

  function label(x, y, text, anchor) {
    return `<text class="city-label" x="${x}" y="${y}" text-anchor="${anchor || 'start'}" font-size="7.5" font-weight="500" letter-spacing="2.5">${text}</text>`;
  }

  function markup() {
    return `<g id="city-geometry" pointer-events="none" aria-hidden="true">
      <g id="city-streets">
        ${roads.map(road).join('\n        ')}
        <path class="city-roof" d="M177 445H316M177 450H316M455 574H665M752 572H942" fill="none" stroke-width=".6"/>
      </g>

      <g id="city-west">
        <rect class="city-roof" x="177" y="322" width="127" height="63" rx="4" fill="none" stroke-width=".6"/>
        ${building(189, 335, 44, 36, { flat: true })}
        ${building(248, 335, 44, 36, { flat: true })}
        <path class="city-roof" d="M237 340h7m-7 7h7m-7 7h7m-7 7h7M205 322v-12m68 12v-12M200 310h10m58 0h10" fill="none" stroke-width="1"/>
        ${label(177, 300, 'WEST SUBSTATION')}
        ${building(220, 478, 41, 44)}
        ${building(266, 478, 57, 44)}
        ${tree(180, 459, 5)}${tree(220, 459, 5)}${tree(306, 460, 5)}${tree(322, 460, 5)}
        ${label(180, 584, '01 / OLD TOWN')}
        <path class="city-roof" d="M338 329V366m-5-37v37M162 478v45m-4-45v45" fill="none" stroke-width=".65"/>
      </g>

      <g id="city-north-homes">
        ${label(464, 160, '02 / RESIDENTIAL NORTH')}
        ${building(463, 226, 50, 38)}
        ${building(580, 226, 49, 38)}
        ${building(646, 226, 48, 38)}
        ${building(609, 295, 43, 30)}
        <path class="city-roof" d="M463 281v33h31M532 226v19m8-19v19m8-19v19M664 283h29v40h-29" fill="none" stroke-width=".7"/>
        ${tree(478, 298, 7)}${tree(520, 308, 6)}${tree(676, 297, 6)}${tree(678, 315, 5)}
        <path class="city-roof" d="M470 181h31m-29 4h27M579 182h45m-43 4h41M644 180h47" fill="none" stroke-width=".65"/>
      </g>

      <g id="city-central-homes">
        ${building(463, 377, 82, 34)}
        ${building(463, 428, 82, 24, { flat: true })}
        ${building(581, 381, 36, 65)}
        ${building(638, 380, 31, 45)}
        ${tree(654, 442, 6)}${tree(568, 391, 5)}${tree(568, 408, 5)}${tree(568, 425, 5)}
        ${building(463, 494, 58, 36)}
        ${building(538, 494, 42, 36)}
        ${building(604, 494, 60, 36)}
        ${label(466, 596, '03 / COURTYARD')}
        <path class="city-roof" d="M463 463h72M472 417h64M528 501v23M588 501v23M681 493v33" fill="none" stroke-width=".6"/>
      </g>

      <g id="city-park">
        <path class="city-tree" d="M749 123Q749 113 760 113H919Q939 113 939 133V221Q939 238 922 238H765Q748 238 748 221Z" fill-opacity=".17" stroke-width=".75"/>
        <path class="city-roof" d="M763 220Q798 209 806 177T839 130M838 232Q871 216 888 188T925 157" fill="none" stroke-width="1.2"/>
        <path class="city-water" d="M766 140Q774 125 788 132Q802 139 796 151Q790 165 777 161Q762 160 766 140Z" stroke-width=".7"/>
        <path class="city-roof" d="M772 143q7-5 17-1m-13 7q6-3 12-1" fill="none" stroke-width=".55"/>
        ${tree(815, 128, 7)}${tree(832, 119, 5)}${tree(865, 121, 6)}${tree(895, 128, 8)}${tree(916, 140, 6)}
        ${tree(768, 187, 7)}${tree(783, 181, 5)}${tree(780, 214, 8)}${tree(823, 223, 6)}${tree(872, 223, 6)}
        ${tree(918, 191, 7)}${tree(905, 213, 8)}${tree(924, 223, 5)}
        <path class="city-roof" d="M814 191l-4 10m-3-1 4-10M882 145l10 4m-1 3-10-4" fill="none" stroke-width="1.8"/>
        ${label(852, 99, '04 / LIGHT PARK', 'middle')}
      </g>

      <g id="city-school">
        ${building(782, 286, 98, 36, { flat: true })}
        ${building(887, 286, 49, 36, { flat: true })}
        <path class="city-building" d="M786 286v-9h13v9m-7-9v-8" fill="none" stroke-width="1"/>
        <path class="city-roof" d="M795 296h67v14h-67ZM899 296h25v14h-25M786 333h150m-129-5v10m15-10v10m15-10v10m15-10v10m15-10v10m15-10v10m15-10v10m15-10v10" fill="none" stroke-width=".65"/>
        ${label(1000, 286, '05 / SCHOOL')}
        <rect class="city-roof" x="848" y="378" width="92" height="64" rx="3" fill="none" stroke-width=".8"/>
        <rect class="city-roof" x="855" y="385" width="78" height="50" rx="1" fill="none" stroke-width=".65"/>
        <path class="city-roof" d="M894 385v50M855 399h13v23h-13m78-23h-13v23h13" fill="none" stroke-width=".65"/>
        <circle class="city-roof" cx="894" cy="410" r="10" fill="none" stroke-width=".65"/>
        ${tree(1002, 389, 6)}${tree(1002, 408, 6)}${tree(1002, 427, 6)}
        <path class="city-roof" d="M1027 391v39m6-39v39" fill="none" stroke-width=".7"/>
      </g>

      <g id="city-east-homes">
        ${building(753, 379, 58, 41)}
        ${building(755, 506, 58, 27)}
        ${building(840, 483, 41, 50)}
        ${building(903, 483, 35, 50)}
        <path class="city-roof" d="M754 435h54M751 443h20m-20 4h20M752 489h21" fill="none" stroke-width=".65"/>
        ${tree(918, 450, 5)}${tree(933, 450, 5)}${tree(829, 508, 5)}${tree(829, 525, 5)}
        ${label(783, 624, '06 / RESIDENTIAL SOUTH')}
        ${building(997, 485, 41, 48)}
        ${tree(1004, 458, 7)}${tree(1025, 458, 6)}
      </g>
      <g class="city-roof" fill="none" stroke-width=".55" opacity=".6">
        <path d="M143 280v-9h9M1058 128h9v9M176 621v9h9M1058 621h9v-9"/>
        <path d="M336 578h45m-42-3v10m10-10v10m10-10v10m10-10v10"/>
      </g>
    </g>`;
  }

  const api = { markup: markup, roads: roads };
  root.BlackoutCity = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
