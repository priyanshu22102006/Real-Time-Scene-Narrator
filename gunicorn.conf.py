
import os
import multiprocessing

bind = os.environ.get("GUNICORN_BIND", "0.0.0.0:5000")
workers = int(os.environ.get("GUNICORN_WORKERS", str(multiprocessing.cpu_count() * 2 + 1)))
threads = int(os.environ.get("GUNICORN_THREADS", "2"))
worker_class = "gthread"
timeout = int(os.environ.get("GUNICORN_TIMEOUT", "120"))
keepalive = 5

accesslog = "-"
errorlog = "-"
loglevel = os.environ.get("LOG_LEVEL", "info").lower()

