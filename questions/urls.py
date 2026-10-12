from django.urls import path

from . import views

SOURCE = "<str:kind>/<str:key>/"

urlpatterns = [
    path("", views.home, name="home"),
    path("topic/<slug:slug>/", views.topic_detail, name="topic"),
    path("present/" + SOURCE, views.present, name="present"),
    path("print/" + SOURCE, views.print_view, name="print"),
    path("tally/save/", views.save_tally, name="save_tally"),
    path("sets/", views.set_list, name="set_list"),
    path("sets/new/", views.set_edit, name="set_new"),
    path("sets/<int:pk>/", views.set_detail, name="set_detail"),
    path("sets/<int:pk>/edit/", views.set_edit, name="set_edit"),
    path("sets/<int:pk>/delete/", views.set_delete, name="set_delete"),
    path("game/", views.game_page, name="game_setup"),
    path("data/questions.js", views.questions_js, name="questions_js"),
    path("api/questions/<str:qid>/", views.answer_api, name="answer_api"),
]
