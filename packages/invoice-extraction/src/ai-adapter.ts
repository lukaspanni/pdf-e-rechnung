import type { AiExtractionAdapter, ExtractionPlugin } from './contracts'

/** Wraps a provider adapter as a runner plugin and validates output before mapping. */
export function createAiExtractionPlugin<TPromptInput, TStructuredOutput>(
  adapter: AiExtractionAdapter<TPromptInput, TStructuredOutput>,
): ExtractionPlugin {
  return {
    id: adapter.id,
    fieldGroups: adapter.fieldGroups,
    priority: adapter.priority,
    async run(context) {
      const promptInput = adapter.createPromptInput(context)
      const rawOutput = await adapter.invoke({
        promptInput,
        sourcePdf: context.sourcePdf,
      })
      const output = adapter.outputSchema.parse(rawOutput)
      const candidates = adapter.mapEvidence(output, context)
      for (const field of adapter.fieldGroups) {
        const values = candidates[field]
        if (!values) continue
        candidates[field] = values.map((candidate) => ({
          ...candidate,
          provenance: candidate.provenance ?? {
            source: 'generated',
            pluginId: adapter.id,
          },
        })) as never
      }
      return { candidates }
    },
  }
}
