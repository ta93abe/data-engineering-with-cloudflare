from __future__ import annotations

import httpx


class StateStore:
    """KV access via the worker outbound handler at kv.internal."""

    def __init__(
        self,
        base_url: str,
        http_client: httpx.Client | None = None,
    ) -> None:
        self._base_url = base_url.rstrip("/")
        self._http = http_client or httpx.Client(timeout=10.0)

    def get(self, key: str) -> str | None:
        resp = self._http.get(f"{self._base_url}/{key}")
        if resp.status_code == 404:
            return None
        if resp.status_code != 200:
            raise RuntimeError(f"state.get({key}) status={resp.status_code}")
        return resp.text

    def put(self, key: str, value: str) -> None:
        resp = self._http.put(f"{self._base_url}/{key}", content=value)
        if resp.status_code not in (200, 204):
            raise RuntimeError(f"state.put({key}) status={resp.status_code}")
