/* eslint-disable */

// @ts-nocheck

// noinspection JSUnusedGlobalSymbols

// This file is generated from the route files in src/routes.
// Keep it in sync with the route directory.

import { Route as rootRouteImport } from './routes/__root'
import { Route as IndexRouteImport } from './routes/index'
import { Route as AnimeAnimeIdRouteImport } from './routes/anime.$animeId'

const IndexRoute = IndexRouteImport.update({
  id: '/',
  path: '/',
  getParentRoute: () => rootRouteImport,
} as any)

const AnimeAnimeIdRoute = AnimeAnimeIdRouteImport.update({
  id: '/anime/$animeId',
  path: '/anime/$animeId',
  getParentRoute: () => rootRouteImport,
} as any)

export interface FileRoutesByFullPath {
  '/': typeof IndexRoute
  '/anime/$animeId': typeof AnimeAnimeIdRoute
}
export interface FileRoutesByTo {
  '/': typeof IndexRoute
  '/anime/$animeId': typeof AnimeAnimeIdRoute
}
export interface FileRoutesById {
  __root__: typeof rootRouteImport
  '/': typeof IndexRoute
  '/anime/$animeId': typeof AnimeAnimeIdRoute
}
export interface FileRouteTypes {
  fileRoutesByFullPath: FileRoutesByFullPath
  fullPaths: '/' | '/anime/$animeId'
  fileRoutesByTo: FileRoutesByTo
  to: '/' | '/anime/$animeId'
  id: '__root__' | '/' | '/anime/$animeId'
  fileRoutesById: FileRoutesById
}
export interface RootRouteChildren {
  IndexRoute: typeof IndexRoute
  AnimeAnimeIdRoute: typeof AnimeAnimeIdRoute
}
declare module '@tanstack/react-router' {
  interface FileRoutesByPath {
    '/': {
      id: '/'
      path: '/'
      fullPath: '/'
      preLoaderRoute: typeof IndexRouteImport
      parentRoute: typeof rootRouteImport
    }
    '/anime/$animeId': {
      id: '/anime/$animeId'
      path: '/anime/$animeId'
      fullPath: '/anime/$animeId'
      preLoaderRoute: typeof AnimeAnimeIdRouteImport
      parentRoute: typeof rootRouteImport
    }
  }
}

const rootRouteChildren: RootRouteChildren = {
  IndexRoute: IndexRoute,
  AnimeAnimeIdRoute: AnimeAnimeIdRoute,
}
export const routeTree = rootRouteImport
  ._addFileChildren(rootRouteChildren)
  ._addFileTypes<FileRouteTypes>()

import type { getRouter } from './router.tsx'
import type { startInstance } from './start.ts'
declare module '@tanstack/react-start' {
  interface Register {
    ssr: true
    router: Awaited<ReturnType<typeof getRouter>>
    config: Awaited<ReturnType<typeof startInstance.getOptions>>
  }
}
