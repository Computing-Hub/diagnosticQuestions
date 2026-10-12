"""The game runs in the browser (static/js/engine.js + game-ui.js).

Scoring and flow are tested in tests/js/engine.test.js with Node's built-in runner;
test_engine_rules runs those tests from `manage.py test` when Node is installed.
"""

import json
import shutil
import subprocess
from pathlib import Path

from django.conf import settings
from django.contrib.auth.models import User
from django.test import TestCase
from django.urls import reverse

from questions.models import Question, QuizSet, Tally, Topic


def make_question(qid="g-01", topic=None, correct="B", worked=True):
    topic = topic or Topic.objects.get_or_create(slug="t", defaults={"name": "T", "strand": "Number"})[0]
    letters = [l for l in "ABCD" if l != correct]
    fields = {f"misconception_{l.lower()}": f"Mistake {qid} {l}" for l in letters}
    fields.update({f"explanation_{l.lower()}": f"Why {l}" for l in letters})
    if worked:
        fields.update(worked_option=letters[0], worked_steps=["step one", "step two"])
    return Question.objects.create(id=qid, topic=topic, year_group=7, stem="Q?", option_a="1", option_b="2",
                                   option_c="3", option_d="4", correct=correct, **fields)


NODE = shutil.which("node")


class EngineTests(TestCase):
    def test_engine_rules(self):
        if not NODE:
            self.skipTest("Node is not installed; run `node --test tests/js/engine.test.js` elsewhere.")
        test_file = Path(settings.BASE_DIR) / "tests" / "js" / "engine.test.js"
        result = subprocess.run([NODE, "--test", str(test_file)], capture_output=True, text=True, timeout=60)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)


class GamePageTests(TestCase):
    def setUp(self):
        self.q = make_question("g-01")
        self.set = QuizSet.objects.create(name="Y8 starter", question_ids=["g-01"])
        self.teacher = User.objects.create_user("teacher")
        self.client.force_login(self.teacher)

    def test_game_page_loads_engine_and_sets(self):
        r = self.client.get(reverse("game_setup") + "?kind=topic&key=t")
        self.assertContains(r, "js/engine.js")
        self.assertContains(r, "js/game-ui.js")
        env = r.context["dq_env"]
        self.assertEqual(env["sets"], [{"id": self.set.pk, "name": "Y8 starter", "question_ids": ["g-01"]}])

    def test_questions_js_defines_the_bank(self):
        r = self.client.get(reverse("questions_js"))
        self.assertEqual(r["Content-Type"], "text/javascript; charset=utf-8")
        text = r.content.decode()
        self.assertIn("window.QUESTIONS = ", text)
        if NODE:
            script = text + "\nconsole.log(JSON.stringify(window.QUESTIONS[0]));"
            out = subprocess.run([NODE, "-e", "var window={};" + script], capture_output=True, text=True, timeout=30)
            q = json.loads(out.stdout)
            self.assertEqual((q["id"], q["correct"], q["worked_option"]), ("g-01", "B", "A"))

    def test_save_tally_batch_with_both_votes(self):
        body = {"quiz_set": self.set.pk, "tallies": [{"question_id": "g-01", "counts": [10, 12, 6, 2], "vote2": [2, 25, 2, 1]}]}
        r = self.client.post(reverse("save_tally"), json.dumps(body), content_type="application/json")
        self.assertEqual(r.json(), {"saved": 1})
        t = Tally.objects.get()
        self.assertEqual((t.count_b, t.vote2_b, t.quiz_set), (12, 25, self.set))

    def test_save_tally_works_with_csrf_checks_on(self):
        client = self.client_class(enforce_csrf_checks=True)
        client.force_login(self.teacher)
        client.get(reverse("game_setup"))  # sets the csrftoken cookie for the JavaScript POST
        token = client.cookies["csrftoken"].value
        body = {"tallies": [{"question_id": "g-01", "counts": [1, 2, 3, 4]}]}
        r = client.post(reverse("save_tally"), json.dumps(body), content_type="application/json", HTTP_X_CSRFTOKEN=token)
        self.assertEqual(r.status_code, 200)

    def test_save_tally_needs_login(self):
        self.client.logout()
        body = {"tallies": [{"question_id": "g-01", "counts": [1, 2, 3, 4]}]}
        r = self.client.post(reverse("save_tally"), json.dumps(body), content_type="application/json")
        self.assertEqual(r.status_code, 403)
        self.assertFalse(Tally.objects.exists())

    def test_save_tally_rejects_bad_input(self):
        for body in ({"tallies": [{"question_id": "nope", "counts": [1, 1, 1, 1]}]},
                     {"tallies": [{"question_id": "g-01", "counts": [1, 1, 1]}]},
                     {"tallies": [{"question_id": "g-01", "counts": [-1, 1, 1, 1]}]},
                     {"tallies": []}):
            r = self.client.post(reverse("save_tally"), json.dumps(body), content_type="application/json")
            self.assertEqual(r.status_code, 400, body)
        self.assertFalse(Tally.objects.exists())
