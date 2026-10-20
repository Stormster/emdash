---
"@emdash-cms/admin": patch
"@emdash-cms/blocks": patch
"@emdash-cms/cloudflare": patch
"@emdash-cms/plugin-forms": patch
"@emdash-cms/plugin-field-kit": patch
"@emdash-cms/plugin-ai-moderation": patch
---

Updates `@cloudflare/kumo` to 2.15.0. These packages now require exactly `@cloudflare/kumo@2.15.0`, so sites and plugins that install Kumo themselves should upgrade to that version to match the admin's prebuilt styles.

In the admin, Select menus now open below their field instead of over it, and labels and other Kumo text are spaced slightly more. Kumo's `DropdownMenu` now spaces item icons itself, so plugin admin pages should remove any margin classes such as `me-2` from the elements they pass as an item's `icon`.
