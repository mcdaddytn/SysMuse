Feature 9b 

Admin Interface



***
Needs work
***

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