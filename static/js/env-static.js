/* DQ_ENV for the portable USB copy (file://, no server).
 *
 * Quiz sets and saved tallies live in a JSON file the teacher downloads and loads again.
 * localStorage is only a convenience cache: it may be empty, blocked or cleared, so every
 * access is wrapped in try/catch and the pages never depend on it.
 */
(function () {
  "use strict";
  var CACHE_KEY = "dq-usb-data";
  var FORMAT = "ks3-diagnostic-questions";
  var memory = null;

  function blank() {
    return { format: FORMAT, version: 1, quiz_sets: (window.DEFAULT_SETS || []).slice(), tallies: [], dirty: false };
  }
  function cacheRead() {
    try { var raw = localStorage.getItem(CACHE_KEY); return raw ? JSON.parse(raw) : null; } catch (e) { return null; }
  }
  function cacheWrite(data) {
    try { localStorage.setItem(CACHE_KEY, JSON.stringify(data)); } catch (e) { /* cache is optional */ }
  }
  function data() {
    if (!memory) {
      var cached = cacheRead();
      memory = cached && cached.format === FORMAT ? clean(cached) : blank();
    }
    return memory;
  }
  function changed() {
    memory.dirty = true;
    cacheWrite(memory);
    DQStore.refreshStatus();
  }

  // Keep only the fields we expect, so a loaded file can never inject anything else.
  function clean(raw) {
    var out = blank();
    out.quiz_sets = (Array.isArray(raw.quiz_sets) ? raw.quiz_sets : []).filter(function (s) {
      return s && typeof s.id === "string" && typeof s.name === "string" && Array.isArray(s.question_ids);
    }).map(function (s) {
      return { id: s.id.slice(0, 40), name: s.name.slice(0, 120),
               question_ids: s.question_ids.filter(function (q) { return typeof q === "string"; }).slice(0, 500),
               created: typeof s.created === "string" ? s.created.slice(0, 10) : "" };
    });
    function counts(c) {
      return Array.isArray(c) && c.length === 4 && c.every(function (n) { return Number.isInteger(n) && n >= 0 && n <= 999; }) ? c : null;
    }
    out.tallies = (Array.isArray(raw.tallies) ? raw.tallies : []).filter(function (t) {
      return t && typeof t.question_id === "string" && counts(t.counts);
    }).map(function (t) {
      return { date: String(t.date || "").slice(0, 10), quiz_set: typeof t.quiz_set === "string" ? t.quiz_set : null,
               question_id: t.question_id.slice(0, 40), counts: t.counts, vote2: counts(t.vote2) };
    });
    out.dirty = !!raw.dirty;
    return out;
  }

  function today() { return new Date().toISOString().slice(0, 10); }

  var DQStore = (window.DQStore = {
    sets: function () { return data().quiz_sets; },
    tallies: function () { return data().tallies; },
    getSet: function (id) { return data().quiz_sets.filter(function (s) { return s.id === id; })[0] || null; },
    saveSet: function (set) {
      var d = data();
      if (!set.id) set.id = "s-" + Date.now().toString(36);
      if (!set.created) set.created = today();
      d.quiz_sets = d.quiz_sets.filter(function (s) { return s.id !== set.id; });
      d.quiz_sets.unshift(set);
      changed();
      return set;
    },
    deleteSet: function (id) {
      var d = data();
      d.quiz_sets = d.quiz_sets.filter(function (s) { return s.id !== id; });
      changed();
    },
    addTallies: function (records, setId) {
      var d = data();
      records.forEach(function (r) {
        d.tallies.push({ date: today(), quiz_set: setId || null, question_id: r.question_id, counts: r.counts, vote2: r.vote2 || null });
      });
      changed();
    },
    isDirty: function () { return !!data().dirty; },

    /* Download everything as a JSON file the teacher keeps on the USB stick. */
    download: function () {
      var d = data();
      var file = { format: FORMAT, version: 1, exported: today(), quiz_sets: d.quiz_sets, tallies: d.tallies };
      var blob = new Blob([JSON.stringify(file, null, 2)], { type: "application/json" });
      var a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = "ks3-maths-data-" + today() + ".json";
      document.body.appendChild(a);
      a.click();
      setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
      d.dirty = false;
      cacheWrite(d);
      DQStore.refreshStatus();
    },

    /* Load a previously downloaded file; merges sets (by id) and tallies. Returns a Promise. */
    load: function (file) {
      return new Promise(function (resolve, reject) {
        var reader = new FileReader();
        reader.onerror = function () { reject(new Error("Could not read the file.")); };
        reader.onload = function () {
          var raw;
          try { raw = JSON.parse(reader.result); } catch (e) { reject(new Error("That is not a data file from this site.")); return; }
          if (!raw || raw.format !== FORMAT) { reject(new Error("That is not a data file from this site.")); return; }
          var incoming = clean(raw), d = data();
          var ids = {};
          incoming.quiz_sets.forEach(function (s) { ids[s.id] = true; });
          d.quiz_sets = incoming.quiz_sets.concat(d.quiz_sets.filter(function (s) { return !ids[s.id]; }));
          var seen = {};
          d.tallies = d.tallies.concat(incoming.tallies).filter(function (t) {
            var k = JSON.stringify([t.date, t.quiz_set, t.question_id, t.counts, t.vote2]);
            if (seen[k]) return false;
            seen[k] = true;
            return true;
          });
          d.dirty = false;
          cacheWrite(d);
          DQStore.refreshStatus();
          resolve("Loaded " + incoming.quiz_sets.length + " quiz set(s) and " + incoming.tallies.length + " tally record(s).");
        };
        reader.readAsText(file);
      });
    },

    /* Show "not saved to a file yet" wherever a [data-store-status] element exists. */
    refreshStatus: function () {
      document.querySelectorAll("[data-store-status]").forEach(function (el) {
        el.hidden = !DQStore.isDirty();
      });
    },
  });

  function qs(params) {
    return Object.keys(params).filter(function (k) { return params[k] !== undefined && params[k] !== null && params[k] !== ""; })
      .map(function (k) { return encodeURIComponent(k) + "=" + encodeURIComponent(params[k]); }).join("&");
  }

  window.DQ_ENV = {
    mode: "static",
    staticUrl: "static/",
    urls: {
      home: function () { return "index.html"; },
      topic: function (slug) { return "topic-" + slug + ".html"; },
      present: function (kind, key, extra) { return "present.html?" + qs({ kind: kind, key: key }) + (extra ? "&" + extra.replace(/^\?/, "") : ""); },
      print: function (kind, key, extra) { return "print.html?" + qs({ kind: kind, key: key }) + (extra ? "&" + extra.replace(/^\?/, "") : ""); },
      sets: function () { return "sets.html"; },
      game: function (kind, key) { return "game.html" + (kind ? "?" + qs({ kind: kind, key: key }) : ""); },
    },
    getSets: function () { return DQStore.sets(); },
    saveTallies: function (records, setId) {
      DQStore.addTallies(records, setId);
      return Promise.resolve("Saved. Use “Download data” to keep it in a file.");
    },
  };

  // Header buttons: Download data / Load data.
  document.addEventListener("DOMContentLoaded", function () {
    document.querySelectorAll("[data-download]").forEach(function (b) { b.addEventListener("click", DQStore.download); });
    document.querySelectorAll("[data-load]").forEach(function (input) {
      input.addEventListener("change", function () {
        if (!input.files.length) return;
        var status = document.querySelector("[data-load-status]");
        DQStore.load(input.files[0]).then(function (msg) {
          if (status) status.textContent = msg;
          document.dispatchEvent(new CustomEvent("dq-data-loaded"));
        }).catch(function (err) { if (status) status.textContent = err.message; });
        input.value = "";
      });
    });
    DQStore.refreshStatus();
  });
})();
