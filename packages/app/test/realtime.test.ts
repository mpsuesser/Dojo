import { describe, expect, it } from '@effect/vitest'
import { Effect, Layer, Match } from 'effect'
import * as Redacted from 'effect/Redacted'
import * as Schema from 'effect/Schema'
import { HttpClient, HttpClientRequest, HttpClientResponse } from 'effect/unstable/http'

import { mintRealtimeClientSecret } from '../src/interview/realtime.ts'

class ExpectedRealtimeSession extends Schema.Class<ExpectedRealtimeSession>(
  'ExpectedRealtimeSession',
)({
  type: Schema.Literal('realtime'),
  model: Schema.String,
}) {}

class ExpectedClientSecretRequest extends Schema.Class<ExpectedClientSecretRequest>(
  'ExpectedClientSecretRequest',
)({
  session: ExpectedRealtimeSession,
}) {}

const ExpectedClientSecretRequestJson = Schema.fromJsonString(
  ExpectedClientSecretRequest,
)

const apiKey = Redacted.make('sk-test', { label: 'OpenAI API key' })

const httpLayer = (response: Response) =>
  Layer.succeed(
    HttpClient.HttpClient,
    HttpClient.make(
      Effect.fnUntraced(function* (
        request: HttpClientRequest.HttpClientRequest,
        _url: URL,
        signal: AbortSignal,
      ) {
        const webRequest = yield* HttpClientRequest.toWeb(request, { signal }).pipe(
          Effect.orDie,
        )
        const body = yield* Match.value(request.body).pipe(
          Match.tag('Uint8Array', requestBody =>
            Effect.succeed(new TextDecoder().decode(requestBody.body))),
          Match.orElse(() =>
            Effect.die(new Error('Expected a JSON byte-array request body.'))
          ),
        )
        const payload = yield* Schema.decodeEffect(
          ExpectedClientSecretRequestJson,
        )(body).pipe(Effect.orDie)

        expect(webRequest.method).toBe('POST')
        expect(webRequest.url).toBe(
          'https://api.openai.com/v1/realtime/client_secrets',
        )
        expect(webRequest.headers.get('authorization')).toBe('Bearer sk-test')
        expect(webRequest.headers.get('accept')).toBe('application/json')
        expect(webRequest.headers.get('content-type')).toBe('application/json')
        expect(payload).toEqual({
          session: { type: 'realtime', model: 'gpt-realtime-2' },
        })

        return HttpClientResponse.fromWeb(request, response)
      }),
    ),
  )

describe('OpenAI Realtime client secrets', () => {
  it.effect('mints a gpt-realtime-2 client secret for the GA transport', () =>
    Effect.gen(function* () {
      const clientSecret = yield* mintRealtimeClientSecret(
        'activation-1',
        apiKey,
      )
      expect(clientSecret).toBe('ek_test')
    }).pipe(
      Effect.provide(
        httpLayer(
          new Response('{"value":"ek_test","expires_at":1800000000,"session":{}}', {
            status: 200,
            headers: { 'content-type': 'application/json' },
          }),
        ),
      ),
    ))

  it.effect('preserves a rejected client-secret provider message', () =>
    Effect.gen(function* () {
      const error = yield* mintRealtimeClientSecret(
        'activation-1',
        apiKey,
      ).pipe(Effect.flip)

      expect(error.operation).toBe('mintClientSecret')
      expect(error.message).toBe(
        'OpenAI Realtime client secret request failed with status 401: Invalid API key.',
      )
    }).pipe(
      Effect.provide(
        httpLayer(
          new Response('{"error":{"message":"Invalid API key."}}', {
            status: 401,
            headers: { 'content-type': 'application/json' },
          }),
        ),
      ),
    ))
})
