import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react()],
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
})
