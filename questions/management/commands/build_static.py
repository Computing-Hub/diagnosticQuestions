"""Export a self-contained copy of the site for a USB stick.

    python manage.py build_static --out /Volumes/USB/ks3-maths

The folder works by opening index.html straight from the stick (file:// URLs): no server,
no internet. Questions come from the database (run load_questions first), so admin edits
and the YAML content are both included.
"""

import shutil
from pathlib import Path

from django.conf import settings
from django.core.management.base import BaseCommand, CommandError
from django.db.models import Count
from django.template.loader import render_to_string

from questions.export import questions_js, topics_data
from questions.models import STRANDS, YEAR_GROUPS, Question, Topic

MARKER = ".ks3-maths-usb"
PAGES = ["present.html", "print.html", "sets.html", "game.html"]

README = """KS3 Maths diagnostic questions: portable copy
=============================================

Open index.html (double-click it, or drag it into Chrome or Edge).
No internet connection or server is needed.

Your quiz sets and saved tallies are kept in a data file:
  * after making a quiz set or saving a tally, click "Download data" and save the
    .json file on this USB stick;
  * next time, click "Load data" and choose that file.
The browser may also remember them between visits, but do not rely on that.

Nothing personal is stored: only quiz-set names, question ids and anonymous A/B/C/D counts.
"""


class Command(BaseCommand):
    help = "Export a self-contained static copy of the site that runs from file:// (e.g. a USB stick)."

    def add_arguments(self, parser):
        parser.add_argument("--out", required=True, help="Folder to write the portable site into.")
        parser.add_argument("--force", action="store_true",
                            help="Write into a non-empty folder that is not a previous export.")

    def handle(self, *args, **options):
        out = Path(options["out"]).expanduser().resolve()
        if not Question.objects.exists():
            raise CommandError("No questions in the database. Run `python manage.py load_questions` first.")
        if out.exists() and any(out.iterdir()) and not (out / MARKER).exists() and not options["force"]:
            raise CommandError(f"{out} is not empty and is not a previous export. Choose an empty folder or use --force.")
        out.mkdir(parents=True, exist_ok=True)

        # 1. Assets: CSS, JS, KaTeX, fonts, diagrams. Relative paths only.
        source = Path(settings.STATICFILES_DIRS[0])
        shutil.copytree(source, out / "static", dirs_exist_ok=True,
                        ignore=shutil.ignore_patterns(".*", "__pycache__", "env-server.js"))

        # 2. Data as a script, because browsers block fetch() over file://.
        (out / "data").mkdir(exist_ok=True)
        (out / "data" / "questions.js").write_text(questions_js(include_sets=True), encoding="utf-8")

        # 3. Pages.
        for old in out.glob("topic-*.html"):  # topics removed since the last export
            old.unlink()
        topics = topics_data()
        grouped = [(s, [t for t in topics if t["strand"] == s]) for s in STRANDS]
        total = sum(t["count"] for t in topics)
        self._write(out / "index.html", "static_site/index.html",
                    {"strands": [(s, ts) for s, ts in grouped if ts], "total": total})
        for topic in Topic.objects.annotate(n=Count("questions")).filter(n__gt=0):
            questions = list(topic.questions.select_related("topic"))
            counts = {y: sum(1 for q in questions if q.year_group == y) for y in YEAR_GROUPS}
            self._write(out / f"topic-{topic.slug}.html", "static_site/topic.html",
                        {"topic": topic, "questions": questions, "years": list(counts.items())})
        for page in PAGES:
            self._write(out / page, f"static_site/{page}", {"think": settings.DQ_THINKING_SECONDS})

        (out / "README.txt").write_text(README, encoding="utf-8")
        (out / MARKER).write_text("Created by `manage.py build_static`. Safe to overwrite with a new export.\n")
        self.stdout.write(self.style.SUCCESS(
            f"Exported {total} questions in {len(topics)} topics to {out}\nOpen {out / 'index.html'}"))

    def _write(self, path, template, context):
        path.write_text(render_to_string(template, context), encoding="utf-8")
