import re
import shutil
import subprocess
import tempfile
from pathlib import Path

from django.core.management import call_command
from django.core.management.base import CommandError
from django.test import TestCase

from questions.models import QuizSet

from .test_game import make_question


class BuildStaticTests(TestCase):
    def setUp(self):
        make_question("b-01")
        QuizSet.objects.create(name="Y8 starter", question_ids=["b-01"])
        self.tmp = tempfile.TemporaryDirectory()
        self.out = Path(self.tmp.name) / "usb"

    def tearDown(self):
        self.tmp.cleanup()

    def build(self, **kw):
        call_command("build_static", out=str(self.out), stdout=open("/dev/null", "w"), **kw)

    def test_export_is_self_contained(self):
        self.build()
        for page in ["index.html", "topic-t.html", "present.html", "print.html", "sets.html", "game.html", "README.txt",
                     "data/questions.js", "static/js/engine.js", "static/js/env-static.js",
                     "static/vendor/katex/katex.min.js", "static/vendor/fonts/opendyslexic-latin-400-normal.woff2"]:
            self.assertTrue((self.out / page).is_file(), page)
        self.assertFalse((self.out / "static/js/env-server.js").exists())
        for html in self.out.glob("*.html"):
            text = html.read_text()
            refs = re.findall(r'(?:src|href)="([^"]*)"', text)
            bad = [r for r in refs if r.startswith(("/", "http:", "https:", "//"))]
            self.assertEqual(bad, [], html.name)
            self.assertNotIn("{%", text)

    def test_questions_js_includes_bank_and_default_sets(self):
        self.build()
        js = (self.out / "data/questions.js").read_text()
        self.assertIn("window.QUESTIONS = ", js)
        self.assertIn('"name":"Y8 starter"', js)
        node = shutil.which("node")
        if node:
            out = subprocess.run([node, "-e", "var window={};" + js + "console.log(window.QUESTIONS.length, window.DEFAULT_SETS[0].id)"],
                                 capture_output=True, text=True, timeout=30)
            self.assertEqual(out.stdout.split()[0], "1")
            self.assertTrue(out.stdout.split()[1].startswith("db-"))

    def test_refuses_to_overwrite_an_unrelated_folder(self):
        self.out.mkdir()
        (self.out / "homework.docx").write_text("keep me")
        with self.assertRaises(CommandError):
            self.build()
        self.build(force=True)
        self.assertTrue((self.out / "homework.docx").exists())  # never deletes files it did not write

    def test_rebuild_over_previous_export(self):
        self.build()
        self.build()
        self.assertTrue((self.out / "index.html").exists())
