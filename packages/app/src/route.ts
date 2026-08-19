import { Match as M, Option, pipe } from 'effect'
import * as Schema from 'effect/Schema'
import { Route } from 'foldkit'
import { literal, r } from 'foldkit/route'
import type { Url } from 'foldkit/url'

export const HomeRoute = r('Home')
export const SketchRoute = r('Sketch')
export const ArchivifyRoute = r('Archivify')
export const InterrogationRoute = r('Interrogation')
export const InterviewRoute = r('Interview')
export const SettingsRoute = r('Settings')
export const NotFoundRoute = r('NotFound', { path: Schema.String })

export const AppRoute = Schema.Union([
  HomeRoute,
  SketchRoute,
  ArchivifyRoute,
  InterrogationRoute,
  InterviewRoute,
  SettingsRoute,
  NotFoundRoute,
])
export type AppRoute = typeof AppRoute.Type

export const homeRouter = pipe(Route.root, Route.mapTo(HomeRoute))
export const sketchRouter = pipe(literal('sketch'), Route.mapTo(SketchRoute))
export const archivifyRouter = pipe(
  literal('archivify'),
  Route.mapTo(ArchivifyRoute),
)
export const interrogationRouter = pipe(
  literal('interrogation'),
  Route.mapTo(InterrogationRoute),
)
export const interviewRouter = pipe(
  literal('interview'),
  Route.mapTo(InterviewRoute),
)
export const settingsRouter = pipe(
  literal('settings'),
  Route.mapTo(SettingsRoute),
)

const routeParser = Route.oneOf(
  sketchRouter,
  archivifyRouter,
  interrogationRouter,
  interviewRouter,
  settingsRouter,
  homeRouter,
)

const parseUrl = Route.parseUrlWithFallback(
  routeParser,
  NotFoundRoute,
)

export const urlToAppRoute = (url: Url): AppRoute =>
  M.value(url.protocol).pipe(
    M.when('file:', () =>
      parseUrl({
        ...url,
        pathname: Option.getOrElse(url.hash, () => '/'),
        hash: Option.none(),
      }),
    ),
    M.orElse(() => parseUrl(url)),
  )

export const navigationHref = (protocol: string, routeUrl: string): string =>
  M.value(protocol).pipe(
    M.when('file:', () => `#${routeUrl}`),
    M.orElse(() => routeUrl),
  )
