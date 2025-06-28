Sub ExtractSpamDocIds_Default()
    ExtractSpamDocIds _
        dataSheet:="collection_tags_report_bool_con", _
        spamSheet:="Spam", _
        idColumn:="BegDoc", _
        dataSpamCol:="Email From", _
        spamCol:="Email_From_Spam", _
        newIdSheet:="SpamDocs"
End Sub

Sub ExtractSpamDocIds( _
    dataSheet As String, _
    spamSheet As String, _
    idColumn As String, _
    dataSpamCol As String, _
    spamCol As String, _
    newIdSheet As String)

    Dim wsData As Worksheet, wsSpam As Worksheet, wsOut As Worksheet
    Dim wb As Workbook: Set wb = ThisWorkbook

    On Error Resume Next
    Set wsData = wb.Worksheets(dataSheet)
    Set wsSpam = wb.Worksheets(spamSheet)
    Set wsOut = wb.Worksheets(newIdSheet)
    On Error GoTo 0

    If wsData Is Nothing Or wsSpam Is Nothing Then
        MsgBox "Either dataSheet or spamSheet was not found."
        Exit Sub
    End If

    ' Create output sheet if not exists
    If wsOut Is Nothing Then
        Set wsOut = wb.Worksheets.Add
        wsOut.Name = newIdSheet
    Else
        wsOut.Cells.ClearContents
    End If

    ' Identify column numbers in dataSheet
    Dim dataIdColNum As Long, dataSpamColNum As Long
    dataIdColNum = GetColumnIndexByHeader(wsData, idColumn)
    dataSpamColNum = GetColumnIndexByHeader(wsData, dataSpamCol)
    If dataIdColNum = -1 Or dataSpamColNum = -1 Then
        MsgBox "Could not find idColumn or dataSpamCol in dataSheet."
        Exit Sub
    End If

    ' Identify spamCol column in spamSheet
    Dim spamColNum As Long
    spamColNum = GetColumnIndexByHeader(wsSpam, spamCol)
    If spamColNum = -1 Then
        MsgBox "Could not find spamCol in spamSheet."
        Exit Sub
    End If

    ' Load all spam emails into dictionary for fast lookup
    Dim spamDict As Object: Set spamDict = CreateObject("Scripting.Dictionary")
    Dim lastSpamRow As Long
    lastSpamRow = wsSpam.Cells(wsSpam.Rows.Count, spamColNum).End(xlUp).Row

    Dim r As Long
    For r = 2 To lastSpamRow
        Dim spamVal As String
        spamVal = Trim(wsSpam.Cells(r, spamColNum).Value)
        If Len(spamVal) > 0 Then
            spamDict(LCase(spamVal)) = True
        End If
    Next r

    ' Go through dataSheet and collect matching IDs
    Dim lastDataRow As Long
    lastDataRow = wsData.Cells(wsData.Rows.Count, dataIdColNum).End(xlUp).Row

    Dim outRow As Long: outRow = 1
    wsOut.Cells(outRow, 1).Value = idColumn ' header
    outRow = outRow + 1

    For r = 2 To lastDataRow
        Dim dataSpamVal As String
        dataSpamVal = Trim(wsData.Cells(r, dataSpamColNum).Value)
        If Len(dataSpamVal) > 0 And spamDict.Exists(LCase(dataSpamVal)) Then
            wsOut.Cells(outRow, 1).Value = wsData.Cells(r, dataIdColNum).Value
            outRow = outRow + 1
        End If
    Next r

    MsgBox "Spam ID extraction complete. " & (outRow - 2) & " IDs written to '" & newIdSheet & "'."
End Sub

' Helper function to get column number by header name
Function GetColumnIndexByHeader(ws As Worksheet, headerName As String) As Long
    Dim col As Long
    For col = 1 To ws.Cells(1, ws.Columns.Count).End(xlToLeft).Column
        If Trim(ws.Cells(1, col).Value) = headerName Then
            GetColumnIndexByHeader = col
            Exit Function
        End If
    Next col
    GetColumnIndexByHeader = -1
End Function
