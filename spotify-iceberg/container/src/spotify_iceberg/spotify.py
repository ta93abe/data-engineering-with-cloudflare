from __future__ import annotations

import base64
from dataclasses import dataclass

import httpx

TOKEN_URL = "https://accounts.spotify.com/api/token"
API_BASE = "https://api.spotify.com/v1"


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
