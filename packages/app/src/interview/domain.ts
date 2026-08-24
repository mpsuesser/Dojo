import { Order, pipe } from 'effect'
import * as Arr from 'effect/Array'
import * as Bool from 'effect/Boolean'
import * as Option from 'effect/Option'
import * as Schema from 'effect/Schema'
import * as Str from 'effect/String'
import { ts } from 'foldkit/schema'

import { OpenAiApiKey } from '../openai/api-key.ts'

/** User-authored configuration that defines one interview's purpose. */
export class InterviewConfiguration extends Schema.Class<InterviewConfiguration>(
  'InterviewConfiguration',
)({
  interviewObjectives: Schema.String,
  backgroundContext: Schema.String,
}) {}

export const TranscriptRole = Schema.Literals(['user', 'interviewer'])
export type TranscriptRole = typeof TranscriptRole.Type

export const TranscriptStatus = Schema.Literals([
  'in_progress',
  'completed',
  'incomplete',
])
export type TranscriptStatus = typeof TranscriptStatus.Type

/** One normalized spoken turn retained from OpenAI Realtime history. */
export class TranscriptTurn extends Schema.Class<TranscriptTurn>(
  'TranscriptTurn',
)({
  id: Schema.String,
  role: TranscriptRole,
  text: Schema.String,
  status: TranscriptStatus,
}) {}

/** Searchable metadata distilled after an interview pauses. */
export class InterviewSessionMetadata extends Schema.Class<InterviewSessionMetadata>(
  'InterviewSessionMetadata',
)({
  title: Schema.String,
  description: Schema.String,
  tags: Schema.Array(Schema.String),
}) {}

/** Durable local record for a configured interview and its transcript. */
export class InterviewSession extends Schema.Class<InterviewSession>(
  'InterviewSession',
)({
  id: Schema.String,
  config: InterviewConfiguration,
  title: Schema.String,
  description: Schema.String,
  tags: Schema.Array(Schema.String),
  createdAt: Schema.Finite,
  lastActivatedAt: Schema.Finite,
  transcript: Schema.Array(TranscriptTurn),
}) {}

export const ChooseInterview = ts('ChooseInterview')
export const ConfigureInterview = ts('ConfigureInterview')
export const BrowseInterviews = ts('BrowseInterviews', {
  query: Schema.String,
})
export const ReviewInterview = ts('ReviewInterview', {
  sessionId: Schema.String,
})

export const RealtimeConnectionState = Schema.Literals([
  'Connecting',
  'Connected',
])
export type RealtimeConnectionState = typeof RealtimeConnectionState.Type

export const ActiveInterview = ts('ActiveInterview', {
  sessionId: Schema.String,
  activationId: Schema.String,
  connectionState: RealtimeConnectionState,
  initialTranscript: Schema.Array(TranscriptTurn),
})

export const InterviewScreen = Schema.Union([
  ChooseInterview,
  ConfigureInterview,
  BrowseInterviews,
  ReviewInterview,
  ActiveInterview,
])
export type InterviewScreen = typeof InterviewScreen.Type

export const TranscriptCopyState = Schema.Literals([
  'Idle',
  'Copying',
  'Copied',
  'Failed',
])
export type TranscriptCopyState = typeof TranscriptCopyState.Type

export const MusicDuckingState = Schema.Literals([
  'Neutral',
  'Muted',
  'Restoring',
])
export type MusicDuckingState = typeof MusicDuckingState.Type

/** Pure Interview feature state. Stateful SDK handles live outside this model. */
export class Model extends Schema.Class<Model>('InterviewModel')({
  sessions: Schema.Array(InterviewSession),
  openAiApiKey: OpenAiApiKey,
  screen: InterviewScreen,
  activationRequestId: Schema.Natural,
  activationPending: Schema.Boolean,
  interviewObjectivesDraft: Schema.String,
  backgroundContextDraft: Schema.String,
  transcriptCopyState: TranscriptCopyState,
  musicDuckingState: MusicDuckingState,
  notice: Schema.Option(Schema.String),
}) {}

/** Initial Interview state, preserving any locally loaded sessions. */
export const init = (
  openAiApiKey: OpenAiApiKey,
  sessions: ReadonlyArray<InterviewSession> = [],
): Model =>
  new Model({
    sessions,
    openAiApiKey,
    screen: ChooseInterview(),
    activationRequestId: 0,
    activationPending: false,
    interviewObjectivesDraft: '',
    backgroundContextDraft: '',
    transcriptCopyState: 'Idle',
    musicDuckingState: 'Neutral',
    notice: Option.none(),
  })

const mostRecentlyActivated = Order.flip(
  Order.mapInput(
    Order.Number,
    (session: InterviewSession) => session.lastActivatedAt,
  ),
)

/** Sessions ordered by the most recent activation. */
export const recentSessions = (
  sessions: ReadonlyArray<InterviewSession>,
): ReadonlyArray<InterviewSession> => Arr.sort(sessions, mostRecentlyActivated)

/** Find one durable session by its stable identifier. */
export const findSession = (
  sessions: ReadonlyArray<InterviewSession>,
  sessionId: string,
): Option.Option<InterviewSession> =>
  pipe(
    sessions,
    Arr.findFirst(session => session.id === sessionId),
  )

const searchableSessionText = (session: InterviewSession): string =>
  pipe(
    [
      session.title,
      session.description,
      session.config.interviewObjectives,
      session.config.backgroundContext,
      ...session.tags,
    ],
    Arr.join(' '),
    Str.toLowerCase,
  )

/** Lightweight fuzzy-style filtering across metadata, tags, and configuration. */
export const filterSessions = (
  sessions: ReadonlyArray<InterviewSession>,
  query: string,
): ReadonlyArray<InterviewSession> => {
  const normalizedQuery = pipe(query, Str.trim, Str.toLowerCase)
  return Bool.match(Str.isEmpty(normalizedQuery), {
    onFalse: () =>
      pipe(
        sessions,
        Arr.filter(session => pipe(searchableSessionText(session), Str.includes(normalizedQuery))),
        recentSessions,
      ),
    onTrue: () => recentSessions(sessions),
  })
}

/** Render transcript text for display and clipboard export. */
export const transcriptText = (
  transcript: ReadonlyArray<TranscriptTurn>,
): string =>
  pipe(
    transcript,
    Arr.map(turn => `${turn.role === 'user' ? 'You' : 'Interviewer'}: ${turn.text}`),
    Arr.join('\n\n'),
  )

/** Construct conservative metadata while AI-generated metadata is pending. */
export const pendingMetadata = new InterviewSessionMetadata({
  title: 'Untitled interview',
  description: 'Session metadata is being distilled from the conversation.',
  tags: [],
})
