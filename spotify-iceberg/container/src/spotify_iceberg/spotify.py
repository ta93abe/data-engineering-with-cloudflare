from __future__ import annotations

import base64
import time
from dataclasses import dataclass

import httpx

TOKEN_URL = "https://accounts.spotify.com/api/token"
API_BASE = "https://api.spotify.com/v1"

MAX_RETRIES = 3
BACKOFF_BASE_SEC = 0.5


def _should_retry(status_code: int) -> bool:
    return status_code == 429 or 500 <= status_code < 600


def _retry_after_sec(response: httpx.Response) -> float:
    header = response.headers.get("Retry-After")
    if header is not None:
        try:
            return min(float(header), 30.0)
        except ValueError:
            pass
    return 0.0


class SpotifyError(Exception):
    """Base exception for Spotify API failures."""


class InvalidGrantError(SpotifyError):
    """The refresh_token is no longer valid; human re-authorization needed."""


@dataclass(frozen=True)
class TokenResult:
    access_token: str
    refresh_token: str


class SpotifyClient:
    """Thin HTTP client for Spotify. Stateless."""

    def __init__(
        self,
        client_id: str,
        client_secret: str,
        http_client: httpx.Client | None = None,
    ) -> None:
        self._client_id = client_id
        self._client_secret = client_secret
        self._http = http_client or httpx.Client(timeout=30.0)

    def _basic_auth(self) -> str:
        raw = f"{self._client_id}:{self._client_secret}".encode()
        return "Basic " + base64.b64encode(raw).decode()

    def refresh_access_token(self, refresh_token: str) -> TokenResult:
        resp = self._http.post(
            TOKEN_URL,
            headers={
                "Authorization": self._basic_auth(),
                "Content-Type": "application/x-www-form-urlencoded",
            },
            data={"grant_type": "refresh_token", "refresh_token": refresh_token},
        )
        if resp.status_code == 400:
            body = resp.json()
            if body.get("error") == "invalid_grant":
                raise InvalidGrantError(body.get("error_description", "invalid_grant"))
        if resp.status_code >= 400:
            raise SpotifyError(f"token endpoint {resp.status_code}: {resp.text}")

        body = resp.json()
        return TokenResult(
            access_token=body["access_token"],
            refresh_token=body.get("refresh_token", refresh_token),
        )

    def recently_played(
        self,
        access_token: str,
        after_ms: int,
        limit: int = 50,
    ) -> list[dict]:
        url = f"{API_BASE}/me/player/recently-played"
        params = {"after": after_ms, "limit": limit}
        headers = {"Authorization": f"Bearer {access_token}"}

        for attempt in range(MAX_RETRIES + 1):
            resp = self._http.get(url, params=params, headers=headers)
            if not _should_retry(resp.status_code):
                break
            if attempt == MAX_RETRIES:
                raise SpotifyError(
                    f"recently-played failed after {MAX_RETRIES + 1} attempts: "
                    f"status={resp.status_code}"
                )
            sleep_sec = _retry_after_sec(resp) or BACKOFF_BASE_SEC * (2**attempt)
            time.sleep(sleep_sec)

        if resp.status_code == 401:
            raise SpotifyError("spotify returned 401; access_token likely expired mid-flight")
        if resp.status_code == 403:
            raise SpotifyError(f"spotify forbidden: {resp.text}")
        if resp.status_code >= 400:
            raise SpotifyError(f"recently-played {resp.status_code}: {resp.text}")
        return resp.json().get("items", [])
