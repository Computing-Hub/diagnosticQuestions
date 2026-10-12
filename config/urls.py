from django.contrib import admin
from django.urls import include, path

admin.site.site_header = "KS3 Maths diagnostic questions"
admin.site.site_title = "Diagnostic questions admin"

urlpatterns = [
    path("admin/", admin.site.urls),
    path("", include("questions.urls")),
]
