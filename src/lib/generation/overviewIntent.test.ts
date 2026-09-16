// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { isNotebookOverviewQuestion } from './overviewIntent';

describe('isNotebookOverviewQuestion', () => {
  it('recognizes the two reported bug-report phrasings', () => {
    expect(isNotebookOverviewQuestion('What are the sources about?')).toBe(true);
    expect(
      isNotebookOverviewQuestion('Summarize the contents of all sources in this notebook.'),
    ).toBe(true);
  });

  it('recognizes close variants of a notebook-wide overview request', () => {
    expect(isNotebookOverviewQuestion('what is the notebook about')).toBe(true);
    expect(isNotebookOverviewQuestion('Give me an overview of this notebook.')).toBe(true);
    expect(isNotebookOverviewQuestion('Overview of everything in this notebook')).toBe(true);
    expect(isNotebookOverviewQuestion("What's in this notebook?")).toBe(true);
    expect(isNotebookOverviewQuestion('summarize this notebook')).toBe(true);
    expect(isNotebookOverviewQuestion('  WHAT ARE THE SOURCES ABOUT?  ')).toBe(true);
  });

  it('recognizes a scope clause inserted mid-sentence, not just appended at the end', () => {
    // Reported live: this exact phrasing missed the original pattern set because "in this
    // notebook" sat between "sources" and "about" instead of after "about".
    expect(isNotebookOverviewQuestion('what are the sources in this notebook about?')).toBe(true);
    expect(isNotebookOverviewQuestion('What are the sources in this notebook about?')).toBe(true);
    expect(
      isNotebookOverviewQuestion('summarize the contents of all sources in this notebook'),
    ).toBe(true);
    expect(isNotebookOverviewQuestion('what do the sources in the notebook cover?')).toBe(true);
    expect(isNotebookOverviewQuestion('give me a summary of the sources in this notebook')).toBe(
      true,
    );
  });

  it('does not match ordinary factual questions that merely mention "sources"', () => {
    expect(
      isNotebookOverviewQuestion('Can you tell me about the risks mentioned in the sources?'),
    ).toBe(false);
    expect(isNotebookOverviewQuestion('What does source 2 say about cybersecurity risk?')).toBe(
      false,
    );
    expect(isNotebookOverviewQuestion('What kind of animal is a domestic cat?')).toBe(false);
    expect(isNotebookOverviewQuestion('Summarize the risk factors section.')).toBe(false);
  });
});
