import { defineConfig } from 'vite'

export default defineConfig({
  server: {
    port: 5173,
  },
  // 환경 변수 설정
  define: {
    'process.env': {}
  }
})

