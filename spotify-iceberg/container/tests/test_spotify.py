from __future__ import annotations

import httpx
import pytest
import respx

from spotify_iceberg.spotify import InvalidGrantError, SpotifyClient, SpotifyError


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


@respx.mock
def test_recently_played_retries_on_5xx(client) -> None:
    route = respx.get("https://api.spotify.com/v1/me/player/recently-played").mock(
        side_effect=[
            httpx.Response(503, json={}),
            httpx.Response(200, json={"items": [], "next": None}),
        ]
    )
    assert client.recently_played("tok", after_ms=1) == []
    assert route.call_count == 2


@respx.mock
def test_recently_played_retries_on_429_with_retry_after(client) -> None:
    route = respx.get("https://api.spotify.com/v1/me/player/recently-played").mock(
        side_effect=[
            httpx.Response(429, headers={"Retry-After": "0"}),
            httpx.Response(200, json={"items": [], "next": None}),
        ]
    )
    assert client.recently_played("tok", after_ms=1) == []
    assert route.call_count == 2


@respx.mock
def test_recently_played_gives_up_after_max_retries(client) -> None:
    respx.get("https://api.spotify.com/v1/me/player/recently-played").mock(
        return_value=httpx.Response(503, json={})
    )
    with pytest.raises(SpotifyError):
        client.recently_played("tok", after_ms=1)


@respx.mock
def test_recently_played_follows_next_url_for_pagination(client) -> None:
    # Page 1: 50 items + next URL
    page1 = {
        "items": [
            {
                "track": {"id": f"t{i}", "name": f"s{i}", "artists": []},
                "played_at": "2026-04-20T10:00:00.000Z",
            }
            for i in range(50)
        ],
        "next": "https://api.spotify.com/v1/me/player/recently-played?before=1713500000000&limit=50",
    }
    # Page 2: 10 items + next=null (exhausted)
    page2 = {
        "items": [
            {
                "track": {"id": f"u{i}", "name": f"s{i}", "artists": []},
                "played_at": "2026-04-20T09:00:00.000Z",
            }
            for i in range(10)
        ],
        "next": None,
    }
    # Use params= to match the first request (which has after= param), and a
    # separate route for the next-URL request (which has before= param).
    respx.get(
        "https://api.spotify.com/v1/me/player/recently-played",
        params={"after": "1", "limit": "50"},
    ).mock(return_value=httpx.Response(200, json=page1))
    respx.get(
        "https://api.spotify.com/v1/me/player/recently-played",
        params={"before": "1713500000000", "limit": "50"},
    ).mock(return_value=httpx.Response(200, json=page2))

    items = client.recently_played("tok", after_ms=1, max_pages=10)
    assert len(items) == 60


@respx.mock
def test_recently_played_respects_max_pages(client) -> None:
    # Each page returns 50 items + next URL, so loop would be infinite without max_pages
    full_page_body = {
        "items": [
            {
                "track": {"id": f"t{i}", "name": "s", "artists": []},
                "played_at": "2026-04-20T10:00:00.000Z",
            }
            for i in range(50)
        ],
        "next": "https://api.spotify.com/v1/me/player/recently-played?before=1&limit=50",
    }
    route = respx.get("https://api.spotify.com/v1/me/player/recently-played").mock(
        return_value=httpx.Response(200, json=full_page_body)
    )
    items = client.recently_played("tok", after_ms=1, max_pages=3)
    assert len(items) == 150  # 3 pages × 50
    assert route.call_count == 3


@respx.mock
def test_recently_played_stops_when_items_count_less_than_limit(client) -> None:
    # 30 items + next URL set — but since items < limit (50), we stop without following next
    partial_body = {
        "items": [
            {
                "track": {"id": f"t{i}", "name": "s", "artists": []},
                "played_at": "2026-04-20T10:00:00.000Z",
            }
            for i in range(30)
        ],
        "next": "https://api.spotify.com/v1/me/player/recently-played?before=1&limit=50",
    }
    route = respx.get("https://api.spotify.com/v1/me/player/recently-played").mock(
        return_value=httpx.Response(200, json=partial_body)
    )
    items = client.recently_played("tok", after_ms=1)
    assert len(items) == 30
    assert route.call_count == 1
