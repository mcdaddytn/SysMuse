Feature 9d

Currently when in timesheet page, if we mouseover the Matter, we get detailed description on the matter, which is OK.  If we mouse over task, we get a cursor allowing us to modify text which we do not want.  Text should be selected from dropdown or we can add new task, but not direct typing in the control.  What we do want is an IT Activity summary if any are associated to the tasks:

If there are associated IT Activities, let's create a summary in a mouseover popup that shows each associated IT Actvity, and its duration, and also any delta of actual hours with respect to the sum of associated IT Activities (e.g., if actual hours for timesheet entry is 5 hours and there are two associated IT activities with 3 hours total, then there are 2 extra hours of "Unassociated Duration".  It there are no associated activities the mouseover popup can just contain the task name (as is selected in the dropdown combo).

Within the team members admin edit page, we want to be able to see the current password (instead of asterisks), when a visibility (like a human eye) icon is toggled.  This is a somewhat standard GUI feature where we can toggle the state of whether we can see a hidden field like password.  Let's add that within our page that allows edit of a team members password.

Also it looks like a password reset page has been implemented but I do not see how to access it.  Let's allow each team member to reset their own password through a menu item which can be positioned over the "Logout" menu item labeled "Reset Password" that will bring us into the reset password page.

We seemed to have added logic to warn the user when projected hours are less than the expected total, but I do not see that in place except for in percent timeIncrementType where it warns when below 100%.  Let's add another mode that can be configured within the admin interface called ProjectedHoursWarning that can be set to Never, Always, or Past.  If the value is never, we do not issue a warning when projected hours are lower than the expected and configured hours for the week, if it is always, we can always issue the warning.  If it is Past, we should only issue the warning if the week ending date of the timesheet is in the past.

For tasks, let's add the ability to have a default value for projected hours.  It can default to null, but if set, when the task is selected the default hours will be set in the projected column.  Let's add a tasks within the "Internal" matter seed data, called "Personal Day" and "Sick Day" that each default to 8 hours duration, so when a user selects either of these tasks, it will fill in automatically an 8 hour duration timesheet entry under projected time.

