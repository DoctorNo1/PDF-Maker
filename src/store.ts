/**
 * Стан бота в Netlify Blobs.
 *
 * Serverless-функція не пам'ятає нічого між викликами, тож фотографії
 * складаються в blob-сховище і лежать там до команди «Зробити PDF».
 */

import { getStore, type Store } from "@netlify/blobs";

import { toArrayBuffer } from "./bytes";
import type { PageMode } from "./pdf";

export interface Session {
  mode: PageMode;
  /** Повідомлення з лічильником і кнопкою «Зробити PDF». */
  promptMessageId?: number;
}

const DEFAULT_SESSION: Session = { mode: "a4" };

/** message_id росте в межах чату, тож ключі сортуються в порядку надсилання. */
function photoKey(chatId: number, messageId: number): string {
  return `${chatId}/${String(messageId).padStart(12, "0")}`;
}

export class SessionStore {
  constructor(
    private readonly photos: Store = getStore("pdf-maker-photos"),
    private readonly sessions: Store = getStore("pdf-maker-sessions"),
  ) {}

  async addPhoto(
    chatId: number,
    messageId: number,
    data: Uint8Array,
  ): Promise<void> {
    await this.photos.set(photoKey(chatId, messageId), toArrayBuffer(data));
  }

  async photoKeys(chatId: number): Promise<string[]> {
    const { blobs } = await this.photos.list({ prefix: `${chatId}/` });
    return blobs.map((blob) => blob.key).sort();
  }

  async countPhotos(chatId: number): Promise<number> {
    return (await this.photoKeys(chatId)).length;
  }

  async loadPhotos(chatId: number): Promise<Uint8Array[]> {
    const keys = await this.photoKeys(chatId);
    const buffers = await Promise.all(
      keys.map((key) => this.photos.get(key, { type: "arrayBuffer" })),
    );
    return buffers
      .filter((buffer): buffer is ArrayBuffer => buffer !== null)
      .map((buffer) => new Uint8Array(buffer));
  }

  /** Прибирає фото чату; повертає, скільки їх було. */
  async clearPhotos(chatId: number): Promise<number> {
    const keys = await this.photoKeys(chatId);
    await Promise.all(keys.map((key) => this.photos.delete(key)));
    return keys.length;
  }

  async getSession(chatId: number): Promise<Session> {
    const stored = (await this.sessions.get(String(chatId), {
      type: "json",
    })) as Session | null;
    return { ...DEFAULT_SESSION, ...(stored ?? {}) };
  }

  async setSession(chatId: number, session: Session): Promise<void> {
    await this.sessions.setJSON(String(chatId), session);
  }

  async updateSession(
    chatId: number,
    patch: Partial<Session>,
  ): Promise<Session> {
    const session = { ...(await this.getSession(chatId)), ...patch };
    await this.setSession(chatId, session);
    return session;
  }
}
