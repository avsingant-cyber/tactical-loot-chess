/* Tactical Loot Chess — клиент: сеть, рендер на Canvas, анимации, UI. */
(() => {
  'use strict';
  const R = window.TLC;
  const N = R.N;
  const $ = (id) => document.getElementById(id);
  const SIDE_GEN = { blue: 'СИНИХ', red: 'КРАСНЫХ' };
  const SIDE_RU = { blue: 'Синие', red: 'Красные' };
  const TEAM_COL = { blue: '#60a5fa', red: '#f87171' };

  Sprites.init();
  const socket = io();

  // ------------------------------------------------------------ идентичность (sessionStorage — переживает F5, своя у каждой вкладки)
  function rid() {
    if (window.crypto && crypto.getRandomValues) {
      const a = new Uint8Array(16);
      crypto.getRandomValues(a);
      return Array.from(a, (b) => b.toString(16).padStart(2, '0')).join('');
    }
    return Math.random().toString(36).slice(2) + Date.now().toString(36);
  }
  const store = {
    get(s, k) { try { return s.getItem(k); } catch (e) { return null; } },
    set(s, k, v) { try { s.setItem(k, v); } catch (e) { /* ignore */ } },
  };
  let token = store.get(sessionStorage, 'tlc_token');
  if (!token) { token = rid(); store.set(sessionStorage, 'tlc_token', token); }
  // ---- комната: код берётся из ссылки ?room=КОД, без кода — общая комната MAIN
  const cleanCode = (c) => String(c || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
  let roomCode = cleanCode(new URLSearchParams(location.search).get('room')) || 'MAIN';
  function joinRoom() { socket.emit('join', { token, name: myName, room: roomCode }); }
  function switchRoom(code) {
    roomCode = cleanCode(code) || 'MAIN';
    const url = new URL(location.href);
    if (roomCode === 'MAIN') url.searchParams.delete('room'); else url.searchParams.set('room', roomCode);
    history.replaceState(null, '', url);
    resetClientGame();
    joinRoom();
  }
  const isLocalHost = () => /^(localhost|127\.|\[::1\])/.test(location.hostname);
  function shareLinks() {
    const q = roomCode === 'MAIN' ? '' : `/?room=${roomCode}`;
    // при запуске на своём компьютере — LAN-адреса, на публичном сервере — адрес сайта
    if (isLocalHost() && lobby && lobby.urls && lobby.urls.length) return lobby.urls.map((u) => u + q);
    return [location.origin + q];
  }
  let myName = store.get(localStorage, 'tlc_name') || ('Боец-' + Math.floor(1000 + Math.random() * 9000));

  // ------------------------------------------------------------ состояние клиента
  let lobby = null;
  let state = null;   // последнее авторитетное состояние
  let view = null;    // отображаемое (догоняет state через анимации событий)
  let gameId = null;
  let selectedId = null;
  let mode = 'normal'; // normal | shotgun | jetpack | mine
  let hover = null;
  let animating = false;
  let pending = false;
  let pendingTimer = null;
  const queue = [];
  let deadline = 0;
  let lastTickSec = -1;
  let overShownFor = null;
  let overHidden = false;
  let renderedLogKey = '';
  let flipped = false;

  // эффекты
  const anims = new Map();
  const flashes = new Map();
  const crateDrops = new Map();
  const projectiles = [];
  const booms = [];
  const particles = [];
  const floats = [];
  let shake = 0;

  // ------------------------------------------------------------ Canvas / HiDPI
  const canvas = $('board');
  const ctx = canvas.getContext('2d');
  let S = 4, C = 64, dpr = 1;

  function resize() {
    const wrap = $('boardWrap');
    const r = wrap.getBoundingClientRect();
    if (r.width < 10 || r.height < 10) return;
    const mb = $('movesBox');
    const reserve = mb ? mb.offsetHeight + 10 : 0;
    const avail = Math.max(128, Math.min(r.width, r.height - reserve) - 12);
    dpr = window.devicePixelRatio || 1;
    // целочисленный масштаб пикселя спрайта в физических пикселях → идеально резкие пиксели
    S = Math.max(1, Math.floor((avail * dpr) / (N * 16)));
    C = S * 16;
    const size = C * N;
    if (canvas.width !== size) { canvas.width = size; canvas.height = size; }
    canvas.style.width = size / dpr + 'px';
    canvas.style.height = size / dpr + 'px';
    if (mb) mb.style.width = size / dpr + 'px';
    ctx.imageSmoothingEnabled = false;
  }
  if (window.ResizeObserver) new ResizeObserver(resize).observe($('boardWrap'));
  window.addEventListener('resize', resize);

  const fx = (v) => (flipped ? N - 1 - v : v); // разворот доски для Красных (свои внизу)
  const snap = (v) => Math.round(v / S) * S;

  // ------------------------------------------------------------ утилиты
  const clone = (o) => JSON.parse(JSON.stringify(o));
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const nowMs = () => performance.now();
  const vUnit = (id) => (view ? view.units.find((u) => u.id === id) : null);
  const uName = (u) => R.UNIT_TYPES[u.type].name;

  function toast(text, cls) {
    const d = document.createElement('div');
    d.className = 'toast' + (cls ? ' ' + cls : '');
    d.textContent = text;
    $('toasts').appendChild(d);
    setTimeout(() => d.remove(), 2700);
  }
  function showBanner(text, cls) {
    const b = $('banner');
    b.textContent = text;
    b.className = 'banner';
    void b.offsetWidth;
    b.className = 'banner show ' + (cls || 'neutral');
  }

  function actingSide() {
    if (!view || !state || state.phase !== 'game' || view.winner) return null;
    if (view.you === 'both') return view.turn;
    return view.you === view.turn ? view.turn : null;
  }
  const canInput = () => !!actingSide() && !animating && !pending;
  function selUnit() {
    if (!view || !selectedId) return null;
    return view.units.find((u) => u.id === selectedId && u.alive) || null;
  }

  // ------------------------------------------------------------ сеть
  socket.on('connect', () => {
    $('connState').classList.add('hidden');
    joinRoom();
  });
  socket.on('disconnect', () => $('connState').classList.remove('hidden'));
  socket.on('roomReset', () => {
    resetClientGame();
    toast('Комната сброшена');
    joinRoom();
  });
  socket.on('lobby', (l) => {
    lobby = l;
    if (l.phase === 'lobby') resetClientGame();
    renderLobby();
    updateScreens();
  });
  socket.on('state', (msg) => enqueue(msg));
  socket.on('errorMsg', (m) => {
    setPending(false);
    toast(m, 'err');
    Sound.error();
  });

  function resetClientGame() {
    state = null; view = null; gameId = null; queue.length = 0;
    selectedId = null; mode = 'normal'; overShownFor = null;
    anims.clear(); projectiles.length = 0; booms.length = 0; particles.length = 0; floats.length = 0;
    $('overlay').classList.add('hidden');
    setPending(false);
    updateScreens();
  }
  function setPending(v) {
    pending = v;
    clearTimeout(pendingTimer);
    if (v) pendingTimer = setTimeout(() => { pending = false; renderHUD(); }, 3000);
    renderHUD();
  }
  function sendAction(a) {
    if (!canInput()) return;
    socket.emit('action', a);
    mode = 'normal';
    setPending(true);
  }

  // ------------------------------------------------------------ очередь событий → анимации
  function enqueue(msg) {
    const s = msg.state;
    if (!s) return;
    if (!view || s.gameId !== gameId) {
      const isNew = gameId !== null || !view;
      queue.length = 0;
      gameId = s.gameId;
      state = s;
      view = clone(s);
      anims.clear();
      selectedId = null; mode = 'normal';
      overShownFor = s.phase === 'over' ? s.gameId : null;
      overHidden = false;
      onSynced();
      if (isNew && s.phase === 'game' && s.turnNo === 1 && s.activated.length === 0) {
        showBanner('БОЙ НАЧАЛСЯ!', 'neutral');
        Sound.turn();
      }
      return;
    }
    queue.push(msg);
    if (!animating) runQueue();
  }

  async function runQueue() {
    animating = true;
    renderHUD();
    while (queue.length) {
      const msg = queue.shift();
      state = msg.state;
      deadline = nowMs() + (state.turnLeftMs || 0);
      const fast = queue.length > 2 || document.hidden;
      setPending(false);
      if (!fast) {
        for (const e of msg.events || []) {
          try { await playEvent(e); } catch (err) { console.error(err); }
        }
      }
      view = clone(msg.state);
      anims.clear();
      onSynced();
    }
    animating = false;
    renderHUD();
    renderCard();
  }

  let noMovesFlash = null;
  function markUsed(u, kind) {
    if (!view || u.side !== view.turn) return;
    if (!view.activated.includes(u.id)) view.activated.push(u.id);
    if (kind === 'move') u.moved = true;
    else { u.acted = true; if (kind === 'attack') u.attacked = true; }
    renderHUD();
  }

  // ---- окошко «Осталось ходов» под доской
  function movesLeft() {
    const own = view.units.filter((u) => u.alive && u.side === view.turn);
    let n = 0;
    const slots = [];
    for (let i = 0; i < 2; i++) {
      const id = view.activated[i];
      if (id) {
        const u = vUnit(id);
        const mv = !!(u && u.alive && R.canMove(view, u));
        const ac = !!(u && u.alive && R.canAct(view, u));
        n += mv + ac;
        slots.push({ u, mv, ac });
      } else {
        const free = own.filter((u) => !view.activated.includes(u.id)).length - slots.filter((s) => !s.u).length;
        if (free > 0) { n += 2; slots.push({ u: null, mv: true, ac: true }); }
        else slots.push({ u: null, mv: false, ac: false, none: true });
      }
    }
    return { n, slots };
  }
  function renderMoves() {
    const box = $('movesBox');
    if (!box || !view) return;
    const side = actingSide();
    let cls = 'moves-box', html;
    const noMoves = (sub) => { cls += ' empty'; return `<div class="mv-big">ХОДОВ НЕТ</div><div class="mv-sub">${sub}</div>`; };
    if (view.winner) {
      html = '<div class="mv-big mv-over">ИГРА ОКОНЧЕНА</div>';
    } else if (noMovesFlash) {
      html = noMoves(`Ход переходит к ${{ blue: "Синим", red: "Красным" }[R.other(noMovesFlash)]}…`);
    } else if (!side) {
      html = noMoves(view.you ? 'Сейчас ходит соперник — ждите своей очереди' : `Ходят ${SIDE_RU[view.turn].toLowerCase()}`);
    } else {
      const { n, slots } = movesLeft();
      if (n === 0) {
        html = noMoves('Нажмите «Завершить ход» или Enter');
      } else {
        const cells = slots.map((s, i) => {
          const name = s.none ? 'нет юнитов' : s.u ? R.UNIT_TYPES[s.u.type].name : 'любой юнит';
          return `<div class="mv-slot${s.u ? ' used' : ''}"><div class="mv-name">Юнит ${i + 1}: ${name}</div>` +
            `<span class="mv-cell ${s.mv ? 'ok' : 'no'}">ДВИЖЕНИЕ</span><span class="mv-cell ${s.ac ? 'ok' : 'no'}">ДЕЙСТВИЕ</span></div>`;
        }).join('');
        html = `<div class="mv-head"><span class="mv-label">ОСТАЛОСЬ ХОДОВ</span><span class="mv-count">${n}</span><span class="mv-of">из 4</span></div><div class="mv-slots">${cells}</div>`;
        if (n === 1 || n === 2) cls += ' low';
      }
    }
    box.className = cls + ' ' + view.turn;
    box.innerHTML = html;
  }

  function cellCenter(x, y) { return { x: (fx(x) + 0.5) * C, y: (fx(y) + 0.5) * C }; }

  async function playEvent(e) {
    const u = e.unitId ? vUnit(e.unitId) : null;
    switch (e.type) {
      case 'move': {
        if (!u) return;
        markUsed(u, 'move');
        const stepMs = 115;
        const dur = (e.path.length - 1) * stepMs;
        anims.set(u.id, { type: 'path', path: e.path, t0: nowMs(), dur });
        for (let i = 0; i < e.path.length - 1; i++) setTimeout(() => Sound.step(), i * stepMs + 40);
        await wait(dur);
        const last = e.path[e.path.length - 1];
        u.x = last[0]; u.y = last[1];
        anims.delete(u.id);
        return;
      }
      case 'jetpack': {
        if (!u) return;
        u.item = e.item || null;
        markUsed(u, 'move');
        anims.set(u.id, { type: 'jet', from: e.from, to: e.to, t0: nowMs(), dur: 520 });
        Sound.jet();
        burst(cellCenter(e.from.x, e.from.y), 14, ['#f97316', '#facc15', '#9ca3af'], 2.2);
        await wait(520);
        u.x = e.to.x; u.y = e.to.y;
        anims.delete(u.id);
        burst(cellCenter(e.to.x, e.to.y), 16, ['#9ca3af', '#6b7280', '#f97316'], 2);
        shake = Math.max(shake, 2);
        return;
      }
      case 'knockback': {
        if (!u) return;
        anims.set(u.id, { type: 'slide', from: e.from, to: e.to, t0: nowMs(), dur: 170 });
        await wait(170);
        u.x = e.to.x; u.y = e.to.y;
        anims.delete(u.id);
        return;
      }
      case 'shot': {
        if (u && e.kind === 'shotgun') u.item = e.item || null;
        if (u) markUsed(u, 'attack');
        const dur = addProjectile(e.from, e.to, e.kind, e.side);
        if (e.kind === 'shotgun') Sound.shotgun();
        else if (e.kind === 'sniper') Sound.sniper();
        else Sound.laser();
        burst(cellCenter(e.from.x, e.from.y), 5, ['#fff', '#facc15'], 1.2);
        await wait(dur);
        return;
      }
      case 'damage': {
        if (!u) return;
        u.hp = e.hp;
        flashes.set(u.id, nowMs() + 140);
        addFloat(`-${e.amount}`, u.x, u.y, '#ff5a5a');
        burst(cellCenter(u.x, u.y), 10, ['#ef4444', '#fca5a5', '#fff'], 1.8);
        shake = Math.max(shake, 2.5);
        Sound.hit();
        await wait(170);
        return;
      }
      case 'shield': {
        if (!u) return;
        u.item = e.item || null;
        if (e.hp != null) u.hp = e.hp;
        addFloat(e.heal ? `БЛОК! +${e.heal}` : 'БЛОК!', u.x, u.y, '#22d3ee');
        ring(cellCenter(u.x, u.y), '#22d3ee');
        Sound.shield();
        await wait(260);
        return;
      }
      case 'heal': {
        if (!u) return;
        u.hp = e.hp;
        if (e.maxHp) u.maxHp = e.maxHp;
        addFloat(`+${e.amount}`, u.x, u.y, '#4ade80');
        burst(cellCenter(u.x, u.y), 12, ['#4ade80', '#bbf7d0'], 1.2, -1);
        Sound.heal();
        await wait(260);
        return;
      }
      case 'death': {
        if (u) u.alive = false;
        booms.push({ x: e.x, y: e.y, t0: nowMs(), big: true });
        burst(cellCenter(e.x, e.y), 34, ['#f97316', '#facc15', '#ef4444', '#4b5563', '#111'], 3.4);
        shake = Math.max(shake, 6);
        Sound.explosion(true);
        await wait(380);
        return;
      }
      case 'explosion': {
        booms.push({ x: e.x, y: e.y, t0: nowMs(), big: !!e.big });
        burst(cellCenter(e.x, e.y), e.big ? 30 : 16, ['#f97316', '#facc15', '#fff', '#6b7280'], e.big ? 3.2 : 2.2);
        shake = Math.max(shake, e.big ? 7 : 4);
        if (e.big) Sound.explosion(true);
        await wait(e.big ? 260 : 90);
        return;
      }
      case 'minetrigger': {
        view.mines = view.mines.filter((m) => !(m.x === e.x && m.y === e.y));
        addFloat('МИНА!', e.x, e.y, '#c4b5fd');
        await wait(60);
        return;
      }
      case 'pickup': {
        view.crates = view.crates.filter((c) => !(c.x === e.x && c.y === e.y));
        if (u && !R.ITEMS[e.item.type].instant) u.item = e.item;
        const rar = R.RARITIES[e.item.tier || 0];
        addFloat(R.ITEMS[e.item.type].name, e.x, e.y, rar.color, e.item.tier === 4);
        burst(cellCenter(e.x, e.y), 14 + e.item.tier * 8, [rar.color, '#fde68a', '#fff'], 1.6 + e.item.tier * 0.4, -1);
        if (e.item.tier >= 3) {
          showBanner(`${R.RARITIES[e.item.tier].m.toUpperCase()} ЛУТ!`, 'rar' + e.item.tier);
          ring(cellCenter(e.x, e.y), rar.color);
          shake = Math.max(shake, 3);
          Sound.legendary(e.item.tier === 4);
        } else Sound.pickup(e.item.tier);
        await wait(e.item.tier >= 3 ? 650 : 300);
        return;
      }
      case 'luck': {
        if (view.luck) view.luck[e.side] = e.luck;
        if (e.expired) { if (view.luckBuff) view.luckBuff[e.side] = null; renderHUD(); return; }
        if (u) addFloat(`+${e.amount} УДАЧА`, u.x, u.y, '#4ade80');
        if (u) burst(cellCenter(u.x, u.y), 18, ['#4ade80', '#86efac', '#facc15'], 1.4, -1);
        renderHUD();
        await wait(250);
        return;
      }
      case 'itemchange': {
        if (u) u.item = e.item || null;
        return;
      }
      case 'crate': {
        view.crates.push({ id: e.id, x: e.x, y: e.y });
        crateDrops.set(e.id, nowMs());
        if (e.bonus) { addFloat('ДВОЙНОЙ ДРОП!', e.x, e.y, '#facc15'); Sound.pickup(2); } else Sound.crate();
        await wait(220);
        burst(cellCenter(e.x, e.y), 10, ['#9ca3af', '#facc15'], 1.4);
        return;
      }
      case 'mineplaced': {
        if (u) { u.item = e.item || null; markUsed(u, 'act'); }
        view.mines.push({ id: 'tmp', x: e.x, y: e.y, side: e.side });
        Sound.mine();
        await wait(200);
        return;
      }
      case 'turn': {
        // показываем «ХОДОВ НЕТ» перед передачей хода, чтобы было видно, что ходы кончились
        noMovesFlash = view.turn;
        renderMoves();
        await wait(900);
        noMovesFlash = null;
        view.turn = e.turn;
        view.activated = [];
        for (const x of view.units) { x.moved = false; x.acted = false; x.attacked = false; }
        selectedId = null; mode = 'normal';
        const mine = view.you === 'both' || view.you === e.turn;
        showBanner(view.you === 'both' ? `ХОД ${SIDE_GEN[e.turn]}` : (mine ? 'ВАШ ХОД' : `ХОД ${SIDE_GEN[e.turn]}`), e.turn);
        if (mine) Sound.turn();
        renderHUD();
        await wait(350);
        return;
      }
      case 'gameover':
        await wait(400);
        return;
      default:
    }
  }

  // ------------------------------------------------------------ эффекты
  function addProjectile(from, to, kind, side) {
    const d = Math.hypot(to.x - from.x, to.y - from.y);
    const dur = kind === 'sniper' ? 110 : kind === 'shotgun' ? 130 : Math.round(80 + d * 45);
    projectiles.push({ from, to, kind, side, t0: nowMs(), dur });
    return dur;
  }
  function burst(p, n, colors, speed, gravSign) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const v = (0.4 + Math.random()) * speed * S * 30;
      particles.push({
        x: p.x, y: p.y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - (gravSign === -1 ? S * 40 : 0),
        g: gravSign === -1 ? -S * 10 : S * 120, life: 0, max: 0.35 + Math.random() * 0.5,
        color: colors[(Math.random() * colors.length) | 0], size: Math.random() < 0.3 ? 2 : 1,
      });
    }
  }
  function ring(p, color) {
    for (let i = 0; i < 20; i++) {
      const a = (i / 20) * Math.PI * 2;
      particles.push({ x: p.x, y: p.y, vx: Math.cos(a) * S * 45, vy: Math.sin(a) * S * 45, g: 0, life: 0, max: 0.4, color, size: 1 });
    }
  }
  function addFloat(text, x, y, color, rainbow) {
    floats.push({ text, x, y, color, rainbow, t0: nowMs(), dur: rainbow ? 1600 : 1000 });
  }

  // ------------------------------------------------------------ синхронизация UI
  function onSynced() {
    flipped = view.you === 'red';
    deadline = nowMs() + (state.turnLeftMs || 0);
    if (selectedId && !selUnit()) selectedId = null;
    const su = selUnit();
    if (mode !== 'normal') {
      const need = { shotgun: 'shotgun', jetpack: 'jetpack', mine: 'landmine' }[mode];
      if (!su || !su.item || su.item.type !== need || su.side !== actingSide()) mode = 'normal';
    }
    updateScreens();
    renderHUD();
    renderCard();
    renderLog();
    renderOverlay();
  }

  function updateScreens() {
    const inGame = !!(lobby && lobby.phase !== 'lobby' && view);
    $('lobby').classList.toggle('hidden', inGame);
    $('game').classList.toggle('hidden', !inGame);
    if (inGame) resize();
  }

  function renderLobby() {
    if (!lobby) return;
    const ni = $('nameInput');
    if (document.activeElement !== ni) ni.value = myName;
    for (const side of ['blue', 'red']) {
      const el = $(side === 'blue' ? 'slotBlue' : 'slotRed');
      const s = lobby.slots[side];
      el.innerHTML = '';
      const title = document.createElement('div');
      title.className = 'slot-title';
      title.textContent = side === 'blue' ? '■ СИНИЕ' : '■ КРАСНЫЕ';
      if (lobby.you === side || (lobby.you === 'both')) {
        const t = document.createElement('span');
        t.className = 'you-tag'; t.textContent = 'ВЫ';
        title.appendChild(t);
      }
      const nm = document.createElement('div');
      nm.className = 'slot-name';
      nm.textContent = s ? s.name : '—';
      const st = document.createElement('div');
      st.className = 'slot-status';
      if (!s) { st.textContent = '○ Свободно'; st.classList.add('st-free'); }
      else if (!s.connected) { st.textContent = '✖ Отключён (ожидание…)'; st.classList.add('st-off'); }
      else if (s.ready) { st.textContent = '✔ ГОТОВ'; st.classList.add('st-ready'); }
      else { st.textContent = '… Ожидание'; st.classList.add('st-wait'); }
      el.append(title, nm, st);
    }
    const seated = lobby.you === 'blue' || lobby.you === 'red';
    const mySlot = seated ? lobby.slots[lobby.you] : null;
    const btn = $('btnReady');
    btn.disabled = !seated || lobby.phase !== 'lobby';
    btn.textContent = mySlot && mySlot.ready ? 'Отменить готовность' : 'Готов';
    btn.classList.toggle('active', !!(mySlot && mySlot.ready));
    $('btnSolo').disabled = lobby.phase !== 'lobby';
    let msg = '';
    const other = seated ? lobby.slots[lobby.you === 'blue' ? 'red' : 'blue'] : null;
    if (lobby.phase !== 'lobby' && !lobby.you) msg = 'Идёт матч — вы в режиме наблюдателя. Если сессия зависла, нажмите «Сбросить комнату».';
    else if (!lobby.you) msg = 'Комната заполнена. Если сессия зависла — нажмите «Сбросить комнату».';
    else if (seated && !other) msg = 'Ожидание второго игрока… Отправьте ему ссылку ниже — или нажмите «Тест на 1 ПК».';
    else if (seated && mySlot && !mySlot.ready) msg = 'Нажмите «Готов», чтобы начать.';
    else if (seated && other && !other.ready) msg = 'Ждём готовности соперника…';
    $('lobbyMsg').textContent = msg;
    const ul = $('urlList');
    ul.innerHTML = '';
    const urls = shareLinks();
    $('roomCode').textContent = roomCode === 'MAIN' ? 'MAIN (общая)' : roomCode;
    for (const u of urls) {
      const li = document.createElement('li');
      const a = document.createElement('a');
      a.href = u; a.textContent = u; a.target = '_blank'; a.rel = 'noopener';
      li.appendChild(a);
      ul.appendChild(li);
    }
  }

  function renderLootInfo() {
    const el = $('lootInfo');
    if (!el || !view) return;
    const lv = R.lootLevel(view.round);
    const luck = view.luck || { blue: 0, red: 0 };
    const mySide = view.you === 'blue' || view.you === 'red' ? view.you : view.turn;
    const ch = R.rarityChances(luck[mySide], view.round);
    const bar = ch.map((p, i) => `<span class="lc r${i}" style="flex:${Math.max(p, 0.02)}" title="${R.RARITIES[i].m}: ${(p * 100).toFixed(1)}%"></span>`).join('');
    el.innerHTML = `<div class="li-row"><span>ЛУТ ур. <b>${lv}</b>/5</span><span class="li-luck">${['blue', 'red'].map((sd) => { const b = view.luckBuff && view.luckBuff[sd]; return `<span class="${sd === 'blue' ? 'pb' : 'pr'}" title="${b ? `Клевер действует ещё ${b.turns} ход.` : 'Клевер не активен'}">🍀${luck[sd]}${b ? `<small>·${b.turns}х</small>` : ''}</span>`; }).join(' ')}</span></div>` +
      `<div class="li-bar">${bar}</div><div class="li-sub">шанс ★+: ${((ch[3] + ch[4]) * 100).toFixed(0)}% · двойной дроп: ${(R.doubleDropChance(luck[mySide], view.round) * 100).toFixed(0)}%</div>`;
  }

  function renderHUD() {
    if (!view) return;
    const tl = $('turnLabel');
    const side = view.turn;
    let txt;
    if (view.winner) txt = 'ИГРА ОКОНЧЕНА';
    else if (view.you === 'both') txt = `ХОД ${SIDE_GEN[side]}`;
    else if (view.you === side) txt = '▶ ВАШ ХОД';
    else txt = `ХОД ${SIDE_GEN[side]}`;
    tl.textContent = txt;
    tl.className = 'turn-label ' + side;
    $('roundLabel').textContent = `Раунд ${view.round}` + (view.you === 'both' ? ' · тест на 1 ПК' : view.you ? ` · вы за ${SIDE_RU[view.you]}` : ' · наблюдатель');
    renderLootInfo();

    const box = $('actionsBox');
    box.innerHTML = '';
    for (let i = 0; i < 2; i++) {
      const d = document.createElement('div');
      const id = view.activated[i];
      const u = id ? vUnit(id) : null;
      if (!u) {
        d.className = 'aslot';
        d.innerHTML = `<span class="free">Юнит ${i + 1}: свободный слот</span>`;
      } else {
        d.className = 'aslot used';
        const nm = document.createElement('span');
        nm.className = 'nm'; nm.style.color = TEAM_COL[u.side];
        nm.textContent = `${i + 1}. ${uName(u)}${u.alive ? '' : ' ☠'}`;
        const mv = document.createElement('span');
        mv.className = 'pip ' + (u.alive && R.canMove(view, u) ? 'ok' : 'no'); mv.textContent = 'Движение';
        const ac = document.createElement('span');
        ac.className = 'pip ' + (u.alive && R.canAct(view, u) ? 'ok' : 'no'); ac.textContent = 'Действие';
        d.append(nm, mv, ac);
      }
      box.appendChild(d);
    }

    const pb = $('playersBox');
    pb.innerHTML = '';
    for (const s of ['blue', 'red']) {
      const p = view.players && view.players[s];
      const row = document.createElement('div');
      const dot = document.createElement('span');
      dot.className = 'dot ' + (p && p.connected ? 'on' : 'off');
      const nm = document.createElement('span');
      nm.className = s === 'blue' ? 'pb' : 'pr';
      nm.textContent = (p ? p.name : '—') + (view.solo && s === 'red' ? ' (тот же ПК)' : '');
      row.append(dot, nm);
      pb.appendChild(row);
    }
    $('btnEndTurn').disabled = !canInput();
    renderMoves();
    $('btnSurrender').disabled = !view.you || !!view.winner || state.phase !== 'game';
    $('btnSurrender').classList.toggle('hidden', !view.you);
    $('btnResetGame').classList.toggle('hidden', !!view.you);

    const w = $('warn');
    if (view.you === 'blue' || view.you === 'red') {
      const o = view.players[R.other(view.you)];
      if (!view.winner && (!o || !o.connected)) {
        w.textContent = '⚠ Соперник отключился — ожидание переподключения…';
        w.classList.remove('hidden');
      } else w.classList.add('hidden');
    } else w.classList.add('hidden');
  }

  function drawSpriteTo(cv, name, team, cssSize) {
    const d = window.devicePixelRatio || 1;
    const scale = Math.max(1, Math.floor((cssSize * d) / 16));
    cv.width = scale * 16; cv.height = scale * 16;
    cv.style.width = (scale * 16) / d + 'px';
    cv.style.height = (scale * 16) / d + 'px';
    const c = cv.getContext('2d');
    c.imageSmoothingEnabled = false;
    c.drawImage(Sprites.get(name, team), 0, 0, cv.width, cv.height);
  }

  function renderCard() {
    const el = $('unitCard');
    const u = selUnit();
    if (!view || !u) {
      el.innerHTML = `<div class="help"><h4>// УПРАВЛЕНИЕ</h4>
        <b>ЛКМ</b> по своему юниту — выбрать.<br>
        <b>ЛКМ</b> по подсвеченной клетке — движение.<br>
        <b>ЛКМ</b> по врагу в красной рамке — атака.<br>
        <b>ПКМ / Esc</b> — отмена, <b>Enter</b> — конец хода.<br><br>
        За ход: до <b>2 разных юнитов</b>, у каждого <b>1 Движение</b> + <b>1 Действие</b>.<br>
        Наступите на <b>ящик</b>, чтобы получить лут. Наведите на врага — увидите превью урона.</div>`;
      return;
    }
    const T = R.UNIT_TYPES[u.type];
    const side = actingSide();
    const own = side && u.side === side;
    const pct = Math.round((u.hp / u.maxHp) * 100);
    const hpCol = pct > 60 ? '#4ade80' : pct > 30 ? '#facc15' : '#ef4444';
    const mvR = R.moveRange(u);
    const it = u.item ? R.ITEMS[u.item.type] : null;
    const rar = u.item ? R.RARITIES[u.item.tier || 0] : null;
    let status = '';
    if (u.side === view.turn && !view.winner) {
      const usable = R.canUseUnit(view, u);
      status = usable
        ? `<div class="status-row"><span class="pip ${R.canMove(view, u) ? 'ok' : 'no'}">Движение</span><span class="pip ${R.canAct(view, u) ? 'ok' : 'no'}">Действие</span>${u.type === 'sniper' ? '<span class="pip ' + (R.canShoot(view, u) ? 'ok' : 'no') + '">Выстрел</span>' : ''}</div>`
        : '<div class="status-row"><span class="pip no">Лимит: 2 юнита за ход</span></div>';
    }
    let deb = '';
    if (u.slowed) deb += '<div class="debuff">⚠ Контузия: −1 к движению в этот ход</div>';
    if (u.slowNext) deb += '<div class="debuff">⚠ Контузия: −1 к движению в следующий ход</div>';
    let btns = '';
    if (own && it && it.active && !view.winner) {
      const modeKey = { shotgun: 'shotgun', jetpack: 'jetpack', landmine: 'mine' }[u.item.type];
      let ok = false;
      if (modeKey === 'shotgun') ok = R.canShoot(view, u);
      if (modeKey === 'jetpack') ok = R.canMove(view, u) && R.jetpackCells(view, u).length > 0;
      if (modeKey === 'mine') ok = R.canAct(view, u) && R.mineCells(view, u).length > 0;
      const active = mode === modeKey;
      btns = `<div class="card-btns"><button id="btnItem" class="btn ${active ? 'active' : 'primary'}" ${ok && canInput() ? '' : 'disabled'} data-mode="${modeKey}">${active ? 'Отмена' : 'Активировать: ' + it.name}</button></div>`;
    }
    el.innerHTML = `
      <div class="card-head">
        <canvas id="portrait" class="portrait"></canvas>
        <div>
          <div class="u-name ${u.side}">${T.name}</div>
          <div class="u-side">${SIDE_RU[u.side].toUpperCase()}${own ? ' · ваш юнит' : ''}</div>
          <div class="hpbar"><div style="width:${pct}%;background:${hpCol}"></div><span>${u.hp} / ${u.maxHp} HP</span></div>
        </div>
      </div>
      <div class="stats">
        <div class="stat"><b>${u.hp}</b><small>HP</small></div>
        <div class="stat"><b>${mvR}${u.slowed ? '↓' : ''}</b><small>ХОД</small></div>
        <div class="stat"><b>${T.dmg}</b><small>УРОН</small></div>
        <div class="stat"><b>${T.minRange > 1 ? T.minRange + '–' : ''}${T.range}</b><small>ДАЛЬН.</small></div>
      </div>
      ${status}${deb}
      <div class="u-desc">${T.desc}</div>
      <div class="item-box">
        <canvas id="itemIcon"></canvas>
        <div>${it ? `<div class="item-name" style="color:${rar.color}">${it.name}${(u.item.charges || 1) > 1 ? ` ×${u.item.charges}` : ''}</div><div class="rarity-tag r${u.item.tier || 0}">${R.rarityName(u.item.type, u.item.tier).toUpperCase()}</div><div class="item-desc">${R.itemDesc(u.item)}</div>` : '<div class="item-empty">Слот снаряжения пуст.<br>Подберите ящик с лутом.</div>'}</div>
      </div>
      ${btns}`;
    drawSpriteTo($('portrait'), u.type, u.side, 72);
    const ic = $('itemIcon');
    if (it) { drawSpriteTo(ic, 'i_' + u.item.type, null, 32); ic.style.borderColor = rar.color; }
    else { ic.width = 1; ic.height = 1; ic.style.width = '34px'; ic.style.height = '34px'; }
    const b = $('btnItem');
    if (b) b.onclick = () => {
      Sound.unlock();
      const m = b.dataset.mode;
      mode = mode === m ? 'normal' : m;
      Sound.select();
      if (mode === 'shotgun') toast('Дробовик заряжен — выберите цель в 1–2 клетках');
      if (mode === 'jetpack') toast('Выберите клетку для прыжка');
      if (mode === 'mine') toast('Выберите соседнюю клетку для мины');
      renderCard();
    };
  }

  function renderLog() {
    if (!state) return;
    const log = state.log || [];
    const key = log.length ? log[log.length - 1].id + ':' + log.length : '0';
    if (key === renderedLogKey) return;
    renderedLogKey = key;
    const el = $('log');
    el.innerHTML = '';
    for (const l of log) {
      const d = document.createElement('div');
      d.className = (l.cls || '') + (l.tier ? ' r' + l.tier : '');
      d.textContent = l.text;
      el.appendChild(d);
    }
    el.scrollTop = el.scrollHeight;
  }

  function renderOverlay() {
    const ov = $('overlay');
    if (!state || state.phase !== 'over' || !view.winner) { ov.classList.add('hidden'); return; }
    const w = view.winner;
    const h = $('overTitle');
    let sub;
    if (view.you === 'both' || !view.you) {
      h.textContent = `ПОБЕДА ${SIDE_GEN[w]}`;
      h.className = w;
      sub = 'Вражеский Командир уничтожен.';
    } else if (view.you === w) {
      h.textContent = 'ПОБЕДА!'; h.className = 'win';
      sub = 'Вражеский Командир уничтожен. Отличная работа, командир.';
    } else {
      h.textContent = 'ПОРАЖЕНИЕ'; h.className = 'lose';
      sub = 'Ваш Командир пал. Реванш?';
    }
    const rb = $('btnRematch');
    if (view.you === 'both') { rb.textContent = 'Реванш'; rb.disabled = false; }
    else if (view.you) {
      const votes = (state.rematch.blue ? 1 : 0) + (state.rematch.red ? 1 : 0);
      const mine = state.rematch[view.you];
      rb.textContent = mine ? `Ждём соперника (${votes}/2)` : `Реванш (${votes}/2)`;
      rb.disabled = mine;
    } else { rb.textContent = 'Реванш'; rb.disabled = true; }
    $('btnToLobby').disabled = !view.you;
    $('overSub').textContent = sub;
    if (overShownFor !== state.gameId) {
      overShownFor = state.gameId;
      overHidden = false;
      if (view.you === 'both' || view.you === w || !view.you) Sound.victory(); else Sound.defeat();
      const c = cellCenter(3.5, 3.5);
      for (let i = 0; i < 4; i++) setTimeout(() => burst({ x: c.x + (Math.random() - 0.5) * C * 5, y: c.y + (Math.random() - 0.5) * C * 5 }, 30, ['#facc15', '#22d3ee', '#f472b6', '#4ade80', '#fff'], 3), i * 250);
    }
    ov.classList.toggle('hidden', overHidden);
  }

  // ------------------------------------------------------------ ввод
  function cellFromEvent(e) {
    const r = canvas.getBoundingClientRect();
    const cx = Math.floor(((e.clientX - r.left) / r.width) * N);
    const cy = Math.floor(((e.clientY - r.top) / r.height) * N);
    if (cx < 0 || cy < 0 || cx >= N || cy >= N) return null;
    return { x: fx(cx), y: fx(cy) };
  }
  function select(id) {
    if (selectedId !== id && id) Sound.select();
    selectedId = id;
    mode = 'normal';
    renderCard();
  }
  function cancel() {
    if (mode !== 'normal') { mode = 'normal'; renderCard(); }
    else select(null);
  }

  function onCellClick(c) {
    if (!view) return;
    Sound.unlock();
    const side = actingSide();
    const cu = R.unitAt(view, c.x, c.y);
    const su = selUnit();
    if (!side || animating || pending) { select(cu ? cu.id : null); return; }
    const own = su && su.side === side;
    if (own && mode !== 'normal') {
      if (mode === 'jetpack') {
        if (R.jetpackCells(view, su).some((p) => p.x === c.x && p.y === c.y)) sendAction({ type: 'jetpack', unitId: su.id, x: c.x, y: c.y });
        else cancel();
        return;
      }
      if (mode === 'mine') {
        if (R.mineCells(view, su).some((p) => p.x === c.x && p.y === c.y)) sendAction({ type: 'mine', unitId: su.id, x: c.x, y: c.y });
        else cancel();
        return;
      }
      if (mode === 'shotgun') {
        if (cu && cu.side !== side) {
          const inf = R.attackInfo(view, su, cu, 'shotgun');
          if (inf.ok) sendAction({ type: 'shotgun', unitId: su.id, targetId: cu.id });
          else { toast(inf.reason, 'err'); Sound.error(); }
        } else cancel();
        return;
      }
    }
    if (cu && cu.side === side) { select(cu.id); return; }
    if (own) {
      if (cu) {
        const inf = R.attackInfo(view, su, cu, 'normal');
        if (inf.ok) { sendAction({ type: 'attack', unitId: su.id, targetId: cu.id }); return; }
        if (su.item && su.item.type === 'shotgun') {
          const s2 = R.attackInfo(view, su, cu, 'shotgun');
          if (s2.ok) { sendAction({ type: 'shotgun', unitId: su.id, targetId: cu.id }); return; }
        }
        toast(inf.reason, 'err'); Sound.error();
        return;
      }
      if (R.canMove(view, su) && !(c.x === su.x && c.y === su.y)) {
        const reach = R.reachable(view, su);
        if (reach.has(R.key(c.x, c.y))) { sendAction({ type: 'move', unitId: su.id, x: c.x, y: c.y }); return; }
      }
      select(null);
      return;
    }
    select(cu ? cu.id : null);
  }

  canvas.addEventListener('click', (e) => { const c = cellFromEvent(e); if (c) onCellClick(c); });
  canvas.addEventListener('contextmenu', (e) => { e.preventDefault(); cancel(); });
  canvas.addEventListener('mousemove', (e) => {
    hover = cellFromEvent(e);
    canvas.style.cursor = hover && view && (R.unitAt(view, hover.x, hover.y) || (selUnit() && actingSide())) ? 'pointer' : 'default';
  });
  canvas.addEventListener('mouseleave', () => { hover = null; });

  function endTurn() {
    if (!canInput()) return;
    Sound.unlock();
    sendAction({ type: 'endTurn' });
  }
  $('btnEndTurn').onclick = endTurn;
  $('btnSurrender').onclick = () => { if (confirm('Сдаться и завершить матч?')) socket.emit('surrender'); };
  $('btnResetGame').onclick = () => {
    if (confirm('Сбросить комнату? Текущий матч будет завершён для всех игроков.')) socket.emit('resetRoom');
  };
  $('btnRematch').onclick = () => { Sound.unlock(); socket.emit('rematch'); };
  $('btnToLobby').onclick = () => socket.emit('toLobby');
  $('btnHideOver').onclick = () => { overHidden = true; $('overlay').classList.add('hidden'); toast('Нажмите Esc, чтобы вернуть экран победы'); };
  $('btnReady').onclick = () => { Sound.unlock(); Sound.select(); socket.emit('ready'); };
  $('btnSolo').onclick = () => { Sound.unlock(); socket.emit('solo'); };
  $('btnNewRoom').onclick = () => {
    Sound.unlock();
    socket.emit('createRoom', (res) => {
      if (!res || res.error) { toast((res && res.error) || 'Не удалось создать комнату', 'err'); return; }
      switchRoom(res.code);
      toast(`Комната ${res.code} создана — отправьте ссылку другу`);
    });
  };
  $('btnJoinCode').onclick = () => {
    const c = cleanCode($('codeInput').value);
    if (!c) { toast('Введите код комнаты', 'err'); return; }
    $('codeInput').value = '';
    switchRoom(c);
  };
  $('codeInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('btnJoinCode').click(); });
  $('btnCopyLink').onclick = async () => {
    const link = shareLinks()[0];
    try { await navigator.clipboard.writeText(link); toast('Ссылка скопирована: ' + link); }
    catch (e) { prompt('Скопируйте ссылку:', link); }
  };
  $('btnReset').onclick = () => {
    if (confirm('Сбросить комнату? Текущий матч и лобби будут очищены для всех игроков.')) socket.emit('resetRoom');
  };
  const muteBtn = $('btnMute');
  const syncMute = () => { muteBtn.textContent = Sound.isMuted() ? '🔇' : '🔊'; };
  muteBtn.onclick = () => { Sound.toggleMute(); syncMute(); };
  syncMute();

  let nameTimer = null;
  $('nameInput').addEventListener('input', (e) => {
    clearTimeout(nameTimer);
    nameTimer = setTimeout(() => {
      myName = e.target.value.trim().slice(0, 16) || myName;
      store.set(localStorage, 'tlc_name', myName);
      socket.emit('setName', myName);
    }, 300);
  });

  document.addEventListener('pointerdown', () => Sound.unlock(), { once: true });
  document.addEventListener('keydown', (e) => {
    if (e.target && e.target.tagName === 'INPUT') return;
    if (e.key === 'Escape') {
      if (state && state.phase === 'over' && overHidden) { overHidden = false; renderOverlay(); return; }
      cancel();
    } else if (e.key === 'Enter' || e.key === ' ') {
      if (!$('game').classList.contains('hidden')) { e.preventDefault(); endTurn(); }
    } else if (e.key === 'm' || e.key === 'M' || e.key === 'ь' || e.key === 'Ь') {
      Sound.toggleMute(); syncMute();
    } else if (e.key === 'Tab' && view && actingSide()) {
      e.preventDefault();
      const own = view.units.filter((u) => u.alive && u.side === actingSide() && R.canUseUnit(view, u));
      if (!own.length) return;
      const i = own.findIndex((u) => u.id === selectedId);
      select(own[(i + 1) % own.length].id);
    }
  });

  // ------------------------------------------------------------ рендер
  function unitPos(u, now) {
    const a = anims.get(u.id);
    if (!a) return { x: u.x, y: u.y, z: 0 };
    const p = Math.min(1, Math.max(0, (now - a.t0) / a.dur));
    if (a.type === 'path') {
      const segs = a.path.length - 1;
      const f = p * segs;
      const i = Math.min(segs - 1, Math.floor(f));
      const r = f - i;
      const A = a.path[i], B = a.path[i + 1];
      return { x: A[0] + (B[0] - A[0]) * r, y: A[1] + (B[1] - A[1]) * r, z: Math.sin(r * Math.PI) * 0.08 };
    }
    const e = a.type === 'jet' ? p * p * (3 - 2 * p) : 1 - (1 - p) * (1 - p);
    return {
      x: a.from.x + (a.to.x - a.from.x) * e,
      y: a.from.y + (a.to.y - a.from.y) * e,
      z: a.type === 'jet' ? Math.sin(p * Math.PI) * 1.3 : 0,
    };
  }

  function fillCell(x, y, color, inset) {
    const i = inset == null ? S : inset;
    ctx.fillStyle = color;
    ctx.fillRect(fx(x) * C + i, fx(y) * C + i, C - 2 * i, C - 2 * i);
  }
  function frameCell(x, y, color, t, inset) {
    const px = fx(x) * C + (inset || 0), py = fx(y) * C + (inset || 0), w = C - 2 * (inset || 0);
    ctx.fillStyle = color;
    ctx.fillRect(px, py, w, t); ctx.fillRect(px, py + w - t, w, t);
    ctx.fillRect(px, py, t, w); ctx.fillRect(px + w - t, py, t, w);
  }
  function brackets(px, py, size, color, len, t) {
    ctx.fillStyle = color;
    const L = len, e = size;
    ctx.fillRect(px, py, L, t); ctx.fillRect(px, py, t, L);
    ctx.fillRect(px + e - L, py, L, t); ctx.fillRect(px + e - t, py, t, L);
    ctx.fillRect(px, py + e - t, L, t); ctx.fillRect(px, py + e - L, t, L);
    ctx.fillRect(px + e - L, py + e - t, L, t); ctx.fillRect(px + e - t, py + e - L, t, L);
  }
  function pixLine(x0, y0, x1, y1, size, color, gap, offset) {
    const d = Math.hypot(x1 - x0, y1 - y0);
    const step = size * (gap || 1);
    ctx.fillStyle = color;
    for (let s = (offset || 0) % step; s <= d; s += step) {
      const t = d ? s / d : 0;
      ctx.fillRect(snap(x0 + (x1 - x0) * t - size / 2), snap(y0 + (y1 - y0) * t - size / 2), size, size);
    }
  }
  function label(text, cx, cy, color, bg) {
    const fs = Math.max(10, Math.round(C * 0.22));
    ctx.font = `bold ${fs}px Consolas, Menlo, "DejaVu Sans Mono", monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const w = Math.ceil(ctx.measureText(text).width) + S * 4;
    const h = fs + S * 2;
    ctx.fillStyle = bg || 'rgba(5,8,13,0.88)';
    ctx.fillRect(snap(cx - w / 2), snap(cy - h / 2), w, h);
    ctx.fillStyle = color;
    ctx.fillRect(snap(cx - w / 2), snap(cy + h / 2) - S, w, S);
    ctx.fillText(text, Math.round(cx), Math.round(cy));
  }
  function outlinedText(text, cx, cy, color, alpha) {
    const fs = Math.max(12, Math.round(C * 0.3));
    ctx.font = `bold ${fs}px Consolas, Menlo, "DejaVu Sans Mono", monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.globalAlpha = alpha;
    ctx.lineWidth = Math.max(2, S);
    ctx.strokeStyle = '#000';
    ctx.strokeText(text, Math.round(cx), Math.round(cy));
    ctx.fillStyle = color;
    ctx.fillText(text, Math.round(cx), Math.round(cy));
    ctx.globalAlpha = 1;
  }

  function drawBoard(now) {
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      ctx.drawImage(Sprites.get((x + y) % 2 ? 'floorA' : 'floorB'), fx(x) * C, fx(y) * C, C, C);
    }
    // зоны баз
    for (const [y, col] of [[0, 'rgba(239,68,68,0.07)'], [1, 'rgba(239,68,68,0.04)'], [6, 'rgba(59,130,246,0.04)'], [7, 'rgba(59,130,246,0.07)']]) {
      ctx.fillStyle = col;
      ctx.fillRect(0, fx(y) * C, C * N, C);
    }
  }

  function drawHighlights(now) {
    const side = actingSide();
    const su = selUnit();
    if (!su || !side || su.side !== side || animating) return;
    const pulse = 0.5 + 0.5 * Math.sin(now / 180);
    if (mode === 'normal') {
      if (R.canMove(view, su)) {
        for (const k of R.reachable(view, su).keys()) {
          const x = k % N, y = Math.floor(k / N);
          if (x === su.x && y === su.y) continue;
          fillCell(x, y, 'rgba(34,211,238,0.16)');
          frameCell(x, y, 'rgba(34,211,238,0.35)', S, S);
        }
      }
      if (R.canShoot(view, su)) {
        const T = R.UNIT_TYPES[su.type];
        for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
          const d = R.cheb(su, { x, y });
          if (d < T.minRange || d > T.range || R.isWall(view, x, y) || !R.hasLOS(view, su, { x, y })) continue;
          ctx.fillStyle = 'rgba(248,113,113,0.35)';
          ctx.fillRect(fx(x) * C + C / 2 - S, fx(y) * C + C / 2 - S, 2 * S, 2 * S);
        }
        for (const t of R.targets(view, su, 'normal')) frameCell(t.x, t.y, `rgba(248,80,80,${0.55 + 0.45 * pulse})`, S, 0);
        if (su.item && su.item.type === 'shotgun') {
          for (const t of R.targets(view, su, 'shotgun')) frameCell(t.x, t.y, `rgba(251,146,60,${0.55 + 0.45 * pulse})`, S, S * 2);
        }
      }
    } else if (mode === 'jetpack') {
      for (const c of R.jetpackCells(view, su)) {
        fillCell(c.x, c.y, 'rgba(167,139,250,0.2)');
        frameCell(c.x, c.y, 'rgba(167,139,250,0.45)', S, S);
      }
    } else if (mode === 'mine') {
      for (const c of R.mineCells(view, su)) {
        fillCell(c.x, c.y, 'rgba(251,146,60,0.22)');
        frameCell(c.x, c.y, `rgba(251,146,60,${0.4 + 0.4 * pulse})`, S, S);
      }
    } else if (mode === 'shotgun') {
      for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
        const d = R.cheb(su, { x, y });
        if (d < 1 || d > 2 || R.isWall(view, x, y) || !R.hasLOS(view, su, { x, y })) continue;
        fillCell(x, y, 'rgba(251,146,60,0.12)');
      }
      for (const t of R.targets(view, su, 'shotgun')) frameCell(t.x, t.y, `rgba(251,146,60,${0.55 + 0.45 * pulse})`, S, 0);
    }
  }

  function drawObjects(now) {
    for (const w of view.walls) {
      ctx.fillStyle = 'rgba(0,0,0,0.45)';
      ctx.fillRect(fx(w.x) * C + 2 * S, fx(w.y) * C + 2 * S, C, C - S);
      ctx.drawImage(Sprites.get('wall'), fx(w.x) * C, fx(w.y) * C, C, C);
    }
    for (const c of view.crates) {
      let yo = ((Math.floor(now / 500) + c.x + c.y) % 2) * -S;
      const t0 = crateDrops.get(c.id);
      if (t0) {
        const p = Math.min(1, (now - t0) / 380);
        yo = -Math.pow(1 - p, 2) * C * 3;
        if (p >= 1) crateDrops.delete(c.id);
      }
      const px = fx(c.x) * C, py = fx(c.y) * C;
      ctx.fillStyle = 'rgba(0,0,0,0.4)';
      ctx.fillRect(px + 3 * S, py + 14 * S, 10 * S, 2 * S);
      ctx.drawImage(Sprites.get('crate'), px, snap(py + yo), C, C);
    }
    for (const m of view.mines) {
      const px = fx(m.x) * C, py = fx(m.y) * C;
      const s = Math.max(1, Math.floor(S / 2)) * 16;
      ctx.globalAlpha = 0.85;
      ctx.drawImage(Sprites.icon('landmine'), px + (C - s) / 2 | 0, py + (C - s) / 2 + 2 * S | 0, s, s);
      ctx.globalAlpha = 1;
      if (Math.floor(now / 400) % 2) {
        ctx.fillStyle = m.side === 'blue' ? '#60a5fa' : '#f87171';
        ctx.fillRect(px + C / 2 - S, py + C / 2 - S, 2 * S, 2 * S);
      }
      frameCell(m.x, m.y, m.side === 'blue' ? 'rgba(96,165,250,0.35)' : 'rgba(248,113,113,0.35)', S, 3 * S);
    }
  }

  function drawUnits(now) {
    const list = view.units.filter((u) => u.alive).map((u) => ({ u, p: unitPos(u, now) }));
    list.sort((a, b) => fx(a.p.y) - fx(b.p.y));
    const sel = selUnit();
    for (const { u, p } of list) {
      const gx = snap(fx(p.x) * C);
      const gy = snap(fx(p.y) * C);
      const idle = !anims.has(u.id) && u.side === view.turn && Math.floor(now / 420 + u.id.charCodeAt(1)) % 2 === 0 ? -S : 0;
      const py = snap(gy - p.z * C + idle);
      // тень и подставка команды
      ctx.fillStyle = 'rgba(0,0,0,0.45)';
      ctx.fillRect(gx + 3 * S, gy + 14 * S, 10 * S, 2 * S);
      ctx.fillStyle = u.side === 'blue' ? 'rgba(59,130,246,0.55)' : 'rgba(239,68,68,0.55)';
      ctx.fillRect(gx + 4 * S, gy + 15 * S, 8 * S, S);

      let alpha = 1;
      if (u.side === view.turn && !view.winner) {
        if (!R.canUseUnit(view, u)) alpha = 0.45;
        else if (view.activated.includes(u.id) && !R.canMove(view, u) && !R.canAct(view, u)) alpha = 0.5;
      }
      ctx.globalAlpha = alpha;
      const flash = (flashes.get(u.id) || 0) > now;
      ctx.drawImage(Sprites.get(u.type, u.side, flash ? 'flash' : ''), gx, py, C, C);
      if (u.item && u.item.type === 'shield') {
        ctx.globalAlpha = 0.45 + 0.35 * Math.sin(now / 160);
        ctx.drawImage(Sprites.get('shieldfx'), gx, py, C, C);
      }
      ctx.globalAlpha = 1;

      // полоска HP (над головой)
      const bw = 12 * S, bx = gx + 2 * S, by = py - S;
      ctx.fillStyle = '#111';
      ctx.fillRect(bx - S, by - S, bw + 2 * S, 3 * S);
      const ratio = u.hp / u.maxHp;
      ctx.fillStyle = ratio > 0.6 ? '#4ade80' : ratio > 0.3 ? '#facc15' : '#ef4444';
      ctx.fillRect(bx, by, Math.max(S, Math.round((bw * ratio) / S) * S), S);
      // иконка лута над головой
      if (u.item) {
        const s = Math.max(1, Math.floor(S / 2));
        const sz = 16 * s;
        const ix = gx + C - sz + S;
        const iy = py - sz + 2 * S + ((Math.floor(now / 350) % 2) ? 0 : -s);
        const tier = u.item.tier || 0;
        const rc = tier === 4 ? `hsl(${(now / 4) % 360},95%,62%)` : R.RARITIES[tier].color;
        ctx.fillStyle = rc;
        ctx.fillRect(ix - 2 * s, iy - 2 * s, sz + 4 * s, sz + 4 * s);
        ctx.fillStyle = 'rgba(5,8,13,0.92)';
        ctx.fillRect(ix - s, iy - s, sz + 2 * s, sz + 2 * s);
        ctx.drawImage(Sprites.icon(u.item.type), ix, iy, sz, sz);
        if ((u.item.charges || 1) > 1) {
          const fs = Math.max(9, Math.round(C * 0.17));
          ctx.font = `bold ${fs}px Consolas, Menlo, monospace`;
          ctx.textAlign = 'right'; ctx.textBaseline = 'bottom';
          ctx.lineWidth = Math.max(2, s); ctx.strokeStyle = '#000';
          ctx.strokeText('x' + u.item.charges, ix + sz + s, iy + sz + s);
          ctx.fillStyle = '#fff';
          ctx.fillText('x' + u.item.charges, ix + sz + s, iy + sz + s);
        }
      }
      // контузия
      if (u.slowed || u.slowNext) {
        ctx.fillStyle = Math.floor(now / 250) % 2 ? '#facc15' : '#a16207';
        ctx.fillRect(gx + S, py + 3 * S, 2 * S, S);
        ctx.fillRect(gx + S, py + 5 * S, 2 * S, S);
        ctx.fillRect(gx + 2 * S, py + 4 * S, S, S);
      }
      // индикаторы Движение/Действие у задействованного юнита
      if (u.side === view.turn && view.activated.includes(u.id) && !view.winner) {
        ctx.fillStyle = R.canMove(view, u) ? '#22d3ee' : '#334155';
        ctx.fillRect(gx + S, gy + C - 4 * S, 2 * S, 2 * S);
        ctx.fillStyle = R.canAct(view, u) ? '#f87171' : '#334155';
        ctx.fillRect(gx + S, gy + C - 7 * S, 2 * S, 2 * S);
      }
      if (sel && sel.id === u.id) {
        const o = Math.floor(now / 250) % 2 ? 0 : S;
        brackets(gx + o, gy + o, C - 2 * o, '#22d3ee', 4 * S, S);
      }
    }
  }

  function drawHover(now) {
    if (!hover || !view) return;
    const su = selUnit();
    const side = actingSide();
    brackets(fx(hover.x) * C, fx(hover.y) * C, C, 'rgba(255,255,255,0.35)', 3 * S, S);
    if (!su || !side || su.side !== side || animating) return;
    const hu = R.unitAt(view, hover.x, hover.y);
    const enemy = hu && hu.side !== su.side;
    const sp = unitPos(su, now);
    const from = { x: (fx(sp.x) + 0.5) * C, y: (fx(sp.y) + 0.5) * C };
    const dash = Math.floor(now / 40);

    const aim = (t, m, color) => {
      const inf = R.attackInfo(view, su, t, m);
      const to = cellCenter(t.x, t.y);
      if (!inf.ok) {
        label(inf.reason, to.x, fx(t.y) * C - S * 2, '#9ca3af');
        return;
      }
      pixLine(from.x, from.y, to.x, to.y, S, color, 3, dash * S);
      brackets(fx(t.x) * C - S, fx(t.y) * C - S, C + 2 * S, color, 5 * S, S);
      if (m === 'shotgun') {
        for (const [dx, dy] of R.DIR8) {
          const x = t.x + dx, y = t.y + dy;
          if (!R.inBounds(x, y)) continue;
          fillCell(x, y, 'rgba(251,146,60,0.22)', 2 * S);
          const o = R.unitAt(view, x, y);
          if (o && o !== su) {
            const c = cellCenter(x, y);
            label(o.item && o.item.type === 'shield' ? 'ЩИТ' : `-${R.itemStat('shotgun', su.item.tier, 'splash')}`, c.x, fx(y) * C - 2 * S, '#fb923c');
          }
        }
      }
      const shield = t.item && t.item.type === 'shield';
      const kill = !shield && inf.dmg >= t.hp;
      const txt = shield ? 'ЩИТ: 0 урона' : `-${inf.dmg} HP${kill ? ' ☠' : ''}`;
      label(txt, to.x, fx(t.y) * C - S * 2, shield ? '#22d3ee' : kill ? '#facc15' : '#f87171');
    };

    if (mode === 'normal') {
      if (enemy) {
        const n = R.attackInfo(view, su, hu, 'normal');
        if (!n.ok && su.item && su.item.type === 'shotgun' && R.attackInfo(view, su, hu, 'shotgun').ok) aim(hu, 'shotgun', '#fb923c');
        else aim(hu, 'normal', '#f87171');
      } else if (!hu && R.canMove(view, su)) {
        const path = R.pathTo(R.reachable(view, su), hover.x, hover.y);
        if (path && path.length > 1) {
          ctx.fillStyle = '#22d3ee';
          for (let i = 1; i < path.length; i++) {
            const c = cellCenter(path[i][0], path[i][1]);
            const sz = i === path.length - 1 ? 4 * S : 2 * S;
            ctx.fillRect(snap(c.x - sz / 2), snap(c.y - sz / 2), sz, sz);
          }
          const c = cellCenter(hover.x, hover.y);
          if (R.crateAt(view, hover.x, hover.y)) label('ЛУТ', c.x, fx(hover.y) * C + S * 2, '#facc15');
        }
      }
    } else if (mode === 'shotgun' && enemy) {
      aim(hu, 'shotgun', '#fb923c');
    } else if (mode === 'jetpack' && R.jetpackCells(view, su).some((c) => c.x === hover.x && c.y === hover.y)) {
      const to = cellCenter(hover.x, hover.y);
      for (let i = 1; i < 12; i++) {
        const t = i / 12;
        const x = from.x + (to.x - from.x) * t;
        const y = from.y + (to.y - from.y) * t - Math.sin(t * Math.PI) * C * 1.3;
        ctx.fillStyle = '#a78bfa';
        ctx.fillRect(snap(x - S), snap(y - S), 2 * S, 2 * S);
      }
      ctx.globalAlpha = 0.5;
      ctx.drawImage(Sprites.get(su.type, su.side), fx(hover.x) * C, fx(hover.y) * C, C, C);
      ctx.globalAlpha = 1;
    } else if (mode === 'mine' && R.mineCells(view, su).some((c) => c.x === hover.x && c.y === hover.y)) {
      const s = Math.max(1, Math.floor(S / 2)) * 16;
      ctx.globalAlpha = 0.6;
      ctx.drawImage(Sprites.icon('landmine'), fx(hover.x) * C + (C - s) / 2 | 0, fx(hover.y) * C + (C - s) / 2 | 0, s, s);
      ctx.globalAlpha = 1;
    }
  }

  function drawFx(now, dt) {
    // снаряды
    for (let i = projectiles.length - 1; i >= 0; i--) {
      const p = projectiles[i];
      const t = (now - p.t0) / p.dur;
      const a = cellCenter(p.from.x, p.from.y), b = cellCenter(p.to.x, p.to.y);
      if (t >= 1) {
        projectiles.splice(i, 1);
        burst(b, 8, p.kind === 'shotgun' ? ['#fb923c', '#facc15'] : ['#fff', TEAM_COL[p.side] || '#fff'], 1.6);
        continue;
      }
      const hx = a.x + (b.x - a.x) * t, hy = a.y + (b.y - a.y) * t;
      if (p.kind === 'sniper') {
        pixLine(a.x, a.y, hx, hy, S, '#fde68a', 1);
        ctx.fillStyle = '#fff';
        ctx.fillRect(snap(hx - S * 1.5), snap(hy - S * 1.5), 3 * S, 3 * S);
      } else if (p.kind === 'shotgun') {
        const ang = Math.atan2(b.y - a.y, b.x - a.x);
        const len = Math.hypot(b.x - a.x, b.y - a.y) * t;
        for (let k = -2; k <= 2; k++) {
          const an = ang + k * 0.13;
          ctx.fillStyle = k % 2 ? '#facc15' : '#fb923c';
          ctx.fillRect(snap(a.x + Math.cos(an) * len - S), snap(a.y + Math.sin(an) * len - S), 2 * S, 2 * S);
        }
      } else {
        const col = TEAM_COL[p.side] || '#fff';
        const tx = a.x + (b.x - a.x) * Math.max(0, t - 0.25), ty = a.y + (b.y - a.y) * Math.max(0, t - 0.25);
        pixLine(tx, ty, hx, hy, 2 * S, col, 1);
        ctx.fillStyle = '#fff';
        ctx.fillRect(snap(hx - S), snap(hy - S), 2 * S, 2 * S);
      }
    }
    // взрывы
    for (let i = booms.length - 1; i >= 0; i--) {
      const b = booms[i];
      const f = Math.floor((now - b.t0) / 90);
      if (f > 2) { booms.splice(i, 1); continue; }
      const scale = b.big ? 2 : 1;
      const size = C * scale;
      const c = cellCenter(b.x, b.y);
      ctx.drawImage(Sprites.get('boom' + (f + 1)), snap(c.x - size / 2), snap(c.y - size / 2), size, size);
    }
    // частицы
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.life += dt;
      if (p.life >= p.max) { particles.splice(i, 1); continue; }
      p.vy += p.g * dt;
      p.x += p.vx * dt; p.y += p.vy * dt;
      p.vx *= 0.96;
      const sz = p.size * S;
      ctx.globalAlpha = 1 - p.life / p.max;
      ctx.fillStyle = p.color;
      ctx.fillRect(snap(p.x), snap(p.y), sz, sz);
    }
    ctx.globalAlpha = 1;
    // всплывающие цифры
    for (let i = floats.length - 1; i >= 0; i--) {
      const f = floats[i];
      const t = (now - f.t0) / f.dur;
      if (t >= 1) { floats.splice(i, 1); continue; }
      const c = cellCenter(f.x, f.y);
      const y = c.y - C * 0.45 - t * C * 0.6;
      const col = f.rainbow ? `hsl(${(now / 3) % 360},95%,65%)` : f.color;
      outlinedText(f.text, c.x, snap(y), col, t > 0.7 ? (1 - t) / 0.3 : 1);
    }
  }

  let lastFrame = nowMs();
  function frame() {
    requestAnimationFrame(frame);
    const now = nowMs();
    const dt = Math.min(0.05, (now - lastFrame) / 1000);
    lastFrame = now;
    updateTimer(now);
    if ($('game').classList.contains('hidden')) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = '#05070b';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    if (!view) return;
    let ox = 0, oy = 0;
    if (shake > 0.2) {
      ox = Math.round((Math.random() * 2 - 1) * shake) * S * 0.5;
      oy = Math.round((Math.random() * 2 - 1) * shake) * S * 0.5;
      ox = snap(ox); oy = snap(oy);
      shake *= Math.pow(0.02, dt);
    } else shake = 0;
    ctx.translate(ox, oy);
    drawBoard(now);
    drawHighlights(now);
    drawObjects(now);
    drawUnits(now);
    drawHover(now);
    drawFx(now, dt);
  }

  function updateTimer(now) {
    if (!state || !view) return;
    const el = $('timer');
    if (state.phase !== 'game') { el.textContent = '--'; el.classList.remove('warn'); $('timerFill').style.width = '0%'; return; }
    const left = Math.max(0, deadline - now);
    const sec = Math.ceil(left / 1000);
    if (el.textContent !== String(sec)) {
      el.textContent = String(sec);
      $('timerFill').style.width = (left / (R.TURN_SECONDS * 1000)) * 100 + '%';
    }
    el.classList.toggle('warn', sec <= 10);
    if (sec <= 5 && sec > 0 && sec !== lastTickSec && actingSide()) Sound.tick();
    lastTickSec = sec;
  }

  requestAnimationFrame(frame);
})();
