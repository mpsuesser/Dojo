import { BunHttpClient, BunRuntime, BunServices } from '@effect/platform-bun'
import { Config, Data, Effect, Path, Schedule } from 'effect'
import { HttpClient, HttpClientResponse } from 'effect/unstable/http'
import { ChildProcess, ChildProcessSpawner } from 'effect/unstable/process'

class DevelopmentProcessError extends Data.TaggedError(
  'DevelopmentProcessError',
)<{
  readonly command: string
  readonly exitCode: number
}> {}

const commandOptions = (cwd: string) => ({
  cwd,
  extendEnv: true,
  stdin: 'inherit' as const,
  stdout: 'inherit' as const,
  stderr: 'inherit' as const,
})

const program = Effect.gen(function* () {
  const path = yield* Path.Path
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
  const client = yield* HttpClient.HttpClient
  const rendererPort = yield* Config.port('DOJO_RENDERER_PORT').pipe(
    Config.withDefault(7780),
  )
  const rendererUrl = `http://127.0.0.1:${rendererPort}`
  const repositoryDirectory = path.resolve(
    path.dirname(yield* path.fromFileUrl(new URL(import.meta.url))),
    '..',
  )
  const desktopDirectory = path.join(repositoryDirectory, 'packages', 'desktop')
  const appDirectory = path.join(repositoryDirectory, 'packages', 'app')

  const buildCommand = ChildProcess.make(
    'bun',
    ['run', 'build'],
    commandOptions(desktopDirectory),
  )
  const buildExitCode = yield* spawner.exitCode(buildCommand)
  if (buildExitCode !== ChildProcessSpawner.ExitCode(0)) {
    return yield* new DevelopmentProcessError({
      command: 'bun run build',
      exitCode: buildExitCode,
    })
  }

  yield* Effect.scoped(
    Effect.gen(function* () {
      yield* spawner.spawn(
        ChildProcess.make(
          'bun',
          ['run', 'dev'],
          commandOptions(appDirectory),
        ),
      )

      yield* client.get(rendererUrl).pipe(
        Effect.flatMap(HttpClientResponse.filterStatusOk),
        Effect.timeout('1 second'),
        Effect.retry(
          Schedule.spaced('100 millis').pipe(Schedule.upTo({ times: 99 })),
        ),
      )

      const desktop = yield* spawner.spawn(
        ChildProcess.make('bun', ['run', 'electron', '.'], {
          ...commandOptions(desktopDirectory),
          env: { DOJO_RENDERER_URL: rendererUrl },
        }),
      )
      const desktopExitCode = yield* desktop.exitCode
      if (desktopExitCode !== ChildProcessSpawner.ExitCode(0)) {
        return yield* new DevelopmentProcessError({
          command: 'electron .',
          exitCode: desktopExitCode,
        })
      }
    }),
  )
}).pipe(
  Effect.scoped,
  Effect.provide(BunHttpClient.layer),
  Effect.provide(BunServices.layer),
)

BunRuntime.runMain(program)
