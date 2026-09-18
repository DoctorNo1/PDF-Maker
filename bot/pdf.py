"""Складання PDF з набору зображень."""

from __future__ import annotations

import io
from typing import Iterable, Literal

from PIL import Image, ImageOps

PageMode = Literal["a4", "fit"]

DPI = 150
# A4 у пікселях при DPI вище (210 x 297 мм).
A4_PORTRAIT = (int(8.27 * DPI), int(11.69 * DPI))


def _normalize(data: bytes) -> Image.Image:
    """Відкриває зображення, застосовує EXIF-поворот і приводить до RGB."""
    image = Image.open(io.BytesIO(data))
    image = ImageOps.exif_transpose(image)
    if image.mode in ("RGBA", "LA", "P"):
        background = Image.new("RGB", image.size, "white")
        rgba = image.convert("RGBA")
        background.paste(rgba, mask=rgba.split()[-1])
        return background
    return image.convert("RGB")


def _to_a4_page(image: Image.Image) -> Image.Image:
    """Вписує зображення в аркуш A4 (альбомний для горизонтальних фото)."""
    page_w, page_h = A4_PORTRAIT
    if image.width > image.height:
        page_w, page_h = page_h, page_w

    fitted = ImageOps.contain(image, (page_w, page_h), Image.LANCZOS)
    page = Image.new("RGB", (page_w, page_h), "white")
    page.paste(
        fitted,
        ((page_w - fitted.width) // 2, (page_h - fitted.height) // 2),
    )
    return page


def build_pdf(images: Iterable[bytes], mode: PageMode = "a4") -> bytes:
    """Повертає байти PDF, де кожне зображення — окрема сторінка."""
    pages: list[Image.Image] = []
    for data in images:
        page = _normalize(data)
        if mode == "a4":
            page = _to_a4_page(page)
        pages.append(page)

    if not pages:
        raise ValueError("Немає жодного зображення для PDF.")

    buffer = io.BytesIO()
    first, rest = pages[0], pages[1:]
    first.save(
        buffer,
        format="PDF",
        save_all=True,
        append_images=rest,
        resolution=DPI,
    )
    for page in pages:
        page.close()
    return buffer.getvalue()
