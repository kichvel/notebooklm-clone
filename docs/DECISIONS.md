# Sourcebook — Decision Records

These records capture accepted design decisions for the seven-day take-home project. Acceptance does not imply completed implementation. PRODUCT.md defines scope; ARCHITECTURE.md describes the design; DEVELOPMENT.md will retrospectively document what was built and validated.

The trade-offs below explain the choices made during planning, not a claim that competing products or architectures were benchmarked. Exact libraries, model names, and numeric tuning values remain implementation choices.

## ADR-001 — Use a familiar, role-relevant stack

**Decision:** Use Next.js and TypeScript on Vercel, with Supabase Auth, private Storage, PostgreSQL, and pgvector.

**Rationale:** Familiarity and relevance to the Fullstack Developer role are the primary drivers. The stack also supports fast delivery and fits Sourcebook's application, storage, identity, and retrieval needs with limited infrastructure setup.

**Trade-offs:** Managed services introduce platform coupling and hosting constraints. Familiarity is prioritized over exploring a new stack during the challenge. No comparative stack benchmark was performed.

**Revisit when:** Deployment limits, operating costs, or concrete requirements exceed the chosen services' suitability.

## ADR-002 — Use Inngest with granular ingestion steps

**Decision:** Run one durable workflow per source with separately observable parse, normalize, chunk, embed, and finalize steps. Run overview generation separately.

**Rationale:** Reliable processing, retries, visible failures, existing familiarity, and demonstrating background orchestration all justify the additional service. Small steps also ease development: each stage can be implemented, inspected, and debugged independently.

**Trade-offs:** Checkpoints, idempotency, and progress records add code and state management compared with one large operation. Inngest adds an operational dependency. Supabase remains authoritative for application status; job execution history is not the product database.

**Revisit when:** Measured execution overhead or workflow complexity warrants changing step boundaries or orchestration. Preserve failure visibility and safe retries.

## ADR-003 — Use persistent anonymous identity

**Decision:** Use browser-persisted Supabase anonymous authentication with ownership isolation through database and storage policies.

**Rationale:** Reviewers should be able to try Sourcebook immediately while retaining private, persistent workspaces across return visits in the same browser.

**Trade-offs:** Clearing the session loses access. Account recovery and cross-device access are excluded. Anonymous identities can be recreated, so user-level quotas alone cannot bound demo spending.

**Revisit when:** Returning users need account recovery, cross-device access, sharing, or collaboration.

## ADR-004 — Establish a vector-search baseline

**Decision:** Start with notebook- and source-filtered Top-K vector retrieval and a bounded context budget. Defer hybrid retrieval, reranking, and agentic retrieval.

**Rationale:** This gives the project a clear, testable retrieval baseline within seven days. It keeps the evidence path understandable and provides a basis for evaluating later improvements.

**Trade-offs:** Exact-term queries and complex cross-document questions may require better retrieval. Similarity scores cannot establish whether a question is answerable. Simplicity is not a claim that retrieval quality is already sufficient; a fixed evaluation set must test it.

**Revisit when:** Evaluation failures reveal a specific retrieval limitation that a more advanced approach can address.

## ADR-005 — Require source-grounded answers and explicit refusals

**Decision:** Answer only from evidence retrieved from the selected ready sources. Refuse unsupported questions, even when a general-purpose model could answer them. Prior conversation may clarify a follow-up question but does not count as evidence.

**Rationale:** Verifiability is Sourcebook's central value. Users should be able to distinguish what their documents support from what a model might otherwise know or infer.

**Trade-offs:** The product is less permissive than general-purpose chat and may refuse questions when retrieval misses relevant evidence. Server validation prevents invented citation targets but cannot guarantee semantic support for every claim.

**Revisit when:** Evidence-based evaluations identify avoidable refusals or unsupported answers. Improve retrieval and grounding first; introducing general knowledge would require an explicit product decision.

## ADR-006 — Use small provider and source-adapter interfaces

**Decision:** Initially use OpenAI for generation and embeddings, with configurable model names behind small generation and embedding interfaces. Normalize file, website, and pasted-text inputs through a shared source-adapter contract, including PDF and DOCX implementations.

**Rationale:** Keep external implementations separate from core ingestion and generation logic. Multiple actual source formats demonstrate extensibility through working implementations. Model configuration permits task-specific choices without spreading provider details throughout the application.

**Trade-offs:** Interfaces add some implementation overhead and cannot erase provider-specific behavior. Changing embedding models or dimensions requires compatible query embeddings and re-indexing; configuration alone does not make stored vectors interchangeable. No specific alternative generation provider was evaluated during planning.

**Revisit when:** A required source format or measured provider limitation calls for another implementation. Expand interfaces only for concrete needs.

## ADR-007 — Generate notebook overviews automatically

**Decision:** Automatically generate a concise synthesis and key topics from all ready sources. Cache grounded source summaries and regenerate the overview after source additions or deletions, using revision checks to prevent stale publication. Checkbox changes affect chat only.

**Rationale:** Immediate usefulness is the main driver: the notebook should help users understand their material before their first question. Cached source summaries reduce repeated work when the source collection changes.

**Trade-offs:** Additional model calls, summary storage, invalidation, and revision logic are required. Summarization can lose detail, so chat retrieves original passages rather than treating the overview as its evidence. Failed updates preserve the previous overview with an explicit status.

**Revisit when:** Quality evaluations or observed cost and latency justify different summary granularity, caching, or update behavior.

## ADR-008 — Stream provisional answers

**Decision:** Stream answer text, resolve references against supplied evidence, and validate the completed response before marking it complete. Failed or interrupted attempts remain visibly incomplete and retryable.

**Rationale:** Responsiveness and familiarity with the NotebookLM interaction make streaming worth the added complexity. Users can begin reading while generation continues.

**Trade-offs:** Streaming complicates parsing, citation validation, persistence, and retry handling. Provisional text can be visible before final validation; clickable citations must already have valid targets. Structural validation is not semantic verification.

**Revisit when:** Streaming reliability or validation complexity undermines the experience. A simpler response mode is preferable to silently presenting invalid output as complete.

## ADR-009 — Inspect extracted passages in a common viewer

**Decision:** Open citations in a shared side panel displaying the stored supporting passage and source metadata. Use PDF page numbers or available section/passage references. Offer authorized original-file links; defer original PDF rendering and highlighting.

**Rationale:** Immediate evidence inspection and consistent behavior across formats take priority over reproducing original document layouts.

**Trade-offs:** Extracted text loses some layout context. The original file can provide that context, but Sourcebook will not highlight it in place. Website snapshots preserve citation consistency as live pages change. Deleted sources leave unavailable references in historical answers.

**Revisit when:** Users need visual context, tables, or in-document navigation to verify evidence effectively.

## ADR-010 — Observe AI work with metadata-first Langfuse traces

**Decision:** Record models, timings, usage, retrieval IDs, outcomes, and sanitized errors in Langfuse by default. Enable full-content tracing only through an explicit development setting.

**Rationale:** Understand AI behavior, performance, and usage without routinely duplicating uploaded content in traces.

**Trade-offs:** Metadata-only traces provide less detail for debugging production answers. Full-content development tracing must be deliberately controlled, including automatic instrumentation. Observability adds a dependency but must not determine whether user work succeeds.

**Revisit when:** Concrete debugging or evaluation needs require more detail, with an explicit decision about what content may be recorded.

## ADR-011 — Keep the interaction and import scope focused

**Decision:** Use one persistent conversation per notebook, poll for active processing status, and import single public HTML URLs without crawling, login handling, or browser rendering.

**Rationale:** These choices keep implementation manageable within seven days while supporting the core workflow. One conversation also follows the intended NotebookLM-inspired experience. Additional complexity should follow actual needs or measured limitations.

**Trade-offs:** Users cannot separate discussion threads. Polling introduces repeated requests and a short status delay. Some websites cannot be imported, and there is no source-discovery workflow.

**Revisit when:** User needs justify separate threads or richer imports, or measured polling load and latency justify realtime updates.

## Maintaining this record

Keep these decisions as the planning baseline. When implementation changes one, mark it superseded and link to a new record explaining the evidence and replacement. Record actual validation and development events retrospectively in DEVELOPMENT.md; do not turn planned outcomes into completed claims.
