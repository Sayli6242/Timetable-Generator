"""Settings, read from environment variables or backend/.env."""
from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    # Supabase project URL, e.g. https://abcd1234.supabase.co
    supabase_url: str = ""
    # Service-role key. It stays on the server and is never sent to the browser.
    supabase_service_role_key: str = ""
    # Comma-separated list of origins allowed to call the API.
    cors_origins: str = "http://localhost:5173,http://127.0.0.1:5173"
    # Optional regex for extra origins, e.g. Vercel preview URLs.
    cors_origin_regex: str = ""

    @property
    def supabase_enabled(self) -> bool:
        return bool(self.supabase_url and self.supabase_service_role_key)

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
