"""
wsgi.py
Production WSGI application entrypoint for Gunicorn, Waitress, or uWSGI.
"""

from app_factory import create_app

app = create_app()

if __name__ == "__main__":
    app.run()
