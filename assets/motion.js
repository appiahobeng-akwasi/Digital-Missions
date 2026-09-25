/* Digital Missions — motion.
   Plates play as short looping films with a transport bar; everything else
   enters once and then holds still. Runs only when <html> carries .motion,
   which the inline <head> script sets for readers who have not asked for
   reduced motion. One Pause control stops every loop on every page. */
(() => {
  'use strict';

  const root = document.documentElement;
  window.DMMotion = true;

  const reducedQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
  const stillAll = () => document.querySelectorAll('svg').forEach((s) => { if (s.pauseAnimations) s.pauseAnimations(); });

  if (reducedQuery.matches || !root.classList.contains('motion') ||
      !('IntersectionObserver' in window) || !Element.prototype.animate) {
    root.classList.remove('motion');
    stillAll();
    return;
  }

  const EASE_DRAW = 'cubic-bezier(.65,0,.35,1)';
  const EASE_OUT = 'cubic-bezier(.16,1,.3,1)';
  const EASE_SLASH = 'cubic-bezier(.7,0,.84,0)';
  const HERO = { stagger: 110, dur: 1000, delay: 350 };
  const PILLAR = { stagger: 90, dur: 900, delay: 0 };
  const GLYPH = { stagger: 55, dur: 650, delay: 0 };
  const STORE = 'dm-motion';

  const scenes = [];
  let paused = false;
  let dead = false;
  try { paused = localStorage.getItem(STORE) === 'paused'; } catch (e) { /* storage blocked */ }
  root.classList.toggle('motion-paused', paused);

  const stop = (err) => {
    dead = true;
    root.classList.remove('motion');
    stillAll();
    if (err && window.console) console.error(err);
  };

  /* ---------------------------------------------------------------- draw */

  const drawable = (svg) => {
    const out = [];
    const walk = (el) => {
      const tag = el.tagName.toLowerCase();
      if (tag === 'title' || tag === 'desc' || tag === 'defs') return;
      if (el.classList.contains('fx') || el.classList.contains('fx-hide')) return;
      if (tag === 'g') { Array.from(el.children).forEach(walk); return; }
      out.push(el);
    };
    Array.from(svg.children).forEach(walk);
    return out;
  };

  const scaleOf = (el) => {
    const m = el.getScreenCTM();
    return m ? (Math.hypot(m.a, m.b) || 1) : 1;
  };

  function drawIn(svg, o) {
    if (svg._busy) return svg._busy;
    svg.classList.add('is-drawn');
    const els = drawable(svg);
    const anims = [];
    let t = o.delay;
    let objectEnd = t;

    els.forEach((el) => {
      const tag = el.tagName.toLowerCase();
      const cs = getComputedStyle(el);
      let a;

      if (tag === 'text') {
        a = el.animate(
          [{ opacity: 0, transform: 'translateY(6px)' }, { opacity: 1, transform: 'none' }],
          { duration: 700, delay: t + o.dur * 0.3, easing: EASE_OUT, fill: 'backwards' });
      } else if (cs.stroke === 'none') {
        el.style.transformBox = 'fill-box';
        el.style.transformOrigin = 'center';
        a = el.animate(
          [{ opacity: 0, transform: 'scale(0)' },
           { opacity: 1, transform: 'scale(1.5)', offset: 0.55 },
           { opacity: 1, transform: 'scale(1)' }],
          { duration: 520, delay: t + o.dur * 0.35, easing: EASE_OUT, fill: 'backwards' });
      } else if (el.getAttribute('stroke-dasharray') || !el.getTotalLength) {
        a = el.animate([{ opacity: 0 }, { opacity: 1 }],
          { duration: o.dur, delay: t, easing: 'linear', fill: 'backwards' });
      } else {
        /* Dash lengths are unambiguous only in user units, so non-scaling
           strokes are drawn as scaling strokes of the same on-screen width. */
        const len = el.getTotalLength();
        const sw = (parseFloat(cs.strokeWidth) || 1) / scaleOf(el);
        const k = { strokeDasharray: `${len} ${len}`, vectorEffect: 'none', strokeWidth: `${sw}px` };
        const strike = el.classList.contains('glyph-strike');
        a = el.animate(
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

  /* --------------------------------------------------------------- scenes */

  const fmt = (s) => {
    const n = Math.floor(s);
    return `${String(Math.floor(n / 60)).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}`;
  };

  class Scene {
    constructor(el, loop, label) {
      Object.assign(this, { el, loop, label, started: false, visible: false, running: false });
    }
    sync() {
      this.running = this.started && this.visible && !paused && !document.hidden && !dead;
      if (this.running) this.play(); else this.pause();
    }
  }

  class SmilScene extends Scene {
    constructor(svg, loop, label) {
      super(svg, loop, label);
      this.still = parseFloat(svg.dataset.still || '0');
      svg.pauseAnimations();
      svg.setCurrentTime(0);
    }
    intro() { return drawIn(this.el, this.el.closest('.pillar-plate') ? PILLAR : HERO); }
    begin() {
      this.started = true;
      this.el.setCurrentTime(paused ? this.still : 0);
      this.el.classList.add('is-live');
      this.sync();
    }
    play() { this.el.unpauseAnimations(); }
    pause() { this.el.pauseAnimations(); }
    time() { return this.el.getCurrentTime(); }
  }

  class ClockScene extends Scene {
    constructor(el, loop, label, tick, still) {
      super(el, loop, label);
      Object.assign(this, { tick, t: 0, still: still || 0 });
    }
    intro() { return Promise.resolve(); }
    begin() {
      this.started = true;
      this.t = paused ? this.still : 0;
      this.tick(this.t % this.loop);
      this.sync();
    }
    play() {}
    pause() {}
    time() { return this.t; }
    advance(dt) {
      if (!this.running) return;
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
    scenes.forEach((s) => {
      if (s.advance) s.advance(dt);
      if (s.running) any = true;
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

  function setPaused(v) {
    paused = v;
    try { localStorage.setItem(STORE, v ? 'paused' : 'playing'); } catch (e) { /* storage blocked */ }
    root.classList.toggle('motion-paused', v);
    document.querySelectorAll('.scene-bar__btn').forEach((b) => b.setAttribute('aria-pressed', String(v)));
    scenes.forEach((s) => s.sync());
    kick();
  }

  const el = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text) n.textContent = text;
    return n;
  };

  function makeBar(scene, n) {
    const bar = el('div', 'scene-bar');
    const btn = el('button', 'scene-bar__btn');
    btn.type = 'button';
    btn.setAttribute('aria-pressed', String(paused));
    btn.append(el('span', 'scene-bar__icon'), el('span', 'dm-sr', 'Pause animations'));
    btn.firstChild.setAttribute('aria-hidden', 'true');
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

  const sceneIO = new IntersectionObserver((entries) => {
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

  function register(scene, n) {
    scene.el._scene = scene;
    scenes.push(scene);
    sceneIO.observe(scene.el);
    return makeBar(scene, n);
  }

  /* SVG films: the hero and pillar plates */
  function plateScenes() {
    let n = 0;
    document.querySelectorAll('svg.plate[data-loop]').forEach((svg) => {
      const cls = ['hero-plate', 'pillar-plate'].find((c) => svg.classList.contains(c));
      const fig = el('figure', `scene ${cls || ''}`.trim());
      if (cls) svg.classList.remove(cls);
      svg.replaceWith(fig);
      fig.append(svg);
      const title = svg.querySelector('title');
      const scene = new SmilScene(svg, parseFloat(svg.dataset.loop), title ? title.textContent.trim() : 'Plate');
      fig.append(register(scene, ++n));
    });
    return n;
  }

  /* The mission lifecycle plays stage by stage, like chapters */
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
        if (g && !paused) drawIn(g, GLYPH);
      }
    }, per * stages.length - 0.001);
    lc.after(register(scene, ++n));
    return n;
  }

  /* The map: a scan crosses the region and each country comes online */
  function mapScene(n) {
    const svg = document.querySelector('svg.ecowas-map');
    if (!svg) return n;
    const NS = 'http://www.w3.org/2000/svg';
    const countries = Array.from(svg.querySelectorAll('.country')).map((g) => {
      const b = g.getBBox();
      return { g, x: b.x + b.width / 2 };
    });
    const defs = document.createElementNS(NS, 'defs');
    const grad = document.createElementNS(NS, 'linearGradient');
    grad.id = 'dm-scan-fade';
    [['0', '0'], ['1', '0.16']].forEach(([off, op]) => {
      const s = document.createElementNS(NS, 'stop');
      s.setAttribute('offset', off);
      s.setAttribute('stop-color', 'currentColor');
      s.setAttribute('stop-opacity', op);
      grad.append(s);
    });
    defs.append(grad);
    const scan = document.createElementNS(NS, 'g');
    scan.setAttribute('class', 'map-scan');
    scan.setAttribute('aria-hidden', 'true');
    const band = document.createElementNS(NS, 'rect');
    [['x', '-110'], ['y', '0'], ['width', '110'], ['height', '600'], ['fill', 'url(#dm-scan-fade)']]
      .forEach(([k, v]) => band.setAttribute(k, v));
    const line = document.createElementNS(NS, 'line');
    [['x1', '0'], ['y1', '0'], ['x2', '0'], ['y2', '600']].forEach(([k, v]) => line.setAttribute(k, v));
    scan.append(band, line);
    svg.prepend(defs);
    svg.append(scan);

    const SWEEP = 6;
    const FADE = 9;
    const scene = new ClockScene(svg, 10, 'Phase 01, West Africa', (t) => {
      const x = t < SWEEP ? -20 + (t / SWEEP) * 860 : 900;
      scan.setAttribute('transform', `translate(${x.toFixed(1)} 0)`);
      scan.style.opacity = t < SWEEP ? '1' : '0';
      countries.forEach((c) => c.g.classList.toggle('is-lit', t < FADE && x >= c.x));
    }, 7.5);
    const cap = svg.parentElement.querySelector('.ecowas-map__caption');
    const bar = register(scene, ++n);
    if (cap) cap.before(bar); else svg.after(bar);
    return n;
  }

  /* ------------------------------------------------------------ type */

  function splitWords(node) {
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
  function scramble(tag) {
    tag.classList.add('is-in');
    if (tag.children.length || !tag.textContent.trim()) return;
    const final = tag.textContent;
    const vis = el('span');
    vis.setAttribute('aria-hidden', 'true');
    tag.textContent = '';
    tag.append(el('span', 'dm-sr', final), vis);
    const dur = Math.min(900, 280 + final.length * 22);
    const t0 = performance.now();
    const step = (now) => {
      const p = Math.min(1, (now - t0) / dur);
      const fixed = Math.floor(p * final.length);
      let s = final.slice(0, fixed);
      for (let k = fixed; k < final.length; k++) {
        const c = final[k];
        s += /[A-Za-z0-9]/.test(c) ? GLYPHS[(Math.random() * GLYPHS.length) | 0] : c;
      }
      vis.textContent = s;
      if (p < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
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

  /* ---------------------------------------------------------- reveals */

  const ITEMS = '.card, .summary-card, .argument-card, .funder-row, .audience, .stat, .lifecycle-stage, .glossary-term, .post-row';
  const SELF = 'main header, .pillar-intro, .dark-block .container > p, .dark-block .container > .btn, .big-wordmark .container';

  function reveals() {
    const io = new IntersectionObserver((entries) => {
      entries.forEach((e) => {
        if (!e.isIntersecting) return;
        const t = e.target;
        io.unobserve(t);
        if (t.matches('.hero-tag')) { scramble(t); return; }
        if (t.matches('svg.plate')) { drawIn(t, GLYPH); return; }
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
    document.querySelectorAll('.dark-block h2').forEach((h) => { splitWords(h); io.observe(h); });

    document.querySelectorAll('svg.plate:not([data-loop])').forEach((svg) => {
      io.observe(svg);
      const host = svg.closest('.card, .summary-card, .argument-card, .lifecycle-stage, .audience') || svg.parentElement;
      host.addEventListener('pointerenter', (e) => {
        if (e.pointerType === 'mouse' && svg.classList.contains('is-drawn')) drawIn(svg, GLYPH);
      });
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

  /* -------------------------------------------------------------- boot */

  try {
    hero();
    document.querySelectorAll('.stat__num').forEach(odometer);
    let n = plateScenes();
    n = lifecycleScene(n);
    mapScene(n);
    reveals();
    playhead();
    document.addEventListener('visibilitychange', () => { scenes.forEach((s) => s.sync()); kick(); });
    const onReduce = (e) => { if (e.matches) stop(); };
    if (reducedQuery.addEventListener) reducedQuery.addEventListener('change', onReduce);
  } catch (err) {
    stop(err);
  }
})();
