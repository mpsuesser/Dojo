import { Duration, Effect, Match as M, Option, Queue, Stream, pipe } from 'effect'
import * as Arr from 'effect/Array'
import * as Schema from 'effect/Schema'
import { Command, ManagedResource, Subscription } from 'foldkit'
import type { Html, HtmlBuilder } from 'foldkit/html'
import { m } from 'foldkit/message'
import { evo } from 'foldkit/struct'
import * as Submodel from 'foldkit/submodel'
import type * as Update from 'foldkit/update'
import { Dialog } from '@foldkit/ui'

import sketchArtUrl from '../../../../docs/generated-concept-art/02-hall-of-form.png'
import * as EditorAdapter from './editor.ts'
import backIconUrl from './icons/back.svg'
import circleIconUrl from './icons/circle.svg'
import drawIconUrl from './icons/draw.svg'
import eraseIconUrl from './icons/erase.svg'
import rectangleIconUrl from './icons/rectangle.svg'
import selectIconUrl from './icons/select.svg'
import squareIconUrl from './icons/square.svg'
import textIconUrl from './icons/text.svg'

export const SketchMode = Schema.Literals([
  'draw',
  'square',
  'circle',
  'rectangle',
  'text',
  'erase',
  'select',
])
export type SketchMode = typeof SketchMode.Type

export const SketchColor = Schema.Literals([
  'black',
  'grey',
  'blue',
  'green',
  'red',
])
export type SketchColor = typeof SketchColor.Type

const EditorState = Schema.Literals(['Acquiring', 'Ready', 'Failed'])
const CopyState = Schema.Literals(['Idle', 'Copying'])
const Shortcut = Schema.Literals([
  'Draw',
  'Square',
  'Circle',
  'Rectangle',
  'Text',
  'Erase',
  'Select',
  'PreviousColor',
  'NextColor',
  'CopyImage',
])

export const Model = Schema.Struct({
  editorState: EditorState,
  activeMode: SketchMode,
  activeColor: SketchColor,
  shapeCount: Schema.Int,
  copyState: CopyState,
  clearDialog: Dialog.Model,
  feedback: Schema.Option(Schema.String),
})
export type Model = typeof Model.Type

export const AcquiredEditor = m('AcquiredEditor', { shapeCount: Schema.Int })
export const FailedAcquireEditor = m('FailedAcquireEditor', {
  reason: Schema.String,
})
export const ReleasedEditor = m('ReleasedEditor')
export const ChangedEditorShapeCount = m('ChangedEditorShapeCount', {
  shapeCount: Schema.Int,
})
export const SelectedMode = m('SelectedMode', { mode: SketchMode })
export const SelectedColor = m('SelectedColor', { color: SketchColor })
export const ClickedClear = m('ClickedClear')
export const ConfirmedClear = m('ConfirmedClear')
export const ClickedCopyImage = m('ClickedCopyImage')
export const ClickedClose = m('ClickedClose')
export const PressedShortcut = m('PressedShortcut', { shortcut: Shortcut })
export const GotClearDialogMessage = m('GotClearDialogMessage', {
  message: Dialog.Message,
})
export const CompletedApplyEditorMode = m('CompletedApplyEditorMode')
export const CompletedApplyEditorColor = m('CompletedApplyEditorColor')
export const CompletedClearEditor = m('CompletedClearEditor')
export const SucceededCopyEditorImage = m('SucceededCopyEditorImage')
export const ElapsedCopyFeedback = m('ElapsedCopyFeedback')
export const FailedEditorAction = m('FailedEditorAction', { reason: Schema.String })

export const Message = Schema.Union([
  AcquiredEditor,
  FailedAcquireEditor,
  ReleasedEditor,
  ChangedEditorShapeCount,
  SelectedMode,
  SelectedColor,
  ClickedClear,
  ConfirmedClear,
  ClickedCopyImage,
  ClickedClose,
  PressedShortcut,
  GotClearDialogMessage,
  CompletedApplyEditorMode,
  CompletedApplyEditorColor,
  CompletedClearEditor,
  SucceededCopyEditorImage,
  ElapsedCopyFeedback,
  FailedEditorAction,
])
export type Message = typeof Message.Type

export const RequestedClose = m('RequestedClose')
export const OutMessage = Schema.Union([RequestedClose])
export type OutMessage = typeof OutMessage.Type

export const init = (): Model => ({
  editorState: 'Acquiring',
  activeMode: 'draw',
  activeColor: 'black',
  shapeCount: 0,
  copyState: 'Idle',
  clearDialog: Dialog.init({ id: 'sketch-clear-dialog' }),
  feedback: Option.none(),
})

export const EditorResource = ManagedResource.tag<EditorAdapter.SketchEditor>()(
  'SketchEditor',
)
export type EditorService = ManagedResource.ServiceOf<typeof EditorResource>

const runEditorAction = <A>(
  action: (editor: EditorAdapter.SketchEditor) => Effect.Effect<A, EditorAdapter.EditorActionError>,
) =>
  EditorResource.get.pipe(
    Effect.flatMap(action),
    Effect.catchTag('ResourceNotAvailable', () =>
      Effect.fail(
        new EditorAdapter.EditorActionError({ reason: 'The editor is not ready.' }),
      ),
    ),
  )

const ApplyEditorMode = Command.define('ApplyEditorMode', {
  args: { mode: SketchMode },
  messages: [CompletedApplyEditorMode, FailedEditorAction],
  execute: ({ mode }) =>
    runEditorAction(editor => EditorAdapter.applyMode(editor, mode)).pipe(
      Effect.as(CompletedApplyEditorMode()),
      Effect.catchTag('EditorActionError', ({ reason }) =>
        Effect.succeed(FailedEditorAction({ reason })),
      ),
    ),
})

const ApplyEditorColor = Command.define('ApplyEditorColor', {
  args: { color: SketchColor, applyToSelectedShapes: Schema.Boolean },
  messages: [CompletedApplyEditorColor, FailedEditorAction],
  execute: ({ color, applyToSelectedShapes }) =>
    runEditorAction(editor =>
      EditorAdapter.applyColor(editor, color, applyToSelectedShapes),
    ).pipe(
      Effect.as(CompletedApplyEditorColor()),
      Effect.catchTag('EditorActionError', ({ reason }) =>
        Effect.succeed(FailedEditorAction({ reason })),
      ),
    ),
})

const ClearEditor = Command.define('ClearEditor', {
  messages: [CompletedClearEditor, FailedEditorAction],
  execute: runEditorAction(EditorAdapter.clear).pipe(
    Effect.as(CompletedClearEditor()),
    Effect.catchTag('EditorActionError', ({ reason }) =>
      Effect.succeed(FailedEditorAction({ reason })),
    ),
  ),
})

const CopyEditorImage = Command.define('CopyEditorImage', {
  messages: [SucceededCopyEditorImage, FailedEditorAction],
  execute: runEditorAction(EditorAdapter.copyImage).pipe(
    Effect.as(SucceededCopyEditorImage()),
    Effect.catchTag('EditorActionError', ({ reason }) =>
      Effect.succeed(FailedEditorAction({ reason })),
    ),
  ),
})

const WaitBeforeClearCopyFeedback = Command.define(
  'WaitBeforeClearCopyFeedback',
  {
    messages: [ElapsedCopyFeedback],
    execute: Effect.sleep(Duration.millis(2400)).pipe(
      Effect.as(ElapsedCopyFeedback()),
    ),
  },
)

const colors: ReadonlyArray<SketchColor> = [
  'black',
  'grey',
  'blue',
  'green',
  'red',
]

const shiftedColor = (
  color: SketchColor,
  direction: -1 | 1,
): SketchColor => {
  const current = Option.getOrElse(Arr.findFirstIndex(colors, value => value === color), () => 0)
  return Option.getOrElse(Arr.get(colors, Math.min(Math.max(current + direction, 0), colors.length - 1)), () => color)
}

type UpdateReturn = Update.ReturnWithOutMessage<
  Model,
  Message,
  OutMessage,
  EditorService
>
const withUpdateReturn = M.withReturnType<UpdateReturn>()

const mapDialogCommands = (
  commands: ReadonlyArray<Command.Command<Dialog.Message>>,
) =>
  Command.mapMessages(commands, message =>
    GotClearDialogMessage({ message }),
  )

const selectMode = (model: Model, mode: SketchMode): UpdateReturn => [
  evo(model, { activeMode: () => mode, feedback: () => Option.none() }),
  [ApplyEditorMode({ mode })],
  Option.none(),
]

const selectColor = (model: Model, color: SketchColor): UpdateReturn => [
  evo(model, { activeColor: () => color, feedback: () => Option.none() }),
  [
    ApplyEditorColor({
      color,
      applyToSelectedShapes: model.activeMode === 'select',
    }),
  ],
  Option.none(),
]

const handleShortcut = (
  model: Model,
  shortcut: typeof Shortcut.Type,
): UpdateReturn =>
  M.value(shortcut).pipe(
    withUpdateReturn,
    M.when('Draw', () => selectMode(model, 'draw')),
    M.when('Square', () => selectMode(model, 'square')),
    M.when('Circle', () => selectMode(model, 'circle')),
    M.when('Rectangle', () => selectMode(model, 'rectangle')),
    M.when('Text', () => selectMode(model, 'text')),
    M.when('Erase', () => selectMode(model, 'erase')),
    M.when('Select', () => selectMode(model, 'select')),
    M.when('PreviousColor', () =>
      selectColor(model, shiftedColor(model.activeColor, -1)),
    ),
    M.when('NextColor', () =>
      selectColor(model, shiftedColor(model.activeColor, 1)),
    ),
    M.when('CopyImage', () =>
      model.shapeCount === 0 || model.copyState === 'Copying'
        ? [model, [], Option.none()]
        : [
            evo(model, { copyState: () => 'Copying', feedback: () => Option.none() }),
            [CopyEditorImage()],
            Option.none(),
          ],
    ),
    M.exhaustive,
  )

export const update = (model: Model, message: Message): UpdateReturn =>
  M.value(message).pipe(
    withUpdateReturn,
    M.tagsExhaustive({
      AcquiredEditor: ({ shapeCount }) => [
        evo(model, {
          editorState: () => 'Ready',
          shapeCount: () => shapeCount,
          feedback: () => Option.none(),
        }),
        [],
        Option.none(),
      ],
      FailedAcquireEditor: ({ reason }) => [
        evo(model, {
          editorState: () => 'Failed',
          feedback: () => Option.some(reason),
        }),
        [],
        Option.none(),
      ],
      ReleasedEditor: () => [
        evo(model, { editorState: () => 'Acquiring' }),
        [],
        Option.none(),
      ],
      ChangedEditorShapeCount: ({ shapeCount }) => [
        evo(model, { shapeCount: () => shapeCount }),
        [],
        Option.none(),
      ],
      SelectedMode: ({ mode }) => selectMode(model, mode),
      SelectedColor: ({ color }) => selectColor(model, color),
      ClickedClear: () =>
        model.shapeCount === 0
          ? [model, [], Option.none()]
          : pipe(
              Dialog.open(model.clearDialog),
              ([clearDialog, commands]) => [
                evo(model, { clearDialog: () => clearDialog }),
                mapDialogCommands(commands),
                Option.none(),
              ],
            ),
      ConfirmedClear: () => {
        const [clearDialog, commands] = Dialog.close(model.clearDialog)
        return [
          evo(model, {
            clearDialog: () => clearDialog,
            activeMode: () => 'draw',
            feedback: () => Option.none(),
          }),
          [...mapDialogCommands(commands), ClearEditor()],
          Option.none(),
        ]
      },
      ClickedCopyImage: () => handleShortcut(model, 'CopyImage'),
      ClickedClose: () => [model, [], Option.some(RequestedClose())],
      PressedShortcut: ({ shortcut }) => handleShortcut(model, shortcut),
      GotClearDialogMessage: ({ message: dialogMessage }) => {
        const [clearDialog, commands] = Dialog.update(
          model.clearDialog,
          dialogMessage,
        )
        return [
          evo(model, { clearDialog: () => clearDialog }),
          mapDialogCommands(commands),
          Option.none(),
        ]
      },
      CompletedApplyEditorMode: () => [model, [], Option.none()],
      CompletedApplyEditorColor: () => [model, [], Option.none()],
      CompletedClearEditor: () => [
        evo(model, { shapeCount: () => 0 }),
        [],
        Option.none(),
      ],
      SucceededCopyEditorImage: () => [
        evo(model, {
          copyState: () => 'Idle',
          feedback: () => Option.some('Copied image to clipboard.'),
        }),
        [WaitBeforeClearCopyFeedback()],
        Option.none(),
      ],
      ElapsedCopyFeedback: () => [
        evo(model, { feedback: () => Option.none() }),
        [],
        Option.none(),
      ],
      FailedEditorAction: ({ reason }) => [
        evo(model, {
          copyState: () => 'Idle',
          feedback: () => Option.some(reason),
        }),
        [],
        Option.none(),
      ],
    }),
  )

export const managedResources = ManagedResource.make<Model, Message>()(entry => ({
  editor: entry(Schema.Option(Schema.Null), {
    resource: EditorResource,
    modelToMaybeRequirements: () => Option.some(null),
    acquire: () => EditorAdapter.acquire('sketch-editor-host'),
    release: () => Effect.void,
    onAcquired: editor =>
      AcquiredEditor({ shapeCount: EditorAdapter.shapeCount(editor) }),
    onAcquireError: error =>
      FailedAcquireEditor({
        reason:
          error instanceof EditorAdapter.EditorAcquireError
            ? error.reason
            : 'The canvas could not be loaded.',
      }),
    onReleased: () => ReleasedEditor(),
  }),
}))

const editorChanges = Stream.unwrap(
  EditorResource.get.pipe(
    Effect.map(editor =>
      Stream.callback<Message>(queue =>
        Effect.acquireRelease(
          Effect.sync(() => {
            let previous = EditorAdapter.shapeCount(editor)
            return editor.editor.store.listen(() => {
              const next = EditorAdapter.shapeCount(editor)
              if (next !== previous) {
                previous = next
                Queue.offerUnsafe(
                  queue,
                  ChangedEditorShapeCount({ shapeCount: next }),
                )
              }
            })
          }),
          removeListener => Effect.sync(removeListener),
        ).pipe(Effect.flatMap(() => Effect.never)),
      ),
    ),
    Effect.catchTag('ResourceNotAvailable', () => Effect.succeed(Stream.empty)),
  ),
)

const shortcutFromKeyboard = (event: KeyboardEvent): Option.Option<Message> => {
  const active = document.activeElement
  if (
    active instanceof HTMLElement &&
    (active.tagName === 'INPUT' ||
      active.tagName === 'TEXTAREA' ||
      active.isContentEditable)
  ) {
    return Option.none()
  }

  const shortcut =
    event.metaKey || event.ctrlKey
      ? event.key === 'Enter'
        ? Option.some<typeof Shortcut.Type>('CopyImage')
        : Option.none()
      : event.altKey
        ? Option.none()
        : event.shiftKey
          ? event.code === 'KeyA'
            ? Option.some<typeof Shortcut.Type>('PreviousColor')
            : event.code === 'KeyD'
              ? Option.some<typeof Shortcut.Type>('NextColor')
              : Option.none()
          : M.value(event.code).pipe(
              M.withReturnType<Option.Option<typeof Shortcut.Type>>(),
              M.when('KeyD', () => Option.some('Draw')),
              M.when('KeyS', () => Option.some('Square')),
              M.when('KeyC', () => Option.some('Circle')),
              M.when('KeyR', () => Option.some('Rectangle')),
              M.when('KeyT', () => Option.some('Text')),
              M.when('KeyE', () => Option.some('Erase')),
              M.when('KeyW', () => Option.some('Select')),
              M.orElse(() => Option.none()),
            )

  return Option.map(shortcut, value => {
    event.preventDefault()
    event.stopPropagation()
    return PressedShortcut({ shortcut: value })
  })
}

export const subscriptions = Subscription.make<Model, Message, EditorService>()(
  entry => ({
    editorChanges: entry(
      { isReady: Schema.Boolean },
      {
        modelToDependencies: model => ({ isReady: model.editorState === 'Ready' }),
        dependenciesToStream: ({ isReady }) =>
          isReady ? editorChanges : Stream.empty,
      },
    ),
    keyboard: entry(
      {},
      {
        modelToDependencies: () => ({}),
        dependenciesToStream: () =>
          Subscription.fromEventFilterMap<KeyboardEvent, Message>({
            target: document,
            type: 'keydown',
            options: { capture: true },
            toMessage: shortcutFromKeyboard,
          }),
      },
    ),
  }),
)

const modes: ReadonlyArray<
  Readonly<{ mode: SketchMode; label: string; key: string; iconUrl: string }>
> = [
  { mode: 'draw', label: 'Draw', key: 'D', iconUrl: drawIconUrl },
  { mode: 'square', label: 'Square', key: 'S', iconUrl: squareIconUrl },
  { mode: 'circle', label: 'Circle', key: 'C', iconUrl: circleIconUrl },
  { mode: 'rectangle', label: 'Rectangle', key: 'R', iconUrl: rectangleIconUrl },
  { mode: 'text', label: 'Text', key: 'T', iconUrl: textIconUrl },
  { mode: 'erase', label: 'Erase', key: 'E', iconUrl: eraseIconUrl },
  { mode: 'select', label: 'Select', key: 'W', iconUrl: selectIconUrl },
]

const colorLabels: Readonly<Record<SketchColor, string>> = {
  black: 'black',
  grey: 'gray',
  blue: 'blue',
  green: 'green',
  red: 'red',
}

const button = (
  label: string,
  className: string,
  isDisabled: boolean,
  message: Message,
  h: HtmlBuilder<Message>,
): Html =>
  h.button(
    [
      h.Type('button'),
      h.Class(className),
      h.Disabled(isDisabled),
      h.OnClick(message),
    ],
    [label],
  )

const clearDialog = (model: Model, h: HtmlBuilder<Message>): Html =>
  h.submodel({
    slotId: model.clearDialog.id,
    model: model.clearDialog,
    view: Dialog.view,
    toParentMessage: message => GotClearDialogMessage({ message }),
    viewInputs: {
      toView: ({
        dialog,
        backdrop,
        panel,
        closeButton,
        title,
        description,
        isVisible,
      }) =>
        h.dialog(
          [...dialog, h.Class('sketch-dialog-root')],
          isVisible
            ? [
                h.div([...backdrop, h.Class('sketch-dialog-backdrop')]),
                h.div(
                  [...panel, h.Class('sketch-dialog')],
                  [
                    h.h2([...title], ['Clear the current canvas?']),
                    h.p(
                      [...description],
                      ['This removes every shape from this sketch.'],
                    ),
                    h.div(
                      [h.Class('sketch-dialog-actions')],
                      [
                        h.button(
                          [
                            ...closeButton,
                            h.Class('sketch-button sketch-button-secondary'),
                          ],
                          ['Cancel'],
                        ),
                        button(
                          'Clear canvas',
                          'sketch-button sketch-button-danger',
                          false,
                          ConfirmedClear(),
                          h,
                        ),
                      ],
                    ),
                  ],
                ),
              ]
            : [],
        ),
    },
  })

export const view = Submodel.defineView<Model, Message>((model, h): Html => {
  const isReady = model.editorState === 'Ready'
  const isCopying = model.copyState === 'Copying'
  const copyLabel = isCopying
    ? 'Copying...'
    : Option.getOrElse(model.feedback, () => 'Copy image')

  return h.main(
    [h.Class('sketch-shell'), h.Attribute('data-testid', 'sketch-workspace')],
    [
      h.img([
        h.Src(sketchArtUrl),
        h.Alt('A sunlit wooden training hall prepared for the art of form'),
        h.Class('sketch-backsplash'),
        h.Attribute('data-testid', 'sketch-art'),
      ]),
      h.div([h.Class('sketch-atmosphere')]),
      h.header(
        [h.Class('sketch-masthead')],
        [
          h.div(
            [h.Class('sketch-title-lockup')],
            [
              h.button([
                h.Type('button'),
                h.Class('sketch-home-button'),
                h.AriaLabel('Return to Dojo'),
                h.Disabled(isCopying),
                h.OnClick(ClickedClose()),
              ]),
              h.span(
                [h.Class('sketch-kicker')],
                [
                  h.span(
                    [h.Class('sketch-home-mark')],
                    [
                      h.span([h.Class('sketch-home-label')], ['Dojo']),
                      h.img([
                        h.Src(backIconUrl),
                        h.Alt(''),
                        h.Class('sketch-home-icon'),
                      ]),
                    ],
                  ),
                  h.span([], [' / Hall of Form']),
                ],
              ),
              h.h1([h.Class('sketch-title')], ['Sketch']),
            ],
          ),
        ],
      ),
      h.div(
        [h.Class('sketch-workbench')],
        [
          h.aside(
            [h.Class('sketch-tool-panel')],
            [
              h.div(
                [h.Class('sketch-panel-heading')],
                [
                  h.div([], [
                    h.span([h.Class('sketch-panel-kicker')], ['Instruments']),
                  ]),
                ],
              ),
              h.div(
                [h.Class('sketch-tools'), h.Role('toolbar'), h.AriaLabel('Drawing tools')],
                Arr.map(modes, ({ mode, label, key, iconUrl }) =>
                  h.button(
                    [
                      h.Type('button'),
                      h.Class('sketch-tool'),
                      h.AriaLabel(label),
                      h.AriaPressed(`${model.activeMode === mode}`),
                      h.Disabled(!isReady || isCopying),
                      h.OnClick(SelectedMode({ mode })),
                    ],
                    [
                      h.kbd([h.Class('sketch-tool-key')], [key]),
                      h.span([h.Class('sketch-tool-label')], [label]),
                      h.img([
                        h.Src(iconUrl),
                        h.Alt(''),
                        h.Class('sketch-tool-icon'),
                      ]),
                    ],
                  ),
                ),
              ),
            ],
          ),
          h.section(
            [h.Class('sketch-stage'), h.AriaLabel('Drawing canvas')],
            [
              h.div(
                [h.Class('sketch-canvas-frame')],
                [
                  h.div([
                    h.Id('sketch-editor-host'),
                    h.Class('sketch-editor-host'),
                    h.Attribute('data-testid', 'sketch-editor'),
                  ]),
                ],
              ),
              model.editorState === 'Acquiring'
                ? h.p([h.Class('sketch-loading'), h.Role('status')], ['Preparing canvas...'])
                : null,
              model.editorState === 'Failed'
                ? h.p([h.Class('sketch-loading sketch-error'), h.Role('alert')], [
                    Option.getOrElse(model.feedback, () => 'The canvas could not be loaded.'),
                  ])
                : null,
            ],
          ),
        ],
      ),
      h.footer(
        [h.Class('sketch-palette'), h.AriaLabel('Drawing colors')],
        [
          h.span([h.Class('sketch-palette-label')], ['Ink']),
          h.div(
            [h.Class('sketch-swatches')],
            Arr.map(colors, color =>
              h.button(
                [
                  h.Type('button'),
                  h.Class('sketch-swatch'),
                  h.Style({ backgroundColor: EditorAdapter.colorSwatches[color] }),
                  h.AriaLabel(`Use ${colorLabels[color]}`),
                  h.AriaPressed(`${model.activeColor === color}`),
                  h.Disabled(!isReady || isCopying),
                  h.OnClick(SelectedColor({ color })),
                ],
              ),
            ),
          ),
          h.span([h.Class('sketch-palette-hint')], ['Shift A / D']),
        ],
      ),
      h.div(
        [h.Class('sketch-actions')],
        [
          button('Clear', 'sketch-button sketch-button-quiet', !isReady || isCopying || model.shapeCount === 0, ClickedClear(), h),
          button(copyLabel, 'sketch-button sketch-button-primary', !isReady || isCopying || model.shapeCount === 0, ClickedCopyImage(), h),
        ],
      ),
      clearDialog(model, h),
    ],
  )
})
