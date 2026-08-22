import * as Redacted from 'effect/Redacted'
import * as Schema from 'effect/Schema'
import * as Str from 'effect/String'

/** A user-owned OpenAI credential protected from ordinary inspection. */
export const OpenAiApiKey = Schema.Redacted(Schema.String, {
  label: 'OpenAI API key',
})
export type OpenAiApiKey = typeof OpenAiApiKey.Type

/** Storage boundary that wraps a decoded plaintext key as a redacted value. */
export const OpenAiApiKeyFromValue = Schema.RedactedFromValue(Schema.String, {
  label: 'OpenAI API key',
})

/** Empty API-key value used until the user configures OpenAI access. */
export const emptyOpenAiApiKey: OpenAiApiKey = Redacted.make('', {
  label: 'OpenAI API key',
})

/** Whether a usable OpenAI key has been configured. */
export const hasOpenAiApiKey = (apiKey: OpenAiApiKey): boolean =>
  Str.isNonEmpty(Str.trim(Redacted.value(apiKey)))
