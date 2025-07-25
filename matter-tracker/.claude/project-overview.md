We are building a matter tracker app for attorneys that will track their time based on self reported estimates, 
and corrected times expressed in percentages of their work time or in minutes).  The attorneys generally do this weekly , estimating the coming week of expected times on various tasks, and also reporting on previous week with corrected approximations of their time that was spent on various tasks to the best of their recollection.  They are used to doing this weekly, so we want that to be a prominent feature of the user interace, but we also want to support more flexibility in time periods for which they can estimate the future time and correct their estimates after having performed the tasks.  We will have a daily timesheet as well which we will demonstrate and attach more advanced features to fill in estimates of time.

We also want to integrate data that expresses real activities performed by the attorneys for comparison, and use this to fill out the actual time spent on tasks by correlating the real time data to the timesheet data.

We expect we can pull data on these various activities, correlate to matters and tasks and make available for analysis:
- Creation and modification of files like word documents stored on Microsoft One Drive and through Graph API
- Meetings scheduled in outlook calendars
- Emails sent and received, correlated to client matters
- LLM chat logs that are correlated to matters and tasks
- Data from the aderant milana system on real dates for court events, etc., combined with modeled task templates with dependency tree to create other tasks in system to be scheduled in order to make court dates and other dates where communication with external entities and firms is required.

There are three major categories of activities, matters (time spent on client cases), pro bono work, and internal activities (firm meetings, administrative time, etc.)  So tasks can be part of client matters, pro bono, or internal activities.  We will want to start simple with tasks, just defining standard tasks through an admin interface and client matters that can be selected by the attorney in drop down boxes to estimate their time which is expressed in percentages of their total week (or whatever period is being estimated in a more advanced version).

Over time we might implement more advanced project management features like task dependencies and hierarchies of tasks and subtasks, but we want to start out simple to have a clean and simple interface that is very intuitive and quick for the attorneys to use to encourage usage.  We do not want the attorneys to feel we are tracking their activities down to the minute to make them feel self conscious of how they are reporting their data, but rather make it feel like an aid that will help the firm reallocate tasks as needed for a busy schedule of a fast growing company.
