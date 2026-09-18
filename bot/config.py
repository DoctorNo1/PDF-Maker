"""Конфігурація бота (читається з оточення / .env)."""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path


def _load_dotenv(path: Path) -> None:
    """Мінімальний .env-лоадер, щоб не тягнути зайву залежність."""
    if not path.is_file():
        return
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip().strip("'\""))


@dataclass(frozen=True)
class Config:
    token: str
    auto_build_delay: float
    max_photos: int

    @classmethod
    def from_env(cls) -> "Config":
        _load_dotenv(Path(__file__).resolve().parent.parent / ".env")
        token = os.environ.get("BOT_TOKEN", "").strip()
        if not token:
            raise RuntimeError(
                "Не заданий BOT_TOKEN. Створи .env з .env.example "
                "і встав токен від @BotFather."
            )
        return cls(
            token=token,
            auto_build_delay=float(os.environ.get("AUTO_BUILD_DELAY", "3")),
            max_photos=int(os.environ.get("MAX_PHOTOS", "100")),
        )
