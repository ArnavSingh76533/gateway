"""Supervise rootless local services for Spaces or use externally managed databases.

Signals and any unexpected child exit shut down the whole unit. No service credentials are logged.
"""

import os
import signal
import subprocess
import sys
import time
from pathlib import Path

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
try:
    if not os.environ.get("ENCRYPTION_KEYS"):
        raise RuntimeError("Set ENCRYPTION_KEYS before starting the gateway.")
    root.mkdir(parents=True, exist_ok=True)
    if not os.environ.get("DATABASE_URL"):
        if (
            os.environ.get("ENVIRONMENT") == "production"
            and os.environ.get("PERSISTENT_STORAGE_CONFIRMED") != "true"
        ):
            raise RuntimeError(
                "Embedded production PostgreSQL requires durable /data storage and PERSISTENT_STORAGE_CONFIRMED=true."
            )
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
            raise RuntimeError("Embedded Redis failed to start.")
        connection.close()
    # Alembic serializes schema changes with a PostgreSQL advisory lock in env.py.
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
            raise RuntimeError("A supervised service exited unexpectedly.")
        if pg_started:
            result = subprocess.run(
                [str(pg_bin / "pg_ctl"), "-D", str(pg_data), "status"],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
            if result.returncode:
                raise RuntimeError("Embedded PostgreSQL exited unexpectedly.")
        time.sleep(1)
except Exception as exc:
    # Do not include command output or database connection URLs in errors.
    print(
        f"Gateway startup failed ({type(exc).__name__}). Check configuration and service availability.",
        file=sys.stderr,
    )
    stop()
    sys.exit(1)
finally:
    stop()
