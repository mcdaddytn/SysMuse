'===============================================================================
' Within-Sector Patent Rankings - VBA Macros
'===============================================================================
' Version: 1.0
' Description: Import within-sector rankings and provide adjustable weights
'              for citation, term, and competitor diversity scoring.
'
' SCORING MODEL:
'   Within-Sector Score = (Citation Weight × Citation Score)
'                       + (Term Weight × Term Score)
'                       + (Diversity Weight × Diversity Score)
'
'   Default Weights: Citation=50%, Term=25%, Diversity=25%
'
' COMPONENT SCORES (pre-calculated, normalized 0-50 or 0-25):
'   - Citation Score: min(50, competitor_citations × 0.5)
'   - Term Score: min(25, years_remaining × 2.5)
'   - Diversity Score: min(25, competitor_count × 5)
'
' KEY MACROS:
'   - ImportWithinSector(): Import WITHIN-SECTOR-LATEST.csv
'   - RecalculateWithinSector(): Recalculate with adjusted weights
'   - GenerateSectorCompetitorSummary(): Create competitor summary by sector
'
' Worksheet Structure:
'   - RawData: Imported patent metrics
'   - Weights: User-adjustable weights (3 sliders)
'   - SectorView: Ranked patents by sector with scores
'
' File Convention:
'   - Export: npx tsx scripts/export-within-sector-for-excel.ts
'   - Copy CSV to same folder as this workbook
'   - Looks for: WITHIN-SECTOR-YYYY-MM-DD.csv, WITHIN-SECTOR-LATEST.csv, or most recent
'
' Author: Generated for IP Portfolio Analysis Platform
' Last Updated: 2026-01-19
'===============================================================================

Option Explicit

' Configuration Constants
Private Const WEIGHTS_SHEET As String = "Weights"
Private Const RAW_DATA_SHEET As String = "RawData"
Private Const SECTOR_VIEW_SHEET As String = "SectorView"

'===============================================================================
' MAIN IMPORT FUNCTION
'===============================================================================

Public Sub ImportWithinSector()
    Dim wb As Workbook
    Dim wsRaw As Worksheet
    Dim wsWeights As Worksheet
    Dim wsSector As Worksheet
    Dim csvPath As String
    Dim fso As Object

    Application.ScreenUpdating = False
    Application.Calculation = xlCalculationManual

    Set wb = ThisWorkbook

    ' Find CSV file
    csvPath = FindCSVFile()
    If csvPath = "" Then
        MsgBox "Could not find WITHIN-SECTOR CSV file in excel folder.", vbExclamation
        Exit Sub
    End If

    ' Delete default Sheet1 and any other existing sheets
    DeleteDefaultSheets wb

    ' Create or clear worksheets
    Set wsRaw = GetOrCreateSheet(wb, RAW_DATA_SHEET)
    Set wsWeights = GetOrCreateSheet(wb, WEIGHTS_SHEET)
    Set wsSector = GetOrCreateSheet(wb, SECTOR_VIEW_SHEET)

    ' Import CSV data
    ImportCSV wsRaw, csvPath

    ' Setup weights sheet
    SetupWeightsSheet wsWeights

    ' Generate sector view
    GenerateSectorView wsSector, wsRaw, wsWeights

    ' Activate sector view
    wsSector.Activate

    Application.Calculation = xlCalculationAutomatic
    Application.ScreenUpdating = True

    MsgBox "Import complete!" & vbCrLf & _
           "- Adjust weights in '" & WEIGHTS_SHEET & "' sheet" & vbCrLf & _
           "- Run RecalculateWithinSector() to update rankings", vbInformation
End Sub

'===============================================================================
' SECTOR COMPETITOR SUMMARY
'===============================================================================

Public Sub GenerateSectorCompetitorSummary()
    '
    ' Generates CompetitorBySector worksheet showing:
    ' - Overall competitor summary (patent count, avg/min/median rank, etc.)
    ' - Per-sector competitor breakdown
    '
    Dim wb As Workbook
    Dim wsRaw As Worksheet
    Dim wsSummary As Worksheet

    Application.ScreenUpdating = False
    Application.Calculation = xlCalculationManual

    On Error GoTo ErrorHandler

    Set wb = ThisWorkbook

    On Error Resume Next
    Set wsRaw = wb.Worksheets(RAW_DATA_SHEET)
    On Error GoTo 0

    If wsRaw Is Nothing Then
        MsgBox "RawData sheet not found. Run ImportWithinSector() first.", vbExclamation
        GoTo Cleanup
    End If

    ' Create/clear summary worksheet
    Set wsSummary = GetOrCreateSheet(wb, "CompetitorBySector")

    Dim lastRow As Long
    lastRow = wsRaw.Cells(wsRaw.Rows.Count, "A").End(xlUp).Row

    If lastRow < 2 Then
        MsgBox "No data in RawData. Run ImportWithinSector() first.", vbExclamation
        GoTo Cleanup
    End If

    ' Dictionaries: overall competitor stats and per-sector competitor stats
    Dim overallStats As Object
    Set overallStats = CreateObject("Scripting.Dictionary")

    Dim sectorCompStats As Object ' Dictionary of dictionaries: sector -> comp -> stats
    Set sectorCompStats = CreateObject("Scripting.Dictionary")

    ' Parse data
    Dim r As Long, i As Long
    Dim sector As String, competitors As String, sectorRank As Long, compCites As Long
    Dim compArray() As String, compName As String

    ' CSV columns (1-based): sector(1), sector_rank(2), patent_id(3), title(4), years(5),
    ' competitor_citations(6), competitor_count(7), forward_citations(8), top_competitors(9), ...
    For r = 2 To lastRow
        sector = CStr(wsRaw.Cells(r, 1).Value)
        sectorRank = Val(wsRaw.Cells(r, 2).Value)
        compCites = Val(wsRaw.Cells(r, 6).Value)
        competitors = CStr(wsRaw.Cells(r, 9).Value) ' top_competitors

        If Len(Trim(competitors)) > 0 Then
            compArray = Split(competitors, ";")
            For i = LBound(compArray) To UBound(compArray)
                compName = Trim(compArray(i))
                If Len(compName) > 0 Then
                    ' Update overall stats
                    UpdateCompetitorStats overallStats, compName, sectorRank, compCites

                    ' Update sector-specific stats
                    If Not sectorCompStats.Exists(sector) Then
                        sectorCompStats.Add sector, CreateObject("Scripting.Dictionary")
                    End If
                    UpdateCompetitorStats sectorCompStats(sector), compName, sectorRank, compCites
                End If
            Next i
        End If
    Next r

    ' ==========================================================================
    ' OUTPUT SECTION 1: Overall Competitor Summary
    ' ==========================================================================
    Dim outRow As Long
    outRow = 1

    wsSummary.Cells(outRow, 1).Value = "OVERALL COMPETITOR SUMMARY (Across All Sectors)"
    wsSummary.Cells(outRow, 1).Font.Bold = True
    wsSummary.Cells(outRow, 1).Font.Size = 14
    outRow = outRow + 1

    wsSummary.Cells(outRow, 1).Value = "Shows competitor presence across all sector rankings"
    outRow = outRow + 2

    ' Headers
    wsSummary.Cells(outRow, 1).Value = "Competitor"
    wsSummary.Cells(outRow, 2).Value = "Patent Count"
    wsSummary.Cells(outRow, 3).Value = "Avg Rank"
    wsSummary.Cells(outRow, 4).Value = "Min Rank"
    wsSummary.Cells(outRow, 5).Value = "Max Rank"
    wsSummary.Cells(outRow, 6).Value = "Median Rank"
    wsSummary.Cells(outRow, 7).Value = "Agg Cites"
    wsSummary.Cells(outRow, 8).Value = "Avg Cites/Entry"
    wsSummary.Cells(outRow, 9).Value = "Sectors Present"
    FormatCompetitorHeaderRow wsSummary, outRow
    outRow = outRow + 1

    ' Count sectors per competitor
    Dim sectorCountPerComp As Object
    Set sectorCountPerComp = CreateObject("Scripting.Dictionary")

    Dim sectorKey As Variant, compKey As Variant
    For Each sectorKey In sectorCompStats.Keys
        Dim sectorDict As Object
        Set sectorDict = sectorCompStats(sectorKey)
        For Each compKey In sectorDict.Keys
            If Not sectorCountPerComp.Exists(compKey) Then
                sectorCountPerComp.Add compKey, 0
            End If
            sectorCountPerComp(compKey) = sectorCountPerComp(compKey) + 1
        Next compKey
    Next sectorKey

    ' Output overall stats sorted by patent count
    Dim sortedComps As Variant
    sortedComps = SortCompetitorsByCount(overallStats)

    Dim startDataRow As Long
    startDataRow = outRow

    For i = 0 To UBound(sortedComps)
        compName = sortedComps(i)
        Dim stats As Variant
        stats = overallStats(compName)

        wsSummary.Cells(outRow, 1).Value = compName
        wsSummary.Cells(outRow, 2).Value = stats(0) ' count
        wsSummary.Cells(outRow, 3).Value = Round(stats(1) / stats(0), 1) ' avg rank
        wsSummary.Cells(outRow, 4).Value = stats(2) ' min rank
        wsSummary.Cells(outRow, 5).Value = stats(3) ' max rank
        wsSummary.Cells(outRow, 6).Value = Round(CalculateMedianFromString(stats(4)), 1) ' median
        wsSummary.Cells(outRow, 7).Value = stats(5) ' agg cites
        wsSummary.Cells(outRow, 8).Value = Round(stats(5) / stats(0), 1) ' avg cites/entry
        wsSummary.Cells(outRow, 9).Value = sectorCountPerComp(compName) ' sectors present
        outRow = outRow + 1
    Next i

    ' Format overall section
    wsSummary.Range("C" & startDataRow & ":F" & (outRow - 1)).NumberFormat = "0.0"
    wsSummary.Range("H" & startDataRow & ":H" & (outRow - 1)).NumberFormat = "0.0"

    ' Add data bar to Patent Count column
    Dim rngCount As Range
    Set rngCount = wsSummary.Range("B" & startDataRow & ":B" & (outRow - 1))
    rngCount.FormatConditions.AddDatabar
    rngCount.FormatConditions(rngCount.FormatConditions.Count).BarColor.Color = RGB(99, 142, 198)

    ' Summary totals
    outRow = outRow + 1
    wsSummary.Cells(outRow, 1).Value = "Total unique competitors:"
    wsSummary.Cells(outRow, 2).Value = overallStats.Count
    wsSummary.Cells(outRow, 1).Font.Bold = True
    outRow = outRow + 1
    wsSummary.Cells(outRow, 1).Value = "Total sectors:"
    wsSummary.Cells(outRow, 2).Value = sectorCompStats.Count
    wsSummary.Cells(outRow, 1).Font.Bold = True

    ' ==========================================================================
    ' OUTPUT SECTION 2: Per-Sector Competitor Summary
    ' ==========================================================================
    outRow = outRow + 3

    wsSummary.Cells(outRow, 1).Value = "PER-SECTOR COMPETITOR BREAKDOWN"
    wsSummary.Cells(outRow, 1).Font.Bold = True
    wsSummary.Cells(outRow, 1).Font.Size = 14
    outRow = outRow + 2

    ' Sort sectors alphabetically
    Dim sectorNames() As String
    ReDim sectorNames(0 To sectorCompStats.Count - 1)
    Dim sIdx As Long
    sIdx = 0
    For Each sectorKey In sectorCompStats.Keys
        sectorNames(sIdx) = sectorKey
        sIdx = sIdx + 1
    Next sectorKey

    ' Sort sector names
    Dim tempSector As String
    For i = 0 To UBound(sectorNames) - 1
        For r = i + 1 To UBound(sectorNames)
            If sectorNames(r) < sectorNames(i) Then
                tempSector = sectorNames(i)
                sectorNames(i) = sectorNames(r)
                sectorNames(r) = tempSector
            End If
        Next r
    Next i

    ' Output each sector
    For sIdx = 0 To UBound(sectorNames)
        sector = sectorNames(sIdx)
        Set sectorDict = sectorCompStats(sector)

        wsSummary.Cells(outRow, 1).Value = UCase(sector)
        wsSummary.Cells(outRow, 1).Font.Bold = True
        wsSummary.Cells(outRow, 1).Font.Size = 12
        wsSummary.Cells(outRow, 1).Interior.Color = RGB(220, 230, 241)
        wsSummary.Range(wsSummary.Cells(outRow, 1), wsSummary.Cells(outRow, 7)).Interior.Color = RGB(220, 230, 241)
        outRow = outRow + 1

        ' Headers for this sector
        wsSummary.Cells(outRow, 1).Value = "Competitor"
        wsSummary.Cells(outRow, 2).Value = "Patents"
        wsSummary.Cells(outRow, 3).Value = "Avg Rank"
        wsSummary.Cells(outRow, 4).Value = "Best Rank"
        wsSummary.Cells(outRow, 5).Value = "Agg Cites"
        wsSummary.Cells(outRow, 6).Value = "Avg Cites"
        FormatCompetitorHeaderRow wsSummary, outRow
        outRow = outRow + 1

        ' Sort by count for this sector
        Dim sectorSorted As Variant
        sectorSorted = SortCompetitorsByCount(sectorDict)

        startDataRow = outRow
        For i = 0 To Application.WorksheetFunction.Min(9, UBound(sectorSorted)) ' Top 10 per sector
            compName = sectorSorted(i)
            stats = sectorDict(compName)

            wsSummary.Cells(outRow, 1).Value = compName
            wsSummary.Cells(outRow, 2).Value = stats(0)
            wsSummary.Cells(outRow, 3).Value = Round(stats(1) / stats(0), 1)
            wsSummary.Cells(outRow, 4).Value = stats(2)
            wsSummary.Cells(outRow, 5).Value = stats(5)
            wsSummary.Cells(outRow, 6).Value = Round(stats(5) / stats(0), 1)
            outRow = outRow + 1
        Next i

        wsSummary.Range("C" & startDataRow & ":C" & (outRow - 1)).NumberFormat = "0.0"
        wsSummary.Range("F" & startDataRow & ":F" & (outRow - 1)).NumberFormat = "0.0"

        outRow = outRow + 1 ' Space between sectors
    Next sIdx

    ' Auto-fit columns
    wsSummary.Columns("A:I").AutoFit

    wsSummary.Activate

    MsgBox "CompetitorBySector summary generated!" & vbCrLf & _
           overallStats.Count & " unique competitors across " & _
           sectorCompStats.Count & " sectors.", vbInformation

Cleanup:
    Application.Calculation = xlCalculationAutomatic
    Application.ScreenUpdating = True
    Exit Sub

ErrorHandler:
    MsgBox "Error generating sector competitor summary: " & Err.Description, vbCritical
    Resume Cleanup
End Sub

Private Sub UpdateCompetitorStats(ByRef statsDict As Object, ByVal compName As String, _
                                   ByVal rank As Long, ByVal cites As Long)
    ' Update competitor statistics in dictionary
    ' Stats array: (0)count, (1)sumRank, (2)minRank, (3)maxRank, (4)ranksStr, (5)totalCites
    If Not statsDict.Exists(compName) Then
        statsDict.Add compName, Array(0, 0, 9999, 0, "", 0)
    End If

    Dim stats As Variant
    stats = statsDict(compName)
    stats(0) = stats(0) + 1
    stats(1) = stats(1) + rank
    If rank < stats(2) Then stats(2) = rank
    If rank > stats(3) Then stats(3) = rank
    If Len(stats(4)) > 0 Then
        stats(4) = stats(4) & "," & CStr(rank)
    Else
        stats(4) = CStr(rank)
    End If
    stats(5) = stats(5) + cites
    statsDict(compName) = stats
End Sub

Private Function SortCompetitorsByCount(ByRef statsDict As Object) As Variant
    ' Return array of competitor names sorted by count descending
    Dim compNames() As String
    Dim compCounts() As Long
    ReDim compNames(0 To statsDict.Count - 1)
    ReDim compCounts(0 To statsDict.Count - 1)

    Dim i As Long, j As Long
    Dim key As Variant
    i = 0
    For Each key In statsDict.Keys
        compNames(i) = key
        Dim stats As Variant
        stats = statsDict(key)
        compCounts(i) = stats(0)
        i = i + 1
    Next key

    ' Bubble sort
    Dim tempName As String, tempCount As Long
    For i = 0 To UBound(compNames) - 1
        For j = i + 1 To UBound(compNames)
            If compCounts(j) > compCounts(i) Then
                tempName = compNames(i)
                tempCount = compCounts(i)
                compNames(i) = compNames(j)
                compCounts(i) = compCounts(j)
                compNames(j) = tempName
                compCounts(j) = tempCount
            End If
        Next j
    Next i

    SortCompetitorsByCount = compNames
End Function

Private Function CalculateMedianFromString(ByVal ranksStr As String) As Double
    If Len(ranksStr) = 0 Then
        CalculateMedianFromString = 0
        Exit Function
    End If

    Dim rankArray() As String
    rankArray = Split(ranksStr, ",")

    Dim n As Long
    n = UBound(rankArray) + 1

    Dim ranks() As Long
    ReDim ranks(0 To n - 1)

    Dim i As Long
    For i = 0 To n - 1
        ranks(i) = CLng(rankArray(i))
    Next i

    ' Sort
    Dim j As Long, temp As Long
    For i = 0 To n - 2
        For j = i + 1 To n - 1
            If ranks(j) < ranks(i) Then
                temp = ranks(i)
                ranks(i) = ranks(j)
                ranks(j) = temp
            End If
        Next j
    Next i

    If n Mod 2 = 1 Then
        CalculateMedianFromString = ranks(n \ 2)
    Else
        CalculateMedianFromString = (ranks(n \ 2 - 1) + ranks(n \ 2)) / 2
    End If
End Function

Private Sub FormatCompetitorHeaderRow(ByVal ws As Worksheet, ByVal headerRow As Integer)
    With ws.Rows(headerRow)
        .Font.Bold = True
        .Interior.Color = RGB(68, 84, 106)
        .Font.Color = RGB(255, 255, 255)
    End With
End Sub

'===============================================================================
' RECALCULATE FUNCTION
'===============================================================================

Public Sub RecalculateWithinSector()
    Dim wb As Workbook
    Dim wsRaw As Worksheet
    Dim wsWeights As Worksheet
    Dim wsSector As Worksheet

    Application.ScreenUpdating = False
    Application.Calculation = xlCalculationManual

    Set wb = ThisWorkbook

    On Error Resume Next
    Set wsRaw = wb.Worksheets(RAW_DATA_SHEET)
    Set wsWeights = wb.Worksheets(WEIGHTS_SHEET)
    Set wsSector = wb.Worksheets(SECTOR_VIEW_SHEET)
    On Error GoTo 0

    If wsRaw Is Nothing Or wsWeights Is Nothing Or wsSector Is Nothing Then
        MsgBox "Missing required worksheets. Run ImportWithinSector() first.", vbExclamation
        Exit Sub
    End If

    ' Regenerate sector view with new weights
    GenerateSectorView wsSector, wsRaw, wsWeights

    wsSector.Activate

    Application.Calculation = xlCalculationAutomatic
    Application.ScreenUpdating = True

    MsgBox "Rankings recalculated with new weights!", vbInformation
End Sub

'===============================================================================
' HELPER FUNCTIONS
'===============================================================================

Private Function FindCSVFile() As String
    '
    ' Looks for CSV in same directory as workbook
    '
    Dim basePath As String
    Dim tryPath As String
    Dim fso As Object
    Dim folder As Object
    Dim file As Object
    Dim latestFile As String
    Dim latestDate As Date

    Set fso = CreateObject("Scripting.FileSystemObject")

    If ThisWorkbook.Path <> "" Then
        basePath = ThisWorkbook.Path & "\"
    Else
        basePath = CurDir & "\"
    End If

    ' Try 1: WITHIN-SECTOR-YYYY-MM-DD.csv (today's date)
    tryPath = basePath & "WITHIN-SECTOR-" & Format(Date, "yyyy-mm-dd") & ".csv"
    If fso.FileExists(tryPath) Then
        FindCSVFile = tryPath
        Exit Function
    End If

    ' Try 2: WITHIN-SECTOR-LATEST.csv fallback
    tryPath = basePath & "WITHIN-SECTOR-LATEST.csv"
    If fso.FileExists(tryPath) Then
        FindCSVFile = tryPath
        Exit Function
    End If

    ' Try 3: Find most recent WITHIN-SECTOR-*.csv in same directory
    If fso.FolderExists(basePath) Then
        Set folder = fso.GetFolder(basePath)
        For Each file In folder.Files
            If Left(file.Name, 14) = "WITHIN-SECTOR-" And Right(file.Name, 4) = ".csv" Then
                If latestFile = "" Or file.DateLastModified > latestDate Then
                    latestFile = file.Path
                    latestDate = file.DateLastModified
                End If
            End If
        Next
    End If

    FindCSVFile = latestFile
End Function

Private Sub DeleteDefaultSheets(wb As Workbook)
    ' Delete all existing worksheets (like default Sheet1) to start fresh
    Dim ws As Worksheet
    Dim sheetsToDelete As Collection
    Set sheetsToDelete = New Collection

    Application.DisplayAlerts = False

    ' Collect all sheet names first (can't delete while iterating)
    For Each ws In wb.Worksheets
        sheetsToDelete.Add ws.Name
    Next ws

    ' Create a temporary sheet first (need at least one sheet)
    Dim wsTemp As Worksheet
    Set wsTemp = wb.Worksheets.Add
    wsTemp.Name = "TempSetup"

    ' Now delete all the old sheets
    Dim sheetName As Variant
    For Each sheetName In sheetsToDelete
        On Error Resume Next
        wb.Worksheets(CStr(sheetName)).Delete
        On Error GoTo 0
    Next sheetName

    Application.DisplayAlerts = True
End Sub

Private Function GetOrCreateSheet(wb As Workbook, sheetName As String) As Worksheet
    Dim ws As Worksheet

    On Error Resume Next
    Set ws = wb.Worksheets(sheetName)
    On Error GoTo 0

    If ws Is Nothing Then
        Set ws = wb.Worksheets.Add(After:=wb.Worksheets(wb.Worksheets.Count))
        ws.Name = sheetName

        ' Delete TempSetup sheet if it exists (created during cleanup)
        Application.DisplayAlerts = False
        On Error Resume Next
        wb.Worksheets("TempSetup").Delete
        On Error GoTo 0
        Application.DisplayAlerts = True
    Else
        ws.Cells.Clear
    End If

    Set GetOrCreateSheet = ws
End Function

Private Sub ImportCSV(ws As Worksheet, csvPath As String)
    Dim qt As QueryTable

    ' Clear existing data
    ws.Cells.Clear

    ' Import CSV
    Set qt = ws.QueryTables.Add( _
        Connection:="TEXT;" & csvPath, _
        Destination:=ws.Range("A1"))

    With qt
        .TextFileParseType = xlDelimited
        .TextFileCommaDelimiter = True
        .TextFileTextQualifier = xlTextQualifierDoubleQuote
        .Refresh BackgroundQuery:=False
        .Delete
    End With

    ' Auto-fit columns
    ws.Columns("A:M").AutoFit
End Sub

Private Sub SetupWeightsSheet(ws As Worksheet)
    ' Clear and setup
    ws.Cells.Clear

    ' Title
    ws.Range("A1").Value = "WITHIN-SECTOR SCORING WEIGHTS"
    ws.Range("A1").Font.Bold = True
    ws.Range("A1").Font.Size = 14

    ' Headers
    ws.Range("A3").Value = "Component"
    ws.Range("B3").Value = "Weight"
    ws.Range("C3").Value = "Description"
    ws.Range("A3:C3").Font.Bold = True

    ' Weight rows
    ws.Range("A4").Value = "Citation Score"
    ws.Range("B4").Value = 0.5
    ws.Range("C4").Value = "Weight for competitor citations (higher = more infringement evidence)"

    ws.Range("A5").Value = "Term Score"
    ws.Range("B5").Value = 0.25
    ws.Range("C5").Value = "Weight for remaining patent term (higher = longer licensing runway)"

    ws.Range("A6").Value = "Diversity Score"
    ws.Range("B6").Value = 0.25
    ws.Range("C6").Value = "Weight for competitor diversity (higher = more potential targets)"

    ' Total row
    ws.Range("A8").Value = "Total"
    ws.Range("B8").Formula = "=SUM(B4:B6)"
    ws.Range("A8:B8").Font.Bold = True

    ' Validation note
    ws.Range("A10").Value = "Note: Weights should sum to 1.0"
    ws.Range("A10").Font.Italic = True

    ' Instructions
    ws.Range("A12").Value = "INSTRUCTIONS"
    ws.Range("A12").Font.Bold = True
    ws.Range("A13").Value = "1. Adjust weights in column B (should sum to 1.0)"
    ws.Range("A14").Value = "2. Run macro: RecalculateWithinSector()"
    ws.Range("A15").Value = "3. View updated rankings in SectorView sheet"

    ' Format
    ws.Range("B4:B6").NumberFormat = "0.00"
    ws.Range("B8").NumberFormat = "0.00"
    ws.Columns("A:C").AutoFit

    ' Name the weight cells for easy reference
    ws.Names.Add Name:="WeightCitation", RefersTo:=ws.Range("B4")
    ws.Names.Add Name:="WeightTerm", RefersTo:=ws.Range("B5")
    ws.Names.Add Name:="WeightDiversity", RefersTo:=ws.Range("B6")
End Sub

Private Sub GenerateSectorView(wsSector As Worksheet, wsRaw As Worksheet, wsWeights As Worksheet)
    Dim lastRow As Long
    Dim i As Long, j As Long
    Dim currentSector As String
    Dim sectorStartRow As Long
    Dim outputRow As Long
    Dim wCitation As Double, wTerm As Double, wDiversity As Double
    Dim citationScore As Double, termScore As Double, diversityScore As Double
    Dim totalScore As Double
    Dim data As Variant
    Dim results() As Variant
    Dim resultCount As Long

    ' Get weights
    wCitation = wsWeights.Range("B4").Value
    wTerm = wsWeights.Range("B5").Value
    wDiversity = wsWeights.Range("B6").Value

    ' Normalize if needed
    Dim totalWeight As Double
    totalWeight = wCitation + wTerm + wDiversity
    If totalWeight <> 1 And totalWeight > 0 Then
        wCitation = wCitation / totalWeight
        wTerm = wTerm / totalWeight
        wDiversity = wDiversity / totalWeight
    End If

    ' Clear sector view
    wsSector.Cells.Clear

    ' Find last row of data
    lastRow = wsRaw.Cells(wsRaw.Rows.Count, "A").End(xlUp).Row
    If lastRow < 2 Then Exit Sub

    ' Load data into array for speed
    data = wsRaw.Range("A1:M" & lastRow).Value

    ' Process and recalculate scores
    ReDim results(1 To lastRow, 1 To 14)
    resultCount = 0

    For i = 2 To UBound(data, 1)
        ' Get component scores from columns K, L, M (11, 12, 13)
        citationScore = Val(data(i, 11))  ' citation_score
        termScore = Val(data(i, 12))       ' term_score
        diversityScore = Val(data(i, 13))  ' diversity_score

        ' Calculate weighted total
        totalScore = (wCitation * citationScore * 2) + _
                     (wTerm * termScore * 4) + _
                     (wDiversity * diversityScore * 4)

        resultCount = resultCount + 1
        results(resultCount, 1) = data(i, 1)   ' sector
        results(resultCount, 2) = data(i, 3)   ' patent_id
        results(resultCount, 3) = data(i, 4)   ' title
        results(resultCount, 4) = data(i, 5)   ' years_remaining
        results(resultCount, 5) = data(i, 6)   ' competitor_citations
        results(resultCount, 6) = data(i, 7)   ' competitor_count
        results(resultCount, 7) = data(i, 8)   ' forward_citations
        results(resultCount, 8) = data(i, 9)   ' top_competitors
        results(resultCount, 9) = Round(totalScore, 1)  ' weighted_score
        results(resultCount, 10) = citationScore
        results(resultCount, 11) = termScore
        results(resultCount, 12) = diversityScore
    Next i

    ' Output headers
    wsSector.Range("A1").Value = "WITHIN-SECTOR RANKINGS"
    wsSector.Range("A1").Font.Bold = True
    wsSector.Range("A1").Font.Size = 14

    wsSector.Range("A2").Value = "Weights: Citation=" & Format(wCitation, "0%") & _
                                 ", Term=" & Format(wTerm, "0%") & _
                                 ", Diversity=" & Format(wDiversity, "0%")

    ' Column headers
    wsSector.Range("A4").Value = "Sector"
    wsSector.Range("B4").Value = "Rank"
    wsSector.Range("C4").Value = "Patent ID"
    wsSector.Range("D4").Value = "Title"
    wsSector.Range("E4").Value = "Years"
    wsSector.Range("F4").Value = "Comp Cites"
    wsSector.Range("G4").Value = "Comp Count"
    wsSector.Range("H4").Value = "Fwd Cites"
    wsSector.Range("I4").Value = "Top Competitors"
    wsSector.Range("J4").Value = "Score"
    wsSector.Range("K4").Value = "Cit Score"
    wsSector.Range("L4").Value = "Term Score"
    wsSector.Range("M4").Value = "Div Score"
    wsSector.Range("A4:M4").Font.Bold = True

    ' Sort results by sector then by score descending
    ' Simple bubble sort for sector grouping (VBA limitation)
    Dim temp As Variant
    Dim sorted As Boolean

    Do
        sorted = True
        For i = 1 To resultCount - 1
            ' Sort by sector first, then by score descending
            If results(i, 1) > results(i + 1, 1) Or _
               (results(i, 1) = results(i + 1, 1) And results(i, 9) < results(i + 1, 9)) Then
                ' Swap
                For j = 1 To 12
                    temp = results(i, j)
                    results(i, j) = results(i + 1, j)
                    results(i + 1, j) = temp
                Next j
                sorted = False
            End If
        Next i
    Loop Until sorted

    ' Output with sector ranks
    outputRow = 5
    currentSector = ""
    Dim sectorRank As Long

    For i = 1 To resultCount
        If results(i, 1) <> currentSector Then
            currentSector = results(i, 1)
            sectorRank = 0
        End If

        sectorRank = sectorRank + 1

        wsSector.Cells(outputRow, 1).Value = results(i, 1)
        wsSector.Cells(outputRow, 2).Value = sectorRank
        wsSector.Cells(outputRow, 3).Value = results(i, 2)
        wsSector.Cells(outputRow, 4).Value = results(i, 3)
        wsSector.Cells(outputRow, 5).Value = results(i, 4)
        wsSector.Cells(outputRow, 6).Value = results(i, 5)
        wsSector.Cells(outputRow, 7).Value = results(i, 6)
        wsSector.Cells(outputRow, 8).Value = results(i, 7)
        wsSector.Cells(outputRow, 9).Value = results(i, 8)
        wsSector.Cells(outputRow, 10).Value = results(i, 9)
        wsSector.Cells(outputRow, 11).Value = results(i, 10)
        wsSector.Cells(outputRow, 12).Value = results(i, 11)
        wsSector.Cells(outputRow, 13).Value = results(i, 12)

        outputRow = outputRow + 1
    Next i

    ' Format
    wsSector.Columns("A:M").AutoFit
    wsSector.Range("E5:E" & outputRow).NumberFormat = "0.0"
    wsSector.Range("J5:M" & outputRow).NumberFormat = "0.0"

    ' Add alternating sector colors
    Dim colorToggle As Boolean
    currentSector = ""
    colorToggle = False

    For i = 5 To outputRow - 1
        If wsSector.Cells(i, 1).Value <> currentSector Then
            currentSector = wsSector.Cells(i, 1).Value
            colorToggle = Not colorToggle
        End If

        If colorToggle Then
            wsSector.Range("A" & i & ":M" & i).Interior.Color = RGB(240, 240, 240)
        End If
    Next i

    ' Freeze panes
    wsSector.Range("A5").Select
    ActiveWindow.FreezePanes = True
End Sub
