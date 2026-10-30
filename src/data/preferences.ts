import { createContext, createElement, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { Anime } from "@/data/anime";

export type Language = "ru" | "en";
export type ThemePreference = "dark" | "light" | "system";

const LANGUAGE_KEY = "yume-language";
const THEME_KEY = "yume-theme";
const PREFERENCES_EVENT = "yume-preferences-changed";

const RU = {
  "nav.main": "Основная навигация",
  "nav.profileButton": "Профиль",
  "nav.home": "Главная",
  "nav.catalog": "Каталог",
  "nav.collections": "Подборки",
  "nav.profile": "Профиль",

  "hero.artAlt": "Ночной японский город с сакурой, пагодами, фонарями и героиней YUME",
  "hero.title": "Там, где заканчивается реальность, начинается YUME",
  "hero.description": "Открой двери в новые миры, где каждая история скрывает настоящее чудо.",
  "hero.random": "Случайное аниме",
  "hero.catalog": "Каталог",

  "search.apply": "Применить поиск",
  "search.placeholder": "Название или жанр...",
  "search.anime": "Поиск аниме",
  "search.clear": "Очистить поиск",

  "home.continue": "Продолжить просмотр",
  "home.popular": "Популярное",
  "home.newReleases": "Новинки",
  "home.newReleasesDescription": "Недавно вышедшие тайтлы с подтверждённой датой выхода.",
  "home.noNewReleases": "Пока нет недавно вышедших тайтлов с точной датой релиза.",
  "home.announcements": "Анонсы",
  "home.announcementsDescription": "Аниме, которые заявлены, но ещё не вышли.",
  "home.noAnnouncements": "Пока нет доступных анонсов.",
  "home.airing": "Сейчас выходит",
  "home.airingDescription": "Аниме-сериалы, которые выходят сейчас.",
  "home.noAiring": "Сейчас нет доступных онгоингов.",
  "home.minutesLeft": "мин. осталось",
  "home.collections": "Подборки",
  "home.dataUnavailable": "Каталог временно недоступен. Попробуй обновить страницу позже.",
  "home.retry": "Обновить страницу",
  "footer.seeAll": "Все",
  "footer.source": "YUME · каталог аниме",

  "catalog.title": "Каталог",
  "catalog.subtitle": "Найди историю под своё настроение",
  "catalog.loadedCount": "Загружено тайтлов:",
  "catalog.loading": "Загружаем каталог…",
  "catalog.loadError": "Каталог временно недоступен. Попробуйте ещё раз позже.",
  "catalog.search": "Поиск в каталоге",
  "catalog.found": "Найдено:",
  "catalog.sort": "Сортировка",
  "catalog.sortRating": "По рейтингу",
  "catalog.sortNewest": "Сначала новые",
  "catalog.sortOldest": "Сначала старые",
  "catalog.sortTitle": "По названию",
  "catalog.previous": "Назад",
  "catalog.next": "Далее",
  "catalog.pages": "Страницы каталога",
  "catalog.reset": "Сбросить",
  "catalog.results": "Результаты",
  "catalog.filterResults": "Результаты по фильтрам",
  "catalog.searching": "Ищем в каталоге…",
  "catalog.searchingTitle": "Поиск по каталогу…",
  "catalog.noResults": "Ничего не найдено. Измени запрос или сбрось фильтры.",
  "catalog.noResultsFormal": "Ничего не найдено. Попробуйте изменить запрос или фильтры.",

  "filters.open": "Открыть фильтры",
  "filters.dialogLabel": "Фильтры каталога",
  "filters.title": "Фильтры",
  "filters.genres": "Жанры",
  "filters.chooseGenres": "Выбрать жанры",
  "filters.status": "Статус",
  "filters.any": "Любой",
  "filters.type": "Тип",
  "filters.yearFrom": "Год от",
  "filters.yearTo": "Год до",
  "filters.yearExample": "Например, 2024",
  "filters.ratingFrom": "Рейтинг от",
  "filters.ageRating": "Возрастной рейтинг",
  "filters.unrestricted": "Без ограничений",
  "filters.show": "Показать",

  "collections.title": "Подборки",
  "collections.all": "Все подборки",
  "collections.empty": "В этом настроении пока не найдено тайтлов. Попробуй другую подборку.",
  "collection.countOne": "тайтл",
  "collection.countFew": "тайтла",
  "collection.countMany": "тайтлов",
  "collection.emptyPreview": "Подборка пока наполняется",
  "collection.c1.title": "Эпичные сражения",
  "collection.c1.subtitle": "Сильнейшие противостояния, магия и экшен",
  "collection.c2.title": "Романтика и тёплые истории",
  "collection.c2.subtitle": "Чувства, отношения и герои, за которых переживаешь",
  "collection.c3.title": "Мистика и сверхъестественное",
  "collection.c3.subtitle": "Тайны, духи и необъяснимые события",
  "collection.c4.title": "Киберпанк и мир будущего",
  "collection.c4.subtitle": "Технологии, антиутопии и новые миры",
  "collection.c5.title": "Путешествия и приключения",
  "collection.c5.subtitle": "Неизведанные миры и большие открытия",
  "collection.c6.title": "Уютный вечер",
  "collection.c6.subtitle": "Спокойные истории для отдыха и настроения",

  "anime.new": "Новинка",
  "anime.yearUnknown": "Год уточняется",
  "anime.releaseDate": "Дата выхода",
  "anime.nextEpisodeDate": "Следующая серия",
  "anime.episode": "Серия",
  "anime.notFound": "Аниме не найдено",
  "anime.notFoundApi": "Не удалось получить данные об этом аниме. Обнови страницу немного позже.",
  "anime.notFoundInfo": "Возможно, ссылка устарела или тайтл больше недоступен.",
  "anime.openCatalog": "Открыть каталог",
  "anime.backCatalog": "К каталогу",
  "anime.sectionLabel": "информация об аниме",
  "anime.series": "серий",
  "anime.episodesUnknown": "Количество серий уточняется",
  "anime.collapseDescription": "Свернуть описание",
  "anime.expandDescription": "Раскрыть описание",
  "anime.description": "Описание",
  "anime.watch": "Смотреть",
  "anime.watchTrailer": "Смотреть трейлер",
  "anime.videoPartial": "Частично доступно — трейлер найден, плеер для серий пока не подключён.",
  "anime.videoUnavailable": "Видео пока недоступно",
  "anime.trailerUnavailable": "Трейлер, который можно встроить, пока не найден.",
  "anime.trailerTitle": "Трейлер на YouTube",
  "anime.addFavorite": "В избранное",
  "anime.inFavorites": "В избранном",
  "anime.addWatchlist": "В мой список",
  "anime.inWatchlist": "В моём списке",
  "anime.savedLocally": "Избранное и мой список сохраняются на этом устройстве.",
  "anime.watchSection": "Видео",
  "anime.chooseSource": "Если трейлер есть на YouTube, он появится здесь. Плеер для серий пока не подключён.",
  "anime.demoInterface": "Демо-интерфейс",
  "anime.voice": "Озвучка",
  "anime.player": "Плеер",
  "anime.demoVoiceA": "Демо-озвучка A",
  "anime.demoVoiceB": "Демо-озвучка B",
  "anime.demoSourceA": "Демо-источник A",
  "anime.demoSourceB": "Демо-источник B",
  "anime.playerNotConnected": "Плеер для серий пока не подключён",
  "anime.playerPlaceholder": "Когда источник серий будет подключён, здесь появится просмотр эпизодов. Сейчас доступность зависит от наличия встроенного трейлера.",
  "anime.similar": "Похожие аниме",
  "anime.similarSubtitle": "Истории в похожем настроении",

  "source.errorBanner": "Каталог временно недоступен. Попробуй обновить страницу позже.",
  "source.searchError": "Не удалось выполнить поиск в каталоге.",
  "source.catalogUnavailable": "Каталог временно недоступен.",

  "profile.title": "Мой профиль",
  "profile.space": "Личное пространство",
  "profile.subtitle": "Твоя коллекция и настройки YUME",
  "profile.favorites": "Избранное",
  "profile.favoritesCount": "В избранном",
  "profile.watchlist": "Мой список",
  "profile.watchlistCount": "В моём списке",
  "profile.watchlistDescription": "Аниме, которые хочешь посмотреть",
  "profile.watchlistSubtitle": "Аниме, которые ты сохранил на потом",
  "profile.settings": "Настройки",
  "profile.settingsDescription": "Внешний вид и предпочтения",
  "profile.legal": "Правовая информация",
  "profile.legalDescription": "Политика конфиденциальности, правила сайта и авторские права",
  "profile.about": "О YUME",
  "profile.aboutDescription": "О проекте и версии сайта",
  "profile.support": "Поддержка",
  "profile.supportDescription": "Помощь и сообщения о проблемах",
  "profile.all": "Все",
  "profile.empty": "Пока здесь пусто",
  "profile.emptyFavorites": "Добавляй любимые тайтлы в избранное на странице аниме.",
  "profile.catalog": "Каталог",
  "profile.goCatalog": "Перейти в каталог",
  "profile.back": "В профиль",
  "profile.backLegal": "Правовая информация",
  "profile.documents": "Правовая информация",
  "profile.privacy": "Политика конфиденциальности",
  "profile.privacyDescription": "Как обрабатываются данные пользователя",
  "profile.rules": "Правила использования сайта",
  "profile.rulesDescription": "Правила пользования сервисом",
  "profile.rights": "Информация для правообладателей",
  "profile.rightsDescription": "Обращения по вопросам прав на контент",
  "profile.privacyPlaceholder": "Здесь будет опубликована информация о том, какие данные обрабатывает YUME, для каких целей и как пользователь сможет управлять ими.",
  "profile.rulesPlaceholder": "Здесь будут изложены правила пользования YUME, ограничения и обязанности пользователей.",
  "profile.rightsPlaceholder": "Здесь появится информация для правообладателей и порядок обращения по вопросам контента и авторских прав.",
  "profile.documentComing": "Текст документа будет подготовлен и проверен перед полноценным запуском сайта.",
  "profile.aboutHeading": "YUME — больше чем аниме",
  "profile.aboutText": "Каталог и личное пространство для любителей аниме.",
  "profile.version": "Версия сайта",
  "profile.testBuild": "Тестовая сборка",
  "profile.animeSource": "Источник сведений об аниме",
  "profile.projectState": "Состояние проекта",
  "profile.inDevelopment": "В разработке",
  "profile.supportComing": "Раздел поддержки готовится",
  "profile.supportText": "Здесь появится способ сообщить о проблеме, задать вопрос или отправить предложение по улучшению YUME.",
  "profile.emptyFavoritesTitle": "Избранное пока пусто",
  "profile.emptyFavoritesDescription": "Открывай страницы аниме и добавляй туда любимые тайтлы — они появятся здесь.",
  "profile.localLibraryNotice": "Избранное и «Мой список» хранятся только в этом браузере на этом устройстве и не синхронизируются между устройствами.",
  "profile.savedItemsLoading": "Загружаем сохранённые тайтлы…",
  "profile.savedItemsError": "Не удалось загрузить часть сохранённых тайтлов. Проверь подключение и обнови страницу.",
  "profile.savedItemsUnavailable": "Некоторые сохранённые тайтлы больше недоступны в текущем каталоге.",
  "profile.emptyWatchlistTitle": "Мой список пока пуст",
  "profile.emptyWatchlistDescription": "Добавляй в список аниме, которые хочешь посмотреть позже.",

  "settings.appearance": "Внешний вид",
  "settings.appearanceDescription": "Настрой оформление YUME под себя",
  "settings.theme": "Тема оформления",
  "settings.themeDescription": "Выбери тёмную или светлую тему либо используй настройки устройства",
  "settings.dark": "Тёмная",
  "settings.light": "Светлая",
  "settings.system": "Как на устройстве",
  "settings.systemDescription": "В системном режиме YUME следует светлой или тёмной теме устройства",
  "settings.language": "Язык интерфейса",
  "settings.languageDescription": "Названия аниме показываются на выбранном языке, если он доступен. Описание остаётся на русском.",
  "settings.russian": "Русский",
  "settings.english": "English",
  "settings.savedOnDevice": "Тема и язык сохраняются в этом браузере на устройстве.",
  "settings.preferences": "Предпочтения аниме",
  "settings.preferencesDescription": "В будущем здесь можно будет выбрать жанры и другие предпочтения для персональных рекомендаций.",
  "settings.comingWithRecommendations": "Настройки предпочтений появятся вместе с разделом рекомендаций.",
  "settings.preferredGenres": "Любимые жанры",
  "settings.preferredGenresDescription": "Выбери жанры, которые тебе интересны. Выбор сохранится на этом устройстве.",
  "settings.noPreferredGenres": "Пока жанры не выбраны. Можно оставить список пустым.",
  "settings.clearGenres": "Сбросить выбор",
  "settings.genresSaved": "Предпочтения сохранены на этом устройстве.",
  "settings.genreCount": "Выбрано жанров:",
  "history.title": "История просмотров",
  "history.empty": "Здесь появятся аниме, которые вы начали, но ещё не досмотрели. После подключения плеера YUME сможет сохранять просмотренные серии и место остановки. Пока история не сохраняет прогресс.",

} as const;

export type TranslationKey = keyof typeof RU;

const EN: Record<TranslationKey, string> = {
  "nav.main": "Main navigation",
  "nav.profileButton": "Profile",
  "nav.home": "Home",
  "nav.catalog": "Catalog",
  "nav.collections": "Collections",
  "nav.profile": "Profile",

  "hero.artAlt": "A Japanese city at night with cherry blossoms, pagodas, lanterns and the YUME heroine",
  "hero.title": "Where Reality Ends, YUME Begins",
  "hero.description": "Open the door to new worlds, where every story hides a real wonder.",
  "hero.random": "Random anime",
  "hero.catalog": "Catalog",

  "search.apply": "Apply search",
  "search.placeholder": "Title or genre...",
  "search.anime": "Search anime",
  "search.clear": "Clear search",

  "home.continue": "Continue watching",
  "home.popular": "Popular",
  "home.newReleases": "New releases",
  "home.newReleasesDescription": "Recently released titles with a confirmed release date.",
  "home.noNewReleases": "No recently released titles with an exact release date are available yet.",
  "home.announcements": "Announcements",
  "home.announcementsDescription": "Anime that have been announced but have not aired yet.",
  "home.noAnnouncements": "No announced anime are available yet.",
  "home.airing": "Currently airing",
  "home.airingDescription": "Anime series that are airing now.",
  "home.noAiring": "No currently airing anime are available.",
  "home.minutesLeft": "min left",
  "home.collections": "Collections",
  "home.dataUnavailable": "The catalog is temporarily unavailable. Please try again later.",
  "home.retry": "Refresh page",
  "footer.seeAll": "See all",
  "footer.source": "YUME · anime catalog",

  "catalog.title": "Catalog",
  "catalog.subtitle": "Find a story to match your mood",
  "catalog.loadedCount": "Titles loaded:",
  "catalog.loading": "Loading catalog…",
  "catalog.loadError": "The catalog is temporarily unavailable. Please try again later.",
  "catalog.search": "Search the catalog",
  "catalog.found": "Found:",
  "catalog.sort": "Sort",
  "catalog.sortRating": "By rating",
  "catalog.sortNewest": "Newest first",
  "catalog.sortOldest": "Oldest first",
  "catalog.sortTitle": "By title",
  "catalog.previous": "Previous",
  "catalog.next": "Next",
  "catalog.pages": "Catalog pages",
  "catalog.reset": "Reset",
  "catalog.results": "Results",
  "catalog.filterResults": "Filtered results",
  "catalog.searching": "Searching the catalog…",
  "catalog.searchingTitle": "Searching the catalog…",
  "catalog.noResults": "Nothing found. Change your search or reset the filters.",
  "catalog.noResultsFormal": "Nothing was found. Try changing your query or filters.",

  "filters.open": "Open filters",
  "filters.dialogLabel": "Catalog filters",
  "filters.title": "Filters",
  "filters.genres": "Genres",
  "filters.chooseGenres": "Choose genres",
  "filters.status": "Status",
  "filters.any": "Any",
  "filters.type": "Type",
  "filters.yearFrom": "Year from",
  "filters.yearTo": "Year to",
  "filters.yearExample": "e.g. 2024",
  "filters.ratingFrom": "Rating from",
  "filters.ageRating": "Age rating",
  "filters.unrestricted": "Unrestricted",
  "filters.show": "Show",

  "collections.title": "Collections",
  "collections.all": "All collections",
  "collections.empty": "No titles match this mood yet. Try another collection.",
  "collection.countOne": "title",
  "collection.countFew": "titles",
  "collection.countMany": "titles",
  "collection.emptyPreview": "This collection is still being curated",
  "collection.c1.title": "Epic battles",
  "collection.c1.subtitle": "Powerful clashes, magic and action",
  "collection.c2.title": "Romance & heartwarming stories",
  "collection.c2.subtitle": "Feelings, relationships and characters to root for",
  "collection.c3.title": "Mystery & supernatural",
  "collection.c3.subtitle": "Secrets, spirits and unexplained events",
  "collection.c4.title": "Cyberpunk & the future",
  "collection.c4.subtitle": "Technology, dystopias and new worlds",
  "collection.c5.title": "Journeys & adventures",
  "collection.c5.subtitle": "Unknown worlds and great discoveries",
  "collection.c6.title": "A cozy evening",
  "collection.c6.subtitle": "Calm stories to relax and unwind",

  "anime.new": "New",
  "anime.yearUnknown": "Year unknown",
  "anime.releaseDate": "Release date",
  "anime.nextEpisodeDate": "Next episode",
  "anime.episode": "Episode",
  "anime.notFound": "Anime not found",
  "anime.notFoundApi": "Could not load this anime's information. Please try again later.",
  "anime.notFoundInfo": "The link may be outdated or the title is no longer available.",
  "anime.openCatalog": "Open catalog",
  "anime.backCatalog": "Back to catalog",
  "anime.sectionLabel": "anime information",
  "anime.series": "episodes",
  "anime.episodesUnknown": "Episode count unknown",
  "anime.collapseDescription": "Collapse description",
  "anime.expandDescription": "Expand description",
  "anime.description": "Description",
  "anime.watch": "Watch",
  "anime.watchTrailer": "Watch trailer",
  "anime.videoPartial": "Partially available — a trailer was found, but the episode player is not connected yet.",
  "anime.videoUnavailable": "Video is not available yet",
  "anime.trailerUnavailable": "No embeddable trailer has been found yet.",
  "anime.trailerTitle": "YouTube trailer",
  "anime.addFavorite": "Add to favorites",
  "anime.inFavorites": "In favorites",
  "anime.addWatchlist": "Add to my list",
  "anime.inWatchlist": "In my list",
  "anime.savedLocally": "Favorites and My List are saved on this device.",
  "anime.watchSection": "Video",
  "anime.chooseSource": "If a YouTube trailer is available, it will appear here. The episode player is not connected yet.",
  "anime.demoInterface": "Demo interface",
  "anime.voice": "Voice-over",
  "anime.player": "Player",
  "anime.demoVoiceA": "Demo voice-over A",
  "anime.demoVoiceB": "Demo voice-over B",
  "anime.demoSourceA": "Demo source A",
  "anime.demoSourceB": "Demo source B",
  "anime.playerNotConnected": "Episode player is not connected yet",
  "anime.playerPlaceholder": "Episodes will appear here once a source is connected. For now, availability depends on whether an embeddable trailer exists.",
  "anime.similar": "Similar anime",
  "anime.similarSubtitle": "Stories with a similar feel",

  "source.errorBanner": "The catalog is temporarily unavailable. Please try again later.",
  "source.searchError": "Catalog search failed.",
  "source.catalogUnavailable": "The catalog is temporarily unavailable.",

  "profile.title": "My profile",
  "profile.space": "Personal space",
  "profile.subtitle": "Your YUME collection and settings",
  "profile.favorites": "Favorites",
  "profile.favoritesCount": "Favorites",
  "profile.watchlist": "My List",
  "profile.watchlistCount": "In My List",
  "profile.watchlistDescription": "Anime you want to watch",
  "profile.watchlistSubtitle": "Anime you saved to watch later",
  "profile.settings": "Settings",
  "profile.settingsDescription": "Appearance and preferences",
  "profile.legal": "Legal information",
  "profile.legalDescription": "Privacy policy, site rules and copyright",
  "profile.about": "About YUME",
  "profile.aboutDescription": "Project information and site version",
  "profile.support": "Support",
  "profile.supportDescription": "Help and problem reports",
  "profile.all": "All",
  "profile.empty": "Nothing here yet",
  "profile.emptyFavorites": "Add your favorite titles to favorites from an anime page.",
  "profile.catalog": "Catalog",
  "profile.goCatalog": "Go to catalog",
  "profile.back": "Back to profile",
  "profile.backLegal": "Legal information",
  "profile.documents": "Legal information",
  "profile.privacy": "Privacy policy",
  "profile.privacyDescription": "How user data is processed",
  "profile.rules": "Terms of use",
  "profile.rulesDescription": "Rules for using the service",
  "profile.rights": "Copyright holders",
  "profile.rightsDescription": "Contact about content rights",
  "profile.privacyPlaceholder": "This page will explain what data YUME processes, why it is used, and how users can manage it.",
  "profile.rulesPlaceholder": "This page will describe the rules for using YUME, as well as user restrictions and responsibilities.",
  "profile.rightsPlaceholder": "This page will provide information for copyright holders and how to contact us about content and rights.",
  "profile.documentComing": "The document text will be prepared and reviewed before the full website launch.",
  "profile.aboutHeading": "YUME — more than anime",
  "profile.aboutText": "An anime catalog and personal space for anime fans.",
  "profile.version": "Site version",
  "profile.testBuild": "Test build",
  "profile.animeSource": "Anime data source",
  "profile.projectState": "Project status",
  "profile.inDevelopment": "In development",
  "profile.supportComing": "Support is coming soon",
  "profile.supportText": "Here you'll be able to report a problem, ask a question or suggest an improvement to YUME.",
  "profile.emptyFavoritesTitle": "Your favorites are empty",
  "profile.emptyFavoritesDescription": "Open anime pages and add titles you love to favorites. They'll appear here.",
  "profile.localLibraryNotice": "Favorites and My List are stored only in this browser on this device and are not synced across devices.",
  "profile.savedItemsLoading": "Loading saved titles…",
  "profile.savedItemsError": "Some saved titles could not be loaded. Check your connection and refresh the page.",
  "profile.savedItemsUnavailable": "Some saved titles are no longer available in the current catalog.",
  "profile.emptyWatchlistTitle": "Your list is empty",
  "profile.emptyWatchlistDescription": "Add anime here to watch them later.",

  "settings.appearance": "Appearance",
  "settings.appearanceDescription": "Customize the look of YUME",
  "settings.theme": "Theme",
  "settings.themeDescription": "Choose dark or light mode, or follow your device settings",
  "settings.dark": "Dark",
  "settings.light": "Light",
  "settings.system": "Use device setting",
  "settings.systemDescription": "In system mode, YUME follows your device's light or dark appearance",
  "settings.language": "Interface language",
  "settings.languageDescription": "Anime titles use the selected language when available. Descriptions remain in Russian.",
  "settings.russian": "Русский",
  "settings.english": "English",
  "settings.savedOnDevice": "Theme and language are saved in this browser on this device.",
  "settings.preferences": "Anime preferences",
  "settings.preferencesDescription": "In the future, you will be able to choose genres and other preferences for personalized recommendations.",
  "settings.comingWithRecommendations": "These preferences are saved locally. Personalized recommendations will use them once that feature is available.",
  "settings.preferredGenres": "Preferred genres",
  "settings.preferredGenresDescription": "Choose the genres you are interested in. Your selection is saved on this device.",
  "settings.noPreferredGenres": "No genres selected yet. You can leave the list empty.",
  "settings.clearGenres": "Clear selection",
  "settings.genresSaved": "Preferences are saved on this device.",
  "settings.genreCount": "Selected genres:",
  "history.title": "Watch history",
  "history.empty": "Anime you started but have not finished will appear here. Once the episode player is available, YUME can save watched episodes and where you stopped. Progress is not saved yet.",
};

const TRANSLATIONS: Record<Language, Record<TranslationKey, string>> = {
  ru: RU,
  en: EN,
};

function getStoredLanguage(): Language {
  if (typeof window === "undefined") return "ru";
  return window.localStorage.getItem(LANGUAGE_KEY) === "en" ? "en" : "ru";
}

function getStoredTheme(): ThemePreference {
  if (typeof window === "undefined") return "dark";
  const stored = window.localStorage.getItem(THEME_KEY);
  return stored === "light" || stored === "system" ? stored : "dark";
}

function resolvedTheme(theme: ThemePreference): "dark" | "light" {
  if (theme !== "system" || typeof window === "undefined") return theme === "light" ? "light" : "dark";
  return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

function applyTheme(theme: ThemePreference) {
  if (typeof document === "undefined") return;
  const resolved = resolvedTheme(theme);
  document.documentElement.dataset.theme = resolved;
  document.documentElement.style.colorScheme = resolved;
  document.documentElement.classList.toggle("dark", resolved === "dark");
}

function publishPreferenceChange() {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(PREFERENCES_EVENT));
  }
}

type YumePreferencesValue = {
  language: Language;
  setLanguage: (language: Language) => void;
  theme: ThemePreference;
  setTheme: (theme: ThemePreference) => void;
  t: (key: TranslationKey) => string;
};

const YumePreferencesContext = createContext<YumePreferencesValue | null>(null);

export function YumePreferencesProvider({ children }: { children: ReactNode }) {
  const [language, setLanguageState] = useState<Language>("ru");
  const [theme, setThemeState] = useState<ThemePreference>("dark");

  useEffect(() => {
    const sync = () => {
      const nextLanguage = getStoredLanguage();
      const nextTheme = getStoredTheme();
      setLanguageState(nextLanguage);
      setThemeState(nextTheme);
      applyTheme(nextTheme);
      document.documentElement.lang = nextLanguage;
    };
    sync();
    window.addEventListener(PREFERENCES_EVENT, sync);
    window.addEventListener("storage", sync);
    const media = window.matchMedia("(prefers-color-scheme: light)");
    const onSystemThemeChanged = () => {
      if (getStoredTheme() === "system") applyTheme("system");
    };
    media.addEventListener("change", onSystemThemeChanged);
    return () => {
      window.removeEventListener(PREFERENCES_EVENT, sync);
      window.removeEventListener("storage", sync);
      media.removeEventListener("change", onSystemThemeChanged);
    };
  }, []);

  const setLanguage = useCallback((next: Language) => {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(LANGUAGE_KEY, next);
      document.documentElement.lang = next;
    }
    setLanguageState(next);
    publishPreferenceChange();
  }, []);

  const setTheme = useCallback((next: ThemePreference) => {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(THEME_KEY, next);
      applyTheme(next);
    }
    setThemeState(next);
    publishPreferenceChange();
  }, []);

  const t = useCallback(
    (key: TranslationKey): string => TRANSLATIONS[language][key] ?? TRANSLATIONS.ru[key] ?? key,
    [language],
  );

  const value = useMemo(
    () => ({ language, setLanguage, theme, setTheme, t }),
    [language, setLanguage, theme, setTheme, t],
  );

  return createElement(YumePreferencesContext.Provider, { value }, children);
}

export function useYumePreferences(): YumePreferencesValue {
  const context = useContext(YumePreferencesContext);
  if (!context) {
    throw new Error("useYumePreferences must be used inside YumePreferencesProvider");
  }
  return context;
}

export function displayAnimeTitle(anime: Anime, language: Language): string {
  if (language === "en") {
    return anime.englishTitle?.trim() || anime.original?.trim() || anime.title;
  }
  return anime.title;
}

const GENRES_EN: Record<string, string> = {
  "Экшен": "Action",
  "Приключения": "Adventure",
  "Комедия": "Comedy",
  "Драма": "Drama",
  "Фэнтези": "Fantasy",
  "Романтика": "Romance",
  "Повседневность": "Slice of Life",
  "Мистика": "Mystery",
  "Сверхъестественное": "Supernatural",
  "Научная фантастика": "Sci-Fi",
  "Киберпанк": "Cyberpunk",
  "Триллер": "Thriller",
  "Исторический": "Historical",
  "Музыка": "Music",
  "Меха": "Mecha",
  "Спорт": "Sports",
  "Детектив": "Detective",
  "Ужасы": "Horror",
  "Боевые искусства": "Martial Arts",
  "Военное": "Military",
  "Психологическое": "Psychological",
  "Сэйнэн": "Seinen",
  "Сёдзё": "Shoujo",
  "Сёнэн": "Shounen",
  "Дзёсэй": "Josei",
  "Работа": "Workplace",
  "Школа": "School",
  "Игры": "Game",
  "Исекай": "Isekai",
  "Этти": "Ecchi",
  "Гарем": "Harem",
  "Детское": "Kids",
  "Реверс-гарем": "Reverse Harem",
  "Пародия": "Parody",
  "Самураи": "Samurai",
  "Вампиры": "Vampires",
  "Демоны": "Demons",
  "Космос": "Space",
  "Супер сила": "Super Power",
  "Суперспособности": "Super Power",
  "Полиция": "Police",
  "Магия": "Magic",
  "Приключенческое": "Adventure",
  "Повседневная жизнь": "Slice of Life",
  "Мелодрама": "Romantic Drama",
  "Постапокалиптика": "Post-apocalyptic",
  "Роботы": "Robots",
  "Музыкальный": "Music",
  "Сказка": "Fairy Tale",
  "Триллер психологический": "Psychological Thriller",
  "Военная тематика": "Military",
  "Трагедия": "Tragedy",
  "Сёнэн-ай": "Boys' Love",
  "Сёдзё-ай": "Girls' Love",
  "Боевые искусства": "Martial Arts",
  "Кулинария": "Cooking",
  "Видеоигры": "Video Games",
  "Искусство": "Arts",
  "Взрослые персонажи": "Adult Cast",
  "Путешествие во времени": "Time Travel",
  "Детство": "Childhood",
  "Дружба": "Friendship",
  "Монстры": "Monsters",
  "Преступление": "Crime",
  "Выживание": "Survival",
  "Фантастика": "Science Fiction",
};
const STATUS_EN: Record<string, string> = {
  "Онгоинг": "Airing",
  "Вышел": "Released",
  "Анонс": "Upcoming",
  "Неизвестно": "Status unknown",
  "Любой": "Any",
};

const KIND_EN: Record<string, string> = {
  "Фильм": "Movie",
  "Сериал": "Series",
  "Спецвыпуск": "Special",
  "Спешл": "Special",
  "Музыкальное": "Music",
  "OVA": "OVA",
  "ONA": "ONA",
  "TV": "TV",
  "Музыкальное видео": "Music video",
};

export function displayGenre(genre: string, language: Language): string {
  return language === "en" ? GENRES_EN[genre] ?? genre : genre;
}

export function displayAnimeStatus(status: string, language: Language): string {
  return language === "en" ? STATUS_EN[status] ?? status : status;
}

export function displayAnimeKind(kind: string, language: Language): string {
  return language === "en" ? KIND_EN[kind] ?? kind : kind;
}
