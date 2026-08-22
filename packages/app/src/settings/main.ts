import { Duration, Effect, Match as M, Option, Stream } from 'effect'
import * as Redacted from 'effect/Redacted'
import * as Schema from 'effect/Schema'
import { Command, Subscription } from 'foldkit'
import type { Html, HtmlBuilder } from 'foldkit/html'
import { m } from 'foldkit/message'
import { evo } from 'foldkit/struct'
import * as Submodel from 'foldkit/submodel'

import { Slider } from '@foldkit/ui'

import settingsArtUrl from '../../../../docs/generated-concept-art/06-inner-courtyard.png'
import { type MusicPlaybackState, MusicPlayer } from '../audio/player.ts'
import { AudioSettings, defaultAudioSettings, type Volume } from '../audio/settings.ts'
import backIconUrl from '../icons/back.svg'
import visibilityOffIconUrl from '../icons/visibility-off.svg'
import visibilityIconUrl from '../icons/visibility.svg'
import { emptyOpenAiApiKey, OpenAiApiKey, OpenAiApiKeyFromValue } from '../openai/api-key.ts'

export { emptyOpenAiApiKey, hasOpenAiApiKey, OpenAiApiKey } from '../openai/api-key.ts'

const AUDIO_SETTINGS_STORAGE_KEY = 'dojo.audio-settings.v1'
const OPENAI_API_KEY_STORAGE_KEY = 'dojo.openai-api-key.v1'
const SETTINGS_SAVE_DELAY = Duration.millis(180)
const AudioSettingsJson = Schema.fromJsonString(AudioSettings)

const OpenAiApiKeyJson = Schema.fromJsonString(OpenAiApiKeyFromValue)

class AudioSettingsStorageError extends Schema.TaggedError<AudioSettingsStorageError>()(
  'AudioSettingsStorageError',
  {
    operation: Schema.Literals(['Read', 'Write']),
    cause: Schema.Defect(),
  },
  { description: 'Browser storage was unavailable for audio settings.' },
) {}

class OpenAiApiKeyStorageError extends Schema.TaggedError<OpenAiApiKeyStorageError>()(
  'OpenAiApiKeyStorageError',
  {
    operation: Schema.Literals(['Read', 'Write']),
    cause: Schema.Defect(),
  },
  { description: 'Browser storage was unavailable for the OpenAI API key.' },
) {}

const readStoredAudioSettings = Effect.fn('AudioSettings.readStored')(
  function* () {
    const stored = yield* Effect.try({
      try: () => localStorage.getItem(AUDIO_SETTINGS_STORAGE_KEY),
      catch: cause => new AudioSettingsStorageError({ operation: 'Read', cause }),
    })
    return yield* Option.match(Option.fromNullishOr(stored), {
      onNone: () => Effect.succeed(defaultAudioSettings),
      onSome: Schema.decodeUnknownEffect(AudioSettingsJson),
    })
  },
)

/** Load schema-decoded audio settings, falling back when storage is unavailable. */
export const loadAudioSettings: Effect.Effect<AudioSettings> = readStoredAudioSettings().pipe(
  Effect.catch(() =>
    Effect.logWarning(
      'Stored audio settings were unavailable; using defaults.',
    ).pipe(Effect.as(defaultAudioSettings))
  ),
)

const readStoredOpenAiApiKey = Effect.fn('OpenAiApiKey.readStored')(
  function* () {
    const stored = yield* Effect.try({
      try: () => localStorage.getItem(OPENAI_API_KEY_STORAGE_KEY),
      catch: cause => new OpenAiApiKeyStorageError({ operation: 'Read', cause }),
    })
    return yield* Option.match(Option.fromNullishOr(stored), {
      onNone: () => Effect.succeed(emptyOpenAiApiKey),
      onSome: Schema.decodeUnknownEffect(OpenAiApiKeyJson),
    })
  },
)

/** Load the locally stored OpenAI key without exposing it to logs. */
export const loadOpenAiApiKey: Effect.Effect<OpenAiApiKey> = readStoredOpenAiApiKey().pipe(
  Effect.catch(() =>
    Effect.logWarning(
      'Stored OpenAI credentials were unavailable; continuing without a key.',
    ).pipe(Effect.as(emptyOpenAiApiKey))
  ),
)

const saveAudioSettings = Effect.fn('AudioSettings.save')(function* (
  settings: AudioSettings,
) {
  const encoded = yield* Schema.encodeUnknownEffect(AudioSettingsJson)(settings)
  yield* Effect.try({
    try: () => localStorage.setItem(AUDIO_SETTINGS_STORAGE_KEY, encoded),
    catch: cause => new AudioSettingsStorageError({ operation: 'Write', cause }),
  })
})

const persistAudioSettings = Effect.fn('AudioSettings.persist')(function* (
  settings: AudioSettings,
) {
  yield* Effect.sleep(SETTINGS_SAVE_DELAY)
  yield* saveAudioSettings(settings).pipe(
    Effect.catch(() => Effect.logWarning('Audio settings could not be persisted.')),
  )
})

const saveOpenAiApiKey = Effect.fn('OpenAiApiKey.save')(function* (
  apiKey: OpenAiApiKey,
) {
  const encoded = yield* Schema.encodeUnknownEffect(OpenAiApiKeyJson)(apiKey)
  yield* Effect.try({
    try: () => localStorage.setItem(OPENAI_API_KEY_STORAGE_KEY, encoded),
    catch: cause => new OpenAiApiKeyStorageError({ operation: 'Write', cause }),
  })
})

const persistOpenAiApiKey = Effect.fn('OpenAiApiKey.persist')(function* (
  apiKey: OpenAiApiKey,
) {
  yield* Effect.sleep(SETTINGS_SAVE_DELAY)
  yield* saveOpenAiApiKey(apiKey).pipe(
    Effect.catch(() => Effect.logWarning('OpenAI credentials could not be persisted.')),
  )
})

export const Model = Schema.Struct({
  audioSettings: AudioSettings,
  openAiApiKey: OpenAiApiKey,
  isOpenAiApiKeyVisible: Schema.Boolean,
  masterVolumeSlider: Slider.Model,
  musicVolumeSlider: Slider.Model,
  voiceVolumeSlider: Slider.Model,
  soundEffectsVolumeSlider: Slider.Model,
})
export type Model = typeof Model.Type

export const ClickedClose = m('ClickedClose')
export const ChangedOpenAiApiKey = m('ChangedOpenAiApiKey', {
  value: OpenAiApiKey,
})
export const ToggledOpenAiApiKeyVisibility = m(
  'ToggledOpenAiApiKeyVisibility',
)
export const GotMasterVolumeSliderMessage = m(
  'GotMasterVolumeSliderMessage',
  { message: Slider.Message },
)
export const GotMusicVolumeSliderMessage = m('GotMusicVolumeSliderMessage', {
  message: Slider.Message,
})
export const GotVoiceVolumeSliderMessage = m('GotVoiceVolumeSliderMessage', {
  message: Slider.Message,
})
export const GotSoundEffectsVolumeSliderMessage = m(
  'GotSoundEffectsVolumeSliderMessage',
  { message: Slider.Message },
)

export const Message = Schema.Union([
  ClickedClose,
  ChangedOpenAiApiKey,
  ToggledOpenAiApiKeyVisibility,
  GotMasterVolumeSliderMessage,
  GotMusicVolumeSliderMessage,
  GotVoiceVolumeSliderMessage,
  GotSoundEffectsVolumeSliderMessage,
])
export type Message = typeof Message.Type

export const RequestedClose = m('RequestedClose')
export const OutMessage = Schema.Union([RequestedClose])
export type OutMessage = typeof OutMessage.Type

const sliderModel = (id: string): Slider.Model => Slider.init({ id, min: 0, max: 100, step: 1 })

export const init = (
  audioSettings: AudioSettings = defaultAudioSettings,
  openAiApiKey: OpenAiApiKey = emptyOpenAiApiKey,
): Model => ({
  audioSettings,
  openAiApiKey,
  isOpenAiApiKeyVisible: false,
  masterVolumeSlider: sliderModel('master-volume'),
  musicVolumeSlider: sliderModel('music-volume'),
  voiceVolumeSlider: sliderModel('voice-volume'),
  soundEffectsVolumeSlider: sliderModel('sound-effects-volume'),
})

const AudioChannel = Schema.Literals([
  'Master',
  'Music',
  'Voice',
  'SoundEffects',
])
type AudioChannel = typeof AudioChannel.Type

const updateAudioSettings = (
  settings: AudioSettings,
  channel: AudioChannel,
  value: Volume,
): AudioSettings =>
  M.value(channel).pipe(
    M.withReturnType<AudioSettings>(),
    M.when(
      'Master',
      () =>
        new AudioSettings({
          masterVolume: value,
          musicVolume: settings.musicVolume,
          voiceVolume: settings.voiceVolume,
          soundEffectsVolume: settings.soundEffectsVolume,
        }),
    ),
    M.when(
      'Music',
      () =>
        new AudioSettings({
          masterVolume: settings.masterVolume,
          musicVolume: value,
          voiceVolume: settings.voiceVolume,
          soundEffectsVolume: settings.soundEffectsVolume,
        }),
    ),
    M.when(
      'Voice',
      () =>
        new AudioSettings({
          masterVolume: settings.masterVolume,
          musicVolume: settings.musicVolume,
          voiceVolume: value,
          soundEffectsVolume: settings.soundEffectsVolume,
        }),
    ),
    M.when(
      'SoundEffects',
      () =>
        new AudioSettings({
          masterVolume: settings.masterVolume,
          musicVolume: settings.musicVolume,
          voiceVolume: settings.voiceVolume,
          soundEffectsVolume: value,
        }),
    ),
    M.exhaustive,
  )

type UpdateReturn = readonly [
  Model,
  ReadonlyArray<Command.Command<Message>>,
  Option.Option<OutMessage>,
]

const updateVolumeSlider = (
  model: Model,
  slider: Slider.Model,
  sliderMessage: Slider.Message,
  writeSlider: (model: Model, slider: Slider.Model) => Model,
  toParentMessage: (message: Slider.Message) => Message,
  channel: AudioChannel,
): UpdateReturn => {
  const [nextSlider, sliderCommands, maybeOutMessage] = Slider.update(
    slider,
    sliderMessage,
  )
  const nextModel = writeSlider(model, nextSlider)
  const commands = Command.mapMessages(sliderCommands, toParentMessage)

  return Option.match(maybeOutMessage, {
    onNone: () => [nextModel, commands, Option.none()],
    onSome: outMessage =>
      M.value(outMessage).pipe(
        M.withReturnType<UpdateReturn>(),
        M.tagsExhaustive({
          ChangedValue: ({ value }) => {
            const audioSettings = updateAudioSettings(
              nextModel.audioSettings,
              channel,
              value,
            )
            return [
              evo(nextModel, { audioSettings: () => audioSettings }),
              commands,
              Option.none(),
            ]
          },
        }),
      ),
  })
}

export const update = (model: Model, message: Message): UpdateReturn =>
  M.value(message).pipe(
    M.withReturnType<UpdateReturn>(),
    M.tagsExhaustive({
      ClickedClose: () => [model, [], Option.some(RequestedClose())],
      ChangedOpenAiApiKey: ({ value }) => [
        evo(model, { openAiApiKey: () => value }),
        [],
        Option.none(),
      ],
      ToggledOpenAiApiKeyVisibility: () => [
        evo(model, {
          isOpenAiApiKeyVisible: visible => !visible,
        }),
        [],
        Option.none(),
      ],
      GotMasterVolumeSliderMessage: ({ message: sliderMessage }) =>
        updateVolumeSlider(
          model,
          model.masterVolumeSlider,
          sliderMessage,
          (current, slider) => evo(current, { masterVolumeSlider: () => slider }),
          message => GotMasterVolumeSliderMessage({ message }),
          'Master',
        ),
      GotMusicVolumeSliderMessage: ({ message: sliderMessage }) =>
        updateVolumeSlider(
          model,
          model.musicVolumeSlider,
          sliderMessage,
          (current, slider) => evo(current, { musicVolumeSlider: () => slider }),
          message => GotMusicVolumeSliderMessage({ message }),
          'Music',
        ),
      GotVoiceVolumeSliderMessage: ({ message: sliderMessage }) =>
        updateVolumeSlider(
          model,
          model.voiceVolumeSlider,
          sliderMessage,
          (current, slider) => evo(current, { voiceVolumeSlider: () => slider }),
          message => GotVoiceVolumeSliderMessage({ message }),
          'Voice',
        ),
      GotSoundEffectsVolumeSliderMessage: ({ message: sliderMessage }) =>
        updateVolumeSlider(
          model,
          model.soundEffectsVolumeSlider,
          sliderMessage,
          (current, slider) => evo(current, { soundEffectsVolumeSlider: () => slider }),
          message => GotSoundEffectsVolumeSliderMessage({ message }),
          'SoundEffects',
        ),
    }),
  )

/** Return every slider to idle, restoring any value from an unfinished drag. */
export const cancelActiveDrags = (model: Model): Model => {
  const [afterMaster] = update(
    model,
    GotMasterVolumeSliderMessage({ message: Slider.CancelledDrag() }),
  )
  const [afterMusic] = update(
    afterMaster,
    GotMusicVolumeSliderMessage({ message: Slider.CancelledDrag() }),
  )
  const [afterVoice] = update(
    afterMusic,
    GotVoiceVolumeSliderMessage({ message: Slider.CancelledDrag() }),
  )
  const [afterSoundEffects] = update(
    afterVoice,
    GotSoundEffectsVolumeSliderMessage({ message: Slider.CancelledDrag() }),
  )
  return afterSoundEffects
}

const masterVolumeSubscriptions = Subscription.lift({
  masterVolumePointer: Slider.subscriptions.dragPointer,
  masterVolumeEscape: Slider.subscriptions.dragEscape,
})<Model, Message>({
  toChildModel: model => model.masterVolumeSlider,
  toParentMessage: message => GotMasterVolumeSliderMessage({ message }),
})

const musicVolumeSubscriptions = Subscription.lift({
  musicVolumePointer: Slider.subscriptions.dragPointer,
  musicVolumeEscape: Slider.subscriptions.dragEscape,
})<Model, Message>({
  toChildModel: model => model.musicVolumeSlider,
  toParentMessage: message => GotMusicVolumeSliderMessage({ message }),
})

const voiceVolumeSubscriptions = Subscription.lift({
  voiceVolumePointer: Slider.subscriptions.dragPointer,
  voiceVolumeEscape: Slider.subscriptions.dragEscape,
})<Model, Message>({
  toChildModel: model => model.voiceVolumeSlider,
  toParentMessage: message => GotVoiceVolumeSliderMessage({ message }),
})

const soundEffectsVolumeSubscriptions = Subscription.lift({
  soundEffectsVolumePointer: Slider.subscriptions.dragPointer,
  soundEffectsVolumeEscape: Slider.subscriptions.dragEscape,
})<Model, Message>({
  toChildModel: model => model.soundEffectsVolumeSlider,
  toParentMessage: message => GotSoundEffectsVolumeSliderMessage({ message }),
})

export const subscriptions = Subscription.aggregate<Model, Message>()(
  masterVolumeSubscriptions,
  musicVolumeSubscriptions,
  voiceVolumeSubscriptions,
  soundEffectsVolumeSubscriptions,
)

/** Latest-wins settings application and quiet-period persistence. */
export const audioSubscriptions = Subscription.make<
  Model,
  Message,
  MusicPlayer
>()(entry => ({
  applyAudioSettings: entry(
    { audioSettings: AudioSettings },
    {
      modelToDependencies: model => ({
        audioSettings: model.audioSettings,
      }),
      dependenciesToStream: ({ audioSettings }) =>
        Stream.fromEffect(
          Effect.gen(function* () {
            const player = yield* MusicPlayer
            yield* player.setSettings(audioSettings)
          }),
        ).pipe(Stream.drain),
    },
  ),
  persistAudioSettings: entry(
    { audioSettings: AudioSettings },
    {
      modelToDependencies: model => ({
        audioSettings: model.audioSettings,
      }),
      dependenciesToStream: ({ audioSettings }) =>
        Stream.fromEffect(persistAudioSettings(audioSettings)).pipe(
          Stream.drain,
        ),
    },
  ),
  persistOpenAiApiKey: entry(
    { openAiApiKey: OpenAiApiKey },
    {
      modelToDependencies: model => ({
        openAiApiKey: model.openAiApiKey,
      }),
      dependenciesToStream: ({ openAiApiKey }) =>
        Stream.fromEffect(persistOpenAiApiKey(openAiApiKey)).pipe(Stream.drain),
    },
  ),
}))

const volumeSlider = (
  label: string,
  description: string,
  slider: Slider.Model,
  value: Volume,
  toParentMessage: (message: Slider.Message) => Message,
  h: HtmlBuilder<Message>,
): Html =>
  h.submodel({
    slotId: slider.id,
    model: slider,
    view: Slider.view,
    viewInputs: {
      value,
      formatValue: current => `${current} percent`,
      toView: attributes =>
        h.div(
          [h.Class('settings-volume-row')],
          [
            h.div(
              [h.Class('settings-volume-heading')],
              [
                h.div(
                  [h.Class('settings-volume-copy')],
                  [
                    h.label(
                      [...attributes.label, h.Class('settings-volume-label')],
                      [label],
                    ),
                    h.span([h.Class('settings-volume-description')], [
                      description,
                    ]),
                  ],
                ),
                h.output([h.Class('settings-volume-value')], [
                  `${value}%`,
                ]),
              ],
            ),
            h.div(
              [...attributes.root, h.Class('settings-volume-control')],
              [
                h.div(
                  [...attributes.track, h.Class('settings-volume-track')],
                  [
                    h.div([
                      ...attributes.filledTrack,
                      h.Class('settings-volume-fill'),
                    ]),
                  ],
                ),
                h.div(
                  [...attributes.thumb, h.Class('settings-volume-thumb')],
                  [h.span([h.Class('settings-volume-thumb-core')])],
                ),
              ],
            ),
          ],
        ),
    },
    toParentMessage,
  })

type ViewInputs = Readonly<{
  musicPlaybackState: MusicPlaybackState
}>

const playbackKicker = (state: MusicPlaybackState): string =>
  M.value(state).pipe(
    M.whenOr('StartingAutoplay', 'StartingFromInteraction', () => 'Starting music'),
    M.when('WaitingForInteraction', () => 'Ready when you are'),
    M.when('Playing', () => 'Now playing'),
    M.exhaustive,
  )

export const view = Submodel.defineView<Model, Message, ViewInputs>((
  model,
  viewInputs,
  h,
): Html =>
  h.main(
    [
      h.Class('settings-shell'),
      h.Attribute('data-testid', 'settings-page'),
    ],
    [
      h.img([
        h.Src(settingsArtUrl),
        h.Alt('A quiet moonlit courtyard of the mountain monastery'),
        h.Class('settings-art'),
        h.Attribute('data-testid', 'settings-art'),
      ]),
      h.div([h.Class('settings-atmosphere')]),
      h.section(
        [h.Class('settings-panel'), h.AriaLabel('Audio settings')],
        [
          h.div(
            [h.Class('settings-home')],
            [
              h.button([
                h.Type('button'),
                h.Class('settings-home-button'),
                h.AriaLabel('Return to Dojo'),
                h.OnClick(ClickedClose()),
              ]),
              h.span(
                [h.Class('settings-home-mark')],
                [
                  h.span([h.Class('settings-home-label')], ['Dojo']),
                  h.img([
                    h.Src(backIconUrl),
                    h.Alt(''),
                    h.Class('settings-home-icon'),
                  ]),
                ],
              ),
            ],
          ),
          h.header(
            [h.Class('settings-header')],
            [
              h.p([h.Class('settings-kicker')], ['Dojo configuration']),
              h.h1([h.Class('settings-title')], ['Settings']),
              h.div([h.Class('settings-title-rule')]),
            ],
          ),
          h.div(
            [h.Class('settings-volume-list')],
            [
              volumeSlider(
                'Master Volume',
                'All audio',
                model.masterVolumeSlider,
                model.audioSettings.masterVolume,
                message => GotMasterVolumeSliderMessage({ message }),
                h,
              ),
              volumeSlider(
                'Music Volume',
                'Background score',
                model.musicVolumeSlider,
                model.audioSettings.musicVolume,
                message => GotMusicVolumeSliderMessage({ message }),
                h,
              ),
              volumeSlider(
                'Voice Volume',
                'Dialogue playback',
                model.voiceVolumeSlider,
                model.audioSettings.voiceVolume,
                message => GotVoiceVolumeSliderMessage({ message }),
                h,
              ),
              volumeSlider(
                'Sound Effects Volume',
                'Interface and scene sounds',
                model.soundEffectsVolumeSlider,
                model.audioSettings.soundEffectsVolume,
                message => GotSoundEffectsVolumeSliderMessage({ message }),
                h,
              ),
            ],
          ),
          h.section(
            [h.Class('settings-api'), h.AriaLabel('OpenAI configuration')],
            [
              h.div(
                [h.Class('settings-api-heading')],
                [
                  h.label(
                    [h.For('openai-api-key'), h.Class('settings-api-label')],
                    ['OpenAI API Key'],
                  ),
                  h.span([h.Class('settings-api-description')], [
                    'Required for realtime interviews',
                  ]),
                ],
              ),
              h.div(
                [h.Class('settings-api-control')],
                [
                  h.input([
                    h.Id('openai-api-key'),
                    h.Type(model.isOpenAiApiKeyVisible ? 'text' : 'password'),
                    h.Value(Redacted.value(model.openAiApiKey)),
                    h.Class('settings-api-input'),
                    h.Attribute('autocomplete', 'off'),
                    h.Attribute('spellcheck', 'false'),
                    h.OnInput(value =>
                      ChangedOpenAiApiKey({
                        value: Redacted.make(value, {
                          label: 'OpenAI API key',
                        }),
                      })
                    ),
                  ]),
                  h.button(
                    [
                      h.Type('button'),
                      h.Class('settings-api-visibility'),
                      h.AriaLabel(
                        model.isOpenAiApiKeyVisible
                          ? 'Hide OpenAI API key'
                          : 'Show OpenAI API key',
                      ),
                      h.Attribute(
                        'aria-pressed',
                        model.isOpenAiApiKeyVisible ? 'true' : 'false',
                      ),
                      h.OnClick(ToggledOpenAiApiKeyVisibility()),
                    ],
                    [
                      h.img([
                        h.Src(
                          model.isOpenAiApiKeyVisible
                            ? visibilityOffIconUrl
                            : visibilityIconUrl,
                        ),
                        h.Alt(''),
                      ]),
                    ],
                  ),
                ],
              ),
              h.p([h.Class('settings-api-note')], [
                'Stored only in this local Dojo profile.',
              ]),
            ],
          ),
          h.footer(
            [
              h.Class('settings-now-playing'),
              h.Attribute('aria-live', 'polite'),
              h.Attribute('data-testid', 'settings-playback-status'),
            ],
            [
              h.span([h.Class('settings-now-playing-kicker')], [
                playbackKicker(viewInputs.musicPlaybackState),
              ]),
              h.span(
                [h.Class('settings-now-playing-track')],
                [
                  h.span(
                    [h.Class('settings-now-playing-title')],
                    ['Hot Springs Town'],
                  ),
                  h.span(
                    [
                      h.Class('settings-now-playing-separator'),
                      h.Attribute('aria-hidden', 'true'),
                    ],
                  ),
                  h.span(
                    [h.Class('settings-now-playing-artist')],
                    ['Kistol'],
                  ),
                ],
              ),
            ],
          ),
        ],
      ),
    ],
  )
)
