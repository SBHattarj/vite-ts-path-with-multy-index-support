import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import viteTspathWithMultyIndexSuport from "./plugin/plugin"
import {transform} from "@chialab/cjs-to-esm"

import { cjs2esmVitePlugin } from 'cjs2esmodule'
// https://vitejs.dev/config/
export default defineConfig({
  define: {
    "process.env": process.env
  },
  plugins: [react(), viteTspathWithMultyIndexSuport(), {
    name: "cjs-to-esm",
    async transform(code, id, options) {
    console.log(id)
    // if(id.includes("with-router")) console.log(await transform(code))
    //     if(id.replace(/\?[^?\/\\]*/, "").endsWith(".mjs") || id.endsWith(".ts")) return
    //     try {
    //         return await transform(code)

    //     } catch {}
    },
    enforce: "pre"
  }],
  build: {
    commonjsOptions: {
      transformMixedEsModules: true,
      
    }
  }
})
