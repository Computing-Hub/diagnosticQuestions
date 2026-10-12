from django.core.management.base import BaseCommand, CommandError

from questions.loader import ContentError, load_content


class Command(BaseCommand):
    help = "Validate the YAML files in content/ and load them into the database."

    def add_arguments(self, parser):
        parser.add_argument("--dir", help="Folder of YAML files (default: content/).")
        parser.add_argument("--check", action="store_true", help="Validate only; do not write to the database.")
        parser.add_argument("--keep-missing", action="store_true",
                            help="Do not delete questions that are no longer in any YAML file.")

    def handle(self, *args, **options):
        from questions.loader import read_content

        try:
            if options["check"]:
                topics = read_content(options["dir"])
                count = sum(len(t.questions) for t in topics)
                self.stdout.write(self.style.SUCCESS(f"OK: {count} questions in {len(topics)} topics are valid."))
                return
            summary = load_content(options["dir"], prune=not options["keep_missing"])
        except ContentError as exc:
            for line in exc.errors:
                self.stderr.write(self.style.ERROR(line))
            raise CommandError(f"{len(exc.errors)} problem(s) found; nothing was loaded.")

        self.stdout.write(self.style.SUCCESS(
            "Loaded {topics} topics: {created} questions created, {updated} updated, {removed} removed.".format(**summary)
        ))
