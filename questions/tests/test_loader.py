import tempfile
import textwrap
from pathlib import Path

from django.conf import settings
from django.core.management import call_command
from django.test import TestCase

from questions.loader import ContentError, load_content, read_content
from questions.models import LETTERS, Question, Topic

VALID = """
strand: Number
topic: Test topic
order: 1
questions:
  - id: t-01
    year_group: 7
    stem: 'What is $2 + 3$?'
    options:
      A: '5'
      B: '6'
      C: '23'
      D: '1'
    correct: A
    misconceptions:
      B:
        label: 'Multiplies instead of adding'
        explanation: '2 x 3 = 6.'
      C:
        label: 'Writes digits side by side'
        explanation: 'Concatenates 2 and 3.'
      D:
        label: 'Subtracts instead of adding'
        explanation: '3 - 2 = 1.'
"""


class LoaderTestCase(TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.dir = Path(self.tmp.name)

    def tearDown(self):
        self.tmp.cleanup()

    def write(self, name, text):
        (self.dir / name).write_text(textwrap.dedent(text))

    def errors_for(self, text):
        self.write("topic.yaml", text)
        with self.assertRaises(ContentError) as ctx:
            read_content(self.dir, static_dirs=[])
        return "\n".join(ctx.exception.errors)


class ValidFileTests(LoaderTestCase):
    def test_valid_file_loads(self):
        self.write("test-topic.yaml", VALID)
        summary = load_content(self.dir, static_dirs=[])
        self.assertEqual(summary["created"], 1)
        q = Question.objects.get(pk="t-01")
        self.assertEqual(q.topic.slug, "test-topic")
        self.assertEqual(q.correct, "A")
        self.assertEqual(q.misconception_a, "")
        self.assertEqual(q.misconception_c, "Writes digits side by side")

    def test_reload_updates_and_prunes(self):
        self.write("test-topic.yaml", VALID)
        load_content(self.dir, static_dirs=[])
        Question.objects.create(id="admin-1", topic=Topic.objects.get(), year_group=8, stem="s",
                                option_a="1", option_b="2", option_c="3", option_d="4", correct="B")
        self.write("test-topic.yaml", VALID.replace("t-01", "t-02"))
        summary = load_content(self.dir, static_dirs=[])
        self.assertEqual(summary["removed"], 1)
        self.assertEqual(set(Question.objects.values_list("pk", flat=True)), {"t-02", "admin-1"})


class CorrectAnswerTests(LoaderTestCase):
    def test_correct_must_be_a_single_letter(self):
        self.assertIn("correct must be exactly one of", self.errors_for(VALID.replace("correct: A", "correct: [A, B]")))

    def test_correct_must_be_one_of_the_options(self):
        self.assertIn("correct must be exactly one of", self.errors_for(VALID.replace("correct: A", "correct: E")))

    def test_correct_option_cannot_have_a_misconception(self):
        text = VALID.replace("    misconceptions:\n", "    misconceptions:\n      A: {label: 'x', explanation: 'y'}\n")
        self.assertIn("must not have a misconception", self.errors_for(text))

    def test_options_must_be_a_to_d(self):
        self.assertIn("exactly the keys A, B, C, D", self.errors_for(VALID.replace("      D: '1'\n", "")))

    def test_duplicate_option_text_rejected(self):
        self.assertIn("same text", self.errors_for(VALID.replace("B: '6'", "B: '5'")))

    def test_unquoted_number_rejected(self):
        self.assertIn("must be text", self.errors_for(VALID.replace("B: '6'", "B: 0.50")))


class MisconceptionTests(LoaderTestCase):
    def test_missing_misconception_rejected(self):
        text = VALID.replace("      D:\n        label: 'Subtracts instead of adding'\n        explanation: '3 - 2 = 1.'\n", "")
        self.assertIn("missing misconception for wrong option(s) ['D']", self.errors_for(text))

    def test_misconception_needs_label_and_explanation(self):
        text = VALID.replace("        explanation: '3 - 2 = 1.'\n", "")
        self.assertIn("needs a label and an explanation", self.errors_for(text))

    def test_misconceptions_must_differ(self):
        text = VALID.replace("Subtracts instead of adding", "Multiplies instead of adding")
        self.assertIn("different misconception", self.errors_for(text))


class IdAndYearTests(LoaderTestCase):
    def test_duplicate_ids_across_files(self):
        self.write("one.yaml", VALID)
        self.write("two.yaml", VALID.replace("Test topic", "Other"))
        with self.assertRaises(ContentError) as ctx:
            read_content(self.dir, static_dirs=[])
        self.assertIn("duplicate id t-01", "\n".join(ctx.exception.errors))

    def test_duplicate_ids_within_a_file(self):
        body = VALID.split("questions:\n")[1]
        self.assertIn("duplicate id t-01", self.errors_for(VALID + body))

    def test_invalid_year_group(self):
        for bad in ("6", "10", "'7'", "true"):
            with self.subTest(year=bad):
                self.assertIn("year_group must be 7, 8 or 9", self.errors_for(VALID.replace("year_group: 7", f"year_group: {bad}")))

    def test_unknown_strand(self):
        self.assertIn("strand must be one of", self.errors_for(VALID.replace("strand: Number", "strand: Calculus")))

    def test_missing_image_file(self):
        text = VALID.replace("    options:", "    image: diagrams/nope.svg\n    image_alt: 'x'\n    options:", 1)
        self.write("topic.yaml", text)
        with self.assertRaises(ContentError) as ctx:
            read_content(self.dir, static_dirs=[self.dir])
        self.assertIn("not found", "\n".join(ctx.exception.errors))

    def test_nothing_written_when_any_file_is_invalid(self):
        self.write("good.yaml", VALID)
        self.write("bad.yaml", VALID.replace("t-01", "t-02").replace("year_group: 7", "year_group: 5"))
        with self.assertRaises(ContentError):
            load_content(self.dir, static_dirs=[])
        self.assertFalse(Question.objects.exists())


class RealContentTests(TestCase):
    """The shipped question bank must always pass validation."""

    def test_content_folder_is_valid(self):
        topics = read_content(settings.DQ_CONTENT_DIR)
        questions = [q for t in topics for q in t.questions]
        self.assertGreaterEqual(len(questions), 5 * len(topics))
        for t in topics:
            self.assertGreaterEqual(len(t.questions), 5, t.slug)

    def test_correct_answers_are_spread_across_letters(self):
        topics = read_content(settings.DQ_CONTENT_DIR)
        counts = {l: 0 for l in LETTERS}
        for t in topics:
            letters = {q["correct"] for q in t.questions}
            self.assertGreaterEqual(len(letters), 2, f"{t.slug}: correct answer always in the same position")
            for q in t.questions:
                counts[q["correct"]] += 1
        total = sum(counts.values())
        for l, n in counts.items():
            self.assertGreater(n, total * 0.15, f"Too few correct answers at {l}: {counts}")

    def test_management_command(self):
        call_command("load_questions", verbosity=0, stdout=open("/dev/null", "w"))
        self.assertTrue(Question.objects.exists())


WORKED = """    worked_answer:
      option: B
      steps:
        - '2 x 3'
        - '= 6'
"""


class WorkedAnswerTests(LoaderTestCase):
    def test_valid_worked_answer_loads(self):
        self.write("test-topic.yaml", VALID + WORKED)
        load_content(self.dir, static_dirs=[])
        q = Question.objects.get()
        self.assertEqual((q.worked_option, q.worked_steps), ("B", ["2 x 3", "= 6"]))
        self.assertTrue(q.has_worked_answer)

    def test_worked_answer_must_end_at_a_wrong_option(self):
        self.assertIn("one of the wrong letters", self.errors_for(VALID + WORKED.replace("option: B", "option: A")))

    def test_worked_answer_needs_two_to_six_steps(self):
        self.assertIn("2 to 6", self.errors_for(VALID + WORKED.replace("        - '= 6'\n", "")))

    def test_every_shipped_question_has_a_worked_answer(self):
        topics = read_content(settings.DQ_CONTENT_DIR)
        missing = [q["id"] for t in topics for q in t.questions if not q["worked_option"]]
        self.assertEqual(missing, [])

    def test_worked_answers_end_at_their_option(self):
        def norm(text):
            return "".join(text.replace("$", "").replace("=", "").split()).lower()
        topics = read_content(settings.DQ_CONTENT_DIR)
        bad = [q["id"] for t in topics for q in t.questions
               if not norm(q["worked_steps"][-1]).endswith(norm(q[f"option_{q['worked_option'].lower()}"]))]
        self.assertEqual(bad, [])
