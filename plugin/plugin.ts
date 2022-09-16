import {getTsconfig} from "get-tsconfig"
import { UserConfig } from "vite"
import { resolveOne } from "npm-module-path"
import path from "path"
import fs from "fs-extra"
import { IPackageJson } from "package-json-type"
import { normalizePath } from "vite"
import fglob from "fast-glob"
import {transform} from "@chialab/cjs-to-esm"
const fg = async (...args: Parameters<typeof fglob>) => {
    try {
        if(args[0].includes("\0")) return []
        return await fglob(...args)
    } catch {
        return []
    }
}
const resolveMainFromPackage = async (config: IPackageJson, ssr: boolean, packageRoot: string): Promise<string> => {
    if(ssr) return config.main ?? config.module ?? "./index.js"
    if(config.browser == null) return config.module ?? config.main ?? "./index.js"
    if(typeof config.browser == "string") {
        const id = config.browser ?? "./index.js"
        if(await fs.pathExists(path.resolve(packageRoot, id?.replace(/\.m+[jt]s/, ".cjs")))) return id?.replace(/\.m+[jt]s/, ".cjs")
        return id
    }
    const id: string = config.browser?.[config.module ?? config.main ?? "index.js"] 
        ?? config.browser?.[`./${config.module ?? config.main ?? "index.js"}`]
        ?? "./index.js"
    if(await fs.pathExists(id?.replace(/\.m+[jt]s/, ".cjs"))) return id?.replace(/\.m+[jt]s/, ".cjs")
    return id
}

const resolveModuleDir = async (module: string, importer: string, root: string = process.cwd()) => {
    let importDir = importer === root ? root : path.resolve(root, importer.replace(/\/[^\/]+$/, ""))
    let resolvedDir: void | string
    const [_, mainModule, subModule] = [...(module.match(/([^\/]+)(.*)/) ?? [])]
    while(resolvedDir == null) {
        resolvedDir = await resolveOne(mainModule, importDir)
        if(importDir === root) return `${resolvedDir}${subModule}`
        importDir = path.resolve(importDir, "..")
    }
    if(resolvedDir == null) return
    return `${resolvedDir}${subModule}`
}

const getPackageJson = async (
    module: string, 
    importer: string, 
    root: string = process.cwd(),
    ModuleDir?: string | undefined | null
): Promise<null | undefined | {moduleDir: string, packageJson: IPackageJson}> => {
    const moduleDir = ModuleDir ?? await resolveModuleDir(module, importer, root)
    if(typeof moduleDir !== "string") return
    try {
        return {
            moduleDir,
            packageJson: await fs.readJSON(path.resolve(moduleDir, "./package.json"))
        }
    } catch {}
}

const hasMultyIndex = async (module: string, root: string = process.cwd()) => {
    const packageData = await getPackageJson(module, `${process.cwd()}/index.json`, root)
    const packageJson = packageData?.packageJson
    return packageJson?.browser != null

}

const resolveModule = async (
    moduleId: string, 
    importer: string, 
    ssr?: boolean, 
    posibleExtensions: string[] = [
        'cjs',
        '.js',
        '.ts',
        '.jsx',
        '.tsx',
        '.json',
        '.mjs',
    ], 
    root: string = 
    process.cwd()
) => {
    const moduleDir = await resolveModuleDir(moduleId, importer, root)
    const posibleImport = (await posibleExtensions.reduce(async (posibleImports, extension) => [...(await posibleImports), ...(await fg(`${moduleDir}*${extension}`))], Promise.resolve([]) as Promise<string[]>))[0]
    if(posibleImport != null) return posibleImport
    if(typeof moduleDir !== "string") return
    const packageInfo = await getPackageJson(moduleId, importer, root, moduleDir)
    if(packageInfo == null) return
    const main = await resolveMainFromPackage(packageInfo?.packageJson, ssr ?? false, moduleDir)
    const resolvedId = path.resolve(packageInfo?.moduleDir, main)
    const doesModuleExists = await fs.pathExists(resolvedId)
    if(!doesModuleExists) return
    return resolvedId
}

export default function viteTspathWithMultyIndexSupport(
    {
        exclude = [], 
        extensions = [
            '.mjs',
            '.js',
            '.ts',
            '.jsx',
            '.tsx',
            '.json',
            '.cjs',
            '.svg',
            '.png',
            '.jpeg',
            '.ico'
        ],
        ...pluginOptions
    }: {root?: string, exclude?: string[], extensions?: string[], moduleResolution?: "classic" | "node" } = {}
): {
    name: string,
    enforce: "pre",
    // resolveId: (path: string, importer?: string, options?: {ssr?: boolean}) => Promise<string | null | undefined>,
    config: (config: UserConfig, env: {mode: string, command: string}) => Promise<UserConfig | void>,
    // transform: (code: string, id: string, options?: {ssr?: boolean}) => Promise<string | null | undefined | void>,
    // load: (id: string) => string | null | undefined
} {
    const transformMap: {[id: string]: string} = {}
    const resolveMap: {[id: string]: string} = {}
    const relativeAbsolutePrefixes = ["./", "../", "/"]
    const tsConfig = getTsconfig()?.config
    let viteConfig: UserConfig = {}
    const packageJson = fs.readJsonSync(path.resolve(process.cwd(), "./package.json"))
    const allDependencies = [...Object.keys(packageJson.dependencies ?? {}), ...Object.keys(packageJson.devDependencies)]
    const moduleWithMultyIndex: string[] = []

    return {
        name: "vite-ts-path-with-multy-index-support",
        enforce: "pre",
        async config(config, env) {
            viteConfig = config
            for(const module of allDependencies) {
                if(
                    config.resolve?.dedupe?.includes(module) 
                    // || config.optimizeDeps?.include?.includes(module)
                    || exclude.includes(module)
                ) continue
                if(await hasMultyIndex(module)) moduleWithMultyIndex.push(module)
            }
            const compiledModulesRaw = await Promise.all(moduleWithMultyIndex.map(async module => {
                const ssrId = await resolveModule(module, process.cwd(), true)
                const clientId = await resolveModule(module, process.cwd(), false)
                if((await Promise.all([
                    fs.pathExists(path.resolve(
                        process.cwd(), 
                        `node_modules/dev-${module}/index.cjs`
                    )),
                    fs.pathExists(path.resolve(
                        process.cwd(), 
                        `node_modules/dev-${module}/package.json`
                    ))
                ])).every(exists => exists)) return module
                await Promise.all([fs.ensureFile(
                    path.resolve(
                        process.cwd(), 
                        `node_modules/dev-${module}/index.cjs`
                    )
                ),
                 fs.ensureFile(
                    path.resolve(
                        process.cwd(), 
                        `node_modules/dev-${module}/package.json`
                    )
                )])
                if(ssrId == null || clientId == null) return
                if(ssrId.endsWith(".mjs") || clientId.endsWith(".mjs")) return
                await fs.writeFile(path.resolve(process.cwd(), `node_modules/dev-${module}/index.cjs`), `if(typeof document === "undefined") {
                    console.log("ssr")
                    module.exports = require("raw-${ssrId?.replace(`${path.resolve(process.cwd(), "node_modules/")}/`, "")}")
                } else {
                    console.log("no ssr")
                    module.exports = require("raw-${clientId?.replace(`${path.resolve(process.cwd(), "node_modules/")}/`, "")}")
                }`)
                await fs.writeFile(path.resolve(process.cwd(), `node_modules/dev-${module}/package.json`), `
                {
                    "main": "./index.cjs",
                    "type": "commonjs",
                    "name": "dev-${module}"
                }`)
                return module
            }))
            const compiledModules = compiledModulesRaw.filter(module => module != null).reduce((compiledModules, module) => ({...compiledModules, [module ?? "\0"]: `dev-${module}`, [`raw-${module}`]: module}), {})
            config.resolve = {
                ...(config.resolve ?? {}),
                alias: {
                    ...compiledModules,
                    ...(config.resolve?.alias ?? {})
                }
            }
            
            return config
        },
    //     async resolveId(id, importer, options) {
    //         try {
    //             if(importer == null) return
    //             if(
    //                 relativeAbsolutePrefixes.some(
    //                     prefix => id.startsWith(prefix) 
    //                     || prefix.substr(0, (id.length - 1) || 1) === id
    //                 )
    //             ) return
    //             if(id in resolveMap) return resolveMap[id]
    //             const root = path.resolve(pluginOptions.root ?? viteConfig.root ?? tsConfig?.compilerOptions?.baseUrl ?? "./")
    //             const allowedExtensions = viteConfig?.resolve?.extensions ?? extensions
    //             const resolvedId = await resolveModule(id, importer, options?.ssr)
    //             if(resolvedId == null) return
    //             resolveMap[id] = resolvedId
    //             return resolvedId
    //         } catch {}
    //     },
    //     load(id) {
    //         if(!(id in transformMap)) return
    //         return transformMap[id]
    //     },
    //     async transform(code, id) {
    //         if(code.includes("//!=transformed-commonJS-esm")) return
    //         if(id.replace(/\?[^?\/\\]*/, "").endsWith(".mjs") || id.endsWith(".ts")) return
    //         if(
    //             !code.includes("require") 
    //             && !code.includes("module") 
    //             && !code.includes("exports")
    //         ) return
    //         try {
    //             const compiledCode = (await transform(code))?.code
    //             transformMap[id] = `${compiledCode}//!=transformed-commonJS-esm`
    //             return compiledCode
    //         } catch {}
    //     }
    }
}