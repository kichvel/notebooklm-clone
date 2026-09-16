# Sourcebook — Product Definition

## Product objective

Sourcebook is a source-grounded AI knowledge workspace for anyone working with documents. It turns a collection of user-provided materials into an explorable notebook where users can understand the material, ask questions, and verify every answer against its original source.

The initial product is demonstrated through a company-document use case: a user imports internal or public business materials and extracts reliable answers across them.

> **North star:** Turn user-provided sources into a trustworthy, explorable AI workspace.

## Product principles

1. **Grounded by default** — Answers use only the sources selected for the current question.
2. **Trust through inspection** — Every material claim links to the exact supporting passage.
3. **Useful before prompting** — A processed notebook immediately presents a concise synthesis and key topics.
4. **Focused over feature-rich** — The core notebook → sources → answer → citation journey takes priority over feature breadth.
5. **Failures are visible** — Processing and generation states are explicit, actionable, and never silently ignored.

## Primary user journey

1. The user opens Sourcebook under a persistent anonymous session.
2. The user creates a notebook.
3. The user adds one or more sources as files, website URLs, or copied text.
4. Sourcebook parses, indexes, and visibly reports the state of each source.
5. After all submitted sources finish processing, Sourcebook generates a notebook overview with a concise synthesis and key topics.
6. The user selects which ready sources should inform future questions. All ready sources are selected by default.
7. The user asks a question in the notebook's single persistent conversation.
8. Sourcebook either returns a grounded answer with source-name citations or states that the selected sources do not contain enough information.
9. The user opens a citation to inspect its exact supporting passage in a side panel.

## Product experience

### Notebook management

Users can create, open, rename, and delete notebooks. New notebooks begin as **Untitled notebook**. The title is derived from the first added source when possible and remains editable.

Each notebook contains one persistent conversation. Conversation management is intentionally excluded.

### Notebook workspace

The workspace uses a three-column layout inspired by NotebookLM:

- **Sources panel:** add, inspect, select, deselect, retry, and delete sources.
- **Chat panel:** notebook overview, key topics, conversation history, question input, answers, and citations.
- **Studio panel:** on-demand generation of flashcards or a quiz from the notebook's sources, fully implemented. A study guide feature was originally scoped alongside these but has been cut from this submission.

The source panel includes a **Select all** control and an individual checkbox for each source. Selection changes affect future questions only.

### Supported sources

| Source type | Input | Citation identity |
| --- | --- | --- |
| PDF | File upload | Source name and page number |
| DOCX | File upload | Source name and section or passage |
| TXT | File upload | Source name and section or passage |
| Copied text | Pasted content | Source name and section or passage |
| Website | One user-provided public URL | Page title and URL |

Website support imports readable content from a provided URL. Web search, crawling, and automated research are not part of the product.

Each source exposes a clear state: **processing**, **ready**, or **failed**. Failed sources include an understandable reason and a retry action where recovery is possible.

### Notebook overview

Once all newly submitted sources finish processing, Sourcebook generates:

- A concise synthesis of the notebook
- Key topics expressed as suggested questions

Selecting a topic places its question into the chat input for review; it does not submit automatically.

The overview uses all successfully processed sources, regardless of their current checkbox selection. It regenerates when a source is added or deleted, but not when selection changes. During regeneration, the previous overview remains visible with a loading state. If regeneration fails, the previous overview is preserved and the failure is shown.

### Grounded chat

Chat retrieval is limited to the ready sources selected when the question is submitted. Answers must not use unsupported general knowledge. If the selected sources do not contain sufficient evidence, Sourcebook refuses to answer and clearly explains the limitation.

Answers include human-readable source-name references. Selecting any reference opens a side panel containing:

- The exact supporting passage
- The source name or page title
- A page number for PDFs
- A section or passage reference for DOCX, TXT, and copied text
- The original URL for websites

### Source lifecycle and conversation integrity

- Deselecting a source affects only future questions.
- Existing answers retain the source context used when they were generated.
- Deleting a source requires confirmation and excludes it from future retrieval.
- Existing answers remain after deletion, but affected citations clearly state that the source is no longer available.

## MVP scope

### Must have

- Persistent anonymous user sessions
- Notebook creation, opening, renaming, and deletion
- One persistent conversation per notebook
- Multiple sources per notebook
- PDF, DOCX, TXT, copied-text, and public-website ingestion
- Parsing, normalization, chunking, embeddings, and vector retrieval
- Per-source processing and error states
- Source selection for future questions
- Strictly source-grounded answers
- Source-name citations and an exact-passage side panel
- Automatically generated notebook synthesis and key topics
- Loading, empty, failure, and retry experiences
- Responsive, polished UI
- Live deployment

### Practical limits

- Maximum 10 sources per notebook
- Maximum 10 MB per uploaded file
- One URL per website import
- A documented character limit for each copied-text source
- Clear rejection of unsupported, encrypted, or image-only documents

The final copied-text character limit may be chosen during implementation based on model and infrastructure constraints, then surfaced before submission.

## Explicit non-goals

The following are intentionally excluded from the seven-day product:

- Multiple conversations or conversation management
- User registration, profiles, teams, or collaboration
- Sharing and permissions
- Notes and saved answer excerpts
- Audio or video overviews
- Mind maps, reports, infographics, data tables, and slide decks
- Web search, crawling, and autonomous research
- Google Drive, cloud-storage, or third-party content connectors
- Image OCR or image understanding
- Audio and video transcription
- Agentic or multi-step retrieval
- Hybrid search, reranking, or knowledge graphs
- Use of general model knowledge when sources are insufficient
- Full NotebookLM feature or visual parity

These omissions protect the depth, reliability, and polish of the core experience.

## Success criteria

The MVP is successful when a first-time user can complete the following flow without guidance:

```text
Create notebook
→ add multiple sources
→ understand processing status
→ read the generated overview
→ select relevant sources
→ ask a question
→ receive a grounded answer
→ open a citation
→ verify the exact supporting passage
```

The final product should demonstrate:

- **Trust:** Answers are supported, refusals are honest, and evidence is easy to inspect.
- **Clarity:** Source state and retrieval scope are always understandable.
- **Usefulness:** The notebook provides value before the user writes a prompt.
- **Product judgment:** Scope is consciously concentrated on one complete workflow.
- **Shipping quality:** The core flow is stable, responsive, polished, and deployed.

## Future opportunities

After the core experience is validated, Sourcebook could expand toward authenticated accounts, collaboration, notes, study guides, additional source types, web research, hybrid retrieval, reranking, and multi-step reasoning. These are evolution paths rather than requirements for the initial product.
