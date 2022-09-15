# Vite Multy Index Support

This npm package was created for my personal use, so a lot more testing is required. It is only tested on linux.

If you still wanna use this package here is a description of how it works.

you can install this as bellow:
```properties
npm i vite-ts-path-with-multy-index-support
```

you can use this as follows:
```js
import { defineConfig } from 'vite'
import viteMultyIndexSuport from "vite-multy-index-support"
// https://vitejs.dev/config/
export default defineConfig({
  
  plugins: [viteMultyIndexSuport()]
})

```
It only exports one function as seen here.
## It takes one optional object as it's argument. It has the given attributes:
- **root**: ```string``` to set the root of the project. by default it would be the root set in vite config, if not set then it uses baseUrl of tsConfig, if not set uses ```process.cwd()```. It is used to resolve bare import from root when module resolution is classic in ts.
- **exclude**: ```string[]```  exclude certain modules from being resolved by this plugin. It by default will also exclude certain modules added at vite config.
- **extensions**: ```string[]``` extensions to look for when doing root import. It will look for the import and get the first match in the same order as given.it is not used if extensions is defined within resolve of vite config. This defaults to:
```js
[
    '.mjs',
    '.js',
    '.ts',
    '.jsx',
    '.tsx',
    '.json'
]
```

If you would like to you can help me out with windows integration, better documentation and project structure.
