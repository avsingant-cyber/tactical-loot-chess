/* Процедурный звук на Web Audio API — без внешних аудиофайлов. */
const Sound = (() => {
  'use strict';
  let ac = null, master = null, noiseBuf = null;
  let muted = false;
  try { muted = localStorage.getItem('tlc_muted') === '1'; } catch (e) { /* ignore */ }
  const VOL = 0.5;

  function ensure() {
    if (!ac) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      ac = new AC();
      master = ac.createGain();
      master.gain.value = muted ? 0 : VOL;
      const comp = ac.createDynamicsCompressor();
      master.connect(comp);
      comp.connect(ac.destination);
      const len = ac.sampleRate;
      noiseBuf = ac.createBuffer(1, len, ac.sampleRate);
      const d = noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    }
    if (ac.state === 'suspended') ac.resume();
    return ac;
  }

  function env(g, t, vol, attack, dur) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, vol), t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  }

  function tone(o) {
    if (muted) return;
    const a = ensure();
    if (!a) return;
    const t = a.currentTime + (o.delay || 0);
    const osc = a.createOscillator();
    osc.type = o.type || 'square';
    osc.frequency.setValueAtTime(o.f, t);
    if (o.f2) osc.frequency.exponentialRampToValueAtTime(Math.max(1, o.f2), t + o.dur);
    const g = a.createGain();
    env(g, t, o.vol == null ? 0.2 : o.vol, o.attack || 0.004, o.dur);
    osc.connect(g); g.connect(master);
    osc.start(t); osc.stop(t + o.dur + 0.03);
  }

  function noise(o) {
    if (muted) return;
    const a = ensure();
    if (!a) return;
    const t = a.currentTime + (o.delay || 0);
    const src = a.createBufferSource();
    src.buffer = noiseBuf; src.loop = true;
    const flt = a.createBiquadFilter();
    flt.type = o.filter || 'lowpass';
    flt.frequency.setValueAtTime(o.f || 2000, t);
    if (o.f2) flt.frequency.exponentialRampToValueAtTime(o.f2, t + o.dur);
    flt.Q.value = o.q || 0.8;
    const g = a.createGain();
    env(g, t, o.vol == null ? 0.2 : o.vol, o.attack || 0.003, o.dur);
    src.connect(flt); flt.connect(g); g.connect(master);
    src.start(t); src.stop(t + o.dur + 0.05);
  }

  const notes = (seq, type, vol, gap) => {
    let t = 0;
    for (const [f, d] of seq) {
      if (f) {
        tone({ type, f, dur: d * 0.95, vol, delay: t });
        tone({ type: 'triangle', f: f / 2, dur: d * 0.95, vol: vol * 0.6, delay: t });
      }
      t += d + (gap || 0);
    }
  };

  return {
    unlock: ensure,
    select() { tone({ f: 660, f2: 990, dur: 0.06, vol: 0.1 }); },
    step() {
      noise({ f: 1100, dur: 0.045, vol: 0.12, filter: 'bandpass', q: 3 });
      tone({ type: 'triangle', f: 130, f2: 70, dur: 0.05, vol: 0.12 });
    },
    pickup(tier) {
      const t = tier || 0;
      const seq = [523, 659, 784, 1047, 1319, 1568].slice(0, 4 + Math.min(2, t));
      seq.forEach((f, i) => tone({ f: f * (1 + t * 0.06), dur: 0.08, vol: 0.1, delay: i * 0.055 }));
      if (t >= 2) tone({ type: 'triangle', f: 2093, dur: 0.25, vol: 0.06, delay: seq.length * 0.055 });
    },
    legendary(mythic) {
      notes(mythic
        ? [[784, 0.08], [988, 0.08], [1175, 0.08], [1568, 0.08], [1175, 0.08], [1568, 0.08], [2093, 0.4]]
        : [[659, 0.09], [784, 0.09], [988, 0.09], [1319, 0.35]], 'square', 0.08, 0.005);
      noise({ f: 8000, f2: 3000, dur: mythic ? 0.9 : 0.5, vol: 0.05, filter: 'highpass', delay: 0.1 });
    },
    laser() {
      tone({ type: 'sawtooth', f: 1500, f2: 180, dur: 0.18, vol: 0.12 });
      tone({ type: 'square', f: 760, f2: 90, dur: 0.15, vol: 0.05 });
    },
    sniper() {
      tone({ type: 'sawtooth', f: 2400, f2: 110, dur: 0.32, vol: 0.13 });
      noise({ f: 6000, f2: 400, dur: 0.22, vol: 0.12, filter: 'lowpass' });
    },
    shotgun() {
      noise({ f: 3500, f2: 180, dur: 0.38, vol: 0.5 });
      tone({ type: 'square', f: 170, f2: 40, dur: 0.25, vol: 0.22 });
    },
    explosion(big) {
      noise({ f: big ? 2000 : 1300, f2: 50, dur: big ? 0.95 : 0.5, vol: 0.6 });
      tone({ type: 'sine', f: 120, f2: 28, dur: big ? 0.8 : 0.4, vol: 0.5 });
    },
    hit() {
      tone({ type: 'square', f: 240, f2: 70, dur: 0.09, vol: 0.14 });
      noise({ f: 2600, dur: 0.06, vol: 0.12 });
    },
    shield() {
      tone({ type: 'sine', f: 900, f2: 1900, dur: 0.22, vol: 0.15 });
      tone({ type: 'triangle', f: 1300, f2: 600, dur: 0.25, vol: 0.1, delay: 0.06 });
    },
    heal() { [440, 554, 659, 880].forEach((f, i) => tone({ type: 'triangle', f, dur: 0.12, vol: 0.12, delay: i * 0.07 })); },
    jet() {
      noise({ f: 500, f2: 2800, dur: 0.48, vol: 0.28, filter: 'bandpass', q: 1.4 });
      tone({ type: 'sawtooth', f: 90, f2: 220, dur: 0.45, vol: 0.06 });
    },
    crate() {
      tone({ type: 'triangle', f: 300, f2: 620, dur: 0.12, vol: 0.12 });
      tone({ f: 940, dur: 0.05, vol: 0.07, delay: 0.13 });
    },
    mine() {
      tone({ type: 'square', f: 1250, dur: 0.03, vol: 0.09 });
      tone({ type: 'square', f: 820, dur: 0.03, vol: 0.09, delay: 0.08 });
    },
    turn() {
      tone({ type: 'triangle', f: 523, dur: 0.1, vol: 0.13 });
      tone({ type: 'triangle', f: 784, dur: 0.16, vol: 0.13, delay: 0.1 });
    },
    tick() { tone({ type: 'square', f: 1000, dur: 0.03, vol: 0.05 }); },
    error() {
      tone({ type: 'square', f: 150, dur: 0.1, vol: 0.1 });
      tone({ type: 'square', f: 110, dur: 0.14, vol: 0.1, delay: 0.09 });
    },
    victory() {
      notes([[523, 0.12], [659, 0.12], [784, 0.12], [1047, 0.28], [0, 0.06], [784, 0.12], [1047, 0.55]], 'square', 0.09, 0.01);
    },
    defeat() { notes([[392, 0.22], [349, 0.22], [311, 0.22], [262, 0.6]], 'square', 0.08, 0.02); },
    toggleMute() {
      muted = !muted;
      try { localStorage.setItem('tlc_muted', muted ? '1' : '0'); } catch (e) { /* ignore */ }
      if (master) master.gain.value = muted ? 0 : VOL;
      if (!muted) ensure();
      return muted;
    },
    isMuted() { return muted; },
  };
})();
