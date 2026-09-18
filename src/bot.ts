/** Обробка одного апдейта Telegram. Нічого не знає про Netlify — тому й тестується. */

import { buildPdf, UnsupportedImageError } from "./pdf";
import type { InlineKeyboard, TelegramApi } from "./telegram";
import type { SessionStore } from "./store";

export interface BotDeps {
  api: TelegramApi;
  store: SessionStore;
  maxPhotos: number;
}

interface TgFile {
  file_id: string;
  file_size?: number;
}

interface TgMessage {
  message_id: number;
  chat: { id: number };
  text?: string;
  photo?: TgFile[];
  document?: TgFile & { mime_type?: string };
}

export interface TgUpdate {
  message?: TgMessage;
  callback_query?: {
    id: string;
    data?: string;
    message?: { message_id: number; chat: { id: number } };
  };
}

export const HELP =
  "<b>PDF Maker</b>\n\n" +
  "Надішли мені фотографії — я складу їх в один PDF і поверну файл.\n" +
  "Коли всі фото на місці, тисни кнопку «Зробити PDF» або команду /done.\n\n" +
  "Команди:\n" +
  "/done — скласти PDF\n" +
  "/cancel — викинути накидані фото\n" +
  "/mode — сторінки A4 (за замовчуванням) або по розміру фото\n" +
  "/help — ця довідка";

export const COMMANDS = [
  { command: "start", description: "Що вміє бот" },
  { command: "done", description: "Скласти PDF" },
  { command: "cancel", description: "Викинути накидані фото" },
  { command: "mode", description: "A4 або розмір фото" },
  { command: "help", description: "Довідка" },
];

const KEYBOARD: InlineKeyboard = {
  inline_keyboard: [
    [{ text: "📄 Зробити PDF", callback_data: "build" }],
    [{ text: "🗑 Скинути", callback_data: "cancel" }],
  ],
};

function filename(): string {
  const [date, time] = new Date().toISOString().slice(0, 19).split("T");
  return `photos_${date!.replace(/-/g, "")}_${time!.replace(/:/g, "")}.pdf`;
}

function promptText(count: number): string {
  return `📸 Фото в черзі: <b>${count}</b>\nКоли все — тисни «Зробити PDF».`;
}

/** Показує (або оновлює) повідомлення з лічильником і кнопкою. */
async function showPrompt(
  { api, store }: BotDeps,
  chatId: number,
  promptMessageId: number | undefined,
  count: number,
): Promise<void> {
  const text = promptText(count);
  if (promptMessageId !== undefined) {
    await api.editMessageText(chatId, promptMessageId, text, KEYBOARD);
    return;
  }
  const sent = await api.sendMessage(chatId, text, KEYBOARD);
  await store.updateSession(chatId, { promptMessageId: sent.message_id });
}

async function handlePhoto(
  deps: BotDeps,
  message: TgMessage,
  file: TgFile,
): Promise<void> {
  const { api, store, maxPhotos } = deps;
  const chatId = message.chat.id;

  if ((await store.countPhotos(chatId)) >= maxPhotos) {
    await api.sendMessage(
      chatId,
      `⚠️ Ліміт ${maxPhotos} фото на один PDF. Склади поточний (/done) ` +
        "або скинь чергу (/cancel).",
    );
    return;
  }

  const data = await api.downloadFile(file.file_id);
  await store.addPhoto(chatId, message.message_id, data);

  const session = await store.getSession(chatId);
  await showPrompt(deps, chatId, session.promptMessageId, await store.countPhotos(chatId));
}

async function buildAndSend(deps: BotDeps, chatId: number): Promise<void> {
  const { api, store } = deps;
  const session = await store.getSession(chatId);
  const photos = await store.loadPhotos(chatId);

  if (photos.length === 0) {
    await api.sendMessage(chatId, "Спочатку надішли хоча б одне фото.");
    return;
  }

  const status = await api.sendMessage(
    chatId,
    `⚙️ Роблю PDF з ${photos.length} фото…`,
  );

  try {
    const pdf = await buildPdf(photos, session.mode);
    await api.sendDocument(
      chatId,
      filename(),
      pdf,
      `📄 Готово: ${photos.length} стор.`,
    );
  } catch (error) {
    const reason =
      error instanceof UnsupportedImageError
        ? error.message
        : "Спробуй ще раз.";
    await api.editMessageText(
      chatId,
      status.message_id,
      `❌ Не вдалося скласти PDF. ${reason}`,
    );
    return;
  }

  await api.deleteMessage(chatId, status.message_id);
  await clearChat(deps, chatId, session.promptMessageId);
}

async function clearChat(
  { api, store }: BotDeps,
  chatId: number,
  promptMessageId: number | undefined,
): Promise<number> {
  const count = await store.clearPhotos(chatId);
  if (promptMessageId !== undefined) {
    await api.deleteMessage(chatId, promptMessageId);
  }
  await store.updateSession(chatId, { promptMessageId: undefined });
  return count;
}

async function handleCommand(
  deps: BotDeps,
  message: TgMessage,
  command: string,
): Promise<void> {
  const { api, store } = deps;
  const chatId = message.chat.id;

  switch (command) {
    case "/start":
    case "/help":
      await api.sendMessage(chatId, HELP);
      return;

    case "/done":
      await buildAndSend(deps, chatId);
      return;

    case "/cancel": {
      const session = await store.getSession(chatId);
      const count = await clearChat(deps, chatId, session.promptMessageId);
      await api.sendMessage(
        chatId,
        count
          ? `🗑 Викинув ${count} фото. Можеш кидати нові.`
          : "Нема чого скасовувати — фото не накидано.",
      );
      return;
    }

    case "/mode": {
      const session = await store.getSession(chatId);
      const mode = session.mode === "a4" ? "fit" : "a4";
      await store.updateSession(chatId, { mode });
      await api.sendMessage(
        chatId,
        mode === "a4"
          ? "📐 Сторінки A4: фото вписуються в аркуш."
          : "🖼 Сторінка = розмір фото, без білих полів.",
      );
      return;
    }

    default:
      await api.sendMessage(chatId, "Такої команди не знаю. /help");
  }
}

export async function handleUpdate(
  deps: BotDeps,
  update: TgUpdate,
): Promise<void> {
  const { api, store } = deps;

  if (update.callback_query) {
    const query = update.callback_query;
    const chatId = query.message?.chat.id;
    await api.answerCallbackQuery(query.id);
    if (chatId === undefined) return;

    if (query.data === "build") {
      await buildAndSend(deps, chatId);
    } else if (query.data === "cancel") {
      const session = await store.getSession(chatId);
      const count = await clearChat(deps, chatId, session.promptMessageId);
      await api.sendMessage(chatId, `🗑 Викинув ${count} фото.`);
    }
    return;
  }

  const message = update.message;
  if (!message) return;

  const photo = message.photo?.at(-1);
  if (photo) {
    await handlePhoto(deps, message, photo);
    return;
  }

  // Фото, надіслані файлом (без стиснення).
  if (message.document?.mime_type?.startsWith("image/")) {
    await handlePhoto(deps, message, message.document);
    return;
  }

  const text = message.text?.trim();
  if (text?.startsWith("/")) {
    await handleCommand(deps, message, text.split(/[\s@]/)[0] ?? text);
    return;
  }

  await api.sendMessage(
    message.chat.id,
    "Я вмію тільки фото → PDF. Надішли фотографії 🙂",
  );
}
