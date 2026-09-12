# Sourcebook — Roadmap

This roadmap combines a compact seven-day delivery plan with undated product-evolution tracks. All milestones are planned, not claims of completed work. Future tracks are unranked possibilities, not submission requirements or release commitments.

PRODUCT.md defines the MVP, ARCHITECTURE.md defines its implementation boundaries, and DECISIONS.md records their rationale. Actual progress and deviations will be documented retrospectively in DEVELOPMENT.md.

## Seven-day build

Days are relative to the challenge window. Testing accompanies implementation throughout; Day 6 is the final hardening pass.

| Target | Milestone | Completion gate |
| --- | --- | --- |
| Days 1–3 | Deployed vertical slice | A visitor creates an anonymous notebook, uploads one PDF, sees processing progress, asks a question, receives a grounded answer, and inspects its supporting passage through a citation. The flow works on the live deployment with ownership isolation. |
| Days 4–5 | Complete the agreed MVP | Add DOCX, TXT/Markdown, copied text, and public-URL ingestion; notebook and source management; source selection; persistent chat and streaming; automatic synthesis and clickable key topics. Verify that source selection affects future chat only and overview updates use all ready sources. |
| Day 6 | Reliability and polish | Validate retries, incomplete responses, deletion behavior, stale-job protection, access isolation, and usage limits. Run the fixed retrieval/grounding evaluation set and end-to-end flow. Resolve material failures and polish loading, empty, and error states. |
| Day 7 | Submission | Complete final QA and a deployed smoke test, reconcile documentation with actual implementation, verify public repository and local setup instructions, and record the Loom walkthrough of at most 10 minutes. |

Establish provider and source interfaces, private storage, background processing, and basic observability while building the vertical slice. Expand working implementations through those boundaries during Days 4–5. No major new features are planned for Day 7.

The submission gate is a trustworthy, complete notebook → sources → answer → citation experience plus the agreed MVP. Any necessary scope change must be recorded explicitly rather than silently treated as completed. Future tracks below do not expand the seven-day scope.

## Product evolution

The aim is to broaden what users can analyze and improve answer quality while retaining a consistent, inspectable evidence path. Interfaces are small extension points exercised by the MVP, not a promise of universal compatibility.

### Retrieval quality across sources

**User benefit:** More reliable answers to exact-term queries and complex questions spanning several documents.

**Foundation now:** Source-filtered vector search returns passages through a common evidence contract: stable passage ID, source identity, text, and location metadata. Generation consumes this evidence, and the server resolves citation references independently of how passages were retrieved.

**Possible extension:** Add lexical/vector hybrid search or reranking when evaluations expose limitations in the baseline. These approaches may improve which passages reach the model without requiring a new citation-rendering system.

**Why this boundary:** Retrieval strategy should evolve independently of the trust experience. Here, improving cross-source citations means improving evidence retrieval for cross-document questions; a separate agreement/contradiction visualization is not a committed feature.

**Validation:** Compare changes against the same exact-term and cross-document questions, checking relevant-evidence retrieval, answer support, citation validity, refusals, latency, and cost. Adopt complexity for demonstrated gains rather than assumed superiority.

### Model and provider flexibility

**User benefit:** Keep Sourcebook adaptable as generation quality, latency, cost, and deployment needs change.

**Foundation now:** OpenAI is the initial generation and embedding provider. Small provider interfaces and independently configurable generation model names keep model-specific calls out of core product logic.

**Possible extension:** Integrate additional providers or assign models to tasks based on evaluated performance. Bring-your-own-model remains an undated future possibility, outside the MVP; its endpoint, credential, and user-interface design is not yet specified.

**Why this boundary:** Replacing a generation implementation should not require rewriting source ingestion, notebook behavior, or citation resolution. The ambition is broad model support, subject to the capabilities needed for grounded generation and streaming.

**Validation:** Each integration must meet the same grounding, refusal, output-structure, citation, and failure-handling expectations. Provider interfaces do not guarantee that any model works unchanged. Embedding changes are separate: compatible dimensions and query/document embeddings must be maintained, with re-indexing where required.

### Broader source formats

**User benefit:** Let users work with more of their material inside the same notebook experience.

**Foundation now:** PDF, DOCX, TXT/Markdown, pasted text, and website adapters normalize inputs into ordered text blocks with origin and location metadata. Chunking, indexing, retrieval, and citation handling operate on that common structure.

**Possible extension:** Add further file formats and content adapters as concrete needs arise. Broad format coverage is the direction; no exhaustive format list or priority order is committed.

**Why this boundary:** A new format should primarily require an extraction adapter and appropriate location metadata, while reusing the downstream processing pipeline. Initial PDF and DOCX support exercises the abstraction with genuinely different inputs.

**Validation:** Check extraction fidelity, readable content, provenance, failure behavior, and citation inspection for every new adapter. Some formats may require extending location metadata or the viewer; extensibility does not imply zero downstream changes.

### YouTube transcripts

**User benefit:** Ask grounded questions about spoken video content alongside uploaded documents.

**Foundation now:** The source-adapter contract provides a route to represent transcript segments as text blocks. Extend location metadata with start/end timestamps and the original video URL.

**Possible extension:** Import available YouTube transcripts, preserving timestamps through chunking and citations so a user can inspect the supporting text and open the relevant video moment.

**Why this boundary:** Transcript text can reuse the existing evidence pipeline. This first extension analyzes available spoken-text transcripts; it does not imply understanding video frames or creating transcripts from audio.

**Validation:** Confirm a viable transcript-access method during implementation, handle unavailable transcripts explicitly, and verify timestamp accuracy and citation links. Automatic audio transcription and visual video analysis are outside this proposed initial extension.

## How the roadmap evolves

Future tracks have no assigned dates or priority ranking. Select concrete work based on observed user needs, evaluation results, and implementation constraints. Keep the common evidence contract and strict grounding behavior intact as models, sources, and retrieval strategies change.

Before implementing a future capability, define its user outcome, scope, and validation gate. Update the product, architecture, and decision records when those commitments change; preserve the original seven-day delivery account in the development retrospective.
