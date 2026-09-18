/** Тонкий клієнт Telegram Bot API на fetch. */

import { toArrayBuffer } from "./bytes";

const API = "https://api.telegram.org";

export interface InlineKeyboard {
  inline_keyboard: { text: string; callback_data: string }[][];
}

export class TelegramApi {
  constructor(private readonly token: string) {}

  private async call<T>(method: string, payload: unknown): Promise<T> {
    const response = await fetch(`${API}/bot${this.token}/${method}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    const body = (await response.json()) as
      | { ok: true; result: T }
      | { ok: false; description?: string };

    if (!body.ok) {
      throw new Error(`${method}: ${body.description ?? response.status}`);
    }
    return body.result;
  }

  sendMessage(
    chatId: number,
    text: string,
    replyMarkup?: InlineKeyboard,
  ): Promise<{ message_id: number }> {
    return this.call("sendMessage", {
      chat_id: chatId,
      text,
      parse_mode: "HTML",
      reply_markup: replyMarkup,
    });
  }

  async editMessageText(
    chatId: number,
    messageId: number,
    text: string,
    replyMarkup?: InlineKeyboard,
  ): Promise<void> {
    try {
      await this.call("editMessageText", {
        chat_id: chatId,
        message_id: messageId,
        text,
        parse_mode: "HTML",
        reply_markup: replyMarkup,
      });
    } catch {
      // Повідомлення могли видалити або текст не змінився — це не помилка.
    }
  }

  async deleteMessage(chatId: number, messageId: number): Promise<void> {
    try {
      await this.call("deleteMessage", {
        chat_id: chatId,
        message_id: messageId,
      });
    } catch {
      // Видалити чуже/старе повідомлення не завжди можна.
    }
  }

  async answerCallbackQuery(id: string, text?: string): Promise<void> {
    try {
      await this.call("answerCallbackQuery", { callback_query_id: id, text });
    } catch {
      // Запит міг протухнути (Telegram дає на відповідь кілька секунд).
    }
  }

  /** Завантажує файл, який користувач надіслав боту. */
  async downloadFile(fileId: string): Promise<Uint8Array> {
    const file = await this.call<{ file_path?: string }>("getFile", {
      file_id: fileId,
    });
    if (!file.file_path) {
      throw new Error("Telegram не повернув шлях до файлу.");
    }
    const response = await fetch(
      `${API}/file/bot${this.token}/${file.file_path}`,
    );
    if (!response.ok) {
      throw new Error(`Не вдалося завантажити файл: ${response.status}`);
    }
    return new Uint8Array(await response.arrayBuffer());
  }

  async sendDocument(
    chatId: number,
    filename: string,
    data: Uint8Array,
    caption?: string,
  ): Promise<void> {
    const form = new FormData();
    form.set("chat_id", String(chatId));
    if (caption) form.set("caption", caption);
    form.set(
      "document",
      new Blob([toArrayBuffer(data)], { type: "application/pdf" }),
      filename,
    );

    const response = await fetch(`${API}/bot${this.token}/sendDocument`, {
      method: "POST",
      body: form,
    });
    const body = (await response.json()) as {
      ok: boolean;
      description?: string;
    };
    if (!body.ok) {
      throw new Error(`sendDocument: ${body.description ?? response.status}`);
    }
  }

  setMyCommands(
    commands: { command: string; description: string }[],
  ): Promise<unknown> {
    return this.call("setMyCommands", { commands });
  }
}
