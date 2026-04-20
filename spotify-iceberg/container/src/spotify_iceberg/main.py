from fastapi import FastAPI

app = FastAPI(title="spotify-iceberg")


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}
