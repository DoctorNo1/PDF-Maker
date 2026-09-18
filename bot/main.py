"""Точка входу: python -m bot.main"""

from __future__ import annotations

import asyncio
import logging

from aiogram import Bot, Dispatcher
from aiogram.client.default import DefaultBotProperties
from aiogram.enums import ParseMode
from aiogram.types import BotCommand

from .config import Config
from .handlers import router

COMMANDS = [
    BotCommand(command="start", description="Що вміє бот"),
    BotCommand(command="done", description="Скласти PDF зараз"),
    BotCommand(command="cancel", description="Викинути накидані фото"),
    BotCommand(command="mode", description="A4 або розмір фото"),
    BotCommand(command="help", description="Довідка"),
]


async def main() -> None:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    )
    config = Config.from_env()

    bot = Bot(
        token=config.token,
        default=DefaultBotProperties(parse_mode=ParseMode.HTML),
    )
    dispatcher = Dispatcher()
    dispatcher["config"] = config
    dispatcher.include_router(router)

    await bot.set_my_commands(COMMANDS)
    try:
        await dispatcher.start_polling(bot)
    finally:
        await bot.session.close()


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except (KeyboardInterrupt, SystemExit):
        pass
