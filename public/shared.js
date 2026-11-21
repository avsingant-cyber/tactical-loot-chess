/* Tactical Loot Chess — общие правила (используются и сервером, и клиентом).
 * Сервер — единственный источник истины; клиент использует эти функции
 * только для подсветки доступных ходов и превью урона. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.TLC = api;
})(typeof window !== 'undefined' ? window : null, function () {
  'use strict';

  const N = 8;
  const TURN_SECONDS = 60;

  const UNIT_TYPES = {
    commander: { name: 'Командир', hp: 10, move: 2, dmg: 2, range: 2, minRange: 1,
      desc: 'Лидер отряда. Если Командир погибает — команда проигрывает.' },
    assault: { name: 'Штурмовик', hp: 6, move: 3, dmg: 2, range: 2, minRange: 1,
      desc: 'Крепкий боец передовой линии.' },
    sniper: { name: 'Снайпер', hp: 4, move: 2, dmg: 3, range: 4, minRange: 2,
      desc: 'Не стреляет вплотную (1 клетка). Не может двигаться и стрелять в один ход.' },
    scout: { name: 'Разведчик', hp: 5, move: 4, dmg: 1, range: 1, minRange: 1,
      desc: 'Самый быстрый юнит. Идеален для сбора ящиков с лутом.' },
  };

  // ---- Редкость лута
  const RARITIES = [
    { key: 'common', m: 'Обычный', f: 'Обычная', color: '#cbd5e1', weight: 55 },
    { key: 'rare', m: 'Редкий', f: 'Редкая', color: '#38bdf8', weight: 28 },
    { key: 'epic', m: 'Эпический', f: 'Эпическая', color: '#c084fc', weight: 12 },
    { key: 'legendary', m: 'Легендарный', f: 'Легендарная', color: '#f59e0b', weight: 4 },
    { key: 'mythic', m: 'Мифический', f: 'Мифическая', color: '#f43f5e', weight: 1 },
  ];
  const MAX_LUCK = 10;

  const ITEMS = {
    shotgun: { name: 'Дробовик', g: 'm', active: true, weight: 1 },
    shield: { name: 'Энергощит', g: 'm', active: false, weight: 1 },
    jetpack: { name: 'Джетпак', g: 'm', active: true, weight: 1 },
    medkit: { name: 'Нано-аптечка', g: 'f', active: false, instant: true, weight: 1 },
    landmine: { name: 'Мина', g: 'f', active: true, weight: 1 },
    luck: { name: 'Клевер удачи', g: 'm', active: false, instant: true, weight: 2 },
  };
  const ITEM_KEYS = Object.keys(ITEMS);

  // Характеристики предметов по уровню редкости (0 — Обычный … 4 — Мифический)
  const ITEM_STATS = {
    shotgun: { dmg: [4, 5, 6, 6, 8], splash: [2, 2, 2, 3, 4], charges: [1, 1, 1, 2, 2] },
    shield: { charges: [1, 2, 2, 3, 3], heal: [0, 0, 1, 1, 2] },
    jetpack: { range: [4, 5, 5, 6, 8], charges: [1, 1, 2, 2, 3] },
    medkit: { heal: [3, 4, 5, 7, 99], maxHp: [0, 0, 0, 1, 2] },
    landmine: { dmg: [3, 4, 5, 6, 7], charges: [1, 1, 2, 2, 3] },
    luck: { luck: [2, 3, 4, 6, 8], turns: [2, 3, 3, 4, 5] },
  };
  function itemStat(type, tier, stat) {
    const t = ITEM_STATS[type] && ITEM_STATS[type][stat];
    return t ? t[Math.max(0, Math.min(4, tier || 0))] : 0;
  }
  function rarityName(type, tier) {
    const r = RARITIES[tier || 0];
    return ITEMS[type].g === 'f' ? r.f : r.m;
  }
  function itemFullName(it) {
    return `${ITEMS[it.type].name} [${rarityName(it.type, it.tier)}]`;
  }
  function itemDesc(it) {
    const st = (k) => itemStat(it.type, it.tier, k);
    const ch = it.charges != null ? it.charges : st('charges');
    const z = (n) => `${n} ${n === 1 ? 'заряд' : n < 5 ? 'заряда' : 'зарядов'}`;
    switch (it.type) {
      case 'shotgun': return `${z(ch)}. Выстрел в упор (1–2 кл.): ${st('dmg')} урона цели, ${st('splash')} урона соседним клеткам и отталкивание. Тратит Действие.`;
      case 'shield': return `Пассивно. Полностью поглощает ${ch === 1 ? 'следующее попадание' : `следующие ${ch} попадания`}${st('heal') ? `; каждый блок лечит +${st('heal')} HP` : ''}.`;
      case 'jetpack': return `${z(ch)}. Прыжок на свободную клетку в радиусе ${st('range')} (сквозь стены и юнитов). Тратит Движение.`;
      case 'medkit': return `Мгновенно: ${st('heal') >= 99 ? 'полное лечение' : `+${st('heal')} HP`}${st('maxHp') ? `, +${st('maxHp')} к макс. HP` : ''}, снятие дебаффов.`;
      case 'landmine': return `${z(ch)}. Скрытая мина на соседнюю клетку: ${st('dmg')} урона врагу, остановка и контузия. Тратит Действие.`;
      case 'luck': return `Мгновенно: удача команды +${st('luck')} на ${st('turns')} ${st('turns') < 5 ? 'хода' : 'ходов'} (включая текущий). Удача повышает шанс редкого лута и двойного дропа. Пока клевер действует, новый клевер команде не выпадает.`;
      default: return '';
    }
  }

  // ---- Прогресс матча: чем дольше бой, тем больше лута
  function lootLevel(round) { return 1 + Math.min(4, Math.floor((round - 1) / 5)); }
  function cratesPerDrop(round) { return Math.min(4, 1 + lootLevel(round)); }
  function maxCrates(round) { return Math.min(7, 3 + lootLevel(round)); }
  function dropInterval(round) { return round >= 11 ? 1 : 2; }
  // Шансы редкости: удача команды и прогресс матча смещают вес к редким уровням
  function rarityWeights(luck, round) {
    const bonus = (luck || 0) * 0.3 + (lootLevel(round) - 1) * 0.15;
    return RARITIES.map((r, i) => r.weight * Math.pow(1 + bonus, i));
  }
  function rarityChances(luck, round) {
    const w = rarityWeights(luck, round);
    const tot = w.reduce((a, b) => a + b, 0);
    return w.map((x) => x / tot);
  }
  function doubleDropChance(luck, round) {
    return Math.min(0.45, 0.1 + (luck || 0) * 0.03 + (lootLevel(round) - 1) * 0.04);
  }

  const SHOTGUN = { minRange: 1, range: 2 };
  const MEDKIT_HEAL = 3;

  const DIR4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  const DIR8 = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];

  const key = (x, y) => y * N + x;
  const inBounds = (x, y) => x >= 0 && y >= 0 && x < N && y < N;
  const cheb = (a, b) => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
  const manh = (a, b) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
  const other = (s) => (s === 'blue' ? 'red' : 'blue');

  function isWall(g, x, y) {
    for (const w of g.walls) if (w.x === x && w.y === y) return true;
    return false;
  }
  function unitAt(g, x, y) {
    for (const u of g.units) if (u.alive && u.x === x && u.y === y) return u;
    return null;
  }
  function crateAt(g, x, y) {
    for (const c of g.crates) if (c.x === x && c.y === y) return c;
    return null;
  }

  // Алгоритм Брезенхэма: список клеток от (x0,y0) до (x1,y1) включительно
  function bresenham(x0, y0, x1, y1) {
    const pts = [];
    const dx = Math.abs(x1 - x0), sx = x0 < x1 ? 1 : -1;
    const dy = -Math.abs(y1 - y0), sy = y0 < y1 ? 1 : -1;
    let err = dx + dy;
    for (;;) {
      pts.push([x0, y0]);
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * err;
      if (e2 >= dy) { err += dy; x0 += sx; }
      if (e2 <= dx) { err += dx; y0 += sy; }
    }
    return pts;
  }
  function lineClear(g, pts) {
    for (let i = 1; i < pts.length - 1; i++) if (isWall(g, pts[i][0], pts[i][1])) return false;
    return true;
  }
  // Симметричная проверка линии видимости (стены блокируют, юниты — нет)
  function hasLOS(g, a, b) {
    return lineClear(g, bresenham(a.x, a.y, b.x, b.y)) || lineClear(g, bresenham(b.x, b.y, a.x, a.y));
  }

  // ---- Правила хода: до 2 разных юнитов за ход, у каждого 1 Движение + 1 Действие
  function canUseUnit(g, u) {
    return g.activated.includes(u.id) || g.activated.length < 2;
  }
  function canMove(g, u) {
    return !!u && u.alive && u.side === g.turn && !u.moved &&
      !(u.type === 'sniper' && u.attacked) && canUseUnit(g, u);
  }
  function canAct(g, u) {
    return !!u && u.alive && u.side === g.turn && !u.acted && canUseUnit(g, u);
  }
  function canShoot(g, u) {
    return canAct(g, u) && !(u.type === 'sniper' && u.moved);
  }
  function moveRange(u) {
    return Math.max(1, UNIT_TYPES[u.type].move - (u.slowed ? 1 : 0));
  }

  // BFS по 4 направлениям. Возвращает Map(key -> prevKey)
  function reachable(g, u) {
    const range = moveRange(u);
    const start = key(u.x, u.y);
    const dist = new Map([[start, 0]]);
    const prev = new Map([[start, -1]]);
    const q = [[u.x, u.y]];
    while (q.length) {
      const [x, y] = q.shift();
      const d = dist.get(key(x, y));
      if (d >= range) continue;
      for (const [dx, dy] of DIR4) {
        const nx = x + dx, ny = y + dy;
        if (!inBounds(nx, ny)) continue;
        const k = key(nx, ny);
        if (dist.has(k) || isWall(g, nx, ny) || unitAt(g, nx, ny)) continue;
        dist.set(k, d + 1);
        prev.set(k, key(x, y));
        q.push([nx, ny]);
      }
    }
    return prev;
  }
  function pathTo(prev, x, y) {
    let k = key(x, y);
    if (!prev.has(k)) return null;
    const p = [];
    while (k !== -1) { p.push([k % N, Math.floor(k / N)]); k = prev.get(k); }
    return p.reverse();
  }

  function attackInfo(g, u, t, mode) {
    if (!u || !t || !t.alive) return { ok: false, reason: 'Нет цели' };
    if (t.side === u.side) return { ok: false, reason: 'Это союзник' };
    if (!canAct(g, u)) return { ok: false, reason: 'Действие уже потрачено' };
    if (u.type === 'sniper' && u.moved) return { ok: false, reason: 'Снайпер уже двигался' };
    let min, max, dmg;
    if (mode === 'shotgun') {
      if (!u.item || u.item.type !== 'shotgun') return { ok: false, reason: 'Нет дробовика' };
      min = SHOTGUN.minRange; max = SHOTGUN.range; dmg = itemStat('shotgun', u.item.tier, 'dmg');
    } else {
      const T = UNIT_TYPES[u.type];
      min = T.minRange; max = T.range; dmg = T.dmg;
    }
    const d = cheb(u, t);
    if (d < min) return { ok: false, reason: 'Слишком близко' };
    if (d > max) return { ok: false, reason: 'Вне дальности' };
    if (!hasLOS(g, u, t)) return { ok: false, reason: 'Нет линии огня' };
    return { ok: true, dmg };
  }
  function targets(g, u, mode) {
    return g.units.filter((t) => t.alive && t.side !== u.side && attackInfo(g, u, t, mode).ok);
  }
  function jetpackCells(g, u) {
    const out = [];
    const range = u.item && u.item.type === 'jetpack' ? itemStat('jetpack', u.item.tier, 'range') : 4;
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const d = manh(u, { x, y });
      if (d === 0 || d > range) continue;
      if (isWall(g, x, y) || unitAt(g, x, y)) continue;
      out.push({ x, y });
    }
    return out;
  }
  // Клетки для установки мины (видимые мины своей стороны блокируют клетку)
  function mineCells(g, u) {
    const out = [];
    for (const [dx, dy] of DIR8) {
      const x = u.x + dx, y = u.y + dy;
      if (!inBounds(x, y) || isWall(g, x, y) || unitAt(g, x, y) || crateAt(g, x, y)) continue;
      if (g.mines.some((m) => m.x === x && m.y === y && m.side === u.side)) continue;
      out.push({ x, y });
    }
    return out;
  }
  function hasUsefulMove(g, u) {
    if (!canMove(g, u)) return false;
    if (u.item && u.item.type === 'jetpack' && jetpackCells(g, u).length) return true;
    return reachable(g, u).size > 1;
  }
  function hasUsefulAct(g, u) {
    if (!canAct(g, u)) return false;
    if (u.item && u.item.type === 'landmine' && mineCells(g, u).length) return true;
    if (!canShoot(g, u)) return false;
    if (targets(g, u, 'normal').length) return true;
    if (u.item && u.item.type === 'shotgun' && targets(g, u, 'shotgun').length) return true;
    return false;
  }
  // Ход завершается автоматически, если ни один доступный юнит не может сделать ничего полезного
  function shouldAutoEnd(g) {
    const own = g.units.filter((u) => u.alive && u.side === g.turn);
    const cands = g.activated.length >= 2 ? own.filter((u) => g.activated.includes(u.id)) : own;
    return cands.every((u) => !hasUsefulMove(g, u) && !hasUsefulAct(g, u));
  }

  return {
    N, TURN_SECONDS, UNIT_TYPES, ITEMS, ITEM_KEYS, SHOTGUN, MEDKIT_HEAL,
    RARITIES, MAX_LUCK, ITEM_STATS, itemStat, rarityName, itemFullName, itemDesc,
    lootLevel, cratesPerDrop, maxCrates, dropInterval, rarityWeights, rarityChances, doubleDropChance,
    DIR4, DIR8, key, inBounds, cheb, manh, other, isWall, unitAt, crateAt, bresenham, hasLOS,
    canUseUnit, canMove, canAct, canShoot, moveRange, reachable, pathTo, attackInfo, targets,
    jetpackCells, mineCells, hasUsefulMove, hasUsefulAct, shouldAutoEnd,
  };
});
