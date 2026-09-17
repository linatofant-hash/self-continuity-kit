# Gemini implementation guide

**Status:** Capability investigation pending

Google Drive storage alone does not establish self-continuity. A file sitting in Drive is only storage unless a fresh Gemini conversation can reliably locate, read, interpret, and update the canonical record under visible governance.

The investigation must determine whether Gemini can:

1. discover the current records from a fresh conversation;
2. read complete file contents rather than summaries or stale copies;
3. retrieve an exact prior entry with status and source;
4. distinguish companion authorship from human witness notes;
5. propose and author a new entry;
6. write the accepted entry back to the canonical record;
7. preserve revision history and avoid lost updates;
8. honor Never Remember and deletion;
9. export the records in portable form;
10. repeat the workflow without depending on one long chat.

No Gemini implementation will be marked complete until it passes the published capability test. A human-mediated Drive workflow may still be documented honestly as assisted continuity.

