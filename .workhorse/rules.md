# Spec rules

Specs live in `docs/spec/`, organised by area, and each carries a frontmatter `id`.
For the spec file format, the fold/create/split decision, and when a change warrants a spec update, follow `.agents/docs/spec-format.md` and the Workhorse skills.
This file records the house conventions that sit on top of that, and wins where the two differ.

A spec is the durable description of **what** the system requires.
It is read by someone deciding whether an implementation is correct, or re-implementing the system from scratch, and not as a narrative of how the code works or how it came to be.

## House style

- Specs are prose requirements in the voice of a standard such as RFC 9000, with each sentence on its own line and no hard wrapping.
  They do not use the checkbox acceptance-criteria format shown in `spec-format.md`.
- One requirement per sentence, with a named actor: "A node MUST…", "The Gateway MUST…".
- The keywords of BCP 14 carry the force.
  MUST is for what breaks interoperability, a security property, a reliability guarantee, or a product commitment.
  Cost optimisations and behaviour of consumers are SHOULD or MAY.
- Sets of values and shapes (labels, annotations, parameters, strategies by platform) go in tables with a header row, followed by the normative sentences a table cannot carry.
- Explanation, rationale and consequences go in `> [!NOTE]` blocks, set apart from the binding text.
  A note never contains an RFC 2119 keyword and is never placed inline on a normative sentence.
  Keep a note only where cutting it would let someone build a plausible variant that is unsafe or does not interoperate.
- No em-dashes.
  Australian/NZ English spelling.
- No stand-in nouns ("what", "this"): name the thing.
  A demonstrative points at a noun and not at a proposition.

## Root spec and terminology

`docs/spec/overview.md` is the entryway and meta spec: one sentence on what the project is, the requirements notation, the table of external documents, and the global terminology.
It does not index the other specs or restate their content.

- A term coined here goes in the overview's `## Terminology` under its own `###` heading, as one sentence of gloss followed by `Defined in [ID](path#heading).`
  The glossary states no properties and no normative text, which belong in the owning spec.
- A term defined by an external document goes in a `## Borrowed terms` table near the top of each spec that uses it, citing the document.
- A term is defined before any spec leans on it.
  Name a thing by its role, not by the artefact that carries it today.
- Every external standard or product document a spec cites has a row in the overview's external-documents table.
  Pin a revision only where the revision is the stability guarantee.

## Cross-references and citations

- Specs reference each other by markdown link under the id, e.g. `[K8SNOD](kubernetes/nodes.md)`.
  A defined term is linked by deep link to its heading, `[dedicated pool](../overview.md#dedicated-pool)`, at its first occurrence in each spec.
- Ids are 2 to 6 uppercase alphanumeric characters with no hyphen.
  Specs for one platform share a prefix (`K8S…`).
- Code cites the spec it implements with an inline comment of the form `// spec: K8SNOD#node-identity`, where the anchor is the slug of a `##` or `###` heading.
  Each spec has one `##` section per topic, and code cites the topic.
  One comment cites one target, so code implementing several topics carries several comments.
- Deep links break silently when a heading is reworded, so `node scripts/check-spec-links.mjs` checks every link, anchor and citation.
  It runs in CI and must pass.

## What, not how

- Describe **what** the system requires, not **how** the code achieves it.
  Keep out of spec text tool and command names, library names, internal API details, data-structure choices, Pulumi config keys, and environment variables used only by the implementation.
- Interface contracts are the exception, because external actors or other components depend on them: resource names, label and annotation keys, on-disk and on-the-wire shapes, endpoint paths, credential scopes.
  Wherever a contract exists, the spec carries enough for someone to write a compatible implementation from scratch.
- The test: would someone re-implementing the system from scratch be constrained to the same choice?
  If not, it is an implementation detail and does not belong in the spec.

## Present, not past

- State what the system does and not how it got there.
  No "formerly", "no longer", "supersedes", "during the migration period", changelog entries or migration narration.
  The git history is the record of change.
  Transitional work belongs in a plan under `docs/plans/`.
- State no absences ("X is not supported") and no plan labels ("Strategy A", "Phase 2").
- Do not state a rationale that expires with a current capability.
  State the durable reason, or nothing.
- Describe the system's own behaviour.
  Do not narrate a dependency's decision logic or version-specific quirks beyond the minimum needed to justify a requirement.

## One home per claim

Each requirement lives in the spec whose subject it is, and other specs link to it.
A cross-reference says what its target is about and does not summarise what it says.
