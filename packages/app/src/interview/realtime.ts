import { BrowserHttpClient } from '@effect/platform-browser'
import {
  OpenAIRealtimeWebRTC,
  RealtimeAgent,
  type RealtimeItem,
  type RealtimeMessageItem,
  RealtimeSession,
  type TransportEvent,
} from '@openai/agents/realtime'
import { Effect, Exit, pipe, Result, Stream } from 'effect'
import * as Arr from 'effect/Array'
import * as Option from 'effect/Option'
import * as P from 'effect/Predicate'
import * as Queue from 'effect/Queue'
import * as Schema from 'effect/Schema'
import * as Str from 'effect/String'
import { HttpClient, HttpClientRequest, HttpClientResponse } from 'effect/unstable/http'
import { ManagedResource } from 'foldkit'

import { OpenAiApiKey } from '../openai/api-key.ts'
import { InterviewConfiguration, TranscriptTurn } from './domain.ts'
import { makeInterviewPrompt } from './prompt.ts'

const REALTIME_MODEL = 'gpt-realtime-2'
const REALTIME_CLIENT_SECRETS_URL = 'https://api.openai.com/v1/realtime/client_secrets'
const TRANSCRIPTION_MODEL = 'gpt-4o-mini-transcribe'
const INTERVIEWER_VOICE = 'ash'

class OpenAiRealtimeSessionCreatePayload extends Schema.Class<OpenAiRealtimeSessionCreatePayload>(
  'OpenAiRealtimeSessionCreatePayload',
)({
  type: Schema.Literal('realtime'),
  model: Schema.String,
}) {}

class OpenAiRealtimeClientSecretCreateRequest
  extends Schema.Class<OpenAiRealtimeClientSecretCreateRequest>(
    'OpenAiRealtimeClientSecretCreateRequest',
  )({
    session: OpenAiRealtimeSessionCreatePayload,
  })
{}

class OpenAiRealtimeClientSecretCreateResponse
  extends Schema.Class<OpenAiRealtimeClientSecretCreateResponse>(
    'OpenAiRealtimeClientSecretCreateResponse',
  )({
    value: Schema.String.check(
      Schema.isStartsWith('ek_', {
        identifier: 'OpenAiRealtimeClientSecretPrefixCheck',
        title: 'OpenAI Realtime Client Secret Prefix',
        description: 'An ephemeral OpenAI Realtime client secret beginning with `ek_`.',
        message: 'OpenAI returned an invalid Realtime client secret.',
      }),
    ),
  })
{}

class OpenAiErrorDetail extends Schema.Class<OpenAiErrorDetail>(
  'OpenAiErrorDetail',
)({
  message: Schema.String,
}) {}

class OpenAiErrorResponse extends Schema.Class<OpenAiErrorResponse>(
  'OpenAiErrorResponse',
)({
  error: OpenAiErrorDetail,
}) {}

const OpenAiErrorResponseJson = Schema.fromJsonString(OpenAiErrorResponse)

class OpenAiRealtimeClientSecretRejected
  extends Schema.TaggedError<OpenAiRealtimeClientSecretRejected>()(
    'OpenAiRealtimeClientSecretRejected',
    {
      status: Schema.Int,
      message: Schema.String,
    },
    { description: 'OpenAI rejected a Realtime client-secret request.' },
  )
{}

/** Requirements used to acquire one browser WebRTC interview session. */
export class RealtimeInterviewConfig extends Schema.Class<RealtimeInterviewConfig>(
  'RealtimeInterviewConfig',
)({
  activationId: Schema.String,
  apiKey: OpenAiApiKey,
  interviewConfig: InterviewConfiguration,
  transcript: Schema.Array(TranscriptTurn),
}) {}

export class RealtimeTranscriptUpdated extends Schema.Class<RealtimeTranscriptUpdated>(
  'RealtimeTranscriptUpdated',
)({
  _tag: Schema.tag('RealtimeTranscriptUpdated'),
  activationId: Schema.String,
  transcript: Schema.Array(TranscriptTurn),
}) {}

export class RealtimeTransportObserved extends Schema.Class<RealtimeTransportObserved>(
  'RealtimeTransportObserved',
)({
  _tag: Schema.tag('RealtimeTransportObserved'),
  activationId: Schema.String,
  eventType: Schema.String,
}) {}

export class RealtimeTransportDisconnected extends Schema.Class<RealtimeTransportDisconnected>(
  'RealtimeTransportDisconnected',
)({
  _tag: Schema.tag('RealtimeTransportDisconnected'),
  activationId: Schema.String,
}) {}

export class RealtimeSessionFailed extends Schema.Class<RealtimeSessionFailed>(
  'RealtimeSessionFailed',
)({
  _tag: Schema.tag('RealtimeSessionFailed'),
  activationId: Schema.String,
  message: Schema.String,
}) {}

export const RealtimeInterviewEvent = Schema.Union([
  RealtimeTranscriptUpdated,
  RealtimeTransportObserved,
  RealtimeTransportDisconnected,
  RealtimeSessionFailed,
]).pipe(Schema.toTaggedUnion('_tag'))
export type RealtimeInterviewEvent = typeof RealtimeInterviewEvent.Type

/** Typed browser-side failure while acquiring or controlling Realtime. */
export class RealtimeInterviewError extends Schema.TaggedError<RealtimeInterviewError>()(
  'RealtimeInterviewError',
  {
    activationId: Schema.String,
    operation: Schema.String,
    message: Schema.String,
  },
  { description: 'An OpenAI Realtime interview operation failed.' },
) {}

export interface RealtimeInterviewHandle {
  readonly activationId: string
  readonly events: Stream.Stream<RealtimeInterviewEvent>
  readonly close: Effect.Effect<void>
}

export const RealtimeInterview = ManagedResource.tag<RealtimeInterviewHandle>()(
  'RealtimeInterview',
)
export type RealtimeInterviewService = ManagedResource.ServiceOf<
  typeof RealtimeInterview
>

const errorMessage = (error: unknown): string =>
  P.isError(error) ? error.message : 'Unknown OpenAI Realtime failure.'

const partText = (
  part: RealtimeMessageItem['content'][number],
): Result.Result<string, void> => {
  if (part.type === 'input_text' || part.type === 'output_text') {
    return Result.succeed(part.text)
  }
  return pipe(
    Option.fromNullishOr(part.transcript),
    Option.filter(Str.isNonEmpty),
    Option.match({
      onNone: () => Result.failVoid,
      onSome: Result.succeed,
    }),
  )
}

const messageText = (item: RealtimeMessageItem): string => {
  const content: ReadonlyArray<RealtimeMessageItem['content'][number]> = item.content
  return pipe(content, Arr.filterMap(partText), Arr.join('\n'))
}

const messageItemToTurn = (
  item: RealtimeItem,
): Result.Result<TranscriptTurn, void> => {
  if (item.type !== 'message' || item.role === 'system') {
    return Result.failVoid
  }
  const text = messageText(item)
  if (Str.isEmpty(text)) return Result.failVoid
  return Result.succeed(
    new TranscriptTurn({
      id: item.itemId,
      role: item.role === 'user' ? 'user' : 'interviewer',
      text,
      status: item.status,
    }),
  )
}

/** Normalize SDK history into durable transcript turns. */
export const normalizeRealtimeHistory = (
  history: ReadonlyArray<RealtimeItem>,
): ReadonlyArray<TranscriptTurn> => pipe(history, Arr.filterMap(messageItemToTurn))

const restoredItem = (turn: TranscriptTurn): RealtimeItem =>
  turn.role === 'user'
    ? {
      itemId: turn.id,
      type: 'message',
      role: 'user',
      status: 'completed',
      content: [{ type: 'input_text', text: turn.text }],
    }
    : {
      itemId: turn.id,
      type: 'message',
      role: 'assistant',
      status: turn.status,
      content: [{ type: 'output_text', text: turn.text }],
    }

const restoredHistory = (
  transcript: ReadonlyArray<TranscriptTurn>,
): Array<RealtimeItem> => pipe(transcript, Arr.map(restoredItem), Arr.fromIterable)

const sessionEvents = (
  activationId: string,
  session: RealtimeSession,
  transport: OpenAIRealtimeWebRTC,
): Stream.Stream<RealtimeInterviewEvent> =>
  Stream.callback<RealtimeInterviewEvent>(queue => {
    const handleHistoryUpdated = (history: ReadonlyArray<RealtimeItem>) => {
      Queue.offerUnsafe(
        queue,
        new RealtimeTranscriptUpdated({
          activationId,
          transcript: normalizeRealtimeHistory(history),
        }),
      )
    }
    const handleTransportEvent = (event: TransportEvent) => {
      Queue.offerUnsafe(
        queue,
        new RealtimeTransportObserved({
          activationId,
          eventType: event.type,
        }),
      )
    }
    const handleError = (event: { readonly error: unknown }) => {
      Queue.offerUnsafe(
        queue,
        new RealtimeSessionFailed({
          activationId,
          message: errorMessage(event.error),
        }),
      )
    }
    const handleDisconnected = () => {
      Queue.offerUnsafe(
        queue,
        new RealtimeTransportDisconnected({ activationId }),
      )
    }

    return Effect.gen(function* () {
      yield* Effect.acquireRelease(
        Effect.sync(() => {
          session.on('history_updated', handleHistoryUpdated)
          session.on('transport_event', handleTransportEvent)
          session.on('error', handleError)
          transport.on('disconnected', handleDisconnected)
        }),
        () =>
          Effect.sync(() => {
            session.off('history_updated', handleHistoryUpdated)
            session.off('transport_event', handleTransportEvent)
            session.off('error', handleError)
            transport.off('disconnected', handleDisconnected)
          }),
      )
      yield* Effect.sync(() => transport.requestResponse())
      return yield* Effect.never
    })
  })

const operationError =
  (activationId: string, operation: string) => (error: unknown): RealtimeInterviewError =>
    new RealtimeInterviewError({
      activationId,
      operation,
      message: errorMessage(error),
    })

const rejectedClientSecretMessage = (status: number, body: string): string => {
  const detail = pipe(
    Schema.decodeOption(OpenAiErrorResponseJson)(body),
    Option.map(response => response.error.message),
    Option.filter(Str.isNonEmpty),
    Option.orElse(() => pipe(body, Str.trim, Option.liftPredicate(Str.isNonEmpty))),
  )
  return `OpenAI Realtime client secret request failed with status ${status}${
    Option.match(detail, {
      onNone: () => '.',
      onSome: message => `: ${message}`,
    })
  }`
}

/** Mint a model-bound ephemeral key for the GA Realtime WebRTC transport. */
export const mintRealtimeClientSecret = Effect.fn(
  'Interview.mintRealtimeClientSecret',
)(function* (activationId: string, apiKey: OpenAiApiKey) {
  const client = yield* HttpClient.HttpClient
  return yield* HttpClientRequest.post(REALTIME_CLIENT_SECRETS_URL).pipe(
    HttpClientRequest.schemaBodyJson(OpenAiRealtimeClientSecretCreateRequest)(
      new OpenAiRealtimeClientSecretCreateRequest({
        session: new OpenAiRealtimeSessionCreatePayload({
          type: 'realtime',
          model: REALTIME_MODEL,
        }),
      }),
    ),
    Effect.map(request =>
      request.pipe(
        HttpClientRequest.bearerToken(apiKey),
        HttpClientRequest.acceptJson,
      )
    ),
    Effect.flatMap(client.execute),
    Effect.flatMap(
      HttpClientResponse.matchStatus({
        '2xx': HttpClientResponse.schemaBodyJson(
          OpenAiRealtimeClientSecretCreateResponse,
        ),
        orElse: response =>
          response.text.pipe(
            Effect.orElseSucceed(() => ''),
            Effect.flatMap(body =>
              new OpenAiRealtimeClientSecretRejected({
                status: response.status,
                message: rejectedClientSecretMessage(response.status, body),
              })
            ),
          ),
      }),
    ),
    Effect.map(response => response.value),
    Effect.mapError(operationError(activationId, 'mintClientSecret')),
  )
})

/** Acquire and connect a browser WebRTC session with scoped microphone ownership. */
export const createRealtimeInterview = Effect.fn('Interview.createRealtime')(
  function* (config: RealtimeInterviewConfig) {
    const clientSecret = yield* mintRealtimeClientSecret(
      config.activationId,
      config.apiKey,
    ).pipe(Effect.provide(BrowserHttpClient.layerFetch))
    const isResuming = Arr.match(config.transcript, {
      onEmpty: () => false,
      onNonEmpty: () => true,
    })
    const agent = yield* Effect.try({
      try: () =>
        new RealtimeAgent({
          name: 'Dojo Interviewer',
          instructions: makeInterviewPrompt(config.interviewConfig, isResuming),
          voice: INTERVIEWER_VOICE,
        }),
      catch: operationError(config.activationId, 'createAgent'),
    })
    const transport = yield* Effect.try({
      try: () => new OpenAIRealtimeWebRTC(),
      catch: operationError(config.activationId, 'createTransport'),
    })
    const session = yield* Effect.try({
      try: () =>
        new RealtimeSession(agent, {
          model: REALTIME_MODEL,
          transport,
          historyStoreAudio: false,
          tracingDisabled: true,
          config: {
            reasoning: { effort: 'low' },
            audio: {
              input: {
                noiseReduction: { type: 'near_field' },
                transcription: { model: TRANSCRIPTION_MODEL },
                turnDetection: {
                  type: 'semantic_vad',
                  eagerness: 'medium',
                  createResponse: true,
                  interruptResponse: true,
                },
              },
            },
          },
        }),
      catch: operationError(config.activationId, 'createSession'),
    })

    const closeSession = Effect.sync(() => session.close())
    return yield* Effect.gen(function* () {
      yield* Effect.tryPromise({
        // Declaring the signal keeps acquisition interruptible; cleanup closes
        // the SDK session because its connect API cannot accept the signal.
        try: _signal =>
          session.connect({
            apiKey: clientSecret,
            model: REALTIME_MODEL,
          }),
        catch: operationError(config.activationId, 'connect'),
      })
      const history = restoredHistory(config.transcript)
      yield* Arr.match(history, {
        onEmpty: () => Effect.void,
        onNonEmpty: values => Effect.sync(() => session.updateHistory(Arr.fromIterable(values))),
      })
      return {
        activationId: config.activationId,
        events: sessionEvents(config.activationId, session, transport),
        close: Effect.sync(() => session.close()),
      } satisfies RealtimeInterviewHandle
    }).pipe(
      Effect.onExit(exit => Exit.isFailure(exit) ? closeSession : Effect.void),
    )
  },
)
