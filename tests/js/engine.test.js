// Game scoring and flow tests. Run with: node --test tests/js/
// Uses only Node's built-in test runner; no npm packages needed.
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const G = require("../../static/js/engine.js");

function question(id = "q1", correct = "B", strand = "Number", worked = true) {
  return {
    id, strand, correct,
    options: ["A", "B", "C", "D"].map((l, i) => ({
      letter: l, text: String(i + 1), correct: l === correct,
      misconception: l === correct ? "" : `Mistake ${id} ${l}`, explanation: l === correct ? "" : `Why ${l}`,
    })),
    worked_option: worked ? G.wrongLetters({ correct })[0] : "",
    worked_steps: worked ? ["step one", "step two"] : [],
  };
}

function teamGame(teams = ["Red", "Blue"], qids = ["q1", "q2"], mix = "standard") {
  const s = G.newGame({ style: "team", qids, teamNames: teams, mix });
  G.startRound(s, true);
  s.phase = "vote1";
  return s;
}

function classGame(qids = ["q1", "q2"]) {
  const s = G.newGame({ style: "class", qids });
  G.startRound(s, true);
  s.phase = "vote1";
  return s;
}

test("team scoring rules", () => {
  assert.equal(G.teamRoundScore(4, 3, true, true), 7);   // right both times: + bet
  assert.equal(G.teamRoundScore(4, 3, false, true), 5);  // convinced: + 1
  assert.equal(G.teamRoundScore(4, 3, true, false), 1);  // talked out of it: - bet
  assert.equal(G.teamRoundScore(4, 2, false, false), 2); // wrong both times: - bet
});

test("score never drops below zero", () => {
  assert.equal(G.teamRoundScore(1, 3, false, false), 0);
  assert.equal(G.teamRoundScore(0, 3, true, false), 0);
});

test("no Vote 2 scores on Vote 1", () => {
  assert.equal(G.teamRoundScore(0, 2, true, null), 2);
  assert.equal(G.teamRoundScore(5, 2, false, null), 3);
});

test("full team round with revote; bets stay locked", () => {
  const s = teamGame(["Red", "Blue", "Green", "Yellow"]);
  s.teams.forEach((t) => (t.score = 5));
  G.submitVote1(s, "B", { answers: ["B", "A", "B", "C"], bets: ["2", "3", "1", "2"] });
  assert.deepEqual(s.c1, [1, 2, 1, 0]);
  assert.equal(s.decision, "argue"); // 50% correct
  G.startArgue(s);
  G.toVote2(s);
  G.submitVote2(s, "B", { answers: ["B", "B", "A", "C"] });
  assert.deepEqual(s.teams.map((t) => t.score), [7, 6, 4, 3]);
  assert.deepEqual(s.deltas, [2, 1, -1, -2]);
  assert.deepEqual(s.bets, [2, 3, 1, 2]);
  assert.equal(s.phase, "reveal");
});

test("bets must be 1 to 3", () => {
  for (const bad of [["0", "1"], ["4", "1"], ["x", "1"], ["1"]]) {
    assert.throws(() => G.submitVote1(teamGame(), "B", { answers: ["A", "B"], bets: bad }), G.GameError);
  }
});

test("best argument: one team per question, can move or be removed", () => {
  const s = teamGame();
  G.submitVote1(s, "B", { answers: ["A", "A"], bets: [3, 3] });
  G.revealNow(s, "B");
  G.awardBestArgument(s, 0);
  assert.deepEqual(s.teams.map((t) => t.score), [1, 0]);
  G.awardBestArgument(s, 1);
  assert.deepEqual(s.teams.map((t) => t.score), [0, 1]);
  G.awardBestArgument(s, 1);
  assert.deepEqual(s.teams.map((t) => t.score), [0, 0]);
  assert.equal(s.best, null);
});

test("team names", () => {
  assert.throws(() => G.newGame({ style: "team", qids: ["q"], teamNames: ["Red"] }), G.GameError);
  assert.throws(() => G.newGame({ style: "team", qids: ["q"], teamNames: ["Red", "red"] }), G.GameError);
  assert.throws(() => G.newGame({ style: "team", qids: ["q"], teamNames: ["1", "2", "3", "4", "5", "6", "7"] }), G.GameError);
  assert.deepEqual(G.newGame({ style: "team", qids: ["q"], teamNames: ["Red", "", " ", "Blue"] }).teams.length, 2);
  assert.deepEqual(G.newGame({ style: "class", qids: ["q"], teamNames: ["x"] }).teams, []);
});

test("thresholds after Vote 1", () => {
  assert.equal(G.decide(71), "reveal");
  assert.equal(G.decide(70), "argue");
  assert.equal(G.decide(30), "argue");
  assert.equal(G.decide(29), "reteach");
});

test("class mode: over 70% skips to reveal, history recorded", () => {
  const s = classGame();
  G.submitVote1(s, "A", { counts: ["24", "2", "1", "3"] });
  assert.equal(s.decision, "reveal");
  G.revealNow(s, "A");
  assert.deepEqual(s.history, [["q1", "standard", "A", [24, 2, 1, 3], null]]);
});

test("class mode: under 30% prompts re-teach", () => {
  const s = classGame();
  G.submitVote1(s, "A", { counts: [5, 20, 3, 2] });
  assert.equal(s.decision, "reteach");
});

test("count validation", () => {
  for (const bad of [["-1", "0", "0", "0"], ["a", "0", "0", "0"], ["0", "0", "0", "0"], ["1000", "0", "0", "0"], ["", "", "", ""]]) {
    assert.throws(() => G.submitVote1(classGame(), "A", { counts: bad }), G.GameError);
  }
});

test("learned, still to reteach and tallies to save", () => {
  const q = question("q1", "A");
  const s = classGame();
  G.submitVote1(s, "A", { counts: [10, 12, 6, 2] });
  G.startArgue(s);
  G.toVote2(s);
  G.submitVote2(s, "A", { counts: [24, 4, 0, 2] });
  const l = G.learned(s);
  assert.equal(l[0].before, 33);
  assert.equal(l[0].after, 80);
  assert.deepEqual(G.stillToReteach(s, { q1: q }).map((r) => [r.label, r.count]), [["Mistake q1 B", 4], ["Mistake q1 D", 2]]);
  assert.deepEqual(G.talliesToSave(s), [{ question_id: "q1", counts: [10, 12, 6, 2], vote2: [24, 4, 0, 2] }]);
});

test("mixed mode rotates; detective falls back without a worked answer", () => {
  assert.deepEqual([0, 1, 2, 3].map((i) => G.roundTypeFor("mixed", i, true)), ["standard", "detective", "make", "standard"]);
  assert.equal(G.roundTypeFor("detective", 0, false), "standard");
});

test("detective options: right label, distinct, stable, pool from other strands", () => {
  const q = question("q1", "B", "Number");
  const other = question("x1", "A", "Algebra");
  const same = question("y1", "A", "Number");
  const pool = G.detectivePool(q, [q, other, same]);
  assert.ok(pool.every((l) => l.startsWith("Mistake x1")));
  const r = G.detectiveOptions(q, pool);
  assert.equal(r.options[r.correct], G.option(q, q.worked_option).misconception);
  assert.equal(new Set(Object.values(r.options)).size, 4);
  assert.deepEqual(G.detectiveOptions(q, pool), r);
});

test("make it right has no votes or scores", () => {
  const s = G.newGame({ style: "team", qids: ["q1", "q2"], teamNames: ["Red", "Blue"], mix: "make" });
  G.startRound(s, true);
  G.finishMakeItRight(s);
  assert.equal(s.phase, "reveal");
  assert.deepEqual(s.history, []);
  assert.equal(G.advance(s), true);
  assert.deepEqual(s.teams.map((t) => t.score), [0, 0]);
});

test("game ends after the last question", () => {
  const s = G.newGame({ style: "class", qids: ["q1"] });
  G.startRound(s, true);
  s.phase = "reveal";
  assert.equal(G.advance(s), false);
  assert.equal(s.phase, "over");
});
