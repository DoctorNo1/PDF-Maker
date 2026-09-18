import { PDFDocument, type PDFImage } from "pdf-lib";

export type PageMode = "a4" | "fit";

/** A4 у пунктах PDF (210 x 297 мм). */
export const A4_PORTRAIT: [number, number] = [595.28, 841.89];

function isJpeg(data: Uint8Array): boolean {
  return data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff;
}

function isPng(data: Uint8Array): boolean {
  return (
    data[0] === 0x89 && data[1] === 0x50 && data[2] === 0x4e && data[3] === 0x47
  );
}

export class UnsupportedImageError extends Error {
  constructor() {
    super("Підтримуються лише JPEG і PNG.");
    this.name = "UnsupportedImageError";
  }
}

async function embed(doc: PDFDocument, data: Uint8Array): Promise<PDFImage> {
  if (isJpeg(data)) return doc.embedJpg(data);
  if (isPng(data)) return doc.embedPng(data);
  throw new UnsupportedImageError();
}

/** Складає PDF, де кожне зображення — окрема сторінка. */
export async function buildPdf(
  images: Uint8Array[],
  mode: PageMode = "a4",
): Promise<Uint8Array> {
  if (images.length === 0) {
    throw new Error("Немає жодного зображення для PDF.");
  }

  const doc = await PDFDocument.create();
  doc.setTitle("PDF Maker");
  doc.setCreator("PDF Maker bot");

  for (const data of images) {
    const image = await embed(doc, data);

    if (mode === "fit") {
      const page = doc.addPage([image.width, image.height]);
      page.drawImage(image, {
        x: 0,
        y: 0,
        width: image.width,
        height: image.height,
      });
      continue;
    }

    // Аркуш A4, альбомний для горизонтальних фото; фото вписується по центру.
    const [short, long] = A4_PORTRAIT;
    const [pageWidth, pageHeight] =
      image.width > image.height ? [long, short] : [short, long];

    const scale = Math.min(pageWidth / image.width, pageHeight / image.height);
    const width = image.width * scale;
    const height = image.height * scale;

    const page = doc.addPage([pageWidth, pageHeight]);
    page.drawImage(image, {
      x: (pageWidth - width) / 2,
      y: (pageHeight - height) / 2,
      width,
      height,
    });
  }

  return doc.save();
}
