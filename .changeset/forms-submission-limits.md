---
"@emdash-cms/plugin-forms": minor
---

Adds a **Maximum submissions** setting to forms, so a signup for a camp, workshop or event can stop at the number of places it has. Each submission in the form's inbox takes one place, including read and archived ones, and deleting a submission frees its place. Spam, submissions that fail validation and submissions whose file upload fails don't take a place.

When every place is taken, visitors see a message instead of the form. The message defaults to "This form is full." and can be changed with **Message when full**. A visitor who submits after the last place has gone sees the same message, and nothing they entered is saved. This holds when several visitors submit for the last place at the same moment: exactly one gets in.

Raising or clearing the limit reopens a full form straight away. Lowering it below the number of submissions closes the form and keeps the submissions. Duplicating a form copies its limit, with every place free on the copy.

Turn on **Show remaining places** to show visitors how many places are left above the form. It is off by default.

A form without a limit works as before. A submission that was already in progress when an admin paused its form is now rejected instead of saved.
