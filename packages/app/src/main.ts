import * as Schema from 'effect/Schema'
import type { Command, Runtime } from 'foldkit'
import type { Document, HtmlBuilder } from 'foldkit/html'

import dojoArtUrl from '../../../docs/generated-concept-art/01-the-dojo.png'

export const Model = Schema.Literal('Ready')
export type Model = typeof Model.Type

export type Message = never

export const init: Runtime.ApplicationInit<Model, Message> = () => ['Ready', []]

export const update = (
  model: Model,
  _message: Message,
): readonly [Model, ReadonlyArray<Command.Command<Message>>] => [model, []]

export const view = (_model: Model, h: HtmlBuilder<Message>): Document => ({
  title: 'Dojo',
  body: h.main(
    [h.Class('dojo-shell')],
    [
      h.img([
        h.Src(dojoArtUrl),
        h.Alt('A moonlit mountain monastery with a lone traveler approaching'),
        h.Class('dojo-art'),
        h.Attribute('data-testid', 'dojo-art'),
      ]),
    ],
  ),
})
