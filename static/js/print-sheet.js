/* Print view for the USB copy: builds the A4 worksheet and answer key in the browser.
   Address: print.html?kind=topic&key=<slug>[&year=7] or print.html?kind=set&key=<id>. */
(function () {
  "use strict";
  function esc(t) { return String(t || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }
  var p = new URLSearchParams(location.search), kind = p.get("kind"), key = p.get("key"), year = parseInt(p.get("year"), 10) || null;
  var byId = {}, list = [], title = "Worksheet";
  window.QUESTIONS.forEach(function (q) { byId[q.id] = q; });
  if (kind === "topic") {
    var topic = window.TOPICS.filter(function (t) { return t.slug === key; })[0];
    list = window.QUESTIONS.filter(function (q) { return q.topic === key && (!year || q.year_group === year); });
    title = topic ? topic.name + (year ? " (Year " + year + ")" : "") : "Topic";
  } else if (kind === "set") {
    var set = DQStore.getSet(key);
    list = set ? set.question_ids.map(function (id) { return byId[id]; }).filter(Boolean) : [];
    title = set ? set.name : "Quiz set not found: load your data file";
  }
  document.title = title + " · Worksheet";

  var html = '<header class="sheet-head"><h1>' + esc(title) + '</h1><p>Name/number: ____________ &nbsp; Date: ________</p>' +
    '<p class="hint">Circle one answer for each question.</p></header><ol class="sheet-questions">';
  list.forEach(function (q) {
    html += '<li><p class="math">' + esc(q.stem) + "</p>" +
      (q.image ? '<img class="q-img" src="static/' + esc(q.image) + '" alt="' + esc(q.image_alt) + '">' : "") +
      '<ul class="sheet-options">' + q.options.map(function (o) {
        return "<li><b>" + o.letter + '</b> <span class="math">' + esc(o.text) + "</span></li>";
      }).join("") + "</ul></li>";
  });
  html += '</ol><section class="answer-key"><h2>Answer key and misconceptions — ' + esc(title) + "</h2><table><thead><tr><th>Q</th><th>Answer</th>" +
    "<th>Wrong answers: the misconception behind each</th></tr></thead><tbody>";
  list.forEach(function (q, i) {
    html += "<tr><td>" + (i + 1) + "<br><small>" + esc(q.id) + "</small></td><td><b>" + q.correct + "</b></td><td><ul>" +
      q.options.filter(function (o) { return !o.correct; }).map(function (o) {
        return "<li><b>" + o.letter + "</b> (" + esc(o.misconception) + '): <span class="math">' + esc(o.explanation) + "</span></li>";
      }).join("") + "</ul></td></tr>";
  });
  html += "</tbody></table></section>";
  document.getElementById("sheet").innerHTML = html;
})();
