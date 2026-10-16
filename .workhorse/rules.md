# Spec and plan rules

Specs live in `docs/spec/`, organised by area; plans live in `docs/plans/` and `.workhorse/plans/`.

For the spec file format, the frontmatter `id`, code-to-spec traceability, the fold/create/split decision, and when a change warrants a spec update, follow `.agents/docs/spec-format.md` and the Workhorse skills.
This file records only the house conventions that sit on top of that, and wins where the two differ.

A spec is the durable description of **what** the system requires.
It is read by someone deciding whether the implementation is correct, or re-implementing the feature from scratch, not as a narrative of how the code works or how it came to be.

## House style

Specs are written in markdown prose with each sentence on its own line and no hard-wrapping, rather than the checkbox acceptance-criteria style shown in `spec-format.md`.
This balances ease of writing and diff parseability.
Use a standards/RFC spec voice, as in RFC 2119 and RFC 9000.

- One requirement per sentence, with a named actor: "A node MUST…", "The Gateway MUST…".
- The BCP 14 keywords carry the force.
  MUST is for what breaks interoperability, a security property, a reliability guarantee, or a product commitment.
  Cost optimisations and the behaviour of consumers are SHOULD or MAY.
- Sets of values and shapes (labels, annotations, parameters, strategies by platform) go in tables with a header row, followed by the normative sentences a table cannot carry.
- Do not include justifications unless the justification is critical to a spec.
  Where one is kept, it goes in a `> [!NOTE]` block set apart from the binding text.
  A note never contains an RFC 2119 keyword and is never placed inline on a normative sentence.
  Keep a note only where cutting it would let someone build a plausible variant that is unsafe or does not interoperate.
- Do not state a rationale that expires with a current capability.
  State the durable reason, or nothing.
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

## Cross-references

Specs reference each other with markdown links under the target's id, e.g. `[K8SNOD](kubernetes/nodes.md)`.
A defined term is linked by deep link to its heading, `[dedicated pool](../overview.md#dedicated-pool)`, at its first occurrence in each spec.
A cross-reference says what its target is about and does not summarise what it says.

- Ids are 2 to 6 uppercase alphanumeric characters with no hyphen.
  Specs for one platform share a prefix (`K8S…`).
- Code references the spec it implements with an inline comment of the form `// spec: K8SNOD#node-identity`, as described in `spec-format.md`.
  The anchor is the slug of a `##` or `###` heading.
  Each spec has one `##` section per topic, and code cites the topic.
  One comment cites one target, so code implementing several topics carries several comments.
- Deep links break silently when a heading is reworded, so `node scripts/check-spec-links.mjs` checks every link, anchor and citation.
  It runs in CI and must pass.

## What, not how

- Describe **what** the system requires, not **how** the code achieves it.
  Keep out of spec text: tool and command names (`sfdisk`, `kopia snapshot create`), crate and library names, syscall names (`splice(2)`), internal API details, data-structure choices, Pulumi config keys, and environment variable names used only by the implementation.
- Acceptable, because external actors or other components depend on them: interface contracts, such as resource names, label and annotation keys, config file paths and formats, on-disk and on-the-wire shapes, endpoint shapes, partition UUIDs, credential scopes.
- The test: would someone re-implementing the feature from scratch be constrained to the same choice?
  If not, it's an implementation detail and doesn't belong in the spec.
  Note that wherever contracts exist, enough must be included in the spec such that someone can write a *compatible* re-implementation from scratch.

## Present, not past

- State what the system does, not how it got there.
  No "this supersedes X", "formerly Y", "a spike settled Z", "during the migration period", changelog entries, or migration narration.
- When something is removed or replaced, edit the spec to describe the new reality and delete the old text, rather than describing the transition.
  The git history is the record of change; the spec is the record of the present.
  Transitional work belongs in a plan under `docs/plans/`.
- State no absences ("X is not supported").

## Own behaviour, not a dependency's internals

- Describe the system's own behaviour and contracts: the request shape it handles, the guarantee it makes.
  Don't narrate a dependency's decision logic or version-specific quirks beyond the minimum needed to justify a requirement.
- Don't scaffold or label: no "Strategy A/B", "Phase N", or plan tags in spec prose.
  Describe the mechanism directly.

## One home per claim

Each requirement lives in the spec whose subject it is, and other specs link to it.
A claim that is binding in one spec and a note in another has no defined status: pick the home and delete the copy.
