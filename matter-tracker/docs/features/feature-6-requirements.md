Feature 6 

Association Task Fix

The association task feature is currently not working within the IT activities page.  Originally the data for matter and task was hard-coded which would explain why this did not work, but now that has been corrected.  With that fixed, let's add console.log statements throughout the associate methods (since this functionality is a bit more complex with a series of options), it will be easier to debug.  Generally, we want to associate an IT activity that matches a team member within a date range, to a timesheet with the same date range (either daily or weekly), with the user selecting the matter and task that is appropriate.  

The user can also select the duration for the IT activity (which should be added to the "actual" time in the TimesheetEntry associated.  The duration can be defaulted based on the IT activity if appropriate (e.g., for a calendar event, the duration of the calendar event can be used as a default).  Many IT activity types may not have a logical duration, and in that case, we can default the duration to zero (e.g., document modification event - we would not know how long the user was working on the document).  Note that the user might associate an IT activity with a new task within the matter (using Add New Task), or an existing task for which there is no projected hours recorded and that is OK.  In some instances we will have projected time recorded on a task, in some instances we will have actual time recorded on a task and some instances we will have both.  Ideally over time, we want to help the user reconcile the projected vs. actual but that is more advanced, for now we want to facilitate the honest recording of projected time that the team member thinks they need to spend on various tasks vs. actual time that we can glean from data pulled through various means including apis integrating to MS Office, calendars and other systems where the users spend time.

On the popup to Associate Task, let's edit hours/minutes in a single control like on the timesheet.  It can use the hh:mm format in a spin control and have the same spin functionality (including mouseup/mousedown event handling for continuous spinning).  It should also observe the time increment for the correct delta time to adjust when using the spin control.

Currently when testing, the associate task action is failing and I am not seeing why based on the output on the server side.  I see on the client side that the method has failed, but there are many steps on the server side to associate.  After we add logging statements throughout that method, we can debug further but if there are any apparent flaws in the logic precluding the task from being associated once the user has selected a matter and task, please correct.





