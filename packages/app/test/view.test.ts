import { describe, test } from '@effect/vitest'
import { expect, given, scene, selector } from 'foldkit/scene'

import { update, view } from '../src/main.ts'

describe('Dojo view', () => {
  test('shows the Dojo concept art', () => {
    scene(
      { update, view },
      given('Ready'),
      expect(selector('[data-testid="dojo-art"]')).toExist(),
    )
  })
})
