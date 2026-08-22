import { describe, expect, test } from '@effect/vitest'

import { Slider } from '@foldkit/ui'

import { defaultAudioSettings } from '../src/audio/settings.ts'
import {
  FailedStartMusic,
  InteractedWithPage,
  type Model,
  SucceededStartMusic,
  update,
} from '../src/main.ts'
import { HomeRoute } from '../src/route.ts'
import * as Settings from '../src/settings/main.ts'
import * as Sketch from '../src/sketch/main.ts'

const modelWithPlaybackState = (
  musicPlaybackState: Model['musicPlaybackState'],
): Model => ({
  route: HomeRoute(),
  protocol: 'https:',
  musicPlaybackState,
  settings: Settings.init(defaultAudioSettings),
  sketch: Sketch.init(),
})

describe('audio lifecycle', () => {
  test('ignores a stale autoplay failure during an interaction attempt', () => {
    const [interacting] = update(
      modelWithPlaybackState('StartingAutoplay'),
      InteractedWithPage(),
    )
    expect(interacting.musicPlaybackState).toBe('StartingFromInteraction')

    const [afterStaleFailure] = update(
      interacting,
      FailedStartMusic({ attempt: 'Autoplay' }),
    )
    expect(afterStaleFailure.musicPlaybackState).toBe(
      'StartingFromInteraction',
    )

    const [playing] = update(
      afterStaleFailure,
      SucceededStartMusic({ attempt: 'Interaction' }),
    )
    expect(playing.musicPlaybackState).toBe('Playing')
  })

  test('returns to waiting after each failed interaction attempt', () => {
    const [waiting] = update(
      modelWithPlaybackState('StartingAutoplay'),
      FailedStartMusic({ attempt: 'Autoplay' }),
    )
    expect(waiting.musicPlaybackState).toBe('WaitingForInteraction')

    const [interacting] = update(waiting, InteractedWithPage())
    const [waitingAgain] = update(
      interacting,
      FailedStartMusic({ attempt: 'Interaction' }),
    )
    expect(waitingAgain.musicPlaybackState).toBe('WaitingForInteraction')

    const [retrying] = update(waitingAgain, InteractedWithPage())
    expect(retrying.musicPlaybackState).toBe('StartingFromInteraction')
  })

  test('cancels an unfinished slider drag and restores its origin', () => {
    const initial = Settings.init(defaultAudioSettings)
    const [pressed] = Settings.update(
      initial,
      Settings.GotMasterVolumeSliderMessage({
        message: Slider.PressedThumb({ originValue: 70 }),
      }),
    )
    const [moved, commands] = Settings.update(
      pressed,
      Settings.GotMasterVolumeSliderMessage({
        message: Slider.MovedDragPointer({ value: 90 }),
      }),
    )
    expect(moved.audioSettings.masterVolume).toBe(90)
    expect(moved.masterVolumeSlider.dragState._tag).toBe('Dragging')
    expect(commands).toEqual([])

    const cancelled = Settings.cancelActiveDrags(moved)
    expect(cancelled.audioSettings.masterVolume).toBe(70)
    expect(cancelled.masterVolumeSlider.dragState._tag).toBe('Idle')
  })
})
