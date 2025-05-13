
Sub ProcessApplicabilityDataNoArgs()
    Call ProcessApplicabilityData("Data with AI", "Field Summary")
End Sub

Sub ProcessApplicabilityData(dataSheetName As String, summarySheetName As String)
    Dim dataWS As Worksheet, summaryWS As Worksheet, fieldSummaryWS As Worksheet
    Dim lastRow As Long, lastCol As Long, i As Long, j As Long, k As Long
    Dim colMap As Object, comboDict As Object
    Dim rowDict As Object, key As Variant
    Dim appFields As Collection, retainCols As Collection, deleteCols As Collection
    Dim setNames As Collection
    Dim appField As Variant
    Dim reasonField As String, snippetField As String, appFieldStr As String
    Dim formulaStr As String

    Set dataWS = ThisWorkbook.Sheets(dataSheetName)
    Set fieldSummaryWS = ThisWorkbook.Sheets(summarySheetName)

    Set colMap = CreateObject("Scripting.Dictionary")
    lastCol = dataWS.Cells(1, dataWS.Columns.Count).End(xlToLeft).Column
    lastRow = dataWS.Cells(dataWS.Rows.Count, 1).End(xlUp).Row

    ' Map column headers to indices
    For i = 1 To lastCol
        colMap(dataWS.Cells(1, i).Value) = i
    Next i

    Set retainCols = New Collection
    Set deleteCols = New Collection
    Set appFields = New Collection
    Set setNames = New Collection

    ' Identify set column headers from column 6 onward in Field Summary
    For i = 6 To fieldSummaryWS.Cells(1, fieldSummaryWS.Columns.Count).End(xlToLeft).Column
        If Trim(fieldSummaryWS.Cells(1, i).Value) <> "" Then
            setNames.Add fieldSummaryWS.Cells(1, i).Value
        End If
    Next i

    ' Process field rows
    i = 2
    Do While fieldSummaryWS.Cells(i, 1).Value <> ""
        appFieldStr = fieldSummaryWS.Cells(i, 1).Value
        reasonField = fieldSummaryWS.Cells(i, 2).Value
        snippetField = fieldSummaryWS.Cells(i, 3).Value
        
        Debug.Print "appFieldStr: " + appFieldStr
        Debug.Print "reasonField: " + reasonField
        Debug.Print "snippetField: " + snippetField

        If appFieldStr <> "" Then appFields.Add appFieldStr
        
        Dim retainColCand As String
        Dim deleteColCand As String
        
        retainColCand = fieldSummaryWS.Cells(i, 4).Value
        deleteColCand = fieldSummaryWS.Cells(i, 5).Value
        Debug.Print "retainColCand: " + retainColCand
        Debug.Print "deleteColCand: " + deleteColCand

        If retainColCand <> "" Then
            On Error Resume Next
            Debug.Print "adding to retainCols: " + retainColCand
            retainCols.Add retainColCand
            On Error GoTo 0
        End If
        If deleteColCand <> "" Then
            On Error Resume Next
            Debug.Print "adding to deleteCols: " + deleteColCand
            deleteCols.Add deleteColCand
            On Error GoTo 0
        End If

        ' Clear reasoning/snippet if applicability is false
        If colMap.exists(appFieldStr) Then
            For j = 2 To lastRow
                If LCase(dataWS.Cells(j, colMap(appFieldStr)).Value) = "false" Then
                    If colMap.exists(reasonField) Then dataWS.Cells(j, colMap(reasonField)).ClearContents
                    If colMap.exists(snippetField) Then dataWS.Cells(j, colMap(snippetField)).ClearContents
                End If
            Next j
        End If

        i = i + 1
    Loop

    ' Delete columns by header name (if not retained)
    For i = dataWS.Cells(1, Columns.Count).End(xlToLeft).Column To 1 Step -1
        Dim hdr As String
        hdr = dataWS.Cells(1, i).Value
        If Not IsInStringCollection(retainCols, hdr) Then
            If IsInStringCollection(deleteCols, hdr) Then
                dataWS.Columns(i).Delete
            End If
        End If
    Next i

    ' Rebuild colMap
    Set colMap = CreateObject("Scripting.Dictionary")
    lastCol = dataWS.Cells(1, dataWS.Columns.Count).End(xlToLeft).Column
    For i = 1 To lastCol
        colMap(dataWS.Cells(1, i).Value) = i
    Next i

    ' Add Set columns with AND logic
    Dim setStartCol As Long
    setStartCol = dataWS.Cells(1, Columns.Count).End(xlToLeft).Column + 1

    For k = 1 To setNames.Count
        dataWS.Cells(1, setStartCol + k - 1).Value = setNames(k)
    Next k

    For k = 1 To setNames.Count
        For j = 2 To lastRow
            formulaStr = ""
            i = 2
            Do While fieldSummaryWS.Cells(i, 1).Value <> ""
                If LCase(fieldSummaryWS.Cells(i, 5 + k).Value) = "true" Then
                    If colMap.exists(fieldSummaryWS.Cells(i, 1).Value) Then
                        If formulaStr <> "" Then formulaStr = formulaStr & ","
                        formulaStr = formulaStr & dataWS.Cells(j, colMap(fieldSummaryWS.Cells(i, 1).Value)).Address(False, False)
                    End If
                End If
                i = i + 1
            Loop
            If formulaStr <> "" Then
                dataWS.Cells(j, setStartCol + k - 1).Formula = "=AND(" & formulaStr & ")"
            End If
        Next j
    Next k

    ' Summary row counts
    Dim summaryRow As Long
    summaryRow = lastRow + 2
    For Each appField In appFields
        If colMap.exists(appField) Then
            dataWS.Cells(summaryRow, colMap(appField)).Formula = "=COUNTIF(" & _
                dataWS.Range(dataWS.Cells(2, colMap(appField)), dataWS.Cells(lastRow, colMap(appField))).Address(False, False) & ",""TRUE"")"
        End If
    Next appField

    For k = 1 To setNames.Count
        Dim sc As Long
        sc = setStartCol + k - 1
        dataWS.Cells(summaryRow, sc).Formula = "=COUNTIF(" & _
            dataWS.Range(dataWS.Cells(2, sc), dataWS.Cells(lastRow, sc)).Address(False, False) & ",TRUE)"
    Next k

    ' Create applicability summary
    Set comboDict = CreateObject("Scripting.Dictionary")
    For j = 2 To lastRow
        Set rowDict = CreateObject("Scripting.Dictionary")
        key = ""
        For Each appField In appFields
            If colMap.exists(appField) Then
                Dim val As String
                val = LCase(dataWS.Cells(j, colMap(appField)).Value)
                If val <> "true" Then val = "false"
                rowDict(appField) = val
                key = key & val & "|"
            End If
        Next appField
        If comboDict.exists(key) Then
            comboDict(key) = comboDict(key) + 1
        Else
            comboDict.Add key, 1
        End If
    Next j

    On Error Resume Next
    Application.DisplayAlerts = False
    Worksheets("Applicability Summary").Delete
    Application.DisplayAlerts = True
    On Error GoTo 0

    Set summaryWS = ThisWorkbook.Sheets.Add
    summaryWS.Name = "Applicability Summary"

    For i = 1 To appFields.Count
        summaryWS.Cells(1, i).Value = appFields(i)
    Next i
    summaryWS.Cells(1, appFields.Count + 1).Value = "Count"

    i = 2
    For Each key In comboDict.Keys
        Dim parts() As String
        parts = Split(key, "|")
        For j = 0 To appFields.Count - 1
            summaryWS.Cells(i, j + 1).Value = parts(j)
        Next j
        summaryWS.Cells(i, appFields.Count + 1).Value = comboDict(key)
        i = i + 1
    Next key

    MsgBox "Processing completed.", vbInformation
End Sub

Function IsInStringCollection(col As Collection, val As String) As Boolean
    Dim itm As Variant
    On Error Resume Next
    For Each itm In col
        If itm = val Then
            IsInStringCollection = True
            Exit Function
        End If
    Next itm
    IsInStringCollection = False
End Function


