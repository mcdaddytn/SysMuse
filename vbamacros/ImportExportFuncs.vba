' === Main import macro: now supports full path to root file ===
Sub ImportCSVsWithSuffixes(rootFilePath As String, suffixes As Variant, Optional joinChar As String = "_")
    Dim fso As Object
    Set fso = CreateObject("Scripting.FileSystemObject")
    
    ' Extract directory, base filename, and extension
    Dim folderPath As String
    folderPath = fso.GetParentFolderName(rootFilePath) & Application.PathSeparator
    
    Dim fileName As String
    fileName = fso.GetFileName(rootFilePath)
    
    Dim baseName As String
    baseName = Left(fileName, InStrRev(fileName, ".") - 1)
    
    Dim fileExt As String
    fileExt = Mid(fileName, InStrRev(fileName, ".") + 1)
    
    ' Loop through suffixes and import each file
    Dim suffix As Variant
    For Each suffix In suffixes
        Dim fullFileName As String
        fullFileName = folderPath & baseName & joinChar & suffix & "." & fileExt
        
        If fso.FileExists(fullFileName) Then
            ImportCSVToSheet fullFileName, CStr(suffix)
        Else
            MsgBox "File not found: " & fullFileName, vbExclamation
        End If
    Next suffix
End Sub

' === Helper macro to import a single CSV into a new worksheet ===
Sub ImportCSVToSheet(filePath As String, sheetName As String)
    Dim ws As Worksheet
    Set ws = ThisWorkbook.Sheets.Add(After:=ThisWorkbook.Sheets(ThisWorkbook.Sheets.Count))
    
    On Error Resume Next
    ws.Name = sheetName
    On Error GoTo 0
    
    With ws.QueryTables.Add(Connection:="TEXT;" & filePath, Destination:=ws.Range("A1"))
        .TextFileParseType = xlDelimited
        .TextFileCommaDelimiter = True
        .TextFilePlatform = xlWindows
        .TextFileConsecutiveDelimiter = False
        .TextFileTabDelimiter = False
        .TextFileSemicolonDelimiter = False
        .TextFileColumnDataTypes = Array(1)
        .Refresh BackgroundQuery:=False
    End With
End Sub

' === No-argument example macro for C:\temp directory ===
Sub ImportExampleCSVs()
    Dim suffixes As Variant
    'suffixes = Array("ic", "iu", "fr", "cpc")
    suffixes = Array("ic", "iu", "fr", "cpc", "cr", "bc", "aal", "wkb", "pam", "nan", "mas", "cwc")
    
    Dim rootFilePath As String
    rootFilePath = "F:\docs\rj\Matters\XTone\tavrnruns\run8\exported_data_nested_aggregation.csv"
    
    Call ImportCSVsWithSuffixes(rootFilePath, suffixes, "_")
End Sub

Sub ConsolidateSheetsWithMap(suffixFieldMap As Object)
    Dim allHeaders As Object
    Set allHeaders = CreateObject("Scripting.Dictionary")
    
    ' Always start with Depth and TotalCount
    allHeaders.Add "Depth", True
    allHeaders.Add "TotalCount", True

    Dim wsSuffix As Variant
    Dim ws As Worksheet, hdrRow As Range, col As Range
    
    ' Step 1: Collect all unique headers from each sheet
    For Each wsSuffix In suffixFieldMap.Keys
        Set ws = ThisWorkbook.Sheets(wsSuffix)
        Set hdrRow = ws.Range("1:1")
        
        For Each col In hdrRow.Cells
            If Len(col.Value) > 0 Then
                If Not allHeaders.exists(col.Value) Then
                    allHeaders.Add col.Value, True
                End If
            End If
        Next col
        
        ' Add missing field name to global headers
        Dim missingField As String
        missingField = suffixFieldMap(wsSuffix)
        If Not allHeaders.exists(missingField) Then
            allHeaders.Add missingField, True
        End If
    Next wsSuffix

    ' Step 2: Alphabetize headers except for Depth and TotalCount
    Dim fixedHeaders As Variant, dynamicHeaders() As String, k As Variant, i As Long
    fixedHeaders = Array("Depth", "TotalCount")
    ReDim dynamicHeaders(allHeaders.Count - 3)
    
    i = 0
    For Each k In allHeaders.Keys
        If k <> "Depth" And k <> "TotalCount" Then
            dynamicHeaders(i) = k
            i = i + 1
        End If
    Next
    Call QuickSort(dynamicHeaders, LBound(dynamicHeaders), UBound(dynamicHeaders))

    ' Final ordered headers
    Dim finalHeaders() As String
    ReDim finalHeaders(UBound(dynamicHeaders) + 2)
    finalHeaders(0) = "Depth"
    finalHeaders(1) = "TotalCount"
    For i = 0 To UBound(dynamicHeaders)
        finalHeaders(i + 2) = dynamicHeaders(i)
    Next i

    ' Step 3: Create Summary Sheet
    Dim summarySheet As Worksheet
    On Error Resume Next
    Application.DisplayAlerts = False
    ThisWorkbook.Sheets("Summary").Delete
    Application.DisplayAlerts = True
    On Error GoTo 0
    
    Set summarySheet = ThisWorkbook.Sheets.Add(After:=ThisWorkbook.Sheets(ThisWorkbook.Sheets.Count))
    summarySheet.Name = "Summary"
    
    ' Write header
    For i = 0 To UBound(finalHeaders)
        summarySheet.Cells(1, i + 1).Value = finalHeaders(i)
    Next i
    
    ' Step 4: Copy rows aligned to headers
    Dim nextRow As Long: nextRow = 2
    Dim headerIndexMap As Object
    Set headerIndexMap = CreateObject("Scripting.Dictionary")
    
    For Each wsSuffix In suffixFieldMap.Keys
        Set ws = ThisWorkbook.Sheets(wsSuffix)
        Set hdrRow = ws.Range("1:1")
        
        ' Map column name to column index
        headerIndexMap.RemoveAll
        For Each col In hdrRow.Cells
            If Len(col.Value) > 0 Then
                headerIndexMap(col.Value) = col.Column
            End If
        Next col
        
        Dim lastRow As Long
        lastRow = ws.Cells(ws.Rows.Count, 1).End(xlUp).Row
        
        Dim rowNum As Long
        For rowNum = 2 To lastRow
            For i = 0 To UBound(finalHeaders)
                Dim colName As String: colName = finalHeaders(i)
                If headerIndexMap.exists(colName) Then
                    summarySheet.Cells(nextRow, i + 1).Value = ws.Cells(rowNum, headerIndexMap(colName)).Value
                Else
                    summarySheet.Cells(nextRow, i + 1).Value = "" ' or 0 if integers
                End If
            Next i
            nextRow = nextRow + 1
        Next rowNum
    Next wsSuffix
End Sub

' === Sample no-argument macro to call above ===
Sub RunConsolidationExample()
    Dim suffixFieldMap As Object
    Set suffixFieldMap = CreateObject("Scripting.Dictionary")
    
    suffixFieldMap.Add "ic", "Inventor_Communications"
    suffixFieldMap.Add "iu", "Investor_Updates"
    suffixFieldMap.Add "fr", "Financial_Records"
    suffixFieldMap.Add "cpc", "Customer_Partner_Correspondence" ' You can add more as needed
    
    Call ConsolidateSheetsWithMap(suffixFieldMap)
End Sub

Sub QuickSort(arr() As String, first As Long, last As Long)
    Dim i As Long, j As Long, pivot As String, temp As String
    i = first
    j = last
    pivot = arr((first + last) \ 2)
    
    Do While i <= j
        Do While arr(i) < pivot
            i = i + 1
        Loop
        Do While arr(j) > pivot
            j = j - 1
        Loop
        If i <= j Then
            temp = arr(i)
            arr(i) = arr(j)
            arr(j) = temp
            i = i + 1
            j = j - 1
        End If
    Loop
    
    If first < j Then QuickSort arr, first, j
    If i < last Then QuickSort arr, i, last
End Sub

