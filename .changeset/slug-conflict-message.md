---
"@emdash-cms/admin": patch
---

Fixes the "Failed to save" and "Failed to publish" toasts for a slug that is already taken showing the server's raw English text. They now say another entry in the collection uses the slug, possibly one in the trash, and that the editor can change the slug or permanently delete the trashed entry, naming the slug when the save is the one that collided. The message is translated.
