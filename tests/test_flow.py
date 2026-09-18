import asyncio
import io

import pytest
from PIL import Image

from bot.handlers import _schedule_build, _send_pdf
from bot.storage import Session


def _png(size=(120, 90)):
    buffer = io.BytesIO()
    Image.new("RGB", size, "blue").save(buffer, format="PNG")
    return buffer.getvalue()


class StatusMessage:
    def __init__(self):
        self.edits = []
        self.deleted = False

    async def edit_text(self, text):
        self.edits.append(text)

    async def delete(self):
        self.deleted = True


class FakeBot:
    def __init__(self):
        self.messages = []
        self.documents = []

    async def send_message(self, chat_id, text):
        self.messages.append(text)
        status = StatusMessage()
        self.last_status = status
        return status

    async def send_document(self, chat_id, document, caption=None):
        self.documents.append((document, caption))


@pytest.mark.asyncio
async def test_send_pdf_sends_document_and_clears_session():
    bot, session = FakeBot(), Session()
    session.photos = [_png(), _png()]

    await _send_pdf(bot, 1, session)

    assert len(bot.documents) == 1
    document, caption = bot.documents[0]
    assert document.data.startswith(b"%PDF")
    assert document.filename.endswith(".pdf")
    assert "2" in caption
    assert session.photos == []
    assert bot.last_status.deleted


@pytest.mark.asyncio
async def test_send_pdf_without_photos_does_nothing():
    bot, session = FakeBot(), Session()
    await _send_pdf(bot, 1, session)
    assert bot.documents == []
    assert bot.messages == []


@pytest.mark.asyncio
async def test_broken_image_reports_error_and_sends_nothing():
    bot, session = FakeBot(), Session()
    session.photos = [b"not an image"]

    await _send_pdf(bot, 1, session)

    assert bot.documents == []
    assert bot.last_status.edits and "❌" in bot.last_status.edits[0]


@pytest.mark.asyncio
async def test_new_photo_restarts_timer_so_album_becomes_one_pdf():
    bot, session = FakeBot(), Session()

    session.photos.append(_png())
    _schedule_build(bot, 1, session, delay=0.05)
    await asyncio.sleep(0.02)

    session.photos.append(_png())
    _schedule_build(bot, 1, session, delay=0.05)
    await asyncio.sleep(0.15)

    assert len(bot.documents) == 1, "має бути рівно один PDF на альбом"
    assert "2" in bot.documents[0][1]


@pytest.mark.asyncio
async def test_cancel_timer_prevents_build():
    bot, session = FakeBot(), Session()
    session.photos.append(_png())

    _schedule_build(bot, 1, session, delay=0.05)
    session.cancel_timer()
    await asyncio.sleep(0.12)

    assert bot.documents == []
    assert session.photos
