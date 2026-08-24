import { BrowserCrypto } from '@effect/platform-browser'
import { Clock, Crypto, Duration, Effect, Match as M, Option, pipe, Stream } from 'effect'
import * as Arr from 'effect/Array'
import * as Bool from 'effect/Boolean'
import * as P from 'effect/Predicate'
import * as Schema from 'effect/Schema'
import { Command, ManagedResource, Subscription } from 'foldkit'
import type { Html, HtmlBuilder } from 'foldkit/html'
import { m } from 'foldkit/message'
import { evo } from 'foldkit/struct'
import * as Submodel from 'foldkit/submodel'

import interviewArtUrl from '../../../../docs/generated-concept-art/10-interview-conversation-refined.png'
import { MusicPlayer } from '../audio/player.ts'
import backIconUrl from '../icons/back.svg'
import { hasOpenAiApiKey, OpenAiApiKey } from '../openai/api-key.ts'
import {
  ActiveInterview,
  BrowseInterviews,
  ChooseInterview,
  ConfigureInterview,
  filterSessions,
  findSession,
  InterviewConfiguration,
  InterviewSession,
  InterviewSessionMetadata,
  Model,
  pendingMetadata,
  recentSessions,
  ReviewInterview,
  transcriptText,
  TranscriptTurn,
} from './domain.ts'
import { generateInterviewMetadata } from './metadata.ts'
import {
  createRealtimeInterview,
  RealtimeInterview,
  RealtimeInterviewConfig,
  RealtimeInterviewEvent,
  type RealtimeInterviewService,
} from './realtime.ts'

export type { RealtimeInterviewService } from './realtime.ts'

export { init, InterviewConfiguration, InterviewSession, Model } from './domain.ts'

const INTERVIEW_SESSIONS_STORAGE_KEY = 'dojo.interview-sessions.v1'
const INTERVIEW_SESSIONS_SAVE_DELAY = Duration.millis(180)
const InterviewSessionsJson = Schema.fromJsonString(Schema.Array(InterviewSession))
const sameString = Schema.toEquivalence(Schema.String)
const sameRequestId = Schema.toEquivalence(Schema.Natural)

class InterviewStorageError extends Schema.TaggedError<InterviewStorageError>()(
  'InterviewStorageError',
  {
    operation: Schema.Literals(['Read', 'Write']),
    cause: Schema.Defect(),
  },
  { description: 'Browser storage was unavailable for interview sessions.' },
) {}

class InterviewClipboardError extends Schema.TaggedError<InterviewClipboardError>()(
  'InterviewClipboardError',
  { cause: Schema.Defect() },
  { description: 'The browser clipboard rejected an interview transcript.' },
) {}

const readStoredSessions = Effect.fn('Interview.readStoredSessions')(
  function* () {
    const stored = yield* Effect.try({
      try: () => localStorage.getItem(INTERVIEW_SESSIONS_STORAGE_KEY),
      catch: cause => new InterviewStorageError({ operation: 'Read', cause }),
    })
    return yield* Option.match(Option.fromNullishOr(stored), {
      onNone: () => Effect.succeed<ReadonlyArray<InterviewSession>>([]),
      onSome: Schema.decodeUnknownEffect(InterviewSessionsJson),
    })
  },
)

/** Load schema-decoded local interview sessions, ignoring corrupt storage. */
export const loadInterviewSessions: Effect.Effect<
  ReadonlyArray<InterviewSession>
> = readStoredSessions().pipe(
  Effect.catch(() =>
    Effect.logWarning(
      'Stored interview sessions were unavailable; starting with an empty library.',
    ).pipe(Effect.as([]))
  ),
)

const persistSessions = Effect.fn('Interview.persistSessions')(function* (
  sessions: ReadonlyArray<InterviewSession>,
) {
  yield* Effect.sleep(INTERVIEW_SESSIONS_SAVE_DELAY)
  const encoded = yield* Schema.encodeUnknownEffect(InterviewSessionsJson)(
    sessions,
  )
  yield* Effect.try({
    try: () => localStorage.setItem(INTERVIEW_SESSIONS_STORAGE_KEY, encoded),
    catch: cause => new InterviewStorageError({ operation: 'Write', cause }),
  }).pipe(
    Effect.catch(() => Effect.logWarning('Interview sessions could not be persisted.')),
  )
})

export const ClickedClose = m('ClickedClose')
export const ClickedConfigureNew = m('ClickedConfigureNew')
export const ClickedLoadPrevious = m('ClickedLoadPrevious')
export const ClickedBackToChooser = m('ClickedBackToChooser')
export const ChangedInterviewObjectives = m('ChangedInterviewObjectives', {
  value: Schema.String,
})
export const ChangedBackgroundContext = m('ChangedBackgroundContext', {
  value: Schema.String,
})
export const ChangedSessionSearch = m('ChangedSessionSearch', {
  value: Schema.String,
})
export const ClickedBeginInterview = m('ClickedBeginInterview')
export const ClickedLoadSession = m('ClickedLoadSession', {
  sessionId: Schema.String,
})
export const ClickedResumeInterview = m('ClickedResumeInterview', {
  sessionId: Schema.String,
})
export const ClickedPauseInterview = m('ClickedPauseInterview')
export const ClickedDeleteInterview = m('ClickedDeleteInterview', {
  sessionId: Schema.String,
})
export const ClickedCopyTranscript = m('ClickedCopyTranscript', {
  sessionId: Schema.String,
})
export const CompletedCreateInterview = m('CompletedCreateInterview', {
  requestId: Schema.Natural,
  session: InterviewSession,
  activationId: Schema.String,
})
export const FailedCreateInterview = m('FailedCreateInterview', {
  requestId: Schema.Natural,
  error: Schema.String,
})
export const CompletedActivateInterview = m('CompletedActivateInterview', {
  requestId: Schema.Natural,
  sessionId: Schema.String,
  activationId: Schema.String,
  activatedAt: Schema.Finite,
})
export const FailedActivateInterview = m('FailedActivateInterview', {
  requestId: Schema.Natural,
  error: Schema.String,
})
export const ConnectedRealtimeInterview = m('ConnectedRealtimeInterview', {
  activationId: Schema.String,
})
export const DisconnectedRealtimeInterview = m('DisconnectedRealtimeInterview')
export const FailedAcquireRealtimeInterview = m(
  'FailedAcquireRealtimeInterview',
  { error: Schema.String },
)
export const ReceivedRealtimeInterviewEvent = m(
  'ReceivedRealtimeInterviewEvent',
  { event: RealtimeInterviewEvent },
)
export const CompletedCopyTranscript = m('CompletedCopyTranscript')
export const FailedCopyTranscript = m('FailedCopyTranscript')
export const CompletedGenerateInterviewMetadata = m(
  'CompletedGenerateInterviewMetadata',
  {
    sessionId: Schema.String,
    metadata: InterviewSessionMetadata,
  },
)
export const FailedGenerateInterviewMetadata = m(
  'FailedGenerateInterviewMetadata',
  { sessionId: Schema.String },
)

export const Message = Schema.Union([
  ClickedClose,
  ClickedConfigureNew,
  ClickedLoadPrevious,
  ClickedBackToChooser,
  ChangedInterviewObjectives,
  ChangedBackgroundContext,
  ChangedSessionSearch,
  ClickedBeginInterview,
  ClickedLoadSession,
  ClickedResumeInterview,
  ClickedPauseInterview,
  ClickedDeleteInterview,
  ClickedCopyTranscript,
  CompletedCreateInterview,
  FailedCreateInterview,
  CompletedActivateInterview,
  FailedActivateInterview,
  ConnectedRealtimeInterview,
  DisconnectedRealtimeInterview,
  FailedAcquireRealtimeInterview,
  ReceivedRealtimeInterviewEvent,
  CompletedCopyTranscript,
  FailedCopyTranscript,
  CompletedGenerateInterviewMetadata,
  FailedGenerateInterviewMetadata,
])
export type Message = typeof Message.Type

export const RequestedClose = m('RequestedClose')
export const OutMessage = Schema.Union([RequestedClose])
export type OutMessage = typeof OutMessage.Type

const actionErrorMessage = (error: unknown): string =>
  P.isError(error) ? error.message : 'The interview action could not be completed.'

const CreateInterview = Command.define('CreateInterview', {
  args: {
    requestId: Schema.Natural,
    config: InterviewConfiguration,
  },
  messages: [CompletedCreateInterview, FailedCreateInterview],
  execute: ({ config, requestId }) =>
    Effect.gen(function* () {
      const crypto = yield* Crypto.Crypto
      const sessionId = yield* crypto.randomUUIDv4
      const activationId = yield* crypto.randomUUIDv4
      const now = yield* Clock.currentTimeMillis
      return CompletedCreateInterview({
        requestId,
        activationId,
        session: new InterviewSession({
          id: sessionId,
          config,
          title: pendingMetadata.title,
          description: pendingMetadata.description,
          tags: pendingMetadata.tags,
          createdAt: now,
          lastActivatedAt: now,
          transcript: [],
        }),
      })
    }).pipe(
      Effect.provide(BrowserCrypto.layer),
      Effect.catch(error =>
        Effect.succeed(
          FailedCreateInterview({ requestId, error: actionErrorMessage(error) }),
        )
      ),
    ),
})

const ActivateInterview = Command.define('ActivateInterview', {
  args: { requestId: Schema.Natural, sessionId: Schema.String },
  messages: [CompletedActivateInterview, FailedActivateInterview],
  execute: ({ requestId, sessionId }) =>
    Effect.gen(function* () {
      const crypto = yield* Crypto.Crypto
      const activationId = yield* crypto.randomUUIDv4
      const activatedAt = yield* Clock.currentTimeMillis
      return CompletedActivateInterview({
        requestId,
        sessionId,
        activationId,
        activatedAt,
      })
    }).pipe(
      Effect.provide(BrowserCrypto.layer),
      Effect.catch(error =>
        Effect.succeed(
          FailedActivateInterview({ requestId, error: actionErrorMessage(error) }),
        )
      ),
    ),
})

const CopyTranscript = Command.define('CopyTranscript', {
  args: { text: Schema.String },
  messages: [CompletedCopyTranscript, FailedCopyTranscript],
  execute: ({ text }) =>
    Effect.tryPromise({
      try: () => navigator.clipboard.writeText(text),
      catch: cause => new InterviewClipboardError({ cause }),
    }).pipe(
      Effect.as(CompletedCopyTranscript()),
      Effect.orElseSucceed(() => FailedCopyTranscript()),
    ),
})

const GenerateInterviewMetadata = Command.define('GenerateInterviewMetadata', {
  args: {
    session: InterviewSession,
    apiKey: OpenAiApiKey,
  },
  messages: [
    CompletedGenerateInterviewMetadata,
    FailedGenerateInterviewMetadata,
  ],
  execute: ({ session, apiKey }) =>
    generateInterviewMetadata(session, apiKey).pipe(
      Effect.map(metadata =>
        CompletedGenerateInterviewMetadata({
          sessionId: session.id,
          metadata,
        })
      ),
      Effect.orElseSucceed(() => FailedGenerateInterviewMetadata({ sessionId: session.id })),
    ),
})

type UpdateReturn = readonly [
  Model,
  ReadonlyArray<Command.Command<Message>>,
  Option.Option<OutMessage>,
]

const activeScreen = (
  model: Model,
): Option.Option<typeof ActiveInterview.Type> =>
  M.value(model.screen).pipe(
    M.withReturnType<Option.Option<typeof ActiveInterview.Type>>(),
    M.tag('ActiveInterview', value => Option.some(value)),
    M.orElse(() => Option.none()),
  )

const updateSession = (
  sessions: ReadonlyArray<InterviewSession>,
  sessionId: string,
  update: (session: InterviewSession) => InterviewSession,
): ReadonlyArray<InterviewSession> =>
  Arr.map(sessions, session => sameString(session.id, sessionId) ? update(session) : session)

const nextActivationRequestId = (model: Model): number => model.activationRequestId + 1

const isCurrentActivationRequest = (
  model: Model,
  requestId: number,
): boolean => model.activationPending && sameRequestId(model.activationRequestId, requestId)

const cancelPendingActivation = (model: Model): Model =>
  evo(model, { activationPending: () => false })

const pauseActiveInterview = (model: Model): UpdateReturn => {
  const canceledModel = cancelPendingActivation(model)
  return Option.match(activeScreen(canceledModel), {
    onNone: () => [canceledModel, [], Option.none()],
    onSome: active =>
      Option.match(findSession(canceledModel.sessions, active.sessionId), {
        onNone: () => [
          evo(canceledModel, {
            screen: () => ChooseInterview(),
            musicDuckingState: () => 'Restoring',
          }),
          [],
          Option.none(),
        ],
        onSome: session => [
          evo(canceledModel, {
            screen: () => ReviewInterview({ sessionId: session.id }),
            musicDuckingState: () => 'Restoring',
            transcriptCopyState: () => 'Idle',
          }),
          [
            GenerateInterviewMetadata({
              session,
              apiKey: canceledModel.openAiApiKey,
            }),
          ],
          Option.none(),
        ],
      }),
  })
}

/** Pause capture before a route change while preserving drafts and transcript. */
export const pauseForNavigation = (
  model: Model,
): readonly [Model, ReadonlyArray<Command.Command<Message>>] => {
  const [nextModel, commands] = pauseActiveInterview(model)
  return [nextModel, commands]
}

/** Synchronize the redacted credential owned by the root Settings model. */
export const setOpenAiApiKey = (
  model: Model,
  openAiApiKey: OpenAiApiKey,
): Model => evo(model, { openAiApiKey: () => openAiApiKey })

const updateTranscript = (
  model: Model,
  activationId: string,
  transcript: ReadonlyArray<TranscriptTurn>,
): Model =>
  Option.match(activeScreen(model), {
    onNone: () => model,
    onSome: active =>
      sameString(active.activationId, activationId)
        ? evo(model, {
          sessions: sessions =>
            updateSession(sessions, active.sessionId, session =>
              new InterviewSession({
                id: session.id,
                config: session.config,
                title: session.title,
                description: session.description,
                tags: session.tags,
                createdAt: session.createdAt,
                lastActivatedAt: session.lastActivatedAt,
                transcript,
              })),
          shouldPersistSessions: () => true,
        })
        : model,
  })

const failActiveInterview = (model: Model, message: string): UpdateReturn => {
  const withNotice = evo(model, { notice: () => Option.some(message) })
  return pauseActiveInterview(withNotice)
}

const updateRealtimeEvent = (
  model: Model,
  event: RealtimeInterviewEvent,
): UpdateReturn =>
  M.value(event).pipe(
    M.withReturnType<UpdateReturn>(),
    M.tagsExhaustive({
      RealtimeTranscriptUpdated: ({ activationId, transcript }) => [
        updateTranscript(model, activationId, transcript),
        [],
        Option.none(),
      ],
      RealtimeTransportObserved: () => [model, [], Option.none()],
      RealtimeTransportDisconnected: ({ activationId }) =>
        Option.match(activeScreen(model), {
          onNone: () => [model, [], Option.none()],
          onSome: active =>
            sameString(active.activationId, activationId)
              ? failActiveInterview(
                model,
                'The voice channel disconnected. Your session was paused.',
              )
              : [model, [], Option.none()],
        }),
      RealtimeSessionFailed: ({ activationId, message }) =>
        Option.match(activeScreen(model), {
          onNone: () => [model, [], Option.none()],
          onSome: active =>
            sameString(active.activationId, activationId)
              ? failActiveInterview(model, message)
              : [model, [], Option.none()],
        }),
    }),
  )

export const update = (model: Model, message: Message): UpdateReturn =>
  M.value(message).pipe(
    M.withReturnType<UpdateReturn>(),
    M.tagsExhaustive({
      ClickedClose: () => {
        const [nextModel, commands] = pauseActiveInterview(model)
        return [nextModel, commands, Option.some(RequestedClose())]
      },
      ClickedConfigureNew: () => [
        evo(model, {
          screen: () => ConfigureInterview(),
          activationPending: () => false,
          notice: () => Option.none(),
        }),
        [],
        Option.none(),
      ],
      ClickedLoadPrevious: () => [
        evo(model, {
          screen: () => BrowseInterviews({ query: '' }),
          activationPending: () => false,
          notice: () => Option.none(),
        }),
        [],
        Option.none(),
      ],
      ClickedBackToChooser: () => [
        evo(model, {
          screen: () => ChooseInterview(),
          activationPending: () => false,
          transcriptCopyState: () => 'Idle',
          notice: () => Option.none(),
        }),
        [],
        Option.none(),
      ],
      ChangedInterviewObjectives: ({ value }) => [
        evo(model, { interviewObjectivesDraft: () => value }),
        [],
        Option.none(),
      ],
      ChangedBackgroundContext: ({ value }) => [
        evo(model, { backgroundContextDraft: () => value }),
        [],
        Option.none(),
      ],
      ChangedSessionSearch: ({ value }) => [
        evo(model, { screen: () => BrowseInterviews({ query: value }) }),
        [],
        Option.none(),
      ],
      ClickedBeginInterview: () =>
        Bool.match(
          hasOpenAiApiKey(model.openAiApiKey) && !model.activationPending,
          {
            onFalse: () => [model, [], Option.none()],
            onTrue: () => {
              const requestId = nextActivationRequestId(model)
              return [
                evo(model, {
                  activationRequestId: () => requestId,
                  activationPending: () => true,
                }),
                [
                  CreateInterview({
                    requestId,
                    config: new InterviewConfiguration({
                      interviewObjectives: model.interviewObjectivesDraft,
                      backgroundContext: model.backgroundContextDraft,
                    }),
                  }),
                ],
                Option.none(),
              ]
            },
          },
        ),
      ClickedLoadSession: ({ sessionId }) => [
        evo(model, {
          screen: () => ReviewInterview({ sessionId }),
          activationPending: () => false,
          transcriptCopyState: () => 'Idle',
          notice: () => Option.none(),
        }),
        [],
        Option.none(),
      ],
      ClickedResumeInterview: ({ sessionId }) =>
        hasOpenAiApiKey(model.openAiApiKey)
          ? model.activationPending
            ? [model, [], Option.none()]
            : Option.match(findSession(model.sessions, sessionId), {
              onNone: () => [model, [], Option.none()],
              onSome: () => {
                const requestId = nextActivationRequestId(model)
                return [
                  evo(model, {
                    activationRequestId: () => requestId,
                    activationPending: () => true,
                  }),
                  [ActivateInterview({ requestId, sessionId })],
                  Option.none(),
                ]
              },
            })
          : [
            evo(model, {
              notice: () => Option.some('Set an OpenAI API key in Settings before resuming.'),
            }),
            [],
            Option.none(),
          ],
      ClickedPauseInterview: () => pauseActiveInterview(model),
      ClickedDeleteInterview: ({ sessionId }) => [
        evo(model, {
          activationPending: () => false,
          sessions: sessions => Arr.filter(sessions, session => !sameString(session.id, sessionId)),
          shouldPersistSessions: () => true,
          screen: () => BrowseInterviews({ query: '' }),
          transcriptCopyState: () => 'Idle',
          notice: () => Option.none(),
        }),
        [],
        Option.none(),
      ],
      ClickedCopyTranscript: ({ sessionId }) =>
        Option.match(findSession(model.sessions, sessionId), {
          onNone: () => [model, [], Option.none()],
          onSome: session => [
            evo(model, { transcriptCopyState: () => 'Copying' }),
            [CopyTranscript({ text: transcriptText(session.transcript) })],
            Option.none(),
          ],
        }),
      CompletedCreateInterview: ({ requestId, session, activationId }) =>
        isCurrentActivationRequest(model, requestId)
          ? [
            evo(model, {
              activationPending: () => false,
              sessions: sessions => Arr.prepend(sessions, session),
              shouldPersistSessions: () => true,
              screen: () =>
                ActiveInterview({
                  sessionId: session.id,
                  activationId,
                  connectionState: 'Connecting',
                  initialTranscript: session.transcript,
                }),
              musicDuckingState: () => 'Muted',
              notice: () => Option.none(),
            }),
            [],
            Option.none(),
          ]
          : [model, [], Option.none()],
      FailedCreateInterview: ({ requestId, error }) =>
        isCurrentActivationRequest(model, requestId)
          ? [
            evo(model, {
              activationPending: () => false,
              notice: () => Option.some(error),
            }),
            [],
            Option.none(),
          ]
          : [model, [], Option.none()],
      CompletedActivateInterview: ({
        requestId,
        sessionId,
        activationId,
        activatedAt,
      }) =>
        isCurrentActivationRequest(model, requestId)
          ? [
            evo(model, {
              activationPending: () => false,
              sessions: sessions =>
                updateSession(sessions, sessionId, session =>
                  new InterviewSession({
                    id: session.id,
                    config: session.config,
                    title: session.title,
                    description: session.description,
                    tags: session.tags,
                    createdAt: session.createdAt,
                    lastActivatedAt: activatedAt,
                    transcript: session.transcript,
                  })),
              shouldPersistSessions: () => true,
              screen: () =>
                ActiveInterview({
                  sessionId,
                  activationId,
                  connectionState: 'Connecting',
                  initialTranscript: pipe(
                    findSession(model.sessions, sessionId),
                    Option.map(session => session.transcript),
                    Option.getOrElse(() => []),
                  ),
                }),
              musicDuckingState: () => 'Muted',
              notice: () => Option.none(),
            }),
            [],
            Option.none(),
          ]
          : [model, [], Option.none()],
      FailedActivateInterview: ({ requestId, error }) =>
        isCurrentActivationRequest(model, requestId)
          ? [
            evo(model, {
              activationPending: () => false,
              notice: () => Option.some(error),
            }),
            [],
            Option.none(),
          ]
          : [model, [], Option.none()],
      ConnectedRealtimeInterview: ({ activationId }) =>
        Option.match(activeScreen(model), {
          onNone: () => [model, [], Option.none()],
          onSome: active =>
            sameString(active.activationId, activationId)
              ? [
                evo(model, {
                  screen: () =>
                    ActiveInterview({
                      ...active,
                      connectionState: 'Connected',
                    }),
                }),
                [],
                Option.none(),
              ]
              : [model, [], Option.none()],
        }),
      DisconnectedRealtimeInterview: () => [model, [], Option.none()],
      FailedAcquireRealtimeInterview: ({ error }) => failActiveInterview(model, error),
      ReceivedRealtimeInterviewEvent: ({ event }) => updateRealtimeEvent(model, event),
      CompletedCopyTranscript: () => [
        evo(model, { transcriptCopyState: () => 'Copied' }),
        [],
        Option.none(),
      ],
      FailedCopyTranscript: () => [
        evo(model, { transcriptCopyState: () => 'Failed' }),
        [],
        Option.none(),
      ],
      CompletedGenerateInterviewMetadata: ({ sessionId, metadata }) => [
        evo(model, {
          sessions: sessions =>
            updateSession(sessions, sessionId, session =>
              new InterviewSession({
                id: session.id,
                config: session.config,
                title: metadata.title,
                description: metadata.description,
                tags: metadata.tags,
                createdAt: session.createdAt,
                lastActivatedAt: session.lastActivatedAt,
                transcript: session.transcript,
              })),
          shouldPersistSessions: () => true,
        }),
        [],
        Option.none(),
      ],
      FailedGenerateInterviewMetadata: () => [
        evo(model, {
          notice: notice =>
            Option.isSome(notice)
              ? notice
              : Option.some('Session saved, but metadata could not be refreshed.'),
        }),
        [],
        Option.none(),
      ],
    }),
  )

const modelToRealtimeConfig = (
  model: Model,
): Option.Option<RealtimeInterviewConfig> =>
  Option.flatMap(
    activeScreen(model),
    active =>
      Option.map(findSession(model.sessions, active.sessionId), session =>
        new RealtimeInterviewConfig({
          activationId: active.activationId,
          apiKey: model.openAiApiKey,
          interviewConfig: session.config,
          transcript: active.initialTranscript,
        })),
  )

export const managedResources = ManagedResource.make<Model, Message>()(entry => ({
  realtimeInterview: entry(Schema.Option(RealtimeInterviewConfig), {
    resource: RealtimeInterview,
    modelToMaybeRequirements: modelToRealtimeConfig,
    acquire: createRealtimeInterview,
    release: session => session.close,
    onAcquired: session => ConnectedRealtimeInterview({ activationId: session.activationId }),
    onReleased: () => DisconnectedRealtimeInterview(),
    onAcquireError: error => FailedAcquireRealtimeInterview({ error: actionErrorMessage(error) }),
  }),
}))

const realtimeEventStream = (): Stream.Stream<
  Message,
  never,
  RealtimeInterviewService
> =>
  Stream.unwrap(
    RealtimeInterview.get.pipe(
      Effect.map(session =>
        session.events.pipe(
          Stream.map(event => ReceivedRealtimeInterviewEvent({ event })),
        )
      ),
      Effect.catchTag('ResourceNotAvailable', () => Effect.succeed(Stream.empty)),
    ),
  )

const isRealtimeConnected = (model: Model): boolean =>
  Option.match(activeScreen(model), {
    onNone: () => false,
    onSome: active => active.connectionState === 'Connected',
  })

export const subscriptions = Subscription.make<
  Model,
  Message,
  MusicPlayer | RealtimeInterviewService
>()(entry => ({
  realtimeEvents: entry(
    { connected: Schema.Boolean },
    {
      modelToDependencies: model => ({ connected: isRealtimeConnected(model) }),
      dependenciesToStream: ({ connected }) => connected ? realtimeEventStream() : Stream.empty,
    },
  ),
  musicDucking: entry(
    { state: Schema.Literals(['Neutral', 'Muted', 'Restoring']) },
    {
      modelToDependencies: model => ({ state: model.musicDuckingState }),
      dependenciesToStream: ({ state }) =>
        M.value(state).pipe(
          M.withReturnType<Stream.Stream<never, never, MusicPlayer>>(),
          M.when('Neutral', () => Stream.empty),
          M.when('Muted', () =>
            Stream.fromEffect(
              Effect.gen(function* () {
                const player = yield* MusicPlayer
                yield* player.fadeOutForInterview
              }),
            ).pipe(Stream.drain)),
          M.when('Restoring', () =>
            Stream.fromEffect(
              Effect.gen(function* () {
                const player = yield* MusicPlayer
                yield* player.fadeInAfterInterview
              }),
            ).pipe(Stream.drain)),
          M.exhaustive,
        ),
    },
  ),
  persistSessions: entry(
    {
      sessions: Schema.Array(InterviewSession),
      shouldPersistSessions: Schema.Boolean,
    },
    {
      modelToDependencies: model => ({
        sessions: model.sessions,
        shouldPersistSessions: model.shouldPersistSessions,
      }),
      dependenciesToStream: ({ sessions, shouldPersistSessions }) =>
        Bool.match(shouldPersistSessions, {
          onFalse: () => Stream.empty,
          onTrue: () =>
            Stream.fromEffect(
              persistSessions(sessions).pipe(
                Effect.catch(() => Effect.logWarning('Interview sessions could not be persisted.')),
              ),
            ).pipe(Stream.drain),
        }),
    },
  ),
}))

type ViewInputs = Readonly<{
  settingsHref: string
}>

const panelBackButton = (h: HtmlBuilder<Message>): Html =>
  h.button(
    [
      h.Type('button'),
      h.Class('interview-panel-back'),
      h.OnClick(ClickedBackToChooser()),
    ],
    ['Back'],
  )

const panelHeader = (
  title: string,
  h: HtmlBuilder<Message>,
): Html =>
  h.header(
    [h.Class('interview-panel-header')],
    [
      h.button(
        [
          h.Type('button'),
          h.Class('interview-panel-back-arrow'),
          h.AriaLabel('Back to interview choices'),
          h.OnClick(ClickedBackToChooser()),
        ],
        [
          h.span(
            [
              h.Class('interview-panel-back-glyph'),
              h.Attribute('aria-hidden', 'true'),
            ],
            ['←'],
          ),
        ],
      ),
      h.h2([h.Class('interview-panel-title')], [title]),
    ],
  )

const chooseView = (model: Model, h: HtmlBuilder<Message>): Html =>
  h.div(
    [h.Class('interview-choice-grid')],
    [
      h.button(
        [
          h.Type('button'),
          h.Class('interview-choice interview-choice-new'),
          h.AriaLabel('Begin a new interview'),
          h.OnClick(ClickedConfigureNew()),
        ],
        [h.span([h.Class('interview-choice-title')], ['NEW'])],
      ),
      h.button(
        [
          h.Type('button'),
          h.Class('interview-choice interview-choice-load'),
          h.AriaLabel('Load a previous session'),
          h.OnClick(ClickedLoadPrevious()),
        ],
        [h.span([h.Class('interview-choice-title')], ['LOAD'])],
      ),
    ],
  )

const configureView = (
  model: Model,
  viewInputs: ViewInputs,
  h: HtmlBuilder<Message>,
): Html => {
  const hasKey = hasOpenAiApiKey(model.openAiApiKey)
  const canBegin = hasKey && !model.activationPending
  return h.div(
    [h.Class('interview-configure')],
    [
      panelHeader('New session', h),
      h.div(
        [h.Class('interview-form-grid')],
        [
          h.label(
            [h.For('interview-objectives'), h.Class('interview-field')],
            [
              h.span([h.Class('interview-field-label')], ['Interview objectives']),
              h.textarea([
                h.Id('interview-objectives'),
                h.Value(model.interviewObjectivesDraft),
                h.Class('interview-textarea'),
                h.OnInput(value => ChangedInterviewObjectives({ value })),
              ]),
            ],
          ),
          h.label(
            [h.For('interview-context'), h.Class('interview-field')],
            [
              h.span([h.Class('interview-field-label')], ['Background context']),
              h.textarea([
                h.Id('interview-context'),
                h.Value(model.backgroundContextDraft),
                h.Class('interview-textarea'),
                h.OnInput(value => ChangedBackgroundContext({ value })),
              ]),
            ],
          ),
        ],
      ),
      h.div(
        [
          h.Class('interview-begin-wrap'),
          h.Attribute('data-api-key-missing', hasKey ? 'false' : 'true'),
          ...hasKey ? [] : [h.Attribute('tabindex', '0')],
        ],
        [
          h.button(
            [
              h.Type('button'),
              h.Class('interview-primary-button'),
              h.Disabled(!canBegin),
              h.OnClick(ClickedBeginInterview()),
            ],
            [model.activationPending ? 'Preparing interview...' : 'Begin'],
          ),
          ...hasKey
            ? []
            : [
              h.div(
                [h.Class('interview-key-tooltip'), h.Attribute('role', 'tooltip')],
                [
                  "Interviews require access to OpenAI's realtime voice API. Set your API key in ",
                  h.a([h.Href(viewInputs.settingsHref)], ['Settings']),
                  " - any text you've entered here will still be here when you return.",
                ],
              ),
            ],
        ],
      ),
    ],
  )
}

const sessionTags = (
  tags: ReadonlyArray<string>,
  h: HtmlBuilder<Message>,
): ReadonlyArray<Html> => Arr.map(tags, tag => h.span([h.Class('interview-session-tag')], [tag]))

const browseView = (
  model: Model,
  query: string,
  h: HtmlBuilder<Message>,
): Html => {
  const sessions = filterSessions(model.sessions, query)
  return h.div(
    [h.Class('interview-browser')],
    [
      h.div(
        [h.Class('interview-search')],
        [
          panelHeader('Session archive', h),
          h.input([
            h.Type('search'),
            h.Value(query),
            h.Class('interview-search-input'),
            h.AriaLabel('Search sessions'),
            h.Placeholder('Search sessions'),
            h.OnInput(value => ChangedSessionSearch({ value })),
          ]),
        ],
      ),
      h.div(
        [h.Class('interview-session-list')],
        Arr.match(sessions, {
          onEmpty: () => [
            h.p([h.Class('interview-empty')], [
              model.sessions.length === 0
                ? 'No interviews have been recorded yet.'
                : 'No sessions match that search.',
            ]),
          ],
          onNonEmpty: values =>
            Arr.map(values, session =>
              h.button(
                [
                  h.Type('button'),
                  h.Class('interview-session-card'),
                  h.OnClick(ClickedLoadSession({ sessionId: session.id })),
                ],
                [
                  h.span([h.Class('interview-session-title')], [session.title]),
                  h.span([h.Class('interview-session-description')], [
                    session.description,
                  ]),
                  h.span(
                    [h.Class('interview-session-tags')],
                    sessionTags(session.tags, h),
                  ),
                ],
              )),
        }),
      ),
    ],
  )
}

const transcriptTurns = (
  transcript: ReadonlyArray<TranscriptTurn>,
  h: HtmlBuilder<Message>,
): ReadonlyArray<Html> =>
  Arr.match(transcript, {
    onEmpty: () => [
      h.p([h.Class('interview-empty interview-transcript-empty')], [
        'The transcript will appear here as the conversation unfolds.',
      ]),
    ],
    onNonEmpty: turns =>
      Arr.map(turns, turn =>
        h.article(
          [
            h.Class(`interview-turn interview-turn-${turn.role}`),
            h.Attribute('data-status', turn.status),
          ],
          [
            h.span([h.Class('interview-turn-role')], [
              turn.role === 'user' ? 'You' : 'Interviewer',
            ]),
            h.p([h.Class('interview-turn-text')], [turn.text]),
          ],
        )),
  })

const copyButtonLabel = (model: Model): string =>
  M.value(model.transcriptCopyState).pipe(
    M.when('Idle', () => 'Copy transcript'),
    M.when('Copying', () => 'Copying...'),
    M.when('Copied', () => 'Copied'),
    M.when('Failed', () => 'Copy failed'),
    M.exhaustive,
  )

const reviewView = (
  model: Model,
  session: InterviewSession,
  h: HtmlBuilder<Message>,
): Html =>
  h.div(
    [h.Class('interview-review')],
    [
      panelBackButton(h),
      h.header(
        [h.Class('interview-review-header')],
        [
          h.div(
            [h.Class('interview-review-copy')],
            [
              h.h2([h.Class('interview-review-title')], [session.title]),
              h.p([h.Class('interview-review-description')], [
                session.description,
              ]),
              h.div(
                [h.Class('interview-session-tags')],
                sessionTags(session.tags, h),
              ),
            ],
          ),
          h.div(
            [h.Class('interview-review-actions')],
            [
              h.button(
                [
                  h.Type('button'),
                  h.Class('interview-secondary-button'),
                  h.OnClick(ClickedCopyTranscript({ sessionId: session.id })),
                ],
                [copyButtonLabel(model)],
              ),
              h.button(
                [
                  h.Type('button'),
                  h.Class('interview-primary-button'),
                  h.Disabled(model.activationPending),
                  h.OnClick(ClickedResumeInterview({ sessionId: session.id })),
                ],
                [model.activationPending ? 'Preparing interview...' : 'Resume interview'],
              ),
              h.button(
                [
                  h.Type('button'),
                  h.Class('interview-danger-button'),
                  h.OnClick(ClickedDeleteInterview({ sessionId: session.id })),
                ],
                ['Delete'],
              ),
            ],
          ),
        ],
      ),
      h.div(
        [
          h.Class('interview-transcript'),
          h.Attribute('aria-label', 'Interview transcript'),
        ],
        transcriptTurns(session.transcript, h),
      ),
    ],
  )

const activeView = (
  connectionState: 'Connecting' | 'Connected',
  h: HtmlBuilder<Message>,
): Html =>
  h.div(
    [h.Class('interview-active')],
    [
      h.span(
        [
          h.Class('interview-live-announcement'),
          h.Attribute('role', 'status'),
          h.Attribute('aria-live', 'polite'),
        ],
        [
          connectionState === 'Connected'
            ? 'Interview live'
            : 'Opening the voice channel...',
        ],
      ),
      h.button(
        [
          h.Type('button'),
          h.Class('interview-pause-button interview-active-pause'),
          h.AriaLabel('Pause interview'),
          h.OnClick(ClickedPauseInterview()),
        ],
        [
          h.span([
            h.Class('interview-pause-glyph'),
            h.Attribute('aria-hidden', 'true'),
          ]),
          h.span([], ['Pause interview']),
        ],
      ),
    ],
  )

const energyStrand = (
  className: string,
  path: string,
  h: HtmlBuilder<Message>,
): Html =>
  h.g(
    [h.Class(`interview-energy-strand ${className}`)],
    [
      h.path([
        h.Class('interview-energy-bed'),
        h.D(path),
      ]),
      h.path([
        h.Class('interview-energy-moving interview-energy-trail-glow'),
        h.D(path),
        h.PathLength('100'),
        h.Filter('url(#interview-energy-blur)'),
      ]),
      h.path([
        h.Class('interview-energy-moving interview-energy-trail-core'),
        h.D(path),
        h.PathLength('100'),
      ]),
      h.path([
        h.Class('interview-energy-moving interview-energy-trail-head'),
        h.D(path),
        h.PathLength('100'),
      ]),
    ],
  )

const activeEnergyField = (
  connectionState: 'Connecting' | 'Connected',
  h: HtmlBuilder<Message>,
): Html =>
  h.svg(
    [
      h.Class('interview-energy-field'),
      h.Attribute('aria-hidden', 'true'),
      h.Attribute('focusable', 'false'),
      h.Attribute('data-connection-state', connectionState),
      h.Attribute('data-testid', 'interview-energy-field'),
      h.Xmlns('http://www.w3.org/2000/svg'),
      h.ViewBox('0 0 600 330'),
      h.PreserveAspectRatio('none'),
      h.StrokeLinecap('round'),
      h.StrokeLinejoin('round'),
    ],
    [
      h.defs([], [
        h.clipPath(
          [h.Id('interview-energy-clip')],
          [
            h.path([
              h.Class('interview-energy-clip-shape'),
              h.D(
                'M 68 36 C 160 16 445 16 525 48 L 528 217 C 492 271 406 300 305 302 C 198 300 104 271 68 218 Z',
              ),
            ]),
          ],
        ),
        h.filter(
          [
            h.Id('interview-energy-blur'),
            h.FilterUnits('userSpaceOnUse'),
            h.X('-30'),
            h.Y('-30'),
            h.Width('660'),
            h.Height('390'),
          ],
          [
            h.feGaussianBlur([
              h.Attribute('stdDeviation', '4.5'),
            ]),
          ],
        ),
      ]),
      h.g(
        [h.ClipPath('url(#interview-energy-clip)')],
        [
          energyStrand(
            'interview-energy-strand-amber-outer',
            'M 306 244 C 250 251 160 237 103 205 C 65 183 65 126 116 85 C 171 51 239 60 296 99 C 349 135 382 179 431 201 C 397 222 354 238 306 244',
            h,
          ),
          energyStrand(
            'interview-energy-strand-amber-inner',
            'M 305 244 C 265 221 215 190 198 156 C 180 121 214 93 263 101 C 315 110 350 150 387 181 C 410 201 431 207 451 201 C 421 231 358 257 305 244',
            h,
          ),
          energyStrand(
            'interview-energy-strand-cyan-outer',
            'M 304 244 C 367 255 451 239 492 203 C 520 177 514 121 472 85 C 428 48 367 54 317 82 C 268 109 244 149 264 183 C 287 222 355 237 416 212 C 466 190 495 150 476 117 C 456 81 405 72 356 91 C 311 108 279 144 258 178 C 240 208 261 233 304 244',
            h,
          ),
          energyStrand(
            'interview-energy-strand-cyan-inner',
            'M 304 244 C 343 218 391 190 410 157 C 429 124 412 99 375 96 C 334 92 296 118 276 153 C 257 187 269 221 304 244 C 347 270 413 253 459 220 C 496 190 502 148 478 115 C 451 80 396 70 344 87 C 293 105 259 143 260 181 C 260 215 282 235 304 244',
            h,
          ),
          energyStrand(
            'interview-energy-strand-crossing',
            'M 101 199 C 166 223 225 190 277 154 C 330 117 400 118 492 184',
            h,
          ),
          h.circle([
            h.Class('interview-energy-nexus-glow'),
            h.Cx('305'),
            h.Cy('244'),
            h.R('22'),
            h.Filter('url(#interview-energy-blur)'),
          ]),
          h.circle([
            h.Class('interview-energy-nexus-core'),
            h.Cx('305'),
            h.Cy('244'),
            h.R('3.5'),
          ]),
        ],
      ),
    ],
  )

const screenView = (
  model: Model,
  viewInputs: ViewInputs,
  h: HtmlBuilder<Message>,
): Html =>
  M.value(model.screen).pipe(
    M.withReturnType<Html>(),
    M.tagsExhaustive({
      ChooseInterview: () => chooseView(model, h),
      ConfigureInterview: () => configureView(model, viewInputs, h),
      BrowseInterviews: ({ query }) => browseView(model, query, h),
      ReviewInterview: ({ sessionId }) =>
        Option.match(findSession(model.sessions, sessionId), {
          onNone: () => chooseView(model, h),
          onSome: session => reviewView(model, session, h),
        }),
      ActiveInterview: ({ sessionId, connectionState }) =>
        Option.match(findSession(model.sessions, sessionId), {
          onNone: () => chooseView(model, h),
          onSome: () => activeView(connectionState, h),
        }),
    }),
  )

export const view = Submodel.defineView<Model, Message, ViewInputs>(
  (model, viewInputs, h): Html =>
    h.main(
      [
        h.Class(
          M.value(model.screen).pipe(
            M.tag('ActiveInterview', () => 'interview-shell interview-shell-active'),
            M.orElse(() => 'interview-shell'),
          ),
        ),
        h.Attribute('data-testid', 'interview-page'),
      ],
      [
        h.img([
          h.Src(interviewArtUrl),
          h.Alt('Two focused speakers sharing a resonant conversation in the Hall of Voices'),
          h.Class('interview-art'),
          h.Attribute('data-testid', 'interview-splash'),
        ]),
        ...M.value(model.screen).pipe(
          M.withReturnType<ReadonlyArray<Html>>(),
          M.tag('ActiveInterview', ({ connectionState }) => [
            activeEnergyField(connectionState, h),
          ]),
          M.orElse(() => []),
        ),
        h.header(
          [h.Class('dojo-page-masthead interview-masthead')],
          [
            h.div(
              [h.Class('dojo-page-title-lockup')],
              [
                h.button([
                  h.Type('button'),
                  h.Class('dojo-page-home-control interview-home-control'),
                  h.AriaLabel('Return to Dojo'),
                  h.OnClick(ClickedClose()),
                ]),
                h.span(
                  [h.Class('dojo-page-kicker')],
                  [
                    h.span(
                      [h.Class('dojo-page-home-mark')],
                      [
                        h.span([h.Class('dojo-page-home-label')], ['Dojo']),
                        h.img([
                          h.Src(backIconUrl),
                          h.Alt(''),
                          h.Class('dojo-page-home-icon'),
                        ]),
                      ],
                    ),
                    h.span([], [' / Hall of Voices']),
                  ],
                ),
                h.h1([h.Class('dojo-page-title')], ['Interview']),
              ],
            ),
          ],
        ),
        h.section(
          [h.Class('interview-workspace')],
          [
            h.div(
              [h.Class('interview-workspace-heading')],
              [
                ...M.value(model.screen).pipe(
                  M.withReturnType<ReadonlyArray<Html>>(),
                  M.tag('ActiveInterview', () => [
                    h.span([h.Class('interview-workspace-kicker')], ['Voice channel']),
                  ]),
                  M.tag('ReviewInterview', () => [
                    h.span([h.Class('interview-workspace-kicker')], ['Session archive']),
                  ]),
                  M.tag('BrowseInterviews', () => []),
                  M.tag('ConfigureInterview', () => []),
                  M.tag('ChooseInterview', () => []),
                  M.exhaustive,
                ),
                ...Option.match(model.notice, {
                  onNone: () => [],
                  onSome: notice => [
                    h.span(
                      [h.Class('interview-notice'), h.Attribute('role', 'status')],
                      [notice],
                    ),
                  ],
                }),
              ],
            ),
            screenView(model, viewInputs, h),
          ],
        ),
      ],
    ),
)

/** Sessions sorted by latest activation, useful to callers and tests. */
export const sortedSessions = (model: Model): ReadonlyArray<InterviewSession> =>
  recentSessions(model.sessions)
