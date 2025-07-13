Feature 9e


[Feature 9d]
[this was intended for feature 9d, but we had a version checked in with additional loose requirements when executed]

When we mouse over the timesheet in the column for tasks, if there are associated IT Activities, let's create a summary in a mouseover popup that shows each associated IT Actvity, and its duration, and also any delta of actual hours with respect to the sum of associated IT Activities (e.g., if actual hours for timesheet entry is 5 hours and there are two associated IT activities with 3 hours total, then there are 2 extra hours of "Unassociated Duration".

Let's also add an additional filter to the IT Activities screen that allows a text search within Title/Description.  They user can leave it blank and it will work as currently or the user should be able to type any text that can be used search within title/description for a match (and work in conjunction with other filters).

Under the admin interface for team members, have the ability to view passwords (with an icon to toggle to viewable mode in the password textbox).

[Feature 9d]



***
Needs work
***

Put seed generator enhancements in separate numbered requirement

mouse over task, show associated IT activities and durations

do a script for demo (sequence of tasks we want to enter for effect)



[testing matter tracker]
Have screen to reset passwords

It is not selecting the user automatically for user, manager, and not disabling control

Type all users emails at bottom of login screen, showing what passwords to use

IT Activities button for regular user is visible but does not work (make invisible)

When we are moving from timesheets and it is unsaved (either by hitting IT Activities or dates, give a prompt whether to save before navigating away)


**
Not warning me when saving with less than 40 (or whatever configured hours) for hourly billing attorney

It is warning when hours are over 40 billable hours, but should also show target hours as configured by admin in that warning.

Maybe rethink whether we want warning, maybe it depends on whether the week has expired already (if we are past the dates, should warn when not complete timesheet ?  but ok if doing it mid-week ?
**

*****
IT Activity, maybe have text search within title/description as filter also
*****

***
Mouse-over of task might show associated IT Activities or have another place in grid where we indicate there are associations and can mouse-over that, but perhaps wait until later for this
***

****
Mouse over IT activities title/description can bring up metadata popup pretty-printed like in associate task screen
****

I do not need to see both "Task Added Succesfully" and "Task Created Successfully", just give a message when its been saved to database.

When I select a new matter in an existing timesheet entry, we should blank the task selected (probably will not be relevant), and the hours entered.

Michael Chen (manager), not able to hit IT Activities button , does nothing.  IT Activities menu is displayed, but does nothing, will not click through.

Sarah Johnson should not be percentage, maybe just have one user that way and one user with different hours, the rest use defaults from system.

IT Activies works for nobody now (only on pc, test on mac and rebuild pc)

*** only on pc ***
Getting a constant ERR_CONNECTION_REFUSED error on ping, why is ping necessary and why an error ?

Here are errors related to IT Activies:
TimesheetPage.vue:758 [Vue Router warn]: uncaught error during route navigation:

TimesheetPage.vue:758 TypeError: Failed to fetch dynamically imported module: http://localhost:9000/src/pages/ITActivityPage.vue
localhost/:1 Uncaught (in promise) TypeError: Failed to fetch dynamically imported module: http://localhost:9000/src/pages/ITActivityPage.vue


let's add parameters to it seeding that are read from a json file including date range and anything else hard-coded in there (frequency of certain events, etc.)

When we go back to timesheet from IT Activities (at least through menu), we are losing date and team member context, OK for now, it works when using buttons.

[testing matter tracker]

[Seed Generator]
Read team members and clients from json files (either from clients.json, teamMembers.json or duplicate in seed json)

Create a new seed config file that has collections for:
legalTopics, documentTypes, emailSubjects, relativityQueryTypes, claudeSessionTitles, cocounselSessionTitles

Start date to gen it activities and end date to gen activities

Hsve a section to generate weekly meetings and participants (default to all), monday and thurday meetings currenly every week, also client meetings



[Seed Generator]




***
Spec out additional changes that will involve settings
- default user
- other global settings
- admin pages for team members, matters, etc.
- more thorough validation (hours per week, line item minimums, dups matter, task in line item, etc.)
- navigation in left pane not neceesary (or have ability to hide it)
- implement login with admin screens for team members, can be set by- admin
- once logged in, lasts 4 hours or some amount of time with cookies
- admin or user mode per user, login as something, maybe general admin user available
- team member roles, paralegal, associate, tech, partner, senior partner, admin
= multiple roles per team member, over time add task types and associate
- Partner, Counsel, Associate, ParaLegal (from rjlf web stie + para), perhaps just title, and Add New ability
- add co=counsel as it type
***

*****
export functionality
to csv
filter by team member (or all, or by title/level, etc.), and date range, matters (all or subselect)

maybe another one starting with single matter and subsets of users,, but maybe can all be selectable on one screen

*****



Settings admin page
We want to be able to edit the various global parameters (as initialized from seed.json) in an admin page.

We should enhance the settings system to allow data types (these can be configured in settings.json).

Each setting will have a dataType field which can be one of the following:
Enum - the name of the enum from which we can select a value.  On the settings screen we should have a dropdown to select among the valid enum values.

If enum cannot be interrogated for values, can do this with a combination of String type in discrete set of values, maybe this is a better way to do it generally, for strings definitely use this, for integers can use discrete set or min, max, and interval.

Integer - an integer value.  we can use a spin control that let's the user either enter via text or use the spin.  This will use minValue and maxValue fields (optional in the json, if not supplied, default to 0 and 100 respectively).  But if supplied, we can just narrow the integer range.  Optionally, the settings file my have a discreteValues collection which would be a json list of valid values.  An example of this would be legitimate increments for minutes on timesheets (valid values would be 1, 2, 3, 5, 6, 10, 15, 20, 30 - basically values that divide into an hour in a convenient way


*****
Other possible admin pages

TeamMember (include type, paralegal, associate, partner, senior parnter, managing partner, etc.)

Matter - add and maintain matters

Tasks - override tasks within matters, maybe can edit, combine over time to normalize


*****


***
For team members, allow entry in admin screen of a new team member.

Also have a settings screen that will allow a subset of global settings to be overridden for each team member (maybe also have this configured in settings.json type metadata, which admin pages can override a global default.

But can have for team member, change of increment

Or can have for client and/or matter - probably client best for this, override increment




***