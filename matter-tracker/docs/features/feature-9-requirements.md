Feature 9 

***
Needs work
***

Admin Interface

Settings admin page
We want to be able to edit the various global parameters (as initialized from seed.json) in an admin page.

We should enhance the settings system to allow data types (these can be configured in settings.json).

Each setting will have a dataType field which can be one of the following:
Enum - the name of the enum from which we can select a value.  On the settings screen we should have a dropdown to select among the valid enum values.

Integer - an integer value.  we can use a spin control that let's the user either enter via text or use the spin.  This will use minValue and maxValue fields (optional in the json, if not supplied, default to 0 and 100 respectively).  But if supplied, we can just narrow the integer range.  Optionally, the settings file my have a discreteValues collection which would be a json list of valid values.  An example of this would be legitimate increments for minutes on timesheets (valid values would be 1, 2, 3, 5, 6, 10, 15, 20, 30 - basically values that divide into an hour in a convenient way


*****
Other possible admin pages

TeamMember (include type, paralegal, associate, partner, senior parnter, managing partner, etc.)

Matter - add and maintain matters

Tasks - override tasks within matters, maybe can edit, combine over time to normalize


*****