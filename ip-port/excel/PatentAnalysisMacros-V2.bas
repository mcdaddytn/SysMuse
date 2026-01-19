'===============================================================================
' Patent Portfolio Analysis - V2 Macros (Simple Weights)
'===============================================================================
' Version: 2.0
' Description: Simplified macro for V2 scoring with single controllable weights
'              (not multiple stakeholder profiles like V3)
'
' V2 SCORING MODEL:
'   - Single set of adjustable weights
'   - Year multiplier applied multiplicatively: 0.3 + 0.7 * (years/15)^0.8
'   - Simpler than V3 (no stakeholder profiles)
'
' KEY MACROS:
'   - ImportTop250V2(): Import V2 CSV and generate worksheets
'   - RecalculateV2(): Recalculate with adjusted weights
'   - GenerateCompetitorSummary(): Create competitor summary
'
' Worksheet Structure:
'   - RawData: Imported patent metrics
'   - Weights: User-adjustable weights (single profile)
'   - Rankings: Scored and ranked patents
'   - CompetitorSummary: Competitor aggregated stats
'
' File Convention:
'   - Export: npx tsx scripts/calculate-unified-top250-v2.ts
'   - Copy CSV to same folder as this workbook
'   - Looks for: unified-top250-v2-YYYY-MM-DD.csv or most recent unified-top250-v2-*.csv
'
' Author: Generated for IP Portfolio Analysis Platform
' Last Updated: 2026-01-19
'===============================================================================

Option Explicit

' Configuration Constants
Private Const WEIGHTS_SHEET As String = "Weights"
Private Const RAW_DATA_SHEET As String = "RawData"
Private Const RANKINGS_SHEET As String = "Rankings"
Private Const COMPETITOR_SHEET As String = "CompetitorSummary"

' V2 CSV Column indices (1-based)
Private Const COL_RANK As Integer = 1
Private Const COL_PATENT_ID As Integer = 2
Private Const COL_TITLE As Integer = 3
Private Const COL_GRANT_DATE As Integer = 4
Private Const COL_ASSIGNEE As Integer = 5
Private Const COL_YEARS_REMAINING As Integer = 6
Private Const COL_YEAR_MULTIPLIER As Integer = 7
Private Const COL_FORWARD_CITATIONS As Integer = 8
Private Const COL_COMPETITOR_CITATIONS As Integer = 9
Private Const COL_COMPETITOR_COUNT As Integer = 10
Private Const COL_COMPETITORS As Integer = 11
Private Const COL_SECTOR As Integer = 12
Private Const COL_SECTOR_NAME As Integer = 13
Private Const COL_SECTOR_SOURCE As Integer = 14
Private Const COL_ELIGIBILITY As Integer = 15
Private Const COL_VALIDITY As Integer = 16
Private Const COL_CLAIM_BREADTH As Integer = 17
Private Const COL_ENFORCEMENT As Integer = 18
Private Const COL_DESIGN_AROUND As Integer = 19
Private Const COL_MARKET_RELEVANCE As Integer = 20
Private Const COL_EVIDENCE_ACCESS As Integer = 21
Private Const COL_TREND_ALIGNMENT As Integer = 22
Private Const COL_IPR_RISK As Integer = 23
Private Const COL_PROSECUTION_QUALITY As Integer = 24

'===============================================================================
' PUBLIC ENTRY POINTS
'===============================================================================

Public Sub ImportTop250V2()
    '
    ' MAIN ENTRY POINT: Import V2 Top 250 CSV
    '
    Dim csvPath As String

    csvPath = FindV2File()

    If csvPath = "" Then
        MsgBox "Could not find unified-top250-v2 file." & vbCrLf & vbCrLf & _
               "Run this command first:" & vbCrLf & _
               "npx tsx scripts/calculate-unified-top250-v2.ts" & vbCrLf & vbCrLf & _
               "Click OK to select a file manually.", vbExclamation
        csvPath = SelectFile("Select V2 Top 250 CSV", "CSV Files (*.csv),*.csv")
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
        MsgBox "No data in RawData. Run ImportTop250V2 first.", vbExclamation
        GoTo Cleanup
    End If

    ' Load weights
    Dim weights As Object
    Set weights = LoadWeightsV2(wsWeights)

    ' Recalculate scores
    RecalculateRankingsSheet wsRaw, wsRank, weights, lastRow

    ' Regenerate competitor summary
    GenerateCompetitorSummaryInternal

    MsgBox "Recalculated V2 rankings with new weights.", vbInformation

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

    ' Try 1: unified-top250-v2-YYYY-MM-DD.csv (today's date)
    tryPath = basePath & "unified-top250-v2-" & dateStr & ".csv"
    If FileExists(tryPath) Then
        FindV2File = tryPath
        Exit Function
    End If

    ' Try 2: Find most recent unified-top250-v2-*.csv in same directory
    Set fso = CreateObject("Scripting.FileSystemObject")
    If fso.FolderExists(basePath) Then
        Set folder = fso.GetFolder(basePath)
        For Each file In folder.Files
            If InStr(file.Name, "unified-top250-v2-") > 0 And Right(file.Name, 4) = ".csv" Then
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

    ' Generate competitor summary
    GenerateCompetitorSummaryInternal

    MsgBox "Imported " & (rowCount - 1) & " patents from:" & vbCrLf & csvPath & vbCrLf & vbCrLf & _
           "V2 Rankings + CompetitorSummary created." & vbCrLf & _
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

    wsSummary.Range("A1").Value = "COMPETITOR SUMMARY - V2 TOP 250"
    wsSummary.Range("A1").Font.Bold = True
    wsSummary.Range("A1").Font.Size = 16
    wsSummary.Range("A2").Value = "Shows how each competitor is represented in V2 rankings"

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
' UTILITY FUNCTIONS
'===============================================================================

Private Sub ClearAllDataSheets()
    Dim sheetNames As Variant
    sheetNames = Array(RAW_DATA_SHEET, RANKINGS_SHEET, COMPETITOR_SHEET)

    Dim i As Integer
    For i = 0 To UBound(sheetNames)
        On Error Resume Next
        Dim ws As Worksheet
        Set ws = ThisWorkbook.Sheets(sheetNames(i))
        If Not ws Is Nothing Then
            ws.Cells.Clear
        End If
        Set ws = Nothing
        On Error GoTo 0
    Next i
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
    Dim fd As FileDialog
    Set fd = Application.FileDialog(msoFileDialogFilePicker)

    With fd
        .title = title
        .Filters.Clear
        .Filters.Add "Files", filter
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
