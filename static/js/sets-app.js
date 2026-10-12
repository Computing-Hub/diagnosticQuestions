/* Quiz sets for the USB copy: list, build, edit and delete. Stored through DQStore
   (a downloadable JSON data file, with localStorage only as a cache). */
(function () {
  "use strict";
  var app = document.getElementById("sets-app");
  var byId = {};
  window.QUESTIONS.forEach(function (q) { byId[q.id] = q; });
  function esc(t) { return String(t || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }
  function link(href, label, cls) { return '<a class="btn ' + (cls || "btn-small") + '" href="' + esc(href) + '">' + label + "</a>"; }
  var notice = "", confirming = null;

  function renderList() {
    var sets = DQStore.sets(), focus = decodeURIComponent(location.hash.slice(1));
    app.innerHTML = "<h1>Quiz sets</h1>" + (notice ? '<p class="msg msg-success" role="status">' + esc(notice) + "</p>" : "") +
      '<p><button type="button" class="btn btn-primary" data-new>+ New quiz set</button></p>' +
      '<p class="hint">Sets are kept in your data file. After making changes, click <b>Download data</b> and keep the file on the USB stick.</p>' +
      '<ul class="set-list">' + (sets.length ? sets.map(function (s) {
        var key = encodeURIComponent(s.id);
        var missing = s.question_ids.filter(function (id) { return !byId[id]; }).length;
        return '<li id="set-' + esc(s.id) + '"' + (focus === s.id ? ' class="is-focus"' : "") + '><span class="set-name">' + esc(s.name) + "</span>" +
          '<span class="hint">' + s.question_ids.length + " questions" + (s.created ? " · " + esc(s.created) : "") +
          (missing ? " · " + missing + " no longer in the bank" : "") + '</span><span class="actions">' +
          link("present.html?kind=set&key=" + key, "Present") + link("print.html?kind=set&key=" + key, "Print") +
          link("game.html?kind=set&key=" + key, "Play") +
          '<button type="button" class="btn btn-small" data-edit="' + esc(s.id) + '">Edit</button>' +
          '<button type="button" class="btn btn-small btn-danger" data-delete="' + esc(s.id) + '">' +
          (confirming === s.id ? "Click again to delete" : "Delete") + "</button></span></li>";
      }).join("") : "<li>No quiz sets yet. Make one, or use <b>Load data</b> to open a file you saved before.</li>") + "</ul>";
    notice = "";
  }

  function renderEdit(set) {
    var selected = {};
    (set ? set.question_ids : []).forEach(function (id) { selected[id] = true; });
    var groups = window.STRANDS.map(function (strand) {
      var topics = window.TOPICS.filter(function (t) { return t.strand === strand; });
      if (!topics.length) return "";
      return "<h2>" + esc(strand) + "</h2>" + topics.map(function (t) {
        var qs = window.QUESTIONS.filter(function (q) { return q.topic === t.slug; });
        var open = qs.some(function (q) { return selected[q.id]; });
        return '<details class="builder-topic"' + (open ? " open" : "") + "><summary>" + esc(t.name) + ' <span class="hint">(' + qs.length + ")</span></summary><ul>" +
          qs.map(function (q) {
            return '<li data-year="' + q.year_group + '"><label><input type="checkbox" name="q" value="' + esc(q.id) + '"' + (selected[q.id] ? " checked" : "") + "> " +
              '<span class="tag">Y' + q.year_group + '</span> <span class="math">' + esc(q.stem) + "</span></label></li>";
          }).join("") + "</ul></details>";
      }).join("");
    }).join("");
    app.innerHTML = "<h1>" + (set ? "Edit “" + esc(set.name) + "”" : "New quiz set") + "</h1>" +
      '<form class="builder" data-builder><p class="msg msg-error" role="alert" data-error hidden></p><div class="builder-head">' +
      '<label>Set name <input type="text" name="name" value="' + esc(set ? set.name : "") + '" maxlength="120" required placeholder="e.g. Y8 starter wk 6"></label>' +
      '<fieldset class="filter" aria-label="Show year groups"><legend>Show</legend>' + [7, 8, 9].map(function (y) {
        return '<label><input type="checkbox" data-year-filter value="' + y + '" checked> Y' + y + "</label>";
      }).join("") + "</fieldset>" +
      '<p><strong data-count>0</strong> ticked</p><button class="btn btn-primary" type="submit">Save set</button>' +
      '<button class="btn" type="button" data-cancel>Cancel</button></div>' + groups + "</form>";
    var form = app.querySelector("[data-builder]");
    function update() {
      form.querySelector("[data-count]").textContent = form.querySelectorAll("input[name=q]:checked").length;
      var years = Array.prototype.map.call(form.querySelectorAll("[data-year-filter]:checked"), function (c) { return c.value; });
      form.querySelectorAll("li[data-year]").forEach(function (li) { li.hidden = years.indexOf(li.dataset.year) < 0; });
    }
    form.addEventListener("change", update);
    form.querySelector("[data-cancel]").addEventListener("click", function () { history.replaceState(null, "", "sets.html"); renderList(); });
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var name = form.name.value.trim().slice(0, 120);
      var ids = Array.prototype.map.call(form.querySelectorAll("input[name=q]:checked"), function (c) { return c.value; });
      var err = form.querySelector("[data-error]");
      if (!name || !ids.length) { err.textContent = !name ? "Give the set a name." : "Tick at least one question."; err.hidden = false; return; }
      var saved = DQStore.saveSet({ id: set ? set.id : null, name: name, question_ids: ids, created: set ? set.created : null });
      notice = "Saved “" + saved.name + "” with " + ids.length + " questions. Click Download data to keep it in your file.";
      history.replaceState(null, "", "sets.html");
      renderList();
    });
    update();
    DQ.renderMath(app);
  }

  app.addEventListener("click", function (e) {
    var t = e.target;
    if (t.matches("[data-new]")) renderEdit(null);
    else if (t.matches("[data-edit]")) renderEdit(DQStore.getSet(t.dataset.edit));
    else if (t.matches("[data-delete]")) {
      var id = t.dataset.delete;
      if (confirming === id) { var s = DQStore.getSet(id); DQStore.deleteSet(id); confirming = null; notice = "Deleted “" + (s ? s.name : "") + "”."; }
      else confirming = id;
      renderList();
    }
  });
  document.addEventListener("dq-data-loaded", renderList);

  var params = new URLSearchParams(location.search);
  if (params.get("new")) renderEdit(null); else renderList();
})();
