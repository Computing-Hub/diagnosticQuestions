/* DQ_ENV for the Django site: quiz sets come from the database, tallies are POSTed. */
(function () {
  "use strict";
  var el = document.getElementById("dq-env");
  var cfg = el ? JSON.parse(el.textContent) : {};
  function csrf() { return (document.cookie.match(/csrftoken=([^;]+)/) || [])[1] || ""; }

  window.DQ_ENV = {
    mode: "server",
    staticUrl: cfg.staticUrl || "/static/",
    urls: {
      home: function () { return "/"; },
      topic: function (slug) { return "/topic/" + encodeURIComponent(slug) + "/"; },
      present: function (kind, key, extra) { return "/present/" + kind + "/" + encodeURIComponent(key) + "/" + (extra || ""); },
      print: function (kind, key, extra) { return "/print/" + kind + "/" + encodeURIComponent(key) + "/" + (extra || ""); },
      sets: function () { return "/sets/"; },
      game: function (kind, key) { return "/game/" + (kind ? "?kind=" + kind + "&key=" + encodeURIComponent(key) : ""); },
    },
    getSets: function () { return cfg.sets || []; },
    /* records: [{question_id, counts: [4], vote2: [4] | null}] */
    saveTallies: function (records, setId) {
      return fetch(cfg.saveUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-CSRFToken": csrf() },
        credentials: "same-origin",
        body: JSON.stringify({ quiz_set: setId || null, tallies: records }),
      }).then(function (r) {
        if (r.status === 403) throw new Error("Log in to save tallies.");
        if (!r.ok) throw new Error("Could not save.");
        return "Saved (anonymous counts only).";
      });
    },
  };
})();
