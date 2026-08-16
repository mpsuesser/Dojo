import { describe, test } from '@effect/vitest'
import { expect, given, role, scene, selector } from 'foldkit/scene'

import { update, view } from '../src/main.ts'
import * as Sketch from '../src/sketch/main.ts'
import {
  HomeRoute,
  InterrogationRoute,
  InterviewRoute,
  SettingsRoute,
  SketchRoute,
} from '../src/route.ts'

describe('Dojo view', () => {
  test('shows the Dojo menu on the home route', () => {
    scene(
      { update, view },
      given({ route: HomeRoute(), protocol: 'https:', sketch: Sketch.init() }),
      expect(selector('[data-testid="dojo-art"]')).toExist(),
      expect(role('heading', { name: 'Dojo' })).toExist(),
      expect(role('link', { name: 'Sketch' })).toExist(),
      expect(role('link', { name: 'Interrogation' })).toExist(),
      expect(role('link', { name: 'Interview' })).toExist(),
      expect(role('link', { name: 'Settings' })).toExist(),
    )
  })

  test('shows the sketch workspace on the sketch route', () => {
    scene(
      { update, view },
      given({ route: SketchRoute(), protocol: 'https:', sketch: Sketch.init() }),
      expect(selector('[data-testid="sketch-workspace"]')).toExist(),
      expect(selector('[data-testid="sketch-art"]')).toExist(),
      expect(selector('[data-testid="sketch-editor"]')).toExist(),
      expect(role('button', { name: 'Copy image' })).toExist(),
      expect(role('toolbar', { name: 'Drawing tools' })).toExist(),
      expect(role('navigation')).not.toExist(),
    )
  })

  test.each([
    [InterrogationRoute(), 'interrogation-splash'],
    [InterviewRoute(), 'interview-splash'],
    [SettingsRoute(), 'settings-splash'],
  ])('shows only the splash for the %s route', (route, testId) => {
    scene(
      { update, view },
      given({ route, protocol: 'https:', sketch: Sketch.init() }),
      expect(selector(`[data-testid="${testId}"]`)).toExist(),
      expect(role('navigation')).not.toExist(),
    )
  })
})
