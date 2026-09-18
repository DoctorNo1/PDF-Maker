import { readFileSync } from "node:fs";
import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";

import { A4_PORTRAIT, buildPdf, UnsupportedImageError } from "../src/pdf";

const wideJpg = new Uint8Array(readFileSync("tests/fixtures/wide.jpg"));
const tallJpg = new Uint8Array(readFileSync("tests/fixtures/tall.jpg"));
const widePng = new Uint8Array(readFileSync("tests/fixtures/wide.png"));

const pages = async (pdf: Uint8Array) =>
  (await PDFDocument.load(pdf)).getPages();

describe("buildPdf", () => {
  it("робить по сторінці на кожне фото", async () => {
    const pdf = await buildPdf([wideJpg, tallJpg, widePng]);
    expect(await pages(pdf)).toHaveLength(3);
  });

  it("у режимі a4 дає аркуш A4", async () => {
    const [page] = await pages(await buildPdf([tallJpg], "a4"));
    expect(page!.getWidth()).toBeCloseTo(A4_PORTRAIT[0], 1);
    expect(page!.getHeight()).toBeCloseTo(A4_PORTRAIT[1], 1);
  });

  it("горизонтальне фото кладе на альбомний аркуш", async () => {
    const [page] = await pages(await buildPdf([wideJpg], "a4"));
    expect(page!.getWidth()).toBeGreaterThan(page!.getHeight());
  });

  it("у режимі fit сторінка дорівнює розміру фото", async () => {
    const [page] = await pages(await buildPdf([widePng], "fit"));
    expect(page!.getWidth()).toBe(400);
    expect(page!.getHeight()).toBe(200);
  });

  it("приймає і JPEG, і PNG", async () => {
    expect(await pages(await buildPdf([widePng, wideJpg], "fit"))).toHaveLength(
      2,
    );
  });

  it("на невідомий формат кидає зрозумілу помилку", async () => {
    await expect(buildPdf([new Uint8Array([1, 2, 3, 4])])).rejects.toThrow(
      UnsupportedImageError,
    );
  });

  it("на порожній список кидає помилку", async () => {
    await expect(buildPdf([])).rejects.toThrow();
  });
});
