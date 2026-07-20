// Quacker skins — every duck is the same little soul in a different outfit.
// A skin is palette overrides + accessory pixels layered over the shared
// 14x13 body. Used by the onboarding picker (previews) and pet.js (live duck).
//
// Accessory pixel entries: { shift: bool, px: [[col, row, color], ...] }
//   shift:true  → moves with the face (hats, masks, eyewear)
//   shift:false → fixed to the body (capes, patches)
// Rows may be negative (above the head).

(() => {
  const SKINS = {
    classic: {
      name: 'Classic',
      tagline: 'the original egg-duck',
      colors: {},
      accessories: [],
    },
    ninja: {
      name: 'Ninja',
      tagline: 'silent. deadly. waddles.',
      colors: { C: '#4d4d59', O: '#37373f', K: '#5a5a66' },
      accessories: [
        {
          shift: true,
          px: [
            [2, 3, '#c0392b'], [3, 3, '#c0392b'], [4, 3, '#c0392b'], [5, 3, '#c0392b'],
            [6, 3, '#c0392b'], [7, 3, '#c0392b'], [8, 3, '#c0392b'], [9, 3, '#c0392b'],
            [10, 3, '#c0392b'], [11, 3, '#c0392b'],
            [12, 4, '#a93226'], [13, 5, '#a93226'], [12, 6, '#a93226'],
          ],
        },
      ],
    },
    princess: {
      name: 'Princess',
      tagline: 'royalty, technically',
      colors: { C: '#ffddee', O: '#e8a8c8', K: '#ff9db3' },
      accessories: [
        {
          shift: true,
          px: [
            [4, -2, '#f5c542'], [7, -2, '#f5c542'], [10, -2, '#f5c542'],
            [4, -1, '#f5c542'], [5, -1, '#f5c542'], [6, -1, '#f5c542'], [7, -1, '#f5c542'],
            [8, -1, '#f5c542'], [9, -1, '#f5c542'], [10, -1, '#f5c542'],
            [7, -1, '#ff6b81'],
          ],
        },
      ],
    },
    wizard: {
      name: 'Wizard',
      tagline: 'knows exactly one spell',
      colors: { C: '#c3b1e6', O: '#977fc4', K: '#d9a8e8' },
      accessories: [
        {
          shift: true,
          px: [
            [7, -4, '#5e35b1'],
            [6, -3, '#5e35b1'], [7, -3, '#5e35b1'], [8, -3, '#5e35b1'],
            [5, -2, '#5e35b1'], [6, -2, '#5e35b1'], [7, -2, '#5e35b1'], [8, -2, '#5e35b1'], [9, -2, '#5e35b1'],
            [4, -1, '#5e35b1'], [5, -1, '#5e35b1'], [6, -1, '#5e35b1'], [7, -1, '#5e35b1'],
            [8, -1, '#5e35b1'], [9, -1, '#5e35b1'], [10, -1, '#5e35b1'],
            [3, 0, '#7e57c2'], [11, 0, '#7e57c2'],
            [7, -3, '#ffd66e'],
          ],
        },
      ],
    },
    pirate: {
      name: 'Pirate',
      tagline: 'yarr. quack. yarr.',
      colors: {},
      accessories: [
        {
          shift: true,
          px: [
            [5, 0, '#8e2f2f'], [6, 0, '#8e2f2f'], [7, 0, '#8e2f2f'], [8, 0, '#8e2f2f'], [9, 0, '#8e2f2f'], [10, 0, '#8e2f2f'],
            [3, 1, '#8e2f2f'], [4, 1, '#8e2f2f'], [5, 1, '#8e2f2f'], [6, 1, '#8e2f2f'], [7, 1, '#8e2f2f'],
            [8, 1, '#8e2f2f'], [9, 1, '#8e2f2f'], [10, 1, '#8e2f2f'],
            [11, 1, '#a93b3b'], [12, 2, '#a93b3b'],
            [2, 3, '#33302e'], [3, 3, '#33302e'], [4, 3, '#33302e'], [5, 3, '#33302e'], [6, 3, '#33302e'],
            [7, 3, '#33302e'], [8, 3, '#33302e'], [11, 3, '#33302e'],
            [9, 3, '#33302e'], [10, 3, '#33302e'],
            [9, 4, '#33302e'], [10, 4, '#33302e'], [9, 5, '#33302e'], [10, 5, '#33302e'],
          ],
        },
      ],
    },
    astronaut: {
      name: 'Astronaut',
      tagline: 'one small waddle for duck',
      colors: { C: '#f4f6f8', O: '#c2cdd6', K: '#dfe7ee' },
      accessories: [
        {
          shift: true,
          px: [
            [7, -3, '#e05a4e'],
            [7, -2, '#9fb3c8'], [7, -1, '#9fb3c8'],
            [2, 2, '#9fb3c8'], [3, 2, '#9fb3c8'], [10, 2, '#9fb3c8'], [11, 2, '#9fb3c8'],
          ],
        },
        {
          shift: false,
          px: [[3, 9, '#4a7fd4'], [4, 9, '#4a7fd4']],
        },
      ],
    },
    robot: {
      name: 'Robot',
      tagline: 'beep boop (affectionate)',
      colors: { C: '#aebdc8', O: '#7f939f', K: '#95a8b5', B: '#f7b32d', b: '#d99a14' },
      accessories: [
        {
          shift: true,
          px: [
            [7, -3, '#e05a4e'], [7, -2, '#7f939f'], [7, -1, '#7f939f'],
          ],
        },
        {
          shift: false,
          px: [[2, 6, '#5d6f7a'], [11, 6, '#5d6f7a'], [3, 10, '#95a8b5'], [10, 10, '#95a8b5']],
        },
      ],
    },
    cowboy: {
      name: 'Cowboy',
      tagline: 'this dock ain’t big enough',
      colors: {},
      accessories: [
        {
          shift: true,
          px: [
            [5, -2, '#8d6e63'], [6, -2, '#8d6e63'], [7, -2, '#8d6e63'], [8, -2, '#8d6e63'], [9, -2, '#8d6e63'],
            [5, -1, '#8d6e63'], [6, -1, '#6d4c41'], [7, -1, '#6d4c41'], [8, -1, '#6d4c41'], [9, -1, '#8d6e63'],
            [2, 0, '#795548'], [3, 0, '#795548'], [4, 0, '#795548'], [5, 0, '#795548'], [6, 0, '#795548'],
            [7, 0, '#795548'], [8, 0, '#795548'], [9, 0, '#795548'], [10, 0, '#795548'], [11, 0, '#795548'], [12, 0, '#795548'],
          ],
        },
      ],
    },
    vampire: {
      name: 'Vampire',
      tagline: 'only sips juice boxes',
      colors: { C: '#efe6f5', O: '#c5b2d6', K: '#d9a8c8' },
      accessories: [
        {
          shift: true,
          px: [
            [6, 0, '#2b2333'], [7, 0, '#2b2333'], [8, 0, '#2b2333'], [7, 1, '#2b2333'],
            [6, 8, '#ffffff'],
          ],
        },
        {
          shift: false,
          px: [
            [1, 6, '#2b2333'], [2, 6, '#2b2333'], [11, 6, '#2b2333'], [12, 6, '#2b2333'],
            [1, 7, '#443655'], [12, 7, '#443655'],
          ],
        },
      ],
    },
    detective: {
      name: 'Detective',
      tagline: 'the crumb was an inside job',
      colors: {},
      accessories: [
        {
          shift: true,
          px: [
            [4, -1, '#a1887f'], [5, -1, '#a1887f'], [6, -1, '#a1887f'], [7, -1, '#a1887f'],
            [8, -1, '#a1887f'], [9, -1, '#a1887f'], [10, -1, '#a1887f'],
            [3, 0, '#8d6e63'], [4, 0, '#8d6e63'], [5, 0, '#8d6e63'], [6, 0, '#8d6e63'], [7, 0, '#8d6e63'],
            [8, 0, '#8d6e63'], [9, 0, '#8d6e63'], [10, 0, '#8d6e63'], [11, 0, '#8d6e63'],
            [8, 3, '#f5c542'], [11, 3, '#f5c542'], [8, 6, '#f5c542'], [11, 6, '#f5c542'],
            [9, 6, '#f5c542'], [10, 6, '#f5c542'], [12, 7, '#f5c542'],
          ],
        },
      ],
    },
    chef: {
      name: 'Chef',
      tagline: 'crumb sommelier',
      colors: {},
      accessories: [
        {
          shift: true,
          px: [
            [5, -3, '#ffffff'], [6, -3, '#ffffff'], [7, -3, '#ffffff'], [8, -3, '#ffffff'], [9, -3, '#ffffff'],
            [4, -2, '#ffffff'], [5, -2, '#ffffff'], [6, -2, '#ffffff'], [7, -2, '#ffffff'],
            [8, -2, '#ffffff'], [9, -2, '#ffffff'], [10, -2, '#ffffff'],
            [5, -1, '#ffffff'], [6, -1, '#ffffff'], [7, -1, '#ffffff'], [8, -1, '#ffffff'], [9, -1, '#ffffff'],
            [5, 0, '#e3e3e3'], [6, 0, '#e3e3e3'], [7, 0, '#e3e3e3'], [8, 0, '#e3e3e3'], [9, 0, '#e3e3e3'],
          ],
        },
      ],
    },
  };

  const SKIN_ORDER = [
    'classic', 'ninja', 'princess', 'wizard', 'pirate', 'astronaut',
    'robot', 'cowboy', 'vampire', 'detective', 'chef',
  ];

  // Shared body art (must match pet.js). 14x13, '.' = transparent.
  const BODY_ROWS = [
    '.....OCCCCO...',
    '...OCCCCCCCO..',
    '..OCCCCCCCCCO.',
    '..OCCCCCCCCCO.',
    '.OCCCCCCCCCCO.',
    '.OCCCCCCCCCCO.',
    '.OCCCCCCCCCCO.',
    '.OCCCCCCCCCCO.',
    '.OCCCCCCCCCCO.',
    '.OCCCCCCCCCCO.',
    '..OCCCCCCCCO..',
    '..OCCCCCCCCO..',
    '...OCCCCCCO...',
  ];
  const BASE_COLORS = {
    C: '#fff4da', O: '#e8d5ac', E: '#33302e',
    B: '#f79e2d', b: '#d97f14', K: '#ffc9c4', F: '#e8891a',
  };

  // Static full-duck preview for the onboarding picker (eyes open, centered).
  function drawSkinPreview(ctx, skinId, PXS, ox, oy) {
    const skin = SKINS[skinId] || SKINS.classic;
    const colors = { ...BASE_COLORS, ...skin.colors };
    const put = (c, r, color) => {
      ctx.fillStyle = color;
      ctx.fillRect(ox + c * PXS, oy + r * PXS, PXS + 0.5, PXS + 0.5);
    };
    for (let r = 0; r < BODY_ROWS.length; r++) {
      for (let c = 0; c < 14; c++) {
        const ch = BODY_ROWS[r][c];
        if (ch !== '.' && colors[ch]) put(c, r, colors[ch]);
      }
    }
    for (const [c, r] of [[3, 4], [4, 4], [3, 5], [4, 5], [9, 4], [10, 4], [9, 5], [10, 5]]) put(c, r, colors.E);
    for (const [c, r] of [[5, 6], [6, 6], [7, 6], [8, 6]]) put(c, r, colors.B);
    for (const [c, r] of [[6, 7], [7, 7]]) put(c, r, colors.b);
    for (const [c, r] of [[2, 8], [3, 8], [10, 8], [11, 8]]) put(c, r, colors.K);
    for (const c of [3, 4, 5, 8, 9, 10]) put(c, 13, colors.F);
    for (const layer of skin.accessories) {
      for (const [c, r, color] of layer.px) put(c, r, color);
    }
  }

  window.QUACKERS_SKINS = { SKINS, SKIN_ORDER, drawSkinPreview };
})();
