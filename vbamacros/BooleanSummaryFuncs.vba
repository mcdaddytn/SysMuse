Sub FillFormulaDownFromHeaderNoArgs()
    Call FillFormulaDownFromHeader("AnyBoolNotSpam")
End Sub

Sub ClearMyCalculatedColumnNoArgs()
    Call ClearColumnDataBelowHeader("AnyBoolNotSpam")
End Sub

Sub RunBooleanSummarySheet()
    CreateBooleanSummarySheet "Spam Only"
End Sub

Sub ClearColumnDataBelowHeader(headerName As String)
    Dim ws As Worksheet
    Set ws = ActiveSheet

    Dim headerRow As Integer
    headerRow = 1

    Dim lastCol As Long
    lastCol = ws.Cells(headerRow, ws.Columns.Count).End(xlToLeft).Column

    Dim targetCol As Long
    targetCol = -1

    ' Locate the column with the given header name
    Dim col As Long
    For col = 1 To lastCol
        If Trim(ws.Cells(headerRow, col).Value) = headerName Then
            targetCol = col
            Exit For
        End If
    Next col

    If targetCol = -1 Then
        MsgBox "Header not found: " & headerName
        Exit Sub
    End If

    ' Identify the column to the left
    Dim leftCol As Long
    leftCol = targetCol - 1
    If leftCol < 1 Then
        MsgBox "No column to the left of the specified column."
        Exit Sub
    End If

    ' Determine the last active row based on the left column
    Dim lastRow As Long
    lastRow = headerRow + 1 ' Start checking from row 2
    Do While ws.Cells(lastRow, leftCol).Value <> ""
        lastRow = lastRow + 1
    Loop
    lastRow = lastRow - 1 ' Last filled row in left column

    ' Clear contents in the target column from row 2 to last active row
    If lastRow > headerRow + 1 Then
        ws.Range(ws.Cells(headerRow + 2, targetCol), ws.Cells(lastRow, targetCol)).ClearContents
    ElseIf lastRow = headerRow + 1 Then
        ws.Cells(headerRow + 2, targetCol).ClearContents
    Else
        MsgBox "No data rows to clear below header."
    End If
End Sub

Sub FillFormulaDownFromHeader(headerName As String)
    Dim ws As Worksheet
    Set ws = ActiveSheet

    Dim headerRow As Integer
    headerRow = 1

    Dim lastCol As Long
    lastCol = ws.Cells(headerRow, ws.Columns.Count).End(xlToLeft).Column

    Dim targetCol As Long
    targetCol = -1

    ' Find the column by header name
    Dim col As Long
    For col = 1 To lastCol
        If Trim(ws.Cells(headerRow, col).Value) = headerName Then
            targetCol = col
            Exit For
        End If
    Next col

    If targetCol = -1 Then
        MsgBox "Header not found: " & headerName
        Exit Sub
    End If

    ' Determine the last row based on non-blank cells in the column to the left
    Dim leftCol As Long
    leftCol = targetCol - 1
    If leftCol < 1 Then
        MsgBox "No column to the left of the specified column."
        Exit Sub
    End If

    Dim lastRow As Long
    lastRow = headerRow + 1 ' Start from row 2
    Do While ws.Cells(lastRow, leftCol).Value <> ""
        lastRow = lastRow + 1
    Loop
    lastRow = lastRow - 1 ' Step back one to the last filled row

    ' Copy formula from row 2 down to the last filled row
    Dim formulaCell As Range
    Set formulaCell = ws.Cells(headerRow + 1, targetCol)

    If formulaCell.HasFormula Or formulaCell.Value <> "" Then
        formulaCell.Copy
        ws.Range(ws.Cells(headerRow + 2, targetCol), ws.Cells(lastRow, targetCol)).PasteSpecial xlPasteFormulas
        Application.CutCopyMode = False
    Else
        MsgBox "No formula or value to copy from row 2 in column '" & headerName & "'"
    End If
End Sub

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

Sub ClearSummaryData()
    Dim ws As Worksheet
    Set ws = ActiveSheet

    Dim headerRow As Long
    headerRow = 1

    Dim maxUsedCol As Long
    Dim maxUsedRow As Long
    maxUsedCol = ws.Cells.Find("*", , xlFormulas, , xlByColumns, xlPrevious).Column
    maxUsedRow = ws.Cells.Find("*", , xlFormulas, , xlByRows, xlPrevious).Row

    ' Find first blank column by scanning row 1
    Dim col As Long
    Dim firstBlankCol As Long
    For col = 1 To maxUsedCol
        If Trim(ws.Cells(headerRow, col).Value) = "" Then
            firstBlankCol = col
            Exit For
        End If
    Next col

    ' If no blank column was found, set to maxUsedCol + 1 (nothing to clear)
    If firstBlankCol = 0 Then firstBlankCol = maxUsedCol + 1

    ' Find first blank row by scanning column A
    Dim row As Long
    Dim firstBlankRow As Long
    For row = 1 To maxUsedRow
        If Trim(ws.Cells(row, 1).Value) = "" Then
            firstBlankRow = row
            Exit For
        End If
    Next row

    ' If no blank row was found, set to maxUsedRow + 1
    If firstBlankRow = 0 Then firstBlankRow = maxUsedRow + 1

    ' Clear everything to the right of firstBlankCol
    If firstBlankCol <= ws.Columns.Count Then
        ws.Range(ws.Cells(1, firstBlankCol), ws.Cells(ws.Rows.Count, ws.Columns.Count)).ClearContents
    End If

    ' Clear everything below firstBlankRow
    If firstBlankRow <= ws.Rows.Count Then
        ws.Range(ws.Cells(firstBlankRow, 1), ws.Cells(ws.Rows.Count, ws.Columns.Count)).ClearContents
    End If
End Sub

Sub CreateBooleanSummarySheet(targetHeader As String)
    Dim wsSource As Worksheet
    Set wsSource = ActiveSheet

    Dim headerRow As Long: headerRow = 1
    Dim startCol As Long: startCol = 1 ' Column A is the ID column

    ' Find last boolean column before first blank header
    Dim lastDataCol As Long
    lastDataCol = startCol + 1
    Do While Trim(wsSource.Cells(headerRow, lastDataCol).Value) <> ""
        lastDataCol = lastDataCol + 1
    Loop
    lastDataCol = lastDataCol - 1

    ' Find last row before first blank in the ID column
    Dim lastDataRow As Long: lastDataRow = headerRow + 1
    Do While Trim(wsSource.Cells(lastDataRow, startCol).Value) <> ""
        lastDataRow = lastDataRow + 1
    Loop
    lastDataRow = lastDataRow - 1

    ' Find target column index
    Dim targetCol As Long: targetCol = -1
    Dim col As Long
    For col = startCol + 1 To lastDataCol
        If Trim(wsSource.Cells(headerRow, col).Value) = targetHeader Then
            targetCol = col
            Exit For
        End If
    Next col

    If targetCol = -1 Then
        MsgBox "Header not found: " & targetHeader
        Exit Sub
    End If

    ' Collect rows where the target column is TRUE
    Dim includedRows As Collection: Set includedRows = New Collection
    Dim r As Long
    For r = headerRow + 1 To lastDataRow
        If UCase(Trim(wsSource.Cells(r, targetCol).Value)) = "TRUE" Then
            includedRows.Add r
        End If
    Next r

    If includedRows.Count = 0 Then
        MsgBox "No rows with TRUE for '" & targetHeader & "'"
        Exit Sub
    End If

    ' Determine which columns to keep (those with at least one TRUE in includedRows)
    Dim includedCols As Collection: Set includedCols = New Collection
    includedCols.Add startCol ' Always include ID column

    Dim rVal As Variant
    For col = startCol + 1 To lastDataCol
        For Each rVal In includedRows
            If UCase(Trim(wsSource.Cells(rVal, col).Value)) = "TRUE" Then
                includedCols.Add col
                Exit For
            End If
        Next rVal
    Next col

    ' Create destination worksheet
    Dim wsDest As Worksheet
    On Error Resume Next
    Application.DisplayAlerts = False
    Worksheets(targetHeader).Delete
    Application.DisplayAlerts = True
    On Error GoTo 0

    Set wsDest = Worksheets.Add
    wsDest.Name = targetHeader

    ' Write headers
    Dim destCol As Long: destCol = 1
    For Each incCol In includedCols
        wsDest.Cells(1, destCol).Value = wsSource.Cells(headerRow, incCol).Value
        destCol = destCol + 1
    Next incCol

    ' Write filtered data
    Dim destRow As Long: destRow = 2
    For Each rVal In includedRows
        destCol = 1
        For Each incCol In includedCols
            wsDest.Cells(destRow, destCol).Value = wsSource.Cells(rVal, incCol).Value
            destCol = destCol + 1
        Next incCol
        destRow = destRow + 1
    Next rVal

    MsgBox "Summary sheet '" & targetHeader & "' created with " & includedRows.Count & " rows."
End Sub

