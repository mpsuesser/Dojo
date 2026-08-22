import * as Alchemy from 'alchemy'
import * as Cloudflare from 'alchemy/Cloudflare'
import * as Config from 'effect/Config'
import * as Effect from 'effect/Effect'

const dojoZoneId = 'f8f6d600065554887859b55240cdd98e'

export default Alchemy.Stack(
  'Dojo',
  {
    providers: Cloudflare.providers(),
    state: Cloudflare.state(),
  },
  Effect.gen(function* () {
    const { stage } = yield* Alchemy.Stack
    if (stage === 'prod') {
      yield* Cloudflare.Zone.Setting('AlwaysUseHttps', {
        zoneId: dojoZoneId,
        settingId: 'always_use_https',
        value: 'on',
      })
    }

    const website = yield* Cloudflare.Website.Vite('Website', {
      rootDir: 'packages/app',
      env: {
        VITE_TLDRAW_LICENSE_KEY: Config.redacted('TLDRAW_LICENSE_KEY'),
      },
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
