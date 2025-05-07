Sub RemoveFileExtensionFromColumn(headerName As String)
    Dim ws As Worksheet
    Set ws = ActiveSheet

    Dim headerRow As Range
    Set headerRow = ws.Rows(1)

    Dim colIndex As Integer
    colIndex = -1

    ' Find the column index with the specified header name
    Dim cell As Range
    For Each cell In headerRow.Cells
        If Trim(cell.Value) = headerName Then
            colIndex = cell.Column
            Exit For
        End If
    Next cell

    If colIndex = -1 Then
        MsgBox "Header '" & headerName & "' not found.", vbExclamation
        Exit Sub
    End If

    ' Loop through all rows starting from row 2
    Dim lastRow As Long
    lastRow = ws.Cells(ws.Rows.Count, colIndex).End(xlUp).Row

    Dim i As Long
    For i = 2 To lastRow
        Dim fullName As String
        fullName = ws.Cells(i, colIndex).Value

        If InStrRev(fullName, ".") > 0 Then
            ' Remove the extension
            ws.Cells(i, colIndex).Value = Left(fullName, InStrRev(fullName, ".") - 1)
        End If
    Next i
End Sub

Sub RemoveFileExtensionNoArgs()
    Call RemoveFileExtensionFromColumn("FileName")
End Sub
