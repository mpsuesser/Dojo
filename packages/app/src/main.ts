import { Effect, Match as M, Option, Stream } from 'effect'
import * as Schema from 'effect/Schema'
import { Command, ManagedResource, type Runtime, Subscription } from 'foldkit'
import type { Document, Html, HtmlBuilder } from 'foldkit/html'
import { m } from 'foldkit/message'
import { load, pushUrl, UrlRequest } from 'foldkit/navigation'
import { evo } from 'foldkit/struct'
import { toString as urlToString, Url } from 'foldkit/url'

import dojoArtUrl from '../../../docs/generated-concept-art/01-the-dojo.png'
import interrogationArtUrl from '../../../docs/generated-concept-art/03-hall-of-questions.png'
import interviewArtUrl from '../../../docs/generated-concept-art/04-hall-of-voices.png'
import {
  MusicPlaybackError,
  MusicPlaybackState,
  MusicPlayer,
  MusicStartAttempt,
} from './audio/player.ts'
import { AudioSettings } from './audio/settings.ts'
import {
  AppRoute,
  archivifyRouter,
  homeRouter,
  interrogationRouter,
  interviewRouter,
  navigationHref,
  settingsRouter,
  sketchRouter,
  urlToAppRoute,
} from './route.ts'
import * as Settings from './settings/main.ts'
import * as Sketch from './sketch/main.ts'

export class Flags extends Schema.Class<Flags>('Flags')({
  audioSettings: AudioSettings,
}) {}

export const flags: Effect.Effect<Flags> = Settings.loadAudioSettings.pipe(
  Effect.map(audioSettings => new Flags({ audioSettings })),
)

export const Model = Schema.Struct({
  route: AppRoute,
  protocol: Schema.String,
  musicPlaybackState: MusicPlaybackState,
  settings: Settings.Model,
  sketch: Sketch.Model,
})
export type Model = typeof Model.Type

export const CompletedNavigateInternal = m('CompletedNavigateInternal')
export const CompletedLoadExternal = m('CompletedLoadExternal')
export const ClickedLink = m('ClickedLink', { request: UrlRequest })
export const ChangedUrl = m('ChangedUrl', { url: Url })
export const GotSketchMessage = m('GotSketchMessage', {
  message: Sketch.Message,
})
export const GotSettingsMessage = m('GotSettingsMessage', {
  message: Settings.Message,
})
export const InteractedWithPage = m('InteractedWithPage')
export const SucceededStartMusic = m('SucceededStartMusic', {
  attempt: MusicStartAttempt,
})
export const FailedStartMusic = m('FailedStartMusic', {
  attempt: MusicStartAttempt,
})

export const Message = Schema.Union([
  CompletedNavigateInternal,
  CompletedLoadExternal,
  ClickedLink,
  ChangedUrl,
  GotSketchMessage,
  GotSettingsMessage,
  InteractedWithPage,
  SucceededStartMusic,
  FailedStartMusic,
])
export type Message = typeof Message.Type

const NavigateInternal = Command.define('NavigateInternal', {
  args: { url: Schema.String },
  messages: [CompletedNavigateInternal],
  execute: ({ url }) => pushUrl(url).pipe(Effect.as(CompletedNavigateInternal())),
})

const LoadExternal = Command.define('LoadExternal', {
  args: { href: Schema.String },
  messages: [CompletedLoadExternal],
  execute: ({ href }) => load(href).pipe(Effect.as(CompletedLoadExternal())),
})

export const init: Runtime.RoutingApplicationInit<
  Model,
  Message,
  Flags,
  MusicPlayer,
  Sketch.EditorService
> = (startupFlags, url: Url) => [
  {
    route: urlToAppRoute(url),
    protocol: url.protocol,
    musicPlaybackState: 'StartingAutoplay',
    settings: Settings.init(startupFlags.audioSettings),
    sketch: Sketch.init(),
  },
  [],
]

type UpdateReturn = readonly [
  Model,
  ReadonlyArray<Command.Command<Message, never, Sketch.EditorService>>,
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
      ChangedUrl: ({ url }) => {
        const settings = M.value(model.route).pipe(
          M.tag('Settings', () => Settings.cancelActiveDrags(model.settings)),
          M.orElse(() => model.settings),
        )
        return [
          evo(model, {
            route: () => urlToAppRoute(url),
            protocol: () => url.protocol,
            settings: () => settings,
          }),
          [],
        ]
      },
      GotSketchMessage: ({ message: sketchMessage }) => {
        const [sketch, sketchCommands, maybeOutMessage] = Sketch.update(
          model.sketch,
          sketchMessage,
        )
        const commands = Command.mapMessages(
          sketchCommands,
          message => GotSketchMessage({ message }),
        )
        return Option.match(maybeOutMessage, {
          onNone: () => [evo(model, { sketch: () => sketch }), commands],
          onSome: () => [
            evo(model, { sketch: () => sketch }),
            [
              ...commands,
              NavigateInternal({
                url: navigationHref(model.protocol, homeRouter()),
              }),
            ],
          ],
        })
      },
      GotSettingsMessage: ({ message: settingsMessage }) => {
        const [settings, settingsCommands, maybeOutMessage] = Settings.update(
          model.settings,
          settingsMessage,
        )
        const commands = Command.mapMessages(
          settingsCommands,
          message => GotSettingsMessage({ message }),
        )
        return Option.match(maybeOutMessage, {
          onNone: () => [evo(model, { settings: () => settings }), commands],
          onSome: () => [
            evo(model, { settings: () => settings }),
            [
              ...commands,
              NavigateInternal({
                url: navigationHref(model.protocol, homeRouter()),
              }),
            ],
          ],
        })
      },
      InteractedWithPage: () =>
        M.value(model.musicPlaybackState).pipe(
          withUpdateReturn,
          M.whenOr('StartingAutoplay', 'WaitingForInteraction', () => [
            evo(model, {
              musicPlaybackState: () => 'StartingFromInteraction',
            }),
            [],
          ]),
          M.orElse(() => [model, []]),
        ),
      SucceededStartMusic: () => [
        evo(model, { musicPlaybackState: () => 'Playing' }),
        [],
      ],
      FailedStartMusic: ({ attempt }) =>
        M.value(attempt).pipe(
          withUpdateReturn,
          M.when('Autoplay', () =>
            M.value(model.musicPlaybackState).pipe(
              withUpdateReturn,
              M.when('StartingAutoplay', () => [
                evo(model, {
                  musicPlaybackState: () => 'WaitingForInteraction',
                }),
                [],
              ]),
              M.orElse(() => [model, []]),
            )),
          M.when('Interaction', () =>
            M.value(model.musicPlaybackState).pipe(
              withUpdateReturn,
              M.when('StartingFromInteraction', () => [
                evo(model, {
                  musicPlaybackState: () => 'WaitingForInteraction',
                }),
                [],
              ]),
              M.orElse(() => [model, []]),
            )),
          M.when('Resume', () =>
            M.value(model.musicPlaybackState).pipe(
              withUpdateReturn,
              M.when('Playing', () => [
                evo(model, {
                  musicPlaybackState: () => 'WaitingForInteraction',
                }),
                [],
              ]),
              M.orElse(() => [model, []]),
            )),
          M.exhaustive,
        ),
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
                'Archivify',
                navigationHref(protocol, archivifyRouter()),
                'menu-link-archivify',
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
  bodyView: (model: Model, h: HtmlBuilder<Message>) => Html
}>

const routeDocument = M.type<AppRoute>().pipe(
  M.withReturnType<RouteDocument>(),
  M.tagsExhaustive({
    Home: () => ({
      title: 'Dojo',
      bodyView: (model, h) => homeView(model.protocol, h),
    }),
    Sketch: () => ({
      title: 'Sketch | Dojo',
      bodyView: (model, h) =>
        h.submodel({
          slotId: 'sketch',
          model: model.sketch,
          view: Sketch.view,
          toParentMessage: message => GotSketchMessage({ message }),
        }),
    }),
    Archivify: () => ({
      title: 'Archivify | Dojo',
      bodyView: (_model: Model, h: HtmlBuilder<Message>) =>
        h.main([
          h.Class('archivify-shell'),
          h.Attribute('data-testid', 'archivify-page'),
        ]),
    }),
    Interrogation: () => ({
      title: 'Interrogation | Dojo',
      bodyView: (_model: Model, h: HtmlBuilder<Message>) =>
        splashView(
          interrogationArtUrl,
          'A candlelit hall devoted to questions and inquiry',
          'interrogation-splash',
          h,
        ),
    }),
    Interview: () => ({
      title: 'Interview | Dojo',
      bodyView: (_model: Model, h: HtmlBuilder<Message>) =>
        splashView(
          interviewArtUrl,
          'A ceremonial hall of voices prepared for an interview',
          'interview-splash',
          h,
        ),
    }),
    Settings: () => ({
      title: 'Settings | Dojo',
      bodyView: (model, h) =>
        h.submodel({
          slotId: 'settings',
          model: model.settings,
          view: Settings.view,
          viewInputs: {
            musicPlaybackState: model.musicPlaybackState,
          },
          toParentMessage: message => GotSettingsMessage({ message }),
        }),
    }),
    NotFound: () => ({
      title: 'Dojo',
      bodyView: (_model: Model, h: HtmlBuilder<Message>) =>
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
  return {
    title: document.title,
    body: h.div(
      [h.Class('scene-stage'), h.Attribute('data-testid', 'scene-stage')],
      [document.bodyView(model, h)],
    ),
  }
}

const sketchModel = (model: Model): Option.Option<Sketch.Model> =>
  M.value(model.route).pipe(
    M.tag('Sketch', () => Option.some(model.sketch)),
    M.orElse(() => Option.none()),
  )

export const managedResources = ManagedResource.lift(Sketch.managedResources)<
  Model,
  Message
>({
  toChildModel: sketchModel,
  toParentMessage: message => GotSketchMessage({ message }),
})

const sketchSubscriptions = Subscription.lift(Sketch.subscriptions)<
  Model,
  Message
>({
  toChildModel: model => model.sketch,
  toParentMessage: message => GotSketchMessage({ message }),
  when: model => Option.isSome(sketchModel(model)),
})

const settingsModel = (model: Model): Option.Option<Settings.Model> =>
  M.value(model.route).pipe(
    M.tag('Settings', () => Option.some(model.settings)),
    M.orElse(() => Option.none()),
  )

const settingsSubscriptions = Subscription.lift(Settings.subscriptions)<
  Model,
  Message
>({
  toChildModel: model => model.settings,
  toParentMessage: message => GotSettingsMessage({ message }),
  when: model => Option.isSome(settingsModel(model)),
})

const audioSettingsSubscriptions = Subscription.lift(
  Settings.audioSubscriptions,
)<Model, Message>({
  toChildModel: model => model.settings,
  toParentMessage: message => GotSettingsMessage({ message }),
})

const isWaitingForMusicInteraction = (
  state: MusicPlaybackState,
): boolean =>
  M.value(state).pipe(
    M.whenOr('StartingAutoplay', 'WaitingForInteraction', () => true),
    M.orElse(() => false),
  )

const musicActivationSubscription = Subscription.make<Model, Message>()(
  entry => ({
    musicActivation: entry(
      { musicPlaybackState: MusicPlaybackState },
      {
        modelToDependencies: model => ({
          musicPlaybackState: model.musicPlaybackState,
        }),
        dependenciesToStream: ({ musicPlaybackState }) =>
          Stream.when(
            Stream.merge(
              Stream.fromEventListener<PointerEvent>(
                document,
                'pointerdown',
              ).pipe(Stream.map(() => InteractedWithPage())),
              Stream.fromEventListener<KeyboardEvent>(document, 'keydown').pipe(
                Stream.map(() => InteractedWithPage()),
              ),
            ),
            Effect.sync(() => isWaitingForMusicInteraction(musicPlaybackState)),
          ),
      },
    ),
  }),
)

const attemptMusicPlayback = Effect.fn('Music.attemptPlayback')(
  function* (
    attempt: MusicStartAttempt,
    settings: AudioSettings,
  ): Effect.fn.Return<Message, MusicPlaybackError, MusicPlayer> {
    const player = yield* MusicPlayer
    yield* M.value(attempt).pipe(
      M.whenOr('Autoplay', 'Interaction', () => player.start(settings)),
      M.when('Resume', () => player.ensureStarted(settings)),
      M.exhaustive,
    )
    return SucceededStartMusic({ attempt })
  },
  (effect, attempt) =>
    effect.pipe(
      Effect.catchTag('MusicPlaybackError', () => Effect.succeed(FailedStartMusic({ attempt }))),
    ),
)

const musicPlaybackStream = (
  state: MusicPlaybackState,
  settings: AudioSettings,
): Stream.Stream<Message, never, MusicPlayer> =>
  M.value(state).pipe(
    M.withReturnType<Stream.Stream<Message, never, MusicPlayer>>(),
    M.when('StartingAutoplay', () => Stream.fromEffect(attemptMusicPlayback('Autoplay', settings))),
    M.when('StartingFromInteraction', () =>
      Stream.fromEffect(attemptMusicPlayback('Interaction', settings))),
    M.when('WaitingForInteraction', () =>
      Stream.empty),
    M.when('Playing', () => Stream.fromEffect(attemptMusicPlayback('Resume', settings))),
    M.exhaustive,
  )

const musicPlaybackSubscription = Subscription.make<
  Model,
  Message,
  MusicPlayer
>()(entry => ({
  musicPlayback: entry(
    {
      musicPlaybackState: MusicPlaybackState,
      audioSettings: AudioSettings,
    },
    {
      modelToDependencies: model => ({
        musicPlaybackState: model.musicPlaybackState,
        audioSettings: model.settings.audioSettings,
      }),
      dependenciesToStream: ({ audioSettings, musicPlaybackState }) =>
        musicPlaybackStream(musicPlaybackState, audioSettings),
    },
  ),
}))

export const subscriptions = Subscription.aggregate<
  Model,
  Message,
  MusicPlayer | Sketch.EditorService
>()(
  sketchSubscriptions,
  settingsSubscriptions,
  audioSettingsSubscriptions,
  musicActivationSubscription,
  musicPlaybackSubscription,
)

export const resources = MusicPlayer.layer
