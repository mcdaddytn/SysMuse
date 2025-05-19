Sub ParseFileNameComponents()
    Dim ws As Worksheet
    Set ws = ActiveSheet
    
    Dim lastRow As Long
    lastRow = ws.Cells(ws.Rows.Count, "A").End(xlUp).Row
    
    ' Find the column number of "File Name"
    Dim fileNameCol As Long
    fileNameCol = 0
    Dim col As Long
    For col = 1 To ws.Cells(1, ws.Columns.Count).End(xlToLeft).Column
        If Trim(ws.Cells(1, col).Value) = "File Name" Then
            fileNameCol = col
            Exit For
        End If
    Next col
    
    If fileNameCol = 0 Then
        MsgBox "File Name column not found."
        Exit Sub
    End If

    ' Insert columns for FileRoot, FileExt, AlphaPrefix
    ws.Cells(1, fileNameCol + 1).EntireColumn.Insert
    ws.Cells(1, fileNameCol + 1).Value = "FileRoot"
    ws.Cells(1, fileNameCol + 2).EntireColumn.Insert
    ws.Cells(1, fileNameCol + 2).Value = "FileExt"
    ws.Cells(1, fileNameCol + 3).EntireColumn.Insert
    ws.Cells(1, fileNameCol + 3).Value = "AlphaPrefix"
    
    Dim i As Long, fName As String
    For i = 2 To lastRow
        fName = ws.Cells(i, fileNameCol).Value
        If Len(fName) > 0 Then
            Dim lastDot As Long
            lastDot = InStrRev(fName, ".")
            
            Dim root As String, ext As String
            If lastDot > 0 Then
                root = Left(fName, lastDot - 1)
                ext = Mid(fName, lastDot + 1)
            Else
                root = fName
                ext = ""
            End If
            
            ' Extract AlphaPrefix
            Dim prefix As String
            Dim j As Long
            prefix = ""
            For j = 1 To Len(root)
                Dim ch As String
                ch = Mid(root, j, 1)
                If ch Like "[A-Za-z]" Then
                    prefix = prefix & ch
                ElseIf ch Like "[_ -]" Then
                    prefix = prefix
                Else
                    Exit For
                End If
            Next j
            
            ws.Cells(i, fileNameCol + 1).Value = root
            ws.Cells(i, fileNameCol + 2).Value = ext
            ws.Cells(i, fileNameCol + 3).Value = prefix
        End If
    Next i
    
    MsgBox "File Name parsing complete."
End Sub

Sub CountDistinctValues(targetHeader As String, Optional outputSheetName As String = "")
    Dim ws As Worksheet
    Set ws = ActiveSheet

    Dim lastRow As Long
    lastRow = ws.Cells(ws.Rows.Count, "A").End(xlUp).Row

    ' Find the column index of the target header
    Dim headerCol As Long: headerCol = 0
    Dim col As Long
    For col = 1 To ws.Cells(1, ws.Columns.Count).End(xlToLeft).Column
        If Trim(ws.Cells(1, col).Value) = targetHeader Then
            headerCol = col
            Exit For
        End If
    Next col
    
    If headerCol = 0 Then
        MsgBox "Column '" & targetHeader & "' not found."
        Exit Sub
    End If
    
    If outputSheetName = "" Then
        outputSheetName = targetHeader
    End If

    ' Create or clear the output sheet
    Dim outWS As Worksheet
    On Error Resume Next
    Set outWS = Worksheets(outputSheetName)
    On Error GoTo 0

    If Not outWS Is Nothing Then
        Application.DisplayAlerts = False
        outWS.Delete
        Application.DisplayAlerts = True
    End If

    Set outWS = Worksheets.Add
    outWS.Name = outputSheetName

    Dim dict As Object
    Set dict = CreateObject("Scripting.Dictionary")

    Dim i As Long, val As String
    For i = 2 To lastRow
        val = Trim(ws.Cells(i, headerCol).Value)
        If val <> "" Then
            If dict.exists(val) Then
                dict(val) = dict(val) + 1
            Else
                dict.Add val, 1
            End If
        End If
    Next i

    ' Write headers
    outWS.Cells(1, 1).Value = targetHeader
    outWS.Cells(1, 2).Value = "Count"

    ' Output results
    Dim rowOut As Long: rowOut = 2
    Dim key As Variant
    For Each key In dict.Keys
        outWS.Cells(rowOut, 1).Value = key
        outWS.Cells(rowOut, 2).Value = dict(key)
        rowOut = rowOut + 1
    Next key

    MsgBox "Distinct values for '" & targetHeader & "' written to worksheet '" & outputSheetName & "'."
End Sub

Sub CountAlphaPrefixValues()
    Call CountDistinctValues("AlphaPrefix")
End Sub

Sub CountFileRootValues()
    Call CountDistinctValues("FileRoot")
End Sub

Sub CountFileExtValues()
    Call CountDistinctValues("FileExt")
End Sub

