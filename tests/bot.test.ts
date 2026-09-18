import { readFileSync } from "node:fs";
import { PDFDocument } from "pdf-lib";
import { beforeEach, describe, expect, it } from "vitest";

import { handleUpdate, HELP, type BotDeps, type TgUpdate } from "../src/bot";
import type { PageMode } from "../src/pdf";
import type { Session } from "../src/store";
import type { SessionStore } from "../src/store";
import type { TelegramApi } from "../src/telegram";

const jpg = new Uint8Array(readFileSync("tests/fixtures/wide.jpg"));
const png = new Uint8Array(readFileSync("tests/fixtures/wide.png"));

class FakeApi {
  sent: string[] = [];
  edits: { messageId: number; text: string }[] = [];
  deleted: number[] = [];
  documents: { filename: string; data: Uint8Array; caption?: string }[] = [];
  answered: string[] = [];
  files = new Map<string, Uint8Array>([
    ["photo-1", jpg],
    ["photo-2", jpg],
    ["doc-1", png],
  ]);
  private nextId = 100;

  async sendMessage(_chatId: number, text: string) {
    this.sent.push(text);
    return { message_id: this.nextId++ };
  }
  async editMessageText(_chatId: number, messageId: number, text: string) {
    this.edits.push({ messageId, text });
  }
  async deleteMessage(_chatId: number, messageId: number) {
    this.deleted.push(messageId);
  }
  async answerCallbackQuery(id: string) {
    this.answered.push(id);
  }
  async downloadFile(fileId: string) {
    const data = this.files.get(fileId);
    if (!data) throw new Error(`немає файлу ${fileId}`);
    return data;
  }
  async sendDocument(
    _chatId: number,
    filename: string,
    data: Uint8Array,
    caption?: string,
  ) {
    this.documents.push({ filename, data, caption });
  }
}

class FakeStore {
  photos = new Map<string, Uint8Array>();
  sessions = new Map<number, Session>();

  async addPhoto(chatId: number, messageId: number, data: Uint8Array) {
    this.photos.set(`${chatId}/${String(messageId).padStart(12, "0")}`, data);
  }
  async photoKeys(chatId: number) {
    return [...this.photos.keys()].filter((k) => k.startsWith(`${chatId}/`)).sort();
  }
  async countPhotos(chatId: number) {
    return (await this.photoKeys(chatId)).length;
  }
  async loadPhotos(chatId: number) {
    return (await this.photoKeys(chatId)).map((key) => this.photos.get(key)!);
  }
  async clearPhotos(chatId: number) {
    const keys = await this.photoKeys(chatId);
    keys.forEach((key) => this.photos.delete(key));
    return keys.length;
  }
  async getSession(chatId: number): Promise<Session> {
    return this.sessions.get(chatId) ?? { mode: "a4" as PageMode };
  }
  async setSession(chatId: number, session: Session) {
    this.sessions.set(chatId, session);
  }
  async updateSession(chatId: number, patch: Partial<Session>) {
    const session = { ...(await this.getSession(chatId)), ...patch };
    this.sessions.set(chatId, session);
    return session;
  }
}

const CHAT = 42;
let api: FakeApi;
let store: FakeStore;
let deps: BotDeps;

beforeEach(() => {
  api = new FakeApi();
  store = new FakeStore();
  deps = {
    api: api as unknown as TelegramApi,
    store: store as unknown as SessionStore,
    maxPhotos: 3,
  };
});

const photoUpdate = (messageId: number, fileId: string): TgUpdate => ({
  message: {
    message_id: messageId,
    chat: { id: CHAT },
    photo: [{ file_id: fileId }],
  },
});

const textUpdate = (text: string): TgUpdate => ({
  message: { message_id: 1, chat: { id: CHAT }, text },
});

const pressButton = (data: string): TgUpdate => ({
  callback_query: {
    id: "cb-1",
    data,
    message: { message_id: 100, chat: { id: CHAT } },
  },
});

describe("фото", () => {
  it("зберігається і показує лічильник з кнопкою", async () => {
    await handleUpdate(deps, photoUpdate(10, "photo-1"));

    expect(await store.countPhotos(CHAT)).toBe(1);
    expect(api.sent[0]).toContain("1");
    expect(store.sessions.get(CHAT)?.promptMessageId).toBe(100);
  });

  it("друге фото оновлює те саме повідомлення, а не шле нове", async () => {
    await handleUpdate(deps, photoUpdate(10, "photo-1"));
    await handleUpdate(deps, photoUpdate(11, "photo-2"));

    expect(api.sent).toHaveLength(1);
    expect(api.edits.at(-1)?.text).toContain("2");
  });

  it("надіслане файлом зображення теж приймається", async () => {
    await handleUpdate(deps, {
      message: {
        message_id: 12,
        chat: { id: CHAT },
        document: { file_id: "doc-1", mime_type: "image/png" },
      },
    });

    expect(await store.countPhotos(CHAT)).toBe(1);
  });

  it("понад ліміт не зберігається і користувач отримує попередження", async () => {
    for (const id of [10, 11, 12]) {
      await handleUpdate(deps, photoUpdate(id, "photo-1"));
    }
    await handleUpdate(deps, photoUpdate(13, "photo-2"));

    expect(await store.countPhotos(CHAT)).toBe(3);
    expect(api.sent.at(-1)).toContain("Ліміт 3");
  });
});

describe("складання PDF", () => {
  const twoPhotos = async () => {
    await handleUpdate(deps, photoUpdate(10, "photo-1"));
    await handleUpdate(deps, photoUpdate(11, "photo-2"));
  };

  it("кнопка «Зробити PDF» надсилає файл і чистить чергу", async () => {
    await twoPhotos();
    await handleUpdate(deps, pressButton("build"));

    expect(api.documents).toHaveLength(1);
    const { data, filename, caption } = api.documents[0]!;
    expect(filename).toMatch(/^photos_\d{8}_\d{6}\.pdf$/);
    expect(caption).toContain("2");
    expect((await PDFDocument.load(data)).getPageCount()).toBe(2);
    expect(await store.countPhotos(CHAT)).toBe(0);
    expect(api.answered).toEqual(["cb-1"]);
  });

  it("/done робить те саме", async () => {
    await twoPhotos();
    await handleUpdate(deps, textUpdate("/done"));

    expect(api.documents).toHaveLength(1);
  });

  it("порядок сторінок = порядок надсилання фото", async () => {
    await handleUpdate(deps, textUpdate("/mode")); // fit: сторінка = розмір фото
    await handleUpdate(deps, photoUpdate(11, "photo-1")); // jpg 800x600
    await handleUpdate(deps, photoUpdate(2, "doc-1")); // png 400x200

    // message_id 2 надіслане раніше за 11, тож png має стати першою сторінкою.
    expect(await store.photoKeys(CHAT)).toEqual([
      `${CHAT}/000000000002`,
      `${CHAT}/000000000011`,
    ]);

    await handleUpdate(deps, textUpdate("/done"));

    const doc = await PDFDocument.load(api.documents[0]!.data);
    expect(doc.getPageCount()).toBe(2);
    expect(doc.getPage(0).getWidth()).toBe(400);
    expect(doc.getPage(1).getWidth()).toBe(800);
  });

  it("/done без фото просить надіслати фото", async () => {
    await handleUpdate(deps, textUpdate("/done"));

    expect(api.documents).toHaveLength(0);
    expect(api.sent.at(-1)).toContain("хоча б одне фото");
  });

  it("на битому зображенні повідомляє про помилку і не губить чергу", async () => {
    api.files.set("photo-1", new Uint8Array([1, 2, 3, 4]));
    await handleUpdate(deps, photoUpdate(10, "photo-1"));
    await handleUpdate(deps, textUpdate("/done"));

    expect(api.documents).toHaveLength(0);
    expect(api.edits.at(-1)?.text).toContain("❌");
    expect(await store.countPhotos(CHAT)).toBe(1);
  });
});

describe("команди", () => {
  it("/help показує довідку", async () => {
    await handleUpdate(deps, textUpdate("/help"));
    expect(api.sent[0]).toBe(HELP);
  });

  it("/start працює і з суфіксом @username", async () => {
    await handleUpdate(deps, textUpdate("/start@pdf_maker_bot"));
    expect(api.sent[0]).toBe(HELP);
  });

  it("/cancel викидає накидані фото", async () => {
    await handleUpdate(deps, photoUpdate(10, "photo-1"));
    await handleUpdate(deps, textUpdate("/cancel"));

    expect(await store.countPhotos(CHAT)).toBe(0);
    expect(api.sent.at(-1)).toContain("1");
    expect(api.deleted).toContain(100);
  });

  it("/mode перемикає режим сторінки і він тримається", async () => {
    await handleUpdate(deps, textUpdate("/mode"));
    expect(store.sessions.get(CHAT)?.mode).toBe("fit");

    await handleUpdate(deps, photoUpdate(10, "doc-1"));
    await handleUpdate(deps, textUpdate("/done"));

    const doc = await PDFDocument.load(api.documents[0]!.data);
    expect(doc.getPage(0).getWidth()).toBe(400);
  });

  it("невідома команда не мовчить", async () => {
    await handleUpdate(deps, textUpdate("/whatever"));
    expect(api.sent[0]).toContain("Такої команди не знаю");
  });

  it("на текст відповідає підказкою", async () => {
    await handleUpdate(deps, textUpdate("привіт"));
    expect(api.sent[0]).toContain("фото");
  });
});
