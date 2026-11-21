/* Процедурные пиксельные спрайты 16x16.
 * Каждый символ матрицы — индекс палитры, '.' — прозрачность.
 * T / t / L — основной / тёмный / светлый цвет команды (перекраска Синие/Красные).
 * Все спрайты «запекаются» в offscreen-канвасы один раз при старте. */
const Sprites = (() => {
  'use strict';

  const PAL = {
    k: '#111111', // контрастная обводка
    w: '#f8fafc', p: '#d1d5db', g: '#9ca3af', m: '#6b7280', G: '#4b5563', d: '#374151',
    s: '#f1c27d', S: '#c68642',
    y: '#facc15', Y: '#a16207', o: '#f97316', r: '#dc2626', R: '#7f1d1d',
    b: '#a0652a', B: '#6b3f17',
    v: '#67e8f9', V: '#0891b2', c: '#22d3ee', C: '#0e7490', e: '#4ade80', E: '#15803d', n: '#bbf7d0',
    f: '#1a2130', F: '#1f2838', h: '#2a3447', q: '#10151f', x: '#3a4760',
  };
  const TEAMS = {
    blue: { T: '#3b82f6', t: '#1d4ed8', L: '#93c5fd' },
    red: { T: '#ef4444', t: '#b91c1c', L: '#fca5a5' },
    neutral: { T: '#9ca3af', t: '#4b5563', L: '#e5e7eb' },
  };

  const DATA = {
    commander: [
      '......kkkk......',
      '.....kyyyyk.....',
      '....kkyTTykk....',
      '...kTTTTTTTTk...',
      '...kTLLLLLLTk...',
      '...kkkkkkkkkk...',
      '....kvvvvwvk....',
      '....kssssssk....',
      '....kkssssk.....',
      '..kkTTkkkkTTkk..',
      '.ktTTyTTTTyTTtk.',
      '.ktTTTTyyTTTTtk.',
      '.kskkTTTTTTkksk.',
      '..k.ktTTTTtk.k..',
      '....kGGkkGGk....',
      '....kkkk.kkkk...',
    ],
    assault: [
      '................',
      '.....kkkkkk.....',
      '....kTTTTTTk....',
      '...kTLLTTTTTk...',
      '...kTTTTTTTTk...',
      '...kkkkkkkkkk...',
      '....kvvvvvvk....',
      '....kssssssk....',
      '.....kssssk.....',
      '...kkTTTTTTkk...',
      '..kTTtTTTTtTTk..',
      '..kTkkkkkkkkkkkk',
      '..kskggggggggGGk',
      '...kkkkkkkkkkkk.',
      '....kGGk.kGGk...',
      '....kkkk.kkkk...',
    ],
    sniper: [
      '................',
      '......kkkkk.....',
      '.....kTTTTTk....',
      '....kTLTTTTTk...',
      '....kTkkkkkTk...',
      '....kkvVkvVkk...',
      '....kssssssk....',
      '....ktTTTTtk....',
      '...ktTTTTTTtk...',
      '...kTTkTTkTTk...',
      '..kkkkkkkkkkkkk.',
      '.kGgggggggggggVk',
      '..kkskkkkkkkkkk.',
      '....kTTTTTTk....',
      '....kGGkkGGk....',
      '....kkkkkkkk....',
    ],
    scout: [
      '................',
      '................',
      '.....kkkkkk.....',
      '....kTTTTTTkkk..',
      '....kTLLTTTTTTk.',
      '....kkkkkkkkkk..',
      '....kssvvsvvk...',
      '....kssssssk....',
      '.....kssssk.....',
      '....kTTyyTTk....',
      '...kTTTTTTTTk...',
      '..kskTTTTTTksk..',
      '..kk.kTTTTk.kgk.',
      '.....kTkkTk.....',
      '....kGGk.kGGk...',
      '....kkk...kkk...',
    ],
    wall: [
      'kkkkkkkkkkkkkkkk',
      'kpppppppppppppgk',
      'kpwggggggggggwmk',
      'kpggggggggggggmk',
      'kpggggggggggggmk',
      'kkkkkkkkkkkkkkkk',
      'kykkyykkyykkyykk',
      'kyykkyykkyykkyyk',
      'kkyykkyykkyykkyk',
      'kkkkkkkkkkkkkkkk',
      'kpggggggggggggmk',
      'kpggggggggggggmk',
      'kpwggggggggggwmk',
      'kgmmmmmmmmmmmmmk',
      'kmmmmmmmmmmmmmmk',
      'kkkkkkkkkkkkkkkk',
    ],
    crate: [
      '................',
      '.kkkkkkkkkkkkkk.',
      '.kyyyyyyyyyyyyk.',
      '.kbbbbbbbbbbbbk.',
      '.kbBBBBBBBBBBbk.',
      '.kbBbbbyybbbBbk.',
      '.kbBbbybbybbBbk.',
      '.kbBbbbbbybbBbk.',
      '.kbBbbbbybbbBbk.',
      '.kbBbbbbbbbbBbk.',
      '.kbBbbbbybbbBbk.',
      '.kbBBBBBBBBBBbk.',
      '.kbbbbbbbbbbbbk.',
      '.kyyyyyyyyyyyyk.',
      '.kkkkkkkkkkkkkk.',
      '................',
    ],
    floorA: [
      'hhhhhhhhhhhhhhhq',
      'hFFFFFFFFFFFFFFq',
      'hFxFFFFFFFFFFxFq',
      'hFFFFFFFFFFFFFFq',
      'hFFFFFFFFFFFFFFq',
      'hFFFFFFfFFFFFFFq',
      'hFFFFFFFFFFFFFFq',
      'hFFFFFFFFFFFFFFq',
      'hFFFFFFFFFFFFFFq',
      'hFFFFFFFFFfFFFFq',
      'hFFFFFFFFFFFFFFq',
      'hFFFFFFFFFFFFFFq',
      'hFFFFFFFFFFFFFFq',
      'hFxFFFFFFFFFFxFq',
      'hFFFFFFFFFFFFFFq',
      'qqqqqqqqqqqqqqqq',
    ],
    floorB: [
      'hhhhhhhhhhhhhhhq',
      'hffffffffffffffq',
      'hfxffffffffffxfq',
      'hffffffffffffffq',
      'hffffFfffffffffq',
      'hffffffffffffffq',
      'hffffffffffFfffq',
      'hffffffffffffffq',
      'hffffffffffffffq',
      'hfffFffffffffffq',
      'hffffffffffffffq',
      'hffffffffFfffffq',
      'hffffffffffffffq',
      'hfxffffffffffxfq',
      'hffffffffffffffq',
      'qqqqqqqqqqqqqqqq',
    ],
    shieldfx: [
      '.....cccccc.....',
      '...cc......cc...',
      '..c..........c..',
      '.c............c.',
      '.c............c.',
      'c..............c',
      'c..............c',
      'c..............c',
      'c..............c',
      'c..............c',
      'c..............c',
      '.c............c.',
      '.c............c.',
      '..c..........c..',
      '...cc......cc...',
      '.....cccccc.....',
    ],
    boom1: [
      '................',
      '................',
      '................',
      '................',
      '......kkkk......',
      '.....kyyyyk.....',
      '....kyywwyyk....',
      '....kywwwwyk....',
      '....kywwwwyk....',
      '....kyywwyyk....',
      '.....kyyyyk.....',
      '......kkkk......',
      '................',
      '................',
      '................',
      '................',
    ],
    boom2: [
      '................',
      '......kkkk......',
      '....kkooookk....',
      '...kooyyyyook...',
      '..kooyyyyyyook..',
      '..koyywwwwyyok..',
      '.kooywwwwwwyook.',
      '.koyywwwwwwyyok.',
      '.koyywwwwwwyyok.',
      '.kooywwwwwwyook.',
      '..koyywwwwyyok..',
      '..kooyyyyyyook..',
      '...kooyyyyook...',
      '....kkooookk....',
      '......kkkk......',
      '................',
    ],
    boom3: [
      '....kk....kk....',
      '...kGGk..kGGk...',
      '..kGmmGkkGmmGk..',
      '.kGmoomGGmoomGk.',
      '.kGmo..mm..omGk.',
      '..kGm......mGk..',
      '..kGm......mGk..',
      '.kGmo......omGk.',
      '.kGmo......omGk.',
      '..kGm......mGk..',
      '..kGm......mGk..',
      '.kGmo..mm..omGk.',
      '.kGmoomGGmoomGk.',
      '..kGmmGkkGmmGk..',
      '...kGGk..kGGk...',
      '....kk....kk....',
    ],
    i_shotgun: [
      '................',
      '................',
      '................',
      '................',
      'kkkkkkkkkkk.....',
      'kgggggggggGkkk..',
      'kkkkkkkkkkGGBBk.',
      'kgggggggggGGBBBk',
      'kkkkkkkkkkkkkBBk',
      '......kGk...kBBk',
      '......kkk....kkk',
      '................',
      '................',
      '................',
      '................',
      '................',
    ],
    i_shield: [
      '................',
      '..kkkkkkkkkkkk..',
      '..kwccccccccCk..',
      '..kccccccccCCk..',
      '..kccccwwccCCk..',
      '..kcccwwwwcCCk..',
      '..kccccwwccCCk..',
      '..kccccwwccCCk..',
      '...kcccccccCk...',
      '...kcccccccCk...',
      '....kcccccCk....',
      '.....kcccCk.....',
      '......kcCk......',
      '.......kk.......',
      '................',
      '................',
    ],
    i_jetpack: [
      '................',
      '...kkkk..kkkk...',
      '..kggGGkkggGGk..',
      '..kgwGGkkgwGGk..',
      '..kggGGkkggGGk..',
      '..kggGGkkggGGk..',
      '..kyyyykkyyyyk..',
      '..kggGGkkggGGk..',
      '..kkkkkkkkkkkk..',
      '...kGGk..kGGk...',
      '...kkkk..kkkk...',
      '...oyyo..oyyo...',
      '....oo....oo....',
      '....r......r....',
      '................',
      '................',
    ],
    i_medkit: [
      '................',
      '................',
      '......kkkk......',
      '.....kk..kk.....',
      '.kkkkkkkkkkkkkk.',
      '.kwwwwwwwwwwwwk.',
      '.kwwwwwrrwwwwpk.',
      '.kwwwwwrrwwwwpk.',
      '.kwwwrrrrrrwwpk.',
      '.kwwwrrrrrrwwpk.',
      '.kwwwwwrrwwwwpk.',
      '.kwwwwwrrwwwwpk.',
      '.kppppppppppppk.',
      '.kkkkkkkkkkkkkk.',
      '................',
      '................',
    ],
    i_luck: [
      '................',
      '....kkk..kkk....',
      '...keeek.keeek..',
      '..kenneekeenek..',
      '..keneeekeeeek..',
      '..keeeeEkEeeek..',
      '...kkeeEEEeekk..',
      '..kkeeEEyEEeekk.',
      '.keneeeEEEeeeek.',
      '.keneeekEkeeeek.',
      '.keeeeEk.kEeeek.',
      '..kkkkk.k.kkkk..',
      '.......kEk......',
      '........kEk.....',
      '.........kk.....',
      '................',
    ],
    i_landmine: [
      '................',
      '................',
      '................',
      '.......kk.......',
      '......krrk......',
      '.......kk.......',
      '....kkkkkkkk....',
      '...kGGGGGGGGk...',
      '..kGggggggggGk..',
      '..kGgkgkgkggGk..',
      '..kGGGGGGGGGGk..',
      '...kkkkkkkkkk...',
      '................',
      '................',
      '................',
      '................',
    ],
  };

  const UNIT_TYPES = ['commander', 'assault', 'sniper', 'scout'];
  const cache = new Map();

  // Нормализация: каждая строка ровно 16 символов (защита от опечаток в матрицах)
  function norm(rows, name) {
    const out = [];
    for (let y = 0; y < 16; y++) {
      let r = rows[y] || '';
      if (r.length !== 16 && window.console) console.warn(`[sprites] ${name}: строка ${y} длиной ${r.length}`);
      r = (r + '................').slice(0, 16);
      out.push(r);
    }
    return out;
  }

  function bake(rows, team, mode) {
    const c = document.createElement('canvas');
    c.width = 16; c.height = 16;
    const x = c.getContext('2d');
    const tp = TEAMS[team] || TEAMS.neutral;
    for (let py = 0; py < 16; py++) {
      for (let px = 0; px < 16; px++) {
        const ch = rows[py][px];
        if (ch === '.') continue;
        let col = tp[ch] || PAL[ch] || '#ff00ff';
        if (mode === 'flash') col = ch === 'k' ? '#ffffff' : '#ffffff';
        if (mode === 'ghost') col = ch === 'k' ? '#0b1220' : col;
        x.fillStyle = col;
        x.fillRect(px, py, 1, 1);
      }
    }
    return c;
  }

  function init() {
    for (const [name, raw] of Object.entries(DATA)) {
      const rows = norm(raw, name);
      const teams = UNIT_TYPES.includes(name) ? ['blue', 'red', 'neutral'] : ['neutral'];
      for (const t of teams) {
        cache.set(`${name}|${t}|`, bake(rows, t, ''));
        cache.set(`${name}|${t}|flash`, bake(rows, t, 'flash'));
      }
    }
  }

  function get(name, team, mode) {
    const t = UNIT_TYPES.includes(name) ? (team || 'neutral') : 'neutral';
    return cache.get(`${name}|${t}|${mode || ''}`);
  }
  const icon = (item) => get('i_' + item);

  return { init, get, icon, DATA, UNIT_TYPES, TEAMS };
})();
