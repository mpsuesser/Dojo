import { Effect, Match as M } from 'effect'
import * as Schema from 'effect/Schema'
import { Command, type Runtime } from 'foldkit'
import type { Document, Html, HtmlBuilder } from 'foldkit/html'
import { m } from 'foldkit/message'
import { UrlRequest, load, pushUrl } from 'foldkit/navigation'
import { evo } from 'foldkit/struct'
import { Url, toString as urlToString } from 'foldkit/url'

import dojoArtUrl from '../../../docs/generated-concept-art/01-the-dojo.png'
import sketchArtUrl from '../../../docs/generated-concept-art/02-hall-of-form.png'
import interrogationArtUrl from '../../../docs/generated-concept-art/03-hall-of-questions.png'
import interviewArtUrl from '../../../docs/generated-concept-art/04-hall-of-voices.png'
import settingsArtUrl from '../../../docs/generated-concept-art/06-inner-courtyard.png'
import {
  AppRoute,
  interrogationRouter,
  interviewRouter,
  navigationHref,
  settingsRouter,
  sketchRouter,
  urlToAppRoute,
} from './route.ts'

export const Model = Schema.Struct({
  route: AppRoute,
  protocol: Schema.String,
})
export type Model = typeof Model.Type

export const CompletedNavigateInternal = m('CompletedNavigateInternal')
export const CompletedLoadExternal = m('CompletedLoadExternal')
export const ClickedLink = m('ClickedLink', { request: UrlRequest })
export const ChangedUrl = m('ChangedUrl', { url: Url })

export const Message = Schema.Union([
  CompletedNavigateInternal,
  CompletedLoadExternal,
  ClickedLink,
  ChangedUrl,
])
export type Message = typeof Message.Type

export const init: Runtime.RoutingApplicationInit<Model, Message> = (url: Url) =>
  [{ route: urlToAppRoute(url), protocol: url.protocol }, []]

const NavigateInternal = Command.define('NavigateInternal', {
  args: { url: Schema.String },
  messages: [CompletedNavigateInternal],
  execute: ({ url }) =>
    pushUrl(url).pipe(Effect.as(CompletedNavigateInternal())),
})

const LoadExternal = Command.define('LoadExternal', {
  args: { href: Schema.String },
  messages: [CompletedLoadExternal],
  execute: ({ href }) => load(href).pipe(Effect.as(CompletedLoadExternal())),
})

type UpdateReturn = readonly [
  Model,
  ReadonlyArray<Command.Command<Message>>,
]

const withUpdateReturn = M.withReturnType<UpdateReturn>()

export const update = (model: Model, message: Message): UpdateReturn =>
  M.value(message).pipe(
    withUpdateReturn,
    M.tagsExhaustive({
      CompletedNavigateInternal: () => [model, []],
      CompletedLoadExternal: () => [model, []],
      ClickedLink: ({ request }) =>
        M.value(request).pipe(
          withUpdateReturn,
          M.tagsExhaustive({
            Internal: ({ url }) => [
              model,
              [NavigateInternal({ url: urlToString(url) })],
            ],
            External: ({ href }) => [model, [LoadExternal({ href })]],
          }),
        ),
      ChangedUrl: ({ url }) => [
        evo(model, {
          route: () => urlToAppRoute(url),
          protocol: () => url.protocol,
        }),
        [],
      ],
    }),
  )

const splashView = (
  imageUrl: string,
  description: string,
  testId: string,
  h: HtmlBuilder<Message>,
) =>
  h.main(
    [h.Class('splash-shell')],
    [
      h.img([
        h.Src(imageUrl),
        h.Alt(description),
        h.Class('splash-art'),
        h.Attribute('data-testid', testId),
      ]),
    ],
  )

const menuLink = (
  label: string,
  href: string,
  modifier: string,
  h: HtmlBuilder<Message>,
) =>
  h.a(
    [h.Href(href), h.Class(`menu-link ${modifier}`)],
    [h.span([h.Class('menu-link-label')], [label])],
  )

const homeView = (protocol: string, h: HtmlBuilder<Message>) =>
  h.main(
    [h.Class('dojo-shell')],
    [
      h.img([
        h.Src(dojoArtUrl),
        h.Alt('A moonlit mountain monastery with a lone traveler approaching'),
        h.Class('dojo-art'),
        h.Attribute('data-testid', 'dojo-art'),
      ]),
      h.div([h.Class('menu-shade')]),
      h.nav(
        [h.Class('main-menu'), h.AriaLabel('Main menu')],
        [
          h.div([h.Class('menu-title-rule')]),
          h.h1([h.Class('menu-title')], ['Dojo']),
          h.div(
            [h.Class('menu-links')],
            [
              menuLink(
                'Sketch',
                navigationHref(protocol, sketchRouter()),
                'menu-link-sketch',
                h,
              ),
              menuLink(
                'Interrogation',
                navigationHref(protocol, interrogationRouter()),
                'menu-link-interrogation',
                h,
              ),
              menuLink(
                'Interview',
                navigationHref(protocol, interviewRouter()),
                'menu-link-interview',
                h,
              ),
              menuLink(
                'Settings',
                navigationHref(protocol, settingsRouter()),
                'menu-link-settings',
                h,
              ),
            ],
          ),
        ],
      ),
    ],
  )

type RouteDocument = Readonly<{
  title: string
  bodyView: (protocol: string, h: HtmlBuilder<Message>) => Html
}>

const routeDocument = M.type<AppRoute>().pipe(
  M.withReturnType<RouteDocument>(),
  M.tagsExhaustive({
    Home: () => ({ title: 'Dojo', bodyView: homeView }),
    Sketch: () => ({
      title: 'Sketch | Dojo',
      bodyView: (_protocol: string, h: HtmlBuilder<Message>) =>
        splashView(
          sketchArtUrl,
          'A sunlit training hall prepared for sketch practice',
          'sketch-splash',
          h,
        ),
    }),
    Interrogation: () => ({
      title: 'Interrogation | Dojo',
      bodyView: (_protocol: string, h: HtmlBuilder<Message>) =>
        splashView(
          interrogationArtUrl,
          'A candlelit hall devoted to questions and inquiry',
          'interrogation-splash',
          h,
        ),
    }),
    Interview: () => ({
      title: 'Interview | Dojo',
      bodyView: (_protocol: string, h: HtmlBuilder<Message>) =>
        splashView(
          interviewArtUrl,
          'A ceremonial hall of voices prepared for an interview',
          'interview-splash',
          h,
        ),
    }),
    Settings: () => ({
      title: 'Settings | Dojo',
      bodyView: (_protocol: string, h: HtmlBuilder<Message>) =>
        splashView(
          settingsArtUrl,
          'A quiet inner courtyard of the mountain monastery',
          'settings-splash',
          h,
        ),
    }),
    NotFound: () => ({
      title: 'Dojo',
      bodyView: (_protocol: string, h: HtmlBuilder<Message>) =>
        splashView(
          dojoArtUrl,
          'A moonlit mountain monastery with a lone traveler approaching',
          'not-found-splash',
          h,
        ),
    }),
  }),
)

export const view = (model: Model, h: HtmlBuilder<Message>): Document => {
  const document = routeDocument(model.route)
  return { title: document.title, body: document.bodyView(model.protocol, h) }
}
