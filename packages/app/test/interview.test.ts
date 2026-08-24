import { describe, expect, test } from '@effect/vitest'
import * as Option from 'effect/Option'
import * as Redacted from 'effect/Redacted'

import { ActiveInterview, ReviewInterview, TranscriptTurn } from '../src/interview/domain.ts'
import {
  ChangedBackgroundContext,
  ChangedInterviewObjectives,
  ClickedBeginInterview,
  ClickedClose,
  ClickedConfigureNew,
  ClickedLoadSession,
  ClickedPauseInterview,
  ClickedResumeInterview,
  CompletedActivateInterview,
  CompletedCreateInterview,
  FailedAcquireRealtimeInterview,
  init,
  InterviewConfiguration,
  InterviewSession,
  managedResources,
  ReceivedRealtimeInterviewEvent,
  subscriptions,
  update,
} from '../src/interview/main.ts'
import {
  RealtimeTranscriptUpdated,
  RealtimeTransportDisconnected,
} from '../src/interview/realtime.ts'

const apiKey = Redacted.make('sk-test', { label: 'OpenAI API key' })

const session = new InterviewSession({
  id: 'session-1',
  config: new InterviewConfiguration({
    interviewObjectives: 'Understand the decision.',
    backgroundContext: 'The team is choosing a database.',
  }),
  title: 'Database decision',
  description: 'A discussion of the database tradeoffs.',
  tags: ['database', 'architecture'],
  createdAt: 1,
  lastActivatedAt: 1,
  transcript: [],
})

describe('Interview state machine', () => {
  test('preserves configuration drafts in the pure model', () => {
    const [configuring] = update(init(apiKey), ClickedConfigureNew())
    const [withObjectives] = update(
      configuring,
      ChangedInterviewObjectives({ value: 'Find the root cause.' }),
    )
    const [withContext] = update(
      withObjectives,
      ChangedBackgroundContext({ value: 'Two prior attempts failed.' }),
    )

    expect(withContext.interviewObjectivesDraft).toBe('Find the root cause.')
    expect(withContext.backgroundContextDraft).toBe('Two prior attempts failed.')
  })

  test('starts, transcribes, and pauses a session through explicit events', () => {
    const initial = init(apiKey)
    expect(initial.shouldPersistSessions).toBe(false)
    expect(
      subscriptions.persistSessions.modelToDependencies(initial)
        .shouldPersistSessions,
    ).toBe(false)

    const [pending] = update(initial, ClickedBeginInterview())
    const [active] = update(
      pending,
      CompletedCreateInterview({
        requestId: pending.activationRequestId,
        session,
        activationId: 'activation-1',
      }),
    )
    expect(active.screen).toEqual(
      ActiveInterview({
        sessionId: 'session-1',
        activationId: 'activation-1',
        connectionState: 'Connecting',
        initialTranscript: [],
      }),
    )
    expect(active.musicDuckingState).toBe('Muted')
    expect(active.shouldPersistSessions).toBe(true)

    const transcript = [
      new TranscriptTurn({
        id: 'turn-1',
        role: 'interviewer',
        text: 'What made this decision difficult?',
        status: 'completed',
      }),
    ]
    const [transcribed] = update(
      active,
      ReceivedRealtimeInterviewEvent({
        event: new RealtimeTranscriptUpdated({
          activationId: 'activation-1',
          transcript,
        }),
      }),
    )
    expect(transcribed.sessions[0]?.transcript).toEqual(transcript)
    expect(
      managedResources.realtimeInterview.modelToMaybeRequirements(transcribed),
    ).toEqual(
      managedResources.realtimeInterview.modelToMaybeRequirements(active),
    )

    const [paused, commands] = update(transcribed, ClickedPauseInterview())
    expect(paused.screen).toEqual(ReviewInterview({ sessionId: 'session-1' }))
    expect(paused.musicDuckingState).toBe('Restoring')
    expect(commands.map(command => command.name)).toEqual([
      'GenerateInterviewMetadata',
    ])
  })

  test('ignores a create completion after its activation was canceled', () => {
    const [pending] = update(init(apiKey), ClickedBeginInterview())
    const [closed] = update(pending, ClickedClose())
    const [afterCompletion] = update(
      closed,
      CompletedCreateInterview({
        requestId: pending.activationRequestId,
        session,
        activationId: 'activation-1',
      }),
    )

    expect(afterCompletion.sessions).toEqual([])
    expect(afterCompletion.activationPending).toBe(false)
  })

  test('ignores a resume completion after its activation was canceled', () => {
    const [reviewing] = update(
      init(apiKey, [session]),
      ClickedLoadSession({ sessionId: session.id }),
    )
    const [pending] = update(
      reviewing,
      ClickedResumeInterview({ sessionId: session.id }),
    )
    const [closed] = update(pending, ClickedClose())
    const [afterCompletion] = update(
      closed,
      CompletedActivateInterview({
        requestId: pending.activationRequestId,
        sessionId: session.id,
        activationId: 'activation-1',
        activatedAt: 2,
      }),
    )

    expect(afterCompletion.screen).toEqual(
      ReviewInterview({ sessionId: session.id }),
    )
    expect(afterCompletion.activationPending).toBe(false)
  })

  test('pauses the current session when its transport disconnects', () => {
    const [pending] = update(init(apiKey), ClickedBeginInterview())
    const [active] = update(
      pending,
      CompletedCreateInterview({
        requestId: pending.activationRequestId,
        session,
        activationId: 'activation-1',
      }),
    )
    const [paused, commands] = update(
      active,
      ReceivedRealtimeInterviewEvent({
        event: new RealtimeTransportDisconnected({
          activationId: 'activation-1',
        }),
      }),
    )

    expect(paused.screen).toEqual(ReviewInterview({ sessionId: 'session-1' }))
    expect(Option.getOrElse(paused.notice, () => '')).toBe(
      'The voice channel disconnected. Your session was paused.',
    )
    expect(commands.map(command => command.name)).toEqual([
      'GenerateInterviewMetadata',
    ])
  })

  test('preserves the provider error when Realtime acquisition fails', () => {
    const [pending] = update(init(apiKey), ClickedBeginInterview())
    const [active] = update(
      pending,
      CompletedCreateInterview({
        requestId: pending.activationRequestId,
        session,
        activationId: 'activation-1',
      }),
    )
    const providerError =
      'Realtime call request failed with status 429: You exceeded your current quota.'
    const [paused, commands] = update(
      active,
      FailedAcquireRealtimeInterview({ error: providerError }),
    )

    expect(paused.screen).toEqual(ReviewInterview({ sessionId: session.id }))
    expect(Option.getOrElse(paused.notice, () => '')).toBe(providerError)
    expect(commands.map(command => command.name)).toEqual([
      'GenerateInterviewMetadata',
    ])
  })
})
