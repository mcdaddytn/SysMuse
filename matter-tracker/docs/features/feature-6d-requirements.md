Feature 6d

OK, 

The associations of IT Activity mostly working and now down to some smaller nuances.

First, on IT Activity screen we want the date range to be inclusive on both dates, so on a daily timesheet basis or the equivalent range within IT Activities where start date and end date are the same day, we should include all activities from that day (in other words, equivalent to being from 00:00:00 to 23:59:59 time of day - or another way to look at it would be to add a day to the end date when performing query (but leaving it visually the way it is).  And for weekly, if we are showing start date os a Sunday, and the end date of the next Saturday, the IT Activities should include all acitivities on that latter Saturday.

When switching back to timesheets, we seem to be setting the timesheet dates back to a day or week before what was in the IT Activity.  We should switch back to timesheets and show the same date range of what was in IT Activity (switching from timesheet to IT Activity seems to pass date range correctly).  And a related topic, if we are in IT Activities, in a weekly range (from a sunday to the next saturday), and we associate a task, that task should be associated within a weekly timesheet, currently it is associating it to a daily timesheet.  If the date range in IT Activity page is indicative of a daily range (i.e., start and end dates the same visually in controls), we whould be associating the IT Activity with a daily time sheet.  This way as we switch between timesheet and IT Activities, not only are date ranges and team members passed back and forth for quick and efficient editing, we will also detect whether we are going back to a daily or weekly timesheet, this way the flow is most intuitive and efficient.

Also, we want mouse over of Title/Dscription column on IT Activity Tracker page grid to also show the popup with multi-line metadata.




