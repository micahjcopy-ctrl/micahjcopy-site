/* ===========================================================
   Micah Jacobi — MOTION V3/V4 "studio layer"
   GSAP 3.13 + ScrollTrigger + SplitText (all free) + Lenis.
   Patterns follow the UI/UX Pro Max motion library rules:
   small deltas, power easings, max 2 magnetic elements,
   decorative-only parallax, prefers-reduced-motion respected.

   Structure:
   PART A — always-on (no GSAP needed): marketing score quiz
   PART B — GSAP-gated motion layer
   =========================================================== */
(function () {
  "use strict";
  var docEl = document.documentElement;
  var reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ============================================================
     PART A — MARKETING SCORE QUIZ (works with or without GSAP)
     ============================================================ */
  document.addEventListener("DOMContentLoaded", function () {
    var quiz = document.getElementById("mkt-quiz");
    if (!quiz) return;
    var answers = {};
    var total = quiz.querySelectorAll(".qz-q").length;
    var btn = quiz.querySelector(".qz-reveal");
    var result = quiz.querySelector(".qz-result");

    quiz.querySelectorAll(".qz-q").forEach(function (q) {
      q.querySelectorAll(".qz-chip").forEach(function (chip) {
        chip.addEventListener("click", function () {
          q.querySelectorAll(".qz-chip").forEach(function (c) { c.classList.remove("sel"); });
          chip.classList.add("sel");
          answers[q.getAttribute("data-q")] = parseInt(chip.getAttribute("data-v"), 10);
          if (Object.keys(answers).length === total) btn.classList.add("ready");
        });
      });
    });

    btn.addEventListener("click", function () {
      if (!btn.classList.contains("ready")) return;
      var score = 0;
      Object.keys(answers).forEach(function (k) { score += answers[k]; });
      var verdict, sub;
      if (score <= 40) {
        verdict = "Leaking hard.";
        sub = "Money is almost certainly slipping out of your funnel every week. The free call will pay for itself.";
      } else if (score <= 70) {
        verdict = "Solid base, real leaks.";
        sub = "You're doing the visible things. The invisible ones — follow-up, tracking, testing — are where the money's hiding.";
      } else {
        verdict = "Strong foundation.";
        sub = "You're ahead of most. Now it's about compounding: squeezing more out of what already works.";
      }
      result.querySelector(".qz-verdict").textContent = verdict;
      result.querySelector(".qz-sub").textContent = sub;
      // set the score BEFORE revealing — motion.js's gauge observer animates it
      var card = result.querySelector(".gauge-card");
      if (card) card.setAttribute("data-score", String(score));
      result.classList.add("show");
      btn.style.display = "none";
      result.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "center" });
      // failsafe: if the observer didn't fire within 1.6s, set final values directly
      setTimeout(function () {
        var fill = result.querySelector(".gauge .fill");
        var numEl = result.querySelector(".gauge-num .val");
        if (numEl && numEl.textContent === "0" && score > 0) {
          if (fill) fill.style.strokeDashoffset = String(1 - score / 100);
          numEl.textContent = String(score);
        }
      }, 1600);
    });
  });

  /* ============================================================
     PART B — GSAP MOTION LAYER
     ============================================================ */
  if (reduce || !window.gsap || !window.ScrollTrigger) {
    docEl.classList.remove("motion-v3");
    return;
  }
  gsap.registerPlugin(ScrollTrigger);
  var hasSplit = !!window.SplitText;
  if (hasSplit) gsap.registerPlugin(SplitText);
  var fine = window.matchMedia("(pointer:fine) and (hover:hover)").matches;

  /* ---------- 0. Lenis smooth scroll, synced to ScrollTrigger ---------- */
  var lenis = null;
  if (window.Lenis) {
    lenis = new Lenis({ duration: 1.1, smoothWheel: true });
    lenis.on("scroll", ScrollTrigger.update);
    gsap.ticker.add(function (t) { lenis.raf(t * 1000); });
    gsap.ticker.lagSmoothing(0);
  }

  document.addEventListener("DOMContentLoaded", function () {
    docEl.classList.add("v3-ready");

    /* ---------- page transition: fade in on load ---------- */
    gsap.to(document.body, { opacity: 1, duration: 0.45, ease: "power1.out" });

    /* ---------- page transition: fade out on internal nav ---------- */
    document.querySelectorAll('a[href$=".html"]').forEach(function (a) {
      var href = a.getAttribute("href");
      if (!href || /^https?:\/\//.test(href)) return;
      a.addEventListener("click", function (e) {
        if (e.metaKey || e.ctrlKey || e.shiftKey || a.target === "_blank") return;
        e.preventDefault();
        gsap.to(document.body, {
          opacity: 0, duration: 0.22, ease: "power1.in",
          onComplete: function () { window.location.href = href; }
        });
      });
    });

    /* ---------- 1. Scroll progress hairline ---------- */
    var bar = document.createElement("div");
    bar.className = "v3-progress";
    document.body.appendChild(bar);
    gsap.to(bar, {
      scaleX: 1, ease: "none",
      scrollTrigger: { trigger: document.body, start: "top top", end: "bottom bottom", scrub: 0.4 }
    });

    /* ---------- 2. Cinematic hero entrance (home hero only) ---------- */
    var hero = document.querySelector(".hero");
    if (hero) {
      var tl = gsap.timeline({ defaults: { ease: "power3.out" } });
      tl.to(hero.querySelector(".eyebrow"), { opacity: 1, duration: 0.5 }, 0.1)
        .to(hero.querySelector(".hl"), { opacity: 1, clipPath: "inset(0 0 0% 0)", duration: 0.9, ease: "power4.out" }, 0.25)
        .to(hero.querySelector(".lead"), { opacity: 1, y: 0, duration: 0.55, startAt: { y: 18 } }, 0.7)
        .to(hero.querySelector(".btn-row"), { opacity: 1, y: 0, duration: 0.5, startAt: { y: 14 } }, 0.85)
        .to(hero.querySelector(".coordstrip"), { opacity: 1, duration: 0.6 }, 1.0)
        .to(hero.querySelector(".hero-portrait"), { opacity: 1, x: 0, duration: 0.9, startAt: { x: 28 }, ease: "power2.out" }, 0.45)
        .add(function () {
          // keep clip-path inline as "none" — clearing it would re-apply the
          // stylesheet's hidden initial state and blank the headline
          var hl = hero.querySelector(".hl");
          if (hl) gsap.set(hl, { clipPath: "none" });
          gsap.set(hero.querySelectorAll(".lead,.btn-row"), { clearProps: "transform" });
        });

      /* hero parallax: portrait drifts (decorative only) */
      var portrait = hero.querySelector(".hero-portrait");
      if (portrait) {
        gsap.to(portrait, {
          yPercent: 8, ease: "none",
          scrollTrigger: { trigger: hero, start: "top top", end: "bottom top", scrub: true }
        });
      }
    }

    /* ---------- 3. Statement: word-by-word scrub reveal ---------- */
    document.querySelectorAll(".statement h2").forEach(function (h) {
      var words;
      if (hasSplit) {
        var split = new SplitText(h, { type: "words", wordsClass: "v3-word" });
        words = split.words;
      } else {
        words = [h];
      }
      h.classList.add("v3-split");
      gsap.from(words, {
        opacity: 0.12, y: 10, stagger: 0.06, ease: "power1.out",
        scrollTrigger: { trigger: h, start: "top 82%", end: "top 45%", scrub: 0.6 }
      });
    });

    /* ---------- 4. Keyword underlines draw in (headline .u only) ---------- */
    document.querySelectorAll("h1 .u, h2 .u").forEach(function (u) {
      ScrollTrigger.create({
        trigger: u, start: "top 80%", once: true,
        onEnter: function () { u.classList.add("drawn"); }
      });
    });

    /* ---------- 5. Magnetic CTA buttons (max 2 per page) ---------- */
    if (fine) {
      var magnets = [
        document.querySelector(".hero .btn-primary, .page-hero .btn-primary"),
        document.querySelector("#book .btn-primary")
      ].filter(Boolean);
      magnets.forEach(function (el) {
        el.classList.add("v3-magnet");
        var xTo = gsap.quickTo(el, "x", { duration: 0.4, ease: "elastic.out(1,0.4)" });
        var yTo = gsap.quickTo(el, "y", { duration: 0.4, ease: "elastic.out(1,0.4)" });
        el.addEventListener("mousemove", function (e) {
          var r = el.getBoundingClientRect();
          xTo((e.clientX - r.left - r.width / 2) * 0.3);
          yTo((e.clientY - r.top - r.height / 2) * 0.3);
        });
        el.addEventListener("mouseleave", function () { xTo(0); yTo(0); });
      });
    }

    /* ---------- 6. Funnel: levels build with scroll scrub ---------- */
    var funnel = document.querySelector(".funnel");
    if (funnel) {
      gsap.from(funnel.querySelectorAll(".lvl"), {
        opacity: 0, y: 18, scaleX: 0.72, transformOrigin: "50% 0%",
        stagger: 0.18, ease: "power2.out",
        scrollTrigger: { trigger: funnel, start: "top 85%", end: "top 40%", scrub: 0.7 }
      });
    }

    /* ---------- 7. Comparison table cascade ---------- */
    var compare = document.querySelector(".compare");
    if (compare) {
      ScrollTrigger.create({
        trigger: compare, start: "top 78%", once: true,
        onEnter: function () { compare.classList.add("v3-lit"); }
      });
    }

    /* ---------- 8. Cursor glow on dark bands (desktop only) ---------- */
    if (fine) {
      document.querySelectorAll(".band-dark").forEach(function (band) {
        var glow = document.createElement("div");
        glow.className = "v3-glow";
        band.appendChild(glow);
        var gx = gsap.quickTo(glow, "x", { duration: 0.5, ease: "power2.out" });
        var gy = gsap.quickTo(glow, "y", { duration: 0.5, ease: "power2.out" });
        band.addEventListener("mousemove", function (e) {
          var r = band.getBoundingClientRect();
          gx(e.clientX - r.left - 170);
          gy(e.clientY - r.top - 170);
        });
        band.addEventListener("mouseenter", function () { gsap.to(glow, { opacity: 1, duration: 0.35 }); });
        band.addEventListener("mouseleave", function () { gsap.to(glow, { opacity: 0, duration: 0.35 }); });
      });
    }

    /* ---------- 9. V4: custom cursor (dot + ring, difference blend) ---------- */
    if (fine) {
      docEl.classList.add("v4-cursor-on");
      var dot = document.createElement("div"); dot.className = "v4-dot";
      var ring = document.createElement("div"); ring.className = "v4-ring";
      document.body.appendChild(dot); document.body.appendChild(ring);
      var dx = gsap.quickTo(dot, "x", { duration: 0.08, ease: "power2.out" });
      var dy = gsap.quickTo(dot, "y", { duration: 0.08, ease: "power2.out" });
      var rx = gsap.quickTo(ring, "x", { duration: 0.35, ease: "power2.out" });
      var ry = gsap.quickTo(ring, "y", { duration: 0.35, ease: "power2.out" });
      window.addEventListener("mousemove", function (e) {
        if (dot.style.opacity !== "1") { dot.style.opacity = "1"; ring.style.opacity = "1"; }
        dx(e.clientX); dy(e.clientY); rx(e.clientX); ry(e.clientY);
      }, { passive: true });
      document.querySelectorAll("a,button,.qz-chip,summary,.ba .handle").forEach(function (el) {
        el.addEventListener("mouseenter", function () { ring.classList.add("grow"); });
        el.addEventListener("mouseleave", function () { ring.classList.remove("grow"); });
      });
      document.addEventListener("mouseleave", function () { dot.style.opacity = 0; ring.style.opacity = 0; });
      document.addEventListener("mouseenter", function () { dot.style.opacity = 1; ring.style.opacity = 1; });
    }

    /* ---------- 10. V4: text scramble/decode on mono labels ---------- */
    var CHARS = "#/<>_01·—";
    function scramble(el) {
      var finalText = el.getAttribute("data-scr");
      var dur = 650, start = null;
      function frame(now) {
        if (start === null) start = now;
        var p = Math.min((now - start) / dur, 1);
        var settled = Math.floor(finalText.length * p);
        var out = finalText.slice(0, settled);
        for (var i = settled; i < finalText.length; i++) {
          out += finalText[i] === " " ? " " : CHARS[Math.floor(Math.random() * CHARS.length)];
        }
        el.textContent = out;
        if (p < 1) requestAnimationFrame(frame);
        else el.textContent = finalText;
      }
      requestAnimationFrame(frame);
    }
    document.querySelectorAll(".eyebrow, .coordstrip span").forEach(function (el) {
      if (el.children.length) return; // text-only nodes
      el.setAttribute("data-scr", el.textContent);
      ScrollTrigger.create({
        trigger: el, start: "top 92%", once: true,
        onEnter: function () { scramble(el); }
      });
    });

    /* ---------- 11. V4: photo reveal masks ---------- */
    document.querySelectorAll(".photo").forEach(function (ph) {
      ScrollTrigger.create({
        trigger: ph, start: "top 82%", once: true,
        onEnter: function () { ph.classList.add("unmasked"); }
      });
    });

    /* ---------- 12. V4: scrolly system steps (home) ---------- */
    document.querySelectorAll(".prow").forEach(function (row) {
      // NOTE: no gsap.from() on row children here — the section-level CSS
      // reveal already staggers .grid>* in, and a from-tween created while
      // those children are CSS-hidden records opacity 0 as its END value
      // (invisible-forever bug caught in v4 QA).
      ScrollTrigger.create({
        trigger: row, start: "top 70%", once: true,
        onEnter: function () { row.classList.add("lit"); }
      });
    });
    // SERP rows stagger inside the Attract mockup
    document.querySelectorAll(".mock .serp").forEach(function (serp) {
      gsap.from(serp.querySelectorAll(".row"), {
        opacity: 0, y: 10, duration: 0.4, stagger: 0.18, ease: "power1.out",
        scrollTrigger: { trigger: serp, start: "top 75%", once: true }
      });
    });
    // Flow nodes light in sequence inside the Ascend mockup
    document.querySelectorAll(".mock .flow").forEach(function (flow) {
      var items = flow.querySelectorAll(".fnode,.farrow");
      ScrollTrigger.create({
        trigger: flow, start: "top 75%", once: true,
        onEnter: function () {
          items.forEach(function (n, i) {
            setTimeout(function () { n.classList.add("lit"); }, i * 260);
          });
        }
      });
    });

    /* ---------- 13. Recalc after fonts/images settle ---------- */
    window.addEventListener("load", function () { ScrollTrigger.refresh(); });
  });
})();
