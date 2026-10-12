# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

KS3 and GCSE/KS4 (England) maths diagnostic multiple-choice questions for whole-class projector use. Django 5.1 + SQLite, plain browser JS (no bundler, no npm). README.md is the user-facing manual (present keys, game rules, YAML format) — read it before changing behaviour it documents, and keep it in sync.

## Commands

Python 3.12+, venv in `.venv/` (`source .venv/bin/activate`).

```bash
python manage.py migrate
python manage.py load_questions              # validate all content/*.yaml, then load into the DB
python manage.py load_questions --check      # validate only
python manage.py runserver

python manage.py test                                         # all Django tests (also runs the Node engine tests if `node` is on PATH)
python manage.py test questions.tests.test_loader             # one module
python manage.py test questions.tests.test_loader.ValidFileTests.test_valid_file_loads   # one test
node --test tests/js/engine.test.js                           # game engine tests only (Node built-in runner)

python manage.py build_static --out ~/Desktop/ks3-maths       # portable file:// export (run load_questions first)
node tests/e2e/usb_check.mjs ~/Desktop/ks3-maths --browser chrome   # offline browser smoke test of an export (Node 22+, no npm)
```

Settings are env vars prefixed `DQ_` (see `config/settings.py` and the README table). `DQ_DEBUG=false` switches on the production path: WhiteNoise middleware, HTTPS-only cookies, SSL redirect behind a proxy.

**Deployment:** Railway, configured by `railway.json` (start command runs `migrate`, `load_questions`, `collectstatic`, then gunicorn). SQLite lives on a Railway volume via `DQ_DB_PATH=/data/db.sqlite3`; `RAILWAY_PUBLIC_DOMAIN` is added to `ALLOWED_HOSTS`/`CSRF_TRUSTED_ORIGINS` automatically. Steps are in the README.

## Architecture

**Content flow: YAML → DB → `questions.js` → browser.**
- `content/<slug>.yaml` (one topic per file; filename = topic slug) is the source of truth. `questions/loader.py` validates *every* file before writing anything (all-or-nothing) and prunes DB questions no longer in YAML (`--keep-missing` to keep). Admin edits to YAML-loaded questions are overwritten on the next load.
- `questions/models.py`: `Topic` (with `key_stage` KS3/KS4 and, for KS4, GCSE `tier` foundation/higher; `group_topics()` groups topics by key stage then strand for every page, Django and USB), `Question` (options/misconceptions stored as flat `option_a..d`, `misconception_a..d`, `explanation_a..d` columns; `Question.options()` assembles them), `QuizSet`, `Tally`. `STRANDS` fixes strand order.
- `questions/export.py` turns the DB into a JS file defining `window.QUESTIONS`, `TOPICS`, `STRANDS` (and `DEFAULT_SETS` for the export). It is a script, not JSON, because `fetch()` is blocked over `file://`. Django serves it at `/data/questions.js`; `build_static` writes the same output into the export.

**Two runtimes, one front end.** The same JS (`static/js/`) runs both under Django and from the USB export. Environment differences are isolated behind `window.DQ_ENV`:
- `env-server.js` — URLs are Django routes, quiz sets come from a JSON config in the page, tallies are POSTed to `/tally/save/`.
- `env-static.js` — relative `.html` URLs, quiz sets/tallies live in a downloadable/loadable JSON data file, localStorage only as an optional cache (all access in try/catch).
Page scripts (`present.js`, `game-ui.js`, `sets-app.js`, `print-sheet.js`, `common.js`) must only reach URLs/storage through `DQ_ENV`, never hard-code server paths, and must not make network requests (the e2e check fails on any non-`file:`/`data:`/`blob:` request).

`static/js/engine.js` is the pure game logic (Vote → Argue → Revote state machine, team scoring, round types); it is UMD-style so Node tests can `require` it. `game-ui.js` is the DOM layer on top.

**Templates.** `templates/questions/` are the Django pages; `templates/static_site/` are the export pages, rendered by `build_static`. They share partials from `templates/questions/` (`_present_body.html`, `_game_app.html`, `_option.html`, `_prefs.html`), so a change to a partial affects both runtimes. The export must use relative paths only; `build_static` refuses to write into a non-empty non-export folder (marker file `.ks3-maths-usb`) without `--force`.

Third-party assets (KaTeX, fonts) are vendored under `static/vendor/` — no CDNs.

## Constraints

- **Access:** reading, Present, Print and the game are public. Creating, editing and deleting quiz sets (`@login_required`) and `save_tally` (403 JSON when anonymous) need a teacher login (`/accounts/login/`, non-staff users made in the admin). Templates hide write actions from anonymous users. The USB export has no logins.
- **Privacy (see PRIVACY.md):** no student names or personal data anywhere. Sessions are signed cookies; game scores stay in the browser. A saved tally is only date, quiz set, question id and anonymous A/B/C/D counts. Teams use colour/animal names.
- **Question content rules** (enforced by the loader and tests): exactly one correct option; each of the three wrong options has a distinct misconception label + explanation; correct answers spread across A–D; optional `worked_answer` must end at a wrong option with 2–6 steps and show the error without naming it. In YAML, single-quote every option and any text containing `\`; `$...$` is KaTeX, so write money as `£`. Diagrams are SVGs in `static/diagrams/` and need `image_alt`.
