import { describe, it, expect } from 'vitest';
import { composePositivePrompt } from './promptComposition';

describe('composePositivePrompt', () => {
  it('combines model keywords, lora keywords, and enhanced prompt in order', () => {
    const result = composePositivePrompt({
      modelKeywords: 'score_9, score_8_up, masterpiece',
      loraKeywords: ['costume_a, ribbon', 'hatsune miku'],
      enhancedPrompt: 'a girl smiling in the beach, sunny day',
    });
    expect(result).toBe(
      'score_9, score_8_up, masterpiece, costume_a, ribbon, hatsune miku, a girl smiling in the beach, sunny day'
    );
  });

  it('returns only enhanced prompt when model and lora keywords are empty', () => {
    const result = composePositivePrompt({
      modelKeywords: '',
      loraKeywords: ['', '   '],
      enhancedPrompt: 'a beautiful mountain',
    });
    expect(result).toBe('a beautiful mountain');
  });

  it('handles only model keywords and enhanced prompt', () => {
    const result = composePositivePrompt({
      modelKeywords: 'score_9, score_8_up',
      enhancedPrompt: 'cyberpunk street',
    });
    expect(result).toBe('score_9, score_8_up, cyberpunk street');
  });

  it('handles only lora keywords and enhanced prompt', () => {
    const result = composePositivePrompt({
      loraKeywords: ['flat color', 'retro style'],
      enhancedPrompt: 'cat on a roof',
    });
    expect(result).toBe('flat color, retro style, cat on a roof');
  });

  it('cleans up leading and trailing commas and whitespace on parts', () => {
    const result = composePositivePrompt({
      modelKeywords: ' , score_9, score_8_up , , ',
      loraKeywords: [', ribbon ,'],
      enhancedPrompt: 'sunset sky,',
    });
    expect(result).toBe('score_9, score_8_up, ribbon, sunset sky');
  });

  it('returns keywords when enhanced prompt is empty', () => {
    const result = composePositivePrompt({
      modelKeywords: 'score_9',
      loraKeywords: ['solo'],
      enhancedPrompt: '',
    });
    expect(result).toBe('score_9, solo');
  });
});
