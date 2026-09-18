"""Логіка розмови: приймаємо фото — віддаємо PDF."""

from __future__ import annotations

import asyncio
import io
import logging
from datetime import datetime

from aiogram import Bot, F, Router
from aiogram.filters import Command, CommandStart
from aiogram.types import BufferedInputFile, Message

from .config import Config
from .pdf import build_pdf
from .storage import Session, SessionStore

logger = logging.getLogger(__name__)

router = Router()
store = SessionStore()

HELP = (
    "<b>PDF Maker</b>\n\n"
    "Надішли мені фотографії — я складу їх в один PDF і поверну файл.\n"
    "Можна кидати альбомом або по одному: я зачекаю кілька секунд після "
    "останнього фото і сам усе склею.\n\n"
    "Команди:\n"
    "/done — склеїти зараз, не чекаючи\n"
    "/cancel — викинути накидані фото\n"
    "/mode — сторінки A4 (за замовчуванням) або по розміру фото\n"
    "/help — ця довідка"
)


def _filename() -> str:
    return f"photos_{datetime.now():%Y%m%d_%H%M%S}.pdf"


async def _download(bot: Bot, file_id: str) -> bytes:
    buffer = io.BytesIO()
    await bot.download(file_id, destination=buffer)
    return buffer.getvalue()


async def _send_pdf(bot: Bot, chat_id: int, session: Session) -> None:
    """Складає PDF з накопичених фото і надсилає користувачу."""
    async with session.lock:
        photos = session.take_photos()
        mode = session.mode

    if not photos:
        return

    status = await bot.send_message(chat_id, f"⚙️ Роблю PDF з {len(photos)} фото…")
    try:
        data = await asyncio.to_thread(build_pdf, photos, mode)
    except Exception:
        logger.exception("Не вдалося скласти PDF для чату %s", chat_id)
        await status.edit_text("❌ Не вдалося скласти PDF. Спробуй ще раз.")
        return

    await bot.send_document(
        chat_id,
        BufferedInputFile(data, filename=_filename()),
        caption=f"📄 Готово: {len(photos)} стор.",
    )
    await status.delete()


def _schedule_build(bot: Bot, chat_id: int, session: Session, delay: float) -> None:
    """Перезапускає таймер: PDF збереться через delay секунд тиші."""
    session.cancel_timer()

    async def _run() -> None:
        try:
            await asyncio.sleep(delay)
        except asyncio.CancelledError:
            return
        await _send_pdf(bot, chat_id, session)

    session.timer = asyncio.create_task(_run())


@router.message(CommandStart())
async def cmd_start(message: Message) -> None:
    await message.answer(HELP)


@router.message(Command("help"))
async def cmd_help(message: Message) -> None:
    await message.answer(HELP)


@router.message(Command("cancel"))
async def cmd_cancel(message: Message) -> None:
    session = store.get(message.chat.id)
    session.cancel_timer()
    async with session.lock:
        count = len(session.take_photos())
    if count:
        await message.answer(f"🗑 Викинув {count} фото. Можеш кидати нові.")
    else:
        await message.answer("Нема чого скасовувати — фото не накидано.")


@router.message(Command("mode"))
async def cmd_mode(message: Message) -> None:
    session = store.get(message.chat.id)
    session.mode = "fit" if session.mode == "a4" else "a4"
    if session.mode == "a4":
        await message.answer("📐 Сторінки A4: фото вписуються в аркуш.")
    else:
        await message.answer("🖼 Сторінка = розмір фото, без білих полів.")


@router.message(Command("done"))
async def cmd_done(message: Message, bot: Bot) -> None:
    session = store.get(message.chat.id)
    session.cancel_timer()
    if not session.photos:
        await message.answer("Спочатку надішли хоча б одне фото.")
        return
    await _send_pdf(bot, message.chat.id, session)


@router.message(F.photo)
async def handle_photo(message: Message, bot: Bot, config: Config) -> None:
    session = store.get(message.chat.id)
    data = await _download(bot, message.photo[-1].file_id)

    async with session.lock:
        limit_reached = len(session.photos) >= config.max_photos

    if limit_reached:
        await message.answer(
            f"⚠️ Ліміт {config.max_photos} фото на один PDF. "
            "Складаю те, що вже є, а це фото піде в наступний."
        )
        session.cancel_timer()
        await _send_pdf(bot, message.chat.id, session)

    async with session.lock:
        session.photos.append(data)

    _schedule_build(bot, message.chat.id, session, config.auto_build_delay)


@router.message(F.document.mime_type.startswith("image/"))
async def handle_image_document(message: Message, bot: Bot, config: Config) -> None:
    """Фото, надіслані файлом (без стиснення)."""
    session = store.get(message.chat.id)
    data = await _download(bot, message.document.file_id)

    async with session.lock:
        session.photos.append(data)

    _schedule_build(bot, message.chat.id, session, config.auto_build_delay)


@router.message()
async def handle_other(message: Message) -> None:
    await message.answer("Я вмію тільки фото → PDF. Надішли фотографії 🙂")
