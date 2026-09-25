"""FastAPI entry point.

Run with:  uvicorn app.main:app --reload   (from the backend/ folder)
"""
from __future__ import annotations

import json
from pathlib import Path
from uuid import UUID

from fastapi import Depends, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from .config import Settings, get_settings
from .db import StorageError, SupabaseStore
from .models import GenerateResult, TimetableInput
from .service import generate, validate

SAMPLE = Path(__file__).resolve().parent.parent / "samples" / "sample_input.json"

app = FastAPI(title="College Timetable Generator", version="0.1.0")

settings = get_settings()
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_origin_regex=settings.cors_origin_regex or None,
    allow_methods=["*"],
    allow_headers=["*"],
)


def get_store(s: Settings = Depends(get_settings)) -> SupabaseStore | None:
    return SupabaseStore(s) if s.supabase_enabled else None


def require_store(store: SupabaseStore | None = Depends(get_store)) -> SupabaseStore:
    if store is None:
        raise HTTPException(503, "Saving is off: set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in backend/.env.")
    return store


class GenerateResponse(GenerateResult):
    saved: dict | None = None
    save_error: str | None = None


class SaveRequest(BaseModel):
    input: TimetableInput
    result: GenerateResult


@app.get("/api/health")
def health(s: Settings = Depends(get_settings)):
    return {"ok": True, "storage": "supabase" if s.supabase_enabled else "off"}


@app.get("/api/sample", response_model=TimetableInput)
def sample():
    return TimetableInput(**json.loads(SAMPLE.read_text()))


@app.post("/api/validate", response_model=GenerateResult)
def validate_input(inp: TimetableInput):
    """Run the checks only: bad references, overloads, missing rooms, teacher plan."""
    return validate(inp)


# Plain `def` (not async): the solver is CPU-bound, so FastAPI runs it in a
# worker thread and the server keeps answering other requests meanwhile.
@app.post("/api/generate", response_model=GenerateResponse)
def generate_timetable(inp: TimetableInput, save: bool = False,
                       store: SupabaseStore | None = Depends(get_store)):
    result = GenerateResponse(**generate(inp).model_dump())
    if save and result.status == "ok":
        if store is None:
            result.save_error = "Saving is off: Supabase is not configured on the server."
        else:
            try:
                result.saved = store.save(inp, result)
            except StorageError as e:
                result.save_error = str(e)
    return result


@app.get("/api/timetables")
def list_timetables(store: SupabaseStore = Depends(require_store)):
    try:
        return store.list()
    except StorageError as e:
        raise HTTPException(502, str(e))


@app.post("/api/timetables", status_code=201)
def save_timetable(body: SaveRequest, store: SupabaseStore = Depends(require_store)):
    if body.result.status != "ok":
        raise HTTPException(400, "Only a successfully generated timetable can be saved.")
    try:
        return store.save(body.input, body.result)
    except StorageError as e:
        raise HTTPException(502, str(e))


@app.get("/api/timetables/{timetable_id}")
def get_timetable(timetable_id: UUID, store: SupabaseStore = Depends(require_store)):
    try:
        row = store.get(str(timetable_id))
    except StorageError as e:
        raise HTTPException(502, str(e))
    if row is None:
        raise HTTPException(404, "Timetable not found.")
    return row


@app.delete("/api/timetables/{timetable_id}", status_code=204)
def delete_timetable(timetable_id: UUID, store: SupabaseStore = Depends(require_store)):
    try:
        store.delete(str(timetable_id))
    except StorageError as e:
        raise HTTPException(502, str(e))
