from __future__ import annotations

import httpx
import pytest
import respx

from spotify_iceberg.state import StateStore


@pytest.fixture
def store() -> StateStore:
    return StateStore(base_url="http://kv.internal")


@respx.mock
def test_get_returns_value_on_200(store) -> None:
    respx.get("http://kv.internal/refresh_token").mock(
        return_value=httpx.Response(200, text="AQB-xyz")
    )
    assert store.get("refresh_token") == "AQB-xyz"


@respx.mock
def test_get_returns_none_on_404(store) -> None:
    respx.get("http://kv.internal/cursor").mock(return_value=httpx.Response(404))
    assert store.get("cursor") is None


@respx.mock
def test_put_sends_plain_text_body(store) -> None:
    route = respx.put("http://kv.internal/cursor").mock(return_value=httpx.Response(204))
    store.put("cursor", "1713500400000")
    assert route.call_count == 1
    assert route.calls[0].request.content == b"1713500400000"


@respx.mock
def test_get_raises_on_unexpected_status(store) -> None:
    respx.get("http://kv.internal/foo").mock(return_value=httpx.Response(500))
    with pytest.raises(RuntimeError):
        store.get("foo")
