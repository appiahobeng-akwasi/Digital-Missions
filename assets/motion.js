/* Digital Missions — motion.
   Plates play as looping films with a transport bar, glyphs idle in small
   loops, fields of dots breathe behind the dark panels, and pages cut from
   one to the next. Runs only when <html> carries .motion, which the inline
   <head> script sets for readers who have not asked for reduced motion.
   One control — the transport bars and the footer switch — pauses all of it,
   and the choice is remembered. */
(() => {
  'use strict';

  const root = document.documentElement;
  window.DMMotion = true;

  const reducedQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
  const finePointer = window.matchMedia('(pointer: fine)');
  const stillAll = () => document.querySelectorAll('svg').forEach((s) => { if (s.pauseAnimations) s.pauseAnimations(); });

  if (reducedQuery.matches || !root.classList.contains('motion') ||
      !('IntersectionObserver' in window) || !Element.prototype.animate) {
    root.classList.remove('motion', 'intro');
    stillAll();
    return;
  }

  const EASE_DRAW = 'cubic-bezier(.65,0,.35,1)';
  const EASE_OUT = 'cubic-bezier(.16,1,.3,1)';
  const EASE_SLASH = 'cubic-bezier(.7,0,.84,0)';
  const HERO = { stagger: 110, dur: 1000, delay: 250 };
  const PILLAR = { stagger: 90, dur: 900, delay: 0 };
  const GLYPH = { stagger: 55, dur: 650, delay: 0 };
  const STORE = 'dm-motion';
  const NS = 'http://www.w3.org/2000/svg';

  const tickers = [];
  const toggles = [];
  const pendingFilms = [];
  let paused = root.classList.contains('motion-paused');
  let dead = false;

  const stop = (err) => {
    dead = true;
    root.classList.remove('motion', 'intro');
    document.querySelectorAll('.dm-intro, canvas.dm-field').forEach((n) => n.remove());
    stillAll();
    if (err && window.console) console.error(err);
  };

  const el = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text) n.textContent = text;
    return n;
  };
  const svgEl = (tag, attrs) => {
    const n = document.createElementNS(NS, tag);
    Object.entries(attrs || {}).forEach(([k, v]) => n.setAttribute(k, v));
    return n;
  };

  /* ================================================================ draw */

  const drawable = (svg) => {
    const out = [];
    const walk = (node) => {
      const tag = node.tagName.toLowerCase();
      if (tag === 'title' || tag === 'desc' || tag === 'defs') return;
      const cl = node.classList;
      if (cl.contains('fx') || cl.contains('fx-hide') || cl.contains('dm-cross')) return;
      if (tag === 'g') { Array.from(node.children).forEach(walk); return; }
      out.push(node);
    };
    Array.from(svg.children).forEach(walk);
    return out;
  };

  const scaleOf = (node) => {
    const m = node.getScreenCTM();
    return m ? (Math.hypot(m.a, m.b) || 1) : 1;
  };

  function drawIn(svg, o) {
    if (svg._busy) return svg._busy;
    svg.classList.add('is-drawn');
    const anims = [];
    let t = o.delay;
    let objectEnd = t;

    drawable(svg).forEach((node) => {
      const tag = node.tagName.toLowerCase();
      const cs = getComputedStyle(node);
      let a;
      if (tag === 'text') {
        a = node.animate(
          [{ opacity: 0, transform: 'translateY(6px)' }, { opacity: 1, transform: 'none' }],
          { duration: 700, delay: t + o.dur * 0.3, easing: EASE_OUT, fill: 'backwards' });
      } else if (cs.stroke === 'none') {
        node.style.transformBox = 'fill-box';
        node.style.transformOrigin = 'center';
        a = node.animate(
          [{ opacity: 0, transform: 'scale(0)' },
           { opacity: 1, transform: 'scale(1.5)', offset: 0.55 },
           { opacity: 1, transform: 'scale(1)' }],
          { duration: 520, delay: t + o.dur * 0.35, easing: EASE_OUT, fill: 'backwards' });
      } else if (node.getAttribute('stroke-dasharray') || !node.getTotalLength) {
        a = node.animate([{ opacity: 0 }, { opacity: 1 }],
          { duration: o.dur, delay: t, easing: 'linear', fill: 'backwards' });
      } else {
        /* Dash lengths are unambiguous only in user units, so non-scaling
           strokes are drawn as scaling strokes of the same on-screen width. */
        const len = node.getTotalLength();
        const sw = (parseFloat(cs.strokeWidth) || 1) / scaleOf(node);
        const k = { strokeDasharray: `${len} ${len}`, vectorEffect: 'none', strokeWidth: `${sw}px` };
        const strike = node.classList.contains('glyph-strike');
        a = node.animate(
          [Object.assign({ strokeDashoffset: len }, k), Object.assign({ strokeDashoffset: 0 }, k)],
          strike
            ? { duration: Math.round(o.dur * 0.5), delay: objectEnd + 140, easing: EASE_SLASH, fill: 'backwards' }
            : { duration: o.dur, delay: t, easing: EASE_DRAW, fill: 'backwards' });
      }
      objectEnd = Math.max(objectEnd, t + o.dur);
      anims.push(a);
      t += o.stagger;
    });

    svg._busy = Promise.all(anims.map((a) => a.finished))
      .catch(() => {})
      .then(() => { svg._busy = null; });
    return svg._busy;
  }

  /* ============================================================== clocks */

  const fmt = (s) => {
    const n = Math.floor(s);
    return `${String(Math.floor(n / 60)).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}`;
  };

  class Ticker {
    constructor(node) {
      Object.assign(this, { el: node, started: false, visible: false, running: false });
      tickers.push(this);
    }
    sync() {
      this.running = this.started && this.visible && !paused && !document.hidden && !dead;
      if (this.running) this.play(); else this.pause();
    }
    play() {}
    pause() {}
  }

  /* Nested <svg> elements keep their own SMIL clocks, so a film drives them too */
  const clocks = (svg) => [svg, ...svg.querySelectorAll('svg')];

  /* An SVG with SMIL loops: films (with a transport bar) and glyphs (without) */
  class SvgLoop extends Ticker {
    constructor(svg, loop, label) {
      super(svg);
      Object.assign(this, { loop, label, still: parseFloat(svg.dataset.still || '0') });
      clocks(svg).forEach((c) => { c.pauseAnimations(); c.setCurrentTime(0); });
    }
    begin() {
      this.started = true;
      const t = paused ? this.still : 0;
      clocks(this.el).forEach((c) => c.setCurrentTime(t));
      this.el.classList.add('is-live');
      this.sync();
    }
    play() { clocks(this.el).forEach((c) => c.unpauseAnimations()); }
    pause() { clocks(this.el).forEach((c) => c.pauseAnimations()); }
    time() { return this.el.getCurrentTime(); }
  }

  /* A timeline driven from script: the lifecycle chapters and the map scan */
  class ClockScene extends Ticker {
    constructor(node, loop, label, tick, still, hooks) {
      super(node);
      Object.assign(this, { loop, label, tick, t: 0, still: still || 0, hooks: hooks || {} });
    }
    begin() {
      this.started = true;
      this.t = paused ? this.still : 0;
      this.tick(this.t % this.loop);
      this.sync();
    }
    play() { if (this.hooks.play) this.hooks.play(); }
    pause() { if (this.hooks.pause) this.hooks.pause(); }
    time() { return this.t; }
    advance(dt) {
      this.t += dt;
      this.tick(this.t % this.loop);
    }
  }

  let rafId = 0;
  let last = 0;
  function frame(now) {
    const dt = last ? Math.min(0.1, (now - last) / 1000) : 0;
    last = now;
    let any = false;
    tickers.forEach((s) => {
      if (s.running) {
        any = true;
        if (s.advance) s.advance(dt);
      }
      if (s.bar && s.started) s.bar.update(s.time());
    });
    if (any && !dead) {
      rafId = requestAnimationFrame(frame);
    } else {
      rafId = 0;
      last = 0;
    }
  }
  const kick = () => { if (!rafId && !dead) rafId = requestAnimationFrame(frame); };
  const syncAll = () => { tickers.forEach((s) => s.sync()); kick(); };

  function setPaused(v) {
    paused = v;
    try { localStorage.setItem(STORE, v ? 'paused' : 'playing'); } catch (e) { /* storage blocked */ }
    root.classList.toggle('motion-paused', v);
    document.querySelectorAll('.scene-bar__btn').forEach((b) => b.setAttribute('aria-pressed', String(v)));
    toggles.forEach((u) => u());
    if (v) document.querySelectorAll('[data-tilt], .btn').forEach((n) => { n.style.transform = ''; n.style.translate = ''; });
    syncAll();
  }

  /* ======================================================= transport bar */

  function makeBar(scene, n) {
    const bar = el('div', 'scene-bar');
    const btn = el('button', 'scene-bar__btn');
    btn.type = 'button';
    btn.setAttribute('aria-pressed', String(paused));
    const icon = el('span', 'scene-bar__icon');
    icon.setAttribute('aria-hidden', 'true');
    btn.append(icon, el('span', 'dm-sr', 'Pause animations'));
    btn.addEventListener('click', () => setPaused(!paused));

    const label = el('span', 'scene-bar__label');
    label.append(el('span', 'scene-bar__fig', `Fig. ${String(n).padStart(2, '0')}`),
                 el('span', 'scene-bar__name', ` — ${scene.label}`));
    const time = el('span', 'scene-bar__time', `00:00 / ${fmt(scene.loop)}`);
    const track = el('span', 'scene-bar__track');
    const fill = el('span', 'scene-bar__fill');
    track.append(fill);
    [time, track].forEach((x) => x.setAttribute('aria-hidden', 'true'));
    bar.append(btn, label, time, track);

    let lastS = -1;
    bar.update = (t) => {
      const local = t % scene.loop;
      fill.style.transform = `scaleX(${local / scene.loop})`;
      const s = Math.floor(local);
      if (s !== lastS) { time.textContent = `${fmt(s)} / ${fmt(scene.loop)}`; lastS = s; }
    };
    scene.bar = bar;
    return bar;
  }

  /* Films start (draw, then loop) the first time they are a quarter in view */
  const filmIO = new IntersectionObserver((entries) => {
    entries.forEach((e) => {
      const s = e.target._scene;
      s.visible = e.isIntersecting;
      if (s.visible && !s.started && !s.starting) {
        s.starting = true;
        s.intro().then(() => { s.begin(); kick(); });
      }
      s.sync();
    });
    kick();
  }, { threshold: 0.25 });

  /* Loops and fields only need to know whether they are on screen */
  const visIO = new IntersectionObserver((entries) => {
    entries.forEach((e) => { const s = e.target._ticker; if (s) { s.visible = e.isIntersecting; s.sync(); } });
    kick();
  }, { threshold: 0 });

  function registerFilm(scene, n) {
    scene.el._scene = scene;
    pendingFilms.push(scene);
    return makeBar(scene, n);
  }

  function plateFilms() {
    let n = 0;
    document.querySelectorAll('svg.plate[data-loop]').forEach((svg) => {
      const cls = ['hero-plate', 'pillar-plate'].find((c) => svg.classList.contains(c));
      const fig = el('figure', `scene ${cls || ''}`.trim());
      if (cls) svg.classList.remove(cls);
      svg.replaceWith(fig);
      fig.append(svg);
      const title = svg.querySelector('title');
      const scene = new SvgLoop(svg, parseFloat(svg.dataset.loop), title ? title.textContent.trim() : 'Plate');
      scene.intro = () => drawIn(svg, cls === 'pillar-plate' ? PILLAR : HERO);
      fig.append(registerFilm(scene, ++n));
    });
    return n;
  }

  /* Glyph loops: drawn on reveal, then idle in their own small loop */
  function glyphLoop(svg) {
    if (svg._ticker || !svg.querySelector(':scope > .fx')) return;
    const loop = new SvgLoop(svg, parseFloat(svg.dataset.fxLoop || '6'), '');
    svg._ticker = loop;
    visIO.observe(svg);
    loop.visible = true;
    loop.begin();
    kick();
  }
  function drawGlyph(svg) {
    return drawIn(svg, GLYPH).then(() => glyphLoop(svg));
  }

  /* ============================================================ lifecycle */

  function lifecycleScene(n) {
    const lc = document.querySelector('.lifecycle');
    if (!lc) return n;
    const stages = Array.from(lc.querySelectorAll('.lifecycle-stage'));
    if (!stages.length) return n;
    const per = 3;
    const fills = stages.map((st) => {
      const seg = el('span', 'lc-seg');
      seg.setAttribute('aria-hidden', 'true');
      const f = el('span');
      seg.append(f);
      st.prepend(seg);
      return f;
    });
    let cur = -1;
    const scene = new ClockScene(lc, per * stages.length, 'The mission lifecycle', (t) => {
      const i = Math.min(stages.length - 1, Math.floor(t / per));
      fills.forEach((f, k) => {
        f.style.transform = `scaleX(${k < i ? 1 : k > i ? 0 : (t - i * per) / per})`;
      });
      if (i !== cur) {
        if (cur >= 0) stages[cur].classList.remove('is-active');
        stages[i].classList.add('is-active');
        cur = i;
        const g = stages[i].querySelector('svg.plate');
        if (g && !paused && g.classList.contains('is-drawn')) drawGlyph(g);
      }
    }, per * stages.length - 0.001);
    scene.intro = () => Promise.resolve();
    lc.after(registerFilm(scene, ++n));
    return n;
  }

  /* ================================================================== map */

  function mapScene(n) {
    const svg = document.querySelector('svg.ecowas-map');
    if (!svg) return n;
    const vb = svg.viewBox.baseVal;
    if (svg.pauseAnimations) { svg.pauseAnimations(); svg.setCurrentTime(0); }
    const countries = Array.from(svg.querySelectorAll('.country')).map((g) => {
      const b = g.getBBox();
      return { g, x: b.x + b.width / 2 };
    }).sort((a, b) => a.x - b.x);

    const defs = svgEl('defs');
    const grad = svgEl('linearGradient', { id: 'dm-scan-fade' });
    [['0', '0'], ['1', '0.16']].forEach(([off, op]) => grad.append(svgEl('stop', { offset: off, 'stop-color': 'currentColor', 'stop-opacity': op })));
    defs.append(grad);
    const scan = svgEl('g', { class: 'map-scan', 'aria-hidden': 'true' });
    scan.append(
      svgEl('rect', { x: '-110', y: String(vb.y), width: '110', height: String(vb.height), fill: 'url(#dm-scan-fade)' }),
      svgEl('line', { x1: '0', y1: String(vb.y), x2: '0', y2: String(vb.y + vb.height) }));
    svg.prepend(defs);
    const fx = svg.querySelector(':scope > .fx');
    if (fx) svg.insertBefore(scan, fx); else svg.append(scan);

    const SWEEP = 6;
    const FADE = 9;
    const x0 = vb.x - 20;
    const span = vb.width + 40;
    const scene = new ClockScene(svg, 10, 'Phase 01, West Africa', (t) => {
      const x = t < SWEEP ? x0 + (t / SWEEP) * span : x0 + span + 200;
      scan.setAttribute('transform', `translate(${x.toFixed(1)} 0)`);
      scan.style.opacity = t < SWEEP ? '1' : '0';
      countries.forEach((c) => c.g.classList.toggle('is-lit', t < FADE && x >= c.x));
    }, 7.5, {
      play: () => { if (svg.unpauseAnimations) svg.unpauseAnimations(); },
      pause: () => { if (svg.pauseAnimations) svg.pauseAnimations(); },
    });
    scene.intro = () => {
      svg.classList.add('is-drawn');
      const anims = [];
      countries.forEach((c, i) => {
        c.g.querySelectorAll('path').forEach((p) => {
          const len = p.getTotalLength();
          const k = { strokeDasharray: `${len} ${len}` };
          anims.push(p.animate([
            Object.assign({ strokeDashoffset: len, fillOpacity: 0 }, k),
            Object.assign({ strokeDashoffset: 0, fillOpacity: 0, offset: 0.7 }, k),
            Object.assign({ strokeDashoffset: 0, fillOpacity: 1 }, k),
          ], { duration: 1500, delay: i * 90, easing: EASE_DRAW, fill: 'backwards' }).finished);
        });
        c.g.querySelectorAll('text').forEach((tx) => {
          anims.push(tx.animate([{ opacity: 0 }, { opacity: 1 }],
            { duration: 500, delay: 900 + i * 90, easing: 'linear', fill: 'backwards' }).finished);
        });
      });
      return Promise.all(anims).catch(() => {}).then(() => {
        svg.classList.add('is-live');
        if (svg.setCurrentTime) svg.setCurrentTime(0);
      });
    };
    const cap = svg.parentElement.querySelector('.ecowas-map__caption');
    const bar = registerFilm(scene, ++n);
    if (cap) cap.before(bar); else svg.after(bar);
    return n;
  }

  /* =============================================================== fields */

  const rgbOf = (name) => {
    let hex = getComputedStyle(root).getPropertyValue(name).trim().replace('#', '');
    if (hex.length === 3) hex = hex.split('').map((c) => c + c).join('');
    const v = parseInt(hex || '888888', 16);
    return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
  };
  const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

  /* A breathing field of dots on a canvas behind a panel. Batched by
     brightness so each frame is a handful of fills, not thousands. */
  class DotField extends Ticker {
    constructor(host, o) {
      super(host);
      Object.assign(this, { o, t: 0, mx: -1e4, my: -1e4, pts: [] });
      const c = el('canvas', `dm-field ${o.cls || ''}`);
      c.setAttribute('aria-hidden', 'true');
      host.prepend(c);
      this.c = c;
      this.ctx = c.getContext('2d');
      host._ticker = this;
      if ('ResizeObserver' in window) new ResizeObserver(() => this.resize()).observe(host);
      host.addEventListener('pointermove', (e) => {
        if (e.pointerType !== 'mouse') return;
        const r = c.getBoundingClientRect();
        this.mx = e.clientX - r.left;
        this.my = e.clientY - r.top;
      }, { passive: true });
      host.addEventListener('pointerleave', () => { this.mx = -1e4; this.my = -1e4; });
      this.resize();
      visIO.observe(host);
      this.started = true;
      requestAnimationFrame(() => c.classList.add('is-on'));
    }
    resize() {
      const r = this.el.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
      this.w = r.width;
      this.h = r.height;
      this.c.width = Math.max(1, Math.round(r.width * dpr));
      this.c.height = Math.max(1, Math.round(r.height * dpr));
      this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      if (this.o.origin) this.origin = this.o.origin(this);
      const s = this.o.spacing;
      this.pts = [];
      for (let y = s / 2; y < this.h; y += s) {
        for (let x = s / 2; x < this.w; x += s) {
          const m = this.o.mask(x / this.w, y / this.h, this);
          if (m > 0.02) this.pts.push(x, y, m);
        }
      }
      this.render();
    }
    advance(dt) {
      this.t += dt;
      this.acc = (this.acc || 0) + dt;
      if (this.acc < 1 / 30) return;
      this.acc = 0;
      this.render();
    }
    pause() { this.render(); }
    render() {
      const { ctx, o, t } = this;
      const B = 7;
      ctx.clearRect(0, 0, this.w, this.h);
      const paths = Array.from({ length: B }, () => new Path2D());
      const peak = new Path2D();
      const cr = o.cursor * o.cursor;
      const live = !paused;
      for (let i = 0; i < this.pts.length; i += 3) {
        const x = this.pts[i];
        const y = this.pts[i + 1];
        let v = o.field(x, y, t, this);
        if (live) {
          const dx = x - this.mx;
          const dy = y - this.my;
          v = Math.max(v, Math.exp(-(dx * dx + dy * dy) / cr));
        }
        v *= this.pts[i + 2];
        if (v < 0.05) continue;
        const r = o.r0 + v * o.r1;
        const p = v > 0.88 && o.peak ? peak : paths[Math.min(B - 1, (v * B) | 0)];
        p.moveTo(x + r, y);
        p.arc(x, y, r, 0, 6.2832);
      }
      const [R, G, Bl] = o.rgb();
      paths.forEach((p, b) => {
        ctx.fillStyle = `rgba(${R},${G},${Bl},${(o.a0 + ((b + 0.5) / B) * o.a1).toFixed(3)})`;
        ctx.fill(p);
      });
      if (o.peak) {
        const [pr, pg, pb] = o.peak();
        ctx.fillStyle = `rgba(${pr},${pg},${pb},${o.peakAlpha || 0.8})`;
        ctx.fill(peak);
      }
    }
  }

  const wave = (x, y, t) => {
    const u = x * 0.011;
    const w = y * 0.017;
    const s = 0.5 + 0.5 * Math.sin(u * 1.3 - t * 0.8 + Math.sin(w + t * 0.3) * 1.7) * Math.cos(w * 0.9 + t * 0.45 - u * 0.4);
    return s * s;
  };

  function fields() {
    const wide = window.matchMedia('(min-width: 700px)').matches;
    document.querySelectorAll('.dark-block').forEach((host) => new DotField(host, {
      cls: 'dm-field--dark', spacing: 16, r0: 0.5, r1: 1.8, a0: 0.06, a1: 0.62, cursor: 130,
      rgb: () => rgbOf('--color-dark-muted'),
      mask: (nx) => (wide ? smooth(0.42, 0.95, nx) : 0.35 + 0.4 * smooth(0.2, 1, nx)),
      field: wave,
    }));

    const mark = document.querySelector('.big-wordmark');
    if (mark) new DotField(mark, {
      cls: 'dm-field--light', spacing: 15, r0: 0.4, r1: 1.3, a0: 0.03, a1: 0.35, cursor: 110,
      rgb: () => rgbOf('--color-text-muted'),
      peak: () => rgbOf('--color-accent'), peakAlpha: 0.7,
      mask: (nx) => smooth(0.5, 1, nx) * 0.9,
      field: (x, y, t) => wave(x * 1.2, y * 1.4, t * 0.8),
    });

    const hero = document.querySelector('.hero-soft');
    const plate = hero && hero.querySelector('figure.hero-plate');
    if (hero && plate && window.matchMedia('(min-width: 1100px)').matches) new DotField(hero, {
      cls: 'dm-field--hero', spacing: 18, r0: 0.4, r1: 1.4, a0: 0.02, a1: 0.32, cursor: 100,
      rgb: () => rgbOf('--color-text-muted'),
      peak: () => rgbOf('--color-accent'), peakAlpha: 0.55,
      origin: (f) => {
        const a = plate.getBoundingClientRect();
        const b = f.el.getBoundingClientRect();
        return { x: a.left - b.left + a.width / 2, y: a.top - b.top + a.height / 2, R: Math.max(a.width, a.height) * 0.95 };
      },
      mask: (nx, ny, f) => {
        const o = f.origin;
        const d = Math.hypot(nx * f.w - o.x, ny * f.h - o.y);
        return smooth(0.45, 0.6, nx) * (1 - smooth(o.R * 0.55, o.R, d));
      },
      field: (x, y, t, f) => {
        const o = f.origin;
        const d = Math.hypot(x - o.x, y - o.y);
        let v = 0;
        for (let k = 0; k < 2; k++) {
          const ph = ((t / 4 + k / 2) % 1);
          const R = ph * o.R;
          const q = (d - R) / 18;
          v = Math.max(v, Math.exp(-q * q) * (1 - ph));
        }
        return v;
      },
    });
  }

  /* ================================================================= type */

  function splitWords(node) {
    if (node.classList.contains('is-split')) return 0;
    const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
    const texts = [];
    while (walker.nextNode()) texts.push(walker.currentNode);
    let i = 0;
    texts.forEach((tn) => {
      const frag = document.createDocumentFragment();
      tn.nodeValue.split(/(\s+)/).forEach((part) => {
        if (!part) return;
        if (/^\s+$/.test(part)) { frag.append(part); return; }
        const w = el('span', 'w');
        const inner = el('span', 'w__i', part);
        inner.style.setProperty('--wi', i++);
        w.append(inner);
        frag.append(w);
      });
      tn.replaceWith(frag);
    });
    node.classList.add('is-split');
    return i;
  }

  const GLYPHS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  function scrambleText(node, final, dur, done) {
    const t0 = performance.now();
    const step = (now) => {
      const p = Math.min(1, (now - t0) / dur);
      const fixed = Math.floor(p * final.length);
      let s = final.slice(0, fixed);
      for (let k = fixed; k < final.length; k++) {
        const c = final[k];
        s += /[A-Za-z0-9]/.test(c) ? GLYPHS[(Math.random() * GLYPHS.length) | 0] : c;
      }
      node.textContent = s;
      if (p < 1) requestAnimationFrame(step); else if (done) done();
    };
    requestAnimationFrame(step);
  }

  function scramble(tag) {
    tag.classList.add('is-in');
    if (tag.children.length || !tag.textContent.trim()) return;
    const final = tag.textContent;
    const vis = el('span');
    vis.setAttribute('aria-hidden', 'true');
    tag.textContent = '';
    tag.append(el('span', 'dm-sr', final), vis);
    scrambleText(vis, final, Math.min(900, 280 + final.length * 22));
  }

  function odometer(num) {
    const tn = Array.from(num.childNodes).find((c) => c.nodeType === 3 && /\d/.test(c.nodeValue));
    if (!tn) return;
    const text = tn.nodeValue.trim();
    const roll = el('span', 'roll');
    roll.setAttribute('aria-hidden', 'true');
    let c = 0;
    Array.from(text).forEach((ch) => {
      if (!/\d/.test(ch)) { roll.append(ch); return; }
      const col = el('span', 'roll__col');
      const strip = el('span', 'roll__strip');
      const d = Number(ch);
      for (let k = 0; k <= 10 + d; k++) strip.append(el('span', '', String(k % 10)));
      strip.style.setProperty('--to', 10 + d);
      strip.style.setProperty('--c', c++);
      col.append(strip);
      roll.append(col);
    });
    tn.replaceWith(el('span', 'dm-sr', text), roll);
  }

  /* ============================================================== reveals */

  const ITEMS = '.card, .summary-card, .argument-card, .funder-row, .audience, .stat, .lifecycle-stage, .glossary-term, .post-row';
  const SELF = 'main header, .pillar-intro, .dark-block .container > p, .dark-block .container > .btn, .big-wordmark .container';

  function reveals() {
    const io = new IntersectionObserver((entries) => {
      entries.forEach((e) => {
        if (!e.isIntersecting) return;
        const t = e.target;
        io.unobserve(t);
        if (t.matches('.hero-tag')) { scramble(t); return; }
        if (t.matches('svg.plate')) { drawGlyph(t); return; }
        t.classList.add(t.classList.contains('is-split') ? 'w-in' : 'is-in');
      });
    }, { threshold: 0.12, rootMargin: '0px 0px -6% 0px' });

    document.querySelectorAll(ITEMS).forEach((item) => {
      if (item.closest('.hero-soft')) return;
      const sibs = Array.from(item.parentElement.children).filter((s) => s.matches(ITEMS));
      item.setAttribute('data-reveal', '');
      item.style.setProperty('--i', Math.min(sibs.indexOf(item), 8));
      Array.from(item.children).forEach((ch, j) => ch.style.setProperty('--j', Math.min(j, 5)));
      io.observe(item);
    });
    document.querySelectorAll(SELF).forEach((n) => {
      if (n.closest('[data-reveal]') || n.closest('.hero-soft')) return;
      n.setAttribute('data-reveal-self', '');
      io.observe(n);
    });
    document.querySelectorAll('.hero-tag').forEach((t) => { if (!t.closest('.hero-soft')) io.observe(t); });
    document.querySelectorAll('main h2').forEach((h) => {
      if (h.closest('.hero-soft') || h.closest('[data-reveal]')) return;
      splitWords(h);
      io.observe(h);
    });

    document.querySelectorAll('svg.plate:not([data-loop])').forEach((svg) => {
      if (svg.querySelector(':scope > .fx')) svg.pauseAnimations();
      io.observe(svg);
      const host = svg.closest('.card, .summary-card, .argument-card, .lifecycle-stage, .audience') || svg.parentElement;
      host.addEventListener('pointerenter', (e) => {
        if (e.pointerType === 'mouse' && !paused && svg.classList.contains('is-drawn')) drawGlyph(svg);
      });
    });

    /* Phase 01 is live */
    document.querySelectorAll('.card__index').forEach((ix) => {
      if (/\bActive\b/.test(ix.textContent)) {
        const dot = el('span', 'dm-live');
        dot.setAttribute('aria-hidden', 'true');
        ix.prepend(dot);
      }
    });
  }

  function hero() {
    const h = document.querySelector('.hero-soft');
    if (!h) return;
    const tag = h.querySelector('.hero-tag');
    const h1 = h.querySelector('h1');
    const words = h1 ? splitWords(h1) : 0;
    h.style.setProperty('--d-after', `${150 + words * 45 + 250}ms`);
    requestAnimationFrame(() => requestAnimationFrame(() => {
      if (tag) scramble(tag);
      if (h1) h1.classList.add('w-in');
      h.classList.add('is-in');
    }));
  }

  /* ========================================================= interaction */

  function spotlight() {
    if (!finePointer.matches) return;
    document.querySelectorAll('[data-reveal]').forEach((item) => {
      item.addEventListener('pointermove', (e) => {
        const r = item.getBoundingClientRect();
        item.style.setProperty('--mx', `${e.clientX - r.left}px`);
        item.style.setProperty('--my', `${e.clientY - r.top}px`);
      }, { passive: true });
    });
  }

  /* Plates lean toward the pointer; a CAD crosshair reads out coordinates */
  function tilt() {
    if (!finePointer.matches) return;
    document.querySelectorAll('figure.scene').forEach((fig) => {
      const svg = fig.querySelector('svg.plate');
      if (!svg) return;
      fig.setAttribute('data-tilt', '');
      const vb = svg.viewBox.baseVal;
      const cross = svgEl('g', { class: 'dm-cross', 'aria-hidden': 'true' });
      const h = svgEl('line', { x1: vb.x, x2: vb.x + vb.width, y1: 0, y2: 0 });
      const v = svgEl('line', { y1: vb.y, y2: vb.y + vb.height, x1: 0, x2: 0 });
      const read = svgEl('text', { x: 0, y: 0 });
      cross.append(h, v, read);
      svg.append(cross);
      const big = fig.classList.contains('hero-plate');
      fig.addEventListener('pointermove', (e) => {
        if (paused || e.pointerType !== 'mouse') return;
        const r = fig.getBoundingClientRect();
        const px = (e.clientX - r.left) / r.width - 0.5;
        const py = (e.clientY - r.top) / r.height - 0.5;
        const k = big ? 7 : 9;
        fig.style.transform = `perspective(900px) rotateY(${(px * k).toFixed(2)}deg) rotateX(${(-py * k).toFixed(2)}deg)`;
        const m = svg.getScreenCTM();
        if (!m) return;
        const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(m.inverse());
        if (p.x < vb.x || p.y < vb.y || p.x > vb.x + vb.width || p.y > vb.y + vb.height) { cross.classList.remove('is-on'); return; }
        h.setAttribute('y1', p.y); h.setAttribute('y2', p.y);
        v.setAttribute('x1', p.x); v.setAttribute('x2', p.x);
        const flip = p.x > vb.x + vb.width * 0.72;
        read.setAttribute('x', p.x + (flip ? -8 : 8));
        read.setAttribute('y', p.y - 8);
        read.setAttribute('text-anchor', flip ? 'end' : 'start');
        read.textContent = `X ${Math.round(p.x)}  Y ${Math.round(p.y)}`;
        cross.classList.add('is-on');
      });
      fig.addEventListener('pointerleave', () => {
        fig.style.transform = '';
        cross.classList.remove('is-on');
      });
    });
  }

  function magnetic() {
    if (!finePointer.matches) return;
    document.querySelectorAll('.btn').forEach((b) => {
      b.addEventListener('pointermove', (e) => {
        if (paused || e.pointerType !== 'mouse') return;
        const r = b.getBoundingClientRect();
        const dx = (e.clientX - (r.left + r.width / 2)) * 0.16;
        const dy = (e.clientY - (r.top + r.height / 2)) * 0.28;
        b.style.transform = `translate(${dx.toFixed(1)}px, ${dy.toFixed(1)}px)`;
      });
      b.addEventListener('pointerleave', () => { b.style.transform = ''; });
    });
  }

  function navDecode() {
    if (!finePointer.matches) return;
    document.querySelectorAll('.primary-nav a').forEach((a) => {
      if (a.children.length) return;
      const txt = a.textContent.trim();
      a.setAttribute('aria-label', txt);
      let busy = false;
      a.addEventListener('pointerenter', () => {
        if (paused || busy) return;
        busy = true;
        a.style.minWidth = `${a.offsetWidth}px`;
        scrambleText(a, txt, 320, () => { busy = false; a.style.minWidth = ''; });
      });
    });
  }

  function parallax() {
    const fig = document.querySelector('.hero-soft figure.hero-plate');
    if (!fig) return;
    let queued = false;
    const update = () => {
      queued = false;
      const y = Math.min(window.scrollY, 900);
      fig.style.translate = paused ? '' : `0 ${(y * -0.12).toFixed(1)}px`;
    };
    window.addEventListener('scroll', () => { if (!queued) { queued = true; requestAnimationFrame(update); } }, { passive: true });
  }

  /* ============================================================== chrome */

  function playhead() {
    const bar = el('div', 'dm-playhead');
    bar.setAttribute('aria-hidden', 'true');
    const fill = el('span');
    bar.append(fill);
    document.body.prepend(bar);
    let queued = false;
    const update = () => {
      queued = false;
      const max = document.documentElement.scrollHeight - window.innerHeight;
      fill.style.transform = `scaleX(${max > 0 ? Math.min(1, window.scrollY / max) : 0})`;
    };
    window.addEventListener('scroll', () => { if (!queued) { queued = true; requestAnimationFrame(update); } }, { passive: true });
    window.addEventListener('resize', update, { passive: true });
    update();
  }

  function footerSwitch() {
    const ul = document.querySelector('.site-footer ul');
    if (!ul) return;
    const li = el('li');
    const b = el('button', 'motion-switch');
    b.type = 'button';
    const dot = el('span', 'motion-switch__dot');
    dot.setAttribute('aria-hidden', 'true');
    const label = el('span');
    b.append(dot, label);
    const update = () => { label.textContent = paused ? 'Motion off' : 'Motion on'; };
    b.addEventListener('click', () => setPaused(!paused));
    toggles.push(update);
    update();
    li.append(b);
    ul.append(li);
  }

  /* A title card on the first page of a visit, like a film leader */
  function titleCard() {
    if (!root.classList.contains('intro')) return Promise.resolve();
    try { sessionStorage.setItem('dm-intro', '1'); } catch (e) { /* storage blocked */ }
    const card = el('div', 'dm-intro');
    card.setAttribute('aria-hidden', 'true');
    const mark = el('div', 'dm-intro__mark', ' ');
    const line = el('div', 'dm-intro__line');
    const meta = el('div', 'dm-intro__meta', '00:00:00:00');
    const tag = el('div', 'dm-intro__tag', 'Foundational data infrastructure · West Africa');
    card.append(mark, line, meta, tag);
    document.body.append(card);
    root.classList.remove('intro');
    return new Promise((resolve) => {
      let done = false;
      const t0 = performance.now();
      const finish = () => {
        if (done) return;
        done = true;
        removeEventListener('keydown', finish);
        card.classList.add('is-out');
        setTimeout(() => card.remove(), 700);
        resolve();
      };
      addEventListener('keydown', finish);
      card.addEventListener('pointerdown', finish);
      requestAnimationFrame(() => card.classList.add('is-in'));
      scrambleText(mark, 'Digital Missions', 620);
      const tc = () => {
        if (done) return;
        const ms = performance.now() - t0;
        meta.textContent = `00:00:${String(Math.floor(ms / 1000)).padStart(2, '0')}:${String(Math.floor((ms / 1000) * 24) % 24).padStart(2, '0')}`;
        requestAnimationFrame(tc);
      };
      tc();
      setTimeout(finish, 1300);
    });
  }

  /* ================================================================ boot */

  try {
    document.querySelectorAll('.stat__num').forEach(odometer);
    let n = plateFilms();
    n = lifecycleScene(n);
    mapScene(n);
    playhead();
    footerSwitch();
    titleCard().then(() => {
      try {
        pendingFilms.forEach((s) => filmIO.observe(s.el));
        hero();
        reveals();
        fields();
        spotlight();
        tilt();
        magnetic();
        navDecode();
        parallax();
        kick();
      } catch (err) { stop(err); }
    });
    document.addEventListener('visibilitychange', syncAll);
    const onReduce = (e) => { if (e.matches) stop(); };
    if (reducedQuery.addEventListener) reducedQuery.addEventListener('change', onReduce);
  } catch (err) {
    stop(err);
  }
})();
