Feature 3b

We should have several modes of matter selection lookead.  The modes can be called: 

CombinedStartsWith
IndividualStartsWith
CombinedContains
IndividualContains

These modes are combinations of two behaviors, first the lookahead search behavior which would either be Contains or StartsWith.  If the search behavior is StartsWith, the string the user types is used to search for options that start with the search string.  If the search behavior is Contains, the string the user types is used to search for options that contains the search string.

The other behavior (Combined or Individual) determine whether we are searching against a combined matter string (consisting of Client name appended with Matter Name.   For the individual mode, we would compare the search string against the Client and then the matter and combine the search results (removing duplicates).


So then these modes are just combinations of the above behaviors
CombinedStartsWith (StartsWith search against combined Matter strings)
IndividualStartsWith (StartsWith search against individual matter and client strings with results appended and deduped)
CombinedContains (Contains search against combined Matter strings)
IndividualContains (Contains search against individual matter and client strings with results appended and deduped)

This setting called MatterLookaheadMode can be configured in global settings.  The default mode should be IndividualStartsWith if not specified explicitly in settings.


In addition, we should have the ability to manipulate a parameter called TimesheetMode with possible values:
Weekly
Daily
Both

This should also be configured in settings.  When TimesheetMode=Both, the system operates as it does currently, we can default to the weekly timesheet and have the ability to switch back and forth between Weekly and Daily.  When the setting is Weekly, we should only have Weekly timesheets available (and the button to switch to Daily timesheet should be hidden), and similarly for Daily, we can hide the button to switch to Weekly and default the timesheet to Daily mode.

The default value if not set in global settings will be TimesheetMode=Weekly

