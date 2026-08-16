import { Deferred, Effect, Match as M, Option } from 'effect'
import * as P from 'effect/Predicate'
import * as Schema from 'effect/Schema'
import { Render } from 'foldkit'
import { createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { getAssetUrlsByImport } from '@tldraw/assets/imports.vite'
import type {
  Editor,
  TLDefaultDashStyle,
  TLShape,
  TLUiComponents,
} from 'tldraw'

import type { SketchColor, SketchMode } from './main.ts'

const assetUrls = getAssetUrlsByImport()
const persistenceKey = 'opencode-sketch-tldraw'
const components: TLUiComponents = { ContextMenu: null }

export const colorSwatches: Readonly<Record<SketchColor, string>> = {
  black: '#1d1d1d',
  grey: '#adb5bd',
  blue: '#4263eb',
  green: '#2f9e44',
  red: '#e03131',
}

export class EditorAcquireError extends Schema.TaggedError<EditorAcquireError>()(
  'EditorAcquireError',
  { reason: Schema.String },
) {}

export class EditorActionError extends Schema.TaggedError<EditorActionError>()(
  'EditorActionError',
  { reason: Schema.String },
) {}

export type SketchEditor = Readonly<{
  editor: Editor
  root: Root
  activeMode: { current: SketchMode }
  api: Pick<
    typeof import('tldraw'),
    | 'DefaultColorStyle'
    | 'DefaultDashStyle'
    | 'GeoShapeGeoStyle'
    | 'Tldraw'
  >
}>

const errorReason = (cause: unknown): string =>
  P.isError(cause)
    ? cause.message
    : P.isString(cause)
      ? cause
      : 'The editor operation failed.'

const setEditorMode = (
  handle: Pick<SketchEditor, 'activeMode' | 'api' | 'editor'>,
  mode: SketchMode,
): void => {
  const { editor } = handle
  editor.updateInstanceState({ isToolLocked: true })
  if (mode !== 'select') editor.selectNone()

  M.value(mode).pipe(
    M.when('draw', () => {
      editor.setCurrentTool('draw')
    }),
    M.when('square', () => {
      editor.setStyleForNextShapes(handle.api.GeoShapeGeoStyle, 'rectangle')
      editor.setCurrentTool('geo')
    }),
    M.when('circle', () => {
      editor.setStyleForNextShapes(handle.api.GeoShapeGeoStyle, 'ellipse')
      editor.setCurrentTool('geo')
    }),
    M.when('rectangle', () => {
      editor.setStyleForNextShapes(handle.api.GeoShapeGeoStyle, 'rectangle')
      editor.setCurrentTool('geo')
    }),
    M.when('text', () => {
      editor.setCurrentTool('text')
    }),
    M.when('erase', () => {
      editor.setCurrentTool('eraser')
    }),
    M.when('select', () => {
      editor.setCurrentTool('select')
    }),
    M.exhaustive,
  )
}

const normalizeConstrainedShape = (
  editor: Editor,
  shape: TLShape,
  mode: SketchMode,
): TLShape => {
  const expectedGeo =
    mode === 'square' ? 'rectangle' : mode === 'circle' ? 'ellipse' : null
  if (shape.type !== 'geo' || shape.props.geo !== expectedGeo) return shape

  const size = Math.max(shape.props.w, shape.props.h)
  if (!Number.isFinite(size) || size <= 0) return shape

  const minX = shape.x
  const maxX = shape.x + shape.props.w
  const minY = shape.y
  const maxY = shape.y + shape.props.h
  const origin = editor.inputs.getOriginPagePoint()
  const originOnLeft = Math.abs(origin.x - minX) <= Math.abs(origin.x - maxX)
  const originOnTop = Math.abs(origin.y - minY) <= Math.abs(origin.y - maxY)
  const anchorX = originOnLeft ? minX : maxX
  const anchorY = originOnTop ? minY : maxY

  return {
    ...shape,
    x: originOnLeft ? anchorX : anchorX - size,
    y: originOnTop ? anchorY : anchorY - size,
    props: { ...shape.props, h: size, w: size },
  }
}

export const acquire = Effect.fn('Sketch.acquireEditor')(function* (
  hostId: string,
) {
  yield* Render.afterCommit
  const host = yield* Option.match(
    Option.fromNullishOr(document.getElementById(hostId)),
    {
      onNone: () =>
        Effect.fail(
          new EditorAcquireError({ reason: 'The drawing surface was not found.' }),
        ),
      onSome: Effect.succeed,
    },
  )
  const root = yield* Effect.try({
    try: () => createRoot(host),
    catch: cause => new EditorAcquireError({ reason: errorReason(cause) }),
  })
  yield* Effect.addFinalizer(() => Effect.sync(() => root.unmount()))
  const api = yield* Effect.tryPromise({
    try: () => import('tldraw'),
    catch: cause => new EditorAcquireError({ reason: errorReason(cause) }),
  })

  const ready = yield* Deferred.make<Editor>()
  yield* Effect.sync(() =>
    root.render(
      createElement(api.Tldraw, {
        assetUrls,
        autoFocus: true,
        components,
        hideUi: true,
        persistenceKey,
        onMount: editor => {
          Deferred.doneUnsafe(ready, Effect.succeed(editor))
        },
      }),
    ),
  )
  const editor = yield* Deferred.await(ready)
  const activeMode: { current: SketchMode } = { current: 'draw' }
  const handle = { editor, root, activeMode, api }
  editor.selectNone()
  editor.setStyleForNextShapes(api.DefaultColorStyle, 'black')
  setEditorMode(handle, activeMode.current)

  const disposeBeforeCreate = editor.sideEffects.registerBeforeCreateHandler(
    'shape',
    shape => normalizeConstrainedShape(editor, shape, activeMode.current),
  )
  const disposeBeforeChange = editor.sideEffects.registerBeforeChangeHandler(
    'shape',
    (_previous, shape) =>
      normalizeConstrainedShape(editor, shape, activeMode.current),
  )
  yield* Effect.addFinalizer(() =>
    Effect.sync(() => {
      disposeBeforeCreate()
      disposeBeforeChange()
    }),
  )

  return handle
})

export const shapeCount = (handle: SketchEditor): number =>
  handle.editor.getCurrentPageShapeIds().size

export const applyMode = (
  handle: SketchEditor,
  mode: SketchMode,
): Effect.Effect<void, EditorActionError> =>
  Effect.try({
    try: () => {
      handle.activeMode.current = mode
      setEditorMode(handle, mode)
    },
    catch: cause => new EditorActionError({ reason: errorReason(cause) }),
  })

export const applyColor = (
  handle: SketchEditor,
  color: SketchColor,
  applyToSelectedShapes: boolean,
): Effect.Effect<void, EditorActionError> =>
  Effect.try({
    try: () => {
      handle.editor.setStyleForNextShapes(handle.api.DefaultColorStyle, color)
      if (applyToSelectedShapes && handle.editor.getSelectedShapeIds().length > 0) {
        handle.editor.setStyleForSelectedShapes(handle.api.DefaultColorStyle, color)
      }
    },
    catch: cause => new EditorActionError({ reason: errorReason(cause) }),
  })

export const clear = (handle: SketchEditor): Effect.Effect<void, EditorActionError> =>
  Effect.try({
    try: () => {
      handle.editor.selectNone()
      handle.editor.deleteShapes([...handle.editor.getCurrentPageShapeIds()])
      handle.activeMode.current = 'draw'
      setEditorMode(handle, 'draw')
    },
    catch: cause => new EditorActionError({ reason: errorReason(cause) }),
  })

export const toggleSelectedDash = (
  handle: SketchEditor,
): Effect.Effect<void, EditorActionError> =>
  Effect.try({
    try: () => {
      if (handle.editor.getSelectedShapeIds().length === 0) return
      const current = handle.editor
        .getSharedStyles()
        .getAsKnownValue(handle.api.DefaultDashStyle)
      const next: TLDefaultDashStyle = current === 'dashed' ? 'solid' : 'dashed'
      handle.editor.setStyleForSelectedShapes(handle.api.DefaultDashStyle, next)
    },
    catch: cause => new EditorActionError({ reason: errorReason(cause) }),
  })

export const copyImage = Effect.fn('Sketch.copyImage')(function* (
  handle: SketchEditor,
) {
  const ids = [...handle.editor.getCurrentPageShapeIds()]
  const { blob } = yield* Effect.tryPromise({
    try: () =>
      handle.editor.toImage(ids, {
        format: 'png',
        background: true,
        padding: 32,
      }),
    catch: cause => new EditorActionError({ reason: errorReason(cause) }),
  })
  yield* Effect.tryPromise({
    try: () =>
      navigator.clipboard.write([
        new ClipboardItem({ 'image/png': Promise.resolve(blob) }),
      ]),
    catch: cause => new EditorActionError({ reason: errorReason(cause) }),
  })
})
