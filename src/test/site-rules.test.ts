import { describe, expect, it } from "vitest";
import { SITE_RULES, SITE_RULES_LAST_UPDATED } from "@/data/site-rules";

describe("YUME site rules", () => {
  it("contains 14 independently collapsible sections", () => {
    expect(SITE_RULES).toHaveLength(14);
    expect(SITE_RULES.map((section) => section.title)).toEqual([
      "Общие положения",
      "Возможности Сайта",
      "Регистрация и авторизация через Telegram",
      "Просмотр видеоматериалов и сторонние плееры",
      "Правила поведения пользователей",
      "Интеллектуальная собственность и обращения правообладателей",
      "Персональные данные и конфиденциальность",
      "Сторонние сервисы и внешние ссылки",
      "Доступность Сайта и технические ограничения",
      "Ограничение и прекращение доступа",
      "Ограничение ответственности",
      "Обращения в поддержку",
      "Изменение Правил",
      "Применимое законодательство и заключительные положения",
    ]);
  });

  it("keeps numbered clauses for every section and the agreed last-updated label", () => {
    expect(SITE_RULES_LAST_UPDATED).toBe("24 октября 2026 года");
    SITE_RULES.forEach((section, sectionIndex) => {
      expect(section.clauses.length).toBeGreaterThan(0);
      section.clauses.forEach((clause) => {
        expect(clause.startsWith(`${sectionIndex + 1}.`)).toBe(true);
      });
    });
  });
});
