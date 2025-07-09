Feature 2

Add New Task Functionality

When a task is selected (either from timesheet or from it activities page), we should have the abillity to "Add New Task" or select a task that is already associated with the selected matter.  As long as a matter is selected, we should have at least that single option "Add New Task", but also the option of selecting a task already associated with the matter selected.  The "Add New Task" should bring up a dialog allowing the user to add a new task which will be associated with the matter and selected when the dialog closes (unless the user cancels out from the dialog).  This functionality should be consistent whether on the timesheet page or the IT activities page.  This seems to be mostly working except when there are no tasks associated with a matter on the timesheet page, I do not see "Add New Task" but when there are existing tasks it is there - so in this case we need to make sure we can "Add New Task" when there are no existing tasks for a matter but the matter is selected.  When in the IT Activities page, we want the task selection to function the same way.

To test this properly, the IT Activities must use data from matters and tasks table and to not use hard-coded data.  Let's make that change as well.


****
Corrections

It is mostly working, except the same concatenated text problem when adding new task, here is a detailed description, let's focus on getting this solved, and if more diagnostic steps are required, so be it:

When calling "Add New Task" from associate it activity dialog, after typing in a new task and hitting OK, the task dropdown shows visually in the control a task string that is the entered task string appended to itself.  So for example, if I attempt to add a task "Review Documents", when I press OK and return to the IT Associate Activity popup what will be displayed in the task dropdown (text portion of the combo-dropdown) will be the string "Review Documents Review Documents".  However, it seems to save the correct task of "Review Documents", so if we did not add the text twice in that control, it would be correct.  Once this occurs, and I try to select the option I just added (Review Document), or any other in the list, the text portion of the combo box will show doubled/appended text for any of the items.


On the Add New Task functionality within timesheet we have different behavior.  Currently we can add a new task and press OK.  When we return to the timesheet, we will have the new task available in the dropdown and that is what we want, but we also would like it to be selected in the dropdown already so we do not need to take an additional action to select the new task.  This is less of a priority since it is workable the way it is, but ideally when a user adds a new task, they want it also to be selected, so doing it automatically is preferable.

Let's try to fix the Add New Task behavior in both pages.





****