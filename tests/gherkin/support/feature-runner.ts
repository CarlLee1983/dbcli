import { describe, test } from 'bun:test'
import { AstBuilder, compile, GherkinClassicTokenMatcher, Parser } from '@cucumber/gherkin'
import { IdGenerator } from '@cucumber/messages'

export type StepDefinition<World> = {
  pattern: RegExp
  run: (world: World, match: RegExpMatchArray) => void | Promise<void>
}

type FeatureDefinition<World> = {
  featurePath: string
  createWorld: () => World | Promise<World>
  afterScenario?: (world: World) => void | Promise<void>
  steps: readonly StepDefinition<World>[]
}

/**
 * Parses a .feature file with the official Gherkin parser, then registers each
 * scenario as a Bun test. `compile` also expands backgrounds and outlines.
 */
export async function defineFeature<World>({
  featurePath,
  createWorld,
  afterScenario,
  steps,
}: FeatureDefinition<World>): Promise<void> {
  const source = await Bun.file(featurePath).text()
  const newId = IdGenerator.incrementing()
  const document = new Parser(new AstBuilder(newId), new GherkinClassicTokenMatcher()).parse(source)
  const feature = document.feature
  if (!feature) throw new Error(`Gherkin file has no feature: ${featurePath}`)

  const scenarios = compile(document, featurePath, newId)
  if (scenarios.length === 0) throw new Error(`Gherkin feature has no scenarios: ${featurePath}`)

  describe(feature.name, () => {
    for (const scenario of scenarios) {
      test(scenario.name, async () => {
        const world = await createWorld()
        try {
          for (const step of scenario.steps) {
            const matches = steps
              .map((definition) => ({ definition, match: step.text.match(definition.pattern) }))
              .filter(
                (
                  candidate
                ): candidate is { definition: StepDefinition<World>; match: RegExpMatchArray } =>
                  Boolean(candidate.match)
              )

            if (matches.length !== 1) {
              const reason = matches.length === 0 ? 'No' : 'More than one'
              throw new Error(`${reason} step definition matched "${step.text}" in ${featurePath}`)
            }
            await matches[0].definition.run(world, matches[0].match)
          }
        } finally {
          await afterScenario?.(world)
        }
      })
    }
  })
}
