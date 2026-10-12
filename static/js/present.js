/* Present mode: one question at a time, keyboard or touch driven. */
(function () {
  "use strict";
  var cfg = window.PRESENT;
  var dataEl = document.getElementById("questions-data");
  var questions = cfg.questions || (dataEl ? JSON.parse(dataEl.textContent) : []);
  var staticUrl = cfg.staticUrl || (window.DQ_ENV && window.DQ_ENV.staticUrl) || "";
  if (cfg.title) {
    document.title = cfg.title + " · Present";
    document.querySelector(".ptitle").textContent = cfg.title;
  }
  if (cfg.backUrl) document.getElementById("back").href = cfg.backUrl;
  if (!questions.length) {
    document.getElementById("stem").textContent = "There are no questions to present.";
    return;
  }
  var index = cfg.start || 0;
  var revealed = false, showMisc = false;
  var tallies = {}; // per question id, in memory only

  var $ = function (id) { return document.getElementById(id); };
  var stemEl = $("stem"), optsEl = $("options"), imgEl = $("qimg");
  var timer = DQ.Timer($("timer"), $("timer-num"));
  var thinkInput = $("think");

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text; // textContent: never inject HTML from content
    return e;
  }

  function render() {
    var q = questions[index];
    $("counter").textContent = "Question " + (index + 1) + " / " + questions.length;
    $("year").textContent = "Y" + q.year_group;
    stemEl.textContent = q.stem;
    if (q.image) {
      imgEl.src = staticUrl + q.image;
      imgEl.alt = q.image_alt || "";
      imgEl.hidden = false;
    } else {
      imgEl.hidden = true;
      imgEl.removeAttribute("src");
    }
    optsEl.innerHTML = "";
    q.options.forEach(function (o) {
      var box = el("div", "option opt-" + o.letter.toLowerCase());
      if (revealed) box.classList.add(o.correct ? "is-correct" : "is-wrong");
      var letter = el("span", "letter", o.letter); letter.setAttribute("aria-hidden", "true");
      box.appendChild(letter);
      box.appendChild(el("span", "sr-only", "Option " + o.letter + ":"));
      box.appendChild(el("span", "text", o.text));
      if (revealed) box.appendChild(el("span", "verdict", o.correct ? "✓ Correct" : "✗"));
      if (revealed && showMisc && !o.correct) {
        var m = el("div", "miscon");
        m.appendChild(el("strong", "", o.misconception));
        m.appendChild(el("span", "", o.explanation));
        box.appendChild(m);
      }
      optsEl.appendChild(box);
    });
    DQ.renderMath(stemEl);
    DQ.renderMath(optsEl);
    renderTally();
    document.querySelector('[data-action="reveal"]').setAttribute("aria-pressed", String(revealed));
    document.querySelector('[data-action="misc"]').setAttribute("aria-pressed", String(showMisc));
  }

  function go(delta) {
    var next = index + delta;
    if (next < 0 || next >= questions.length) return;
    index = next;
    revealed = showMisc = false;
    timer.stop();
    $("tally-status").textContent = "";
    render();
  }

  // --- Quick tally ---------------------------------------------------------
  var inputs = Array.prototype.slice.call(document.querySelectorAll("#tally-inputs input"));
  function currentCounts() {
    var q = questions[index];
    return tallies[q.id] || (tallies[q.id] = { A: 0, B: 0, C: 0, D: 0 });
  }
  function renderTally() {
    var q = questions[index], counts = currentCounts();
    inputs.forEach(function (inp) { inp.value = counts[inp.dataset.letter]; });
    var max = Math.max(1, counts.A, counts.B, counts.C, counts.D);
    var total = counts.A + counts.B + counts.C + counts.D;
    var bars = $("bars"); bars.innerHTML = "";
    q.options.forEach(function (o) {
      var b = el("div", "bar opt-" + o.letter.toLowerCase());
      if (revealed && o.correct) b.classList.add("is-correct");
      b.appendChild(el("b", "", counts[o.letter]));
      var fill = el("div", "fill"); fill.style.height = (counts[o.letter] / max * 100) + "%";
      b.appendChild(fill);
      b.appendChild(el("b", "", o.letter + (revealed && o.correct ? " ✓" : "")));
      bars.appendChild(b);
    });
    bars.setAttribute("aria-label", "Answers: " + q.options.map(function (o) { return o.letter + " " + counts[o.letter]; }).join(", "));
    // Most common wrong answer, and the misconception behind it.
    var wrong = q.options.filter(function (o) { return !o.correct && counts[o.letter] > 0; })
      .sort(function (a, b) { return counts[b.letter] - counts[a.letter]; });
    var top = $("tally-top");
    if (!total) top.textContent = "";
    else if (!wrong.length) top.textContent = "Everyone chose the correct answer.";
    else {
      var w = wrong[0], tied = wrong.filter(function (o) { return counts[o.letter] === counts[w.letter]; });
      top.textContent = "Most common misconception: " + tied.map(function (o) {
        return o.letter + " – " + o.misconception;
      }).join("; ") + " (" + counts[w.letter] + " of " + total + ")";
    }
  }
  inputs.forEach(function (inp) {
    inp.addEventListener("input", function () {
      var v = parseInt(inp.value, 10);
      currentCounts()[inp.dataset.letter] = isNaN(v) || v < 0 ? 0 : Math.min(v, 999);
      renderTally();
      inp.focus();
    });
  });
  $("tally-clear").addEventListener("click", function () {
    tallies[questions[index].id] = { A: 0, B: 0, C: 0, D: 0 };
    $("tally-status").textContent = "";
    renderTally();
  });
  $("tally-save").addEventListener("click", function () {
    var q = questions[index], c = currentCounts();
    window.DQ_ENV.saveTallies([{ question_id: q.id, counts: [c.A, c.B, c.C, c.D], vote2: null }], cfg.quizSet)
      .then(function (msg) { $("tally-status").textContent = msg; })
      .catch(function () { $("tally-status").textContent = "Could not save."; });
  });

  // --- Controls --------------------------------------------------------------
  function thinkSeconds() {
    var v = parseInt(thinkInput.value, 10);
    return isNaN(v) ? 30 : Math.max(5, Math.min(v, 300));
  }
  var actions = {
    prev: function () { go(-1); },
    next: function () { go(1); },
    reveal: function () { revealed = !revealed; if (!revealed) showMisc = false; timer.stop(); render(); },
    misc: function () { showMisc = !showMisc; if (showMisc) revealed = true; timer.stop(); render(); },
    timer: function () { if (timer.running()) timer.stop(); else timer.start(thinkSeconds()); },
    full: DQ.toggleFullscreen,
    tally: function () { var t = $("tally"); t.hidden = !t.hidden; document.body.classList.toggle("tally-open", !t.hidden); if (!t.hidden) inputs[0].focus(); },
    help: function () { var h = $("help"); h.hidden = !h.hidden; },
  };
  document.querySelectorAll("[data-action]").forEach(function (b) {
    b.addEventListener("click", function () { actions[b.dataset.action](); });
  });
  var keys = { ArrowRight: "next", ArrowLeft: "prev", PageDown: "next", PageUp: "prev", " ": "next",
               r: "reveal", m: "misc", t: "timer", f: "full", y: "tally", "?": "help" };
  document.addEventListener("keydown", function (e) {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === "Escape") { $("help").hidden = true; $("tally").hidden = true; document.body.classList.remove("tally-open"); return; }
    if (DQ.isTyping(e)) return;
    var a = keys[e.key.length === 1 ? e.key.toLowerCase() : e.key];
    if (a) { e.preventDefault(); actions[a](); }
  });

  render();
})();
