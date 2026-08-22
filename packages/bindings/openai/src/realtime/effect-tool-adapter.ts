import type { FunctionTool, ToolInputParameters } from '@openai/agents'
import { type RealtimeItem, tool as openAiTool } from '@openai/agents/realtime'
import * as Arr from 'effect/Array'
import * as Bool from 'effect/Boolean'
import * as Effect from 'effect/Effect'
import { pipe } from 'effect/Function'
import * as ManagedRuntime from 'effect/ManagedRuntime'
import * as Option from 'effect/Option'
import * as P from 'effect/Predicate'
import * as R from 'effect/Record'
import * as Schema from 'effect/Schema'
import * as Stream from 'effect/Stream'
import * as Str from 'effect/String'
import * as Tool from 'effect/unstable/ai/Tool'
import * as Toolkit from 'effect/unstable/ai/Toolkit'

/**
 * Minimal context shape OpenAI Realtime supplies to function tools. Keeping the
 * history element type unknown lets converted tools work across concrete
 * realtime item versions while remaining assignable to RealtimeAgent tools.
 */
export interface OpenAIRealtimeToolContext {
  readonly history: Array<RealtimeItem>
}

/**
 * OpenAI Realtime function tool produced by the Effect AI toolkit adapter.
 */
export type OpenAIRealtimeFunctionTool = FunctionTool<
  OpenAIRealtimeToolContext,
  ToolInputParameters,
  unknown
>

export const OpenAIRealtimeToolAdapterErrorReason = Schema.Literals([
  'InvalidToolName',
  'InvalidParametersSchema',
  'MissingFinalToolResult',
])
export type OpenAIRealtimeToolAdapterErrorReason = typeof OpenAIRealtimeToolAdapterErrorReason.Type

/**
 * Typed failure raised while adapting or executing Effect AI tools as OpenAI
 * Realtime function tools.
 */
export class OpenAIRealtimeToolAdapterError
  extends Schema.TaggedError<OpenAIRealtimeToolAdapterError>()(
    'OpenAIRealtimeToolAdapterError',
    {
      reason: OpenAIRealtimeToolAdapterErrorReason,
      toolName: Schema.String,
      message: Schema.String,
    },
    {
      description: 'Failure while adapting an Effect AI tool to an OpenAI Realtime function tool.',
    },
  )
{}

/**
 * Runs Effect programs from OpenAI's Promise-based tool callback boundary.
 * Prefer creating this from a `ManagedRuntime` so service provisioning and
 * lifecycle stay explicit.
 */
export interface OpenAIRealtimeEffectRunner<RuntimeServices = never> {
  readonly runPromise: <A, E>(
    effect: Effect.Effect<A, E, RuntimeServices>,
  ) => Promise<A>
}

/**
 * Create an OpenAI Realtime tool execution runner from a managed Effect
 * runtime. The returned runner can be closed over by OpenAI SDK callbacks
 * without constructing runtimes per tool call.
 */
export const makeOpenAIRealtimeEffectRunner = <RuntimeServices, RuntimeError>(
  runtime: ManagedRuntime.ManagedRuntime<RuntimeServices, RuntimeError>,
): OpenAIRealtimeEffectRunner<RuntimeServices> => ({
  runPromise: effect => runtime.runPromise(effect),
})

/**
 * Options controlling how Effect AI tool metadata maps to OpenAI Realtime tools.
 */
export interface OpenAIRealtimeToolAdapterOptions {
  /**
   * Strict JSON schema mode to use when the Effect tool does not carry a
   * `Tool.Strict` annotation. OpenAI's SDK defaults to strict mode; the bridge
   * keeps that default for the best schema-following behavior.
   */
  readonly strictDefault?: boolean
  /**
   * Effect supports dynamic approval predicates that receive Effect Prompt
   * history. OpenAI Realtime exposes a different callback shape. Until a richer
   * history adapter exists, dynamic Effect approval predicates are conservatively
   * treated as approval-required by default.
   */
  readonly requireApprovalForDynamicApproval?: boolean
  /**
   * Model-visible error formatter used when OpenAI invokes a converted tool and
   * the Effect handler fails or returns invalid output.
   */
  readonly formatError?: (error: unknown) => string
}

const JsonSchemaEntry = Schema.Record(Schema.String, Schema.Unknown)

class OpenAIRealtimeLocalJsonSchemaRef extends Schema.Class<OpenAIRealtimeLocalJsonSchemaRef>(
  'OpenAIRealtimeLocalJsonSchemaRef',
)({
  $ref: Schema.String,
  $defs: Schema.Record(Schema.String, JsonSchemaEntry),
}) {}

class OpenAIRealtimeJsonObjectParameters extends Schema.Class<OpenAIRealtimeJsonObjectParameters>(
  'OpenAIRealtimeJsonObjectParameters',
)({
  type: Schema.Literal('object'),
  properties: Schema.Record(Schema.String, JsonSchemaEntry).pipe(
    Schema.withDecodingDefaultKey(Effect.succeed({})),
  ),
  required: Schema.Array(Schema.String).pipe(
    Schema.withDecodingDefaultKey(Effect.succeed([])),
  ),
  additionalProperties: Schema.Boolean.pipe(
    Schema.withDecodingDefaultKey(Effect.succeed(false)),
  ),
  $defs: Schema.Record(Schema.String, JsonSchemaEntry).pipe(
    Schema.withDecodingDefaultKey(Effect.succeed({})),
  ),
  description: Schema.optionalKey(Schema.String),
}) {}

const OpenAIRealtimeFunctionToolName = Schema.String.check(
  Schema.isPattern(/^[A-Za-z0-9_]+$/, {
    identifier: 'OpenAIRealtimeFunctionToolNameCheck',
    title: 'OpenAI Realtime Function Tool Name',
    description:
      'OpenAI Agents JS preserves names containing only ASCII letters, numbers, and underscores.',
    message: 'OpenAI Realtime tool names must contain only letters, numbers, and underscores.',
  }),
).pipe(
  Schema.brand('OpenAIRealtimeFunctionToolName'),
  Schema.annotate({
    title: 'OpenAIRealtimeFunctionToolName',
    description: 'A function tool name that will not be rewritten by the OpenAI Agents SDK.',
  }),
)

const decodeToolName = Schema.decodeUnknownEffect(
  OpenAIRealtimeFunctionToolName,
)

const decodeJsonObjectParameters = Schema.decodeUnknownEffect(
  OpenAIRealtimeJsonObjectParameters,
)

const decodeLocalJsonSchemaRef = Schema.decodeUnknownOption(
  OpenAIRealtimeLocalJsonSchemaRef,
)

const localDefinitionsRefPrefix = '#/$defs/'

const dereferenceLocalJsonSchema = (jsonSchema: unknown): unknown =>
  pipe(
    decodeLocalJsonSchemaRef(jsonSchema),
    Option.flatMap(schemaRef =>
      Bool.match(
        pipe(schemaRef.$ref, Str.startsWith(localDefinitionsRefPrefix)),
        {
          onFalse: () => Option.none(),
          onTrue: () =>
            pipe(
              schemaRef.$ref,
              Str.slice(localDefinitionsRefPrefix.length),
              definitionName =>
                pipe(
                  Option.fromNullishOr(schemaRef.$defs[definitionName]),
                  Option.map(definition => ({
                    ...definition,
                    $defs: schemaRef.$defs,
                  })),
                ),
            ),
        },
      )
    ),
    Option.getOrElse(() => jsonSchema),
  )

const defaultFormatError = (error: unknown): string =>
  P.isError(error)
    ? error.message
    : P.isString(error)
    ? error
    : 'Unknown realtime tool failure.'

const strictDefaultFor = (
  options: OpenAIRealtimeToolAdapterOptions,
): boolean => options.strictDefault ?? true

const dynamicApprovalDefaultFor = (
  options: OpenAIRealtimeToolAdapterOptions,
): boolean => options.requireApprovalForDynamicApproval ?? true

const formatErrorFor = (
  options: OpenAIRealtimeToolAdapterOptions,
): (error: unknown) => string => options.formatError ?? defaultFormatError

const normalizeToolName = Effect.fn('OpenAIRealtimeToolAdapter.normalizeName')(
  function* (toolName: string) {
    return yield* decodeToolName(toolName).pipe(
      Effect.mapError(
        error =>
          new OpenAIRealtimeToolAdapterError({
            reason: 'InvalidToolName',
            toolName,
            message: error.message,
          }),
      ),
    )
  },
)

const normalizeParameters = Effect.fn(
  'OpenAIRealtimeToolAdapter.normalizeParameters',
)(function* (toolName: string, jsonSchema: unknown) {
  return yield* decodeJsonObjectParameters(
    dereferenceLocalJsonSchema(jsonSchema),
  ).pipe(
    Effect.mapError(
      error =>
        new OpenAIRealtimeToolAdapterError({
          reason: 'InvalidParametersSchema',
          toolName,
          message: error.message,
        }),
    ),
  )
})

const normalizedProperties = (
  parameters: OpenAIRealtimeJsonObjectParameters,
) => R.map(parameters.properties, entry => ({ ...entry }))

const normalizedRequired = (
  parameters: OpenAIRealtimeJsonObjectParameters,
): Array<string> => Arr.fromIterable(parameters.required)

const normalizedDefinitions = (
  parameters: OpenAIRealtimeJsonObjectParameters,
) => ({ $defs: R.map(parameters.$defs, entry => ({ ...entry })) })

const strictParameters = (
  parameters: OpenAIRealtimeJsonObjectParameters,
) => {
  const description = Option.fromNullishOr(parameters.description)
  return Option.match(description, {
    onNone: () =>
      ({
        type: 'object',
        properties: normalizedProperties(parameters),
        required: normalizedRequired(parameters),
        additionalProperties: false,
        ...normalizedDefinitions(parameters),
      }) satisfies ToolInputParameters,
    onSome: value =>
      ({
        type: 'object',
        properties: normalizedProperties(parameters),
        required: normalizedRequired(parameters),
        additionalProperties: false,
        description: value,
        ...normalizedDefinitions(parameters),
      }) satisfies ToolInputParameters,
  })
}

const nonStrictParameters = (
  parameters: OpenAIRealtimeJsonObjectParameters,
) => {
  const description = Option.fromNullishOr(parameters.description)
  return Option.match(description, {
    onNone: () =>
      ({
        type: 'object',
        properties: normalizedProperties(parameters),
        required: normalizedRequired(parameters),
        additionalProperties: true,
        ...normalizedDefinitions(parameters),
      }) satisfies ToolInputParameters,
    onSome: value =>
      ({
        type: 'object',
        properties: normalizedProperties(parameters),
        required: normalizedRequired(parameters),
        additionalProperties: true,
        description: value,
        ...normalizedDefinitions(parameters),
      }) satisfies ToolInputParameters,
  })
}

const needsApprovalFor = (
  effectTool: Tool.Any,
  options: OpenAIRealtimeToolAdapterOptions,
): boolean => {
  const needsApproval = effectTool.needsApproval
  if (P.isBoolean(needsApproval)) {
    return needsApproval
  }
  if (P.isFunction(needsApproval)) {
    return dynamicApprovalDefaultFor(options)
  }
  return false
}

const strictModeFor = (
  effectTool: Tool.Any,
  options: OpenAIRealtimeToolAdapterOptions,
): boolean =>
  pipe(
    Option.fromNullishOr(Tool.getStrictMode(effectTool)),
    Option.getOrElse(() => strictDefaultFor(options)),
  )

const finalEncodedResult = Effect.fn(
  'OpenAIRealtimeToolAdapter.finalEncodedResult',
)(function* (
  toolName: string,
  results: ReadonlyArray<Tool.HandlerResult<Tool.Any>>,
) {
  return yield* pipe(
    results,
    Arr.findLast(result => Bool.not(result.preliminary)),
    Option.match({
      onNone: () =>
        Effect.fail(
          new OpenAIRealtimeToolAdapterError({
            reason: 'MissingFinalToolResult',
            toolName,
            message: `Effect AI tool ${toolName} completed without a final result.`,
          }),
        ),
      onSome: result => Effect.succeed(result.encodedResult),
    }),
  )
})

/**
 * Effect Toolkit currently types `handle` as accepting decoded parameters, but
 * its implementation decodes the supplied value internally. OpenAI Realtime
 * supplies encoded JSON-schema input, so this adapter must pass that raw input
 * through exactly once; pre-decoding here would turn optional fields into
 * `Option` values and make Toolkit decode fail on the second pass.
 */
const isEncodedToolkitInput = <T extends Tool.Any>(
  _effectTool: T,
  _input: unknown,
): _input is Tool.Parameters<T> => true

const executeHandledTool = Effect.fn(
  'OpenAIRealtimeToolAdapter.executeHandledTool',
)(function* <Tools extends Record<string, Tool.Any>, Name extends keyof Tools>(
  handled: Toolkit.WithHandler<Tools>,
  name: Name,
  effectTool: Tools[Name],
  input: unknown,
) {
  if (isEncodedToolkitInput(effectTool, input)) {
    const resultStream = yield* handled.handle(name, input)
    const results = yield* Stream.runCollect(resultStream)
    return yield* finalEncodedResult(effectTool.name, results)
  }

  return yield* Effect.die(
    'OpenAI realtime tool input could not be adapted to Effect Toolkit input.',
  )
})

const openAIToolWithStrictMode = (
  args: {
    readonly name: string
    readonly description: string
    readonly parameters: OpenAIRealtimeJsonObjectParameters
    readonly strict: boolean
    readonly needsApproval: boolean
    readonly execute: (input: unknown) => Promise<unknown>
    readonly formatError: (error: unknown) => string
  },
): OpenAIRealtimeFunctionTool =>
  Bool.match(args.strict, {
    onFalse: () =>
      openAiTool<ToolInputParameters, OpenAIRealtimeToolContext, unknown>(
        {
          name: args.name,
          description: args.description,
          parameters: nonStrictParameters(args.parameters),
          strict: false,
          needsApproval: args.needsApproval,
          execute: args.execute,
          errorFunction: (_context, error) => args.formatError(error),
        },
      ),
    onTrue: () =>
      openAiTool<ToolInputParameters, OpenAIRealtimeToolContext, unknown>(
        {
          name: args.name,
          description: args.description,
          parameters: strictParameters(args.parameters),
          strict: true,
          needsApproval: args.needsApproval,
          execute: args.execute,
          errorFunction: (_context, error) => args.formatError(error),
        },
      ),
  })

/**
 * Convert one handled Effect AI tool into an OpenAI Realtime function tool.
 */
export const makeOpenAIRealtimeFunctionTool = Effect.fn(
  'OpenAIRealtimeToolAdapter.makeFunctionTool',
)(function* <
  Tools extends Record<string, Tool.Any>,
  Name extends keyof Tools & string,
>(
  handled: Toolkit.WithHandler<Tools>,
  name: Name,
  runner: OpenAIRealtimeEffectRunner<Tool.HandlerServices<Tools[Name]>>,
  options: OpenAIRealtimeToolAdapterOptions = {},
) {
  const effectTool = yield* Option.match(
    Option.fromNullishOr(handled.tools[name]),
    {
      onNone: () =>
        Effect.fail(
          new OpenAIRealtimeToolAdapterError({
            reason: 'InvalidToolName',
            toolName: name,
            message: `Effect AI toolkit does not contain a tool named ${name}.`,
          }),
        ),
      onSome: Effect.succeed,
    },
  )
  const openAIName = yield* normalizeToolName(effectTool.name)
  const strict = strictModeFor(effectTool, options)
  const parameters = yield* normalizeParameters(
    effectTool.name,
    Tool.getJsonSchema(effectTool),
  )
  const description = pipe(
    Option.fromNullishOr(Tool.getDescription(effectTool)),
    Option.getOrElse(() => effectTool.name),
  )
  const formatError = formatErrorFor(options)

  return openAIToolWithStrictMode({
    name: openAIName,
    description,
    parameters,
    strict,
    needsApproval: needsApprovalFor(effectTool, options),
    execute: input =>
      runner.runPromise(
        executeHandledTool(handled, name, effectTool, input),
      ),
    formatError,
  })
})

/**
 * Convert every tool in a handled Effect AI toolkit into OpenAI Realtime
 * function tools.
 */
export const makeOpenAIRealtimeFunctionTools = Effect.fn(
  'OpenAIRealtimeToolAdapter.makeFunctionTools',
)(function* <Tools extends Record<string, Tool.Any>>(
  handled: Toolkit.WithHandler<Tools>,
  runner: OpenAIRealtimeEffectRunner<
    Tool.HandlerServices<Tools[keyof Tools]>
  >,
  options: OpenAIRealtimeToolAdapterOptions = {},
) {
  return yield* Effect.forEach(
    R.toEntries(handled.tools),
    ([name]) => makeOpenAIRealtimeFunctionTool(handled, name, runner, options),
    { concurrency: 1 },
  )
})
