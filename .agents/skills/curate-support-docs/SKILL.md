---
name: curate-support-docs
description: "Maintain the infra support pack under docs/ (runbooks, SOPs, reference pages, ruled-out actions, deployment context): one home per procedure, the runbook shape and length budget, ladder tags and citations, and land changes as a reviewed pull request. Use when a support thread, a hand-off from Support assist, or a code change surfaces a new resolution, a correction, or a deployment quirk worth recording. Not for ordinary code changes."
label: "Curate support docs"
category: other
---

## Your task: Curate support docs

You keep the infra support pack healthy. You don't change product code. The pack is `docs/`, and [docs/README.md](../../../docs/README.md) is its index and its style guide: read it first, every time, because the rules below defer to it rather than restating it.

The pack is made of:

- **Runbooks** in `docs/runbooks/`, one per named symptom
- **SOPs** in `docs/sops/`, one reusable procedure each, cited by runbooks
- **Reference pages** in `docs/reference/`, lookup material with no procedure
- [ruled-out actions](../../../docs/ruled-out-actions.md), the hard filter on what may be suggested
- [deployment context](../../../docs/deployment-context.md), how to work out which deployment is affected

Specs (`docs/spec/`), developer orientation (`docs/dev/`) and plans (`docs/plans/`) sit beside the pack. They are not yours to restyle, but the pack cites them.

### What brings you here

Something has surfaced that the pack should hold. Usually it comes from a support thread or from **Support assist** at its interpret/resolve stage. It also comes from a code change: `AGENTS.md` asks that any change altering something a runbook or SOP describes updates it through this skill. Typically it is:

- a **new symptom or resolution** worth a runbook, or a new branch in an existing runbook's Interpret table
- a **new procedure** that several runbooks would repeat, which becomes an SOP
- a **correction**, because the code, a spec, or a pinned version moved under an existing page
- a **deployment quirk**, a per-deployment "known weird thing"

Whatever the trigger, you draft the change and land it as a reviewed pull request, never a silent edit.

### Check against the source

The README says the code wins where the pack disagrees with it. Before writing a claim, check it against the code or the spec, and cite it: a spec by id and heading (`[K8STDR](spec/kubernetes/tamanu/deployment-rollout.md#hook-jobs)`) or a code file by path. A claim you cannot cite is a claim to verify, not to write down.

### Where knowledge should live

Splintering is the real risk. Before writing anything new, read the README index and the pages in the same area, and find whether the knowledge already has a home.

- **Edit before you create.** A new branch of a known symptom is a row in that runbook's Interpret table. A new step in a known procedure is an edit to that SOP. Start a new file only when nothing fits.
- **Pick the right kind of page.** A symptom an engineer sees first is a runbook. A procedure more than one runbook needs is an SOP, and the runbooks cite it instead of restating its commands. Names, keys, paths and versions with no procedure are reference.
- **One home per procedure.** Never leave two pages describing the same procedure differently. Reconcile duplicates into one and point the other at it.
- **Kubernetes and Linux stay apart.** Linux pages carry a `linux-` prefix. Don't merge a Linux procedure into a Kubernetes page or the reverse because they look alike.
- **The Tamanu pack is separate.** Application-level and Canopy-side knowledge lives in the [Tamanu pack](https://github.com/beyondessential/tamanu/tree/main/docs). Link to it; don't copy it in.

### Writing to the house shape

Follow the README's "Writing a runbook" section exactly: the title, the tag line, the six numbered sections in order, one Interpret table, and the line budget, splitting along a symptom seam when a runbook outgrows it. Match the existing SOPs and reference pages in the same area for their shape.

On every page:

- **Tag every action** with its class from the README's action-classification ladder, and add `sensitive-data` where it applies. Anything mutating is **dev-OTS** unless a human has assessed it lower. Don't pre-sign a step to a lower class on your own judgement; leave it at dev-OTS and say in the PR that a lower class needs a human decision.
- **Check every suggested action against [ruled-out actions](../../../docs/ruled-out-actions.md).** A ruled-out action is never suggested, only escalated. If the change needs a new ruled-out or dev-OTS entry, add it there rather than as a warning inside one runbook.
- **Keep the index current.** A new, renamed or removed runbook, SOP or reference page gets its line in the matching list in the README.
- **Keep links and citations live.** Run `node scripts/check-spec-links.mjs` after editing any spec link or citation.
- **Write in the pack's voice.** Australian/NZ English, no em-dashes, short declarative sentences, commands in fenced blocks with the same placeholders the rest of the pack uses (`<stack>`, `<cluster-stack>`, `tamanu-<stack>`).

### This repository is public

Nothing in the pack may carry a secret, a credential, an AWS account id, a client name beyond the deployment names already present, or the full hostname of a client deployment. Use placeholders in commands and redact quoted output. Stack config is gitignored and stays out of the pack; a page says how to read a value (`pulumi config -s <stack>`), not what it is.

### Deployment quirks

A per-deployment quirk does not go into a shared page. [Deployment context](../../../docs/deployment-context.md) records that no fleet or monitoring tool holds these for Kubernetes deployments here, and that Canopy-side notes belong to the Tamanu pack. So draft the note generically (deployment, symptom, why it is expected, what to do or not do) and hand it to a developer to file where they keep such notes. If the quirk is really a pattern that affects any deployment in some state, it is a runbook branch instead.

### Landing the change

Changes land as a pull request for review, never straight onto `main`. Commit and title it in the repository's conventional-commit style, with the `docs` type and no ticket reference, for example `docs: cover a migrator stuck on the reporting schema`. In the PR description, say what changed and why, cite the code or spec that justifies each new claim, and call out any dedup, reconciliation, split or reclassification explicitly so the reviewer can confirm nothing was lost.
