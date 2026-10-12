# KS3 Maths diagnostic questions

Original KS3 (England) maths diagnostic questions for whole-class use on a projector.
Students have no devices: they answer A/B/C/D with their hands or printed answer cards.

Each question has one correct answer and three wrong ones. Each wrong answer is designed
to catch one named misconception, and its explanation is shown to the teacher on request.

- **Present mode**: full-screen, keyboard-driven, readable from the back of the room.
  It includes an optional quick tally of A/B/C/D counts.
- **Print**: A4 worksheet per topic or quiz set, with the answer key and misconception notes on a separate page.
- **Quiz builder**: tick questions from any topic and save a named set. No login needed.
- **Game: Vote → Argue → Revote**: Peer Instruction for the whole class or 2–6 teams.
- **Portable USB copy**: the whole site as plain files that run from a USB stick with no server
  and no internet (see [below](#portable-usb-version)).

See [PRIVACY.md](PRIVACY.md): no personal data is stored.

## Setup

Requires Python 3.12+ (Django 5.1).

```bash
python3.12 -m venv .venv
source .venv/bin/activate            # Windows: .venv\Scripts\activate
pip install -r requirements.txt
python manage.py migrate
python manage.py load_questions      # loads content/*.yaml into the database
python manage.py createsuperuser     # optional: one admin login for editing content
python manage.py runserver
```

Open <http://127.0.0.1:8000/>.

### Driving it from a phone

To use a phone on the same network as the laptop:

```bash
DQ_ALLOWED_HOSTS="localhost,127.0.0.1,192.168.1.23" python manage.py runserver 0.0.0.0:8000
```

Replace `192.168.1.23` with the laptop's IP address, then open `http://192.168.1.23:8000/` on the phone.
Present and Game mode have large touch buttons as well as keyboard shortcuts.

### Settings (environment variables)

| Variable | Default | Purpose |
|---|---|---|
| `DQ_SECRET_KEY` | generated into `.secret_key` | Django secret key |
| `DQ_DEBUG` | `true` | Set `false` on a shared server |
| `DQ_ALLOWED_HOSTS` | `localhost,127.0.0.1,[::1]` | Comma-separated host names |
| `DQ_DB_PATH` | `db.sqlite3` | SQLite file |
| `DQ_CONTENT_DIR` | `content/` | Folder of YAML question files |
| `DQ_THINKING_SECONDS` | `30` | Default thinking time in Present mode |
| `DQ_GAME_THINKING_SECONDS` | `45` | Default thinking time in the game |
| `DQ_ARGUE_SECONDS` | `90` | Default Argue timer |
| `DQ_CSRF_TRUSTED_ORIGINS` | none | Comma-separated `https://…` origins, needed behind HTTPS on a custom domain |
| `DQ_SSL_REDIRECT` | `true` | With `DQ_DEBUG=false`, redirect plain HTTP to HTTPS |
| `DQ_HSTS_SECONDS` | `0` | With `DQ_DEBUG=false`, HSTS lifetime. Raise only once HTTPS is working on your final domain |

On Railway, `RAILWAY_PUBLIC_DOMAIN` is added to the allowed hosts and trusted origins automatically.

### Teacher logins

Presenting, printing, topic pages and the game are open to anyone with the link. Building, editing or
deleting quiz sets, and **Save tally**, need a teacher login ("Teacher log in" in the header).
Create logins in `/admin/` under **Users → Add user**. Leave *Staff status* off for teachers;
only people who edit the questions in the admin need it.

## Deploying to Railway (public website)

The repo includes `railway.json`. Each deploy runs `migrate`, `load_questions` (so the live site
always matches `content/*.yaml`), `collectstatic`, then gunicorn. Static files are served by WhiteNoise.
The database is SQLite on a Railway volume, so it must be on the volume or it is wiped on every deploy.

1. Push this repo to GitHub (a private repo is fine).
2. In Railway: **New Project → Deploy from GitHub repo**, and pick it.
3. On the service, **add a volume** with mount path `/data`.
4. Under **Variables**, set:
   - `DQ_DEBUG` = `false`
   - `DQ_SECRET_KEY` = a long random string (e.g. `python -c "import secrets; print(secrets.token_urlsafe(50))"`)
   - `DQ_DB_PATH` = `/data/db.sqlite3`
5. Under **Settings → Networking**, click **Generate Domain** (or add your own domain; for a custom
   domain also set `DQ_CSRF_TRUSTED_ORIGINS=https://your.domain`).
6. Once it's deployed, create the admin login from a shell on the service
   (`railway ssh`, or the service's shell in the dashboard):
   ```bash
   python manage.py createsuperuser
   ```
7. Log in at `/admin/` and add a user for each teacher.

To update questions, edit the YAML, commit and push: Railway redeploys and reloads the content.
Because content is reloaded on every deploy, edits made in the admin to YAML-loaded questions are lost
on the next deploy. Make lasting changes in the YAML.

## Using it

### Present mode keys

| Key | Action |
|---|---|
| → / ← (or Space, PgDn / PgUp) | Next / previous question |
| R | Reveal the correct answer |
| M | Show the misconception behind each wrong answer (teacher view; also reveals) |
| T | Start or stop thinking time (default 30 s; change it in the toolbar) |
| F | Full screen |
| Y | Quick tally panel: type the number of A/B/C/D answers to see a bar chart and the most common misconception |
| ? / Esc | Show / hide help |

Tallies stay in the browser unless you click **Save tally**. Saving stores only the date,
quiz set, question id and the four counts.

### Game: Vote → Argue → Revote

Based on Peer Instruction (Mazur): the learning is in the shift between the first and second vote.
Choose a quiz set or topic, then an input style:

- **Class mode**: no teams and no scores. Type the anonymous number of students choosing A/B/C/D
  (show of hands, answer cards, or Four Corners).
- **Team mode**: 2–6 teams with colour or animal names, never student names.
  Scores stay in the browser and are discarded at the end.

Each question runs like this:

1. **Think.** The question is shown with a fixed thinking time (default 45 s). There is no speed bonus.
2. **Vote 1.** Enter the class counts, or each team's answer and a 1–3 confidence bet.
3. **Vote 1 chart.** The chart is shown without revealing the answer. The app suggests the next step:
   - over 70% correct: reveal, because the class has it;
   - 30–70% correct: argue;
   - under 30% correct: a "Re-teach first" prompt with teacher notes (press M), then argue anyway.
   You can always choose the other option.
4. **Argue.** A 90 s timer runs with the prompt "Find someone (or a team) who chose differently and convince them."
   Use +30 s to extend, or go straight to Vote 2.
5. **Vote 2.** Same input as Vote 1. Teams may change their answer, but bets stay locked.
6. **Reveal.** The correct answer and the misconception behind each wrong answer are shown,
   with the Vote 1 and Vote 2 charts side by side (e.g. "Correct: 38% → 81%").

**Team scoring**

| Vote 1 | Vote 2 | Points |
|---|---|---|
| right | right | + bet |
| wrong | right | +1 (convinced) |
| right | wrong | − bet (talked out of it) |
| wrong | wrong | − bet |

You can also award +1 "Best argument" to one team per question. Scores never go below 0.
They are shown as simple team bars, not a ranked leaderboard.

**Round types** (choose one for the game, or Mixed; you can also switch a single round before Vote 1):

- **Standard**: answer the diagnostic question.
- **Misconception detectives**: a fictional student's worked answer containing one error is shown, and
  teams pick the misconception that caused it. The options are misconception labels: the question's own
  three, plus one from a different strand so no two options mean the same thing.
  It uses the same Vote → Argue → Revote flow.
- **Make it right**: a wrong answer is shown, and teams write a question where it would be correct.
  This is for discussion only and isn't scored.

**End screen**

- Team scores (team mode only).
- "What the class learned": the questions with the biggest rise from Vote 1 to Vote 2.
- "Still to reteach": the misconceptions still chosen in the final vote, with counts. You can print this list.
- Nothing is saved unless you click **Save tally**. That stores only the date, quiz set, question id and the
  anonymous A/B/C/D counts for both votes.

**Keys:** Space or → next step, V votes, A argue timer (or start Argue), R reveal, T timer,
M teacher notes / misconceptions, F full screen.

## Portable USB version

For classrooms with no server, or no network at all, export a self-contained copy of the site.
It includes Home, Topic pages, Present mode, the game, Print view and the quiz builder.

**1. Build**

```bash
python manage.py load_questions                         # make sure the database is up to date
python manage.py build_static --out ~/Desktop/ks3-maths
```

**2. Copy to the USB stick.** Copy the whole `ks3-maths` folder onto the stick.

**3. Open it.** On the classroom computer, open the folder and double-click `index.html`, or drag it
into Chrome or Edge. Everything runs from `file://` URLs:

- the question bank is a script file (`data/questions.js`, which sets `window.QUESTIONS`), because
  browsers block `fetch()` over `file://`;
- KaTeX, fonts, CSS, JS and diagrams are bundled under `static/` with relative paths.

**Your quiz sets and tallies live in a data file, not a database.**

- After you build a quiz set or save a tally, a reminder appears: click **Download data** and save the
  `.json` file on the USB stick.
- Next time, click **Load data** and choose that file. Loading merges it with anything already in the browser.
- The browser may also remember your data between visits (localStorage), but treat that only as a
  convenience. It can be cleared at any time, and it doesn't travel to another computer.
- Quiz sets that exist in the Django database at build time are included as starting sets.

`build_static` refuses to write into a non-empty folder that isn't a previous export, unless you pass
`--force`. It never deletes files it didn't create. Re-run it after adding questions to refresh the copy.

**Checking an export.** `tests/e2e/usb_check.mjs` opens every page of an export in a real browser with
the network switched off, and uses it like a teacher would. It fails if any request leaves `file://`,
any script error is thrown, or any feature doesn't work. It needs Node 22+ and Chrome or Edge, and no npm packages.

```bash
node tests/e2e/usb_check.mjs ~/Desktop/ks3-maths --browser chrome
node tests/e2e/usb_check.mjs ~/Desktop/ks3-maths --browser edge --shots /tmp/usb-shots   # also saves screenshots
```

## Adding or editing questions

Questions live in **one YAML file per topic** in `content/`. The file name (without `.yaml`)
becomes the topic's URL slug. After editing, run:

```bash
python manage.py load_questions          # validate everything, then load
python manage.py load_questions --check  # validate only
```

The loader checks every file before writing anything. If there is a problem it lists every
error (file, question id and what is wrong) and loads nothing. It checks for:

- exactly one correct option, A–D;
- a misconception label and explanation for each of the three wrong options, all different,
  and none for the correct option;
- unique ids across all files;
- year group 7, 8 or 9;
- four different, quoted option texts;
- a known strand;
- image files that exist and have alt text;
- a worked answer, if present, that ends at a wrong option and has 2–6 steps.

Questions removed from YAML are deleted from the database. Use `--keep-missing` to keep them.
Questions created in the admin are never removed by the loader. Edits made in the admin to
YAML-loaded questions are overwritten on the next load, so make lasting changes in the YAML.

### Format

```yaml
strand: Number                 # Number | Algebra | Ratio & proportion | Geometry & measures | Probability | Statistics
topic: Negative numbers        # display name
order: 2                       # position within the strand
questions:
  - id: neg-06                 # unique across all files
    year_group: 7              # 7, 8 or 9 (kept for reference; the site does not show or filter by it)
    stem: 'What is $-4 - 3$?'  # LaTeX between $...$ or $$...$$ (KaTeX)
    image: diagrams/neg-06.svg # optional, path under static/
    image_alt: 'A number line from -10 to 10'   # required if image is set
    options:
      A: '$-1$'
      B: '$7$'
      C: '$-7$'
      D: '$1$'
    correct: C
    misconceptions:            # exactly the three wrong letters
      A:
        label: 'Subtracts the smaller from the larger, keeps the sign'
        explanation: 'Works out 4 - 3 = 1 and puts the negative sign back.'
      B:
        label: 'Treats two minus signs as a plus'
        explanation: 'Applies "two negatives make a positive" to -4 - 3.'
      D:
        label: 'Moves the wrong way on the number line'
        explanation: 'Starts at -4 and counts 3 to the right.'
    worked_answer:             # optional; used by Misconception detectives rounds
      option: B                # a wrong option: the working must end at exactly this answer
      steps:                   # 2-6 lines of a fictional student's working with ONE error
        - '$-4 - 3$'
        - 'Two minus signs make a plus: $4 + 3$'
        - '$7$'
```

The worked answer should show the mistake without naming it, because the class has to work out which
misconception label caused it.

Rules of thumb:

- **Quote every option and any text containing a backslash with single quotes.**
  Unquoted `0.50` would become the number 0.5, and double quotes turn `\frac` into a control character.
  Inside single quotes, write an apostrophe as `''`.
- Each wrong answer should be exactly what a student holding one specific misconception would give.
  A student holding the key misconception should not be able to get the question right.
- Test one concept per question, and vary the position of the correct answer.
- Use `£` for money. `$` is reserved for maths.
- Diagrams go in `static/diagrams/` as SVG. Use black on white, large labels, and "Not drawn to scale" where relevant.

To add a new topic, create a new YAML file. It appears on the home page after the next `load_questions`.

## Admin

`/admin/` (log in with the superuser) lets you edit topics, questions and quiz sets, view or delete saved tallies,
and add or remove teacher logins.

## Answer-card scanner hook

For a future phone-camera scanner of printed ArUco answer cards:

```
GET /api/questions/<id>/   ->   {"id": "neg-01", "correct": "B"}
```

It returns only the id and the correct option. Cards are numbered, never named (see PRIVACY.md).

## Tests

```bash
python manage.py test
```

These cover:

- the YAML loader rules, including checks that the shipped `content/` is valid, correct answers are
  spread across A–D, and each worked answer ends at its option;
- the tally endpoint, the quiz builder and the scanner endpoint;
- the USB export.

The game runs in the browser from one shared engine (`static/js/engine.js`), used by both the Django site
and the USB copy. Its scoring and flow tests use Node's built-in runner:

```bash
node --test tests/js/engine.test.js
```

`python manage.py test` runs these too when Node is installed.

## Third-party assets (served locally)

- KaTeX 0.16.11 (MIT): `static/vendor/katex/`
- Atkinson Hyperlegible (default font) and OpenDyslexic (dyslexia-friendly toggle), both SIL OFL: `static/vendor/fonts/`
