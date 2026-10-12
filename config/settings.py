"""
Django settings for the KS3 & KS4 Maths diagnostic questions site.

Designed to run on a teacher's laptop. Everything that might change when
moving to a school server is read from environment variables (prefix DQ_).
"""

import os
import secrets
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent


def _env_bool(name, default):
    return os.environ.get(name, str(default)).strip().lower() in {"1", "true", "yes", "on"}


def _secret_key():
    """Use DQ_SECRET_KEY if set, otherwise a per-install key kept in .secret_key."""
    key = os.environ.get("DQ_SECRET_KEY")
    if key:
        return key
    path = BASE_DIR / ".secret_key"
    if not path.exists():
        path.write_text(secrets.token_urlsafe(50))
    return path.read_text().strip()


SECRET_KEY = _secret_key()
DEBUG = _env_bool("DQ_DEBUG", True)
ALLOWED_HOSTS = [h.strip() for h in os.environ.get("DQ_ALLOWED_HOSTS", "localhost,127.0.0.1,[::1]").split(",") if h.strip()]
CSRF_TRUSTED_ORIGINS = [o.strip() for o in os.environ.get("DQ_CSRF_TRUSTED_ORIGINS", "").split(",") if o.strip()]

# Railway sets RAILWAY_PUBLIC_DOMAIN to the app's *.up.railway.app (or custom) domain.
if os.environ.get("RAILWAY_PUBLIC_DOMAIN"):
    ALLOWED_HOSTS.append(os.environ["RAILWAY_PUBLIC_DOMAIN"])
    CSRF_TRUSTED_ORIGINS.append("https://" + os.environ["RAILWAY_PUBLIC_DOMAIN"])

INSTALLED_APPS = [
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    "questions",
]

MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
]

if not DEBUG:
    # Serve collected static files from the app itself (Railway has no separate web server).
    MIDDLEWARE.insert(1, "whitenoise.middleware.WhiteNoiseMiddleware")

ROOT_URLCONF = "config.urls"

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [BASE_DIR / "templates"],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
            ],
        },
    },
]

WSGI_APPLICATION = "config.wsgi.application"

DATABASES = {
    "default": {
        "ENGINE": "django.db.backends.sqlite3",
        "NAME": os.environ.get("DQ_DB_PATH", BASE_DIR / "db.sqlite3"),
    }
}

AUTH_PASSWORD_VALIDATORS = [
    {"NAME": "django.contrib.auth.password_validation.UserAttributeSimilarityValidator"},
    {"NAME": "django.contrib.auth.password_validation.MinimumLengthValidator"},
    {"NAME": "django.contrib.auth.password_validation.CommonPasswordValidator"},
    {"NAME": "django.contrib.auth.password_validation.NumericPasswordValidator"},
]

LANGUAGE_CODE = "en-gb"
TIME_ZONE = "Europe/London"
USE_I18N = True
USE_TZ = True

STATIC_URL = "static/"
STATICFILES_DIRS = [BASE_DIR / "static"]
STATIC_ROOT = BASE_DIR / "staticfiles"

DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

# --- Privacy -----------------------------------------------------------------
# Sessions live in a signed cookie in the browser, so game scores are never
# written to the server, and the cookie is dropped when the browser closes.
SESSION_ENGINE = "django.contrib.sessions.backends.signed_cookies"
SESSION_EXPIRE_AT_BROWSER_CLOSE = True
SESSION_COOKIE_SAMESITE = "Lax"
CSRF_COOKIE_SAMESITE = "Lax"
MESSAGE_STORAGE = "django.contrib.messages.storage.cookie.CookieStorage"

# No request/IP logging to files; errors go to the console only.
LOGGING = {
    "version": 1,
    "disable_existing_loggers": False,
    "handlers": {"console": {"class": "logging.StreamHandler"}},
    "root": {"handlers": ["console"], "level": "WARNING"},
}

# --- Logins --------------------------------------------------------------------
# Viewing, presenting, printing and the game are open; changing quiz sets and saving
# tallies need a teacher login (created in the admin).
LOGIN_URL = "login"
LOGIN_REDIRECT_URL = "set_list"
LOGOUT_REDIRECT_URL = "home"

# --- HTTPS (public hosting) ---------------------------------------------------------
# With DEBUG off, assume a host such as Railway that terminates HTTPS at a proxy.
if not DEBUG:
    SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")
    SECURE_SSL_REDIRECT = _env_bool("DQ_SSL_REDIRECT", True)
    SESSION_COOKIE_SECURE = True
    CSRF_COOKIE_SECURE = True
    SECURE_HSTS_SECONDS = int(os.environ.get("DQ_HSTS_SECONDS", 0))

# --- App settings ------------------------------------------------------------
DQ_CONTENT_DIR = Path(os.environ.get("DQ_CONTENT_DIR", BASE_DIR / "content"))
DQ_THINKING_SECONDS = int(os.environ.get("DQ_THINKING_SECONDS", 30))
DQ_GAME_THINKING_SECONDS = int(os.environ.get("DQ_GAME_THINKING_SECONDS", 45))
DQ_ARGUE_SECONDS = int(os.environ.get("DQ_ARGUE_SECONDS", 90))
