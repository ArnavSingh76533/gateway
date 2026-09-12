import asyncio
import hashlib
import ipaddress
import json
import re
import secrets
import socket
from typing import Any
from urllib.parse import urlsplit

import httpcore
import httpx
from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError
from cryptography.fernet import Fernet, MultiFernet
from httpcore._backends.auto import AutoBackend

from .errors import fail

password_hasher = PasswordHasher(time_cost=3, memory_cost=65536, parallelism=2)
DUMMY_HASH = password_hasher.hash(secrets.token_urlsafe(24))


def token_hash(value: str) -> str:
    return hashlib.sha256(value.encode()).hexdigest()


def new_key() -> str:
    return "gw_" + secrets.token_urlsafe(32)


async def hash_password(password: str) -> str:
    return await asyncio.to_thread(password_hasher.hash, password)


async def verify_password(stored: str, password: str) -> bool:
    try:
        return await asyncio.to_thread(password_hasher.verify, stored, password)
    except (VerificationError, InvalidHashError):
        return False


class Vault:
    def __init__(self, keys: str):
        self.cipher = MultiFernet([Fernet(k.strip().encode()) for k in keys.split(",")])

    def seal(self, value: dict[str, Any]) -> str:
        return self.cipher.encrypt(json.dumps(value).encode()).decode()

    def open(self, ciphertext: str) -> dict[str, Any]:
        return json.loads(self.cipher.decrypt(ciphertext.encode()))  # type: ignore[no-any-return]


BLOCKED_HEADERS = {
    "host",
    "connection",
    "content-length",
    "transfer-encoding",
    "cookie",
    "proxy-authorization",
    "proxy-connection",
    "forwarded",
    "x-forwarded-for",
    "x-forwarded-host",
    "x-forwarded-proto",
    "upgrade",
    "te",
    "trailer",
}


def validate_headers(headers: dict[str, str]) -> dict[str, str]:
    if len(headers) > 24:
        raise fail(422, "At most 24 custom headers are allowed.")
    for key, value in headers.items():
        if (
            key.lower() in BLOCKED_HEADERS
            or not re.fullmatch(r"[!#$%&'*+.^_`|~0-9A-Za-z-]+", key)
            or "\r" in value
            or "\n" in value
            or len(value) > 4096
        ):
            raise fail(422, "Custom headers contain a forbidden name or invalid value.")
    return headers


def validate_base_url(value: str, allowed_private: list[str]) -> str:
    try:
        parsed = urlsplit(value)
        _ = parsed.port
    except ValueError:
        raise fail(422, "Invalid base URL.") from None
    host = (parsed.hostname or "").lower()
    if (
        parsed.scheme not in ("http", "https")
        or not host
        or parsed.username
        or parsed.password
        or parsed.query
        or parsed.fragment
        or "\\" in value
        or any(ord(c) < 33 for c in value)
    ):
        raise fail(422, "Base URL must be HTTP(S), without credentials, query, or fragment.")
    if parsed.scheme != "https" and host not in allowed_private:
        raise fail(
            422, "HTTPS is required unless the host is explicitly allowlisted by the operator."
        )
    return value.rstrip("/")


class SafeNetworkBackend(AutoBackend):
    """Resolve once, validate every address, and connect to the validated IP.

    HTTPcore still uses the original origin for Host and TLS SNI/certificate verification.
    Validation at connect time prevents DNS rebinding between a preflight and the actual socket.
    """

    def __init__(self, allowed_private: list[str]):
        super().__init__()
        self.allowed_private = set(allowed_private)

    async def connect_tcp(
        self,
        host: str,
        port: int,
        timeout: float | None = None,
        local_address: str | None = None,
        socket_options: Any = None,
    ) -> Any:
        loop = asyncio.get_running_loop()
        try:
            async with asyncio.timeout(timeout or 10):
                addresses = await loop.getaddrinfo(host, port, type=socket.SOCK_STREAM)
        except (OSError, TimeoutError) as exc:
            raise httpcore.ConnectError("Upstream DNS resolution failed") from exc
        ips = list(dict.fromkeys(str(item[4][0]) for item in addresses))
        if not ips or (
            host.lower() not in self.allowed_private
            and any(not ipaddress.ip_address(ip).is_global for ip in ips)
        ):
            raise httpcore.ConnectError("Private or reserved upstream address blocked")
        return await super().connect_tcp(ips[0], port, timeout, local_address, socket_options)


def secure_transport(allowed_private: list[str]) -> httpx.AsyncHTTPTransport:
    transport = httpx.AsyncHTTPTransport(
        retries=0, limits=httpx.Limits(max_connections=200, max_keepalive_connections=40)
    )
    # Version-constrained HTTPcore integration; covered by transport security tests.
    transport._pool._network_backend = SafeNetworkBackend(allowed_private)
    return transport
