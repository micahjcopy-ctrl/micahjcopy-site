/* ===========================================================
   Micah Jacobi — MOTION V3 "studio layer"
   GSAP 3.13 + ScrollTrigger + SplitText (all free) + Lenis.
   Patterns follow the UI/UX Pro Max motion library rules:
   - parallax on decorative layers only, small deltas (5-15%)
   - reveals: small travel, power easings, no re-trigger spam
   - magnetic pull clamped, max 2 focal elements
   - everything honors prefers-reduced-motion
   =========================================================== */
(function () {
  "use strict";
  var docEl = document.documentElement;
  var reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // Hard fallback: if GSAP didn't load (CDN blocked), revert to static site.
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

    /* ---------- 1. Scroll progress hairline ---------- */
    var bar = document.createElement("div");
    bar.className = "v3-progress";
    document.body.appendChild(bar);
    gsap.to(bar, {
      scaleX: 1, ease: "none",
      scrollTrigger: { trigger: document.body, start: "top top", end: "bottom bottom", scrub: 0.4 }
    });

    /* ---------- 2. Cinematic hero entrance ---------- */
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
          // leave clip-path inline as "none" — clearing it would re-apply the
          // stylesheet's hidden initial state and blank the headline
          gsap.set(hero.querySelector(".hl"), { clipPath: "none" });
          gsap.set(hero.querySelectorAll(".lead,.btn-row"), { clearProps: "transform" });
        });
    }

    /* ---------- 3. Hero parallax: portrait + glow blobs (decorative only) ---------- */
    if (hero) {
      var portrait = hero.querySelector(".hero-portrait");
      if (portrait) {
        gsap.to(portrait, {
          yPercent: 8, ease: "none",
          scrollTrigger: { trigger: hero, start: "top top", end: "bottom top", scrub: true }
        });
      }
    }

    /* ---------- 4. Statement: word-by-word scrub reveal ---------- */
    document.querySelectorAll(".statement h2").forEach(function (h) {
      var words;
      if (hasSplit) {
        var split = new SplitText(h, { type: "words", wordsClass: "v3-word" });
        words = split.words;
      } else {
        words = [h]; // fallback: whole-line fade
      }
      h.classList.add("v3-split");
      gsap.from(words, {
        opacity: 0.12, y: 10, stagger: 0.06, ease: "power1.out",
        scrollTrigger: { trigger: h, start: "top 82%", end: "top 45%", scrub: 0.6 }
      });
    });

    /* ---------- 5. Keyword underlines draw in ---------- */
    document.querySelectorAll(".u").forEach(function (u) {
      ScrollTrigger.create({
        trigger: u, start: "top 80%", once: true,
        onEnter: function () { u.classList.add("drawn"); }
      });
    });

    /* ---------- 6. Magnetic CTA buttons (hero + final CTA only) ---------- */
    if (fine) {
      var magnets = [
        document.querySelector(".hero .btn-primary"),
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

    /* ---------- 7. Funnel: levels build with scroll scrub ---------- */
    var funnel = document.querySelector(".funnel");
    if (funnel) {
      gsap.from(funnel.querySelectorAll(".lvl"), {
        opacity: 0, y: 18, scaleX: 0.72, transformOrigin: "50% 0%",
        stagger: 0.18, ease: "power2.out",
        scrollTrigger: { trigger: funnel, start: "top 85%", end: "top 40%", scrub: 0.7 }
      });
    }

    /* ---------- 8. Comparison table cascade ---------- */
    var compare = document.querySelector(".compare");
    if (compare) {
      ScrollTrigger.create({
        trigger: compare, start: "top 78%", once: true,
        onEnter: function () { compare.classList.add("v3-lit"); }
      });
    }

    /* ---------- 9. Cursor glow on dark bands (desktop only) ---------- */
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

    /* ---------- 10. Recalc after fonts/images settle ---------- */
    window.addEventListener("load", function () { ScrollTrigger.refresh(); });
  });
})();
