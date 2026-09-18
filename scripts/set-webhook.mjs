#!/usr/bin/env node
/**
 * Прив'язує бота до задеплоєного сайту:
 *   BOT_TOKEN=... node scripts/set-webhook.mjs https://my-site.netlify.app
 *
 * Якщо задати WEBHOOK_SECRET, Telegram слатиме його заголовком, а функція
 * відкидатиме чужі запити.
 */

const token = process.env.BOT_TOKEN;
const secret = process.env.WEBHOOK_SECRET;
const site = process.argv[2];

if (!token || !site) {
  console.error(
    "Використання: BOT_TOKEN=... node scripts/set-webhook.mjs https://<site>.netlify.app",
  );
  process.exit(1);
}

const api = (method, payload) =>
  fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  }).then(async (response) => {
    const body = await response.json();
    if (!body.ok) throw new Error(`${method}: ${body.description}`);
    return body.result;
  });

const url = `${site.replace(/\/+$/, "")}/telegram`;

await api("setWebhook", {
  url,
  secret_token: secret || undefined,
  allowed_updates: ["message", "callback_query"],
  drop_pending_updates: true,
});

await api("setMyCommands", {
  commands: [
    { command: "start", description: "Що вміє бот" },
    { command: "done", description: "Скласти PDF" },
    { command: "cancel", description: "Викинути накидані фото" },
    { command: "mode", description: "A4 або розмір фото" },
    { command: "help", description: "Довідка" },
  ],
});

console.log(`Webhook встановлено: ${url}`);
