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


@respx.mock
def test_recently_played_returns_items(client) -> None:
    respx.get("https://api.spotify.com/v1/me/player/recently-played").mock(
        return_value=httpx.Response(
            200,
            json={
                "items": [{"track": {"id": "t1", "name": "a", "artists": []},
                           "played_at": "2026-04-20T10:00:00.000Z"}],
                "next": None,
            },
        )
    )
    items = client.recently_played("access-xyz", after_ms=1713500000000, limit=50)
    assert len(items) == 1 and items[0]["track"]["id"] == "t1"


@respx.mock
def test_recently_played_returns_empty_on_no_new_plays(client) -> None:
    respx.get("https://api.spotify.com/v1/me/player/recently-played").mock(
        return_value=httpx.Response(200, json={"items": [], "next": None})
    )
    assert client.recently_played("tok", after_ms=1713500000000) == []


@respx.mock
def test_recently_played_sends_after_param(client) -> None:
    route = respx.get("https://api.spotify.com/v1/me/player/recently-played").mock(
        return_value=httpx.Response(200, json={"items": [], "next": None})
    )
    client.recently_played("tok", after_ms=12345)
    assert route.call_count == 1
    call = route.calls[0]
    assert "after=12345" in str(call.request.url)
    assert "limit=50" in str(call.request.url)
