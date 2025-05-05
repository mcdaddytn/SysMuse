Sub ParseEmailSubjectsToInterim()
    Dim wsSrc As Worksheet
    Set wsSrc = ThisWorkbook.Sheets(1) ' Adjust if your original sheet is not the first

    Dim wsOut As Worksheet
    On Error Resume Next
    Application.DisplayAlerts = False
    Worksheets("InterimEmails").Delete
    Application.DisplayAlerts = True
    On Error GoTo 0
    Set wsOut = Worksheets.Add
    wsOut.Name = "InterimEmails"
    
    Dim headers As Variant
    headers = Array("BegDoc", "File Name", "SortDate", "Application Type", "Relativity Native Type", _
                    "File Extension", "Email Subject", "FileSize (kB)", "Prefix", "CleanSubject")

    Dim i As Integer
    For i = 0 To UBound(headers)
        wsOut.Cells(1, i + 1).Value = headers(i)
    Next i

    Dim lastRow As Long
    lastRow = wsSrc.Cells(wsSrc.Rows.Count, "A").End(xlUp).Row

    Dim rowOut As Long: rowOut = 2
    Dim j As Long
    For j = 2 To lastRow
        Dim subj As String, prefix As String, clean As String
        subj = Trim(wsSrc.Cells(j, 7).Value) ' Email Subject in col 7 (G)
        
        If LCase(Left(subj, 3)) = "fw:" Then
            prefix = "FW"
            clean = Trim(Mid(subj, 5))
        ElseIf LCase(Left(subj, 3)) = "re:" Then
            prefix = "RE"
            clean = Trim(Mid(subj, 5))
        Else
            prefix = ""
            clean = subj
        End If

        ' Copy original columns A to H
        wsOut.Cells(rowOut, 1).Resize(1, 8).Value = wsSrc.Cells(j, 1).Resize(1, 8).Value
        ' Add parsed prefix and cleaned subject
        wsOut.Cells(rowOut, 9).Value = prefix
        wsOut.Cells(rowOut, 10).Value = clean

        rowOut = rowOut + 1
    Next j

    wsOut.Columns("A:J").AutoFit
    MsgBox "Interim worksheet 'InterimEmails' created."
End Sub

Sub SummarizeEmailThreads()
    Dim wsIn As Worksheet
    Set wsIn = ThisWorkbook.Sheets("InterimEmails")

    Dim wsOut As Worksheet
    On Error Resume Next
    Application.DisplayAlerts = False
    Worksheets("EmailSummary").Delete
    Application.DisplayAlerts = True
    On Error GoTo 0
    Set wsOut = Worksheets.Add
    wsOut.Name = "EmailSummary"

    ' Headers
    Dim headers As Variant
    headers = Array("CleanSubject", "TotalCount", "RE_Count", "FW_Count", "OriginalCount", _
                    "LatestBegDoc", "LatestSortDate", "LatestFileSize(kB)", "TotalFileSize(kB)")
    Dim i As Integer
    For i = 0 To UBound(headers)
        wsOut.Cells(1, i + 1).Value = headers(i)
    Next i

    Dim lastRow As Long
    lastRow = wsIn.Cells(wsIn.Rows.Count, "A").End(xlUp).Row

    Dim dict As Object
    Set dict = CreateObject("Scripting.Dictionary")

    Dim r As Long
    For r = 2 To lastRow
        Dim key As String
        key = Trim(LCase(wsIn.Cells(r, 10).Value)) ' CleanSubject

        Dim sortDate As Date: sortDate = wsIn.Cells(r, 3).Value
        Dim begDoc As String: begDoc = wsIn.Cells(r, 1).Value
        Dim size As Double: size = wsIn.Cells(r, 8).Value
        Dim prefix As String: prefix = UCase(wsIn.Cells(r, 9).Value)

        If Not dict.exists(key) Then
            Dim t As Object
            Set t = CreateObject("Scripting.Dictionary")
            t("CleanSubject") = wsIn.Cells(r, 10).Value
            t("TotalCount") = 1
            t("RE_Count") = IIf(prefix = "RE", 1, 0)
            t("FW_Count") = IIf(prefix = "FW", 1, 0)
            t("OriginalCount") = IIf(prefix = "", 1, 0)
            t("LatestBegDoc") = begDoc
            t("LatestSortDate") = sortDate
            t("LatestFileSize") = size
            t("TotalFileSize") = size
            dict.Add key, t
        Else
            Set t = dict(key)
            t("TotalCount") = t("TotalCount") + 1
            If prefix = "RE" Then t("RE_Count") = t("RE_Count") + 1
            If prefix = "FW" Then t("FW_Count") = t("FW_Count") + 1
            If prefix = "" Then t("OriginalCount") = t("OriginalCount") + 1
            If sortDate > t("LatestSortDate") Then
                t("LatestSortDate") = sortDate
                t("LatestBegDoc") = begDoc
                t("LatestFileSize") = size
            End If
            t("TotalFileSize") = t("TotalFileSize") + size
        End If
    Next r

    ' Output
    Dim idx As Long: idx = 2
    Dim k As Variant
    For Each k In dict.Keys
        Set t = dict(k)
        wsOut.Cells(idx, 1).Value = t("CleanSubject")
        wsOut.Cells(idx, 2).Value = t("TotalCount")
        wsOut.Cells(idx, 3).Value = t("RE_Count")
        wsOut.Cells(idx, 4).Value = t("FW_Count")
        wsOut.Cells(idx, 5).Value = t("OriginalCount")
        wsOut.Cells(idx, 6).Value = t("LatestBegDoc")
        wsOut.Cells(idx, 7).Value = t("LatestSortDate")
        wsOut.Cells(idx, 8).Value = t("LatestFileSize")
        wsOut.Cells(idx, 9).Value = t("TotalFileSize")
        idx = idx + 1
    Next k

    wsOut.Columns("A:I").AutoFit
    MsgBox "EmailSummary has been updated with cumulative statistics."
End Sub

Private Function CollectionFromRow(ws As Worksheet, r As Long) As Variant
    Dim prefix As String: prefix = ws.Cells(r, 9).Value
    Dim subj As String: subj = ws.Cells(r, 10).Value
    Dim sortDate As Date: sortDate = ws.Cells(r, 3).Value
    Dim begDoc As String: begDoc = ws.Cells(r, 1).Value
    Dim size As Double: size = ws.Cells(r, 8).Value

    Dim REcnt As Long: If prefix = "RE" Then REcnt = 1
    Dim FWcnt As Long: If prefix = "FW" Then FWcnt = 1
    Dim OrigCnt As Long: If prefix = "" Then OrigCnt = 1

    Dim arr(0 To 8) As Variant
    arr(0) = subj
    arr(1) = 1 ' Total count
    arr(2) = REcnt
    arr(3) = FWcnt
    arr(4) = OrigCnt
    arr(5) = begDoc
    arr(6) = sortDate
    arr(7) = size
    arr(8) = size ' Total size

    CollectionFromRow = arr
End Function

Private Sub UpdateCollection(ByRef arr As Variant, ws As Worksheet, r As Long)
    Dim prefix As String: prefix = ws.Cells(r, 9).Value
    Dim sortDate As Date: sortDate = ws.Cells(r, 3).Value
    Dim begDoc As String: begDoc = ws.Cells(r, 1).Value
    Dim size As Double: size = ws.Cells(r, 8).Value

    arr(1) = arr(1) + 1
    If prefix = "RE" Then arr(2) = arr(2) + 1
    If prefix = "FW" Then arr(3) = arr(3) + 1
    If prefix = "" Then arr(4) = arr(4) + 1

    If sortDate > arr(6) Then
        arr(5) = begDoc
        arr(6) = sortDate
        arr(7) = size
    End If

    arr(8) = arr(8) + size
End Sub

Sub FilterEmailSummaryByThreshold(fieldName As String, threshold As Long)
    Dim wsSrc As Worksheet
    On Error Resume Next
    Set wsSrc = ThisWorkbook.Sheets("EmailSummary")
    If wsSrc Is Nothing Then
        MsgBox "Worksheet 'EmailSummary' not found!", vbExclamation
        Exit Sub
    End If
    On Error GoTo 0

    ' Create output sheet
    Dim sheetName As String
    sheetName = "Filtered_" & fieldName & "_" & threshold

    Application.DisplayAlerts = False
    On Error Resume Next
    Worksheets(sheetName).Delete
    On Error GoTo 0
    Application.DisplayAlerts = True

    Dim wsOut As Worksheet
    Set wsOut = Worksheets.Add
    wsOut.Name = sheetName

    ' Copy headers
    wsSrc.Rows(1).Copy Destination:=wsOut.Rows(1)

    ' Find column index of fieldName
    Dim colIdx As Integer
    Dim found As Boolean: found = False
    Dim c As Integer
    For c = 1 To wsSrc.UsedRange.Columns.Count
        If Trim(wsSrc.Cells(1, c).Value) = fieldName Then
            colIdx = c
            found = True
            Exit For
        End If
    Next c

    If Not found Then
        MsgBox "Field '" & fieldName & "' not found in EmailSummary!", vbCritical
        Exit Sub
    End If

    ' Copy rows that meet or exceed the threshold
    Dim lastRow As Long
    lastRow = wsSrc.Cells(wsSrc.Rows.Count, "A").End(xlUp).Row
    Dim outRow As Long: outRow = 2

    Dim i As Long
    For i = 2 To lastRow
        If wsSrc.Cells(i, colIdx).Value >= threshold Then
            wsSrc.Rows(i).Copy Destination:=wsOut.Rows(outRow)
            outRow = outRow + 1
        End If
    Next i

    wsOut.Columns.AutoFit
    MsgBox "Filtered results written to '" & sheetName & "'."
End Sub

' === No-argument version for "RE_Count" >= 10 ===
Sub FilterEmailSummary_RE_Count_10()
    Call FilterEmailSummaryByThreshold("RE_Count", 10)
End Sub

