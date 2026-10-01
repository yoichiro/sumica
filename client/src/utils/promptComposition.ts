export interface ComposePositivePromptOptions {
  modelKeywords?: string;
  loraKeywords?: string[];
  enhancedPrompt: string;
}

/**
 * Deterministically composes model keywords, LoRA trigger words, and the enhanced prompt
 * into a single comma-separated string, cleaning up redundant whitespace and commas.
 */
export function composePositivePrompt(options: ComposePositivePromptOptions): string {
  const parts: string[] = [];

  const cleanPart = (text?: string): string => {
    if (!text) return '';
    return text
      .trim()
      .replace(/^[\s,]+|[\s,]+$/g, '')
      .trim();
  };

  const modelPart = cleanPart(options.modelKeywords);
  if (modelPart) {
    parts.push(modelPart);
  }

  if (options.loraKeywords && Array.isArray(options.loraKeywords)) {
    for (const kw of options.loraKeywords) {
      const cleanKw = cleanPart(kw);
      if (cleanKw) {
        parts.push(cleanKw);
      }
    }
  }

  const enhancedPart = cleanPart(options.enhancedPrompt);
  if (enhancedPart) {
    parts.push(enhancedPart);
  }

  return parts.join(', ');
}
