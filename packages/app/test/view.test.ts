import { OPENAI_API_KEYS_URL } from '@dojo/shared'
import { describe, test } from '@effect/vitest'
import * as Redacted from 'effect/Redacted'
import { expect, given, role, scene, selector } from 'foldkit/scene'

import { defaultAudioSettings } from '../src/audio/settings.ts'
import { TranscriptTurn } from '../src/interview/domain.ts'
import * as Interview from '../src/interview/main.ts'
import { type Model, update, view } from '../src/main.ts'
import {
  type AppRoute,
  ArchivifyRoute,
  HomeRoute,
  InterrogationRoute,
  InterviewRoute,
  SettingsRoute,
  SketchRoute,
} from '../src/route.ts'
import * as Settings from '../src/settings/main.ts'
import * as Sketch from '../src/sketch/main.ts'

const modelFor = (route: AppRoute): Model => ({
  route,
  protocol: 'https:',
  musicPlaybackState: 'WaitingForInteraction',
  settings: Settings.init(defaultAudioSettings),
  sketch: Sketch.init(),
  interview: Interview.init(Settings.emptyOpenAiApiKey),
})

const interviewApiKey = Redacted.make('sk-test', {
  label: 'OpenAI API key',
})

const interviewSession = new Interview.InterviewSession({
  id: 'session-1',
  config: new Interview.InterviewConfiguration({
    interviewObjectives: 'Understand the decision.',
    backgroundContext: 'The team is choosing a database.',
  }),
  title: 'Database decision',
  description: 'A discussion of the database tradeoffs.',
  tags: ['database', 'architecture'],
  createdAt: 1,
  lastActivatedAt: 1,
  transcript: [
    new TranscriptTurn({
      id: 'turn-1',
      role: 'interviewer',
      text: 'What made this decision difficult?',
      status: 'completed',
    }),
  ],
})

const activeInterviewModel = (): Interview.Model => {
  const [pending] = Interview.update(
    Interview.init(interviewApiKey),
    Interview.ClickedBeginInterview(),
  )
  const [active] = Interview.update(
    pending,
    Interview.CompletedCreateInterview({
      requestId: pending.activationRequestId,
      session: interviewSession,
      activationId: 'activation-1',
    }),
  )
  return active
}

describe('Dojo view', () => {
  test('shows the Dojo menu on the home route', () => {
    scene(
      { update, view },
      given(modelFor(HomeRoute())),
      expect(selector('[data-testid="scene-stage"]')).toExist(),
      expect(selector('[data-testid="dojo-art"]')).toExist(),
      expect(role('heading', { name: 'Dojo' })).toExist(),
      expect(role('link', { name: 'Sketch' })).toExist(),
      expect(role('link', { name: 'Archivify' })).toExist(),
      expect(role('link', { name: 'Interrogation' })).toExist(),
      expect(role('link', { name: 'Interview' })).toExist(),
      expect(role('link', { name: 'Settings' })).toExist(),
    )
  })

  test('shows the Archivify heading on the Archivify route', () => {
    scene(
      { update, view },
      given(modelFor(ArchivifyRoute())),
      expect(selector('[data-testid="archivify-page"]')).toExist(),
      expect(selector('[data-testid="archivify-splash"]')).toExist(),
      expect(role('heading', { name: 'Archivify' })).toExist(),
      expect(role('link', { name: 'Return to Dojo' })).toExist(),
      expect(role('navigation')).not.toExist(),
    )
  })

  test('shows the sketch workspace on the sketch route', () => {
    scene(
      { update, view },
      given(modelFor(SketchRoute())),
      expect(selector('[data-testid="sketch-workspace"]')).toExist(),
      expect(selector('[data-testid="sketch-art"]')).toExist(),
      expect(selector('[data-testid="sketch-editor"]')).toExist(),
      expect(role('button', { name: 'Return to Dojo' })).toExist(),
      expect(role('button', { name: 'Copy image' })).toExist(),
      expect(role('toolbar', { name: 'Drawing tools' })).toExist(),
      expect(role('navigation')).not.toExist(),
    )
  })

  test('shows the audio controls on the settings route', () => {
    scene(
      { update, view },
      given(modelFor(SettingsRoute())),
      expect(selector('[data-testid="settings-page"]')).toExist(),
      expect(selector('[data-testid="settings-art"]')).toExist(),
      expect(role('heading', { name: 'Settings' })).toExist(),
      expect(role('slider', { name: 'Master Volume' })).toExist(),
      expect(role('slider', { name: 'Music Volume' })).toExist(),
      expect(role('slider', { name: 'Voice Volume' })).toExist(),
      expect(role('slider', { name: 'Sound Effects Volume' })).toExist(),
      expect(role('textbox', { name: 'OpenAI API Key' })).toExist(),
      expect(role('button', { name: 'Show OpenAI API key' })).toExist(),
      expect(role('link', { name: 'Get an API key' })).toHaveAttr(
        'href',
        OPENAI_API_KEYS_URL,
      ),
      expect(role('link', { name: 'Get an API key' })).toHaveAttr(
        'target',
        '_blank',
      ),
      expect(role('link', { name: 'Get an API key' })).toHaveAttr(
        'rel',
        'noopener noreferrer',
      ),
      expect(role('button', { name: 'Return to Dojo' })).toExist(),
      expect(role('navigation')).not.toExist(),
    )
  })

  test('shows the Interrogation feature heading', () => {
    scene(
      { update, view },
      given(modelFor(InterrogationRoute())),
      expect(selector('[data-testid="interrogation-splash"]')).toExist(),
      expect(role('heading', { name: 'Interrogation' })).toExist(),
      expect(role('link', { name: 'Return to Dojo' })).toExist(),
      expect(role('navigation')).not.toExist(),
    )
  })

  test('shows the Interview session chooser', () => {
    scene(
      { update, view },
      given(modelFor(InterviewRoute())),
      expect(selector('[data-testid="interview-page"]')).toExist(),
      expect(selector('[data-testid="interview-splash"]')).toExist(),
      expect(role('heading', { name: 'Interview' })).toExist(),
      expect(role('button', { name: 'Return to Dojo' })).toExist(),
      expect(role('button', { name: /Begin a new interview/ })).toExist(),
      expect(role('button', { name: /Load a previous session/ })).toExist(),
      expect(role('dialog')).not.toExist(),
      expect(role('navigation')).not.toExist(),
    )
  })

  test('keeps the live Interview scene focused on its pause control', () => {
    scene(
      { update, view },
      given({
        ...modelFor(InterviewRoute()),
        interview: activeInterviewModel(),
      }),
      expect(role('button', { name: 'Pause interview' })).toExist(),
      expect(selector('[data-testid="interview-energy-field"]')).toHaveAttr(
        'aria-hidden',
        'true',
      ),
      expect(selector('.interview-energy-trail-head')).toExist(),
      expect(selector('.interview-transcript')).not.toExist(),
    )
  })

  test('reveals the Interview transcript after pausing', () => {
    const [paused] = Interview.update(
      activeInterviewModel(),
      Interview.ClickedPauseInterview(),
    )

    scene(
      { update, view },
      given({
        ...modelFor(InterviewRoute()),
        interview: paused,
      }),
      expect(selector('.interview-transcript')).toExist(),
      expect(selector('[data-testid="interview-energy-field"]')).not.toExist(),
      expect(role('button', { name: 'Pause interview' })).not.toExist(),
    )
  })
})
