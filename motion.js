/* Micah Jacobi — Phase 1 motion. Vanilla, no deps.
   Gated so that without JS everything is fully visible. */
(function () {
  "use strict";
  var reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // Enable motion styles only when we can actually animate.
  if (!reduce) document.documentElement.classList.add("motion");

  document.addEventListener("DOMContentLoaded", function () {

    /* ---------- 1. Scroll reveal (every section, once) ---------- */
    var sections = Array.prototype.slice.call(document.querySelectorAll("section"));
    sections.forEach(function (s) { s.classList.add("reveal"); });

    if (reduce || !("IntersectionObserver" in window)) {
      sections.forEach(function (s) { s.classList.add("in"); });
    } else {
      var io = new IntersectionObserver(function (entries) {
        entries.forEach(function (e) {
          if (e.isIntersecting) { e.target.classList.add("in"); io.unobserve(e.target); }
        });
      }, { threshold: 0.12, rootMargin: "0px 0px -8% 0px" });
      sections.forEach(function (s) { io.observe(s); });
      // Reveal anything already in view on load (hero).
      requestAnimationFrame(function () {
        sections.forEach(function (s) {
          var r = s.getBoundingClientRect();
          if (r.top < window.innerHeight * 0.9) s.classList.add("in");
        });
      });
    }

    /* ---------- 2. Count-up on stat numbers ---------- */
    function countUp(el) {
      var raw = el.getAttribute("data-final");
      var m = raw.match(/^([^\d]*)([\d,.]+)(.*)$/);
      if (!m) { el.textContent = raw; return; }
      var prefix = m[1], numStr = m[2].replace(/,/g, ""), suffix = m[3];
      var target = parseFloat(numStr);
      var decimals = (numStr.split(".")[1] || "").length;
      var dur = 1100, start = null;
      function frame(now) {
        if (start === null) start = now;
        var p = Math.min((now - start) / dur, 1);
        var eased = 1 - Math.pow(1 - p, 3);
        var val = (target * eased).toLocaleString("en-US", {
          minimumFractionDigits: decimals, maximumFractionDigits: decimals
        });
        el.textContent = prefix + val + suffix;
        if (p < 1) requestAnimationFrame(frame); else el.textContent = raw;
      }
      requestAnimationFrame(frame);
    }
    var nums = Array.prototype.slice.call(document.querySelectorAll(".stat .num"));
    nums.forEach(function (el) { el.setAttribute("data-final", el.textContent.trim()); });
    if (!reduce && "IntersectionObserver" in window) {
      var io2 = new IntersectionObserver(function (entries) {
        entries.forEach(function (e) {
          if (e.isIntersecting) { countUp(e.target); io2.unobserve(e.target); }
        });
      }, { threshold: 0.6 });
      nums.forEach(function (el) { io2.observe(el); });
    }

    /* ---------- 3. Rotating-word hero (typewriter) ---------- */
    var rot = document.querySelector("[data-words]");
    if (rot) {
      var words = rot.getAttribute("data-words").split(",").map(function (s) { return s.trim(); });
      if (!reduce) {
        var cursor = document.createElement("span");
        cursor.className = "tw-cursor";
        rot.parentNode.insertBefore(cursor, rot.nextSibling);
        var wi = 0, ci = 0, deleting = false;
        rot.textContent = "";
        (function type() {
          var w = words[wi];
          if (!deleting) {
            ci++;
            rot.textContent = w.slice(0, ci);
            if (ci === w.length) { deleting = true; return setTimeout(type, 1600); }
            setTimeout(type, 85 + Math.random() * 40);
          } else {
            ci--;
            rot.textContent = w.slice(0, ci);
            if (ci === 0) { deleting = false; wi = (wi + 1) % words.length; return setTimeout(type, 320); }
            setTimeout(type, 42);
          }
        })();
      }
    }

    /* ---------- 3b. Scorecard gauge ---------- */
    function animateGauge(card) {
      var fill = card.querySelector(".gauge .fill");
      var numEl = card.querySelector(".gauge-num .val");
      var score = parseInt(card.getAttribute("data-score") || "0", 10);
      var frac = score / 100;              // arc spans 0–100
      if (reduce) {
        if (fill) fill.style.strokeDashoffset = String(1 - frac);
        if (numEl) numEl.textContent = String(score);
        return;
      }
      var dur = 1300, start = null;
      function frame(now) {
        if (start === null) start = now;
        var p = Math.min((now - start) / dur, 1);
        var eased = 1 - Math.pow(1 - p, 3);
        if (fill) fill.style.strokeDashoffset = String(1 - frac * eased);
        if (numEl) numEl.textContent = String(Math.round(score * eased));
        if (p < 1) requestAnimationFrame(frame);
      }
      requestAnimationFrame(frame);
    }
    var gauges = Array.prototype.slice.call(document.querySelectorAll(".gauge-card"));
    if (gauges.length) {
      if (!("IntersectionObserver" in window)) {
        gauges.forEach(animateGauge);
      } else {
        var iog = new IntersectionObserver(function (entries) {
          entries.forEach(function (e) {
            if (e.isIntersecting) { animateGauge(e.target); iog.unobserve(e.target); }
          });
        }, { threshold: 0.5 });
        gauges.forEach(function (g) { iog.observe(g); });
      }
    }

    /* ---------- 3c. Before / after slider ---------- */
    Array.prototype.slice.call(document.querySelectorAll(".ba")).forEach(function (ba) {
      var dragging = false;
      function setPos(clientX) {
        var r = ba.getBoundingClientRect();
        var p = (clientX - r.left) / r.width;
        p = Math.max(0, Math.min(1, p));
        ba.style.setProperty("--pos", (p * 100) + "%");
      }
      ba.addEventListener("pointerdown", function (e) { dragging = true; setPos(e.clientX); ba.setPointerCapture(e.pointerId); });
      ba.addEventListener("pointermove", function (e) { if (dragging) setPos(e.clientX); });
      ba.addEventListener("pointerup", function () { dragging = false; });
      ba.addEventListener("pointercancel", function () { dragging = false; });
    });

    /* ---------- 4. Header shrink on scroll ---------- */
    var header = document.querySelector(".site-header");
    if (header) {
      var onScroll = function () {
        if (window.scrollY > 24) header.classList.add("scrolled");
        else header.classList.remove("scrolled");
      };
      window.addEventListener("scroll", onScroll, { passive: true });
      onScroll();
    }
  });
})();
