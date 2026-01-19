' =============================================================================
' Attorney Portfolio Analysis Macros
' =============================================================================
' Imports attorney portfolio CSV and generates aggregate analysis worksheets.
'
' Data source: output/ATTORNEY-PORTFOLIO-LATEST.csv (NOT in excel/ directory)
' Note: The excel/ directory contains ONLY macro files (.bas)
'       All data files (.csv, .json) are in output/ directory
'
' Worksheets Generated:
'   - RawData: Full patent portfolio data
'   - Summary: Portfolio overview statistics
'   - ByAffiliate: Patents grouped by portfolio affiliate
'   - BySector: Patents grouped by technology sector
'   - ByCPC: Patents grouped by CPC classification
'   - ExpirationTimeline: Patents by expiration year
'
' Usage:
'   1. Open Excel, create new workbook
'   2. Import this module (Alt+F11 -> File -> Import)
'   3. Run ImportAttorneyPortfolio macro (Alt+F8)
' =============================================================================

Option Explicit

' Column indices for key fields (1-based, after import)
Private Const COL_PATENT_ID As Integer = 1
Private Const COL_TITLE As Integer = 2
Private Const COL_GRANT_DATE As Integer = 3
Private Const COL_ASSIGNEE As Integer = 4
Private Const COL_AFFILIATE As Integer = 5
Private Const COL_YEARS_REMAINING As Integer = 6
Private Const COL_IS_EXPIRED As Integer = 7
Private Const COL_FORWARD_CITES As Integer = 8
Private Const COL_COMPETITOR_CITES As Integer = 9
Private Const COL_COMPETITORS_CITING As Integer = 10
Private Const COL_ELIGIBILITY As Integer = 11
Private Const COL_VALIDITY As Integer = 12
Private Const COL_SECTOR As Integer = 20
Private Const COL_CPC_PRIMARY As Integer = 22

' =============================================================================
' MAIN IMPORT FUNCTION
' =============================================================================

Public Sub ImportAttorneyPortfolio()
    Dim filePath As String
    Dim ws As Worksheet

    Application.ScreenUpdating = False
    Application.Calculation = xlCalculationManual

    ' Find the CSV file - look in output/ directory (parent of excel/)
    filePath = FindDataFile("ATTORNEY-PORTFOLIO")

    If filePath = "" Then
        MsgBox "Could not find ATTORNEY-PORTFOLIO-*.csv in output/ directory." & vbCrLf & _
               "Please run: npm run export:attorney", vbExclamation, "File Not Found"
        GoTo Cleanup
    End If

    ' Clear existing sheets except first
    ClearWorksheets

    ' Import raw data
    Set ws = ImportCSV(filePath, "RawData")
    If ws Is Nothing Then
        MsgBox "Failed to import CSV file.", vbExclamation, "Import Error"
        GoTo Cleanup
    End If

    ' Format RawData sheet
    FormatRawDataSheet ws

    ' Generate aggregate worksheets
    GenerateSummarySheet
    GenerateAffiliateSheet
    GenerateSectorSheet
    GenerateCPCSheet
    GenerateExpirationSheet

    ' Activate Summary sheet
    Worksheets("Summary").Activate

    MsgBox "Import complete!" & vbCrLf & vbCrLf & _
           "Worksheets created:" & vbCrLf & _
           "  - RawData: Full portfolio (" & (ws.UsedRange.Rows.Count - 1) & " patents)" & vbCrLf & _
           "  - Summary: Portfolio overview" & vbCrLf & _
           "  - ByAffiliate: Grouped by affiliate" & vbCrLf & _
           "  - BySector: Grouped by technology sector" & vbCrLf & _
           "  - ByCPC: Grouped by CPC class" & vbCrLf & _
           "  - ExpirationTimeline: By expiration year", _
           vbInformation, "Import Complete"

Cleanup:
    Application.ScreenUpdating = True
    Application.Calculation = xlCalculationAutomatic
End Sub

' =============================================================================
' FILE FINDING
' =============================================================================

Private Function FindDataFile(prefix As String) As String
    Dim fso As Object
    Dim folder As Object
    Dim file As Object
    Dim basePath As String
    Dim latestFile As String
    Dim latestDate As Date

    Set fso = CreateObject("Scripting.FileSystemObject")

    ' Try to find output/ directory relative to workbook or current directory
    basePath = ThisWorkbook.Path
    If basePath = "" Then basePath = CurDir

    ' Go up from excel/ to project root, then into output/
    If InStr(basePath, "excel") > 0 Then
        basePath = fso.GetParentFolderName(basePath)
    End If
    basePath = basePath & "\output"

    ' Check for LATEST file first
    If fso.FileExists(basePath & "\" & prefix & "-LATEST.csv") Then
        FindDataFile = basePath & "\" & prefix & "-LATEST.csv"
        Exit Function
    End If

    ' Otherwise find most recent dated file
    If fso.FolderExists(basePath) Then
        Set folder = fso.GetFolder(basePath)
        latestDate = DateSerial(1900, 1, 1)

        For Each file In folder.Files
            If Left(file.Name, Len(prefix)) = prefix And Right(file.Name, 4) = ".csv" Then
                If file.DateLastModified > latestDate Then
                    latestDate = file.DateLastModified
                    latestFile = file.Path
                End If
            End If
        Next file

        FindDataFile = latestFile
    Else
        FindDataFile = ""
    End If
End Function

' =============================================================================
' CSV IMPORT
' =============================================================================

Private Function ImportCSV(filePath As String, sheetName As String) As Worksheet
    Dim ws As Worksheet
    Dim qt As QueryTable

    On Error Resume Next
    Set ws = Worksheets(sheetName)
    On Error GoTo 0

    If ws Is Nothing Then
        Set ws = Worksheets.Add(After:=Worksheets(Worksheets.Count))
        ws.Name = sheetName
    Else
        ws.Cells.Clear
    End If

    ' Import CSV using QueryTable for better handling of commas in quoted fields
    Set qt = ws.QueryTables.Add( _
        Connection:="TEXT;" & filePath, _
        Destination:=ws.Range("A1"))

    With qt
        .TextFileParseType = xlDelimited
        .TextFileCommaDelimiter = True
        .TextFileTextQualifier = xlTextQualifierDoubleQuote
        .RefreshStyle = xlOverwriteCells
        .Refresh BackgroundQuery:=False
        .Delete
    End With

    Set ImportCSV = ws
End Function

' =============================================================================
' WORKSHEET FORMATTING
' =============================================================================

Private Sub FormatRawDataSheet(ws As Worksheet)
    Dim lastRow As Long
    Dim lastCol As Long

    lastRow = ws.Cells(ws.Rows.Count, 1).End(xlUp).Row
    lastCol = ws.Cells(1, ws.Columns.Count).End(xlToLeft).Column

    ' Format header row
    With ws.Range(ws.Cells(1, 1), ws.Cells(1, lastCol))
        .Font.Bold = True
        .Interior.Color = RGB(68, 114, 196)
        .Font.Color = RGB(255, 255, 255)
    End With

    ' Auto-fit columns (with max width)
    ws.Columns.AutoFit
    Dim col As Integer
    For col = 1 To lastCol
        If ws.Columns(col).ColumnWidth > 40 Then
            ws.Columns(col).ColumnWidth = 40
        End If
    Next col

    ' Freeze header row
    ws.Rows(2).Select
    ActiveWindow.FreezePanes = True

    ' Add filters
    ws.Range(ws.Cells(1, 1), ws.Cells(lastRow, lastCol)).AutoFilter

    ws.Range("A1").Select
End Sub

Private Sub ClearWorksheets()
    Dim ws As Worksheet
    Dim sheetsToDelete As Collection
    Set sheetsToDelete = New Collection

    ' Collect sheets to delete (can't delete while iterating)
    For Each ws In Worksheets
        If ws.Index > 1 Then
            sheetsToDelete.Add ws.Name
        End If
    Next ws

    ' Delete collected sheets
    Application.DisplayAlerts = False
    Dim sheetName As Variant
    For Each sheetName In sheetsToDelete
        On Error Resume Next
        Worksheets(CStr(sheetName)).Delete
        On Error GoTo 0
    Next sheetName
    Application.DisplayAlerts = True

    ' Clear first sheet
    Worksheets(1).Cells.Clear
End Sub

' =============================================================================
' SUMMARY SHEET
' =============================================================================

Private Sub GenerateSummarySheet()
    Dim ws As Worksheet
    Dim rawWs As Worksheet
    Dim lastRow As Long
    Dim row As Long
    Dim totalPatents As Long
    Dim activePatents As Long
    Dim expiredPatents As Long
    Dim withCitations As Long
    Dim withLLM As Long

    Set rawWs = Worksheets("RawData")
    lastRow = rawWs.Cells(rawWs.Rows.Count, 1).End(xlUp).Row
    totalPatents = lastRow - 1

    ' Count metrics
    For row = 2 To lastRow
        If rawWs.Cells(row, COL_IS_EXPIRED).Value = "N" Then
            activePatents = activePatents + 1
        Else
            expiredPatents = expiredPatents + 1
        End If
        If Val(rawWs.Cells(row, COL_COMPETITOR_CITES).Value) > 0 Then
            withCitations = withCitations + 1
        End If
        If rawWs.Cells(row, 31).Value = "Y" Then ' has_llm_analysis column
            withLLM = withLLM + 1
        End If
    Next row

    ' Create Summary sheet
    Set ws = Worksheets.Add(After:=Worksheets("RawData"))
    ws.Name = "Summary"

    ' Title
    ws.Range("A1").Value = "ATTORNEY PORTFOLIO SUMMARY"
    ws.Range("A1").Font.Size = 16
    ws.Range("A1").Font.Bold = True

    ws.Range("A2").Value = "Generated: " & Format(Now, "yyyy-mm-dd hh:mm")

    ' Portfolio Status
    ws.Range("A4").Value = "PORTFOLIO STATUS"
    ws.Range("A4").Font.Bold = True
    ws.Range("A4").Interior.Color = RGB(68, 114, 196)
    ws.Range("A4").Font.Color = RGB(255, 255, 255)

    ws.Range("A5").Value = "Total Patents"
    ws.Range("B5").Value = totalPatents

    ws.Range("A6").Value = "Active Patents"
    ws.Range("B6").Value = activePatents

    ws.Range("A7").Value = "Expired Patents"
    ws.Range("B7").Value = expiredPatents

    ws.Range("A8").Value = "% Active"
    ws.Range("B8").Value = Round(activePatents / totalPatents * 100, 1) & "%"

    ' Data Coverage
    ws.Range("A10").Value = "DATA COVERAGE"
    ws.Range("A10").Font.Bold = True
    ws.Range("A10").Interior.Color = RGB(68, 114, 196)
    ws.Range("A10").Font.Color = RGB(255, 255, 255)

    ws.Range("A11").Value = "With Competitor Citations"
    ws.Range("B11").Value = withCitations
    ws.Range("C11").Value = Round(withCitations / totalPatents * 100, 1) & "%"

    ws.Range("A12").Value = "With LLM Analysis"
    ws.Range("B12").Value = withLLM
    ws.Range("C12").Value = Round(withLLM / totalPatents * 100, 1) & "%"

    ' Note about directory convention
    ws.Range("A14").Value = "DATA FILE LOCATION"
    ws.Range("A14").Font.Bold = True
    ws.Range("A14").Interior.Color = RGB(192, 80, 77)
    ws.Range("A14").Font.Color = RGB(255, 255, 255)

    ws.Range("A15").Value = "Data files (.csv, .json) are in: output/ directory"
    ws.Range("A16").Value = "Macro files (.bas) are in: excel/ directory"
    ws.Range("A17").Value = "To regenerate data: npm run export:attorney"

    ws.Columns("A:C").AutoFit
End Sub

' =============================================================================
' AFFILIATE BREAKDOWN SHEET
' =============================================================================

Private Sub GenerateAffiliateSheet()
    Dim ws As Worksheet
    Dim rawWs As Worksheet
    Dim lastRow As Long
    Dim row As Long
    Dim affiliates As Object
    Dim affiliate As Variant
    Dim key As String
    Dim outRow As Long

    Set rawWs = Worksheets("RawData")
    lastRow = rawWs.Cells(rawWs.Rows.Count, 1).End(xlUp).Row

    ' Count by affiliate
    Set affiliates = CreateObject("Scripting.Dictionary")

    For row = 2 To lastRow
        key = rawWs.Cells(row, COL_AFFILIATE).Value
        If key = "" Then key = "Unknown"

        If Not affiliates.Exists(key) Then
            affiliates.Add key, Array(0, 0, 0, 0) ' total, active, expired, withCites
        End If

        Dim counts As Variant
        counts = affiliates(key)
        counts(0) = counts(0) + 1
        If rawWs.Cells(row, COL_IS_EXPIRED).Value = "N" Then
            counts(1) = counts(1) + 1
        Else
            counts(2) = counts(2) + 1
        End If
        If Val(rawWs.Cells(row, COL_COMPETITOR_CITES).Value) > 0 Then
            counts(3) = counts(3) + 1
        End If
        affiliates(key) = counts
    Next row

    ' Create sheet
    Set ws = Worksheets.Add(After:=Worksheets(Worksheets.Count))
    ws.Name = "ByAffiliate"

    ' Headers
    ws.Range("A1").Value = "PATENTS BY AFFILIATE"
    ws.Range("A1").Font.Size = 14
    ws.Range("A1").Font.Bold = True

    ws.Range("A3").Value = "Affiliate"
    ws.Range("B3").Value = "Total"
    ws.Range("C3").Value = "Active"
    ws.Range("D3").Value = "Expired"
    ws.Range("E3").Value = "% Active"
    ws.Range("F3").Value = "With Citations"

    With ws.Range("A3:F3")
        .Font.Bold = True
        .Interior.Color = RGB(68, 114, 196)
        .Font.Color = RGB(255, 255, 255)
    End With

    ' Data
    outRow = 4
    For Each affiliate In affiliates.Keys
        counts = affiliates(affiliate)
        ws.Cells(outRow, 1).Value = affiliate
        ws.Cells(outRow, 2).Value = counts(0)
        ws.Cells(outRow, 3).Value = counts(1)
        ws.Cells(outRow, 4).Value = counts(2)
        If counts(0) > 0 Then
            ws.Cells(outRow, 5).Value = Round(counts(1) / counts(0) * 100, 1) & "%"
        End If
        ws.Cells(outRow, 6).Value = counts(3)
        outRow = outRow + 1
    Next affiliate

    ' Sort by total descending
    ws.Range("A3:F" & (outRow - 1)).Sort Key1:=ws.Range("B3"), Order1:=xlDescending, Header:=xlYes

    ' Add data bars
    ws.Range("B4:B" & (outRow - 1)).FormatConditions.AddDatabar

    ws.Columns("A:F").AutoFit
End Sub

' =============================================================================
' SECTOR BREAKDOWN SHEET
' =============================================================================

Private Sub GenerateSectorSheet()
    Dim ws As Worksheet
    Dim rawWs As Worksheet
    Dim lastRow As Long
    Dim row As Long
    Dim sectors As Object
    Dim sector As Variant
    Dim key As String
    Dim outRow As Long

    Set rawWs = Worksheets("RawData")
    lastRow = rawWs.Cells(rawWs.Rows.Count, 1).End(xlUp).Row

    ' Count by sector
    Set sectors = CreateObject("Scripting.Dictionary")

    For row = 2 To lastRow
        key = rawWs.Cells(row, COL_SECTOR).Value
        If key = "" Then key = "unassigned"

        If Not sectors.Exists(key) Then
            sectors.Add key, Array(0, 0, 0, 0)
        End If

        Dim counts As Variant
        counts = sectors(key)
        counts(0) = counts(0) + 1
        If rawWs.Cells(row, COL_IS_EXPIRED).Value = "N" Then
            counts(1) = counts(1) + 1
        Else
            counts(2) = counts(2) + 1
        End If
        If Val(rawWs.Cells(row, COL_COMPETITOR_CITES).Value) > 0 Then
            counts(3) = counts(3) + 1
        End If
        sectors(key) = counts
    Next row

    ' Create sheet
    Set ws = Worksheets.Add(After:=Worksheets(Worksheets.Count))
    ws.Name = "BySector"

    ' Headers
    ws.Range("A1").Value = "PATENTS BY TECHNOLOGY SECTOR"
    ws.Range("A1").Font.Size = 14
    ws.Range("A1").Font.Bold = True

    ws.Range("A3").Value = "Sector"
    ws.Range("B3").Value = "Total"
    ws.Range("C3").Value = "Active"
    ws.Range("D3").Value = "Expired"
    ws.Range("E3").Value = "% Active"
    ws.Range("F3").Value = "With Citations"

    With ws.Range("A3:F3")
        .Font.Bold = True
        .Interior.Color = RGB(68, 114, 196)
        .Font.Color = RGB(255, 255, 255)
    End With

    ' Data
    outRow = 4
    For Each sector In sectors.Keys
        counts = sectors(sector)
        ws.Cells(outRow, 1).Value = sector
        ws.Cells(outRow, 2).Value = counts(0)
        ws.Cells(outRow, 3).Value = counts(1)
        ws.Cells(outRow, 4).Value = counts(2)
        If counts(0) > 0 Then
            ws.Cells(outRow, 5).Value = Round(counts(1) / counts(0) * 100, 1) & "%"
        End If
        ws.Cells(outRow, 6).Value = counts(3)
        outRow = outRow + 1
    Next sector

    ' Sort by total descending
    ws.Range("A3:F" & (outRow - 1)).Sort Key1:=ws.Range("B3"), Order1:=xlDescending, Header:=xlYes

    ' Add data bars
    ws.Range("B4:B" & (outRow - 1)).FormatConditions.AddDatabar

    ws.Columns("A:F").AutoFit
End Sub

' =============================================================================
' CPC BREAKDOWN SHEET
' =============================================================================

Private Sub GenerateCPCSheet()
    Dim ws As Worksheet
    Dim rawWs As Worksheet
    Dim lastRow As Long
    Dim row As Long
    Dim cpcClasses As Object
    Dim cpc As Variant
    Dim key As String
    Dim outRow As Long

    Set rawWs = Worksheets("RawData")
    lastRow = rawWs.Cells(rawWs.Rows.Count, 1).End(xlUp).Row

    ' Count by CPC class (first 4 chars)
    Set cpcClasses = CreateObject("Scripting.Dictionary")

    For row = 2 To lastRow
        key = rawWs.Cells(row, COL_CPC_PRIMARY).Value
        If Len(key) >= 4 Then
            key = Left(key, 4)
        ElseIf key = "" Then
            key = "Unknown"
        End If

        If Not cpcClasses.Exists(key) Then
            cpcClasses.Add key, Array(0, 0, 0)
        End If

        Dim counts As Variant
        counts = cpcClasses(key)
        counts(0) = counts(0) + 1
        If rawWs.Cells(row, COL_IS_EXPIRED).Value = "N" Then
            counts(1) = counts(1) + 1
        Else
            counts(2) = counts(2) + 1
        End If
        cpcClasses(key) = counts
    Next row

    ' Create sheet
    Set ws = Worksheets.Add(After:=Worksheets(Worksheets.Count))
    ws.Name = "ByCPC"

    ' Headers
    ws.Range("A1").Value = "PATENTS BY CPC CLASSIFICATION"
    ws.Range("A1").Font.Size = 14
    ws.Range("A1").Font.Bold = True

    ws.Range("A3").Value = "CPC Class"
    ws.Range("B3").Value = "Total"
    ws.Range("C3").Value = "Active"
    ws.Range("D3").Value = "Expired"
    ws.Range("E3").Value = "% Active"

    With ws.Range("A3:E3")
        .Font.Bold = True
        .Interior.Color = RGB(68, 114, 196)
        .Font.Color = RGB(255, 255, 255)
    End With

    ' Data
    outRow = 4
    For Each cpc In cpcClasses.Keys
        counts = cpcClasses(cpc)
        ws.Cells(outRow, 1).Value = cpc
        ws.Cells(outRow, 2).Value = counts(0)
        ws.Cells(outRow, 3).Value = counts(1)
        ws.Cells(outRow, 4).Value = counts(2)
        If counts(0) > 0 Then
            ws.Cells(outRow, 5).Value = Round(counts(1) / counts(0) * 100, 1) & "%"
        End If
        outRow = outRow + 1
    Next cpc

    ' Sort by total descending
    ws.Range("A3:E" & (outRow - 1)).Sort Key1:=ws.Range("B3"), Order1:=xlDescending, Header:=xlYes

    ' Add data bars
    ws.Range("B4:B" & (outRow - 1)).FormatConditions.AddDatabar

    ws.Columns("A:E").AutoFit
End Sub

' =============================================================================
' EXPIRATION TIMELINE SHEET
' =============================================================================

Private Sub GenerateExpirationSheet()
    Dim ws As Worksheet
    Dim rawWs As Worksheet
    Dim lastRow As Long
    Dim row As Long
    Dim timeline As Object
    Dim yearKey As Variant
    Dim yearsRemaining As Double
    Dim expirationYear As Integer
    Dim outRow As Long

    Set rawWs = Worksheets("RawData")
    lastRow = rawWs.Cells(rawWs.Rows.Count, 1).End(xlUp).Row

    ' Count by expiration year
    Set timeline = CreateObject("Scripting.Dictionary")

    For row = 2 To lastRow
        If rawWs.Cells(row, COL_IS_EXPIRED).Value = "N" Then
            yearsRemaining = Val(rawWs.Cells(row, COL_YEARS_REMAINING).Value)
            If yearsRemaining > 0 Then
                expirationYear = Year(Now) + Int(yearsRemaining) + 1
                If expirationYear < 2027 Then expirationYear = 2027 ' Minimum future year

                If Not timeline.Exists(expirationYear) Then
                    timeline.Add expirationYear, 0
                End If
                timeline(expirationYear) = timeline(expirationYear) + 1
            End If
        End If
    Next row

    ' Create sheet
    Set ws = Worksheets.Add(After:=Worksheets(Worksheets.Count))
    ws.Name = "ExpirationTimeline"

    ' Headers
    ws.Range("A1").Value = "PATENT EXPIRATION TIMELINE"
    ws.Range("A1").Font.Size = 14
    ws.Range("A1").Font.Bold = True

    ws.Range("A3").Value = "Year"
    ws.Range("B3").Value = "Patents Expiring"
    ws.Range("C3").Value = "Cumulative Expired"

    With ws.Range("A3:C3")
        .Font.Bold = True
        .Interior.Color = RGB(68, 114, 196)
        .Font.Color = RGB(255, 255, 255)
    End With

    ' Sort years and output
    Dim sortedYears() As Integer
    Dim i As Integer, j As Integer, temp As Integer
    ReDim sortedYears(0 To timeline.Count - 1)

    i = 0
    For Each yearKey In timeline.Keys
        sortedYears(i) = CInt(yearKey)
        i = i + 1
    Next yearKey

    ' Simple bubble sort
    For i = 0 To UBound(sortedYears) - 1
        For j = i + 1 To UBound(sortedYears)
            If sortedYears(i) > sortedYears(j) Then
                temp = sortedYears(i)
                sortedYears(i) = sortedYears(j)
                sortedYears(j) = temp
            End If
        Next j
    Next i

    ' Output
    outRow = 4
    Dim cumulative As Long
    cumulative = 0
    For i = 0 To UBound(sortedYears)
        ws.Cells(outRow, 1).Value = sortedYears(i)
        ws.Cells(outRow, 2).Value = timeline(sortedYears(i))
        cumulative = cumulative + timeline(sortedYears(i))
        ws.Cells(outRow, 3).Value = cumulative
        outRow = outRow + 1
    Next i

    ' Add data bars
    If outRow > 4 Then
        ws.Range("B4:B" & (outRow - 1)).FormatConditions.AddDatabar
    End If

    ws.Columns("A:C").AutoFit
End Sub
