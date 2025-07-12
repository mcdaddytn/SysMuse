Feature 9c

Let's implement a few bug fixes and minor functionality changes:

For all users that are not admin, we want to automatically select item for Team Member dropdown in both timesheet and IT Activies pages.  When we come in to those screens, select automatically based on the logged in user.  In addition for regular users (not manager or admin), disable the team member dropdown such that the selected team member is displayed, but the user cannot change the team member.  For manager or admin, they can select different users.  For admin, we do not need to default the team member initially (only when switching back and forth contextually between timesheets and IT Activies), so that on an initial view on timesheets, the admin would select from any team member.

On initial login screen, show all users that can be used for testing.  Currently it shows the admin, manager, and one regular user, we want to show all 3 regular users or all 5 users that can be used for login as we will demo different features with each.

For regular users, the IT Activities button should be invisible (when userITActivity mode for users to have access to IT Activities is false).  The system correctly hides the menu item on top, but the IT Activies button is still visible when the user should not have access to it.

When we are attempting to navigate away from timesheets and the timesheet it is unsaved (either by pressing IT Activities, changing dates, etc.) and the timesheet has unsaved data, give a warning to allow the user to save first or ignore warning and proceed.

When we add a new task within a matter, I do not need to see both "Task Added Succesfully" and "Task Created Successfully", just give message "Task Created Successfully", not both.

When I select a new matter in an existing timesheet entry (in other words attempt to modify a timesheet entry with both matter and task selected), we should blank the task selected (as the task is not relevant to the new matter), and zero the hours entered.

