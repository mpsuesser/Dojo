import { Context, Effect, Layer, Ref } from 'effect'
import * as Bool from 'effect/Boolean'
import * as Schema from 'effect/Schema'

import musicUrl from './assets/hot-springs-town.mp3'
import { type AudioSettings, effectiveMusicVolume } from './settings.ts'

/** Lifecycle states for browser background-music playback. */
export const MusicPlaybackState = Schema.Literals([
  'StartingAutoplay',
  'StartingFromInteraction',
  'WaitingForInteraction',
  'Playing',
])
export type MusicPlaybackState = typeof MusicPlaybackState.Type

/** The event that initiated a background-music playback attempt. */
export const MusicStartAttempt = Schema.Literals([
  'Autoplay',
  'Interaction',
  'Resume',
])
export type MusicStartAttempt = typeof MusicStartAttempt.Type

/** Failure returned when the browser declines or cannot begin music playback. */
export class MusicPlaybackError extends Schema.TaggedError<MusicPlaybackError>()(
  'MusicPlaybackError',
  {
    message: Schema.String,
    cause: Schema.Defect(),
  },
  { description: 'The background music could not begin playback.' },
) {}

/** App-lifetime control surface for Dojo background music. */
export class MusicPlayer extends Context.Service<
  MusicPlayer,
  {
    readonly start: (
      settings: AudioSettings,
    ) => Effect.Effect<void, MusicPlaybackError>
    readonly ensureStarted: (
      settings: AudioSettings,
    ) => Effect.Effect<void, MusicPlaybackError>
    readonly setSettings: (settings: AudioSettings) => Effect.Effect<void>
  }
>()('dojo/audio/MusicPlayer') {
  /** Browser-backed music player shared for the lifetime of the runtime. */
  static readonly layer = Layer.effect(
    MusicPlayer,
    Effect.gen(function* () {
      const audio = yield* Effect.acquireRelease(
        Effect.sync(() => {
          const element = document.createElement('audio')
          element.src = musicUrl
          element.loop = true
          element.preload = 'auto'
          element.volume = 0
          element.hidden = true
          element.dataset.dojoBackgroundMusic = 'hot-springs-town'
          document.body.append(element)
          return element
        }),
        element =>
          Effect.sync(() => {
            element.pause()
            element.removeAttribute('src')
            element.load()
            element.remove()
          }),
      )
      const hasStarted = yield* Ref.make(false)

      const setSettings = Effect.fn('MusicPlayer.setSettings')(function* (
        settings: AudioSettings,
      ) {
        yield* Effect.sync(() => {
          audio.volume = effectiveMusicVolume(settings)
        })
      })

      const play = Effect.fn('MusicPlayer.play')(function* () {
        yield* Effect.tryPromise({
          try: () => audio.play(),
          catch: cause =>
            new MusicPlaybackError({
              message: 'Background music could not start.',
              cause,
            }),
        })
        yield* Ref.set(hasStarted, true)
      })

      const start = Effect.fn('MusicPlayer.start')(function* (
        settings: AudioSettings,
      ) {
        yield* setSettings(settings)
        yield* play()
      })

      const ensureStarted = Effect.fn('MusicPlayer.ensureStarted')(function* (
        settings: AudioSettings,
      ) {
        yield* setSettings(settings)
        yield* Bool.match(yield* Ref.get(hasStarted), {
          onFalse: play,
          onTrue: () => Effect.void,
        })
      })

      return MusicPlayer.of({ ensureStarted, start, setSettings })
    }),
  )
}
