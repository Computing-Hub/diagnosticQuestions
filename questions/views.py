import json
from datetime import date

from django.conf import settings
from django.contrib import messages
from django.db.models import Count
from django.http import Http404, HttpResponse, HttpResponseBadRequest, JsonResponse
from django.shortcuts import get_object_or_404, redirect, render
from django.urls import reverse
from django.views.decorators.csrf import ensure_csrf_cookie
from django.views.decorators.http import require_GET, require_POST

from .export import questions_js as questions_js_source
from .models import LETTERS, STRANDS, YEAR_GROUPS, Question, QuizSet, Tally, Topic

# --- helpers -------------------------------------------------------------------

def _year(request):
    try:
        year = int(request.GET.get("year", ""))
    except ValueError:
        return None
    return year if year in YEAR_GROUPS else None


def _topic_questions(topic, year=None):
    qs = topic.questions.select_related("topic")
    return list(qs.filter(year_group=year) if year else qs)


def _source(request, kind, key):
    """Resolve (title, questions, quiz_set) for a topic slug or quiz-set id."""
    if kind == "topic":
        topic = get_object_or_404(Topic, slug=key)
        year = _year(request)
        title = f"{topic.name} (Year {year})" if year else topic.name
        return title, _topic_questions(topic, year), None
    if kind == "set":
        quiz_set = get_object_or_404(QuizSet, pk=key)
        return quiz_set.name, quiz_set.questions(), quiz_set
    raise Http404


def _strands():
    """[(strand, [topics with .count])] in curriculum order."""
    topics = Topic.objects.annotate(count=Count("questions")).order_by("order", "name")
    grouped = {s: [] for s in STRANDS}
    for t in topics:
        grouped.setdefault(t.strand, []).append(t)
    return [(s, ts) for s, ts in grouped.items() if ts]


# --- browsing -----------------------------------------------------------------

def home(request):
    return render(request, "questions/home.html", {
        "strands": _strands(),
        "total": Question.objects.count(),
        "sets": QuizSet.objects.all()[:6],
    })


def topic_detail(request, slug):
    topic = get_object_or_404(Topic, slug=slug)
    year = _year(request)
    counts = dict(topic.questions.values_list("year_group").annotate(n=Count("id")))
    return render(request, "questions/topic.html", {
        "topic": topic,
        "questions": _topic_questions(topic, year),
        "year": year,
        "years": [(y, counts.get(y, 0)) for y in YEAR_GROUPS],
        "query": f"?year={year}" if year else "",
    })


# --- present & print ------------------------------------------------------------

@ensure_csrf_cookie  # the tally panel POSTs from JavaScript
def present(request, kind, key):
    title, questions, quiz_set = _source(request, kind, key)
    if not questions:
        messages.info(request, "There are no questions to present yet.")
        return redirect("home")
    try:
        start = max(0, min(int(request.GET.get("q", 1)) - 1, len(questions) - 1))
    except ValueError:
        start = 0
    return render(request, "questions/present.html", {
        "title": title,
        "questions_data": [q.as_dict() for q in questions],
        "start": start,
        "quiz_set_id": quiz_set.pk if quiz_set else None,
        "think": settings.DQ_THINKING_SECONDS,
        "dq_env": _env(request),
        "back_url": reverse("set_detail", args=[quiz_set.pk]) if quiz_set
        else reverse("topic", args=[key]),
    })


def print_view(request, kind, key):
    title, questions, _ = _source(request, kind, key)
    return render(request, "questions/print.html", {"title": title, "questions": questions})


def _quiz_set_from(value):
    """Accept a quiz-set id as 7 or "db-7"; anything else means no set."""
    value = str(value or "").removeprefix("db-")
    return QuizSet.objects.filter(pk=int(value)).first() if value.isdigit() else None


@require_POST
def save_tally(request):
    """Store anonymous A/B/C/D counts. Only called when the teacher clicks Save tally.

    Body: {"quiz_set": id | null, "tallies": [{"question_id", "counts": [4], "vote2": [4] | null}]}
    """
    def counts(value, allow_none=False):
        if value is None and allow_none:
            return None
        if not isinstance(value, list) or len(value) != 4 or not all(isinstance(n, int) and 0 <= n <= 999 for n in value):
            raise ValueError("bad counts")
        return value

    try:
        data = json.loads(request.body)
        records = [(str(r["question_id"]), counts(r["counts"]), counts(r.get("vote2"), allow_none=True))
                   for r in data["tallies"]]
    except (ValueError, KeyError, TypeError, AttributeError):
        return HttpResponseBadRequest("Bad tally")
    known = set(Question.objects.filter(pk__in=[r[0] for r in records]).values_list("pk", flat=True))
    if not records or len(records) > 200 or any(r[0] not in known for r in records):
        return HttpResponseBadRequest("Bad tally")
    quiz_set = _quiz_set_from(data.get("quiz_set"))
    Tally.objects.bulk_create([
        Tally(date=date.today(), quiz_set=quiz_set, question_id=qid,
              count_a=c1[0], count_b=c1[1], count_c=c1[2], count_d=c1[3],
              **({"vote2_a": c2[0], "vote2_b": c2[1], "vote2_c": c2[2], "vote2_d": c2[3]} if c2 else {}))
        for qid, c1, c2 in records
    ])
    return JsonResponse({"saved": len(records)})


@require_GET
def answer_api(request, qid):
    """Hook for a future answer-card scanner: id and correct option only."""
    q = get_object_or_404(Question.objects.only("id", "correct"), pk=qid)
    return JsonResponse({"id": q.id, "correct": q.correct})


# --- quiz sets ------------------------------------------------------------------

def set_list(request):
    return render(request, "questions/set_list.html", {"sets": QuizSet.objects.all()})


def set_detail(request, pk):
    quiz_set = get_object_or_404(QuizSet, pk=pk)
    questions = quiz_set.questions()
    return render(request, "questions/set_detail.html", {
        "quiz_set": quiz_set, "questions": questions,
        "missing": len(quiz_set.question_ids) - len(questions),
    })


def set_edit(request, pk=None):
    quiz_set = get_object_or_404(QuizSet, pk=pk) if pk else None
    error = ""
    if request.method == "POST":
        name = request.POST.get("name", "").strip()[:120]
        picked = request.POST.getlist("q")
        valid = set(Question.objects.filter(pk__in=picked).values_list("pk", flat=True))
        ids = [i for i in dict.fromkeys(picked) if i in valid]
        if not name:
            error = "Give the set a name."
        elif not ids:
            error = "Tick at least one question."
        else:
            quiz_set = quiz_set or QuizSet()
            quiz_set.name, quiz_set.question_ids = name, ids
            quiz_set.save()
            messages.success(request, f"Saved “{name}” with {len(ids)} questions.")
            return redirect("set_detail", pk=quiz_set.pk)
        selected = set(picked)
    else:
        name = quiz_set.name if quiz_set else ""
        selected = set(quiz_set.question_ids) if quiz_set else set()

    topics = Topic.objects.prefetch_related("questions").order_by("order", "name")
    grouped = {s: [] for s in STRANDS}
    for t in topics:
        grouped.setdefault(t.strand, []).append(t)
    return render(request, "questions/set_edit.html", {
        "quiz_set": quiz_set, "name": name, "selected": selected, "error": error,
        "strands": [(s, ts) for s, ts in grouped.items() if ts],
    })


@require_POST
def set_delete(request, pk):
    quiz_set = get_object_or_404(QuizSet, pk=pk)
    quiz_set.delete()
    messages.success(request, f"Deleted “{quiz_set.name}”.")
    return redirect("set_list")


# --- game & shared browser data -------------------------------------------------------

def _env(request):
    """Config for static/js/env-server.js (quiz sets and the tally URL)."""
    return {
        "staticUrl": settings.STATIC_URL if settings.STATIC_URL.startswith("/") else "/" + settings.STATIC_URL,
        "saveUrl": reverse("save_tally"),
        "sets": [{"id": s.pk, "name": s.name, "question_ids": s.question_ids} for s in QuizSet.objects.all()],
    }


@ensure_csrf_cookie  # Save tally POSTs from JavaScript
def game_page(request):
    """Vote -> Argue -> Revote. The whole game runs in the browser (static/js/game-ui.js)."""
    return render(request, "questions/game.html", {"dq_env": _env(request)})


@require_GET
def questions_js(request):
    return HttpResponse(questions_js_source(), content_type="text/javascript; charset=utf-8")
