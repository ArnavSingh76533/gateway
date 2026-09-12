import asyncio
import ipaddress
from typing import Any
from unittest.mock import patch

import httpcore
import pytest
from conftest import register
from cryptography.fernet import Fernet, InvalidToken
from fastapi import HTTPException

from app.config import Settings
from app.security import SafeNetworkBackend, Vault, validate_base_url, validate_headers
from app.state import SharedState


@pytest.mark.parametrize(
    "url",
    [
        "file:///etc/passwd",
        "http://example.com/v1",
        "https://name:secret@example.com/v1",
        "https://example.com?key=secret",
        "https://example.com/#a",
        "https://example.com\\@127.0.0.1",
        "https://example.com:invalid",
        "https://example.com/\n",
    ],
)
def test_reject_invalid_upstreams(url: str) -> None:
    with pytest.raises(HTTPException):
        validate_base_url(url, [])


@pytest.mark.parametrize(
    "address",
    ["127.0.0.1", "169.254.169.254", "10.0.0.1", "192.168.0.1", "::1", "::ffff:127.0.0.1"],
)
async def test_transport_blocks_private_dns_at_connect(address: str) -> None:
    family = 10 if ipaddress.ip_address(address).version == 6 else 2

    async def resolve(*args: Any, **kwargs: Any) -> list:
        return [(family, 1, 6, "", (address, 443))]

    with patch.object(asyncio.get_running_loop(), "getaddrinfo", resolve):
        with pytest.raises(httpcore.ConnectError, match="blocked"):
            await SafeNetworkBackend([]).connect_tcp("public-looking.example", 443)


async def test_mixed_dns_answers_are_rejected(environment: Any) -> None:
    async def resolve(*args: Any, **kwargs: Any) -> list:
        return [(2, 1, 6, "", ("8.8.8.8", 443)), (2, 1, 6, "", ("127.0.0.1", 443))]

    with patch.object(asyncio.get_running_loop(), "getaddrinfo", resolve):
        with pytest.raises(httpcore.ConnectError):
            await SafeNetworkBackend([]).connect_tcp("rebind.example", 443)


@pytest.mark.parametrize(
    "headers",
    [
        {"Host": "internal"},
        {"Cookie": "secret"},
        {"X-Test": "ok\r\nHost: internal"},
        {"Proxy-Authorization": "secret"},
        {"Content-Length": "1"},
    ],
)
def test_forbidden_custom_headers(headers: dict[str, str]) -> None:
    with pytest.raises(HTTPException):
        validate_headers(headers)


def test_key_rotation_and_integrity() -> None:
    old, new = Fernet.generate_key().decode(), Fernet.generate_key().decode()
    sealed = Vault(old).seal({"api_key": "private"})
    rotating = Vault(new + "," + old)
    assert rotating.open(sealed)["api_key"] == "private"
    rotated = rotating.cipher.rotate(sealed.encode()).decode()
    assert Vault(new).open(rotated)["api_key"] == "private"
    with pytest.raises(InvalidToken):
        Vault(old).open(rotated)


async def test_concurrent_rate_limit_atomicity() -> None:
    shared = SharedState(None)

    async def call() -> bool:
        try:
            await shared.rate_limit("test", 5)
            return True
        except HTTPException:
            return False

    assert sum(await asyncio.gather(*(call() for _ in range(20)))) == 5


def test_production_refuses_insecure_configuration() -> None:
    with pytest.raises(ValueError, match="PostgreSQL"):
        Settings(encryption_keys=Fernet.generate_key().decode(), environment="production")


async def test_oversized_and_chunked_body(environment: Any) -> None:
    app, client, _ = environment
    await register(client)
    app.state.settings.max_request_bytes = 1024

    async def body() -> Any:
        yield b"x" * 700
        yield b"x" * 700

    result = await client.post("/api/providers", content=body())
    assert result.status_code == 413
