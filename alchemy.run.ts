import * as Alchemy from 'alchemy'
import * as Cloudflare from 'alchemy/Cloudflare'
import * as Effect from 'effect/Effect'

export default Alchemy.Stack(
  'Dojo',
  {
    providers: Cloudflare.providers(),
    state: Cloudflare.state(),
  },
  Effect.gen(function* () {
    const { stage } = yield* Alchemy.Stack
    const website = yield* Cloudflare.Website.Vite('Website', {
      rootDir: 'packages/app',
      assets: {
        notFoundHandling: 'single-page-application',
      },
      ...(stage === 'prod'
        ? {
            domain: 'dojo.bingo',
            workersDev: false,
          }
        : {}),
    })

    return { url: website.url }
  }),
)
