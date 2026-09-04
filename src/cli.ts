import pkg from '../package.json'

/**
 * Commander exits as soon as it sees its version option. Handle the two
 * standalone forms before loading the full CLI runtime so package-manager and
 * health checks do not parse database drivers they will never use.
 */
export function isStandaloneVersionRequest(args: readonly string[]): boolean {
  return args.length === 1 && (args[0] === '--version' || args[0] === '-V')
}

let program: typeof import('./cli-runtime').default | undefined

if (
  import.meta.main &&
  !process.argv.slice(2).includes('--agent-output') &&
  isStandaloneVersionRequest(process.argv.slice(2))
) {
  console.log(pkg.version)
} else {
  // Keep this path non-literal for the production build: cli-runtime.mjs is a
  // separate artifact and must stay unevaluated on the fast version path.
  const runtimePath = './cli-runtime'
  program = (await import(runtimePath)).default
}

export default program
