import { describe, test } from '@effect/vitest'
import { expect, given, role, scene, selector } from 'foldkit/scene'

import { defaultAudioSettings } from '../src/audio/settings.ts'
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
})

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
      expect(role('heading', { name: 'Sound' })).toExist(),
      expect(role('slider', { name: 'Master Volume' })).toExist(),
      expect(role('slider', { name: 'Music Volume' })).toExist(),
      expect(role('slider', { name: 'Voice Volume' })).toExist(),
      expect(role('slider', { name: 'Sound Effects Volume' })).toExist(),
      expect(role('button', { name: 'Return to Dojo' })).toExist(),
      expect(role('navigation')).not.toExist(),
    )
  })

  test.each([
    [InterrogationRoute(), 'interrogation-splash', 'Interrogation'],
    [InterviewRoute(), 'interview-splash', 'Interview'],
  ])('shows the feature heading for the %s route', (route, testId, title) => {
    scene(
      { update, view },
      given(modelFor(route)),
      expect(selector(`[data-testid="${testId}"]`)).toExist(),
      expect(role('heading', { name: title })).toExist(),
      expect(role('link', { name: 'Return to Dojo' })).toExist(),
      expect(role('navigation')).not.toExist(),
    )
  })
})
