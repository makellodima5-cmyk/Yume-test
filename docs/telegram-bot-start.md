# Telegram bot /start welcome message

The Cloudflare Worker exposes `POST /api/telegram/webhook`.

After deployment, register this URL with Telegram's `setWebhook` API:

`https://yume-website.yumesupport833.workers.dev/api/telegram/webhook`

Set `secret_token` in `setWebhook` to the same value as the Cloudflare Worker secret `TELEGRAM_WEBHOOK_SECRET`. Keep `TELEGRAM_BOT_TOKEN` and `TELEGRAM_WEBHOOK_SECRET` in Worker secrets; never commit them.

For subscription return handling, the bot must be an administrator of the channel and the webhook must explicitly subscribe to membership updates. Include `allowed_updates: ["message", "callback_query", "chat_member"]` in the `setWebhook` request. For example, using the Telegram Bot API:

```json
{
  "url": "https://yume-website.yumesupport833.workers.dev/api/telegram/webhook",
  "secret_token": "<TELEGRAM_WEBHOOK_SECRET>",
  "allowed_updates": ["message", "callback_query", "chat_member"]
}
```

When a user sends `/start`, the bot sends a Russian welcome message and an inline `🎬 Открыть YUME` button that opens the Mini App at the deployed site URL. Membership updates let the bot edit the existing gate message when a subscriber leaves and restore it after they rejoin. The webhook checks Telegram's `X-Telegram-Bot-Api-Secret-Token` header before processing updates.
