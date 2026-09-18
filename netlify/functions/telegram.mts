/** Webhook Telegram: POST /telegram */

import type { Config } from "@netlify/functions";

import { handleUpdate, type TgUpdate } from "../../src/bot";
import { SessionStore } from "../../src/store";
import { TelegramApi } from "../../src/telegram";

export default async (request: Request): Promise<Response> => {
  if (request.method !== "POST") {
    return new Response("PDF Maker bot is alive", { status: 200 });
  }

  const token = process.env.BOT_TOKEN;
  if (!token) {
    console.error("BOT_TOKEN не заданий у змінних оточення сайту");
    return new Response("misconfigured", { status: 500 });
  }

  const secret = process.env.WEBHOOK_SECRET;
  if (
    secret &&
    request.headers.get("x-telegram-bot-api-secret-token") !== secret
  ) {
    return new Response("forbidden", { status: 403 });
  }

  let update: TgUpdate;
  try {
    update = (await request.json()) as TgUpdate;
  } catch {
    return new Response("bad request", { status: 400 });
  }

  const deps = {
    api: new TelegramApi(token),
    store: new SessionStore(),
    maxPhotos: Number(process.env.MAX_PHOTOS ?? 20),
  };

  try {
    await handleUpdate(deps, update);
  } catch (error) {
    // Telegram повторює апдейт, на який не відповіли 200 — краще залогувати
    // і підтвердити, ніж ганяти те саме фото по колу.
    console.error("Помилка обробки апдейта:", error);
  }

  return new Response("ok", { status: 200 });
};

export const config: Config = { path: "/telegram" };
