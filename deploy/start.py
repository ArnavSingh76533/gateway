"""Supervise rootless local services for Spaces or use externally managed databases.

Signals and any unexpected child exit shut down the whole unit. No service credentials are logged.
"""

import os
import signal
import subprocess
import sys
import time
from pathlib import Path

from cryptography.fernet import Fernet


class StartupError(Exception):
    """An operator-facing message made only from trusted, static text.

    Never include environment values, command output, or another exception here.
    """


children: list[subprocess.Popen] = []
pg_started = False
stopping = False
root = Path(os.environ.get("DATA_DIR", "/data"))
pg_bin = Path(os.environ.get("PG_BIN", "/usr/lib/postgresql/15/bin"))
pg_data = root / "postgres"


def stop(signum: int = 0, frame: object = None) -> None:
    global stopping
    if stopping:
        return
    stopping = True
    for child in reversed(children):
        if child.poll() is None:
            child.terminate()
    for child in children:
        try:
            child.wait(timeout=15)
        except subprocess.TimeoutExpired:
            child.kill()
    if pg_started:
        subprocess.run(
            [str(pg_bin / "pg_ctl"), "-D", str(pg_data), "-m", "fast", "-w", "stop"],
            check=False,
        )


signal.signal(signal.SIGTERM, stop)
signal.signal(signal.SIGINT, stop)
stage = "configuration"
try:
    encryption_keys = os.environ.get("ENCRYPTION_KEYS", "")
    if not encryption_keys.strip():
        raise StartupError(
            "ENCRYPTION_KEYS is missing. In Hugging Face Space Settings, add a secret "
            "named ENCRYPTION_KEYS containing a Fernet key, then restart the Space. "
            "See README.md > Hugging Face startup troubleshooting."
        )
    try:
        for key in encryption_keys.split(","):
            Fernet(key.strip().encode())
    except (ValueError, TypeError):
        raise StartupError(
            "ENCRYPTION_KEYS is invalid. Use a URL-safe base64-encoded 32-byte Fernet key "
            "without surrounding quotes, not a provider API key or a gw_ key. "
            "For existing data, restore the original encryption key. "
            "See README.md > Hugging Face startup troubleshooting."
        ) from None
    if (
        not os.environ.get("DATABASE_URL")
        and os.environ.get("ENVIRONMENT") == "production"
        and os.environ.get("PERSISTENT_STORAGE_CONFIRMED") != "true"
    ):
        raise StartupError(
            "Embedded production PostgreSQL requires durable storage at DATA_DIR "
            "(/data by default) and PERSISTENT_STORAGE_CONFIRMED=true. "
            "Set that flag only after verifying suitable persistent storage, or configure "
            "a reachable external PostgreSQL DATABASE_URL. For a disposable demo only, "
            "use ENVIRONMENT=development; local data can be lost on restart."
        )
    stage = "data directory preparation"
    root.mkdir(parents=True, exist_ok=True)
    if not os.environ.get("DATABASE_URL"):
        stage = "embedded PostgreSQL startup"
        print(f"Gateway startup: {stage}.", flush=True)
        socket_dir = root / "run"
        socket_dir.mkdir(exist_ok=True)
        if not (pg_data / "PG_VERSION").exists():
            subprocess.run(
                [
                    str(pg_bin / "initdb"),
                    "-D",
                    str(pg_data),
                    "-U",
                    "gateway",
                    "--auth-local=trust",
                    "--auth-host=reject",
                    "--encoding=UTF8",
                ],
                check=True,
            )
        subprocess.run(
            [
                str(pg_bin / "pg_ctl"),
                "-D",
                str(pg_data),
                "-l",
                str(root / "postgres.log"),
                "-o",
                f"-k {socket_dir} -c listen_addresses=''",
                "-w",
                "start",
            ],
            check=True,
        )
        pg_started = True
        exists = subprocess.run(
            [
                str(pg_bin / "psql"),
                "-h",
                str(socket_dir),
                "-U",
                "gateway",
                "-d",
                "postgres",
                "-tAc",
                "SELECT 1 FROM pg_database WHERE datname='gateway'",
            ],
            capture_output=True,
            text=True,
            check=True,
        )
        if exists.stdout.strip() != "1":
            subprocess.run(
                [
                    str(pg_bin / "createdb"),
                    "-h",
                    str(socket_dir),
                    "-U",
                    "gateway",
                    "gateway",
                ],
                check=True,
            )
        os.environ["DATABASE_URL"] = (
            f"postgresql+asyncpg://gateway@/gateway?host={socket_dir}"
        )
    if not os.environ.get("REDIS_URL"):
        stage = "embedded Redis startup"
        print(f"Gateway startup: {stage}.", flush=True)
        redis_dir = root / "redis"
        redis_dir.mkdir(exist_ok=True)
        redis_socket = root / "redis.sock"
        children.append(
            subprocess.Popen(
                [
                    "redis-server",
                    "--port",
                    "0",
                    "--unixsocket",
                    str(redis_socket),
                    "--unixsocketperm",
                    "700",
                    "--dir",
                    str(redis_dir),
                    "--appendonly",
                    "yes",
                    "--loglevel",
                    "warning",
                ]
            )
        )
        os.environ["REDIS_URL"] = f"unix://{redis_socket}?db=0"
        import redis

        connection = redis.Redis.from_url(os.environ["REDIS_URL"])
        for i in range(100):
            try:
                connection.ping()
                break
            except redis.RedisError:
                time.sleep(0.1)
        else:
            raise StartupError(
                "Embedded Redis failed to start. Check its preceding service logs."
            )
        connection.close()
    # Alembic serializes schema changes with a PostgreSQL advisory lock in env.py.
    stage = "database migrations"
    print(f"Gateway startup: {stage}.", flush=True)
    subprocess.run(
        [
            sys.executable,
            "-m",
            "alembic",
            "-c",
            "backend/alembic.ini",
            "upgrade",
            "head",
        ],
        check=True,
    )
    stage = "API startup and service supervision"
    print(f"Gateway startup: {stage}.", flush=True)
    api = subprocess.Popen(
        [
            sys.executable,
            "-m",
            "uvicorn",
            "app.main:app",
            "--host",
            "0.0.0.0",
            "--port",
            os.environ.get("PORT", "7860"),
            "--workers",
            os.environ.get("WEB_CONCURRENCY", "1"),
            "--limit-concurrency",
            os.environ.get("MAX_CONCURRENCY", "32"),
            "--timeout-keep-alive",
            "5",
            "--no-access-log",
            "--forwarded-allow-ips",
            os.environ.get("TRUSTED_PROXY_IPS", ""),
        ]
    )
    children.append(api)
    while not stopping:
        if any(child.poll() is not None for child in children):
            raise StartupError(
                "A supervised service exited unexpectedly. Check the preceding service logs."
            )
        if pg_started:
            result = subprocess.run(
                [str(pg_bin / "pg_ctl"), "-D", str(pg_data), "status"],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                check=False,
            )
            if result.returncode:
                raise StartupError(
                    "Embedded PostgreSQL exited unexpectedly. Check postgres.log."
                )
        time.sleep(1)
except StartupError as exc:
    # Only explicitly curated messages are safe to display verbatim.
    print(f"Gateway startup failed: {exc}", file=sys.stderr, flush=True)
    sys.exit(1)
except Exception as exc:
    # Do not include command output or database connection URLs in errors.
    print(
        f"Gateway startup failed during {stage} ({type(exc).__name__}). "
        "Check configuration, storage permissions, and service availability. "
        "Exception details are withheld because they may contain credentials.",
        file=sys.stderr,
        flush=True,
    )
    sys.exit(1)
finally:
    stop()
