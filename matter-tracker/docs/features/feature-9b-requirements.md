Feature 9b 

Admin Interface

Let's add additional admin pages that will just be accessible to someone with administrator level only.  

Add the following three admin pages (and let's have a menu item to dropdown and allow selection of these rather than putting them all separately across the top).  Just allow editing of the attributes for each, we can allow delete (but have it fail if record is linked within the database).

Clients
Matters
TeamMembers

Also the these attributes can be defaulted to global settings (and should be set there).  They can optionally be set for individual team member, but can be left blank to indicate we are using default (maybe add an edit button to "override" and then enable control for these settings on the team member page).

      "workingHours": 40,
      "timeIncrementType": "HOURS_MINUTES",
      "timeIncrement": 15,

The defaults should be as specified above and should be included in settings page and editable by admin.  We do not need duplicate of these. currently we have default_working_hours and workingHours, just have workingHours, same for the other defaults (i.e., we do not need default_time_increment_type and default_time_increment).

Change key allowUserAccessToITActivities to userITActivity and set default to false.  The manager and admin should have access to this screen by default, if this is set to true, all users would have access.  But let's also have this within the TeamMembers table and admin page, so we can override per user.

So by default a regular user would not be allowed access to ITActivities or Settings so those items should be hidden from top menu.  A manager logged in would have access to IT Activities (as would a user if global setting was set that way or overriden at team member level), so in any case, just show the IT Activities menu on top when enabled for the user.  The settings is really only available to the admin as will be the new admin pages.  The logout item should be available to everybody (maybe that can be under the user icon at top right - can be made a dropdown).

Use workingHours to also issue a warning when saving a timesheet.  If the total hours under projected is less than the working hours, issue a warning but allow the timesheet to be saved (as long as not exceeding the maximum allowed hours).  Also let's create global settings that can be modified in the settings screen for the max hours per day or week used to validate timesheets.

When on the timesheet or IT Activities screen we want to automatically set the Team Member selected in the dropdown for all users except admin (i.e., regular users and manager).  For regular users, the dropdown should be disabled so they can see that they are selected but are not able to change the selection.  For managers, they should be able to change selection of team member, but it should default to their own name.  For admin, team member should not be selected by default.

Add logout ability, so the user can select logout and return to login screen.

