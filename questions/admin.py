from django.contrib import admin

from .models import Question, QuizSet, Tally, Topic


@admin.register(Topic)
class TopicAdmin(admin.ModelAdmin):
    list_display = ("name", "strand", "order", "slug")
    list_filter = ("strand",)
    ordering = ("strand", "order")


def _option_fieldset(letter):
    l = letter.lower()
    return (f"Option {letter}", {"fields": (f"option_{l}", f"misconception_{l}", f"explanation_{l}")})


@admin.register(Question)
class QuestionAdmin(admin.ModelAdmin):
    list_display = ("id", "topic", "year_group", "short_stem", "correct", "source_file")
    list_filter = ("topic__strand", "topic", "year_group", "correct")
    search_fields = ("id", "stem", "misconception_a", "misconception_b", "misconception_c", "misconception_d")
    readonly_fields = ("source_file",)
    fieldsets = (
        (None, {
            "fields": ("id", "topic", "year_group", "stem", "image", "image_alt", "correct", "order", "source_file"),
            "description": "Edits here are overwritten the next time load_questions runs for questions "
                           "that came from a YAML file. For lasting changes, edit the YAML in content/.",
        }),
        *[_option_fieldset(l) for l in "ABCD"],
        ("Worked answer (Misconception detectives)", {"fields": ("worked_option", "worked_steps")}),
    )

    @admin.display(description="Stem")
    def short_stem(self, obj):
        return obj.stem[:70]


@admin.register(QuizSet)
class QuizSetAdmin(admin.ModelAdmin):
    list_display = ("name", "created", "size")

    @admin.display(description="Questions")
    def size(self, obj):
        return len(obj.question_ids)


@admin.register(Tally)
class TallyAdmin(admin.ModelAdmin):
    list_display = ("date", "question_id", "quiz_set", "count_a", "count_b", "count_c", "count_d",
                    "vote2_a", "vote2_b", "vote2_c", "vote2_d")
    list_filter = ("date", "quiz_set")
