import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'
import { createHandler } from './server/http.ts'

export default defineConfig(({ mode }) => {
  const env = { ...loadEnv(mode, process.cwd(), ''), ...process.env }
  const handler = createHandler(env, true)
  return {
    plugins: [react(), VitePWA({
      manifest: false,
      registerType: 'autoUpdate',
      workbox: { navigateFallbackDenylist: [/^\/api\//], cleanupOutdatedCaches: true },
    }), {
      name: 'madori-local-api',
      configureServer(server) {
        server.middlewares.use((req, res, next) => {
          if (!req.url?.startsWith('/api/')) return next()
          void handler(req, res)
        })
      },
    }],
    server: {
      fs: {
        // 保留 Vite 默认规则，并阻止开发服务器读取本地交接资料。
        deny: [
          '.env',
          '.env.*',
          '*.{crt,pem,key,p12,pfx,cer,der}',
          '.npmrc',
          '.yarnrc.yml',
          '**/.git/**',
          '**/.local/**',
          'jiantori-handoff.zip',
          '**/jiantori-handoff/**',
        ],
      },
    },
  }
})
