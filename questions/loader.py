"""Read, validate and load the YAML question files in content/.

Validation happens for every file before anything touches the database, so a
mistake in one file never leaves the bank half-loaded.
"""

from dataclasses import dataclass, field
from pathlib import Path

import yaml
from django.conf import settings
from django.db import transaction

from .models import LETTERS, STRANDS, YEAR_GROUPS, Question, Topic

FILE_KEYS = {"strand", "topic", "order", "questions"}
QUESTION_KEYS = {"id", "year_group", "stem", "image", "image_alt", "options", "correct", "misconceptions", "worked_answer"}
REQUIRED_QUESTION_KEYS = {"id", "year_group", "stem", "options", "correct", "misconceptions"}


class ContentError(Exception):
    def __init__(self, errors):
        self.errors = errors
        super().__init__("\n".join(errors))


@dataclass
class TopicData:
    slug: str
    name: str
    strand: str
    order: int
    source: str
    questions: list = field(default_factory=list)


def _is_text(value):
    return isinstance(value, str) and value.strip() != ""


def validate_topic_file(path, static_dirs=None):
    """Parse one YAML file. Returns (TopicData or None, list of error strings)."""
    path = Path(path)
    where = path.name
    errors = []
    try:
        data = yaml.safe_load(path.read_text(encoding="utf-8"))
    except yaml.YAMLError as exc:
        return None, [f"{where}: invalid YAML: {exc}"]

    if not isinstance(data, dict):
        return None, [f"{where}: file must be a mapping with strand, topic and questions"]

    unknown = set(data) - FILE_KEYS
    if unknown:
        errors.append(f"{where}: unknown top-level keys {sorted(unknown)}")
    if data.get("strand") not in STRANDS:
        errors.append(f"{where}: strand must be one of {list(STRANDS)}, got {data.get('strand')!r}")
    if not _is_text(data.get("topic")):
        errors.append(f"{where}: topic name is missing")
    order = data.get("order", 0)
    if not isinstance(order, int) or isinstance(order, bool):
        errors.append(f"{where}: order must be a whole number")
        order = 0
    questions = data.get("questions")
    if not isinstance(questions, list) or not questions:
        errors.append(f"{where}: questions must be a non-empty list")
        questions = []

    topic = TopicData(slug=path.stem, name=str(data.get("topic", "")), strand=str(data.get("strand", "")),
                      order=order, source=path.name)

    for index, q in enumerate(questions, start=1):
        q_errors, clean = validate_question(q, f"{where} question {index}", static_dirs)
        errors.extend(q_errors)
        if clean:
            clean["order"] = index
            topic.questions.append(clean)
    return topic, errors


def validate_question(q, where, static_dirs=None):
    """Check one question mapping. Returns (errors, cleaned dict or None)."""
    errors = []
    if not isinstance(q, dict):
        return [f"{where}: each question must be a mapping"], None

    qid = q.get("id")
    if _is_text(qid):
        where = f"{where} ({qid})"
    else:
        errors.append(f"{where}: id is missing")

    missing = REQUIRED_QUESTION_KEYS - set(q)
    if missing:
        errors.append(f"{where}: missing keys {sorted(missing)}")
    unknown = set(q) - QUESTION_KEYS
    if unknown:
        errors.append(f"{where}: unknown keys {sorted(unknown)}")

    year = q.get("year_group")
    if year not in YEAR_GROUPS or isinstance(year, bool):
        errors.append(f"{where}: year_group must be 7, 8 or 9, got {year!r}")

    if not _is_text(q.get("stem")):
        errors.append(f"{where}: stem is empty")

    options = q.get("options")
    if not isinstance(options, dict) or set(options) != set(LETTERS):
        errors.append(f"{where}: options must have exactly the keys A, B, C, D")
        options = {}
    for letter, text in options.items():
        if not _is_text(text):
            # Unquoted YAML like 0.50 becomes the number 0.5, silently losing digits.
            errors.append(f"{where}: option {letter} must be text - put it in quotes, e.g. \"{text}\"")
    texts = [str(t).strip() for t in options.values()]
    if options and len(set(texts)) != len(texts):
        errors.append(f"{where}: two options have the same text")

    correct = q.get("correct")
    if not (isinstance(correct, str) and correct in LETTERS):
        errors.append(f"{where}: correct must be exactly one of A, B, C, D, got {correct!r}")
        correct = None

    miscon = q.get("misconceptions")
    if not isinstance(miscon, dict):
        errors.append(f"{where}: misconceptions must be a mapping of the three wrong letters")
        miscon = {}
    if correct:
        wrong = set(LETTERS) - {correct}
        if correct in miscon:
            errors.append(f"{where}: the correct option {correct} must not have a misconception")
        if set(miscon) - set(LETTERS):
            errors.append(f"{where}: misconceptions has unknown keys {sorted(set(miscon) - set(LETTERS))}")
        if wrong - set(miscon):
            errors.append(f"{where}: missing misconception for wrong option(s) {sorted(wrong - set(miscon))}")
    labels = []
    for letter, m in miscon.items():
        if not isinstance(m, dict) or not _is_text(m.get("label")) or not _is_text(m.get("explanation")):
            errors.append(f"{where}: misconception {letter} needs a label and an explanation")
        elif set(m) - {"label", "explanation"}:
            errors.append(f"{where}: misconception {letter} has unknown keys {sorted(set(m) - {'label', 'explanation'})}")
        else:
            labels.append(m["label"].strip().lower())
    if len(set(labels)) != len(labels):
        errors.append(f"{where}: each wrong answer must target a different misconception")

    image = q.get("image") or ""
    if image:
        if not _is_text(q.get("image_alt")):
            errors.append(f"{where}: image needs image_alt text for accessibility")
        dirs = static_dirs if static_dirs is not None else list(settings.STATICFILES_DIRS)
        if dirs and not any((Path(d) / image).is_file() for d in dirs):
            errors.append(f"{where}: image file static/{image} not found")

    worked_option, worked_steps = "", []
    worked = q.get("worked_answer")
    if worked is not None:
        if not isinstance(worked, dict) or set(worked) != {"option", "steps"}:
            errors.append(f"{where}: worked_answer needs exactly 'option' and 'steps'")
        else:
            worked_option, worked_steps = worked["option"], worked["steps"]
            if not correct or worked_option not in set(LETTERS) - {correct}:
                errors.append(f"{where}: worked_answer option must be one of the wrong letters, got {worked_option!r}")
            if (not isinstance(worked_steps, list) or not 2 <= len(worked_steps) <= 6
                    or not all(_is_text(s) for s in worked_steps)):
                errors.append(f"{where}: worked_answer steps must be a list of 2 to 6 quoted lines")
                worked_steps = []

    if errors:
        return errors, None

    clean = {
        "worked_option": worked_option or "",
        "worked_steps": [s.strip() for s in worked_steps],
        "id": qid.strip(),
        "year_group": year,
        "stem": q["stem"].strip(),
        "image": image,
        "image_alt": (q.get("image_alt") or "").strip(),
        "correct": correct,
    }
    for letter in LETTERS:
        key = letter.lower()
        clean[f"option_{key}"] = options[letter].strip()
        m = miscon.get(letter) or {}
        clean[f"misconception_{key}"] = (m.get("label") or "").strip()
        clean[f"explanation_{key}"] = (m.get("explanation") or "").strip()
    return [], clean


def read_content(content_dir=None, static_dirs=None):
    """Validate every *.yaml file. Returns a list of TopicData or raises ContentError."""
    content_dir = Path(content_dir or settings.DQ_CONTENT_DIR)
    files = sorted(list(content_dir.glob("*.yaml")) + list(content_dir.glob("*.yml")))
    if not files:
        raise ContentError([f"No .yaml files found in {content_dir}"])

    topics, errors, seen = [], [], {}
    for path in files:
        topic, file_errors = validate_topic_file(path, static_dirs)
        errors.extend(file_errors)
        if topic is None:
            continue
        topics.append(topic)
        for q in topic.questions:
            if q["id"] in seen:
                errors.append(f"{path.name}: duplicate id {q['id']} (also in {seen[q['id']]})")
            else:
                seen[q["id"]] = path.name
    if errors:
        raise ContentError(errors)
    return topics


@transaction.atomic
def load_content(content_dir=None, static_dirs=None, prune=True):
    """Validate then write all topics and questions. Returns a summary dict."""
    topics = read_content(content_dir, static_dirs)
    created = updated = 0
    loaded_ids = set()
    for t in topics:
        topic_obj, _ = Topic.objects.update_or_create(
            slug=t.slug, defaults={"name": t.name, "strand": t.strand, "order": t.order}
        )
        for q in t.questions:
            fields = dict(q)
            qid = fields.pop("id")
            fields.update(topic=topic_obj, source_file=t.source)
            _, was_created = Question.objects.update_or_create(id=qid, defaults=fields)
            created += was_created
            updated += not was_created
            loaded_ids.add(qid)

    removed = 0
    if prune:
        # Only remove questions that came from YAML; ones added in the admin stay.
        stale = Question.objects.exclude(source_file="").exclude(id__in=loaded_ids)
        removed = stale.count()
        stale.delete()
        Topic.objects.filter(questions__isnull=True).exclude(slug__in=[t.slug for t in topics]).delete()

    return {"topics": len(topics), "created": created, "updated": updated, "removed": removed}
