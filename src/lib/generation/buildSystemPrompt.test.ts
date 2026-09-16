// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { buildSystemPrompt } from './index';

const base = {
  chatStyle: 'default' as const,
  chatCustomStyle: null,
  chatAnswerLength: 'default' as const,
};

describe('buildSystemPrompt', () => {
  it('instructs a concise answer for "shorter"', () => {
    expect(buildSystemPrompt(3, { ...base, chatAnswerLength: 'shorter' })).toMatch(/concise/i);
  });

  it('instructs a more thorough answer for "default" than "shorter"', () => {
    expect(buildSystemPrompt(3, { ...base, chatAnswerLength: 'default' })).toMatch(/thorough/i);
  });

  it('instructs a comprehensive answer for "longer"', () => {
    expect(buildSystemPrompt(3, { ...base, chatAnswerLength: 'longer' })).toMatch(/comprehensive/i);
  });

  it('includes the custom style text when style is "custom"', () => {
    const prompt = buildSystemPrompt(3, {
      ...base,
      chatStyle: 'custom',
      chatCustomStyle: 'respond at a PhD student level',
    });
    expect(prompt).toContain('respond at a PhD student level');
  });

  it('adds no role/style instruction when style is "default"', () => {
    expect(buildSystemPrompt(3, base)).not.toMatch(/conversational style/i);
  });

  it('instructs the model to use history only for context, not facts', () => {
    expect(buildSystemPrompt(3, base)).toMatch(/never use it as a source of facts/i);
  });

  it('says nothing about source identity when no sourceContext is given', () => {
    expect(buildSystemPrompt(8, base)).not.toMatch(/passages are not sources/i);
  });

  it('states the real source count and names when sourceContext is given, so the model cannot mistake passages for sources', () => {
    const prompt = buildSystemPrompt(8, base, {
      sourceCount: 4,
      sourceTitles: ['NVIDIA 10-K', 'Board audio', 'Climate reports.docx', 'nasa.gov'],
    });
    expect(prompt).toMatch(/exactly 4 sources/i);
    expect(prompt).toContain('"NVIDIA 10-K"');
    expect(prompt).toMatch(/passages are not sources/i);
  });
});
