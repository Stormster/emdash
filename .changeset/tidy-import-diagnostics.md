---
"emdash": patch
---

Fixes `emdash site import` failing with `COLLECTION_EXISTS` when manually deleted target collections still have media-usage cleanup pending. Import now advances cleanup in bounded steps and waits for active deletion leases or retry delays before reusing a collection slug. Failed cleanup is reported separately from a genuine slug collision, and collection schema error messages are preserved in status `errorDetail`.
