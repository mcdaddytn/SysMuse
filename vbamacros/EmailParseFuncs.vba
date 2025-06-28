Sub ParseEmailFromDefault()
    ParseEmailDetails "Email_From"
End Sub

Function FindFirstUnusedColumn(ws As Worksheet) As Long
    Dim col As Long
    Dim lastCol As Long
    lastCol = ws.Cells(1, ws.Columns.Count).End(xlToLeft).Column

    For col = 1 To lastCol
        If Application.WorksheetFunction.CountA(ws.Columns(col)) = 0 Then
            ' Found an empty column
            ws.Columns(col).Insert Shift:=xlToRight
            FindFirstUnusedColumn = col + 1
            Exit Function
        End If
    Next col

    ' If no empty column found, use the next available
    ws.Columns(lastCol + 1).Insert Shift:=xlToRight
    FindFirstUnusedColumn = lastCol + 2
End Function

Sub ParseEmailDetails(sourceHeader As String, Optional targetColSpec As Variant)
    Dim ws As Worksheet
    Set ws = ActiveSheet

    Dim headerRow As Long: headerRow = 1
    Dim lastCol As Long
    lastCol = ws.Cells(headerRow, ws.Columns.Count).End(xlToLeft).Column

    Dim sourceCol As Long: sourceCol = -1
    Dim col As Long
    For col = 1 To lastCol
        If Trim(ws.Cells(headerRow, col).Value) = sourceHeader Then
            sourceCol = col
            Exit For
        End If
    Next col

    If sourceCol = -1 Then
        MsgBox "Source column header '" & sourceHeader & "' not found."
        Exit Sub
    End If

    Dim targetStartCol As Long

    If IsMissing(targetColSpec) Or IsEmpty(targetColSpec) Then
        targetStartCol = FindFirstUnusedColumn(ws)
    ElseIf IsNumeric(targetColSpec) Then
        If targetColSpec >= 1 And targetColSpec <= lastCol + 10 Then
            targetStartCol = CLng(targetColSpec)
        Else
            MsgBox "Target column index is out of bounds."
            Exit Sub
        End If
    Else
        ' Assume it's a letter identifier (e.g., "K")
        On Error Resume Next
        targetStartCol = ws.Range(targetColSpec & "1").Column
        On Error GoTo 0
        If targetStartCol = 0 Then
            MsgBox "Target column identifier '" & targetColSpec & "' is invalid."
            Exit Sub
        End If
    End If

    ' Write headers
    ws.Cells(headerRow, targetStartCol).Value = "email_display"
    ws.Cells(headerRow, targetStartCol + 1).Value = "email_username"
    ws.Cells(headerRow, targetStartCol + 2).Value = "email_domain"

    ' Parse each row
    Dim row As Long
    Dim lastRow As Long
    lastRow = ws.Cells(ws.Rows.Count, sourceCol).End(xlUp).Row

    Dim fullText As String, email As String, displayName As String
    Dim username As String, domain As String

    For row = headerRow + 1 To lastRow
        fullText = Trim(ws.Cells(row, sourceCol).Value)
        email = ""
        displayName = ""

        If InStr(fullText, "[") > 0 And InStr(fullText, "]") > InStr(fullText, "[") Then
            email = Trim(Mid(fullText, InStr(fullText, "[") + 1, InStr(fullText, "]") - InStr(fullText, "[") - 1))
            displayName = Trim(Left(fullText, InStr(fullText, "[") - 1))
        ElseIf InStr(fullText, "@") > 0 Then
            email = Trim(fullText)
            displayName = ""
        End If

        If InStr(email, "@") > 0 Then
            username = Trim(Left(email, InStr(email, "@") - 1))
            domain = Trim(Mid(email, InStr(email, "@") + 1))
        Else
            username = ""
            domain = ""
        End If

        ws.Cells(row, targetStartCol).Value = displayName
        ws.Cells(row, targetStartCol + 1).Value = username
        ws.Cells(row, targetStartCol + 2).Value = domain
    Next row

    MsgBox "Email details extracted starting at column " & targetStartCol & "."
End Sub

Sub MarkEmailSpamFromUsername()
    Dim ws As Worksheet
    Set ws = ActiveSheet

    Dim headerRow As Long: headerRow = 1
    Dim lastCol As Long
    lastCol = ws.Cells(headerRow, ws.Columns.Count).End(xlToLeft).Column

    Dim colEmailFrom As Long: colEmailFrom = -1
    Dim colUsername As Long: colUsername = -1
    Dim colSpam As Long: colSpam = -1

    Dim col As Long
    For col = 1 To lastCol
        Select Case Trim(ws.Cells(headerRow, col).Value)
            Case "Email_From": colEmailFrom = col
            Case "email_username": colUsername = col
            Case "Email_From_Spam": colSpam = col
        End Select
    Next col

    If colEmailFrom = -1 Or colUsername = -1 Then
        MsgBox "Missing required columns: Email_From and/or email_username"
        Exit Sub
    End If

    ' Create Email_From_Spam column if missing
    If colSpam = -1 Then
        colSpam = lastCol + 1
        ws.Cells(headerRow, colSpam).Value = "Email_From_Spam"
    End If

    ' Load filters from Email_Filters worksheet
    Dim wsFilter As Worksheet
    On Error Resume Next
    Set wsFilter = ThisWorkbook.Worksheets("Email_Filters")
    On Error GoTo 0

    If wsFilter Is Nothing Then
        MsgBox "Worksheet 'Email_Filters' not found."
        Exit Sub
    End If

    Dim containsList As Collection: Set containsList = New Collection
    Dim equalsList As Collection: Set equalsList = New Collection

    Dim r As Long
    Dim filterLastRow As Long
    filterLastRow = wsFilter.Cells(wsFilter.Rows.Count, 1).End(xlUp).row
    'MsgBox "MarkEmailSpamFromUsername filterLastRow: " + CStr(filterLastRow)
    Debug.Print "MarkEmailSpamFromUsername filterLastRow: " + CStr(filterLastRow)
    
    Debug.Print "=== Username_Contains Filters ==="
    For r = 2 To filterLastRow
        Dim containsVal As String
        containsVal = Trim(wsFilter.Cells(r, 1).Value)
        If containsVal <> "" Then
            containsList.Add LCase(containsVal)
            Debug.Print "Contains: " & containsVal
        End If
    Next r
    
    Debug.Print "=== Username_Equals Filters ==="
    For r = 2 To filterLastRow
        Dim equalsVal As String
        equalsVal = Trim(wsFilter.Cells(r, 2).Value)
        If equalsVal <> "" Then
            equalsList.Add LCase(equalsVal)
            Debug.Print "Equals: " & equalsVal
        End If
    Next r
    
    ' Apply spam detection
    Dim lastRow As Long
    lastRow = ws.Cells(ws.Rows.Count, colEmailFrom).End(xlUp).row

    Dim username As String, fullEmail As String, oldEmail As String
    Dim isSpam As Boolean
    Dim item As Variant
    Dim newSpamCount As Integer
    
    newSpamCount = 0

    For r = headerRow + 1 To lastRow
        username = LCase(Trim(ws.Cells(r, colUsername).Value))
        fullEmail = ws.Cells(r, colEmailFrom).Value
        isSpam = False

        ' Check contains
        For Each item In containsList
            If InStr(username, item) > 0 Then
                isSpam = True
                Debug.Print "found spam, username: '" & username & "' contains " & "'" & item & "'"
                Exit For
            End If
        Next item
        
        ' Check equals
        If Not isSpam Then
            For Each item In equalsList
                If username = item Then
                    isSpam = True
                    Debug.Print "found spam, username: '" & username & "' equals " & "'" & item & "'"
                    Exit For
                End If
            Next item
        End If

        If isSpam Then
            oldEmail = ws.Cells(r, colSpam).Value
            ws.Cells(r, colSpam).Value = fullEmail
            If oldEmail <> fullEmail Then
                newSpamCount = newSpamCount + 1
            End If
        Else
            ws.Cells(r, colSpam).ClearContents
        End If
    Next r

    MsgBox "Email_From_Spam column updated, new spam found: " + CStr(newSpamCount)
    
End Sub