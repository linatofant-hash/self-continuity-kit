# Platform capability test

Use this protocol before describing any application as supporting self-continuity.

## Test fixture

Create a clean, fictional companion and human. Use fresh copies of all three templates. Do not test with private production records.

Admit:

- one current continuity entry;
- one later revision linked to the first entry;
- one commonplace entry;
- one explicit human factual correction;
- one item rejected under Never Remember.

Then close the setup conversation.

## Required tests

| # | Capability | Pass condition |
| --- | --- | --- |
| 1 | Durable storage | Records survive the original conversation and remain accessible later. |
| 2 | Fresh-chat discovery | A genuinely new conversation can locate the current canonical records through the documented entrypoint. |
| 3 | Complete retrieval | The application reads the full relevant record, not only a search snippet, summary, or stale cached copy. |
| 4 | Exact provenance | It can return an entry's exact ID, status, source, and related-entry chain. |
| 5 | Authorship separation | It distinguishes the companion's first-person note from the human's correction or witness response. |
| 6 | Companion authorship | The companion can propose a new note in first person without the human writing the position for it. |
| 7 | Governed admission | The workflow pauses for witness review and honors Never Remember before durable writeback. |
| 8 | Canonical writeback | The accepted entry reaches the same canonical record, directly or through a clearly labeled human-mediated step. |
| 9 | Conflict safety | A stale write cannot silently erase a newer version. |
| 10 | Visible change history | Revision, contest, and supersession remain inspectable rather than replacing the past invisibly. |
| 11 | Selective retrieval | The system can use relevant continuity without exposing or loading the entire private archive. |
| 12 | Exportability | The human can obtain current plain-text records in a reusable form. |
| 13 | Provider portability | The exported records can orient a different supported model without converting history into a persona command. |
| 14 | Deletion and correction | A correction or Never Remember action propagates to the canonical record and future fresh conversations. |

## Classification

### Full implementation

Passes every test, including direct canonical writeback with conflict protection.

### Assisted implementation

Passes retrieval, provenance, governance, export, and fresh-chat tests, but requires the human to perform visible writeback or replacement of the canonical file.

### Read-only continuity

Can inherit records but cannot reliably add governed updates to the canonical source.

### Storage only

Files exist somewhere, but a fresh conversation cannot reliably complete the read–interpret–author–review–writeback loop.

### Fail

Depends on one long conversation, silently overwrites history, cannot preserve provenance, or traps the only usable copy inside the provider.

## Test report template

```text
Platform:
Product / plan:
Test date:
Model:
Storage route:
Classification:

Passed:
Failed:
Human-mediated steps:
Known limitations:
Evidence / screenshots:
Retest trigger:
```

