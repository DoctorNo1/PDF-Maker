"""Буфер фотографій для кожного чату."""

from __future__ import annotations

import asyncio
from dataclasses import dataclass, field

from .pdf import PageMode


@dataclass
class Session:
    """Фотографії, які користувач накидав і які ще не склеєні в PDF."""

    photos: list[bytes] = field(default_factory=list)
    mode: PageMode = "a4"
    lock: asyncio.Lock = field(default_factory=asyncio.Lock)
    timer: asyncio.Task | None = None

    def cancel_timer(self) -> None:
        if self.timer is not None and not self.timer.done():
            self.timer.cancel()
        self.timer = None

    def take_photos(self) -> list[bytes]:
        photos, self.photos = self.photos, []
        return photos


class SessionStore:
    """Сесії за chat_id (бот тримає їх у пам'яті, БД не потрібна)."""

    def __init__(self) -> None:
        self._sessions: dict[int, Session] = {}

    def get(self, chat_id: int) -> Session:
        session = self._sessions.get(chat_id)
        if session is None:
            session = Session()
            self._sessions[chat_id] = session
        return session
