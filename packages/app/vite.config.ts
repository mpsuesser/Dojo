import { foldkit } from '@foldkit/vite-plugin'
import { Config, Effect } from 'effect'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

const readPort = (name: string, fallback: number): number =>
  Effect.runSync(Config.port(name).pipe(Config.withDefault(fallback)))

const rendererPort = readPort('DOJO_RENDERER_PORT', 7780)
const devToolsMcpPort = readPort('FOLDKIT_DEVTOOLS_MCP_PORT', 7781)

export default defineConfig(({ command }) => ({
  base: './',
  optimizeDeps: {
    exclude: ['@tldraw/assets/imports.vite'],
  },
  plugins: [
    {
      name: 'dojo-content-security-policy',
      transformIndexHtml: html =>
        html
          .replace(
            '__DOJO_STYLE_SRC__',
            command === 'serve' ? "'self' 'unsafe-inline'" : "'self'",
          )
          .replace(
            '__DOJO_CONNECT_SRC__',
            command === 'serve'
              ? "'self' https://api.openai.com ws://127.0.0.1:* ws://localhost:*"
              : "'self' https://api.openai.com",
          ),
    },
    foldkit({ devToolsMcpPort }),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icons/dojo-192.png', 'icons/dojo-512.png'],
      manifest: {
        name: 'Dojo',
        short_name: 'Dojo',
        description: 'Train the craft of directing AI agents.',
        theme_color: '#101b3d',
        background_color: '#071020',
        display: 'standalone',
        start_url: './',
        scope: './',
        icons: [
          {
            src: 'icons/dojo-192.png',
            sizes: '192x192',
            type: 'image/png',
          },
          {
            src: 'icons/dojo-512.png',
            sizes: '512x512',
            type: 'image/png',
          },
          {
            src: 'icons/dojo-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{css,html,js,mp3,png,svg,webp}'],
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
      },
    }),
  ],
  server: {
    host: '127.0.0.1',
    port: rendererPort,
    strictPort: true,
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
  },
}))
