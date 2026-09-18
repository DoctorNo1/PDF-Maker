import io

from PIL import Image

from bot.pdf import A4_PORTRAIT, build_pdf


def _png(size, color="red", mode="RGB"):
    buffer = io.BytesIO()
    Image.new(mode, size, color).save(buffer, format="PNG")
    return buffer.getvalue()


def _pages(data: bytes):
    from pypdf import PdfReader

    return len(PdfReader(io.BytesIO(data)).pages)


def test_build_pdf_one_page_per_image():
    data = build_pdf([_png((400, 300)), _png((300, 400)), _png((100, 100))])
    assert data.startswith(b"%PDF")
    assert _pages(data) == 3


def test_a4_mode_pages_are_a4_sized():
    from pypdf import PdfReader

    reader = PdfReader(io.BytesIO(build_pdf([_png((800, 600))], mode="a4")))
    box = reader.pages[0].mediabox
    # Альбомна A4 ≈ 842 x 595 pt, з похибкою на округлення пікселів.
    assert abs(float(box.width) - 842) < 6
    assert abs(float(box.height) - 595) < 6


def test_fit_mode_keeps_image_proportions():
    from pypdf import PdfReader

    reader = PdfReader(io.BytesIO(build_pdf([_png((800, 400))], mode="fit")))
    box = reader.pages[0].mediabox
    assert abs(float(box.width) / float(box.height) - 2.0) < 0.01


def test_transparent_png_gets_white_background():
    data = build_pdf([_png((50, 50), color=(0, 0, 0, 0), mode="RGBA")], mode="fit")
    assert _pages(data) == 1


def test_a4_page_is_landscape_for_wide_photo():
    from pypdf import PdfReader

    reader = PdfReader(io.BytesIO(build_pdf([_png((1000, 200))])))
    box = reader.pages[0].mediabox
    assert float(box.width) > float(box.height)


def test_empty_input_raises():
    try:
        build_pdf([])
    except ValueError:
        return
    raise AssertionError("очікували ValueError")


def test_a4_constant_is_portrait():
    assert A4_PORTRAIT[0] < A4_PORTRAIT[1]
