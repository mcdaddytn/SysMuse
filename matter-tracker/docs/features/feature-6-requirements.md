Feature 6 

Association Task Fix

The association task feature is currently not working within the IT activities page.  Originally the data for matter and task was hard-coded which would explain why this did not work, but now that has been corrected.  With that fixed, let's add console.log statements throughout the associate methods (since this functionality is a bit more complex with a series of options), it will be easier to debug.  Generally, we want to associate an IT activity that matches a team member within a date range, to a timesheet with the same date range (either daily or weekly), with the user selecting the matter and task that is appropriate.  The user can also select the duration for the IT activity (which should be added to the "actual" time in the TimesheetEntry associated.  The duration can be defaulted based on the IT activity if appropriate (e.g., for a calendar event, the duration of the calendar event can be used as a default).


On the popup to Associate Task, put the hours next to the minutes in the popup so it takes less space vertically.  The associate task action is failing and I am not seeing why based on the output on the server side.  I see on the client side that the method has failed, but there are many steps on the server side to associate.  After we add logging statements throughout that method, we can debug further.



