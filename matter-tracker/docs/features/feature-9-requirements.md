Feature 9 

Admin Interface

Implement login to establish the default team member and access level.  We can use express-session or something similar.  For admins, all functionality will be available as will the ability to switch team member in the dropdown to view or alter data for each team member.  For users (non-admins, default level), they can only view or edit their own data.  The user should be prompted to login one time, after which they should be allowed access to the system for a period of time before timing out and being required to login again.  Let's set that timeout by default to be 4 hours.  Let's also add a manager level user access that is equivalent to admin for the moment (more on this below).

Let's add to teamMember entity the attributes to support login and also a text title field for their title within firm (Associate, Partner, Attorney, Counsel, paralegal, tech support, etc.).  

The attributes timeIncrementType, timeIncrement and workingHours are optional and at the global settings level we should have defaults for these attributes:

      "workingHours": 40,
      "timeIncrementType": "PERCENT",
      "timeIncrement": 1

Let's add those to the global settings screen.  Also let's have a global attribute dictating whether users have access to the IT Activities screen, if they do not we can disable the button to navigate to IT Activities from timesheets.

Add admin pages to allow maintenance of team members, adding new team members, setting/resetting passwords etc.  For now, the admin can just set passwords, we do not need any email verification or ability for user to reset password for initial implementation.  The above settings (workingHours, timeIncrementType, timeIncrement) can optionally be overridden for team members but should default to global settings.

Let's add team member roles, current choices: paralegal, associate, technical support, partner, senior partner, and for the time being, just assign one per each team member.  There is a separate determination of whether user is admin or regular user - let's also make that an enum value since we will likely have more levels like manager (someone who can view/edit data of other team members).  Note that these are distinct (though loosely related) to title which will be specific title within firm and may be more specific than the levels available for team member roles (we may allow in future release multiple roles per user), so these have different uses and future development paths.

Also add an admin page to edit and add new matters that will show up in dropdowns selecting matters.

Also add another type of IT Activity called CoCounsel session.  This will operate like Claude Session, it is just another software used by attorneys where we want to track sessions and integrate to our system.  Add that IT Activity type and generate data for it in our seed data code.

Let's eliminate the navigation bar on the left as it seems redundant with menu options on top.  Those menu options can change based on user or admin (user really only has access to Timesheet, unless IT Activities are globally allowed to be viewed/edited by regular users in which case that menu item should also be available to users.





