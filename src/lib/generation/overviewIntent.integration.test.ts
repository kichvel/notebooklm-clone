// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { embed } from '@/lib/providers/openai';
import { isNotebookOverviewQuestion } from './overviewIntent';

const hasRealEnv = Boolean(process.env.OPENAI_API_KEY);

// Classification here is by embedding-similarity margin against curated exemplars (see
// overviewIntent.ts), not a regex/keyword list, so it can only be verified against real
// embeddings — there's no pure-string behavior to unit test in isolation.
describe.skipIf(!hasRealEnv)('isNotebookOverviewQuestion', () => {
  it('recognizes broad notebook-overview questions, including paraphrases and mid-sentence scope clauses', async () => {
    const positives = [
      // The two originally-reported bug-report phrasings.
      'What are the sources about?',
      'Summarize the contents of all sources in this notebook.',
      // Reported live afterward: "in this notebook" sits between "sources" and "about" instead
      // of at the end — this was the exact phrasing a regex-template approach missed.
      'What are the sources in this notebook about?',
      // Other natural paraphrases that should be treated the same way.
      'What is this notebook about?',
      "What's in this notebook?",
      'Give me an overview of this notebook.',
      'What topics do the sources cover?',
      'Tell me about the sources in this notebook.',
    ];
    const embeddings = await Promise.all(positives.map((q) => embed(q)));
    const results = await Promise.all(embeddings.map((e) => isNotebookOverviewQuestion(e)));
    results.forEach((result, i) => {
      expect(result, `expected overview intent for: "${positives[i]}"`).toBe(true);
    });
  }, 30000);

  it('does not match ordinary factual questions, including ones that mention "the sources"', async () => {
    const negatives = [
      // Lexically close to an overview question (shares "about" and "the sources") but asks
      // about a specific topic, not the notebook as a whole.
      'Can you tell me about the risks mentioned in the sources?',
      'What does source 2 say about cybersecurity risk?',
      'Summarize the risk factors section.',
      'What kind of animal is a domestic cat?',
      'How tall is Mount Everest?',
      "What's NVIDIA's revenue for fiscal year 2025?",
    ];
    const embeddings = await Promise.all(negatives.map((q) => embed(q)));
    const results = await Promise.all(embeddings.map((e) => isNotebookOverviewQuestion(e)));
    results.forEach((result, i) => {
      expect(result, `expected no overview intent for: "${negatives[i]}"`).toBe(false);
    });
  }, 30000);
});
