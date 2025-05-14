Sub FillFormulaDownFromHeaderNoArgs()
    Call FillFormulaDownFromHeader("AnyBoolNotSpam")
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

