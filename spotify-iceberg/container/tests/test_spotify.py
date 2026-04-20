from __future__ import annotations

import httpx
import pytest
import respx

from spotify_iceberg.spotify import InvalidGrantError, SpotifyClient


@pytest.fixture
def client() -> SpotifyClient:
    return SpotifyClient(client_id="cid", client_secret="csec")


@respx.mock
def test_refresh_returns_new_access_and_keeps_same_refresh(client) -> None:
    respx.post("https://accounts.spotify.com/api/token").mock(
        return_value=httpx.Response(
            200,
            json={"access_token": "new-access", "token_type": "Bearer", "expires_in": 3600},
        )
    )
    result = client.refresh_access_token("rt-original")
    assert result.access_token == "new-access"
    assert result.refresh_token == "rt-original"


@respx.mock
def test_refresh_picks_up_rotated_refresh_token(client) -> None:
    respx.post("https://accounts.spotify.com/api/token").mock(
        return_value=httpx.Response(
            200,
            json={
                "access_token": "new-access",
                "refresh_token": "rt-new",
                "token_type": "Bearer",
                "expires_in": 3600,
            },
        )
    )
    assert client.refresh_access_token("rt-old").refresh_token == "rt-new"


@respx.mock
def test_refresh_raises_invalid_grant_on_expired_token(client) -> None:
    respx.post("https://accounts.spotify.com/api/token").mock(
        return_value=httpx.Response(
            400,
            json={"error": "invalid_grant", "error_description": "Invalid refresh token"},
        )
    )
    with pytest.raises(InvalidGrantError):
        client.refresh_access_token("rt-dead")
