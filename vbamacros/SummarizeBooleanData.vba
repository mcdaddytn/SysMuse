Sub SummarizeBooleanData()
    Dim ws As Worksheet
    Set ws = ActiveSheet

    Dim lastRow As Long, lastCol As Long, i As Long, booleanStartCol As Long
    Dim summaryRow As Long, resultCol As Long, totalRow As Long

    ' Find last row and last column
    lastRow = ws.Cells(ws.Rows.Count, 1).End(xlUp).Row
    lastCol = ws.Cells(1, ws.Columns.Count).End(xlToLeft).Column

    ' Find column where booleans start (assume column 2)
    booleanStartCol = 2

    ' Determine where summary row goes (leave one empty row)
    summaryRow = lastRow + 2

    ' Add COUNTIF(TRUE) for each boolean column
    For i = booleanStartCol To lastCol
        ws.Cells(summaryRow, i).Formula = "=COUNTIF(" & ws.Cells(2, i).Address & ":" & ws.Cells(lastRow, i).Address & ", TRUE)"
    Next i
    ws.Cells(summaryRow, 1).Value = "Boolean Column Counts"

    ' Determine where to place per-row boolean count (after a blank column)
    resultCol = lastCol + 2
    ws.Cells(1, resultCol).Value = "TRUE Count per Row"

    ' Calculate TRUE count per row and write into resultCol
    For i = 2 To lastRow
        ws.Cells(i, resultCol).Formula = "=COUNTIF(" & ws.Cells(i, booleanStartCol).Address & ":" & ws.Cells(i, lastCol).Address & ", TRUE)"
    Next i

    ' Summary values for per-row TRUE counts
    totalRow = summaryRow + 2
    ws.Cells(totalRow, resultCol).Formula = "=SUM(" & ws.Cells(2, resultCol).Address & ":" & ws.Cells(lastRow, resultCol).Address & ")"
    ws.Cells(totalRow, resultCol - 1).Value = "Sum"

    ws.Cells(totalRow + 1, resultCol).Formula = "=AVERAGE(" & ws.Cells(2, resultCol).Address & ":" & ws.Cells(lastRow, resultCol).Address & ")"
    ws.Cells(totalRow + 1, resultCol - 1).Value = "Average"

    ws.Cells(totalRow + 2, resultCol).Formula = "=MEDIAN(" & ws.Cells(2, resultCol).Address & ":" & ws.Cells(lastRow, resultCol).Address & ")"
    ws.Cells(totalRow + 2, resultCol - 1).Value = "Median"

    MsgBox "Summary complete."
End Sub
