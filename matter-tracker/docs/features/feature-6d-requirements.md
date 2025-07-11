Feature 6d

OK, 

The associations of IT Activity mostly working and now down to some smaller nuances.

First, on IT Activity screen we want the date range to be inclusive on both dates, so on a daily timesheet basis or the equivalent range within IT Activities where start date and end date are the same day, we should include all activities from that day (in other words, equivalent to being from 00:00:00 to 23:59:59 time of day - or another way to look at it would be to add a day to the end date when performing query (but leaving it visually the way it is).  And for weekly, if we are showing start date os a Sunday, and the end date of the next Saturday, the IT Activities should include all acitivities on that latter Saturday.

When switching back to timesheets, we seem to be setting the timesheet dates back to a day or week before what was in the IT Activity.  We should switch back to timesheets and show the same date range of what was in IT Activity (switching from timesheet to IT Activity seems to pass date range correctly).  And a related topic, if we are in IT Activities, in a weekly range (from a sunday to the next saturday), and we associate a task, that task should be associated within a weekly timesheet, currently it is associating it to a daily timesheet.  If the date range in IT Activity page is indicative of a daily range (i.e., start and end dates the same visually in controls), we whould be associating the IT Activity with a daily time sheet.  This way as we switch between timesheet and IT Activities, not only are date ranges and team members passed back and forth for quick and efficient editing, we will also detect whether we are going back to a daily or weekly timesheet, this way the flow is most intuitive and efficient.

Also, we want mouse over of Title/Dscription column on IT Activity Tracker page grid to also show the popup with multi-line metadata.




***
It seems to be mostly working, except when we switch back from IT Activities to timesheets, we are not setting the date range appropriately.  It seems we are going back one week (in case of weekly), or one day (in case of daily) timesheets.  Perhaps we are not looking at start and end dates correctly, or another reason, but it is correctly ascertaining that we are daily vs. weekly when going back from IT activity to timesheets, but it is not setting the dates correctly, it is going backwards by one unit (week or day) depending on mode.



***


*****
When I do add task within associate task dialog, it seems to double up the text when returning to associate dialog (from add task dialog)

On daily timesheets, also seems to associate date back to wrong date, that is because date filter is wrong, it is one day less than it should be



*****


*****
IT Activity date ranges seems to be incorrect by one day.  It seems to always start a day earlier than intended.  It should just include all events included with whatever dates are showing in the range.  If we set range June 23, 2025 (start date) through June 23 2025 (end date), we would expect all activity on June 23rd, but we are instead getting June 22nd.  If we set range June 23, 2025 (start date) through June 24, 2025 (end date), we would expect all activity on June 23rd + 24th, but we are instead getting June 22nd and June 23rd.

Also when adding task from the associate dialog (calling up additional add task dialog), when we return to the associate task dialog, the text is entered twice in the dropdown, so if I Add New Task and add "Document Review" I see when returning to associate dialog "Document Review Document Review"


*****




********

A few bugs, changes for IT Activity page:

On IT Activity page, change text:

"Associate Activity with Matter" text in associate popup to "Associate IT Activity"

Also currently the Activity filters do not work.  Since it looks like there is the ability the clear out any filter, we probably do not need "All Activity Types" option within dropdown (assuming the same can be accomplished by clearing all the filters).  But when selecting any filter, we get 0 results, so it seems the filtering by Activity Type is not working.

And when I try to select "All Activity Types", get an error message "Failed to load activities", but if we are eliminating this option and just having the ability to clear filters successfully, that would work.

Similarly problems with Associated filter, it does not seem to work correctly.  And again if it has the ability to clear selected filter, I do not need the "All" entry.

If I filter with "Associated" I seem to only see "Not Associated", but number of records not updated at bottom, "Not Associated" seems to do the same (show Not Associated only), so perhaps that is working, but also not seeing it reflected in record count at bottom, either way strange behavior in the filtering.





********


*****
When switch activity type to a filter such as "Calendar Events" , get error message "Failed to load activities"
*****


***
IT Activity filters now seem to be working and text is updated
***

