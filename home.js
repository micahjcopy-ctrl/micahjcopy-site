/* Homepage v5 — "The Leak"
   1. Leak simulation: gold "money" particles pour through four funnel stages; open stages spill.
      Scrolling through the story seals the leaks one at a time, then turns up the tap.
   2. Count-ups, word reveals, reviews feed, header state.
   No dependencies. Respects prefers-reduced-motion. */
(function () {
  'use strict';
  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var root = document.documentElement;
  root.classList.add('js');

  /* ---------------------------------------------------------------- header */
  var header = document.querySelector('.site-header');
  function onScrollHeader() { if (header) header.classList.toggle('scrolled', window.scrollY > 20); }
  window.addEventListener('scroll', onScrollHeader, { passive: true }); onScrollHeader();
  document.querySelectorAll('.nav-links a').forEach(function (a) {
    a.addEventListener('click', function () { var n = document.getElementById('nav'); if (n) n.classList.remove('open'); });
  });

  /* ---------------------------------------------------------------- leak sim */
  var stage = document.querySelector('.leak-stage');
  var canvas = stage && stage.querySelector('canvas');
  var meterEl = document.getElementById('keptPct');
  var LABELS = ['01  CLICK', '02  PAGE', '03  FOLLOW-UP', '04  REORDER'];
  var GOLD = '#D9A94E', GOLD2 = '#F2CF86', RED = '#C2493F', CREAM = 'rgba(244,239,228,';

  var sim = null;
  if (canvas && canvas.getContext) sim = makeSim(canvas);

  function makeSim(cv) {
    var ctx = cv.getContext('2d');
    var W = 0, H = 0, DPR = 1, mobile = false, L = null;
    var parts = [];
    var sealed = [false, false, false, false];
    var sealT = [0, 0, 0, 0];          // 0 = open, 1 = fully sealed (animated)
    var flash = [0, 0, 0, 0];
    var tap = 1, tapTarget = 1;
    var outcomes = [], keptRun = 0;
    var level = 0.06, levelTarget = 0.06;
    var acc = 0, running = false, last = 0, t = 0, meterTimer = 0;
    var P_LEAK = 0.28;

    // pre-rendered glow sprites
    function sprite(color, r) {
      var c = document.createElement('canvas'); var s = r * 4; c.width = c.height = s;
      var g = c.getContext('2d'); var gr = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
      gr.addColorStop(0, color); gr.addColorStop(0.25, color); gr.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = gr; g.fillRect(0, 0, s, s); return c;
    }
    var spGold = sprite('rgba(242,207,134,1)', 6), spRed = sprite('rgba(194,73,63,1)', 6);

    function layout() {
      var r = cv.getBoundingClientRect();
      DPR = Math.min(window.devicePixelRatio || 1, 1.75);
      W = Math.max(320, r.width); H = Math.max(480, r.height);
      cv.width = Math.round(W * DPR); cv.height = Math.round(H * DPR);
      ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
      mobile = W < 900;
      var cx = mobile ? W * 0.5 : W * 0.72;
      var top = mobile ? H * 0.15 : H * 0.13;
      var ys = mobile ? [0.24, 0.32, 0.40, 0.48] : [0.27, 0.42, 0.57, 0.71];
      L = {
        cx: cx, top: top,
        ys: ys.map(function (v) { return v * H; }),
        col: mobile ? H * 0.58 : H * 0.85,
        rx: mobile ? 26 : 38, ry: mobile ? 7 : 10,
        cw: mobile ? 60 : 96, ch: mobile ? 34 : 54,
        side: [1, -1, 1, -1]
      };
    }

    function emit(n) {
      for (var i = 0; i < n; i++) {
        parts.push({ x: L.cx + (Math.random() - 0.5) * 10, y: L.top + 8, vx: 0, vy: 1.2 + Math.random() * 0.8,
          s: 0, next: 0, a: 1, r: 0.55 + Math.random() * 0.6, w: Math.random() * 6.28 });
      }
    }
    function record(k) {
      outcomes.push(k); keptRun += k;
      if (outcomes.length > 360) keptRun -= outcomes.shift();
    }

    function step(dt) {
      t += dt;
      tap += (tapTarget - tap) * Math.min(1, dt * 1.5);
      var rate = (mobile ? 46 : 78) * tap;
      acc += rate * dt; var n = acc | 0; acc -= n; if (n) emit(n);
      for (var i = 0; i < 4; i++) {
        var goal = sealed[i] ? 1 : 0;
        sealT[i] += (goal - sealT[i]) * Math.min(1, dt * 3.2);
        flash[i] = Math.max(0, flash[i] - dt * 1.4);
      }
      var k = dt * 60;
      for (var j = parts.length - 1; j >= 0; j--) {
        var p = parts[j];
        if (p.s === 0) {
          p.w += 0.08 * k;
          var tx = L.cx + Math.sin(p.w) * 3.5;
          p.vx += (tx - p.x) * 0.08 * k; p.vx *= Math.pow(0.82, k);
          p.vy = Math.min(p.vy + 0.05 * k, 3.6);
          p.x += p.vx * k; p.y += p.vy * k;
          if (p.next < 4 && p.y >= L.ys[p.next]) {
            var open = 1 - sealT[p.next];
            if (Math.random() < P_LEAK * open) {
              var sd = L.side[p.next];
              p.s = 1; p.vx = sd * (1.4 + Math.random() * 2.6); p.vy = -0.4 - Math.random() * 1.2;
              p.x = L.cx + sd * L.rx * 0.8; record(0);
            } else { p.next++; }
          }
          if (p.y >= L.col - L.ch * (0.25 + level * 0.6)) { record(1); parts.splice(j, 1); levelTarget = Math.min(0.95, levelTarget + 0.0009); continue; }
        } else {
          p.vy += 0.11 * k; p.vx *= Math.pow(0.995, k);
          p.x += p.vx * k; p.y += p.vy * k; p.a -= 0.006 * k;
          if (p.a <= 0 || p.y > H + 20 || p.x < -20 || p.x > W + 20) { parts.splice(j, 1); continue; }
        }
      }
      // the collector drains slowly, so the level tracks how much is kept
      levelTarget = Math.max(0.05, levelTarget - dt * 0.012 * (1.6 - keptShare()));
      level += (levelTarget - level) * Math.min(1, dt * 2);
    }

    function keptShare() { return outcomes.length < 40 ? 0.27 : keptRun / outcomes.length; }

    function crackPath(x, y, sd, len, seed) {
      ctx.beginPath(); ctx.moveTo(x, y);
      var segs = 6, px = x, py = y;
      for (var i = 1; i <= segs; i++) {
        px = x + sd * (len * i / segs); py = y + Math.sin(i * 2.3 + seed) * 6 + (i % 2 ? -4 : 4);
        ctx.lineTo(px, py);
      }
    }

    function draw() {
      ctx.clearRect(0, 0, W, H);
      var cx = L.cx;
      // pipe glow
      var g = ctx.createLinearGradient(0, L.top, 0, L.col);
      g.addColorStop(0, 'rgba(217,169,78,.20)'); g.addColorStop(1, 'rgba(217,169,78,.05)');
      ctx.strokeStyle = g; ctx.lineWidth = mobile ? 18 : 26; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(cx, L.top); ctx.lineTo(cx, L.col - L.ch * 0.6); ctx.stroke();
      ctx.lineWidth = 1; ctx.strokeStyle = CREAM + '.10)';
      [-1, 1].forEach(function (s) { ctx.beginPath(); ctx.moveTo(cx + s * (mobile ? 10 : 14), L.top); ctx.lineTo(cx + s * (mobile ? 10 : 14), L.col - L.ch * 0.6); ctx.stroke(); });
      // tap
      ctx.fillStyle = '#2A221A'; ctx.strokeStyle = CREAM + '.25)';
      var tw = mobile ? 46 : 70;
      roundRect(cx - tw / 2, L.top - 22, tw, 18, 6); ctx.fill(); ctx.stroke();
      ctx.fillStyle = GOLD; ctx.fillRect(cx - 5, L.top - 6, 10, 8);
      // stages
      ctx.font = (mobile ? '10px' : '11px') + ' "Space Mono", ui-monospace, monospace';
      for (var i = 0; i < 4; i++) {
        var y = L.ys[i], sd = L.side[i], s = sealT[i], f = flash[i];
        // ring
        ctx.lineWidth = 2;
        ctx.strokeStyle = s > 0.5 ? 'rgba(217,169,78,' + (0.55 + f * 0.45) + ')' : 'rgba(194,73,63,' + (0.55 + 0.25 * Math.sin(t * 4 + i)) + ')';
        ctx.beginPath(); ctx.ellipse(cx, y, L.rx, L.ry, 0, 0, Math.PI * 2); ctx.stroke();
        if (f > 0) { ctx.strokeStyle = 'rgba(242,207,134,' + f * 0.8 + ')'; ctx.beginPath(); ctx.ellipse(cx, y, L.rx + (1 - f) * 40, L.ry + (1 - f) * 12, 0, 0, Math.PI * 2); ctx.stroke(); }
        // crack
        var len = (mobile ? 40 : 64) * (1 - s);
        if (len > 1) {
          ctx.save(); ctx.shadowColor = RED; ctx.shadowBlur = 12;
          ctx.strokeStyle = 'rgba(194,73,63,' + (0.9 * (1 - s)) + ')'; ctx.lineWidth = 2;
          crackPath(cx + sd * L.rx * 0.9, y, sd, len, i * 1.7); ctx.stroke(); ctx.restore();
        }
        // label
        var lx = cx - sd * (L.rx + (mobile ? 12 : 22));
        ctx.textAlign = sd > 0 ? 'right' : 'left';
        ctx.fillStyle = CREAM + '.75)'; ctx.fillText(LABELS[i], lx, y - 3);
        ctx.fillStyle = s > 0.5 ? GOLD : RED; ctx.fillText(s > 0.5 ? 'SEALED' : 'LEAKING', lx, y + 12);
      }
      // collector
      var cw = L.cw, ch = L.ch, cy = L.col;
      ctx.strokeStyle = CREAM + '.35)'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(cx - cw / 2, cy - ch); ctx.lineTo(cx - cw / 2 + 6, cy); ctx.lineTo(cx + cw / 2 - 6, cy); ctx.lineTo(cx + cw / 2, cy - ch); ctx.stroke();
      var lh = ch * level;
      var lg = ctx.createLinearGradient(0, cy - lh, 0, cy);
      lg.addColorStop(0, 'rgba(242,207,134,.95)'); lg.addColorStop(1, 'rgba(184,129,47,.95)');
      ctx.fillStyle = lg;
      ctx.beginPath(); ctx.moveTo(cx - cw / 2 + 5 * (1 - level) + 2, cy - lh);
      for (var xx = 0; xx <= 10; xx++) {
        var px = cx - cw / 2 + 4 + (cw - 8) * xx / 10;
        ctx.lineTo(px, cy - lh + Math.sin(t * 3 + xx) * 1.6);
      }
      ctx.lineTo(cx + cw / 2 - 8, cy - 1); ctx.lineTo(cx - cw / 2 + 8, cy - 1); ctx.closePath(); ctx.fill();
      ctx.textAlign = 'center'; ctx.fillStyle = CREAM + '.6)'; ctx.fillText('KEPT', cx, cy + 18);
      // particles
      ctx.globalCompositeOperation = 'lighter';
      for (var j = 0; j < parts.length; j++) {
        var p = parts[j], sz = (p.s ? 9 : 11) * p.r;
        ctx.globalAlpha = p.s ? Math.max(0, p.a) * 0.85 : 0.95;
        ctx.drawImage(p.s ? spRed : spGold, p.x - sz / 2, p.y - sz / 2, sz, sz);
      }
      ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
    }
    function roundRect(x, y, w, h, r) {
      ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
      ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
    }
    function updateMeter() {
      if (!meterEl) return;
      meterEl.textContent = Math.round(keptShare() * 100) + '%';
    }
    function frame(now) {
      if (!running) return;
      var dt = Math.min(0.05, (now - last) / 1000 || 0.016); last = now;
      step(dt); draw();
      meterTimer += dt; if (meterTimer > 0.2) { meterTimer = 0; updateMeter(); }
      requestAnimationFrame(frame);
    }
    function staticRender() { // reduced motion: settle the sim off-screen, draw one frame
      for (var i = 0; i < 4; i++) sealT[i] = sealed[i] ? 1 : 0;
      parts = []; outcomes = []; keptRun = 0;
      for (var n = 0; n < 420; n++) step(1 / 60);
      draw(); updateMeter();
    }
    layout();
    for (var w = 0; w < 360; w++) step(1 / 60); // pre-fill the stream so the meter starts steady
    window.addEventListener('resize', function () { layout(); if (reduce) staticRender(); });
    return {
      start: function () { if (reduce) { staticRender(); return; } if (running) return; running = true; last = performance.now(); requestAnimationFrame(frame); },
      stop: function () { running = false; },
      setSealed: function (i, want) {
        if (want && !sealed[i]) flash[i] = 1;
        sealed[i] = want;
        if (reduce) staticRender();
      },
      setTap: function (up) {
        tapTarget = up ? 2.3 : 1;
        if (up) levelTarget = Math.max(levelTarget, 0.7);
      }
    };
  }

  // drive the sim from the story steps
  var steps = Array.prototype.slice.call(document.querySelectorAll('.leak-steps .lstep'));
  var current = -1, sealTimer = 0;
  function markLeak(i, on) {            // leak i (0-3) lives on step i + 1
    var el = steps[i + 1]; if (!el) return;
    el.classList.toggle('is-sealed', on);
    var st = el.querySelector('.st'); if (st) st.textContent = on ? 'Sealed' : 'Leaking';
    if (sim) sim.setSealed(i, on);
  }
  function setStep(n) {
    if (n === current) return; current = n;
    clearTimeout(sealTimer);
    steps.forEach(function (el, i) { el.classList.toggle('is-active', i === n); });
    for (var i = 0; i < 4; i++) markLeak(i, n >= 5 || i < n - 1);
    if (n >= 1 && n <= 4) sealTimer = setTimeout(function () { markLeak(n - 1, true); }, reduce ? 0 : 1400);
    if (sim) sim.setTap(n >= 5);
  }
  if (steps.length && 'IntersectionObserver' in window) {
    var stepIO = new IntersectionObserver(function (es) {
      es.forEach(function (e) { if (e.isIntersecting) setStep(steps.indexOf(e.target)); });
    }, { rootMargin: '-48% 0px -48% 0px' });
    steps.forEach(function (s) { stepIO.observe(s); });
  }
  setStep(0);
  if (sim) {
    var leakSec = document.querySelector('.leak');
    if ('IntersectionObserver' in window) {
      new IntersectionObserver(function (es) { es.forEach(function (e) { e.isIntersecting ? sim.start() : sim.stop(); }); }, { rootMargin: '100px 0px' }).observe(leakSec);
    } else sim.start();
  }

  /* ---------------------------------------------------------------- reveals */
  document.querySelectorAll('.split').forEach(function (el) {
    var i = 0;
    (function walk(node) {
      Array.prototype.slice.call(node.childNodes).forEach(function (c) {
        if (c.nodeType === 3) {
          var frag = document.createDocumentFragment();
          c.textContent.split(/(\s+)/).forEach(function (w) {
            if (!w) return;
            if (/^\s+$/.test(w)) { frag.appendChild(document.createTextNode(w)); return; }
            var o = document.createElement('span'); o.className = 'w';
            var inner = document.createElement('span'); inner.textContent = w; inner.style.setProperty('--i', i++);
            o.appendChild(inner); frag.appendChild(o);
          });
          node.replaceChild(frag, c);
        } else if (c.nodeType === 1 && !c.classList.contains('w')) walk(c);
      });
    })(el);
  });
  var revealEls = Array.prototype.slice.call(document.querySelectorAll('.rv-in, .split, .bignum, [data-count]'));
  if (reduce || !('IntersectionObserver' in window)) {
    revealEls.forEach(function (el) { el.classList.add('in'); if (el.hasAttribute('data-count')) finishCount(el); });
  } else {
    var rio = new IntersectionObserver(function (es) {
      es.forEach(function (e) {
        if (!e.isIntersecting) return;
        e.target.classList.add('in');
        if (e.target.hasAttribute('data-count')) countUp(e.target);
        rio.unobserve(e.target);
      });
    }, { threshold: 0.2 });
    revealEls.forEach(function (el) { rio.observe(el); });
  }

  /* ---------------------------------------------------------------- count-ups */
  function fmt(v, el) {
    var dec = +(el.getAttribute('data-dec') || 0);
    var s = v.toFixed(dec).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return (el.getAttribute('data-pre') || '') + s + (el.getAttribute('data-suf') || '');
  }
  function finishCount(el) { el.textContent = fmt(+el.getAttribute('data-count'), el); }
  function countUp(el) {
    var to = +el.getAttribute('data-count'), from = +(el.getAttribute('data-from') || 0), dur = +(el.getAttribute('data-dur') || 1800);
    var t0 = performance.now();
    (function tick(now) {
      var k = Math.min(1, (now - t0) / dur), e = 1 - Math.pow(1 - k, 4);
      el.textContent = fmt(from + (to - from) * e, el);
      if (k < 1) requestAnimationFrame(tick);
    })(t0);
  }

  /* ---------------------------------------------------------------- CTA embers */
  var cc = document.getElementById('ctaCanvas');
  if (cc && !reduce && cc.getContext) {
    var cx2 = cc.getContext('2d'), em = [], cw = 0, ch = 0, on = false;
    var sizeC = function () { var r = cc.getBoundingClientRect(); var d = Math.min(window.devicePixelRatio || 1, 1.5); cw = r.width; ch = r.height; cc.width = cw * d; cc.height = ch * d; cx2.setTransform(d, 0, 0, d, 0, 0); };
    sizeC(); window.addEventListener('resize', sizeC);
    for (var e = 0; e < 70; e++) em.push({ x: Math.random(), y: Math.random(), v: 0.0006 + Math.random() * 0.0014, r: 0.6 + Math.random() * 1.8, ph: Math.random() * 6 });
    var loopC = function () {
      if (!on) return;
      cx2.clearRect(0, 0, cw, ch);
      em.forEach(function (p) {
        p.y -= p.v; p.ph += 0.02; if (p.y < -0.05) { p.y = 1.05; p.x = Math.random(); }
        cx2.globalAlpha = 0.35 + 0.35 * Math.sin(p.ph);
        cx2.fillStyle = '#F2CF86'; cx2.beginPath(); cx2.arc(p.x * cw + Math.sin(p.ph) * 6, p.y * ch, p.r, 0, 6.283); cx2.fill();
      });
      requestAnimationFrame(loopC);
    };
    new IntersectionObserver(function (es) { es.forEach(function (x) { var was = on; on = x.isIntersecting; if (on && !was) requestAnimationFrame(loopC); }); }).observe(cc);
  }

  /* ---------------------------------------------------------------- reviews feed */
  // New consented reviews submitted through review.html show up automatically.
  var grid = document.getElementById('reviewsGrid');
  if (grid && window.fetch) {
    var esc = function (s) { var d = document.createElement('div'); d.textContent = s == null ? '' : String(s); return d.innerHTML; };
    fetch('/api/reviews?public=1').then(function (r) { return r.ok ? r.json() : null; }).then(function (d) {
      if (!d || !d.reviews) return;
      var have = {}; grid.querySelectorAll('[data-rev-name]').forEach(function (el) { have[el.getAttribute('data-rev-name')] = 1; });
      var html = '';
      d.reviews.forEach(function (rv) {
        var name = (rv.name || '').trim(), quote = (rv.testimonial || '').trim();
        if (!name || !quote || have[name]) return;
        var meta = [rv.title, rv.company].filter(Boolean).join(', ');
        var ini = name.split(/\s+/).map(function (w) { return w[0]; }).join('').slice(0, 2).toUpperCase();
        var m1 = quote.match(/^[^.!?]+[.!?]+/); var first = m1 ? m1[0] : quote;
        html += '<figure class="rv" data-rev-name="' + esc(name) + '"><div class="stars" aria-label="5 out of 5 stars">★★★★★</div>' +
          '<blockquote>' + esc(first) + '</blockquote>' +
          (first.length < quote.length ? '<details><summary>Read the full review</summary><p>' + esc(quote) + '</p></details>' : '') +
          '<figcaption class="who"><span class="mono-av" aria-hidden="true">' + esc(ini) + '</span><div><b>' + esc(name) + '</b>' + (meta ? '<span>' + esc(meta) + '</span>' : '') + '</div></figcaption></figure>';
      });
      if (html) grid.insertAdjacentHTML('beforeend', html);
    }).catch(function () {});
  }
})();
