import * as OpenAiClient from '@effect/ai-openai/OpenAiClient'
import * as OpenAiLanguageModel from '@effect/ai-openai/OpenAiLanguageModel'
import { BrowserHttpClient } from '@effect/platform-browser'
import { Effect, Layer } from 'effect'
import * as P from 'effect/Predicate'
import * as Schema from 'effect/Schema'
import * as LanguageModel from 'effect/unstable/ai/LanguageModel'

import { type OpenAiApiKey } from '../openai/api-key.ts'
import { type InterviewSession, InterviewSessionMetadata, transcriptText } from './domain.ts'

const SESSION_METADATA_MODEL = 'gpt-5.6-luna'

/** Failure while distilling searchable interview metadata. */
export class InterviewMetadataError extends Schema.TaggedError<InterviewMetadataError>()(
  'InterviewMetadataError',
  { message: Schema.String },
  { description: 'OpenAI could not generate interview session metadata.' },
) {}

const metadataLayer = (apiKey: OpenAiApiKey) =>
  OpenAiLanguageModel.layer({ model: SESSION_METADATA_MODEL }).pipe(
    Layer.provide(
      OpenAiClient.layer({ apiKey }).pipe(
        Layer.provide(BrowserHttpClient.layerFetch),
      ),
    ),
  )

/** Generate compact title, description, and tags after an interview pauses. */
export const generateInterviewMetadata = Effect.fn(
  'Interview.generateMetadata',
)(function* (session: InterviewSession, apiKey: OpenAiApiKey) {
  const response = yield* LanguageModel.generateObject({
    objectName: 'interview_session_metadata',
    schema: InterviewSessionMetadata,
    prompt: `Create retrieval metadata for this interview session.

Requirements:
- title: specific, plain language, at most 8 words
- description: one sentence describing the useful substance of the conversation
- tags: 2 to 6 short lowercase topic tags, with no duplicates
- do not mention that this is a transcript or an AI conversation

Interview objectives:
${session.config.interviewObjectives}

Background context:
${session.config.backgroundContext}

Conversation:
${transcriptText(session.transcript)}`,
  }).pipe(
    Effect.provide(metadataLayer(apiKey)),
    Effect.mapError(error =>
      new InterviewMetadataError({
        message: P.isError(error)
          ? error.message
          : 'Unknown interview metadata failure.',
      })
    ),
  )
  return response.value
})
