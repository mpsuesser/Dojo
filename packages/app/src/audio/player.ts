import { Context, Duration, Effect, Layer, Ref, Semaphore } from 'effect'
import * as Arr from 'effect/Array'
import * as Bool from 'effect/Boolean'
import * as Option from 'effect/Option'
import * as Schema from 'effect/Schema'

import musicUrl from './assets/hot-springs-town.mp3'
import { type AudioSettings, effectiveMusicVolume } from './settings.ts'

/** Time spent fading music to silence when an interview begins. */
export const INTERVIEW_MUSIC_FADE_OUT_DURATION = Duration.seconds(3)

/** Quiet interval before music begins returning after an interview pauses. */
export const INTERVIEW_MUSIC_FADE_IN_DELAY = Duration.seconds(3)

/** Time spent restoring music after the post-interview quiet interval. */
export const INTERVIEW_MUSIC_FADE_IN_DURATION = Duration.seconds(5)

const MUSIC_FADE_STEPS = 60

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
    readonly fadeOutForInterview: Effect.Effect<void>
    readonly fadeInAfterInterview: Effect.Effect<void>
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
      const isInterviewMuted = yield* Ref.make(false)
      const latestSettings = yield* Ref.make<Option.Option<AudioSettings>>(
        Option.none(),
      )
      const settingsLock = yield* Semaphore.make(1)

      const fadeTo = Effect.fn('MusicPlayer.fadeTo')(function* (
        targetVolume: number,
        duration: Duration.Duration,
      ) {
        const initialVolume = audio.volume
        const stepDuration = Duration.millis(
          Duration.toMillis(duration) / MUSIC_FADE_STEPS,
        )
        yield* Effect.forEach(
          Arr.range(1, MUSIC_FADE_STEPS),
          step =>
            Effect.sleep(stepDuration).pipe(
              Effect.andThen(
                Effect.sync(() => {
                  const progress = step / MUSIC_FADE_STEPS
                  audio.volume = initialVolume + (targetVolume - initialVolume) * progress
                }),
              ),
            ),
          { concurrency: 1, discard: true },
        )
      })

      const setSettings = Effect.fn('MusicPlayer.setSettings')((settings: AudioSettings) =>
        settingsLock.withPermit(
          Effect.gen(function* () {
            yield* Ref.set(latestSettings, Option.some(settings))
            yield* Bool.match(yield* Ref.get(isInterviewMuted), {
              onFalse: () =>
                Effect.sync(() => {
                  audio.volume = effectiveMusicVolume(settings)
                }),
              onTrue: () => Effect.void,
            })
          }),
        )
      )

      const fadeOutForInterview = Effect.gen(function* () {
        yield* settingsLock.withPermit(Ref.set(isInterviewMuted, true))
        yield* fadeTo(0, INTERVIEW_MUSIC_FADE_OUT_DURATION)
      }).pipe(Effect.withSpan('MusicPlayer.fadeOutForInterview'))

      const fadeInAfterInterview = Effect.gen(function* () {
        yield* Effect.sleep(INTERVIEW_MUSIC_FADE_IN_DELAY)
        const initialSettings = yield* Ref.get(latestSettings)
        const targetVolume = Option.match(initialSettings, {
          onNone: () => 0,
          onSome: effectiveMusicVolume,
        })
        yield* fadeTo(targetVolume, INTERVIEW_MUSIC_FADE_IN_DURATION)
        yield* settingsLock.withPermit(
          Effect.gen(function* () {
            const latest = yield* Ref.get(latestSettings)
            yield* Effect.sync(() => {
              audio.volume = Option.match(latest, {
                onNone: () => 0,
                onSome: effectiveMusicVolume,
              })
            })
            yield* Ref.set(isInterviewMuted, false)
          }),
        )
      }).pipe(Effect.withSpan('MusicPlayer.fadeInAfterInterview'))

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

      return MusicPlayer.of({
        ensureStarted,
        fadeInAfterInterview,
        fadeOutForInterview,
        start,
        setSettings,
      })
    }),
  )
}
