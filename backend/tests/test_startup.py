"""Exercise the real container entrypoint without launching local services."""

import os
import subprocess
import sys
from pathlib import Path

import pytest
from cryptography.fernet import Fernet

REPO_ROOT = Path(__file__).resolve().parents[2]


def launch(tmp_path: Path, **settings: str) -> subprocess.CompletedProcess[str]:
    environment = os.environ.copy()
    for name in (
        "ENCRYPTION_KEYS",
        "ENVIRONMENT",
        "PERSISTENT_STORAGE_CONFIRMED",
        "DATABASE_URL",
        "REDIS_URL",
    ):
        environment.pop(name, None)
    environment.update(
        DATA_DIR=str(tmp_path / "data"),
        # A missing binary prevents a valid preflight from starting a real database.
        # Its secret-like path must not appear in the sanitized exception message.
        PG_BIN=str(tmp_path / "DO-NOT-LOG-THIS"),
    )
    environment.update(settings)
    return subprocess.run(
        [sys.executable, str(REPO_ROOT / "deploy/start.py")],
        cwd=tmp_path,
        env=environment,
        capture_output=True,
        text=True,
        timeout=10,
    )


@pytest.mark.parametrize("value", ["", "  \n"])
def test_missing_key_is_actionable_before_any_service_starts(tmp_path: Path, value: str) -> None:
    result = launch(tmp_path, ENCRYPTION_KEYS=value)
    assert result.returncode == 1
    assert "ENCRYPTION_KEYS is missing" in result.stderr
    assert "Space Settings" in result.stderr
    assert not (tmp_path / "data").exists()


@pytest.mark.parametrize("value", ["gw_DO-NOT-LOG-THIS", "DO-NOT-LOG-THIS,", "🔑"])
def test_invalid_keys_are_rejected_without_exposing_them(tmp_path: Path, value: str) -> None:
    result = launch(tmp_path, ENCRYPTION_KEYS=value)
    assert result.returncode == 1
    assert "ENCRYPTION_KEYS is invalid" in result.stderr
    assert value not in result.stderr
    assert not (tmp_path / "data").exists()


def test_production_requires_real_persistence_confirmation(tmp_path: Path) -> None:
    key = Fernet.generate_key().decode()
    result = launch(tmp_path, ENCRYPTION_KEYS=key, ENVIRONMENT="production")
    assert result.returncode == 1
    assert "PERSISTENT_STORAGE_CONFIRMED=true" in result.stderr
    assert "reachable external PostgreSQL DATABASE_URL" in result.stderr
    assert key not in result.stderr
    assert not (tmp_path / "data").exists()


@pytest.mark.parametrize("environment,confirmation", [("development", ""), ("production", "true")])
def test_valid_rotating_keys_reach_services_and_unexpected_details_stay_redacted(
    tmp_path: Path,
    environment: str,
    confirmation: str,
) -> None:
    keys = [Fernet.generate_key().decode(), Fernet.generate_key().decode()]
    result = launch(
        tmp_path,
        ENCRYPTION_KEYS=", ".join(keys),
        ENVIRONMENT=environment,
        PERSISTENT_STORAGE_CONFIRMED=confirmation,
    )
    assert result.returncode == 1
    assert "Gateway startup: embedded PostgreSQL startup" in result.stdout
    assert "during embedded PostgreSQL startup (FileNotFoundError)" in result.stderr
    assert "DO-NOT-LOG-THIS" not in result.stderr
    assert all(key not in result.stderr for key in keys)


def test_external_database_skips_embedded_persistence_guard(tmp_path: Path) -> None:
    environment = os.environ.copy()
    environment.update(
        ENCRYPTION_KEYS=Fernet.generate_key().decode(),
        ENVIRONMENT="production",
        PERSISTENT_STORAGE_CONFIRMED="",
        DATA_DIR=str(tmp_path / "data"),
        DATABASE_URL="postgresql+asyncpg://user:DO-NOT-LOG-THIS@database/gateway",
        REDIS_URL="redis://:DO-NOT-LOG-THIS@cache/0",
    )
    # Inject a migration failure to verify generic RuntimeErrors remain redacted,
    # without attempting a network connection or launching the API.
    code = (
        "import runpy, sys; from unittest.mock import patch; "
        "failure = RuntimeError('postgresql://user:DO-NOT-LOG-THIS@database/gateway'); "
        "mock = patch('subprocess.run', side_effect=failure); mock.start(); "
        "runpy.run_path(sys.argv[1], run_name='__main__')"
    )
    result = subprocess.run(
        [sys.executable, "-c", code, str(REPO_ROOT / "deploy/start.py")],
        cwd=tmp_path,
        env=environment,
        capture_output=True,
        text=True,
        timeout=10,
    )
    assert result.returncode == 1
    assert "during database migrations (RuntimeError)" in result.stderr
    assert "PERSISTENT_STORAGE_CONFIRMED" not in result.stderr
    assert "DO-NOT-LOG-THIS" not in result.stderr
    assert "embedded" not in result.stdout
