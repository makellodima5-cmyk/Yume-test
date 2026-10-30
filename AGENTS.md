<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->

- Anime data lives in src/data/anime.ts (mock) behind a typed `Anime` shape; components never fetch directly — swap the source module for real integrations later.
- YUME UI components live in src/components/yume/; the homepage switches views via local state in src/routes/index.tsx (prototype stage).
- При каждом изменении сайта обязательно обновляй версию в `package.json`, чтобы отображаемая пользователю версия сайта всегда была актуальной.
