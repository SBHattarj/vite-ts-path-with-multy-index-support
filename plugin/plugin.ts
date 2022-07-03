import {getTsconfig} from "get-tsconfig"
import { UserConfig } from "vite"
import { resolveOne } from "npm-module-path"
import path from "path"
import fs from "fs-extra"
import { IPackageJson } from "package-json-type"
import { normalizePath } from "vite"
import fg from "fast-glob"

const resolveMainFromPackage = (config: IPackageJson, ssr?: boolean): string => {
    if(ssr) config.module ?? config.main ?? "./index.js"
    if(config.browser == null) return config.module ?? config.main ?? "./index.js"
    if(typeof config.browser == "string") return config.browser ?? "./index.js"
    return config.browser?.[config.module ?? config.main ?? "index.js"] 
        ?? config.browser?.[`./${config.module ?? config.main ?? "index.js"}`]
        ?? "./index.js"
}

const resolveModuleDir = async (module: string, importer: string, root: string = process.cwd()) => {
    let importDir = path.resolve(root, importer.replace(/\/[^\/]+$/, ""))
    let resolvedDir: void | string
    const [_, mainModule, subModule] = [...(module.match(/([^\/]+)(.*)/) ?? [])]
    while(resolvedDir == null) {
        resolvedDir = await resolveOne(mainModule, importDir)
        if(importDir === root) return `${resolvedDir}${subModule}`
        importDir = path.resolve(importDir, "..")
    }
    return `${resolvedDir}${subModule}`
}

const getPackageJson = async (
    module: string, 
    importer: string, 
    root: string = process.cwd()
): Promise<void | {moduleDir: string, packageJson: IPackageJson}> => {
    const moduleDir = await resolveModuleDir(module, importer, root)
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

const resolveRootBareImport = async (id: string, root: string, allowedExtensions: string[]) => {
    const fullPath = normalizePath(path.resolve(root, id))
    const posibleImports = [
        ...(await fg(`${fullPath}@(${allowedExtensions.join("|")})`)), 
        ...(await fg(`${fullPath}/index@(${allowedExtensions.join("|")})`))
    ]
    for(const extension of allowedExtensions) {
        const matchedImport = posibleImports.find( Import => Import.endsWith(extension));
        if(matchedImport != null) return matchedImport
    }
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
            '.json'
        ],
        moduleResolution,
        ...pluginOptions
    }: {root?: string, exclude?: string[], extensions?: string[], moduleResolution?: "classic" | "node" } = {}
): {
    name: string,
    enforce: "pre",
    resolveId: (path: string, importer?: string, options?: {ssr?: boolean}) => Promise<string | null | undefined>,
    config: (config: UserConfig) => Promise<UserConfig>
} {
    const relativeAbsolutePrefixes = ["./", "../", "/"]
    const tsConfig = getTsconfig()?.config
    let viteConfig: UserConfig = {}
    const packageJson = fs.readJsonSync(path.resolve(process.cwd(), "./package.json"))
    const allDependencies = [...Object.keys(packageJson.dependencies ?? {}), ...Object.keys(packageJson.devDependencies)]
    const moduleWithMultyIndex: string[] = []

    return {
        name: "vite-ts-path-with-multy-index-support",
        enforce: "pre",
        async config(config) {
            viteConfig = config
            for(const module of allDependencies) {
                if(
                    config.resolve?.dedupe?.includes(module) 
                    || config.optimizeDeps?.include?.includes(module)
                    || exclude.includes(module)
                ) continue
                if(await hasMultyIndex(module)) moduleWithMultyIndex.push(module)
            }
            config.optimizeDeps = {
                ...config.optimizeDeps,
                exclude: [
                    ...(config.optimizeDeps?.exclude ?? []),
                    ...moduleWithMultyIndex
                ]
            }
            return config
        },
        async resolveId(id, importer, options) {
            try {
                if(importer == null) return
                const root = path.resolve(pluginOptions.root ?? viteConfig.root ?? tsConfig?.compilerOptions?.baseUrl ?? "./")
                if(
                    relativeAbsolutePrefixes.some(
                        prefix => id.startsWith(prefix) 
                        || prefix.substr(0, (id.length - 1) || 1) === id
                    )
                ) return
                const allowedExtensions = viteConfig?.resolve?.extensions ?? extensions

                const packageInfo = await getPackageJson(id, importer)
                if(packageInfo == null) return (moduleResolution ?? tsConfig?.compilerOptions?.moduleResolution ?? "classic") === "classic" ?  await resolveRootBareImport(id, root, allowedExtensions) : null
                const main = resolveMainFromPackage(packageInfo.packageJson, options?.ssr)
                const resolvedId = path.resolve(packageInfo.moduleDir, main)
                const doesModuleExists = await fs.pathExists(resolvedId)
                if(!doesModuleExists) return
                return resolvedId
            } catch {}
        },
    }
}