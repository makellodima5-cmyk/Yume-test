import { matchesSearchQuery } from "@/data/search-text";

// Demo data. Later replaced by a Shikimori-backed source with the same shape.
export type Anime = {
  id: string;
  title: string;
  englishTitle?: string;
  original: string;
  year: number;
  episodes: number;
  rating: number | null;
  genres: string[];
  status: "Онгоинг" | "Вышел" | "Анонс" | "Неизвестно";
  description: string;
  hue: number; // poster gradient hue
  glyph: string; // kanji on poster
  isNew?: boolean;
  popular?: boolean;
  posterUrl?: string;
  bannerUrl?: string;
  kind?: string;
  ageRating?: string;
  nextEpisodeAt?: string;
  episodesAired?: number;
  airedOn?: string;
  studios?: string[];
  youtubeTrailerId?: string;
};

export const ANIME: Anime[] = [
  { id: "a1", title: "Лунный клинок", original: "Tsuki no Yaiba", year: 2026, episodes: 24, rating: 9.1, genres: ["Экшен", "Фэнтези"], status: "Онгоинг", description: "Юная мечница получает клинок, выкованный из лунного света, и узнаёт, что каждую ночь он требует новую клятву.", hue: 290, glyph: "月", popular: true, isNew: true },
  { id: "a2", title: "Сакура после дождя", original: "Ame no Ato no Sakura", year: 2025, episodes: 12, rating: 8.7, genres: ["Романтика", "Повседневность"], status: "Вышел", description: "Двое студентов встречаются под одним зонтом и решают провести вместе последний весенний месяц.", hue: 345, glyph: "桜", popular: true },
  { id: "a3", title: "Неоновый Токио 2099", original: "Neon Tokyo 2099", year: 2026, episodes: 13, rating: 8.9, genres: ["Киберпанк", "Экшен"], status: "Онгоинг", description: "Хакер-курьер оказывается втянут в войну корпораций за цифровые души горожан.", hue: 260, glyph: "電", popular: true, isNew: true },
  { id: "a4", title: "Хранитель храма", original: "Jinja no Mamori", year: 2024, episodes: 26, rating: 8.4, genres: ["Мистика", "Фэнтези"], status: "Вышел", description: "Последний хранитель заброшенного храма заключает союз с капризным лисьим духом.", hue: 20, glyph: "狐", popular: true },
  { id: "a5", title: "Звёздный оркестр", original: "Hoshi no Gakudan", year: 2026, episodes: 12, rating: 8.2, genres: ["Музыка", "Драма"], status: "Онгоинг", description: "Школьный оркестр из пяти человек мечтает выступить на фестивале под открытым небом.", hue: 220, glyph: "星", isNew: true },
  { id: "a6", title: "Тень сёгуна", original: "Shōgun no Kage", year: 2023, episodes: 24, rating: 9.0, genres: ["Исторический", "Экшен"], status: "Вышел", description: "Ниндзя-двойник сёгуна должен прожить чужую жизнь, чтобы спасти страну от раскола.", hue: 0, glyph: "影", popular: true },
  { id: "a7", title: "Кафе «Полночь»", original: "Mayonaka Café", year: 2026, episodes: 10, rating: 7.9, genres: ["Повседневность", "Комедия"], status: "Онгоинг", description: "Маленькое кафе открывается только после полуночи — и только для тех, кто заблудился.", hue: 40, glyph: "茶", isNew: true },
  { id: "a8", title: "Последний дракон Эдо", original: "Edo no Ryū", year: 2025, episodes: 24, rating: 8.6, genres: ["Фэнтези", "Приключения"], status: "Вышел", description: "Мальчик из рыбацкой деревни находит яйцо последнего дракона старой столицы.", hue: 160, glyph: "龍", popular: true },
  { id: "a9", title: "Пилоты бездны", original: "Shin'en no Pilot", year: 2026, episodes: 12, rating: 8.3, genres: ["Меха", "Научная фантастика"], status: "Анонс", description: "Экипаж подводного меха исследует океан, под которым спит древний город.", hue: 200, glyph: "海", isNew: true },
  { id: "a10", title: "Призрачный класс", original: "Yūrei Kurasu", year: 2024, episodes: 12, rating: 7.8, genres: ["Комедия", "Мистика"], status: "Вышел", description: "Новенькая обнаруживает, что все её одноклассники — добрые призраки.", hue: 310, glyph: "霊" },
  { id: "a11", title: "Лепестки и сталь", original: "Hanabira to Hagane", year: 2026, episodes: 24, rating: 8.8, genres: ["Экшен", "Драма"], status: "Онгоинг", description: "Боевая академия, где оружие выбирает владельца по цвету его души.", hue: 330, glyph: "鋼", isNew: true, popular: true },
  { id: "a12", title: "Сны белой лисы", original: "Shiro Kitsune no Yume", year: 2025, episodes: 11, rating: 8.5, genres: ["Фэнтези", "Романтика"], status: "Вышел", description: "Белая лиса может видеть сны людей и однажды влюбляется в одного из сновидцев.", hue: 270, glyph: "夢" },
];

export const CONTINUE: { id: string; episode: number; progress: number; left: string }[] = [
  { id: "a1", episode: 7, progress: 62, left: "9 мин" },
  { id: "a3", episode: 3, progress: 28, left: "17 мин" },
  { id: "a8", episode: 15, progress: 85, left: "4 мин" },
  { id: "a2", episode: 11, progress: 45, left: "13 мин" },
];

export const COLLECTIONS = [
  {
    id: "c1",
    title: "Эпичные сражения",
    subtitle: "Сильнейшие противостояния, магия и экшен",
    genres: ["Экшен"],
    hue: 300,
  },
  {
    id: "c2",
    title: "Романтика и тёплые истории",
    subtitle: "Чувства, отношения и герои, за которых переживаешь",
    genres: ["Романтика"],
    hue: 345,
  },
  {
    id: "c3",
    title: "Мистика и сверхъестественное",
    subtitle: "Тайны, духи и необъяснимые события",
    genres: ["Мистика", "Сверхъестественное"],
    hue: 20,
  },
  {
    id: "c4",
    title: "Киберпанк и мир будущего",
    subtitle: "Технологии, антиутопии и новые миры",
    genres: ["Киберпанк", "Научная фантастика"],
    hue: 260,
  },
  {
    id: "c5",
    title: "Путешествия и приключения",
    subtitle: "Неизведанные миры и большие открытия",
    genres: ["Приключения"],
    hue: 160,
  },
  {
    id: "c6",
    title: "Уютный вечер",
    subtitle: "Спокойные истории для отдыха и настроения",
    genres: ["Повседневность"],
    hue: 285,
  },
];

export const SCHEDULE = [
  { day: "Понедельник", items: [{ id: "a1", time: "18:00", ep: 8 }] },
  { day: "Среда", items: [{ id: "a3", time: "20:30", ep: 4 }, { id: "a7", time: "23:59", ep: 6 }] },
  { day: "Пятница", items: [{ id: "a11", time: "19:00", ep: 12 }] },
  { day: "Суббота", items: [{ id: "a5", time: "15:00", ep: 9 }] },
];

export const byId = (id: string) => ANIME.find((a) => a.id === id)!;

export function filterAnime(list: Anime[], query: string, genre?: string | null) {
  return list.filter(
    (a) =>
      (!genre || a.genres.includes(genre)) &&
      matchesSearchQuery(query, [a.title, a.englishTitle ?? "", a.original, ...a.genres]),
  );
}

export const ALL_GENRES = Array.from(new Set(ANIME.flatMap((a) => a.genres))).sort();