Feature 4

Percentage Entry Mode

We need to fix the percentage entry spin control.  Currently when timesheet is in the mode of percentage time entry, the spin controls do not work correctly.  It appears that two spin controls become visible and are overlapping in a way that prevents the percent entry from working.  There is one control that allows integer entry and spin up or down in values, but those values are not recorded or reflected in the total.  There is another spin control (that seems to appear behind or underneath with the spin portion of the control at the right of the other control.  This one seems to affect the values in the total when spun up or down, but is disassociated from the control where the user can enter text.  This needs to be cleaned up so only one control is visible and allows both text entry and spin up and down to enter integer percent value.


The Actual total and the Projected Total should be between 0 and 100, if either is above 100% consider that an error.  The projected amount if less than 100%, is should issue a warning when saving but allow save assuming the timesheet has at least one entry, i.e.., it has begun to be edited.  If the user is just scrolling through different time periods without adding any entries, no saving should occur, nor should errors or warnings on totals.




