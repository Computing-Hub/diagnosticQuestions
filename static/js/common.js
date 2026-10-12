/* Shared helpers: maths rendering, display preferences, full screen, thinking timer. */
(function () {
  "use strict";
  var DQ = (window.DQ = {});

  DQ.renderMath = function (el) {
    if (!window.renderMathInElement) return;
    window.renderMathInElement(el || document.body, {
      delimiters: [
        { left: "$$", right: "$$", display: true },
        { left: "$", right: "$", display: false },
        { left: "\\(", right: "\\)", display: false },
      ],
      throwOnError: false,
    });
  };

  // Preferences live in localStorage on this device only.
  function loadPrefs() {
    try { return JSON.parse(localStorage.getItem("dq-prefs") || "{}"); } catch (e) { return {}; }
  }
  function savePrefs(p) {
    try { localStorage.setItem("dq-prefs", JSON.stringify(p)); } catch (e) {}
  }
  function applyPrefs(p) {
    var root = document.documentElement;
    if (p.font) root.dataset.font = p.font; else delete root.dataset.font;
    if (p.theme) root.dataset.theme = p.theme; else delete root.dataset.theme;
    document.querySelectorAll("[data-toggle-font]").forEach(function (b) { b.setAttribute("aria-pressed", String(p.font === "dyslexic")); });
    document.querySelectorAll("[data-toggle-theme]").forEach(function (b) { b.setAttribute("aria-pressed", String(p.theme === "dark")); });
  }
  DQ.toggleFont = function () {
    var p = loadPrefs(); p.font = p.font === "dyslexic" ? "" : "dyslexic"; savePrefs(p); applyPrefs(p);
  };
  DQ.toggleTheme = function () {
    var p = loadPrefs(); p.theme = p.theme === "dark" ? "" : "dark"; savePrefs(p); applyPrefs(p);
  };

  DQ.toggleFullscreen = function () {
    if (document.fullscreenElement) document.exitFullscreen();
    else if (document.documentElement.requestFullscreen) document.documentElement.requestFullscreen().catch(function () {});
  };

  /* Countdown shown in #timer. start(seconds) restarts; stop() hides. */
  DQ.Timer = function (box, num) {
    var handle = null, left = 0;
    function tick() {
      num.textContent = left;
      if (left <= 0) {
        clearInterval(handle); handle = null;
        box.classList.add("done");
        box.querySelector("small").textContent = "Time’s up";
        return;
      }
      left -= 1;
    }
    return {
      running: function () { return handle !== null; },
      start: function (seconds) {
        clearInterval(handle);
        left = Math.max(1, seconds | 0);
        box.hidden = false;
        box.classList.remove("done");
        box.querySelector("small").textContent = "seconds";
        tick();
        handle = setInterval(tick, 1000);
      },
      stop: function () { clearInterval(handle); handle = null; box.hidden = true; },
      add: function (seconds) {
        if (handle === null) { this.start(Math.max(left, 0) + seconds); return; }
        left += seconds; num.textContent = left;
      },
    };
  };

  // Ignore shortcuts while typing in a form field.
  DQ.isTyping = function (e) {
    var t = e.target;
    return t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) && t.type !== "radio" && t.type !== "checkbox";
  };

  document.addEventListener("DOMContentLoaded", function () {
    applyPrefs(loadPrefs());
    document.querySelectorAll("[data-toggle-font]").forEach(function (b) { b.addEventListener("click", DQ.toggleFont); });
    document.querySelectorAll("[data-toggle-theme]").forEach(function (b) { b.addEventListener("click", DQ.toggleTheme); });
    DQ.renderMath(document.body);
  });
})();
