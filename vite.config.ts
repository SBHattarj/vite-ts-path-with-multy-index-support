import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import viteTspathWithMultyIndexSuport from "./plugin/plugin"
// https://vitejs.dev/config/
export default defineConfig({
  
  plugins: [react(), viteTspathWithMultyIndexSuport()]
})
