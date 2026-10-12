"""Question bank as plain data for the browser.

The same `questions.js` is served by Django at /data/questions.js and written into the
portable USB copy, so Present, Print, the quiz builder and the game read one format.
"""

import json

from django.db.models import Count

from .models import STRANDS, Question, QuizSet, Topic


def question_data(q):
    return {
        "id": q.id,
        "topic": q.topic_id,
        "topic_name": q.topic.name,
        "strand": q.topic.strand,
        "year_group": q.year_group,
        "stem": q.stem,
        "image": q.image,
        "image_alt": q.image_alt,
        "correct": q.correct,
        "options": q.options(),
        "worked_option": q.worked_option,
        "worked_steps": q.worked_steps or [],
    }


def topics_data():
    topics = Topic.objects.annotate(count=Count("questions"))
    return sorted(
        [{"slug": t.slug, "name": t.name, "strand": t.strand, "order": t.order, "count": t.count} for t in topics if t.count],
        key=lambda t: (STRANDS.index(t["strand"]) if t["strand"] in STRANDS else 99, t["order"], t["name"]),
    )


def sets_data():
    return [{"id": f"db-{s.pk}", "name": s.name, "question_ids": list(s.question_ids),
             "created": s.created.date().isoformat()} for s in QuizSet.objects.all()]


def questions_js(include_sets=False):
    """JavaScript that defines window.QUESTIONS, TOPICS and STRANDS (and optionally DEFAULT_SETS).

    A script file rather than JSON because browsers block fetch() over file://.
    """
    topic_order = {t["slug"]: i for i, t in enumerate(topics_data())}
    questions = sorted(Question.objects.select_related("topic"),
                       key=lambda q: (topic_order.get(q.topic_id, 999), q.order, q.id))

    def dump(value):
        # ensure_ascii keeps the file plain ASCII; escaping "</" keeps it safe if ever inlined.
        return json.dumps(value, ensure_ascii=True, separators=(",", ":")).replace("</", "<\\/")

    lines = [
        "/* KS3 Maths diagnostic questions: generated, do not edit. Edit content/*.yaml instead. */",
        f"window.STRANDS = {dump(list(STRANDS))};",
        f"window.TOPICS = {dump(topics_data())};",
        f"window.QUESTIONS = {dump([question_data(q) for q in questions])};",
    ]
    if include_sets:
        lines.append(f"window.DEFAULT_SETS = {dump(sets_data())};")
    return "\n".join(lines) + "\n"
