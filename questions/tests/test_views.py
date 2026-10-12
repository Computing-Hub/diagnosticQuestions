import json

from django.contrib.auth.models import User
from django.test import TestCase
from django.urls import reverse

from questions.models import QuizSet, Tally, Topic

from .test_game import make_question


class PageTests(TestCase):
    def setUp(self):
        self.q = make_question("v-01", correct="C")
        self.teacher = User.objects.create_user("teacher")
        self.client.force_login(self.teacher)

    def test_pages_render(self):
        s = QuizSet.objects.create(name="Y8 starter", question_ids=["v-01", "gone"])
        for url in [reverse("home"), reverse("topic", args=["t"]), reverse("topic", args=["t"]) + "?year=7",
                    reverse("present", args=["topic", "t"]), reverse("print", args=["topic", "t"]),
                    reverse("present", args=["set", s.pk]), reverse("print", args=["set", s.pk]),
                    reverse("set_list"), reverse("set_new"), reverse("set_detail", args=[s.pk]), reverse("game_setup")]:
            with self.subTest(url=url):
                self.assertEqual(self.client.get(url).status_code, 200)

    def test_home_groups_topics_by_key_stage_with_tier(self):
        surds = Topic.objects.create(slug="surds", name="Surds", strand="Number", key_stage="KS4", tier="higher")
        make_question("s-01", topic=surds)
        r = self.client.get(reverse("home"))
        html = r.content.decode()
        self.assertLess(html.index("Key Stage 3"), html.index("Key Stage 4 (GCSE)"))
        self.assertContains(r, "Higher only")
        self.assertContains(self.client.get(reverse("topic", args=["surds"])), "KS4 › Number")
        self.assertContains(self.client.get(reverse("set_new")), "Key Stage 4 (GCSE)")

    def test_topic_page_has_no_year_filter(self):
        r = self.client.get(reverse("topic", args=["t"]))
        self.assertContains(r, "v-01")
        self.assertNotContains(r, "Year group")
        self.assertNotContains(r, "?year=")

    def test_print_has_answer_key(self):
        r = self.client.get(reverse("print", args=["topic", "t"]))
        self.assertContains(r, "Answer key")
        self.assertContains(r, "Mistake v-01 A")

    def test_answer_api_returns_id_and_correct_only(self):
        r = self.client.get(reverse("answer_api", args=["v-01"]))
        self.assertEqual(r.json(), {"id": "v-01", "correct": "C"})
        self.assertEqual(self.client.get(reverse("answer_api", args=["nope"])).status_code, 404)

    def test_save_tally_stores_only_counts(self):
        r = self.client.post(reverse("save_tally"), json.dumps({"tallies": [{"question_id": "v-01", "counts": [3, 1, 20, 4]}]}),
                             content_type="application/json")
        self.assertEqual(r.status_code, 200)
        t = Tally.objects.get()
        self.assertEqual((t.question_id, t.count_a, t.count_c, t.quiz_set, t.vote2_a), ("v-01", 3, 20, None, None))

    def test_quiz_builder_saves_name_and_ids(self):
        r = self.client.post(reverse("set_new"), {"name": "Y8 starter wk 6", "q": ["v-01", "not-real"]})
        s = QuizSet.objects.get()
        self.assertRedirects(r, reverse("set_detail", args=[s.pk]))
        self.assertEqual(s.question_ids, ["v-01"])

    def test_visitors_cannot_change_quiz_sets(self):
        self.client.logout()
        s = QuizSet.objects.create(name="Keep me", question_ids=["v-01"])
        login = reverse("login")
        for url in [reverse("set_new"), reverse("set_edit", args=[s.pk]), reverse("set_delete", args=[s.pk])]:
            with self.subTest(url=url):
                self.assertRedirects(self.client.post(url, {"name": "Changed", "q": ["v-01"]}), f"{login}?next={url}")
        s.refresh_from_db()
        self.assertEqual(s.name, "Keep me")
        self.assertEqual(QuizSet.objects.count(), 1)

    def test_visitors_see_no_edit_buttons(self):
        s = QuizSet.objects.create(name="Y8 starter", question_ids=["v-01"])
        self.client.logout()
        r = self.client.get(reverse("set_detail", args=[s.pk]))
        self.assertNotContains(r, reverse("set_delete", args=[s.pk]))
        self.assertContains(self.client.get(reverse("set_list")), "Log in")
        self.assertEqual(self.client.get(reverse("login")).status_code, 200)

    def test_no_cookies_on_plain_pages(self):
        self.client.logout()
        r = self.client.get(reverse("home"))
        self.assertEqual(list(r.cookies.keys()), [])
