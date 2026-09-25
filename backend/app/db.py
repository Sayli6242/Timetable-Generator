"""Supabase persistence through its REST API (PostgREST).

Talking to the REST endpoint with httpx keeps the dependency list short and
works with any Supabase project. Tables are created by supabase/schema.sql.
"""
from __future__ import annotations

from typing import Any

import httpx

from .config import Settings
from .models import GenerateResult, TimetableInput


class StorageError(RuntimeError):
    pass


class SupabaseStore:
    def __init__(self, settings: Settings, client: httpx.Client | None = None):
        self.base = settings.supabase_url.rstrip("/") + "/rest/v1"
        key = settings.supabase_service_role_key.strip()
        self.headers = {"apikey": key, "Content-Type": "application/json"}
        # New-style secret keys (sb_secret_...) go only in the apikey header.
        # Legacy service_role keys are JWTs (start with "eyJ") and are also sent
        # as a Bearer token, which is what older projects expect.
        if key.startswith("eyJ"):
            self.headers["Authorization"] = f"Bearer {key}"
        self.client = client or httpx.Client(timeout=20)

    def _req(self, method: str, path: str, **kw) -> Any:
        headers = {**self.headers, **kw.pop("headers", {})}
        try:
            r = self.client.request(method, f"{self.base}/{path}", headers=headers, **kw)
        except httpx.HTTPError as e:
            raise StorageError(f"Could not reach Supabase: {e}") from e
        if r.status_code >= 400:
            raise StorageError(f"Supabase error {r.status_code}: {r.text[:300]}")
        return r.json() if r.content else None

    # ------------------------------------------------------------------ writes
    def save(self, inp: TimetableInput, result: GenerateResult) -> dict:
        row = {
            "name": inp.name,
            "status": result.status,
            "input": inp.model_dump(mode="json"),
            "result": result.model_dump(mode="json"),
        }
        created = self._req("POST", "timetables", json=row,
                            headers={"Prefer": "return=representation"})[0]
        if result.entries:
            entries = [
                {"timetable_id": created["id"], **e.model_dump(mode="json")}
                for e in result.entries
            ]
            try:
                self._req("POST", "timetable_entries", json=entries,
                          headers={"Prefer": "return=minimal"})
            except StorageError:
                # Don't leave a timetable without its entries behind.
                self.delete(created["id"])
                raise
        return self._summary(created)

    def delete(self, timetable_id: str) -> None:
        # timetable_entries rows go with it (ON DELETE CASCADE).
        self._req("DELETE", f"timetables?id=eq.{timetable_id}")

    # ------------------------------------------------------------------- reads
    def list(self, limit: int = 50) -> list[dict]:
        rows = self._req(
            "GET",
            f"timetables?select=id,name,status,created_at&order=created_at.desc&limit={limit}",
        )
        return [self._summary(r) for r in rows]

    def get(self, timetable_id: str) -> dict | None:
        rows = self._req("GET", f"timetables?id=eq.{timetable_id}&select=*")
        return rows[0] if rows else None

    @staticmethod
    def _summary(row: dict) -> dict:
        return {k: row.get(k) for k in ("id", "name", "status", "created_at")}
