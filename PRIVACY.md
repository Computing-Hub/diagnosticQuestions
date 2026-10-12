# Privacy

This site is designed to hold **no personal data**. It is meant to run on a teacher's own
laptop or the school network. Nothing it serves comes from outside: KaTeX and the fonts
are files in `static/`, so pages make no requests beyond the site itself.

## What is stored (in the SQLite database on this computer)

| What | Contents | When |
|---|---|---|
| Questions and topics | Maths content from the YAML files in `content/` | When `load_questions` runs or content is edited in the admin |
| Quiz sets | A name (e.g. "Y8 starter wk 6"), a list of question ids and the creation date | When a teacher saves a set |
| Tallies (optional) | Date, quiz set (if any), question id, and whole-class counts for A/B/C/D (in the game, for Vote 1 and Vote 2) | Only when the teacher clicks **Save tally** |
| Admin account | One superuser login, used only to edit content | Created by the teacher with `createsuperuser` |

## What is not stored

- No student names, numbers, answers or results. Tallies are anonymous class totals and are never linked to a person.
- No teacher accounts apart from the single admin superuser, and no email addresses.
- No game data. Team names (e.g. "Red", "Blue"), bets, votes and scores are kept in the browser tab's
  `sessionStorage`, never sent to the server or the database. They are deleted when the teacher clicks
  "Finish and discard", starts a new game, or closes the tab.
- No IP addresses, request logs written to disk, analytics or tracking.

## Cookies and browser storage

- `csrftoken`: Django's protection against cross-site form submission. It is set on pages with a form,
  and on Present and game pages, which can save a tally.
- `sessionid`: a signed cookie used only for the admin login. It expires when the browser closes.
- `sessionStorage` key `dq-game`: the game in progress (see above). It never leaves the browser tab.
- `messages`: short-lived notices such as "Saved", removed once they have been shown.
- `localStorage` key `dq-prefs`: this device's display choices (dyslexia-friendly font,
  dark theme). It never leaves the browser.

## Portable USB copy

The copy made by `build_static` runs from files on a USB stick and makes no network requests at all.

- Quiz sets and saved tallies are kept in a JSON data file that the teacher downloads and loads again.
  The file holds only quiz-set names, question ids, dates and anonymous A/B/C/D counts.
- `localStorage` key `dq-usb-data` caches the same data in the browser, as a convenience only.
- The game uses `sessionStorage`, as above.

## Answer cards (future feature)

Printed answer cards are **numbered, never named**. If a teacher wants to know which student
has which card number, that list stays on the teacher's own paper register, never in this app.
The `/api/questions/<id>/` endpoint for a future card scanner returns only the question id and
its correct letter.
