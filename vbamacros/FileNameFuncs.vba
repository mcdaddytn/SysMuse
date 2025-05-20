Sub ParseFileNameComponents()
    Dim ws As Worksheet
    Set ws = ActiveSheet

    Dim lastRow As Long
    lastRow = ws.Cells(ws.Rows.Count, "A").End(xlUp).Row

    ' Find "File Name" column
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

    ' Determine first blank column after data
    Dim insertCol As Long
    insertCol = ws.Cells(1, ws.Columns.Count).End(xlToLeft).Column + 2 ' Leave one blank column

    ws.Cells(1, insertCol).Value = "FileRoot"
    ws.Cells(1, insertCol + 1).Value = "FileExt"
    ws.Cells(1, insertCol + 2).Value = "AlphaPrefix"
    ws.Cells(1, insertCol + 3).Value = "AlphaRegex"

    Dim i As Long, fName As String
    For i = 2 To lastRow
        fName = Trim(ws.Cells(i, fileNameCol).Value)
        If Len(fName) > 0 Then
            Dim lastDot As Long: lastDot = InStrRev(fName, ".")
            Dim root As String, ext As String
            If lastDot > 0 Then
                root = Left(fName, lastDot - 1)
                ext = Mid(fName, lastDot + 1)
            Else
                root = fName
                ext = ""
            End If

            ' Extract AlphaPrefix
            Dim ch As String
            Dim prefix As String: prefix = ""
            Dim j As Long
            For j = 1 To Len(root)
                ch = Mid(root, j, 1)
                If ch Like "[A-Za-z]" Or ch = " " Or ch = "_" Or ch = "-" Then
                    prefix = prefix & ch
                Else
                    Exit For
                End If
            Next j

            ' Build regex from root
            Dim regexStr As String: regexStr = ""
            For j = 1 To Len(root)
                ch = Mid(root, j, 1)
                If ch Like "[A-Za-z]" Then
                    regexStr = regexStr & ch
                ElseIf ch = " " Or ch = "_" Or ch = "-" Then
                    regexStr = regexStr & "[ _-]+"
                ElseIf ch Like "[0-9]" Then
                    If Right(regexStr, 3) <> "\d" Then regexStr = regexStr & "\d+"
                Else
                    If Right(regexStr, 2) <> "\W" Then regexStr = regexStr & "\W+"
                End If
            Next j

            ws.Cells(i, insertCol).Value = root
            ws.Cells(i, insertCol + 1).Value = ext
            ws.Cells(i, insertCol + 2).Value = Trim(prefix)
            ws.Cells(i, insertCol + 3).Value = regexStr
        End If
    Next i

    MsgBox "Parsing complete with AlphaRegex."
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

Sub FilterByAlphaPrefixToSheet(prefix As String, outputSheetName As String)
    Dim wsSource As Worksheet
    Set wsSource = ActiveSheet

    Dim lastRow As Long
    lastRow = wsSource.Cells(wsSource.Rows.Count, "A").End(xlUp).Row

    ' Get column indexes
    Dim colBegDoc As Long, colFileName As Long, colAlphaPrefix As Long
    colBegDoc = 0: colFileName = 0: colAlphaPrefix = 0

    Dim col As Long
    For col = 1 To wsSource.Cells(1, wsSource.Columns.Count).End(xlToLeft).Column
        Select Case Trim(wsSource.Cells(1, col).Value)
            Case "BegDoc": colBegDoc = col
            Case "File Name": colFileName = col
            Case "AlphaPrefix": colAlphaPrefix = col
        End Select
    Next col

    If colBegDoc = 0 Or colFileName = 0 Or colAlphaPrefix = 0 Then
        MsgBox "Missing required columns (BegDoc, File Name, AlphaPrefix)."
        Exit Sub
    End If

    ' Get or create output sheet
    Dim wsOut As Worksheet
    On Error Resume Next
    Set wsOut = Worksheets(outputSheetName)
    On Error GoTo 0

    If wsOut Is Nothing Then
        Set wsOut = Worksheets.Add
        wsOut.Name = Left(outputSheetName, 31)
        wsOut.Cells(1, 1).Value = "BegDoc"
        wsOut.Cells(1, 2).Value = "File Name"
    End If

    Dim outRow As Long
    outRow = wsOut.Cells(wsOut.Rows.Count, 1).End(xlUp).Row + 1

    Dim i As Long
    For i = 2 To lastRow
        If Trim(wsSource.Cells(i, colAlphaPrefix).Value) = prefix Then
            wsOut.Cells(outRow, 1).Value = wsSource.Cells(i, colBegDoc).Value
            wsOut.Cells(outRow, 2).Value = wsSource.Cells(i, colFileName).Value
            outRow = outRow + 1
        End If
    Next i
End Sub

Sub FilterByFileExtToSheet(fileExt As String, outputSheetName As String)
    Dim wsSource As Worksheet
    Set wsSource = ActiveSheet

    Dim lastRow As Long
    lastRow = wsSource.Cells(wsSource.Rows.Count, "A").End(xlUp).Row

    ' Get column indexes
    Dim colBegDoc As Long, colFileName As Long, colFileExt As Long
    colBegDoc = 0: colFileName = 0: colFileExt = 0

    Dim col As Long
    For col = 1 To wsSource.Cells(1, wsSource.Columns.Count).End(xlToLeft).Column
        Select Case Trim(wsSource.Cells(1, col).Value)
            Case "BegDoc": colBegDoc = col
            Case "File Name": colFileName = col
            Case "FileExt": colFileExt = col
        End Select
    Next col

    If colBegDoc = 0 Or colFileName = 0 Or colFileExt = 0 Then
        MsgBox "Missing required columns (BegDoc, File Name, FileExt)."
        Exit Sub
    End If

    ' Get or create output sheet
    Dim wsOut As Worksheet
    On Error Resume Next
    Set wsOut = Worksheets(outputSheetName)
    On Error GoTo 0

    If wsOut Is Nothing Then
        Set wsOut = Worksheets.Add
        wsOut.Name = Left(outputSheetName, 31)
        wsOut.Cells(1, 1).Value = "BegDoc"
        wsOut.Cells(1, 2).Value = "File Name"
    End If

    Dim outRow As Long
    outRow = wsOut.Cells(wsOut.Rows.Count, 1).End(xlUp).Row + 1

    Dim i As Long
    For i = 2 To lastRow
        If Trim(wsSource.Cells(i, colFileExt).Value) = fileExt Then
            wsOut.Cells(outRow, 1).Value = wsSource.Cells(i, colBegDoc).Value
            wsOut.Cells(outRow, 2).Value = wsSource.Cells(i, colFileName).Value
            outRow = outRow + 1
        End If
    Next i
End Sub

Sub FilterByRegexToSheet(pattern As String, outputSheetName As String)
    Dim wsSource As Worksheet
    Set wsSource = ActiveSheet

    Dim lastRow As Long
    lastRow = wsSource.Cells(wsSource.Rows.Count, "A").End(xlUp).Row

    ' Get columns
    Dim colBegDoc As Long, colFileName As Long, colFileRoot As Long
    colBegDoc = 0: colFileName = 0: colFileRoot = 0

    Dim col As Long
    For col = 1 To wsSource.Cells(1, wsSource.Columns.Count).End(xlToLeft).Column
        Select Case Trim(wsSource.Cells(1, col).Value)
            Case "BegDoc": colBegDoc = col
            Case "File Name": colFileName = col
            Case "FileRoot": colFileRoot = col
        End Select
    Next col

    If colBegDoc = 0 Or colFileName = 0 Or colFileRoot = 0 Then
        MsgBox "Missing required columns (BegDoc, File Name, FileRoot)."
        Exit Sub
    End If

    ' Output worksheet (append or create)
    Dim wsOut As Worksheet
    On Error Resume Next
    Set wsOut = Worksheets(outputSheetName)
    On Error GoTo 0

    If wsOut Is Nothing Then
        Set wsOut = Worksheets.Add
        wsOut.Name = Left(outputSheetName, 31)
        wsOut.Cells(1, 1).Value = "BegDoc"
        wsOut.Cells(1, 2).Value = "File Name"
    End If

    Dim outRow As Long
    outRow = wsOut.Cells(wsOut.Rows.Count, 1).End(xlUp).Row + 1

    ' Prepare regex
    Dim re As Object
    Set re = CreateObject("VBScript.RegExp")
    re.Pattern = pattern
    re.IgnoreCase = True
    re.Global = False

    ' Filter
    Dim i As Long, value As String
    For i = 2 To lastRow
        value = Trim(wsSource.Cells(i, colFileRoot).Value)
        If re.test(value) Then
            wsOut.Cells(outRow, 1).Value = wsSource.Cells(i, colBegDoc).Value
            wsOut.Cells(outRow, 2).Value = wsSource.Cells(i, colFileName).Value
            outRow = outRow + 1
        End If
    Next i

    MsgBox "Regex filter complete to worksheet '" & outputSheetName & "'."
End Sub

Sub RunExampleFilters()
    ' Appends all matches for AlphaPrefix "Secretary Cert -" to "CertDocs"
    'Call FilterByAlphaPrefixToSheet("Secretary Cert -", "CertDocs")

    ' Appends all .pdf matches to "PDFDocs"
    'Call FilterByFileExtToSheet("pdf", "PDFDocs")
    Call FilterByFileExtToSheet("detail", "detail")
End Sub

Sub RunAlphaRegexFilter()
    Dim pattern As String
    pattern = "SAS[ _-]+\d+\.\w+" ' Adjust based on desired root structure

    Call FilterByRegexToSheet(pattern, "RegexFiltered")
End Sub
