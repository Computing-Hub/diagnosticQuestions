/* Vote -> Argue -> Revote: the game screens, driven by DQGame (engine.js).
 *
 * Runs the same on the Django site and the USB copy. Needs window.QUESTIONS, TOPICS,
 * STRANDS, KEY_STAGES (questions.js) and window.DQ_ENV (env-server.js or env-static.js).
 * The game lives in sessionStorage in this browser tab only and is discarded at the end.
 *
 * Keys: Space / → next step, V votes, A argue timer, R reveal, T timer, M notes, F full screen.
 */
(function () {
  "use strict";
  var G = window.DQGame, ENV = window.DQ_ENV;
  var LETTERS = G.LETTERS;
  var STORE_KEY = "dq-game";
  var app = document.getElementById("game");
  var byId = {};
  (window.QUESTIONS || []).forEach(function (q) { byId[q.id] = q; });
  var memoryState = null, lastPhaseKey = null, message = "";
  var timer = DQ.Timer(document.getElementById("timer"), document.getElementById("timer-num"));
  var params = new URLSearchParams(location.search);

  // --- state (sessionStorage, with an in-memory fallback) -----------------------
  function load() {
    try { var raw = sessionStorage.getItem(STORE_KEY); if (raw) return JSON.parse(raw); } catch (e) {}
    return memoryState;
  }
  function save(state) {
    memoryState = state;
    try { sessionStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch (e) {}
  }
  function discard() {
    memoryState = null;
    try { sessionStorage.removeItem(STORE_KEY); } catch (e) {}
  }

  // --- helpers --------------------------------------------------------------------
  function esc(text) {
    return String(text === null || text === undefined ? "" : text)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }
  function current(state) { return byId[state.qids[state.index]]; }
  function hasWorkedAt(state) { return function (i) { return G.hasWorkedAnswer(byId[state.qids[i]]); }; }
  function detective(q) { return G.detectiveOptions(q, G.detectivePool(q, window.QUESTIONS)); }
  function roundCorrect(state, q) {
    if (state.roundType === "detective") return detective(q).correct;
    if (state.roundType === "make") return null;
    return q.correct;
  }

  function sourceQuestions(kind, key) {
    if (kind === "topic") {
      return window.QUESTIONS.filter(function (q) { return q.topic === key; });
    }
    if (kind === "set") {
      var set = ENV.getSets().filter(function (s) { return String(s.id) === String(key); })[0];
      return set ? set.question_ids.map(function (id) { return byId[id]; }).filter(Boolean) : [];
    }
    return [];
  }
  function sourceTitle(kind, key) {
    if (kind === "topic") {
      var t = window.TOPICS.filter(function (t) { return t.slug === key; })[0];
      return t ? t.name : key;
    }
    var s = ENV.getSets().filter(function (s) { return String(s.id) === String(key); })[0];
    return s ? s.name : "Quiz set";
  }

  // --- building blocks -----------------------------------------------------------
  function optionHtml(o, reveal, showMisc) {
    var cls = "option opt-" + o.letter.toLowerCase() + (reveal ? (o.correct ? " is-correct" : " is-wrong") : "");
    var html = '<div class="' + cls + '"><span class="letter" aria-hidden="true">' + o.letter + "</span>" +
      '<span class="sr-only">Option ' + o.letter + ":</span>" +
      '<span class="text math">' + esc(o.text) + "</span>";
    if (reveal) html += '<span class="verdict">' + (o.correct ? "✓ Correct" : "✗") + "</span>";
    if (reveal && showMisc && !o.correct) {
      html += '<div class="miscon"><strong>' + esc(o.misconception) + '</strong><span class="math">' + esc(o.explanation) + "</span></div>";
    }
    return html + "</div>";
  }

  function labelOptionHtml(letter, label, reveal, correct) {
    var cls = "option opt-" + letter.toLowerCase() + (reveal ? (letter === correct ? " is-correct" : " is-wrong") : "");
    return '<div class="' + cls + '"><span class="letter" aria-hidden="true">' + letter + "</span>" +
      '<span class="sr-only">Option ' + letter + ":</span><span class=\"text\">" + esc(label) + "</span>" +
      (reveal ? '<span class="verdict">' + (letter === correct ? "✓ Correct" : "✗") + "</span>" : "") + "</div>";
  }

  function chartHtml(counts, title, correct, reveal) {
    if (!counts) return "";
    var total = counts.reduce(function (a, b) { return a + b; }, 0), top = Math.max.apply(null, counts) || 1;
    var label = title + ": " + LETTERS.map(function (l, i) { return l + " " + counts[i]; }).join(", ");
    var bars = LETTERS.map(function (l, i) {
      var right = reveal && l === correct;
      return '<div class="bar opt-' + l.toLowerCase() + (right ? " is-correct" : "") + '"><b>' + counts[i] + "</b>" +
        '<div class="fill" style="height:' + Math.round(100 * counts[i] / top) + '%"></div><b>' + l + (right ? " ✓" : "") + "</b></div>";
    }).join("");
    return '<figure class="vote-chart"><figcaption>' + esc(title) + ' <span class="hint">(' + total + " vote" + (total === 1 ? "" : "s") +
      ')</span></figcaption><div class="bars" role="img" aria-label="' + esc(label) + '">' + bars + "</div></figure>";
  }

  function teamBarsHtml(state, showDelta, big) {
    var max = Math.max.apply(null, state.teams.map(function (t) { return t.score; }).concat([1]));
    return '<ul class="team-bars' + (big ? " big" : "") + '" aria-label="Team scores">' + state.teams.map(function (t, i) {
      var delta = showDelta && state.deltas && state.deltas.length ? state.deltas[i] : null;
      return '<li><span class="team-name">' + esc(t.name) + (state.best === i ? " ★" : "") + "</span>" +
        '<span class="team-bar"><span style="width:' + Math.round(100 * t.score / max) + '%"></span></span>' +
        '<span class="team-score">' + t.score + "</span>" +
        (delta !== null ? '<span class="delta">' + (delta > 0 ? "+" : "") + delta + "</span>" : "") + "</li>";
    }).join("") + "</ul>";
  }

  function stepsHtml(state) {
    var p = state.phase;
    var steps = state.roundType === "make"
      ? [["Discuss", p === "question"], ["Reveal", p === "reveal"]]
      : [["Think", p === "question"], ["Vote 1", p === "vote1" || p === "chart"], ["Argue", p === "argue"],
         ["Vote 2", p === "vote2"], ["Reveal", p === "reveal"]];
    return '<ol class="steps" aria-label="Round steps">' + steps.map(function (s) {
      return "<li" + (s[1] ? ' aria-current="step"' : "") + ">" + s[0] + "</li>";
    }).join("") + "</ol>";
  }

  function button(action, label, opts) {
    opts = opts || {};
    return '<button type="button" class="btn' + (opts.primary ? " btn-primary" : "") + (opts.small ? " btn-small" : "") + '" data-action="' + action + '"' +
      (opts.primary ? " data-primary" : "") + (opts.key ? ' data-key="' + opts.key + '"' : "") +
      (opts.team !== undefined ? ' data-team="' + opts.team + '"' : "") +
      (opts.pressed !== undefined ? ' aria-pressed="' + opts.pressed + '"' : "") + ">" + label + "</button>";
  }

  function voteInputHtml(state, vote) {
    if (state.style === "team") {
      return state.teams.map(function (t, i) {
        var answers = '<div class="pick-group" role="group" aria-label="' + esc(t.name) + ' answer">' + LETTERS.map(function (l) {
          var checked = vote === 2 && state.a1[i] === l ? " checked" : "";
          return '<label class="pick opt-' + l.toLowerCase() + '"><input type="radio" name="answer' + i + '" value="' + l + '" required' + checked + "><span>" + l + "</span></label>";
        }).join("") + "</div>";
        var bets = vote === 1 ? '<div class="pick-group bets" role="group" aria-label="' + esc(t.name) + ' confidence bet"><span class="hint">Bet</span>' +
          G.BETS.map(function (b) {
            return '<label class="pick"><input type="radio" name="bet' + i + '" value="' + b + '"' + (b === 1 ? " checked" : "") + "><span>" + b + "</span></label>";
          }).join("") + "</div>" : "";
        return '<fieldset class="team-row"><legend>' + esc(t.name) + (vote === 2 ? " <small>(bet " + state.bets[i] + ", locked)</small>" : "") + "</legend>" + answers + bets + "</fieldset>";
      }).join("");
    }
    return '<div class="count-inputs" data-counts>' + LETTERS.map(function (l, i) {
      return '<label class="opt-' + l.toLowerCase() + '"><span class="letter">' + l + "</span>" +
        '<input type="number" name="count_' + l.toLowerCase() + '" min="0" max="999" inputmode="numeric" placeholder="0"' + (i === 0 ? " data-autofocus" : "") + "></label>";
    }).join("") + '<p class="hint">Total: <b data-total>0</b>. Count hands, answer cards or the four corners.</p></div>';
  }

  // --- setup screen --------------------------------------------------------------
  function renderSetup() {
    var kind = params.get("kind") || "", key = params.get("key") || "";
    var sets = ENV.getSets();
    var options = '<option value="">Choose…</option>';
    if (sets.length) {
      options += '<optgroup label="Quiz sets">' + sets.map(function (s) {
        return '<option value="set:' + esc(s.id) + '"' + (kind === "set" && key === String(s.id) ? " selected" : "") + ">" + esc(s.name) + "</option>";
      }).join("") + "</optgroup>";
    }
    Object.keys(window.KEY_STAGES).forEach(function (ks) {
      window.STRANDS.forEach(function (strand) {
        var topics = window.TOPICS.filter(function (t) { return t.key_stage === ks && t.strand === strand; });
        if (!topics.length) return;
        options += '<optgroup label="' + esc(ks + " · " + strand) + '">' + topics.map(function (t) {
          return '<option value="topic:' + esc(t.slug) + '"' + (kind === "topic" && key === t.slug ? " selected" : "") + ">" + esc(t.name) + " (" + t.count + (t.tier === "higher" ? ", Higher" : "") + ")</option>";
        }).join("") + "</optgroup>";
      });
    });
    var radios = function (name, items) {
      return Object.keys(items).map(function (v, i) {
        return '<label class="radio"><input type="radio" name="' + name + '" value="' + v + '"' + (i === 0 ? " checked" : "") + "> " + esc(items[v]) + "</label>";
      }).join("");
    };
    var teamInputs = ["Red", "Blue", "Green", "Yellow", "", ""].map(function (n, i) {
      return "<label>Team " + (i + 1) + ' <input type="text" name="team" value="' + n + '" maxlength="20" autocomplete="off"></label>';
    }).join("");
    var inProgress = load();

    document.body.classList.remove("mode-present", "mode-game");
    app.className = "page";
    app.innerHTML =
      "<h1>Vote → Argue → Revote</h1>" +
      '<p class="intro">Peer Instruction: everyone votes, argues with someone who chose differently, then votes again. The learning is in the shift between the two votes.</p>' +
      (inProgress && inProgress.phase !== "over" ? '<p class="notice">A game is in progress. ' + button("resume", "Return to it", { small: true }) + " or set up a new one below (this discards it).</p>" : "") +
      (message ? '<p class="msg msg-error" role="alert">' + esc(message) + "</p>" : "") +
      '<form class="game-setup" data-setup>' +
      '<fieldset><legend>Questions</legend><label>Play from <select name="source" required>' + options + "</select></label></fieldset>" +
      "<fieldset><legend>Input style</legend>" + radios("style", G.STYLES) +
      '<p class="hint">Class mode: you type how many students chose A, B, C and D (show of hands, answer cards or Four Corners). Nobody is scored.</p></fieldset>' +
      '<fieldset data-teams><legend>Teams (2–6). Use colours or animals, never student names.</legend><div class="team-inputs">' + teamInputs + "</div>" +
      '<p class="hint">Scoring: right in both votes + bet; wrong then right (convinced) +1; right then wrong − bet; wrong both times − bet; +1 for the best argument. Scores never go below 0.</p></fieldset>' +
      "<fieldset><legend>Round type</legend>" + radios("mix", G.MIXES) +
      '<p class="hint">Standard: answer the question. Misconception detectives: read a student’s working with one error and pick the mistake. Make it right: write a question where a wrong answer would be correct (discussion, no scoring). You can change the type for any single round.</p></fieldset>' +
      '<fieldset><legend>Timers</legend><label>Thinking time <input type="number" name="think" min="5" max="300" value="45"> s</label> ' +
      '<label>Argue time <input type="number" name="argue" min="15" max="600" value="90"> s</label>' +
      '<p class="hint">Fixed time for every question; accuracy only, never speed.</p></fieldset>' +
      '<p class="hint">Nothing is saved: scores and votes stay in this browser tab and are discarded at the end, unless you choose “Save tally” (anonymous counts only).</p>' +
      '<button type="submit" class="btn btn-primary">Start</button></form>';
    message = "";
    var form = app.querySelector("[data-setup]");
    var syncStyle = function () { app.querySelector("[data-teams]").hidden = form.style.value !== "team"; };
    form.addEventListener("change", syncStyle);
    syncStyle();
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var src = form.source.value.split(":"), skind = src[0], skey = src.slice(1).join(":");
      try {
        if (!skind || !skey) throw new G.GameError("Choose a quiz set or topic to play.");
        var qs = sourceQuestions(skind, skey);
        var state = G.newGame({
          style: form.style.value, qids: qs.map(function (q) { return q.id; }),
          teamNames: Array.prototype.map.call(form.querySelectorAll("[name=team]"), function (i) { return i.value; }),
          mix: form.mix.value, think: form.think.value, argue: form.argue.value,
          title: sourceTitle(skind, skey), setId: skind === "set" ? skey : null,
        });
        G.startRound(state, G.hasWorkedAnswer(byId[state.qids[0]]));
        save(state);
        lastPhaseKey = null;
        render();
      } catch (err) {
        if (!(err instanceof G.GameError)) throw err;
        message = err.message;
        renderSetup();
      }
    });
  }

  // --- play screen ----------------------------------------------------------------
  function renderPlay(state) {
    var q = current(state);
    if (!q) { // removed from the bank since the game started: skip it
      state.phase = "reveal";
      if (!G.advance(state, hasWorkedAt(state))) { save(state); return render(); }
      save(state);
      return render();
    }
    var phase = state.phase, rtype = state.roundType, reveal = phase === "reveal";
    var correct = roundCorrect(state, q), team = state.style === "team";
    var featured = rtype === "detective" ? q.worked_option : rtype === "make" ? G.featuredWrongLetter(q, state.index) : null;
    var feat = featured ? G.option(q, featured) : null;
    var det = rtype === "detective" ? detective(q) : null;

    var stage = '<div class="stem math">' + esc(q.stem) + "</div>" +
      (q.image ? '<img class="q-img" src="' + esc(ENV.staticUrl + q.image) + '" alt="' + esc(q.image_alt) + '">' : "");
    if (rtype === "standard") {
      stage += '<div class="options big">' + q.options.map(function (o) { return optionHtml(o, reveal, true); }).join("") + "</div>";
    } else if (rtype === "detective") {
      stage += '<div class="worked"><p class="worked-title">A student’s working:</p><ol>' +
        q.worked_steps.map(function (s) { return '<li class="math">' + esc(s) + "</li>"; }).join("") + "</ol></div>" +
        '<p class="prompt">Which mistake did they make?</p><div class="options big labels">' +
        LETTERS.map(function (l) { return labelOptionHtml(l, det.options[l], reveal, det.correct); }).join("") + "</div>";
    } else {
      stage += '<p class="featured">A wrong answer: <span class="featured-answer math">' + esc(feat.text) + "</span></p>" +
        '<p class="prompt">In your teams, write a question where <span class="math">' + esc(feat.text) + "</span> would be the correct answer.</p>";
    }
    if (reveal && rtype !== "standard") {
      stage += '<div class="miscon reveal-note"><strong>The answer <span class="math">' + esc(feat.text) + "</span> comes from: " + esc(feat.misconception) +
        '</strong><span class="math">' + esc(feat.explanation) + " The correct answer to the question is " + esc(G.option(q, q.correct).text) + ".</span></div>";
    }

    var panel = "";
    if (phase === "question") {
      panel = '<label class="round-switch">Round type <select data-roundtype>' + Object.keys(G.ROUND_TYPES).filter(function (v) {
        return v !== "detective" || G.hasWorkedAnswer(q);
      }).map(function (v) {
        return '<option value="' + v + '"' + (v === rtype ? " selected" : "") + ">" + G.ROUND_TYPES[v] + "</option>";
      }).join("") + "</select></label>" +
        button("start", rtype === "make" ? "Show the misconception →" : "V Vote 1 →", { primary: true, key: "v" });
    } else if (phase === "vote1" || phase === "vote2") {
      var v = phase === "vote1" ? 1 : 2;
      panel = '<form class="team-grid vote-form" data-vote="' + v + '"><h2>Vote ' + v +
        (team ? (v === 1 ? ": each team’s answer and confidence bet (1–3)" : ": teams may change their answer") : "") + "</h2>" +
        voteInputHtml(state, v) +
        '<button type="submit" class="btn btn-primary" data-primary>' + (v === 1 ? "Show Vote 1 →" : "Reveal →") + "</button></form>" +
        (v === 2 ? '<div class="chart-row">' + chartHtml(state.c1, "Vote 1") + "</div>" : "");
    } else if (phase === "chart") {
      panel = '<div class="chart-row">' + chartHtml(state.c1, "Vote 1") + '</div><div class="decision">';
      if (state.decision === "reveal") {
        panel += '<p class="prompt">Most of the class agrees on the right answer.</p>' +
          button("reveal", "R Reveal →", { primary: true, key: "r" }) + button("argue", "A Argue anyway", { key: "a" });
      } else {
        if (state.decision === "reteach") {
          var notes = rtype === "detective"
            ? "<p><b>" + esc(feat.misconception) + '</b>: <span class="math">' + esc(feat.explanation) + "</span></p>"
            : "<ul>" + q.options.filter(function (o) { return !o.correct; }).map(function (o) {
                return "<li><b>" + o.letter + ": " + esc(o.misconception) + '</b>. <span class="math">' + esc(o.explanation) + "</span></li>";
              }).join("") + "</ul><p>Correct: <b>" + q.correct + "</b></p>";
          panel += '<p class="prompt">Re-teach first: fewer than 3 in 10 chose the right answer.</p>' +
            '<details class="teacher-notes"><summary>Teacher notes (M)</summary>' + notes + "</details>";
        } else {
          panel += '<p class="prompt">The class is split. Time to argue.</p>';
        }
        panel += button("argue", "A " + (state.decision === "reteach" ? "Argue anyway" : "Start Argue") + " →", { primary: true, key: "a" }) +
          button("reveal", "R Reveal now", { key: "r" });
      }
      panel += "</div>";
    } else if (phase === "argue") {
      panel = '<div class="argue"><p class="argue-prompt">Find someone (or a team) who chose differently and convince them.</p><div class="actions">' +
        button("extend", "+30 s") + button("restart", "A Restart timer") + button("vote2open", "V Vote 2 →", { primary: true, key: "v" }) + "</div></div>";
    } else {
      if (rtype !== "make") {
        var p1 = G.percentCorrect(state.c1, correct);
        panel += '<div class="chart-row">' + chartHtml(state.c1, "Vote 1", correct, true) + chartHtml(state.c2, "Vote 2", correct, true) + "</div>";
        var shift = "Correct: <b>" + p1 + "%</b>";
        if (state.c2) {
          var p2 = G.percentCorrect(state.c2, correct), gain = p2 - p1;
          shift += " → <b>" + p2 + "%</b> " + (gain > 0 ? '<span class="shift-up">▲ up ' + gain + "</span>"
            : gain < 0 ? '<span class="shift-down">▼ down ' + (-gain) + "</span>" : '<span class="hint">no change</span>');
        }
        panel += '<p class="shift">' + shift + "</p>";
        if (team) {
          var two = state.a2 && state.a2.length;
          panel += '<table class="round-results"><thead><tr><th>Team</th><th>Bet</th><th>Vote 1</th>' + (two ? "<th>Vote 2</th>" : "") +
            "<th>Points</th><th>Best argument</th></tr></thead><tbody>" + state.teams.map(function (t, i) {
              var mark = function (a) { return esc(a) + " " + (a === correct ? "✓" : "✗"); };
              var d = state.deltas[i];
              return "<tr><td>" + esc(t.name) + "</td><td>" + state.bets[i] + "</td><td>" + mark(state.a1[i]) + "</td>" +
                (two ? "<td>" + mark(state.a2[i]) + "</td>" : "") + "<td>" + (d > 0 ? "+" : "") + d + "</td><td>" +
                button("best", state.best === i ? "★ Awarded" : "+1", { small: true, team: i, pressed: state.best === i }) + "</td></tr>";
            }).join("") + "</tbody></table>";
        }
      }
      panel += button("next", G.isLastQuestion(state) ? "Finish →" : "Next question →", { primary: true });
    }

    document.body.classList.add("mode-present", "mode-game");
    app.className = "present";
    app.innerHTML =
      '<div class="pbar">' + button("end", "End game", { small: true }) +
      '<span class="ptitle">' + esc(state.title) + '</span><span class="pcount">Q ' + (state.index + 1) + " / " + state.qids.length + "</span>" +
      '<span class="tag round-tag">' + G.ROUND_TYPES[rtype] + "</span>" + stepsHtml(state) + prefsHtml() + "</div>" +
      (team ? teamBarsHtml(state, reveal) : "") +
      (message ? '<p class="msg msg-error" role="alert">' + esc(message) + "</p>" : "") +
      '<section class="stage' + (phase !== "question" ? " compact" : "") + '">' + stage + "</section>" +
      '<section class="game-panel">' + panel + "</section>" +
      '<p class="key-hint hint">Space next step · V votes · A argue timer · R reveal · T timer · M notes · F full screen</p>';
    message = "";

    // Timers start only when a phase is first entered, not on every redraw.
    var phaseKey = state.index + ":" + phase;
    if (phaseKey !== lastPhaseKey) {
      lastPhaseKey = phaseKey;
      if (phase === "question") timer.start(state.think);
      else if (phase === "argue") timer.start(state.argue);
      else timer.stop();
    }
    var focus = app.querySelector("[data-autofocus]");
    if (focus) focus.focus();
  }

  // --- end screen ------------------------------------------------------------------
  function renderEnd(state) {
    timer.stop();
    var learned = G.learned(state), reteach = G.stillToReteach(state, byId);
    var canSave = G.talliesToSave(state).length && !state.saved;
    document.body.classList.add("mode-present", "mode-game", "mode-end");
    app.className = "present";
    app.innerHTML =
      '<div class="pbar no-print"><span class="ptitle">' + esc(state.title) + ": end of game</span>" + prefsHtml() + "</div>" +
      '<section class="end">' +
      (state.teams.length ? '<section class="no-print"><h2>Team scores</h2>' + teamBarsHtml(state, false, true) + "</section>" : "") +
      '<section class="no-print"><h2>What the class learned</h2>' + (learned.length ? '<ul class="learned">' + learned.map(function (r) {
        var q = byId[r.qid];
        return '<li><span class="shift">Correct: <b>' + r.before + "%</b> → <b>" + r.after + '%</b></span> <span class="math">' + esc(q ? q.stem : r.qid) + "</span></li>";
      }).join("") + "</ul>" : "<p>No question improved between Vote 1 and Vote 2 this time.</p>") + "</section>" +
      '<section class="reteach"><h2>Still to reteach <span class="print-only">: ' + esc(state.title) + ", " + new Date().toLocaleDateString("en-GB") + "</span></h2>" +
      (reteach.length ? '<p class="hint">Misconceptions still chosen in the final vote of Standard rounds. Anonymous counts only.</p><ul class="misc-summary">' +
        reteach.map(function (m) {
          return '<li><span class="count">' + m.count + "×</span> <b>" + esc(m.label) + '</b> <span class="hint">(' + esc(m.questions.join(", ")) +
            ')</span><br><span class="math expl">' + esc(m.explanation) + "</span></li>";
        }).join("") + "</ul>" : "<p>No misconceptions survived the final vote.</p>") + "</section>" +
      '<div class="actions no-print">' + (reteach.length ? button("print", "Print “Still to reteach”") : "") +
      (canSave ? button("savetally", "Save tally") : state.saved ? '<span class="hint">Tally saved.</span>' : "") +
      button("discard", "Finish and discard game", { primary: true }) + "</div>" +
      (message ? '<p class="hint" role="status">' + esc(message) + "</p>" : "") +
      '<p class="hint no-print">“Save tally” stores only the date, quiz set, question id and the anonymous A/B/C/D counts for both votes. Team names and scores are never saved.</p></section>';
    message = "";
  }

  function prefsHtml() {
    return '<div class="prefs" role="group" aria-label="Display options">' +
      '<button type="button" class="btn btn-small" data-pref="font" aria-pressed="' + (document.documentElement.dataset.font === "dyslexic") + '">Dyslexia font</button>' +
      '<button type="button" class="btn btn-small" data-pref="theme" aria-pressed="' + (document.documentElement.dataset.theme === "dark") + '">Dark</button></div>';
  }

  // --- render & actions ---------------------------------------------------------------
  function render() {
    var state = load();
    document.body.classList.remove("mode-end");
    if (!state) renderSetup();
    else if (state.phase === "over") renderEnd(state);
    else renderPlay(state);
    DQ.renderMath(app);
  }

  function readVote(form, state) {
    var get = function (name) { var el = form.querySelector('[name="' + name + '"]:checked'); return el ? el.value : null; };
    return {
      counts: LETTERS.map(function (l) { var el = form.querySelector('[name="count_' + l.toLowerCase() + '"]'); return el ? el.value : ""; }),
      answers: state.teams.map(function (t, i) { return get("answer" + i); }),
      bets: state.teams.map(function (t, i) { return get("bet" + i); }),
    };
  }

  function act(action, el) {
    var state = load();
    if (action === "resume") return render();
    if (action === "print") return window.print();
    if (!state) return render();
    var q = current(state), correct = q ? roundCorrect(state, q) : null;
    try {
      if (action === "start") {
        if (state.roundType === "make") G.finishMakeItRight(state); else state.phase = "vote1";
      } else if (action === "argue") G.startArgue(state);
      else if (action === "reveal") G.revealNow(state, correct);
      else if (action === "vote2open") G.toVote2(state);
      else if (action === "best") G.awardBestArgument(state, parseInt(el.dataset.team, 10));
      else if (action === "next") G.advance(state, hasWorkedAt(state));
      else if (action === "end") state.phase = "over";
      else if (action === "extend") return timer.add(30);
      else if (action === "restart") return timer.start(state.argue);
      else if (action === "savetally") {
        ENV.saveTallies(G.talliesToSave(state), state.setId).then(function (msg) {
          state.saved = true; save(state); message = msg; render();
        }).catch(function (err) { message = err.message; render(); });
        return;
      } else if (action === "discard") {
        discard(); lastPhaseKey = null; timer.stop(); return render();
      }
    } catch (err) {
      if (!(err instanceof G.GameError)) throw err;
      message = err.message;
    }
    save(state);
    render();
  }

  app.addEventListener("click", function (e) {
    var b = e.target.closest("[data-action]");
    if (b) { act(b.dataset.action, b); return; }
    var p = e.target.closest("[data-pref]");
    if (p) { if (p.dataset.pref === "font") DQ.toggleFont(); else DQ.toggleTheme(); render(); }
  });
  app.addEventListener("change", function (e) {
    if (!e.target.matches("[data-roundtype]")) return;
    var state = load();
    try { G.setRoundType(state, e.target.value, G.hasWorkedAnswer(current(state))); }
    catch (err) { if (!(err instanceof G.GameError)) throw err; message = err.message; }
    save(state);
    render();
  });
  app.addEventListener("input", function (e) {
    var box = e.target.closest("[data-counts]");
    if (!box) return;
    var t = 0;
    box.querySelectorAll("input").forEach(function (i) { t += parseInt(i.value, 10) || 0; });
    box.querySelector("[data-total]").textContent = t;
  });
  app.addEventListener("submit", function (e) {
    var form = e.target.closest("[data-vote]");
    if (!form) return;
    e.preventDefault();
    var state = load(), q = current(state), correct = roundCorrect(state, q);
    try {
      if (form.dataset.vote === "1") G.submitVote1(state, correct, readVote(form, state));
      else G.submitVote2(state, correct, readVote(form, state));
    } catch (err) {
      if (!(err instanceof G.GameError)) throw err;
      message = err.message;
    }
    save(state);
    render();
  });

  function press(selector) {
    var el = app.querySelector(selector);
    if (!el) return false;
    if (el.tagName === "BUTTON" && el.type === "submit") {
      var form = el.form;
      if (form.reportValidity && !form.reportValidity()) return true;
      form.requestSubmit ? form.requestSubmit() : form.dispatchEvent(new Event("submit", { cancelable: true, bubbles: true }));
    } else el.click();
    return true;
  }

  document.addEventListener("keydown", function (e) {
    if (e.ctrlKey || e.metaKey || e.altKey || DQ.isTyping(e)) return;
    var state = load();
    if (!state || state.phase === "over") return;
    var k = e.key.length === 1 ? e.key.toLowerCase() : e.key, handled = true;
    var onButton = document.activeElement && document.activeElement.tagName === "BUTTON";
    if (k === " " && onButton) return; // the browser already clicks a focused button
    if (k === " " || k === "ArrowRight") press("[data-primary]");
    else if (k === "v") { if (!press('[data-key="v"]')) { var first = app.querySelector(".vote-form input"); if (first) first.focus(); } }
    else if (k === "a") { if (state.phase === "argue") timer.start(state.argue); else press('[data-key="a"]'); }
    else if (k === "r") press('[data-key="r"]');
    else if (k === "t") { if (timer.running()) timer.stop(); else timer.start(state.phase === "argue" ? state.argue : state.think); }
    else if (k === "f") DQ.toggleFullscreen();
    else if (k === "m") { var notes = app.querySelector(".teacher-notes"); if (notes) notes.open = !notes.open; else document.body.classList.toggle("hide-misc"); }
    else handled = false;
    if (handled) e.preventDefault();
  });

  render();
})();
