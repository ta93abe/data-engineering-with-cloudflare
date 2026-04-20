"""
One-shot helper to obtain a Spotify refresh_token for user-read-recently-played.

Usage:
  uv run --with spotipy python scripts/spotify/get_refresh_token.py

Prerequisite: in https://developer.spotify.com/dashboard register an app with
redirect URI http://localhost:8888/callback.

After printing the refresh_token, load it into KV:
  wrangler kv key put --binding=SPOTIFY_STATE_KV refresh_token "<value>"
"""
from __future__ import annotations

import sys

import spotipy
from spotipy.oauth2 import SpotifyOAuth


def main() -> None:
    client_id = input("Spotify Client ID: ").strip()
    client_secret = input("Spotify Client Secret: ").strip()
    if not client_id or not client_secret:
        sys.exit("client id/secret required")

    auth = SpotifyOAuth(
        client_id=client_id,
        client_secret=client_secret,
        redirect_uri="http://localhost:8888/callback",
        scope="user-read-recently-played",
        open_browser=True,
        cache_path=None,
    )
    token_info = auth.get_access_token(as_dict=True)
    refresh_token = token_info.get("refresh_token")
    if not refresh_token:
        sys.exit("no refresh_token returned; check scope grant")

    print("\n=== refresh_token ===")
    print(refresh_token)
    print("\nLoad into KV:")
    print(
        f'  wrangler kv key put --binding=SPOTIFY_STATE_KV refresh_token "{refresh_token}"'
    )


if __name__ == "__main__":
    main()
