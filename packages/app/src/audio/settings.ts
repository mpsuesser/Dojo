import * as Schema from 'effect/Schema'

/** A user-facing audio level expressed as a percentage. */
export const Volume = Schema.Finite.check(
  Schema.isBetween({ minimum: 0, maximum: 100 }),
).annotate({
  title: 'Volume',
  description: 'An audio level from 0 to 100 percent.',
})
export type Volume = typeof Volume.Type

/** Persisted volume levels for each Dojo audio channel. */
export class AudioSettings extends Schema.Class<AudioSettings>('AudioSettings')({
  masterVolume: Volume,
  musicVolume: Volume,
  voiceVolume: Volume,
  soundEffectsVolume: Volume,
}) {}

/** Conservative initial levels that keep the background score unobtrusive. */
export const defaultAudioSettings = new AudioSettings({
  masterVolume: 70,
  musicVolume: 45,
  voiceVolume: 75,
  soundEffectsVolume: 75,
})

/** Resolve the effective HTML media volume after master and music levels combine. */
export const effectiveMusicVolume = (settings: AudioSettings): number =>
  (settings.masterVolume / 100) * (settings.musicVolume / 100)
