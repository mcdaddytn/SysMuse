'===============================================================================
' Patent Portfolio Analysis - V2 Macros (Simple Weights)
'===============================================================================
' Version: 2.2 (Summary Sheets Generated Internally)
' Description: Simplified macro for V2 scoring with single controllable weights
'              (not multiple stakeholder profiles like V3)
'
' V2 SCORING MODEL:
'   - Single set of adjustable weights
'   - Year multiplier applied multiplicatively: 0.3 + 0.7 * (years/15)^0.8
'   - Simpler than V3 (no stakeholder profiles)
'
' KEY MACROS:
'   - ImportAllData(): Import V2 CSV and generate all worksheets + summaries
'   - RecalculateV2(): Recalculate with adjusted weights, regenerate summaries
'   - GenerateAllSummaries(): Regenerate all 4 summary tabs
'   - GenerateCompetitorSummary(): Create competitor summary only
'
' Worksheet Structure:
'   - RawData: Imported patent metrics (from CSV)
'   - Weights: User-adjustable weights (single profile)
'   - Rankings: Scored and ranked patents
'   - CompetitorSummary: Competitor aggregated stats (generated internally)
'   - AffiliateSummary: Distribution by portfolio company (generated internally)
'   - SectorSummary: Distribution by detailed sector (generated internally)
'   - SuperSectorSummary: Distribution by super-sector (generated internally)
'
' File Convention:
'   - Export: npm run topRated:v2
'   - Copy CSV to same folder as this workbook
'   - Main data: TOPRATED-V2-YYYY-MM-DD.csv
'
' Author: Generated for IP Portfolio Analysis Platform
' Last Updated: 2026-01-21
'===============================================================================

Option Explicit

' Configuration Constants
Private Const WEIGHTS_SHEET As String = "Weights"
Private Const RAW_DATA_SHEET As String = "RawData"
Private Const RANKINGS_SHEET As String = "Rankings"
Private Const COMPETITOR_SHEET As String = "CompetitorSummary"

' V2 CSV Column indices (1-based, matching TOPRATED-V2-*.csv)
' CSV order: rank, patent_id, affiliate, title, grant_date, assignee, years_remaining,
'            year_multiplier, forward_citations, competitor_citations, competitor_count,
'            competitors, sector, sector_name, sector_source, eligibility_score, ...
Private Const COL_RANK As Integer = 1
Private Const COL_PATENT_ID As Integer = 2
Private Const COL_AFFILIATE As Integer = 3
Private Const COL_TITLE As Integer = 4
Private Const COL_GRANT_DATE As Integer = 5
Private Const COL_ASSIGNEE As Integer = 6
Private Const COL_YEARS_REMAINING As Integer = 7
Private Const COL_YEAR_MULTIPLIER As Integer = 8
Private Const COL_FORWARD_CITATIONS As Integer = 9
Private Const COL_COMPETITOR_CITATIONS As Integer = 10
Private Const COL_COMPETITOR_COUNT As Integer = 11
Private Const COL_COMPETITORS As Integer = 12
Private Const COL_SECTOR As Integer = 13
Private Const COL_SECTOR_NAME As Integer = 14
Private Const COL_SECTOR_SOURCE As Integer = 15
Private Const COL_ELIGIBILITY As Integer = 16
Private Const COL_VALIDITY As Integer = 17
Private Const COL_CLAIM_BREADTH As Integer = 18
Private Const COL_ENFORCEMENT As Integer = 19
Private Const COL_DESIGN_AROUND As Integer = 20
Private Const COL_MARKET_RELEVANCE As Integer = 21
Private Const COL_EVIDENCE_ACCESS As Integer = 22
Private Const COL_TREND_ALIGNMENT As Integer = 23
Private Const COL_IPR_RISK As Integer = 24
Private Const COL_PROSECUTION_QUALITY As Integer = 25

'===============================================================================
' PUBLIC ENTRY POINTS
'===============================================================================

Public Sub ImportAllData()
    '
    ' MAIN ENTRY POINT: Import V2 top rated patents CSV
    '
    Dim csvPath As String

    csvPath = FindV2File()

    If csvPath = "" Then
        MsgBox "Could not find TOPRATED-V2 file." & vbCrLf & vbCrLf & _
               "Run this command first:" & vbCrLf & _
               "npm run topRated:v2" & vbCrLf & vbCrLf & _
               "Click OK to select a file manually.", vbExclamation
        csvPath = SelectFile("Select TOPRATED-V2 CSV", "CSV Files,*.csv")
    End If

    If csvPath <> "" Then
        ImportV2FromFile csvPath
    End If
End Sub

Public Sub RecalculateV2()
    '
    ' Recalculates all scores using current weights and re-sorts
    '
    Application.ScreenUpdating = False
    Application.Calculation = xlCalculationManual

    On Error GoTo ErrorHandler

    Dim wsRaw As Worksheet, wsWeights As Worksheet, wsRank As Worksheet
    Set wsRaw = ThisWorkbook.Sheets(RAW_DATA_SHEET)
    Set wsWeights = ThisWorkbook.Sheets(WEIGHTS_SHEET)
    Set wsRank = ThisWorkbook.Sheets(RANKINGS_SHEET)

    Dim lastRow As Long
    lastRow = wsRaw.Cells(wsRaw.Rows.Count, 2).End(xlUp).Row

    If lastRow < 2 Then
        MsgBox "No data in RawData. Run ImportAllData first.", vbExclamation
        GoTo Cleanup
    End If

    ' Load weights
    Dim weights As Object
    Set weights = LoadWeightsV2(wsWeights)

    ' Recalculate scores
    RecalculateRankingsSheet wsRaw, wsRank, weights, lastRow

    ' Regenerate all summary tabs
    GenerateCompetitorSummaryInternal
    GenerateAffiliateSummaryInternal
    GenerateSectorSummaryInternal
    GenerateSuperSectorSummaryInternal

    MsgBox "Recalculated V2 rankings with new weights." & vbCrLf & _
           "All 4 summary tabs regenerated.", vbInformation

Cleanup:
    Application.Calculation = xlCalculationAutomatic
    Application.ScreenUpdating = True
    Exit Sub

ErrorHandler:
    MsgBox "Error during recalculation: " & Err.Description, vbCritical
    Resume Cleanup
End Sub

Public Sub GenerateCompetitorSummary()
    '
    ' Generates competitor summary from Rankings sheet
    '
    Application.ScreenUpdating = False
    Application.Calculation = xlCalculationManual

    On Error GoTo ErrorHandler

    Dim compCount As Long
    compCount = GenerateCompetitorSummaryInternal()

    If compCount >= 0 Then
        MsgBox "CompetitorSummary generated!" & vbCrLf & _
               compCount & " unique competitors found.", vbInformation
    End If

Cleanup:
    Application.Calculation = xlCalculationAutomatic
    Application.ScreenUpdating = True
    Exit Sub

ErrorHandler:
    MsgBox "Error generating summary: " & Err.Description, vbCritical
    Resume Cleanup
End Sub

'===============================================================================
' IMPORT FUNCTIONS
'===============================================================================

Private Function FindV2File() As String
    '
    ' Looks for CSV in same directory as workbook
    '
    Dim basePath As String
    Dim dateStr As String
    Dim tryPath As String
    Dim fso As Object
    Dim folder As Object
    Dim file As Object
    Dim latestFile As String
    Dim latestDate As Date

    If ThisWorkbook.Path <> "" Then
        basePath = ThisWorkbook.Path & "\"
    Else
        basePath = CurDir & "\"
    End If

    dateStr = Format(Date, "yyyy-mm-dd")

    ' Try 1: TOPRATED-V2-YYYY-MM-DD.csv (today's date)
    tryPath = basePath & "TOPRATED-V2-" & dateStr & ".csv"
    If FileExists(tryPath) Then
        FindV2File = tryPath
        Exit Function
    End If

    ' Try 2: TOPRATED-V2-LATEST.csv fallback
    tryPath = basePath & "TOPRATED-V2-LATEST.csv"
    If FileExists(tryPath) Then
        FindV2File = tryPath
        Exit Function
    End If

    ' Try 3: Find most recent TOPRATED-V2-*.csv in same directory
    Set fso = CreateObject("Scripting.FileSystemObject")
    If fso.FolderExists(basePath) Then
        Set folder = fso.GetFolder(basePath)
        For Each file In folder.Files
            If Left(file.Name, 11) = "TOPRATED-V2" And Right(file.Name, 4) = ".csv" Then
                If latestFile = "" Or file.DateLastModified > latestDate Then
                    latestFile = file.Path
                    latestDate = file.DateLastModified
                End If
            End If
        Next
    End If

    FindV2File = latestFile
End Function

Private Function FileExists(ByVal filePath As String) As Boolean
    On Error Resume Next
    FileExists = (Dir(filePath) <> "")
    On Error GoTo 0
End Function

Private Sub ImportV2FromFile(ByVal csvPath As String)
    Application.ScreenUpdating = False
    Application.Calculation = xlCalculationManual

    On Error GoTo ErrorHandler

    ' Clear existing sheets
    ClearAllDataSheets

    ' Import CSV
    Dim wsRaw As Worksheet
    Set wsRaw = GetOrCreateSheet(RAW_DATA_SHEET)
    ImportCSV wsRaw, csvPath

    Dim rowCount As Long
    rowCount = wsRaw.Cells(wsRaw.Rows.Count, 1).End(xlUp).Row

    ' Create weights sheet
    CreateWeightsSheet

    ' Load weights and generate rankings
    Dim wsWeights As Worksheet
    Set wsWeights = ThisWorkbook.Sheets(WEIGHTS_SHEET)

    Dim weights As Object
    Set weights = LoadWeightsV2(wsWeights)

    GenerateRankingsSheet wsRaw, weights, rowCount

    ' Generate all summary tabs (like V3)
    GenerateCompetitorSummaryInternal
    GenerateAffiliateSummaryInternal
    GenerateSectorSummaryInternal
    GenerateSuperSectorSummaryInternal

    MsgBox "Imported " & (rowCount - 1) & " patents from:" & vbCrLf & csvPath & vbCrLf & vbCrLf & _
           "V2 Rankings + 4 summary tabs created." & vbCrLf & _
           "(CompetitorSummary, AffiliateSummary, SectorSummary, SuperSectorSummary)" & vbCrLf & _
           "Adjust weights in Weights sheet, then run RecalculateV2.", vbInformation

    Application.Calculation = xlCalculationAutomatic
    Application.ScreenUpdating = True
    Exit Sub

ErrorHandler:
    Application.Calculation = xlCalculationAutomatic
    Application.ScreenUpdating = True
    MsgBox "Error during import: " & Err.Description, vbCritical
End Sub

Private Sub ImportCSV(ws As Worksheet, csvPath As String)
    ws.Cells.Clear

    With ws.QueryTables.Add(Connection:="TEXT;" & csvPath, Destination:=ws.Range("A1"))
        .TextFileParseType = xlDelimited
        .TextFileCommaDelimiter = True
        .TextFileTextQualifier = xlTextQualifierDoubleQuote
        .TextFileConsecutiveDelimiter = False
        .Refresh BackgroundQuery:=False
        .Delete
    End With

    FormatHeaderRow ws
End Sub

'===============================================================================
' WEIGHTS MANAGEMENT
'===============================================================================

Private Sub CreateWeightsSheet()
    Dim ws As Worksheet
    Set ws = GetOrCreateSheet(WEIGHTS_SHEET)
    ws.Cells.Clear

    ' Title
    ws.Range("A1").Value = "V2 PATENT SCORING WEIGHTS"
    ws.Range("A1").Font.Bold = True
    ws.Range("A1").Font.Size = 16
    ws.Range("A2").Value = "Adjust weights below, then run RecalculateV2 macro."

    ' Metric Weights section
    ws.Range("A4").Value = "METRIC WEIGHTS"
    ws.Range("A4").Font.Bold = True
    ws.Range("A4").Font.Size = 14

    ' Headers
    ws.Range("A6").Value = "Metric"
    ws.Range("B6").Value = "Weight"
    ws.Range("C6").Value = "Description"
    ws.Range("D6").Value = "Normalization"
    FormatHeaderRow ws, 6

    ' Default weights (based on V2 "moderate" profile)
    Dim metrics As Variant
    metrics = Array( _
        Array("competitor_citations", 0.15, "Citations from tracked competitors", "sqrt(x/50)"), _
        Array("competitor_count", 0.05, "Number of competitors citing", "x/10"), _
        Array("forward_citations", 0.10, "Total forward citations", "sqrt(x/500)"), _
        Array("years_remaining", 0.05, "Years until expiration", "(x/15)^1.5"), _
        Array("eligibility_score", 0.15, "Section 101 eligibility (1-5)", "x/5"), _
        Array("validity_score", 0.15, "Prior art strength (1-5)", "x/5"), _
        Array("claim_breadth", 0.10, "Claim scope breadth (1-5)", "x/5"), _
        Array("enforcement_clarity", 0.10, "Infringement detectability (1-5)", "x/5"), _
        Array("market_relevance_score", 0.10, "Market relevance (1-5)", "x/5"), _
        Array("ipr_risk_score", 0.025, "IPR/PTAB risk (5=clean)", "x/5"), _
        Array("prosecution_quality", 0.025, "Prosecution quality (5=clean)", "x/5") _
    )

    Dim i As Integer
    For i = 0 To UBound(metrics)
        ws.Range("A" & (7 + i)).Value = metrics(i)(0)
        ws.Range("B" & (7 + i)).Value = metrics(i)(1)
        ws.Range("C" & (7 + i)).Value = metrics(i)(2)
        ws.Range("D" & (7 + i)).Value = metrics(i)(3)
    Next i

    ' Total row
    Dim totalRow As Integer
    totalRow = 7 + UBound(metrics) + 1
    ws.Range("A" & totalRow).Value = "TOTAL"
    ws.Range("A" & totalRow).Font.Bold = True
    ws.Range("B" & totalRow).Formula = "=SUM(B7:B" & (totalRow - 1) & ")"

    ws.Range("B7:B" & totalRow).NumberFormat = "0.0%"

    ' Year Multiplier info
    ws.Range("A" & (totalRow + 2)).Value = "YEAR MULTIPLIER"
    ws.Range("A" & (totalRow + 2)).Font.Bold = True
    ws.Range("A" & (totalRow + 3)).Value = "Formula: 0.3 + 0.7 * (years/15)^0.8"
    ws.Range("A" & (totalRow + 4)).Value = "Applied multiplicatively to base score"

    ' Preset profiles section
    ws.Range("A" & (totalRow + 6)).Value = "PRESET PROFILES"
    ws.Range("A" & (totalRow + 6)).Font.Bold = True
    ws.Range("A" & (totalRow + 6)).Font.Size = 14

    ws.Range("A" & (totalRow + 7)).Value = "Run these macros to load preset weights:"
    ws.Range("A" & (totalRow + 8)).Value = "  - LoadAggressiveWeights"
    ws.Range("A" & (totalRow + 9)).Value = "  - LoadModerateWeights"
    ws.Range("A" & (totalRow + 10)).Value = "  - LoadConservativeWeights"

    ws.Columns("A:D").AutoFit
End Sub

Private Function LoadWeightsV2(wsWeights As Worksheet) As Object
    Dim weights As Object
    Set weights = CreateObject("Scripting.Dictionary")

    ' Read weights from rows 7-17
    Dim metricNames As Variant
    metricNames = Array("competitor_citations", "competitor_count", "forward_citations", _
                        "years_remaining", "eligibility_score", "validity_score", _
                        "claim_breadth", "enforcement_clarity", "market_relevance_score", _
                        "ipr_risk_score", "prosecution_quality")

    Dim i As Integer
    For i = 0 To UBound(metricNames)
        weights.Add metricNames(i), Val(wsWeights.Cells(7 + i, 2).Value)
    Next i

    Set LoadWeightsV2 = weights
End Function

' Preset profile loaders
Public Sub LoadAggressiveWeights()
    Dim ws As Worksheet
    Set ws = ThisWorkbook.Sheets(WEIGHTS_SHEET)

    ws.Range("B7").Value = 0.25   ' competitor_citations
    ws.Range("B8").Value = 0.1    ' competitor_count
    ws.Range("B9").Value = 0.05   ' forward_citations
    ws.Range("B10").Value = 0.05  ' years_remaining
    ws.Range("B11").Value = 0.15  ' eligibility_score
    ws.Range("B12").Value = 0.1   ' validity_score
    ws.Range("B13").Value = 0.05  ' claim_breadth
    ws.Range("B14").Value = 0.1   ' enforcement_clarity
    ws.Range("B15").Value = 0.1   ' market_relevance_score
    ws.Range("B16").Value = 0.025 ' ipr_risk_score
    ws.Range("B17").Value = 0.025 ' prosecution_quality

    MsgBox "Loaded Aggressive profile weights." & vbCrLf & _
           "Run RecalculateV2 to apply.", vbInformation
End Sub

Public Sub LoadModerateWeights()
    Dim ws As Worksheet
    Set ws = ThisWorkbook.Sheets(WEIGHTS_SHEET)

    ws.Range("B7").Value = 0.15   ' competitor_citations
    ws.Range("B8").Value = 0.05   ' competitor_count
    ws.Range("B9").Value = 0.1    ' forward_citations
    ws.Range("B10").Value = 0.05  ' years_remaining
    ws.Range("B11").Value = 0.15  ' eligibility_score
    ws.Range("B12").Value = 0.15  ' validity_score
    ws.Range("B13").Value = 0.1   ' claim_breadth
    ws.Range("B14").Value = 0.1   ' enforcement_clarity
    ws.Range("B15").Value = 0.1   ' market_relevance_score
    ws.Range("B16").Value = 0.025 ' ipr_risk_score
    ws.Range("B17").Value = 0.025 ' prosecution_quality

    MsgBox "Loaded Moderate profile weights." & vbCrLf & _
           "Run RecalculateV2 to apply.", vbInformation
End Sub

Public Sub LoadConservativeWeights()
    Dim ws As Worksheet
    Set ws = ThisWorkbook.Sheets(WEIGHTS_SHEET)

    ws.Range("B7").Value = 0.1    ' competitor_citations
    ws.Range("B8").Value = 0.05   ' competitor_count
    ws.Range("B9").Value = 0.05   ' forward_citations
    ws.Range("B10").Value = 0.05  ' years_remaining
    ws.Range("B11").Value = 0.2   ' eligibility_score
    ws.Range("B12").Value = 0.2   ' validity_score
    ws.Range("B13").Value = 0.1   ' claim_breadth
    ws.Range("B14").Value = 0.1   ' enforcement_clarity
    ws.Range("B15").Value = 0.05  ' market_relevance_score
    ws.Range("B16").Value = 0.05  ' ipr_risk_score
    ws.Range("B17").Value = 0.05  ' prosecution_quality

    MsgBox "Loaded Conservative profile weights." & vbCrLf & _
           "Run RecalculateV2 to apply.", vbInformation
End Sub

'===============================================================================
' RANKINGS GENERATION
'===============================================================================

Private Sub GenerateRankingsSheet(wsRaw As Worksheet, weights As Object, dataRows As Long)
    Dim wsRank As Worksheet
    Set wsRank = GetOrCreateSheet(RANKINGS_SHEET)
    wsRank.Cells.Clear

    ' Headers
    wsRank.Range("A1").Value = "Rank"
    wsRank.Range("B1").Value = "Patent ID"
    wsRank.Range("C1").Value = "Title"
    wsRank.Range("D1").Value = "Years"
    wsRank.Range("E1").Value = "Comp Cites"
    wsRank.Range("F1").Value = "Comp Count"
    wsRank.Range("G1").Value = "Competitors"
    wsRank.Range("H1").Value = "Sector"
    wsRank.Range("I1").Value = "Score"
    wsRank.Range("J1").Value = "YearMult"
    wsRank.Range("K1").Value = "BaseScore"
    FormatHeaderRow wsRank

    Dim r As Long
    For r = 2 To dataRows
        ' Copy data
        wsRank.Cells(r, 1).Value = r - 1 ' Rank (will update after sort)
        wsRank.Cells(r, 2).Value = wsRaw.Cells(r, COL_PATENT_ID).Value
        wsRank.Cells(r, 3).Value = wsRaw.Cells(r, COL_TITLE).Value
        wsRank.Cells(r, 4).Value = wsRaw.Cells(r, COL_YEARS_REMAINING).Value
        wsRank.Cells(r, 5).Value = wsRaw.Cells(r, COL_COMPETITOR_CITATIONS).Value
        wsRank.Cells(r, 6).Value = wsRaw.Cells(r, COL_COMPETITOR_COUNT).Value
        wsRank.Cells(r, 7).Value = wsRaw.Cells(r, COL_COMPETITORS).Value
        wsRank.Cells(r, 8).Value = wsRaw.Cells(r, COL_SECTOR).Value

        ' Calculate score
        Dim scoreResult As Variant
        scoreResult = CalculateV2Score(wsRaw, r, weights)

        wsRank.Cells(r, 9).Value = scoreResult(0)   ' Final Score
        wsRank.Cells(r, 10).Value = scoreResult(2)  ' Year Mult
        wsRank.Cells(r, 11).Value = scoreResult(1)  ' Base Score
    Next r

    ' Format
    wsRank.Range("I2:K" & dataRows).NumberFormat = "0.0"
    wsRank.Range("D2:D" & dataRows).NumberFormat = "0.0"

    ' Sort by score descending
    SortSheetByScore wsRank, dataRows - 1

    wsRank.Columns("A:K").AutoFit
    wsRank.Range("I1").Interior.Color = RGB(99, 142, 198)
End Sub

Private Sub RecalculateRankingsSheet(wsRaw As Worksheet, wsRank As Worksheet, _
                                      weights As Object, dataRows As Long)
    Dim r As Long
    For r = 2 To dataRows
        ' Find corresponding row by patent ID
        Dim patentId As String
        patentId = wsRank.Cells(r, 2).Value

        Dim srcRow As Long
        srcRow = FindPatentRow(wsRaw, patentId, dataRows)

        If srcRow > 0 Then
            Dim scoreResult As Variant
            scoreResult = CalculateV2Score(wsRaw, srcRow, weights)

            wsRank.Cells(r, 9).Value = scoreResult(0)
            wsRank.Cells(r, 10).Value = scoreResult(2)
            wsRank.Cells(r, 11).Value = scoreResult(1)
        End If
    Next r

    ' Re-sort
    Dim rowCount As Long
    rowCount = wsRank.Cells(wsRank.Rows.Count, 2).End(xlUp).Row - 1
    SortSheetByScore wsRank, rowCount
End Sub

Private Function CalculateV2Score(wsRaw As Worksheet, srcRow As Long, _
                                   weights As Object) As Variant
    Dim result(0 To 2) As Double

    ' Get raw values
    Dim compCites As Double, compCount As Double, fwdCites As Double
    Dim yearsRemaining As Double
    Dim eligibility As Double, validity As Double, breadth As Double
    Dim enforcement As Double, marketRel As Double
    Dim iprRisk As Double, prosQuality As Double

    compCites = Val(wsRaw.Cells(srcRow, COL_COMPETITOR_CITATIONS).Value)
    compCount = Val(wsRaw.Cells(srcRow, COL_COMPETITOR_COUNT).Value)
    fwdCites = Val(wsRaw.Cells(srcRow, COL_FORWARD_CITATIONS).Value)
    yearsRemaining = Val(wsRaw.Cells(srcRow, COL_YEARS_REMAINING).Value)
    eligibility = Val(wsRaw.Cells(srcRow, COL_ELIGIBILITY).Value)
    validity = Val(wsRaw.Cells(srcRow, COL_VALIDITY).Value)
    breadth = Val(wsRaw.Cells(srcRow, COL_CLAIM_BREADTH).Value)
    enforcement = Val(wsRaw.Cells(srcRow, COL_ENFORCEMENT).Value)
    marketRel = Val(wsRaw.Cells(srcRow, COL_MARKET_RELEVANCE).Value)
    iprRisk = Val(wsRaw.Cells(srcRow, COL_IPR_RISK).Value)
    prosQuality = Val(wsRaw.Cells(srcRow, COL_PROSECUTION_QUALITY).Value)

    ' Normalize values
    Dim score As Double
    Dim weightSum As Double

    ' Competitor citations (sqrt normalization)
    If weights("competitor_citations") > 0 Then
        score = score + weights("competitor_citations") * Application.WorksheetFunction.Min(1, Sqr(compCites) / Sqr(50))
        weightSum = weightSum + weights("competitor_citations")
    End If

    ' Competitor count (linear)
    If weights("competitor_count") > 0 Then
        score = score + weights("competitor_count") * Application.WorksheetFunction.Min(1, compCount / 10)
        weightSum = weightSum + weights("competitor_count")
    End If

    ' Forward citations (sqrt)
    If weights("forward_citations") > 0 Then
        score = score + weights("forward_citations") * Application.WorksheetFunction.Min(1, Sqr(fwdCites) / Sqr(500))
        weightSum = weightSum + weights("forward_citations")
    End If

    ' Years remaining (non-linear)
    If weights("years_remaining") > 0 Then
        Dim normYears As Double
        If yearsRemaining >= 15 Then
            normYears = 1
        ElseIf yearsRemaining <= 0 Then
            normYears = 0
        Else
            normYears = (yearsRemaining / 15) ^ 1.5
        End If
        score = score + weights("years_remaining") * normYears
        weightSum = weightSum + weights("years_remaining")
    End If

    ' LLM scores (scale 1-5 to 0-1, default 0.5 if missing)
    If weights("eligibility_score") > 0 And eligibility > 0 Then
        score = score + weights("eligibility_score") * (eligibility / 5)
        weightSum = weightSum + weights("eligibility_score")
    End If

    If weights("validity_score") > 0 And validity > 0 Then
        score = score + weights("validity_score") * (validity / 5)
        weightSum = weightSum + weights("validity_score")
    End If

    If weights("claim_breadth") > 0 And breadth > 0 Then
        score = score + weights("claim_breadth") * (breadth / 5)
        weightSum = weightSum + weights("claim_breadth")
    End If

    If weights("enforcement_clarity") > 0 And enforcement > 0 Then
        score = score + weights("enforcement_clarity") * (enforcement / 5)
        weightSum = weightSum + weights("enforcement_clarity")
    End If

    If weights("market_relevance_score") > 0 And marketRel > 0 Then
        score = score + weights("market_relevance_score") * (marketRel / 5)
        weightSum = weightSum + weights("market_relevance_score")
    End If

    If weights("ipr_risk_score") > 0 And iprRisk > 0 Then
        score = score + weights("ipr_risk_score") * (iprRisk / 5)
        weightSum = weightSum + weights("ipr_risk_score")
    End If

    If weights("prosecution_quality") > 0 And prosQuality > 0 Then
        score = score + weights("prosecution_quality") * (prosQuality / 5)
        weightSum = weightSum + weights("prosecution_quality")
    End If

    ' Normalize by actual weight used
    Dim baseScore As Double
    If weightSum > 0 Then
        baseScore = (score / weightSum) * 100
    Else
        baseScore = 0
    End If

    ' Year multiplier: 0.3 + 0.7 * (years/15)^0.8
    Dim yearMult As Double
    yearMult = 0.3 + 0.7 * Application.WorksheetFunction.Min(1, (Application.WorksheetFunction.Max(0, yearsRemaining) / 15) ^ 0.8)

    result(0) = baseScore * yearMult  ' Final Score
    result(1) = baseScore             ' Base Score
    result(2) = yearMult              ' Year Multiplier

    CalculateV2Score = result
End Function

Private Sub SortSheetByScore(ws As Worksheet, rowCount As Long)
    ws.Sort.SortFields.Clear
    ws.Sort.SortFields.Add2 Key:=ws.Range("I2:I" & (rowCount + 1)), _
        SortOn:=xlSortOnValues, Order:=xlDescending

    With ws.Sort
        .SetRange ws.Range("A1:K" & (rowCount + 1))
        .Header = xlYes
        .Apply
    End With

    ' Update rank numbers
    Dim r As Long
    For r = 2 To rowCount + 1
        ws.Cells(r, 1).Value = r - 1
    Next r
End Sub

Private Function FindPatentRow(ws As Worksheet, patentId As String, maxRow As Long) As Long
    Dim r As Long
    For r = 2 To maxRow
        If CStr(ws.Cells(r, COL_PATENT_ID).Value) = patentId Then
            FindPatentRow = r
            Exit Function
        End If
    Next r
    FindPatentRow = 0
End Function

'===============================================================================
' SUMMARY SHEETS (Calculated Internally from RawData/Rankings)
'===============================================================================

Public Sub GenerateAllSummaries()
    '
    ' Regenerates all four summary tabs (Competitor, Affiliate, Sector, SuperSector)
    ' from the imported data - no external CSV imports needed
    '
    Application.ScreenUpdating = False
    Application.Calculation = xlCalculationManual

    On Error GoTo ErrorHandler

    Dim compCount As Long, affCount As Long, secCount As Long, superCount As Long
    compCount = GenerateCompetitorSummaryInternal()
    affCount = GenerateAffiliateSummaryInternal()
    secCount = GenerateSectorSummaryInternal()
    superCount = GenerateSuperSectorSummaryInternal()

    MsgBox "All summaries generated from imported data:" & vbCrLf & vbCrLf & _
           "CompetitorSummary: " & compCount & " competitors" & vbCrLf & _
           "AffiliateSummary: " & affCount & " affiliates" & vbCrLf & _
           "SectorSummary: " & secCount & " sectors" & vbCrLf & _
           "SuperSectorSummary: " & superCount & " super-sectors", vbInformation

Cleanup:
    Application.Calculation = xlCalculationAutomatic
    Application.ScreenUpdating = True
    Exit Sub

ErrorHandler:
    MsgBox "Error generating summaries: " & Err.Description, vbCritical
    Resume Cleanup
End Sub

'===============================================================================
' COMPETITOR SUMMARY
'===============================================================================

Private Function GenerateCompetitorSummaryInternal() As Long
    GenerateCompetitorSummaryInternal = -1

    Dim wsSrc As Worksheet
    On Error Resume Next
    Set wsSrc = ThisWorkbook.Sheets(RANKINGS_SHEET)
    On Error GoTo 0

    If wsSrc Is Nothing Then Exit Function

    Dim lastRow As Long
    lastRow = wsSrc.Cells(wsSrc.Rows.Count, 2).End(xlUp).Row

    If lastRow < 2 Then Exit Function

    ' Dictionary to track competitor stats
    Dim compStats As Object
    Set compStats = CreateObject("Scripting.Dictionary")

    Dim r As Long, i As Long
    Dim competitors As String
    Dim compArray() As String
    Dim compName As String
    Dim rank As Long
    Dim compCites As Long

    For r = 2 To lastRow
        rank = wsSrc.Cells(r, 1).Value      ' Column A = Rank
        competitors = wsSrc.Cells(r, 7).Value ' Column G = Competitors
        compCites = Val(wsSrc.Cells(r, 5).Value) ' Column E = Comp Cites

        If Len(Trim(competitors)) > 0 Then
            compArray = Split(competitors, ";")
            For i = LBound(compArray) To UBound(compArray)
                compName = Trim(compArray(i))
                If Len(compName) > 0 Then
                    If Not compStats.Exists(compName) Then
                        compStats.Add compName, Array(0, 0, 9999, 0, "", 0)
                    End If

                    Dim stats As Variant
                    stats = compStats(compName)
                    stats(0) = stats(0) + 1
                    stats(1) = stats(1) + rank
                    If rank < stats(2) Then stats(2) = rank
                    If rank > stats(3) Then stats(3) = rank
                    If Len(stats(4)) > 0 Then
                        stats(4) = stats(4) & "," & CStr(rank)
                    Else
                        stats(4) = CStr(rank)
                    End If
                    stats(5) = stats(5) + compCites
                    compStats(compName) = stats
                End If
            Next i
        End If
    Next r

    ' Create summary worksheet
    Dim wsSummary As Worksheet
    Set wsSummary = GetOrCreateSheet(COMPETITOR_SHEET)
    wsSummary.Cells.Clear

    wsSummary.Range("A1").Value = "COMPETITOR SUMMARY - V2 TOP RATED"
    wsSummary.Range("A1").Font.Bold = True
    wsSummary.Range("A1").Font.Size = 16
    wsSummary.Range("A2").Value = "Shows how each competitor is represented in V2 top rated rankings"

    ' Headers
    wsSummary.Range("A4").Value = "Competitor"
    wsSummary.Range("B4").Value = "Patent Count"
    wsSummary.Range("C4").Value = "Avg Rank"
    wsSummary.Range("D4").Value = "Min Rank"
    wsSummary.Range("E4").Value = "Max Rank"
    wsSummary.Range("F4").Value = "Median Rank"
    wsSummary.Range("G4").Value = "Agg Cites"
    wsSummary.Range("H4").Value = "Avg Cites/Entry"
    FormatHeaderRow wsSummary, 4

    ' Sort by count
    Dim compNames() As String
    Dim compCounts() As Long
    Dim n As Long
    ReDim compNames(0 To compStats.Count - 1)
    ReDim compCounts(0 To compStats.Count - 1)

    Dim key As Variant
    n = 0
    For Each key In compStats.Keys
        compNames(n) = key
        stats = compStats(key)
        compCounts(n) = stats(0)
        n = n + 1
    Next key

    ' Bubble sort
    Dim j As Long
    Dim tempName As String
    Dim tempCount As Long
    For i = 0 To n - 2
        For j = i + 1 To n - 1
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

    ' Output data
    Dim outRow As Long
    outRow = 5

    For i = 0 To n - 1
        compName = compNames(i)
        stats = compStats(compName)

        Dim patentCount As Long, sumRank As Long, minRank As Long, maxRank As Long
        Dim ranksStr As String, totalCites As Long

        patentCount = stats(0)
        sumRank = stats(1)
        minRank = stats(2)
        maxRank = stats(3)
        ranksStr = stats(4)
        totalCites = stats(5)

        Dim medianRank As Double
        medianRank = CalculateMedian(ranksStr)

        wsSummary.Cells(outRow, 1).Value = compName
        wsSummary.Cells(outRow, 2).Value = patentCount
        wsSummary.Cells(outRow, 3).Value = Round(sumRank / patentCount, 1)
        wsSummary.Cells(outRow, 4).Value = minRank
        wsSummary.Cells(outRow, 5).Value = maxRank
        wsSummary.Cells(outRow, 6).Value = Round(medianRank, 1)
        wsSummary.Cells(outRow, 7).Value = totalCites
        wsSummary.Cells(outRow, 8).Value = Round(totalCites / patentCount, 1)

        outRow = outRow + 1
    Next i

    ' Format
    wsSummary.Columns("A:H").AutoFit
    wsSummary.Range("C5:F" & (outRow - 1)).NumberFormat = "0.0"
    wsSummary.Range("H5:H" & (outRow - 1)).NumberFormat = "0.0"

    ' Data bar
    Dim rngCount As Range
    Set rngCount = wsSummary.Range("B5:B" & (outRow - 1))
    rngCount.FormatConditions.AddDatabar
    rngCount.FormatConditions(rngCount.FormatConditions.Count).BarColor.Color = RGB(99, 142, 198)

    ' Summary
    outRow = outRow + 2
    wsSummary.Cells(outRow, 1).Value = "Total unique competitors:"
    wsSummary.Cells(outRow, 2).Value = compStats.Count
    wsSummary.Cells(outRow, 1).Font.Bold = True

    GenerateCompetitorSummaryInternal = compStats.Count
End Function

Private Function CalculateMedian(ByVal ranksStr As String) As Double
    If Len(ranksStr) = 0 Then
        CalculateMedian = 0
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
        CalculateMedian = ranks(n \ 2)
    Else
        CalculateMedian = (ranks(n \ 2 - 1) + ranks(n \ 2)) / 2
    End If
End Function

'===============================================================================
' AFFILIATE SUMMARY
'===============================================================================

Private Function GenerateAffiliateSummaryInternal() As Long
    '
    ' Generates AffiliateSummary tab showing portfolio breakdown by affiliate (assignee)
    ' Returns count of affiliates (-1 on error)
    '
    GenerateAffiliateSummaryInternal = -1

    ' Get source data from RawData
    Dim wsSrc As Worksheet
    On Error Resume Next
    Set wsSrc = ThisWorkbook.Sheets(RAW_DATA_SHEET)
    On Error GoTo 0

    If wsSrc Is Nothing Then Exit Function

    Dim lastRow As Long
    lastRow = wsSrc.Cells(wsSrc.Rows.Count, 2).End(xlUp).Row
    If lastRow < 2 Then Exit Function

    ' Dictionary to track affiliate stats
    Dim affiliateStats As Object
    Set affiliateStats = CreateObject("Scripting.Dictionary")

    Dim r As Long
    Dim affiliate As String, sector As String, patentId As String
    Dim years As Double, compCites As Long
    Dim stats As Variant

    For r = 2 To lastRow
        affiliate = Trim(CStr(wsSrc.Cells(r, COL_AFFILIATE).Value))
        If Len(affiliate) = 0 Then affiliate = "Unknown"

        years = Val(wsSrc.Cells(r, COL_YEARS_REMAINING).Value)
        compCites = Val(wsSrc.Cells(r, COL_COMPETITOR_CITATIONS).Value)
        sector = CStr(wsSrc.Cells(r, COL_SECTOR).Value)
        patentId = CStr(wsSrc.Cells(r, COL_PATENT_ID).Value)

        If Not affiliateStats.Exists(affiliate) Then
            ' Structure: count, activeCount, totalYears, totalCites, topPatentId, topPatentCites, sectors(string)
            affiliateStats.Add affiliate, Array(0, 0, 0, 0, "", 0, "")
        End If

        stats = affiliateStats(affiliate)

        stats(0) = stats(0) + 1  ' count
        If years >= 3 Then stats(1) = stats(1) + 1  ' active (3+ years)
        stats(2) = stats(2) + years  ' totalYears
        stats(3) = stats(3) + compCites  ' totalCites

        ' Track top patent
        If compCites > stats(5) Then
            stats(4) = patentId
            stats(5) = compCites
        End If

        ' Track sectors (append if not already there)
        If Len(sector) > 0 And InStr(stats(6), sector) = 0 Then
            If Len(stats(6)) > 0 Then
                stats(6) = stats(6) & "; " & sector
            Else
                stats(6) = sector
            End If
        End If

        affiliateStats(affiliate) = stats
    Next r

    ' Create summary worksheet
    Dim wsSummary As Worksheet
    Set wsSummary = GetOrCreateSheet("AffiliateSummary")
    wsSummary.Cells.Clear

    ' Title
    wsSummary.Range("A1").Value = "AFFILIATE SUMMARY - V2 PORTFOLIO BREAKDOWN"
    wsSummary.Range("A1").Font.Bold = True
    wsSummary.Range("A1").Font.Size = 16
    wsSummary.Range("A2").Value = "Shows patent distribution across portfolio affiliates"

    ' Headers
    wsSummary.Range("A4").Value = "Affiliate"
    wsSummary.Range("B4").Value = "Patent Count"
    wsSummary.Range("C4").Value = "Active (3+ yrs)"
    wsSummary.Range("D4").Value = "Avg Years"
    wsSummary.Range("E4").Value = "Total Comp Cites"
    wsSummary.Range("F4").Value = "Avg Comp Cites"
    wsSummary.Range("G4").Value = "Top Patent"
    wsSummary.Range("H4").Value = "Top Cites"
    wsSummary.Range("I4").Value = "Sectors"
    FormatHeaderRow wsSummary, 4

    ' Sort affiliates by count
    Dim affNames() As String, affCounts() As Long
    Dim n As Long, i As Long, j As Long
    ReDim affNames(0 To affiliateStats.Count - 1)
    ReDim affCounts(0 To affiliateStats.Count - 1)

    Dim key As Variant
    n = 0
    For Each key In affiliateStats.Keys
        affNames(n) = key
        stats = affiliateStats(key)
        affCounts(n) = stats(0)
        n = n + 1
    Next key

    ' Bubble sort descending
    Dim tempName As String, tempCount As Long
    For i = 0 To n - 2
        For j = i + 1 To n - 1
            If affCounts(j) > affCounts(i) Then
                tempName = affNames(i): tempCount = affCounts(i)
                affNames(i) = affNames(j): affCounts(i) = affCounts(j)
                affNames(j) = tempName: affCounts(j) = tempCount
            End If
        Next j
    Next i

    ' Output data
    Dim outRow As Long
    outRow = 5

    For i = 0 To n - 1
        affiliate = affNames(i)
        stats = affiliateStats(affiliate)

        wsSummary.Cells(outRow, 1).Value = affiliate
        wsSummary.Cells(outRow, 2).Value = stats(0)  ' count
        wsSummary.Cells(outRow, 3).Value = stats(1)  ' active
        wsSummary.Cells(outRow, 4).Value = Round(stats(2) / stats(0), 1)  ' avg years
        wsSummary.Cells(outRow, 5).Value = stats(3)  ' total cites
        wsSummary.Cells(outRow, 6).Value = Round(stats(3) / stats(0), 1)  ' avg cites
        wsSummary.Cells(outRow, 7).Value = stats(4)  ' top patent
        wsSummary.Cells(outRow, 8).Value = stats(5)  ' top cites
        wsSummary.Cells(outRow, 9).Value = Left(stats(6), 100)  ' sectors (truncated)

        outRow = outRow + 1
    Next i

    ' Format
    wsSummary.Columns("A:I").AutoFit

    ' Data bar on Patent Count
    Dim rngCount As Range
    Set rngCount = wsSummary.Range("B5:B" & (outRow - 1))
    If rngCount.Rows.Count > 0 Then
        rngCount.FormatConditions.AddDatabar
        rngCount.FormatConditions(rngCount.FormatConditions.Count).BarColor.Color = RGB(86, 156, 214)
    End If

    GenerateAffiliateSummaryInternal = n
End Function

'===============================================================================
' SECTOR SUMMARY
'===============================================================================

Private Function GenerateSectorSummaryInternal() As Long
    '
    ' Generates SectorSummary tab showing portfolio breakdown by sector
    ' Returns count of sectors (-1 on error)
    '
    GenerateSectorSummaryInternal = -1

    ' Declare all variables at top
    Dim wsSrc As Worksheet, wsSummary As Worksheet
    Dim lastRow As Long, r As Long, n As Long, i As Long, j As Long, outRow As Long
    Dim sector As String, competitors As String, affiliate As String, patentId As String
    Dim years As Double, compCites As Long
    Dim sectorStats As Object
    Dim stats As Variant
    Dim compArr() As String
    Dim compDict As Object
    Dim comp As String
    Dim secNames() As String, secCounts() As Long
    Dim key As Variant
    Dim tempName As String, tempCount As Long
    Dim rngCount As Range

    ' Get source data
    On Error Resume Next
    Set wsSrc = ThisWorkbook.Sheets(RAW_DATA_SHEET)
    On Error GoTo 0

    If wsSrc Is Nothing Then Exit Function

    lastRow = wsSrc.Cells(wsSrc.Rows.Count, 2).End(xlUp).Row
    If lastRow < 2 Then Exit Function

    ' Dictionary to track sector stats
    Set sectorStats = CreateObject("Scripting.Dictionary")

    For r = 2 To lastRow
        sector = Trim(CStr(wsSrc.Cells(r, COL_SECTOR).Value))
        If Len(sector) = 0 Then sector = "unassigned"

        years = Val(wsSrc.Cells(r, COL_YEARS_REMAINING).Value)
        compCites = Val(wsSrc.Cells(r, COL_COMPETITOR_CITATIONS).Value)
        competitors = CStr(wsSrc.Cells(r, COL_COMPETITORS).Value)
        affiliate = CStr(wsSrc.Cells(r, COL_AFFILIATE).Value)
        patentId = CStr(wsSrc.Cells(r, COL_PATENT_ID).Value)

        If Not sectorStats.Exists(sector) Then
            ' Structure: count, activeCount, totalYears, totalCites, topPatentId, topPatentCites, competitors(dict), affiliates(string)
            sectorStats.Add sector, Array(0, 0, 0, 0, "", 0, CreateObject("Scripting.Dictionary"), "")
        End If

        stats = sectorStats(sector)

        stats(0) = stats(0) + 1  ' count
        If years >= 3 Then stats(1) = stats(1) + 1  ' active
        stats(2) = stats(2) + years  ' totalYears
        stats(3) = stats(3) + compCites  ' totalCites

        ' Track top patent
        If compCites > stats(5) Then
            stats(4) = patentId
            stats(5) = compCites
        End If

        ' Track unique competitors
        If Len(competitors) > 0 Then
            compArr = Split(competitors, ";")
            Set compDict = stats(6)
            For i = LBound(compArr) To UBound(compArr)
                comp = Trim(compArr(i))
                If Len(comp) > 0 And Not compDict.Exists(comp) Then
                    compDict.Add comp, 1
                End If
            Next i
        End If

        ' Track affiliates
        If Len(affiliate) > 0 And InStr(stats(7), affiliate) = 0 Then
            If Len(stats(7)) > 0 Then
                stats(7) = stats(7) & "; " & affiliate
            Else
                stats(7) = affiliate
            End If
        End If

        sectorStats(sector) = stats
    Next r

    ' Create summary worksheet
    Set wsSummary = GetOrCreateSheet("SectorSummary")
    wsSummary.Cells.Clear

    ' Title
    wsSummary.Range("A1").Value = "SECTOR SUMMARY - V2 TECHNOLOGY BREAKDOWN"
    wsSummary.Range("A1").Font.Bold = True
    wsSummary.Range("A1").Font.Size = 16
    wsSummary.Range("A2").Value = "Shows patent distribution across technology sectors"

    ' Headers
    wsSummary.Range("A4").Value = "Sector"
    wsSummary.Range("B4").Value = "Patent Count"
    wsSummary.Range("C4").Value = "Active (3+ yrs)"
    wsSummary.Range("D4").Value = "Avg Years"
    wsSummary.Range("E4").Value = "Total Comp Cites"
    wsSummary.Range("F4").Value = "Avg Comp Cites"
    wsSummary.Range("G4").Value = "Unique Competitors"
    wsSummary.Range("H4").Value = "Top Patent"
    wsSummary.Range("I4").Value = "Top Cites"
    wsSummary.Range("J4").Value = "Affiliates"
    FormatHeaderRow wsSummary, 4

    ' Sort sectors by count
    ReDim secNames(0 To sectorStats.Count - 1)
    ReDim secCounts(0 To sectorStats.Count - 1)

    n = 0
    For Each key In sectorStats.Keys
        secNames(n) = key
        stats = sectorStats(key)
        secCounts(n) = stats(0)
        n = n + 1
    Next key

    ' Bubble sort descending
    For i = 0 To n - 2
        For j = i + 1 To n - 1
            If secCounts(j) > secCounts(i) Then
                tempName = secNames(i): tempCount = secCounts(i)
                secNames(i) = secNames(j): secCounts(i) = secCounts(j)
                secNames(j) = tempName: secCounts(j) = tempCount
            End If
        Next j
    Next i

    ' Output data
    outRow = 5

    For i = 0 To n - 1
        sector = secNames(i)
        stats = sectorStats(sector)

        Set compDict = stats(6)

        wsSummary.Cells(outRow, 1).Value = sector
        wsSummary.Cells(outRow, 2).Value = stats(0)  ' count
        wsSummary.Cells(outRow, 3).Value = stats(1)  ' active
        wsSummary.Cells(outRow, 4).Value = Round(stats(2) / stats(0), 1)  ' avg years
        wsSummary.Cells(outRow, 5).Value = stats(3)  ' total cites
        wsSummary.Cells(outRow, 6).Value = Round(stats(3) / stats(0), 1)  ' avg cites
        wsSummary.Cells(outRow, 7).Value = compDict.Count  ' unique competitors
        wsSummary.Cells(outRow, 8).Value = stats(4)  ' top patent
        wsSummary.Cells(outRow, 9).Value = stats(5)  ' top cites
        wsSummary.Cells(outRow, 10).Value = Left(stats(7), 80)  ' affiliates (truncated)

        outRow = outRow + 1
    Next i

    ' Format
    wsSummary.Columns("A:J").AutoFit

    ' Data bar on Patent Count
    Set rngCount = wsSummary.Range("B5:B" & (outRow - 1))
    If rngCount.Rows.Count > 0 Then
        rngCount.FormatConditions.AddDatabar
        rngCount.FormatConditions(rngCount.FormatConditions.Count).BarColor.Color = RGB(86, 156, 214)
    End If

    GenerateSectorSummaryInternal = n
End Function

'===============================================================================
' SUPER-SECTOR SUMMARY
'===============================================================================

' Super-sector mapping (sector -> super-sector)
Private Function GetSuperSectorV2(ByVal sector As String) As String
    Dim lowerSector As String
    lowerSector = LCase(sector)

    ' SECURITY
    If InStr(lowerSector, "threat") > 0 Or InStr(lowerSector, "auth") > 0 Or _
       InStr(lowerSector, "crypto") > 0 Or InStr(lowerSector, "security") > 0 Or _
       InStr(lowerSector, "secure") > 0 Or InStr(lowerSector, "protection") > 0 Or _
       InStr(lowerSector, "pii") > 0 Then
        GetSuperSectorV2 = "SECURITY"
    ' SDN/NETWORK
    ElseIf InStr(lowerSector, "network-") > 0 And InStr(lowerSector, "threat") = 0 And _
           InStr(lowerSector, "auth") = 0 And InStr(lowerSector, "crypto") = 0 And _
           InStr(lowerSector, "secure") = 0 Then
        GetSuperSectorV2 = "SDN_NETWORK"
    ' VIDEO
    ElseIf InStr(lowerSector, "video") > 0 Or InStr(lowerSector, "stream") > 0 Then
        GetSuperSectorV2 = "VIDEO_STREAMING"
    ' WIRELESS
    ElseIf InStr(lowerSector, "wireless") > 0 Or InStr(lowerSector, "rf-") > 0 Then
        GetSuperSectorV2 = "WIRELESS"
    ' COMPUTING
    ElseIf InStr(lowerSector, "computing") > 0 And InStr(lowerSector, "security") = 0 And _
           InStr(lowerSector, "protection") = 0 And InStr(lowerSector, "auth") = 0 Then
        GetSuperSectorV2 = "COMPUTING"
    ElseIf InStr(lowerSector, "fintech") > 0 Or InStr(lowerSector, "retrieval") > 0 Or _
           InStr(lowerSector, "data-") > 0 Then
        GetSuperSectorV2 = "COMPUTING"
    ' AI/ML
    ElseIf InStr(lowerSector, "ai-ml") > 0 Then
        GetSuperSectorV2 = "AI_ML"
    ' IMAGING
    ElseIf InStr(lowerSector, "image") > 0 Or InStr(lowerSector, "3d") > 0 Or _
           InStr(lowerSector, "stereo") > 0 Or InStr(lowerSector, "camera") > 0 Then
        GetSuperSectorV2 = "IMAGING"
    ' VIRTUALIZATION
    ElseIf InStr(lowerSector, "virtual") > 0 Or InStr(lowerSector, "vm-") > 0 Or _
           InStr(lowerSector, "cloud") > 0 Then
        GetSuperSectorV2 = "VIRTUALIZATION"
    ' FAULT TOLERANCE
    ElseIf InStr(lowerSector, "fault") > 0 Or InStr(lowerSector, "ft-") > 0 Or _
           InStr(lowerSector, "error") > 0 Then
        GetSuperSectorV2 = "FAULT_TOLERANCE"
    Else
        GetSuperSectorV2 = "OTHER"
    End If
End Function

Private Function GetSuperSectorDisplayNameV2(ByVal superSector As String) As String
    Select Case superSector
        Case "SECURITY": GetSuperSectorDisplayNameV2 = "Security"
        Case "SDN_NETWORK": GetSuperSectorDisplayNameV2 = "SDN & Network Infrastructure"
        Case "VIDEO_STREAMING": GetSuperSectorDisplayNameV2 = "Video & Streaming"
        Case "WIRELESS": GetSuperSectorDisplayNameV2 = "Wireless & RF"
        Case "COMPUTING": GetSuperSectorDisplayNameV2 = "Computing & Data"
        Case "AI_ML": GetSuperSectorDisplayNameV2 = "AI & Machine Learning"
        Case "IMAGING": GetSuperSectorDisplayNameV2 = "Imaging & Optics"
        Case "VIRTUALIZATION": GetSuperSectorDisplayNameV2 = "Virtualization & Cloud"
        Case "FAULT_TOLERANCE": GetSuperSectorDisplayNameV2 = "Fault Tolerance & Reliability"
        Case Else: GetSuperSectorDisplayNameV2 = "Other"
    End Select
End Function

Private Function GetTopItemsV2(ByRef dict As Object, ByVal topN As Integer) As String
    '
    ' Returns top N items from dictionary sorted by value (descending)
    '
    If dict Is Nothing Or dict.Count = 0 Then
        GetTopItemsV2 = ""
        Exit Function
    End If

    ' Copy to arrays for sorting
    Dim keys() As String, vals() As Long
    Dim n As Long, i As Long, j As Long
    n = dict.Count
    ReDim keys(0 To n - 1)
    ReDim vals(0 To n - 1)

    Dim key As Variant
    i = 0
    For Each key In dict.keys
        keys(i) = CStr(key)
        vals(i) = CLng(dict(key))
        i = i + 1
    Next key

    ' Bubble sort descending by value
    Dim tempKey As String, tempVal As Long
    For i = 0 To n - 2
        For j = i + 1 To n - 1
            If vals(j) > vals(i) Then
                tempKey = keys(i): tempVal = vals(i)
                keys(i) = keys(j): vals(i) = vals(j)
                keys(j) = tempKey: vals(j) = tempVal
            End If
        Next j
    Next i

    ' Build result string (top N)
    Dim result As String
    Dim limit As Long
    limit = Application.WorksheetFunction.Min(topN, n)

    For i = 0 To limit - 1
        If i > 0 Then result = result & "; "
        result = result & keys(i)
    Next i

    GetTopItemsV2 = result
End Function

Private Function GenerateSuperSectorSummaryInternal() As Long
    GenerateSuperSectorSummaryInternal = -1

    ' Get source data
    Dim wsSrc As Worksheet
    On Error Resume Next
    Set wsSrc = ThisWorkbook.Sheets(RAW_DATA_SHEET)
    On Error GoTo 0

    If wsSrc Is Nothing Then Exit Function

    Dim lastRow As Long
    lastRow = wsSrc.Cells(wsSrc.Rows.Count, 2).End(xlUp).Row
    If lastRow < 2 Then Exit Function

    ' Dictionary for super-sector stats
    Dim superStats As Object
    Set superStats = CreateObject("Scripting.Dictionary")

    Dim r As Long
    For r = 2 To lastRow
        Dim sector As String
        sector = Trim(CStr(wsSrc.Cells(r, COL_SECTOR).Value))
        If Len(sector) = 0 Then sector = "unassigned"

        Dim superSector As String
        superSector = GetSuperSectorV2(sector)

        Dim years As Double
        years = Val(wsSrc.Cells(r, COL_YEARS_REMAINING).Value)

        Dim compCites As Long
        compCites = Val(wsSrc.Cells(r, COL_COMPETITOR_CITATIONS).Value)

        Dim patentId As String
        patentId = CStr(wsSrc.Cells(r, COL_PATENT_ID).Value)

        If Not superStats.Exists(superSector) Then
            ' count, activeCount, totalCites, sectors(dict), topPatentId, topPatentCites
            superStats.Add superSector, Array(0, 0, 0, CreateObject("Scripting.Dictionary"), "", 0)
        End If

        Dim stats As Variant
        stats = superStats(superSector)

        stats(0) = stats(0) + 1  ' count
        If years >= 3 Then stats(1) = stats(1) + 1  ' active
        stats(2) = stats(2) + compCites  ' totalCites

        ' Track sectors
        Dim secDict As Object
        Set secDict = stats(3)
        If Not secDict.Exists(sector) Then
            secDict.Add sector, 1
        Else
            secDict(sector) = secDict(sector) + 1
        End If

        ' Track top patent
        If compCites > stats(5) Then
            stats(4) = patentId
            stats(5) = compCites
        End If

        superStats(superSector) = stats
    Next r

    ' Create summary worksheet
    Dim wsSummary As Worksheet
    Set wsSummary = GetOrCreateSheet("SuperSectorSummary")
    wsSummary.Cells.Clear

    ' Title
    wsSummary.Range("A1").Value = "SUPER-SECTOR SUMMARY - V2 TECHNOLOGY DOMAINS"
    wsSummary.Range("A1").Font.Bold = True
    wsSummary.Range("A1").Font.Size = 16
    wsSummary.Range("A2").Value = "Shows patent distribution across major technology domains"

    ' Headers
    wsSummary.Range("A4").Value = "Super-Sector"
    wsSummary.Range("B4").Value = "Display Name"
    wsSummary.Range("C4").Value = "Sector Count"
    wsSummary.Range("D4").Value = "Patent Count"
    wsSummary.Range("E4").Value = "Active (3+ yrs)"
    wsSummary.Range("F4").Value = "Total Comp Cites"
    wsSummary.Range("G4").Value = "Avg Comp Cites"
    wsSummary.Range("H4").Value = "Top Sectors"
    wsSummary.Range("I4").Value = "Top Patent"
    wsSummary.Range("J4").Value = "Top Cites"
    FormatHeaderRow wsSummary, 4

    ' Sort by count
    Dim ssNames() As String, ssCounts() As Long
    Dim n As Long, i As Long, j As Long
    ReDim ssNames(0 To superStats.Count - 1)
    ReDim ssCounts(0 To superStats.Count - 1)

    Dim key As Variant
    n = 0
    For Each key In superStats.Keys
        ssNames(n) = key
        stats = superStats(key)
        ssCounts(n) = stats(0)
        n = n + 1
    Next key

    ' Bubble sort descending
    Dim tempName As String, tempCount As Long
    For i = 0 To n - 2
        For j = i + 1 To n - 1
            If ssCounts(j) > ssCounts(i) Then
                tempName = ssNames(i): tempCount = ssCounts(i)
                ssNames(i) = ssNames(j): ssCounts(i) = ssCounts(j)
                ssNames(j) = tempName: ssCounts(j) = tempCount
            End If
        Next j
    Next i

    ' Output data
    Dim outRow As Long
    outRow = 5

    For i = 0 To n - 1
        superSector = ssNames(i)
        stats = superStats(superSector)

        Dim secDict2 As Object
        Set secDict2 = stats(3)

        ' Get top sectors
        Dim topSectors As String
        topSectors = GetTopItemsV2(secDict2, 3)

        wsSummary.Cells(outRow, 1).Value = superSector
        wsSummary.Cells(outRow, 2).Value = GetSuperSectorDisplayNameV2(superSector)
        wsSummary.Cells(outRow, 3).Value = secDict2.Count
        wsSummary.Cells(outRow, 4).Value = stats(0)  ' count
        wsSummary.Cells(outRow, 5).Value = stats(1)  ' active
        wsSummary.Cells(outRow, 6).Value = stats(2)  ' total cites
        wsSummary.Cells(outRow, 7).Value = Round(stats(2) / stats(0), 1)  ' avg cites
        wsSummary.Cells(outRow, 8).Value = topSectors
        wsSummary.Cells(outRow, 9).Value = stats(4)  ' top patent
        wsSummary.Cells(outRow, 10).Value = stats(5)  ' top cites

        outRow = outRow + 1
    Next i

    ' Format
    wsSummary.Columns("A:J").AutoFit

    ' Data bar
    Dim rngCount As Range
    Set rngCount = wsSummary.Range("D5:D" & (outRow - 1))
    If rngCount.Rows.Count > 0 Then
        rngCount.FormatConditions.AddDatabar
        rngCount.FormatConditions(rngCount.FormatConditions.Count).BarColor.Color = RGB(86, 156, 214)
    End If

    GenerateSuperSectorSummaryInternal = n
End Function

'===============================================================================
' UTILITY FUNCTIONS
'===============================================================================

Private Sub ClearAllDataSheets()
    ' Delete all existing worksheets to start fresh
    ' Expects to be run from a blank workbook with just default Sheet1
    Dim ws As Worksheet
    Dim sheetsToDelete As Collection
    Set sheetsToDelete = New Collection

    Application.DisplayAlerts = False

    ' Collect all sheet names first (can't delete while iterating)
    For Each ws In ThisWorkbook.Worksheets
        sheetsToDelete.Add ws.Name
    Next ws

    ' Create RawData sheet first (need at least one sheet)
    Dim wsRaw As Worksheet
    Set wsRaw = ThisWorkbook.Worksheets.Add
    wsRaw.Name = RAW_DATA_SHEET

    ' Now delete all the old sheets
    Dim sheetName As Variant
    For Each sheetName In sheetsToDelete
        On Error Resume Next
        ThisWorkbook.Worksheets(CStr(sheetName)).Delete
        On Error GoTo 0
    Next sheetName

    Application.DisplayAlerts = True
End Sub

Private Function GetOrCreateSheet(ByVal sheetName As String) As Worksheet
    On Error Resume Next
    Set GetOrCreateSheet = ThisWorkbook.Sheets(sheetName)
    On Error GoTo 0

    If GetOrCreateSheet Is Nothing Then
        Set GetOrCreateSheet = ThisWorkbook.Sheets.Add(After:=ThisWorkbook.Sheets(ThisWorkbook.Sheets.Count))
        GetOrCreateSheet.Name = sheetName
    End If
End Function

Private Function SelectFile(ByVal title As String, ByVal filter As String) As String
    ' filter format: "Description,*.ext" e.g. "CSV Files,*.csv"
    Dim fd As FileDialog
    Dim filterParts() As String
    Dim filterDesc As String
    Dim filterExt As String

    ' Parse filter string
    filterParts = Split(filter, ",")
    If UBound(filterParts) >= 1 Then
        filterDesc = Trim(filterParts(0))
        filterExt = Trim(filterParts(1))
    Else
        filterDesc = "All Files"
        filterExt = "*.*"
    End If

    Set fd = Application.FileDialog(msoFileDialogFilePicker)

    With fd
        .title = title
        .Filters.Clear
        .Filters.Add filterDesc, filterExt
        .AllowMultiSelect = False

        If .Show = -1 Then
            SelectFile = .SelectedItems(1)
        Else
            SelectFile = ""
        End If
    End With
End Function

Private Sub FormatHeaderRow(ByVal ws As Worksheet, Optional ByVal headerRow As Integer = 1)
    With ws.Rows(headerRow)
        .Font.Bold = True
        .Interior.Color = RGB(68, 84, 106)
        .Font.Color = RGB(255, 255, 255)
    End With
End Sub

'===============================================================================
' SUMMARY SHEET IMPORTS
'===============================================================================
' These functions import pre-calculated summary CSVs from the output folder
' Run after creating the main Rankings sheet

Public Sub ImportV2SummarySheets()
    ' Import V2 summary CSV files as worksheets
    ' Files expected in same folder as workbook:
    ' - SUMMARY-V2-SUPERSECTOR-*.csv
    ' - SUMMARY-V2-SECTOR-*.csv
    ' - SUMMARY-V2-AFFILIATE-*.csv
    ' - SUMMARY-V2-COMPETITOR-*.csv
    '
    Dim wb As Workbook
    Dim basePath As String
    Dim dateStr As String

    Application.ScreenUpdating = False
    Application.Calculation = xlCalculationManual

    Set wb = ThisWorkbook
    basePath = GetBasePath()
    dateStr = Format(Date, "YYYY-MM-DD")

    ' Import each summary file
    ImportV2SuperSectorSummary wb, basePath, dateStr
    ImportV2SectorSummary wb, basePath, dateStr
    ImportV2AffiliateSummary wb, basePath, dateStr
    ImportV2CompetitorSummaryCSV wb, basePath, dateStr

    ' Activate super-sector summary sheet
    On Error Resume Next
    wb.Worksheets("SuperSectorSummary").Activate
    On Error GoTo 0

    Application.Calculation = xlCalculationAutomatic
    Application.ScreenUpdating = True

    MsgBox "V2 Summary sheets imported successfully!" & vbCrLf & _
           "- SuperSectorSummary: Distribution by super-sector" & vbCrLf & _
           "- SectorSummary: Distribution by detailed sector" & vbCrLf & _
           "- AffiliateSummary: Distribution by portfolio company" & vbCrLf & _
           "- CompetitorSummaryCSV: Top 50 competitors citing patents", vbInformation
End Sub

Private Sub ImportV2SuperSectorSummary(wb As Workbook, basePath As String, dateStr As String)
    Dim ws As Worksheet
    Dim csvPath As String

    ' Try dated file first, then LATEST
    csvPath = basePath & "SUMMARY-V2-SUPERSECTOR-" & dateStr & ".csv"
    If Dir(csvPath) = "" Then
        csvPath = basePath & "SUMMARY-V2-SUPERSECTOR-LATEST.csv"
    End If
    If Dir(csvPath) = "" Then
        Debug.Print "Super-sector summary not found: " & csvPath
        Exit Sub
    End If

    Set ws = GetOrCreateSheet(wb, "SuperSectorSummary")
    ImportCSVToSheetV2 ws, csvPath

    ' Add title
    ws.Rows(1).Insert
    ws.Rows(1).Insert
    ws.Cells(1, 1).Value = "SUPER-SECTOR SUMMARY - V2 TOP RATED"
    ws.Cells(1, 1).Font.Bold = True
    ws.Cells(1, 1).Font.Size = 14
    ws.Cells(2, 1).Value = "Distribution of top 500 patents by super-sector"

    ' Format headers (row 4 after insert)
    FormatHeaderRow ws, 4

    ' Add data bars
    Dim lastRow As Long
    lastRow = ws.Cells(ws.Rows.Count, "A").End(xlUp).Row
    If lastRow > 4 Then
        ws.Range("B5:B" & lastRow).FormatConditions.AddDatabar
        ws.Range("B5:B" & lastRow).FormatConditions(1).BarColor.Color = RGB(99, 142, 198)
    End If

    ws.Columns("A:F").AutoFit
    ws.Range("A5").Select
    ActiveWindow.FreezePanes = True
End Sub

Private Sub ImportV2SectorSummary(wb As Workbook, basePath As String, dateStr As String)
    Dim ws As Worksheet
    Dim csvPath As String

    csvPath = basePath & "SUMMARY-V2-SECTOR-" & dateStr & ".csv"
    If Dir(csvPath) = "" Then
        csvPath = basePath & "SUMMARY-V2-SECTOR-LATEST.csv"
    End If
    If Dir(csvPath) = "" Then
        Debug.Print "Sector summary not found: " & csvPath
        Exit Sub
    End If

    Set ws = GetOrCreateSheet(wb, "SectorSummary")
    ImportCSVToSheetV2 ws, csvPath

    ' Add title
    ws.Rows(1).Insert
    ws.Rows(1).Insert
    ws.Cells(1, 1).Value = "SECTOR SUMMARY - V2 TOP RATED"
    ws.Cells(1, 1).Font.Bold = True
    ws.Cells(1, 1).Font.Size = 14
    ws.Cells(2, 1).Value = "Distribution of top 500 patents by detailed sector"

    FormatHeaderRow ws, 4

    Dim lastRow As Long
    lastRow = ws.Cells(ws.Rows.Count, "A").End(xlUp).Row
    If lastRow > 4 Then
        ws.Range("D5:D" & lastRow).FormatConditions.AddDatabar
        ws.Range("D5:D" & lastRow).FormatConditions(1).BarColor.Color = RGB(99, 142, 198)
    End If

    ws.Columns("A:H").AutoFit
    ws.Range("A5").Select
    ActiveWindow.FreezePanes = True
End Sub

Private Sub ImportV2AffiliateSummary(wb As Workbook, basePath As String, dateStr As String)
    Dim ws As Worksheet
    Dim csvPath As String

    csvPath = basePath & "SUMMARY-V2-AFFILIATE-" & dateStr & ".csv"
    If Dir(csvPath) = "" Then
        csvPath = basePath & "SUMMARY-V2-AFFILIATE-LATEST.csv"
    End If
    If Dir(csvPath) = "" Then
        Debug.Print "Affiliate summary not found: " & csvPath
        Exit Sub
    End If

    Set ws = GetOrCreateSheet(wb, "AffiliateSummary")
    ImportCSVToSheetV2 ws, csvPath

    ' Add title
    ws.Rows(1).Insert
    ws.Rows(1).Insert
    ws.Cells(1, 1).Value = "AFFILIATE SUMMARY - V2 TOP RATED"
    ws.Cells(1, 1).Font.Bold = True
    ws.Cells(1, 1).Font.Size = 14
    ws.Cells(2, 1).Value = "Distribution of top 500 patents by portfolio company"

    FormatHeaderRow ws, 4

    Dim lastRow As Long
    lastRow = ws.Cells(ws.Rows.Count, "A").End(xlUp).Row
    If lastRow > 4 Then
        ws.Range("B5:B" & lastRow).FormatConditions.AddDatabar
        ws.Range("B5:B" & lastRow).FormatConditions(1).BarColor.Color = RGB(99, 142, 198)
    End If

    ws.Columns("A:G").AutoFit
    ws.Range("A5").Select
    ActiveWindow.FreezePanes = True
End Sub

Private Sub ImportV2CompetitorSummaryCSV(wb As Workbook, basePath As String, dateStr As String)
    Dim ws As Worksheet
    Dim csvPath As String

    csvPath = basePath & "SUMMARY-V2-COMPETITOR-" & dateStr & ".csv"
    If Dir(csvPath) = "" Then
        csvPath = basePath & "SUMMARY-V2-COMPETITOR-LATEST.csv"
    End If
    If Dir(csvPath) = "" Then
        Debug.Print "Competitor summary not found: " & csvPath
        Exit Sub
    End If

    Set ws = GetOrCreateSheet(wb, "CompetitorSummaryCSV")
    ImportCSVToSheetV2 ws, csvPath

    ' Add title
    ws.Rows(1).Insert
    ws.Rows(1).Insert
    ws.Cells(1, 1).Value = "COMPETITOR SUMMARY - V2 TOP RATED"
    ws.Cells(1, 1).Font.Bold = True
    ws.Cells(1, 1).Font.Size = 14
    ws.Cells(2, 1).Value = "Top 50 competitors citing patents in the top 500"

    FormatHeaderRow ws, 4

    Dim lastRow As Long
    lastRow = ws.Cells(ws.Rows.Count, "A").End(xlUp).Row
    If lastRow > 4 Then
        ws.Range("B5:B" & lastRow).FormatConditions.AddDatabar
        ws.Range("B5:B" & lastRow).FormatConditions(1).BarColor.Color = RGB(99, 142, 198)
    End If

    ws.Columns("A:D").AutoFit
    ws.Range("A5").Select
    ActiveWindow.FreezePanes = True
End Sub

Private Sub ImportCSVToSheetV2(ws As Worksheet, csvPath As String)
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
End Sub

Private Function GetBasePath() As String
    Dim basePath As String

    If ThisWorkbook.Path <> "" Then
        basePath = ThisWorkbook.Path & "\"
    Else
        basePath = CurDir & "\"
    End If

    GetBasePath = basePath
End Function

Private Function GetOrCreateSheet(wb As Workbook, sheetName As String) As Worksheet
    Dim ws As Worksheet

    On Error Resume Next
    Set ws = wb.Worksheets(sheetName)
    On Error GoTo 0

    If ws Is Nothing Then
        Set ws = wb.Worksheets.Add
        ws.Name = sheetName
    End If

    Set GetOrCreateSheet = ws
End Function
