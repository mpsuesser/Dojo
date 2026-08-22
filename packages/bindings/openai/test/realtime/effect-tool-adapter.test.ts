import { assert, describe, it } from '@effect/vitest'
import { RunContext } from '@openai/agents'
import { Effect, Layer, ManagedRuntime, Schema } from 'effect'
import * as Arr from 'effect/Array'
import * as Option from 'effect/Option'
import * as Tool from 'effect/unstable/ai/Tool'
import * as Toolkit from 'effect/unstable/ai/Toolkit'

import {
  makeOpenAIRealtimeEffectRunner,
  makeOpenAIRealtimeFunctionTools,
  type OpenAIRealtimeEffectRunner,
  type OpenAIRealtimeFunctionTool,
  OpenAIRealtimeToolAdapterError,
} from '../../src/index.ts'

const withRunner = <A, E, R>(
  use: (
    runner: OpenAIRealtimeEffectRunner,
  ) => Effect.Effect<A, E, R>,
): Effect.Effect<A, E, R> =>
  Effect.acquireUseRelease(
    Effect.sync(() => ManagedRuntime.make(Layer.empty)),
    runtime => use(makeOpenAIRealtimeEffectRunner(runtime)),
    runtime => runtime.disposeEffect,
  )

const firstTool = (
  tools: ReadonlyArray<OpenAIRealtimeFunctionTool>,
): Effect.Effect<OpenAIRealtimeFunctionTool> =>
  Option.match(Arr.head(tools), {
    onNone: () => Effect.die('Expected one OpenAI realtime tool.'),
    onSome: Effect.succeed,
  })

class ConfirmEffectToolParameters extends Schema.Class<ConfirmEffectToolParameters>(
  'ConfirmEffectToolParameters',
)({
  phrase: Schema.String,
}) {}

class ConfirmEffectToolSuccess extends Schema.Class<ConfirmEffectToolSuccess>(
  'ConfirmEffectToolSuccess',
)({
  phrase: Schema.String,
  confirmation: Schema.String,
}) {}

const ConfirmEffectTool = Tool.make('ConfirmEffectTool', {
  description: 'Confirm that an Effect AI tool handler executed from OpenAI Realtime.',
  parameters: ConfirmEffectToolParameters,
  success: ConfirmEffectToolSuccess,
})
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, true)

const ConfirmToolkit = Toolkit.make(ConfirmEffectTool)

const ConfirmToolkitLayer = ConfirmToolkit.toLayer({
  ConfirmEffectTool: ({ phrase }) =>
    Effect.succeed(
      new ConfirmEffectToolSuccess({
        phrase,
        confirmation: `Effect tool confirmed: ${phrase}`,
      }),
    ),
})

class PingEffectToolSuccess extends Schema.Class<PingEffectToolSuccess>(
  'PingEffectToolSuccess',
)({
  pong: Schema.Boolean,
}) {}

const PingEffectTool = Tool.make('PingEffectTool', {
  description: 'Return a pong result without requiring parameters.',
  success: PingEffectToolSuccess,
})

const PingToolkit = Toolkit.make(PingEffectTool)

const PingToolkitLayer = PingToolkit.toLayer({
  PingEffectTool: () => Effect.succeed(new PingEffectToolSuccess({ pong: true })),
})

class OptionalEffectToolParameters extends Schema.Class<OptionalEffectToolParameters>(
  'OptionalEffectToolParameters',
)({
  query: Schema.OptionFromOptionalKey(Schema.String),
}) {}

class OptionalEffectToolSuccess extends Schema.Class<OptionalEffectToolSuccess>(
  'OptionalEffectToolSuccess',
)({
  seenQuery: Schema.String,
}) {}

const OptionalEffectTool = Tool.make('OptionalEffectTool', {
  description: 'Confirm optional fields survive OpenAI Realtime adapter execution.',
  parameters: OptionalEffectToolParameters,
  success: OptionalEffectToolSuccess,
})

const OptionalToolkit = Toolkit.make(OptionalEffectTool)

const OptionalToolkitLayer = OptionalToolkit.toLayer({
  OptionalEffectTool: ({ query }) =>
    Effect.succeed(
      new OptionalEffectToolSuccess({
        seenQuery: Option.match(query, {
          onNone: () => 'none',
          onSome: value => `some:${value}`,
        }),
      }),
    ),
})

class NestedEffectToolDetails extends Schema.Class<NestedEffectToolDetails>(
  'NestedEffectToolDetails',
)({
  label: Schema.String,
}) {}

class NestedEffectToolParameters extends Schema.Class<NestedEffectToolParameters>(
  'NestedEffectToolParameters',
)({
  details: NestedEffectToolDetails,
}) {}

const NestedEffectTool = Tool.make('NestedEffectTool', {
  description: 'Confirm nested schema definitions survive OpenAI Realtime adaptation.',
  parameters: NestedEffectToolParameters,
  success: Schema.String,
})

const NestedToolkit = Toolkit.make(NestedEffectTool)

const NestedToolkitLayer = NestedToolkit.toLayer({
  NestedEffectTool: ({ details }) => Effect.succeed(details.label),
})

class ParametersWithDefinitions extends Schema.Class<ParametersWithDefinitions>(
  'ParametersWithDefinitions',
)({
  properties: Schema.Record(Schema.String, Schema.Unknown),
  $defs: Schema.Record(Schema.String, Schema.Unknown),
}) {}

const InvalidNameTool = Tool.make('Invalid-Name', {
  description: 'This name is intentionally invalid for OpenAI function tools.',
  success: Schema.String,
})

const InvalidNameToolkit = Toolkit.make(InvalidNameTool)

const InvalidNameToolkitLayer = InvalidNameToolkit.toLayer({
  'Invalid-Name': () => Effect.succeed('not reached'),
})

describe('makeOpenAIRealtimeFunctionTools', () => {
  it.live('adapts an Effect AI tool and executes its handler through a runner', () =>
    withRunner(runner =>
      Effect.gen(function* () {
        const handled = yield* ConfirmToolkit.pipe(
          Effect.provide(ConfirmToolkitLayer),
        )
        const tools = yield* makeOpenAIRealtimeFunctionTools(
          handled,
          runner,
        )
        const realtimeTool = yield* firstTool(tools)

        assert.strictEqual(realtimeTool.name, 'ConfirmEffectTool')
        assert.strictEqual(realtimeTool.strict, true)
        assert.deepStrictEqual(realtimeTool.parameters.required, [
          'phrase',
        ])

        const result = yield* Effect.tryPromise(() =>
          realtimeTool.invoke(
            new RunContext(),
            '{"phrase":"blue banana"}',
          )
        )

        assert.deepStrictEqual(result, {
          phrase: 'blue banana',
          confirmation: 'Effect tool confirmed: blue banana',
        })
      })
    ))

  it.live('normalizes no-parameter Effect tools for OpenAI JSON schema', () =>
    withRunner(runner =>
      Effect.gen(function* () {
        const handled = yield* PingToolkit.pipe(
          Effect.provide(PingToolkitLayer),
        )
        const tools = yield* makeOpenAIRealtimeFunctionTools(
          handled,
          runner,
          { strictDefault: false },
        )
        const realtimeTool = yield* firstTool(tools)

        assert.strictEqual(realtimeTool.name, 'PingEffectTool')
        assert.strictEqual(realtimeTool.strict, false)
        assert.deepStrictEqual(realtimeTool.parameters.properties, {})
        assert.deepStrictEqual(realtimeTool.parameters.required, [])
        assert.strictEqual(
          realtimeTool.parameters.additionalProperties,
          true,
        )

        const result = yield* Effect.tryPromise(() => realtimeTool.invoke(new RunContext(), '{}'))

        assert.deepStrictEqual(result, { pong: true })
      })
    ))

  it.live('lets Toolkit decode optional parameters exactly once', () =>
    withRunner(runner =>
      Effect.gen(function* () {
        const handled = yield* OptionalToolkit.pipe(
          Effect.provide(OptionalToolkitLayer),
        )
        const tools = yield* makeOpenAIRealtimeFunctionTools(
          handled,
          runner,
        )
        const realtimeTool = yield* firstTool(tools)

        assert.strictEqual(realtimeTool.name, 'OptionalEffectTool')
        assert.deepStrictEqual(realtimeTool.parameters.required, [
          'query',
        ])

        const omittedResult = yield* Effect.tryPromise(() =>
          realtimeTool.invoke(new RunContext(), '{}')
        )
        const nullResult = yield* Effect.tryPromise(() =>
          realtimeTool.invoke(new RunContext(), '{"query":null}')
        )
        const presentResult = yield* Effect.tryPromise(() =>
          realtimeTool.invoke(
            new RunContext(),
            '{"query":"curation_space"}',
          )
        )

        assert.deepStrictEqual(omittedResult, { seenQuery: 'none' })
        assert.deepStrictEqual(nullResult, { seenQuery: 'none' })
        assert.deepStrictEqual(presentResult, {
          seenQuery: 'some:curation_space',
        })
      })
    ))

  it.live('preserves definitions referenced by nested parameter schemas', () =>
    withRunner(runner =>
      Effect.gen(function* () {
        const handled = yield* NestedToolkit.pipe(
          Effect.provide(NestedToolkitLayer),
        )
        const tools = yield* makeOpenAIRealtimeFunctionTools(
          handled,
          runner,
        )
        const realtimeTool = yield* firstTool(tools)
        const parameters = yield* Schema.decodeUnknownEffect(
          ParametersWithDefinitions,
        )(realtimeTool.parameters)

        assert.deepStrictEqual(parameters.properties.details, {
          $ref: '#/$defs/NestedEffectToolDetailsEncoded',
        })
        assert.deepStrictEqual(parameters.$defs.NestedEffectToolDetailsEncoded, {
          type: 'object',
          properties: {
            label: { type: 'string' },
          },
          required: ['label'],
          additionalProperties: false,
        })
      })
    ))

  it.live('rejects tool names that the OpenAI SDK would rewrite', () =>
    withRunner(runner =>
      Effect.gen(function* () {
        const handled = yield* InvalidNameToolkit.pipe(
          Effect.provide(InvalidNameToolkitLayer),
        )

        const error = yield* Effect.flip(
          makeOpenAIRealtimeFunctionTools(handled, runner),
        )

        assert.instanceOf(error, OpenAIRealtimeToolAdapterError)
        assert.strictEqual(error.reason, 'InvalidToolName')
        assert.strictEqual(error.toolName, 'Invalid-Name')
      })
    ))
})
