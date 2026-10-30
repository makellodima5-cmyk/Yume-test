export type UserNotification = {
  id: string;
  publishedAt: string;
  title: { ru: string; en: string };
  description: { ru: string; en: string };
};

/**
 * Public, user-facing feature announcements only.
 * Add an entry when a user-visible feature ships; do not add admin-panel changelog items.
 * Keep IDs stable so each account/browser can remember which notices were read.
 */
export const USER_NOTIFICATIONS: readonly UserNotification[] = [
  {
    id: "notifications-center-v1",
    publishedAt: "2026-10-23T14:00:00.000Z",
    title: {
      ru: "В YUME появился центр уведомлений",
      en: "YUME now has a notifications center",
    },
    description: {
      ru: "Теперь в этом разделе будут появляться новости о новых возможностях и полезных функциях YUME. Красная точка на колокольчике показывает, когда есть непрочитанные уведомления. Нажми «Прочитать всё», чтобы отметить все сообщения как прочитанные.",
      en: "This section will share updates about new YUME features and useful improvements. The red dot on the bell indicates unread notifications. Choose “Mark all as read” to clear all unread messages at once.",
    },
  },
];
