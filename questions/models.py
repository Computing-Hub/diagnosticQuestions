from django.core.exceptions import ValidationError
from django.db import models

LETTERS = ("A", "B", "C", "D")
YEAR_GROUPS = (7, 8, 9, 10, 11)

KEY_STAGES = {"KS3": "Key Stage 3", "KS4": "Key Stage 4 (GCSE)"}
# GCSE tier of a KS4 topic: "foundation" content is on both papers, "higher" is Higher only.
TIERS = {"foundation": "Foundation & Higher", "higher": "Higher only"}

# Fixed order of the strands on the home page.
STRANDS = (
    "Number",
    "Algebra",
    "Ratio & proportion",
    "Geometry & measures",
    "Probability",
    "Statistics",
)


class Topic(models.Model):
    slug = models.SlugField(primary_key=True, max_length=80)
    name = models.CharField(max_length=120)
    strand = models.CharField(max_length=60, choices=[(s, s) for s in STRANDS])
    order = models.PositiveIntegerField(default=0, help_text="Position within the strand.")
    key_stage = models.CharField(max_length=3, choices=list(KEY_STAGES.items()), default="KS3")
    tier = models.CharField(max_length=10, choices=list(TIERS.items()), blank=True, help_text="KS4 topics only.")

    class Meta:
        ordering = ["key_stage", "order", "name"]

    def __str__(self):
        return self.name

    @property
    def strand_index(self):
        return STRANDS.index(self.strand) if self.strand in STRANDS else len(STRANDS)

    @property
    def tier_label(self):
        return TIERS.get(self.tier, "")


def group_topics(topics):
    """[(key_stage, key_stage_name, [(strand, [topics])])] in curriculum order.

    Works for Topic objects and for the plain dicts in questions.js, so the Django
    pages and the USB export group topics the same way.
    """
    get = lambda t, k: t[k] if isinstance(t, dict) else getattr(t, k)
    out = []
    for ks, ks_name in KEY_STAGES.items():
        strands = []
        for strand in STRANDS:
            ts = sorted((t for t in topics if get(t, "key_stage") == ks and get(t, "strand") == strand),
                        key=lambda t: (get(t, "order"), get(t, "name")))
            if ts:
                strands.append((strand, ts))
        if strands:
            out.append((ks, ks_name, strands))
    return out


class Question(models.Model):
    id = models.CharField(primary_key=True, max_length=40, help_text="Stable id, e.g. neg-03.")
    topic = models.ForeignKey(Topic, on_delete=models.CASCADE, related_name="questions")
    year_group = models.PositiveSmallIntegerField(choices=[(y, f"Year {y}") for y in YEAR_GROUPS])
    stem = models.TextField(help_text="Supports LaTeX between $...$ (rendered with KaTeX).")
    image = models.CharField(max_length=200, blank=True, help_text="Path under static/, e.g. diagrams/angles-01.svg")
    image_alt = models.CharField(max_length=300, blank=True, help_text="Text description of the image.")

    option_a = models.CharField("A", max_length=300)
    option_b = models.CharField("B", max_length=300)
    option_c = models.CharField("C", max_length=300)
    option_d = models.CharField("D", max_length=300)
    correct = models.CharField(max_length=1, choices=[(l, l) for l in LETTERS])

    misconception_a = models.CharField(max_length=120, blank=True)
    explanation_a = models.CharField(max_length=400, blank=True)
    misconception_b = models.CharField(max_length=120, blank=True)
    explanation_b = models.CharField(max_length=400, blank=True)
    misconception_c = models.CharField(max_length=120, blank=True)
    explanation_c = models.CharField(max_length=400, blank=True)
    misconception_d = models.CharField(max_length=120, blank=True)
    explanation_d = models.CharField(max_length=400, blank=True)

    worked_option = models.CharField(max_length=1, blank=True, choices=[(l, l) for l in LETTERS],
                                     help_text="Wrong option that the worked answer arrives at (Misconception detectives).")
    worked_steps = models.JSONField(default=list, blank=True,
                                    help_text="A fictional student's working, one line per step, containing one error.")

    order = models.PositiveIntegerField(default=0)
    source_file = models.CharField(max_length=200, blank=True, editable=False,
                                   help_text="YAML file this question was loaded from (blank if created in admin).")

    class Meta:
        ordering = ["topic__order", "order", "id"]

    def __str__(self):
        return f"{self.id}: {self.stem[:60]}"

    def option(self, letter):
        return getattr(self, f"option_{letter.lower()}")

    def misconception(self, letter):
        return getattr(self, f"misconception_{letter.lower()}")

    def explanation(self, letter):
        return getattr(self, f"explanation_{letter.lower()}")

    @property
    def wrong_letters(self):
        return [l for l in LETTERS if l != self.correct]

    def options(self):
        """List of dicts, one per option, for templates and JSON."""
        return [
            {
                "letter": l,
                "text": self.option(l),
                "correct": l == self.correct,
                "misconception": "" if l == self.correct else self.misconception(l),
                "explanation": "" if l == self.correct else self.explanation(l),
            }
            for l in LETTERS
        ]

    def as_dict(self):
        return {
            "id": self.id,
            "topic": self.topic.name,
            "strand": self.topic.strand,
            "year_group": self.year_group,
            "stem": self.stem,
            "image": self.image,
            "image_alt": self.image_alt,
            "correct": self.correct,
            "options": self.options(),
        }

    @property
    def has_worked_answer(self):
        return bool(self.worked_option and self.worked_steps)

    def clean(self):
        errors = {}
        texts = [self.option(l).strip() for l in LETTERS]
        if len(set(texts)) != 4:
            errors["option_a"] = "The four options must all be different."
        for l in LETTERS:
            label, expl = self.misconception(l).strip(), self.explanation(l).strip()
            if l == self.correct:
                if label or expl:
                    errors[f"misconception_{l.lower()}"] = "The correct option must not have a misconception."
            elif not (label and expl):
                errors[f"misconception_{l.lower()}"] = "Each wrong option needs a misconception label and explanation."
        if self.worked_option and (self.worked_option == self.correct or not self.worked_steps):
            errors["worked_option"] = "The worked answer must end at a wrong option and have steps."
        if errors:
            raise ValidationError(errors)


class QuizSet(models.Model):
    """A named list of question ids. Nothing else is stored."""

    name = models.CharField(max_length=120)
    question_ids = models.JSONField(default=list)
    created = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created"]

    def __str__(self):
        return self.name

    def questions(self):
        """Questions in saved order, skipping ids that no longer exist."""
        by_id = Question.objects.select_related("topic").in_bulk(self.question_ids)
        return [by_id[i] for i in self.question_ids if i in by_id]


class Tally(models.Model):
    """Anonymous whole-class counts of A/B/C/D for one question. Saved only on request."""

    date = models.DateField()
    quiz_set = models.ForeignKey(QuizSet, null=True, blank=True, on_delete=models.SET_NULL)
    question_id = models.CharField(max_length=40)
    count_a = models.PositiveIntegerField(default=0)
    count_b = models.PositiveIntegerField(default=0)
    count_c = models.PositiveIntegerField(default=0)
    count_d = models.PositiveIntegerField(default=0)
    # Second vote (Vote -> Argue -> Revote game); empty when there was no revote.
    vote2_a = models.PositiveIntegerField(null=True, blank=True)
    vote2_b = models.PositiveIntegerField(null=True, blank=True)
    vote2_c = models.PositiveIntegerField(null=True, blank=True)
    vote2_d = models.PositiveIntegerField(null=True, blank=True)

    class Meta:
        ordering = ["-date", "question_id"]
        verbose_name_plural = "tallies"

    def __str__(self):
        return f"{self.date} {self.question_id}: {self.count_a}/{self.count_b}/{self.count_c}/{self.count_d}"
