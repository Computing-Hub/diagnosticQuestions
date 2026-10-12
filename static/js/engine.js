/* Vote -> Argue -> Revote (Peer Instruction) game rules.
 *
 * One engine shared by the Django site and the portable USB copy. Pure functions over a
 * plain state object, which the UI keeps in sessionStorage: nothing reaches a server.
 * Loads as a browser global (window.DQGame) or a Node module (for the tests).
 *
 * Questions are the objects from questions.js (window.QUESTIONS):
 *   {id, topic, strand, stem, correct, options: [{letter, text, correct, misconception, explanation}],
 *    worked_option, worked_steps, ...}
 *
 * State:
 *   {style: "class"|"team", teams: [{name, score}], qids, title, setId, mix, think, argue,
 *    index, roundType, phase: "question"|"vote1"|"chart"|"argue"|"vote2"|"reveal"|"over",
 *    c1, c2: [nA, nB, nC, nD] | null, a1, a2: ["A", ...], bets: [1..3], decision,
 *    deltas, best, history: [[qid, roundType, correct, c1, c2|null], ...], saved}
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.DQGame = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var LETTERS = ["A", "B", "C", "D"];
  var ROUND_TYPES = { standard: "Standard", detective: "Misconception detectives", make: "Make it right" };
  var MIXES = { standard: "Standard", detective: "Misconception detectives", make: "Make it right", mixed: "Mixed (rotate all three)" };
  var STYLES = { "class": "Class: anonymous counts, no scores", team: "Teams: 2–6 teams with confidence bets" };
  var MIN_TEAMS = 2, MAX_TEAMS = 6, MAX_TEAM_NAME = 20, MAX_COUNT = 999;
  var BETS = [1, 2, 3];
  var SKIP_ABOVE = 70;    // % correct in Vote 1 above which the class "has it"
  var RETEACH_BELOW = 30; // % correct below which the teacher is prompted to re-teach first

  function GameError(message) { this.name = "GameError"; this.message = message; }
  GameError.prototype = Object.create(Error.prototype);
  function fail(message) { throw new GameError(message); }

  // --- questions ---------------------------------------------------------------
  function option(q, letter) { return q.options[LETTERS.indexOf(letter)]; }
  function wrongLetters(q) { return LETTERS.filter(function (l) { return l !== q.correct; }); }
  function hasWorkedAnswer(q) { return !!(q && q.worked_option && q.worked_steps && q.worked_steps.length); }

  // --- setup -------------------------------------------------------------------
  function cleanTeamNames(names) {
    var clean = (names || []).map(function (n) { return String(n || "").trim().slice(0, MAX_TEAM_NAME); })
      .filter(function (n) { return n; });
    if (clean.length < MIN_TEAMS || clean.length > MAX_TEAMS) fail("Choose between " + MIN_TEAMS + " and " + MAX_TEAMS + " teams.");
    var lower = clean.map(function (n) { return n.toLowerCase(); });
    if (new Set(lower).size !== lower.length) fail("Team names must be different.");
    return clean;
  }

  function clamp(value, low, high, fallback) {
    var n = parseInt(value, 10);
    return isNaN(n) ? fallback : Math.max(low, Math.min(n, high));
  }

  function newGame(opts) {
    if (!STYLES[opts.style]) fail("Choose class or team mode.");
    var mix = opts.mix || "standard";
    if (!MIXES[mix]) fail("Unknown round type.");
    if (!opts.qids || !opts.qids.length) fail("There are no questions to play.");
    var teams = opts.style === "team" ? cleanTeamNames(opts.teamNames).map(function (n) { return { name: n, score: 0 }; }) : [];
    return {
      style: opts.style, teams: teams, qids: opts.qids.slice(), title: opts.title || "", setId: opts.setId || null,
      mix: mix, think: clamp(opts.think, 5, 300, 45), argue: clamp(opts.argue, 15, 600, 90),
      index: 0, history: [], roundType: null, phase: null, saved: false,
    };
  }

  function roundTypeFor(mix, index, hasWorked) {
    var rtype = mix === "mixed" ? ["standard", "detective", "make"][index % 3] : mix;
    if (rtype === "detective" && hasWorked === false) return "standard"; // no worked answer to investigate
    return rtype;
  }

  function startRound(state, hasWorked) {
    state.roundType = roundTypeFor(state.mix, state.index, hasWorked);
    state.phase = "question";
    state.c1 = null; state.c2 = null; state.a1 = []; state.a2 = []; state.bets = [];
    state.decision = null; state.deltas = []; state.best = null;
  }

  function setRoundType(state, roundType, hasWorked) {
    if (!ROUND_TYPES[roundType]) fail("Unknown round type.");
    if (state.phase !== "question") fail("The round type can only be changed before Vote 1.");
    if (roundType === "detective" && !hasWorked) fail("This question has no worked answer for Misconception detectives.");
    state.roundType = roundType;
  }

  function isLastQuestion(state) { return state.index >= state.qids.length - 1; }

  // --- round content -----------------------------------------------------------
  function featuredWrongLetter(q, index) { return wrongLetters(q)[index % 3]; }

  // Small seeded PRNG so a question always gets the same detective options.
  function seeded(text) {
    var h = 2166136261;
    for (var i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 16777619); }
    return function () {
      h += 0x6D2B79F5;
      var t = Math.imul(h ^ (h >>> 15), 1 | h);
      t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /* Misconception detectives: four misconception labels, one right.
     The others are the question's other two labels plus one from `pool` (labels from a
     different strand, so no two options describe the same mistake). Stable order.
     Returns {options: {A: label, ...}, correct: letter}. */
  function detectiveOptions(q, pool) {
    var target = option(q, q.worked_option).misconception;
    var labels = wrongLetters(q).map(function (l) { return option(q, l).misconception; });
    var seen = new Set(labels.map(function (l) { return l.toLowerCase(); }));
    var rand = seeded(q.id + ":detective");
    var extras = Array.from(new Set(pool || [])).filter(function (p) { return p && !seen.has(p.toLowerCase()); }).sort();
    labels.push(extras.length ? extras[Math.floor(rand() * extras.length)] : "Guessed - no mistake in method");
    for (var i = labels.length - 1; i > 0; i--) {
      var j = Math.floor(rand() * (i + 1)), tmp = labels[i]; labels[i] = labels[j]; labels[j] = tmp;
    }
    var options = {};
    LETTERS.forEach(function (l, i) { options[l] = labels[i]; });
    return { options: options, correct: LETTERS[labels.indexOf(target)] };
  }

  function detectivePool(q, allQuestions) {
    var pool = [];
    allQuestions.forEach(function (other) {
      if (other.strand === q.strand) return;
      other.options.forEach(function (o) { if (o.misconception) pool.push(o.misconception); });
    });
    return pool;
  }

  // --- votes -------------------------------------------------------------------
  function cleanCounts(raw) {
    var counts = (raw || []).map(function (x) {
      var s = String(x === undefined || x === null ? "" : x).trim();
      if (s === "") return 0;
      if (!/^\d+$/.test(s)) fail("Counts must be whole numbers.");
      return parseInt(s, 10);
    });
    if (counts.length !== 4 || counts.some(function (c) { return c < 0 || c > MAX_COUNT; })) fail("Counts must be between 0 and " + MAX_COUNT + ".");
    if (!counts.reduce(function (a, b) { return a + b; }, 0)) fail("Enter at least one vote.");
    return counts;
  }

  function countsFromAnswers(answers) {
    return LETTERS.map(function (l) { return answers.filter(function (a) { return a === l; }).length; });
  }

  function percentCorrect(counts, correct) {
    var total = (counts || []).reduce(function (a, b) { return a + b; }, 0);
    return total ? Math.round(100 * counts[LETTERS.indexOf(correct)] / total) : 0;
  }

  function decide(pct) {
    if (pct > SKIP_ABOVE) return "reveal";
    if (pct >= RETEACH_BELOW) return "argue";
    return "reteach";
  }

  function cleanAnswers(state, answers) {
    answers = answers || [];
    if (answers.length !== state.teams.length || answers.some(function (a) { return LETTERS.indexOf(a) < 0; })) {
      fail("Every team needs an answer A, B, C or D.");
    }
    return answers.slice();
  }

  function submitVote1(state, correct, input) {
    if (state.phase !== "vote1") fail("Not taking Vote 1 right now.");
    if (state.style === "team") {
      var answers = cleanAnswers(state, input.answers);
      var bets = (input.bets || []).map(function (b) { return parseInt(b, 10); });
      if (bets.length !== state.teams.length || bets.some(function (b) { return BETS.indexOf(b) < 0; })) {
        fail("Every team needs a bet of 1, 2 or 3.");
      }
      state.a1 = answers; state.bets = bets; state.c1 = countsFromAnswers(answers);
    } else {
      state.c1 = cleanCounts(input.counts);
    }
    state.decision = decide(percentCorrect(state.c1, correct));
    state.phase = "chart";
  }

  function startArgue(state) {
    if (state.phase !== "chart") fail("The Argue phase comes after Vote 1.");
    state.phase = "argue";
  }

  function toVote2(state) {
    if (state.phase !== "argue") fail("Vote 2 comes after the Argue phase.");
    state.phase = "vote2";
  }

  /* Teams may change answer; bets stay locked. */
  function submitVote2(state, correct, input) {
    if (state.phase !== "vote2") fail("Not taking Vote 2 right now.");
    if (state.style === "team") {
      state.a2 = cleanAnswers(state, input.answers);
      state.c2 = countsFromAnswers(state.a2);
    } else {
      state.c2 = cleanCounts(input.counts);
    }
    finishRound(state, correct);
  }

  /* Skip the Argue phase and Vote 2 (e.g. over 70% already correct). */
  function revealNow(state, correct) {
    if (state.phase !== "chart") fail("Nothing to reveal yet.");
    finishRound(state, correct);
  }

  /* New score for one team. right2 is null when there was no Vote 2.
     Right both times: + bet. Wrong then right (convinced): + 1.
     Right then wrong (talked out of it): - bet. Wrong both times: - bet. Never below 0. */
  function teamRoundScore(score, bet, right1, right2) {
    if (right2 === null || right2 === undefined) right2 = right1;
    if (right1 && right2) return score + bet;
    if (right2) return score + 1;
    return Math.max(0, score - bet);
  }

  function finishRound(state, correct) {
    if (state.style === "team") {
      var second = state.a2 && state.a2.length ? state.a2 : null;
      state.deltas = state.teams.map(function (team, i) {
        var right1 = state.a1[i] === correct;
        var right2 = second ? second[i] === correct : null;
        var after = teamRoundScore(team.score, state.bets[i], right1, right2);
        var delta = after - team.score;
        team.score = after;
        return delta;
      });
    }
    state.history.push([state.qids[state.index], state.roundType, correct, state.c1, state.c2]);
    state.phase = "reveal";
  }

  /* +1 to one team per question; choosing again moves (or removes) the point. */
  function awardBestArgument(state, teamIndex) {
    if (state.style !== "team" || state.phase !== "reveal") fail("Best argument is awarded after the reveal in team mode.");
    if (state.best !== null && state.best !== undefined) {
      var old = state.teams[state.best];
      old.score = Math.max(0, old.score - 1);
      state.deltas[state.best] -= 1;
    }
    if (teamIndex === null || teamIndex === undefined || teamIndex === state.best) { state.best = null; return; }
    if (!(teamIndex >= 0 && teamIndex < state.teams.length)) fail("Unknown team.");
    state.teams[teamIndex].score += 1;
    state.deltas[teamIndex] += 1;
    state.best = teamIndex;
  }

  function finishMakeItRight(state) {
    if (state.phase !== "question" || state.roundType !== "make") fail("Not a Make-it-right round.");
    state.phase = "reveal";
  }

  /* Reveal -> next question. Returns false when the game is over. */
  function advance(state, hasWorkedAt) {
    if (state.phase !== "reveal") fail("Finish this round first.");
    if (isLastQuestion(state)) { state.phase = "over"; return false; }
    state.index += 1;
    startRound(state, hasWorkedAt ? hasWorkedAt(state.index) : true);
    return true;
  }

  // --- end of game -------------------------------------------------------------
  /* Questions with the biggest Vote 1 -> Vote 2 rise in % correct. */
  function learned(state, limit) {
    var rows = [];
    (state.history || []).forEach(function (h) {
      var c1 = h[3], c2 = h[4];
      if (!c1 || !c2) return;
      var before = percentCorrect(c1, h[2]), after = percentCorrect(c2, h[2]);
      if (after > before) rows.push({ qid: h[0], roundType: h[1], before: before, after: after, gain: after - before });
    });
    rows.sort(function (a, b) { return b.gain - a.gain; });
    return rows.slice(0, limit || 5);
  }

  /* Misconceptions still chosen in the final vote of Standard rounds, with counts. */
  function stillToReteach(state, questionsById) {
    var totals = {};
    (state.history || []).forEach(function (h) {
      var q = questionsById[h[0]], final = h[4] || h[3];
      if (h[1] !== "standard" || !q || !final) return;
      LETTERS.forEach(function (letter, i) {
        if (letter === h[2] || !final[i]) return;
        var o = option(q, letter);
        var e = totals[o.misconception] || (totals[o.misconception] = { label: o.misconception, count: 0, questions: [], explanation: o.explanation });
        e.count += final[i];
        if (e.questions.indexOf(h[0]) < 0) e.questions.push(h[0]);
      });
    });
    return Object.keys(totals).map(function (k) { return totals[k]; })
      .sort(function (a, b) { return b.count - a.count || (a.label < b.label ? -1 : 1); });
  }

  /* [{question_id, counts, vote2}] for Standard rounds. */
  function talliesToSave(state) {
    return (state.history || []).filter(function (h) { return h[1] === "standard" && h[3]; })
      .map(function (h) { return { question_id: h[0], counts: h[3], vote2: h[4] || null }; });
  }

  return {
    LETTERS: LETTERS, ROUND_TYPES: ROUND_TYPES, MIXES: MIXES, STYLES: STYLES, BETS: BETS,
    SKIP_ABOVE: SKIP_ABOVE, RETEACH_BELOW: RETEACH_BELOW, MIN_TEAMS: MIN_TEAMS, MAX_TEAMS: MAX_TEAMS,
    GameError: GameError,
    option: option, wrongLetters: wrongLetters, hasWorkedAnswer: hasWorkedAnswer,
    cleanTeamNames: cleanTeamNames, newGame: newGame, roundTypeFor: roundTypeFor, startRound: startRound,
    setRoundType: setRoundType, isLastQuestion: isLastQuestion, featuredWrongLetter: featuredWrongLetter,
    detectiveOptions: detectiveOptions, detectivePool: detectivePool,
    cleanCounts: cleanCounts, countsFromAnswers: countsFromAnswers, percentCorrect: percentCorrect, decide: decide,
    submitVote1: submitVote1, startArgue: startArgue, toVote2: toVote2, submitVote2: submitVote2, revealNow: revealNow,
    teamRoundScore: teamRoundScore, awardBestArgument: awardBestArgument, finishMakeItRight: finishMakeItRight,
    advance: advance, learned: learned, stillToReteach: stillToReteach, talliesToSave: talliesToSave,
  };
});
