'===============================================================================
' Patent Portfolio Analysis - VBA Macros (V3)
'===============================================================================
' Version: 3.2 (V3 Stakeholder Voting Profiles - Macro-based Calculation)
' Description: Macros for importing patent data, generating scoring worksheets,
'              and managing user weight profiles for dynamic patent scoring.
'
' V3 STAKEHOLDER PROFILES (6 profiles):
'   1. IP Litigator (Aggressive) - Plaintiff-side, contingency focus
'   2. IP Litigator (Balanced) - Mixed portfolio approach
'   3. IP Litigator (Conservative) - Defense-side, risk-averse
'   4. Licensing Specialist - Portfolio value, market signals
'   5. Corporate/M&A - Strategic alignment, deal signals
'   6. Executive/Portfolio - Balanced C-suite view
'
' SCORING MODEL:
'   - Weighted sum of 10 normalized metrics
'   - Year multiplier applied to final score: 0.3 + 0.7 * (years/15)^0.8
'   - Consensus = weighted average of all 6 profile scores
'
' KEY MACROS:
'   - ImportAllData(): Import today's CSV and generate all worksheets
'   - RecalculateAll(): Recalculate all scores with current weights and re-sort
'   - GenerateAllSummaries(): Regenerate all summary tabs
'
' Worksheet Structure:
'   - RawData: Imported patent metrics (from CSV)
'   - UserWeights: 6 stakeholder profiles with adjustable weights
'   - Score_IPLit_Aggr, Score_IPLit_Bal, Score_IPLit_Cons: IP Litigator views
'   - Score_Licensing, Score_Corporate, Score_Executive: Other stakeholder views
'   - Score_Consensus: Combined view with all profiles
'   - CompetitorSummary, AffiliateSummary, SectorSummary, SuperSectorSummary
'
' Usage:
'   1. Run ImportAllData() - auto-finds today's TOPRATED-YYYY-MM-DD.csv
'   2. Modify weights in UserWeights sheet
'   3. Run RecalculateAll() to update scores and re-sort
'
' File Convention:
'   - Export: npx tsx scripts/calculate-and-export-v3.ts
'   - Copy CSV to same folder as this workbook
'   - Looks for: TOPRATED-YYYY-MM-DD.csv, TOPRATED-LATEST.csv, or most recent TOPRATED-*.csv
'
' Author: Generated for IP Portfolio Analysis Platform
' Last Updated: 2026-01-20 (V3.2 - removed hardcoded counts)
'===============================================================================

Option Explicit

' Configuration Constants
Private Const WEIGHTS_SHEET As String = "UserWeights"
Private Const RAW_DATA_SHEET As String = "RawData"

' File naming convention (matches TypeScript export: TOPRATED-YYYY-MM-DD.csv)
Private Const FILE_PREFIX As String = "TOPRATED-"
Private Const FILE_LATEST As String = "TOPRATED-LATEST.csv"

' V3 CSV Column indices (1-based, matching CSV import)
Private Const COL_RANK As Integer = 1
Private Const COL_PATENT_ID As Integer = 2
Private Const COL_TITLE As Integer = 3
Private Const COL_GRANT_DATE As Integer = 4
Private Const COL_ASSIGNEE As Integer = 5
Private Const COL_YEARS_REMAINING As Integer = 6
Private Const COL_FORWARD_CITATIONS As Integer = 7
Private Const COL_COMPETITOR_CITATIONS As Integer = 8
Private Const COL_COMPETITOR_COUNT As Integer = 9
Private Const COL_COMPETITORS As Integer = 10
Private Const COL_SECTOR As Integer = 11
Private Const COL_SECTOR_NAME As Integer = 12
' LLM scores (1-5 scale)
Private Const COL_ELIGIBILITY As Integer = 13
Private Const COL_VALIDITY As Integer = 14
Private Const COL_CLAIM_BREADTH As Integer = 15
Private Const COL_ENFORCEMENT As Integer = 16
Private Const COL_DESIGN_AROUND As Integer = 17
Private Const COL_MARKET_RELEVANCE As Integer = 18
Private Const COL_IPR_RISK As Integer = 19
Private Const COL_PROSECUTION_QUALITY As Integer = 20

' Weight row indices in UserWeights (1-based)
Private Const WEIGHT_ROW_COMP_CITES As Integer = 7
Private Const WEIGHT_ROW_COMP_COUNT As Integer = 8
Private Const WEIGHT_ROW_FWD_CITES As Integer = 9
Private Const WEIGHT_ROW_ELIGIBILITY As Integer = 10
Private Const WEIGHT_ROW_VALIDITY As Integer = 11
Private Const WEIGHT_ROW_BREADTH As Integer = 12
Private Const WEIGHT_ROW_ENFORCEMENT As Integer = 13
Private Const WEIGHT_ROW_DESIGN As Integer = 14
Private Const WEIGHT_ROW_IPR As Integer = 15
Private Const WEIGHT_ROW_PROSECUTION As Integer = 16

' Profile weight columns in UserWeights (1-based)
Private Const WEIGHT_COL_AGGRESSIVE As Integer = 2
Private Const WEIGHT_COL_BALANCED As Integer = 3
Private Const WEIGHT_COL_CONSERVATIVE As Integer = 4
Private Const WEIGHT_COL_LICENSING As Integer = 5
Private Const WEIGHT_COL_CORPORATE As Integer = 6
Private Const WEIGHT_COL_EXECUTIVE As Integer = 7

' Profile relative weight rows
Private Const REL_WEIGHT_ROW_AGGRESSIVE As Integer = 27
Private Const REL_WEIGHT_ROW_BALANCED As Integer = 28
Private Const REL_WEIGHT_ROW_CONSERVATIVE As Integer = 29
Private Const REL_WEIGHT_ROW_LICENSING As Integer = 30
Private Const REL_WEIGHT_ROW_CORPORATE As Integer = 31
Private Const REL_WEIGHT_ROW_EXECUTIVE As Integer = 32

'===============================================================================
' PUBLIC ENTRY POINTS
'===============================================================================

Public Sub ImportAllData()
    '
    ' MAIN ENTRY POINT: Import today's top rated patents CSV for Excel analysis
    ' Looks for TOPRATED-YYYY-MM-DD.csv in the same directory as this workbook.
    '
    Dim csvPath As String
    Dim dateStr As String

    dateStr = Format(Date, "yyyy-mm-dd")
    csvPath = FindTopRatedFile(dateStr)

    If csvPath = "" Then
        MsgBox "Could not find TOPRATED file for today (" & dateStr & ")." & vbCrLf & vbCrLf & _
               "Run this command first:" & vbCrLf & _
               "npx tsx scripts/calculate-and-export-v3.ts" & vbCrLf & vbCrLf & _
               "Click OK to select a file manually.", vbExclamation
        csvPath = SelectFile("Select Top Rated CSV", "CSV Files (*.csv),*.csv")
    End If

    If csvPath <> "" Then
        ImportDataFromFile csvPath
    End If
End Sub

Public Sub RecalculateAll()
    '
    ' Recalculates all scores using current weights and re-sorts all sheets
    '
    Application.ScreenUpdating = False
    Application.Calculation = xlCalculationManual

    On Error GoTo ErrorHandler

    Dim dataRows As Long
    dataRows = GetRowCount(RAW_DATA_SHEET)

    If dataRows < 2 Then
        MsgBox "No data in RawData sheet. Run ImportAllData first.", vbExclamation
        GoTo Cleanup
    End If

    ' Load weights
    Dim weights As Object
    Set weights = LoadWeights()

    ' Recalculate each profile sheet
    RecalculateProfileSheet "Score_IPLit_Aggr", WEIGHT_COL_AGGRESSIVE, weights, dataRows
    RecalculateProfileSheet "Score_IPLit_Bal", WEIGHT_COL_BALANCED, weights, dataRows
    RecalculateProfileSheet "Score_IPLit_Cons", WEIGHT_COL_CONSERVATIVE, weights, dataRows
    RecalculateProfileSheet "Score_Licensing", WEIGHT_COL_LICENSING, weights, dataRows
    RecalculateProfileSheet "Score_Corporate", WEIGHT_COL_CORPORATE, weights, dataRows
    RecalculateProfileSheet "Score_Executive", WEIGHT_COL_EXECUTIVE, weights, dataRows

    ' Recalculate consensus sheet
    RecalculateConsensusSheet weights, dataRows

    MsgBox "Recalculated and re-sorted all scoring worksheets.", vbInformation

Cleanup:
    Application.Calculation = xlCalculationAutomatic
    Application.ScreenUpdating = True
    Exit Sub

ErrorHandler:
    MsgBox "Error during recalculation: " & Err.Description, vbCritical
    Resume Cleanup
End Sub

'===============================================================================
' IMPORT FUNCTIONS
'===============================================================================

Private Function FindTopRatedFile(ByVal dateStr As String) As String
    '
    ' Looks for TOPRATED CSV in same directory as workbook
    '
    Dim basePath As String
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

    ' Try 1: TOPRATED-YYYY-MM-DD.csv (today's date)
    tryPath = basePath & FILE_PREFIX & dateStr & ".csv"
    If FileExists(tryPath) Then
        FindTopRatedFile = tryPath
        Exit Function
    End If

    ' Try 2: TOPRATED-LATEST.csv fallback
    tryPath = basePath & FILE_LATEST
    If FileExists(tryPath) Then
        FindTopRatedFile = tryPath
        Exit Function
    End If

    ' Try 3: Find most recent TOPRATED-*.csv in same directory
    Set fso = CreateObject("Scripting.FileSystemObject")
    If fso.FolderExists(basePath) Then
        Set folder = fso.GetFolder(basePath)
        For Each file In folder.Files
            If Left(file.Name, 9) = "TOPRATED-" And Right(file.Name, 4) = ".csv" Then
                If latestFile = "" Or file.DateLastModified > latestDate Then
                    latestFile = file.Path
                    latestDate = file.DateLastModified
                End If
            End If
        Next
    End If

    FindTopRatedFile = latestFile
End Function

Private Function FileExists(ByVal filePath As String) As Boolean
    On Error Resume Next
    FileExists = (Dir(filePath) <> "")
    On Error GoTo 0
End Function

Private Sub ImportDataFromFile(ByVal csvPath As String)
    Application.ScreenUpdating = False
    Application.Calculation = xlCalculationManual

    On Error GoTo ErrorHandler

    ClearAllDataSheets
    ImportCSVToSheet csvPath, RAW_DATA_SHEET

    Dim rowCount As Long
    rowCount = GetRowCount(RAW_DATA_SHEET)

    CreateUserWeightsSheet

    ' Load weights and generate all sheets
    Dim weights As Object
    Set weights = LoadWeights()

    GenerateAllScoringWorksheets weights, rowCount - 1  ' All data rows (minus header)

    ' Generate all summary tabs
    GenerateCompetitorSummaryInternal
    GenerateAffiliateSummaryInternal
    GenerateSectorSummaryInternal
    GenerateSuperSectorSummaryInternal

    MsgBox "Imported " & (rowCount - 1) & " patents from:" & vbCrLf & csvPath & vbCrLf & vbCrLf & _
           "6 stakeholder profiles + 4 summary tabs created." & vbCrLf & _
           "(CompetitorSummary, AffiliateSummary, SectorSummary, SuperSectorSummary)" & vbCrLf & _
           "Adjust weights in UserWeights, then run RecalculateAll.", vbInformation

    Application.Calculation = xlCalculationAutomatic
    Application.ScreenUpdating = True
    Exit Sub

ErrorHandler:
    Application.Calculation = xlCalculationAutomatic
    Application.ScreenUpdating = True
    MsgBox "Error during import: " & Err.Description, vbCritical
End Sub

Private Sub ImportCSVToSheet(ByVal filePath As String, ByVal sheetName As String)
    Dim ws As Worksheet
    Set ws = GetOrCreateSheet(sheetName)
    ws.Cells.Clear

    With ws.QueryTables.Add(Connection:="TEXT;" & filePath, Destination:=ws.Range("A1"))
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

Private Function LoadWeights() As Object
    ' Returns a dictionary-like object with all weights
    Dim ws As Worksheet
    Set ws = ThisWorkbook.Sheets(WEIGHTS_SHEET)

    Dim weights As Object
    Set weights = CreateObject("Scripting.Dictionary")

    ' Metric weights for each profile (array index 0-9 for 10 metrics)
    Dim profileCols As Variant
    profileCols = Array(WEIGHT_COL_AGGRESSIVE, WEIGHT_COL_BALANCED, WEIGHT_COL_CONSERVATIVE, _
                        WEIGHT_COL_LICENSING, WEIGHT_COL_CORPORATE, WEIGHT_COL_EXECUTIVE)

    Dim profileNames As Variant
    profileNames = Array("Aggressive", "Balanced", "Conservative", "Licensing", "Corporate", "Executive")

    Dim i As Integer, j As Integer
    For i = 0 To 5
        Dim metricWeights(0 To 9) As Double
        For j = 0 To 9
            metricWeights(j) = Val(ws.Cells(WEIGHT_ROW_COMP_CITES + j, profileCols(i)).Value)
        Next j
        weights.Add profileNames(i), metricWeights
    Next i

    ' Relative weights for consensus
    Dim relWeights(0 To 5) As Double
    relWeights(0) = Val(ws.Cells(REL_WEIGHT_ROW_AGGRESSIVE, 2).Value)
    relWeights(1) = Val(ws.Cells(REL_WEIGHT_ROW_BALANCED, 2).Value)
    relWeights(2) = Val(ws.Cells(REL_WEIGHT_ROW_CONSERVATIVE, 2).Value)
    relWeights(3) = Val(ws.Cells(REL_WEIGHT_ROW_LICENSING, 2).Value)
    relWeights(4) = Val(ws.Cells(REL_WEIGHT_ROW_CORPORATE, 2).Value)
    relWeights(5) = Val(ws.Cells(REL_WEIGHT_ROW_EXECUTIVE, 2).Value)
    weights.Add "RelativeWeights", relWeights

    Set LoadWeights = weights
End Function

Private Sub CreateUserWeightsSheet()
    Dim ws As Worksheet
    Set ws = GetOrCreateSheet(WEIGHTS_SHEET)
    ws.Cells.Clear

    ' Header
    ws.Range("A1").Value = "V3 STAKEHOLDER VOTING PROFILES"
    ws.Range("A1").Font.Bold = True
    ws.Range("A1").Font.Size = 16
    ws.Range("A2").Value = "Adjust weights below, then run RecalculateAll macro."

    ' Metric Weights section
    ws.Range("A4").Value = "METRIC WEIGHTS"
    ws.Range("A4").Font.Bold = True
    ws.Range("A4").Font.Size = 14

    ' Headers (row 6)
    ws.Range("A6").Value = "Metric"
    ws.Range("B6").Value = "IP Lit (Aggr)"
    ws.Range("C6").Value = "IP Lit (Bal)"
    ws.Range("D6").Value = "IP Lit (Cons)"
    ws.Range("E6").Value = "Licensing"
    ws.Range("F6").Value = "Corp/M&A"
    ws.Range("G6").Value = "Executive"
    ws.Range("H6").Value = "Description"

    ' Metric weights (rows 7-16)
    Dim metrics As Variant
    metrics = Array( _
        Array("competitor_citations", 0.2, 0.22, 0.15, 0.18, 0.2, 0.22, "Citations from tracked competitors"), _
        Array("competitor_count", 0.08, 0.06, 0.08, 0.12, 0.08, 0.08, "Number of competitors citing"), _
        Array("forward_citations", 0.05, 0.04, 0.08, 0.1, 0.1, 0.08, "Total forward citations"), _
        Array("eligibility_score", 0.12, 0.1, 0.12, 0.1, 0.08, 0.1, "Section 101 eligibility (1-5)"), _
        Array("validity_score", 0.12, 0.1, 0.14, 0.1, 0.1, 0.1, "Prior art strength (1-5)"), _
        Array("claim_breadth", 0.06, 0.08, 0.08, 0.12, 0.12, 0.1, "Claim scope breadth (1-5)"), _
        Array("enforcement_clarity", 0.14, 0.12, 0.1, 0.08, 0.08, 0.1, "Infringement detectability (1-5)"), _
        Array("design_around_difficulty", 0.1, 0.1, 0.08, 0.1, 0.12, 0.1, "Design-around difficulty (1-5)"), _
        Array("ipr_risk_score", 0.06, 0.1, 0.1, 0.05, 0.06, 0.06, "IPR/PTAB risk (5=clean)"), _
        Array("prosecution_quality", 0.07, 0.08, 0.07, 0.05, 0.06, 0.06, "Prosecution quality (5=clean)") _
    )

    Dim i As Integer
    For i = 0 To UBound(metrics)
        ws.Range("A" & (7 + i)).Value = metrics(i)(0)
        ws.Range("B" & (7 + i)).Value = metrics(i)(1)
        ws.Range("C" & (7 + i)).Value = metrics(i)(2)
        ws.Range("D" & (7 + i)).Value = metrics(i)(3)
        ws.Range("E" & (7 + i)).Value = metrics(i)(4)
        ws.Range("F" & (7 + i)).Value = metrics(i)(5)
        ws.Range("G" & (7 + i)).Value = metrics(i)(6)
        ws.Range("H" & (7 + i)).Value = metrics(i)(7)
    Next i

    ' Total row
    ws.Range("A17").Value = "TOTAL"
    ws.Range("A17").Font.Bold = True
    ws.Range("B17").Formula = "=SUM(B7:B16)"
    ws.Range("C17").Formula = "=SUM(C7:C16)"
    ws.Range("D17").Formula = "=SUM(D7:D16)"
    ws.Range("E17").Formula = "=SUM(E7:E16)"
    ws.Range("F17").Formula = "=SUM(F7:F16)"
    ws.Range("G17").Formula = "=SUM(G7:G16)"

    ws.Range("B7:G17").NumberFormat = "0%"

    ' Year Multiplier info
    ws.Range("A19").Value = "YEAR MULTIPLIER"
    ws.Range("A19").Font.Bold = True
    ws.Range("A20").Value = "Formula: 0.3 + 0.7 * (years/15)^0.8"
    ws.Range("A21").Value = "Applied multiplicatively to base score"

    ' Profile Relative Weights
    ws.Range("A24").Value = "PROFILE WEIGHTS (for Consensus)"
    ws.Range("A24").Font.Bold = True
    ws.Range("A24").Font.Size = 14

    ws.Range("A26").Value = "Profile"
    ws.Range("B26").Value = "Weight"
    ws.Range("C26").Value = "Stakeholder"

    ws.Range("A27").Value = "IP Litigator (Aggressive)"
    ws.Range("B27").Value = 0.167
    ws.Range("C27").Value = "Plaintiff-side, contingency"

    ws.Range("A28").Value = "IP Litigator (Balanced)"
    ws.Range("B28").Value = 0.167
    ws.Range("C28").Value = "Mixed portfolio"

    ws.Range("A29").Value = "IP Litigator (Conservative)"
    ws.Range("B29").Value = 0.167
    ws.Range("C29").Value = "Defense-side, risk-averse"

    ws.Range("A30").Value = "Licensing Specialist"
    ws.Range("B30").Value = 0.167
    ws.Range("C30").Value = "Portfolio value"

    ws.Range("A31").Value = "Corporate/M&A"
    ws.Range("B31").Value = 0.166
    ws.Range("C31").Value = "Strategic alignment"

    ws.Range("A32").Value = "Executive/Portfolio"
    ws.Range("B32").Value = 0.166
    ws.Range("C32").Value = "C-Suite view"

    ws.Range("A33").Value = "TOTAL"
    ws.Range("A33").Font.Bold = True
    ws.Range("B33").Formula = "=SUM(B27:B32)"

    ws.Range("B27:B33").NumberFormat = "0.0%"

    ' Formatting
    FormatHeaderRow ws, 6
    FormatHeaderRow ws, 26
    ws.Columns("A:H").AutoFit

    ' Color coding
    ws.Range("B6").Interior.Color = RGB(255, 99, 71)
    ws.Range("C6").Interior.Color = RGB(255, 165, 0)
    ws.Range("D6").Interior.Color = RGB(100, 149, 237)
    ws.Range("E6").Interior.Color = RGB(144, 238, 144)
    ws.Range("F6").Interior.Color = RGB(221, 160, 221)
    ws.Range("G6").Interior.Color = RGB(135, 206, 235)
End Sub

'===============================================================================
' SCORING CALCULATION (Macro-based, not formulas)
'===============================================================================

Private Function CalculateScore(ByVal rawWs As Worksheet, ByVal srcRow As Long, _
                                 ByRef metricWeights() As Double) As Variant
    ' Returns array: (FinalScore, BaseScore, YearMult)
    Dim result(0 To 2) As Double

    ' Get raw values
    Dim compCites As Double, compCount As Double, fwdCites As Double
    Dim eligibility As Double, validity As Double, breadth As Double
    Dim enforcement As Double, designAround As Double, iprRisk As Double, prosQuality As Double
    Dim yearsRemaining As Double

    yearsRemaining = Val(rawWs.Cells(srcRow, COL_YEARS_REMAINING).Value)
    compCites = Val(rawWs.Cells(srcRow, COL_COMPETITOR_CITATIONS).Value)
    compCount = Val(rawWs.Cells(srcRow, COL_COMPETITOR_COUNT).Value)
    fwdCites = Val(rawWs.Cells(srcRow, COL_FORWARD_CITATIONS).Value)
    eligibility = Val(rawWs.Cells(srcRow, COL_ELIGIBILITY).Value)
    validity = Val(rawWs.Cells(srcRow, COL_VALIDITY).Value)
    breadth = Val(rawWs.Cells(srcRow, COL_CLAIM_BREADTH).Value)
    enforcement = Val(rawWs.Cells(srcRow, COL_ENFORCEMENT).Value)
    designAround = Val(rawWs.Cells(srcRow, COL_DESIGN_AROUND).Value)
    iprRisk = Val(rawWs.Cells(srcRow, COL_IPR_RISK).Value)
    prosQuality = Val(rawWs.Cells(srcRow, COL_PROSECUTION_QUALITY).Value)

    ' Normalize values (0-1 scale)
    Dim normCompCites As Double, normCompCount As Double, normFwdCites As Double
    Dim normElig As Double, normValid As Double, normBreadth As Double
    Dim normEnforce As Double, normDesign As Double, normIPR As Double, normPros As Double

    normCompCites = Application.WorksheetFunction.Min(1, compCites / 30)
    normCompCount = Application.WorksheetFunction.Min(1, compCount / 10)
    normFwdCites = Application.WorksheetFunction.Min(1, Sqr(fwdCites) / 20)

    ' LLM scores: default to 0.6 (3/5) if missing
    normElig = IIf(eligibility = 0, 0.6, eligibility / 5)
    normValid = IIf(validity = 0, 0.6, validity / 5)
    normBreadth = IIf(breadth = 0, 0.6, breadth / 5)
    normEnforce = IIf(enforcement = 0, 0.6, enforcement / 5)
    normDesign = IIf(designAround = 0, 0.6, designAround / 5)
    normIPR = IIf(iprRisk = 0, 0.8, iprRisk / 5)  ' Default higher for IPR
    normPros = IIf(prosQuality = 0, 0.6, prosQuality / 5)

    ' Calculate base score (weighted sum)
    Dim baseScore As Double
    baseScore = normCompCites * metricWeights(0) + _
                normCompCount * metricWeights(1) + _
                normFwdCites * metricWeights(2) + _
                normElig * metricWeights(3) + _
                normValid * metricWeights(4) + _
                normBreadth * metricWeights(5) + _
                normEnforce * metricWeights(6) + _
                normDesign * metricWeights(7) + _
                normIPR * metricWeights(8) + _
                normPros * metricWeights(9)

    ' Year multiplier: 0.3 + 0.7 * MIN(1, (years/15)^0.8)
    Dim yearMult As Double
    yearMult = 0.3 + 0.7 * Application.WorksheetFunction.Min(1, (Application.WorksheetFunction.Max(0, yearsRemaining) / 15) ^ 0.8)

    ' Final score
    result(0) = baseScore * yearMult  ' Final Score
    result(1) = baseScore             ' Base Score
    result(2) = yearMult              ' Year Multiplier

    CalculateScore = result
End Function

Private Sub GenerateAllScoringWorksheets(ByRef weights As Object, ByVal topN As Integer)
    Dim dataRows As Long
    dataRows = GetRowCount(RAW_DATA_SHEET)

    If dataRows < 2 Then Exit Sub

    ' Generate individual profile sheets
    GenerateProfileSheet "Score_IPLit_Aggr", "Aggressive", RGB(255, 99, 71), weights, topN, dataRows
    GenerateProfileSheet "Score_IPLit_Bal", "Balanced", RGB(255, 165, 0), weights, topN, dataRows
    GenerateProfileSheet "Score_IPLit_Cons", "Conservative", RGB(100, 149, 237), weights, topN, dataRows
    GenerateProfileSheet "Score_Licensing", "Licensing", RGB(144, 238, 144), weights, topN, dataRows
    GenerateProfileSheet "Score_Corporate", "Corporate", RGB(221, 160, 221), weights, topN, dataRows
    GenerateProfileSheet "Score_Executive", "Executive", RGB(135, 206, 235), weights, topN, dataRows

    ' Generate consensus sheet
    GenerateConsensusSheet weights, topN, dataRows
End Sub

Private Sub GenerateProfileSheet(ByVal sheetName As String, ByVal profileName As String, _
                                  ByVal profileColor As Long, ByRef weights As Object, _
                                  ByVal topN As Integer, ByVal dataRows As Long)
    Dim ws As Worksheet
    Set ws = GetOrCreateSheet(sheetName)
    ws.Cells.Clear

    ' Headers
    ws.Range("A1").Value = "Rank"
    ws.Range("B1").Value = "Patent ID"
    ws.Range("C1").Value = "Title"
    ws.Range("D1").Value = "Years"
    ws.Range("E1").Value = "Comp Cites"
    ws.Range("F1").Value = "Competitors"
    ws.Range("G1").Value = "Sector"
    ws.Range("H1").Value = "Score"
    ws.Range("I1").Value = "YearMult"
    ws.Range("J1").Value = "BaseScore"

    Dim rowsToGenerate As Long
    rowsToGenerate = Application.WorksheetFunction.Min(topN, dataRows - 1)

    Dim rawWs As Worksheet
    Set rawWs = ThisWorkbook.Sheets(RAW_DATA_SHEET)

    ' Get weights for this profile
    Dim metricWeights() As Double
    metricWeights = weights(profileName)

    ' Calculate scores and populate
    Dim r As Long
    For r = 2 To rowsToGenerate + 1
        Dim srcRow As Long
        srcRow = r

        ' Copy data
        ws.Cells(r, 1).Value = r - 1  ' Rank (will update after sort)
        ws.Cells(r, 2).Value = rawWs.Cells(srcRow, COL_PATENT_ID).Value
        ws.Cells(r, 3).Value = rawWs.Cells(srcRow, COL_TITLE).Value
        ws.Cells(r, 4).Value = rawWs.Cells(srcRow, COL_YEARS_REMAINING).Value
        ws.Cells(r, 5).Value = rawWs.Cells(srcRow, COL_COMPETITOR_CITATIONS).Value
        ws.Cells(r, 6).Value = rawWs.Cells(srcRow, COL_COMPETITORS).Value
        ws.Cells(r, 7).Value = rawWs.Cells(srcRow, COL_SECTOR).Value

        ' Calculate score
        Dim scoreResult As Variant
        scoreResult = CalculateScore(rawWs, srcRow, metricWeights)

        ws.Cells(r, 8).Value = scoreResult(0)  ' Final Score
        ws.Cells(r, 9).Value = scoreResult(2)  ' Year Mult
        ws.Cells(r, 10).Value = scoreResult(1) ' Base Score
    Next r

    ' Format
    ws.Range("H2:H" & (rowsToGenerate + 1)).NumberFormat = "0.00%"
    ws.Range("I2:I" & (rowsToGenerate + 1)).NumberFormat = "0.00"
    ws.Range("J2:J" & (rowsToGenerate + 1)).NumberFormat = "0.00%"

    ' Sort by score descending
    SortSheetByScore ws, rowsToGenerate

    FormatHeaderRow ws
    ws.Range("H1").Interior.Color = profileColor
    ws.Columns("A:J").AutoFit
End Sub

Private Sub GenerateConsensusSheet(ByRef weights As Object, ByVal topN As Integer, ByVal dataRows As Long)
    Dim ws As Worksheet
    Set ws = GetOrCreateSheet("Score_Consensus")
    ws.Cells.Clear

    ' Headers
    ws.Range("A1").Value = "Rank"
    ws.Range("B1").Value = "Patent ID"
    ws.Range("C1").Value = "Title"
    ws.Range("D1").Value = "Years"
    ws.Range("E1").Value = "Comp Cites"
    ws.Range("F1").Value = "Competitors"
    ws.Range("G1").Value = "Sector"
    ws.Range("H1").Value = "Consensus"
    ws.Range("I1").Value = "YearMult"
    ws.Range("J1").Value = "IPLit Aggr"
    ws.Range("K1").Value = "IPLit Bal"
    ws.Range("L1").Value = "IPLit Cons"
    ws.Range("M1").Value = "Licensing"
    ws.Range("N1").Value = "Corporate"
    ws.Range("O1").Value = "Executive"

    Dim rowsToGenerate As Long
    rowsToGenerate = Application.WorksheetFunction.Min(topN, dataRows - 1)

    Dim rawWs As Worksheet
    Set rawWs = ThisWorkbook.Sheets(RAW_DATA_SHEET)

    ' Get all profile weights
    Dim aggrWeights() As Double, balWeights() As Double, consWeights() As Double
    Dim licWeights() As Double, corpWeights() As Double, execWeights() As Double
    aggrWeights = weights("Aggressive")
    balWeights = weights("Balanced")
    consWeights = weights("Conservative")
    licWeights = weights("Licensing")
    corpWeights = weights("Corporate")
    execWeights = weights("Executive")

    ' Get relative weights
    Dim relWeights() As Double
    relWeights = weights("RelativeWeights")

    Dim r As Long
    For r = 2 To rowsToGenerate + 1
        Dim srcRow As Long
        srcRow = r

        ' Copy data
        ws.Cells(r, 1).Value = r - 1
        ws.Cells(r, 2).Value = rawWs.Cells(srcRow, COL_PATENT_ID).Value
        ws.Cells(r, 3).Value = rawWs.Cells(srcRow, COL_TITLE).Value
        ws.Cells(r, 4).Value = rawWs.Cells(srcRow, COL_YEARS_REMAINING).Value
        ws.Cells(r, 5).Value = rawWs.Cells(srcRow, COL_COMPETITOR_CITATIONS).Value
        ws.Cells(r, 6).Value = rawWs.Cells(srcRow, COL_COMPETITORS).Value
        ws.Cells(r, 7).Value = rawWs.Cells(srcRow, COL_SECTOR).Value

        ' Calculate each profile score
        Dim aggrScore As Variant, balScore As Variant, consScore As Variant
        Dim licScore As Variant, corpScore As Variant, execScore As Variant

        aggrScore = CalculateScore(rawWs, srcRow, aggrWeights)
        balScore = CalculateScore(rawWs, srcRow, balWeights)
        consScore = CalculateScore(rawWs, srcRow, consWeights)
        licScore = CalculateScore(rawWs, srcRow, licWeights)
        corpScore = CalculateScore(rawWs, srcRow, corpWeights)
        execScore = CalculateScore(rawWs, srcRow, execWeights)

        ws.Cells(r, 9).Value = aggrScore(2)   ' Year Mult (same for all)
        ws.Cells(r, 10).Value = aggrScore(0)  ' Aggressive
        ws.Cells(r, 11).Value = balScore(0)   ' Balanced
        ws.Cells(r, 12).Value = consScore(0)  ' Conservative
        ws.Cells(r, 13).Value = licScore(0)   ' Licensing
        ws.Cells(r, 14).Value = corpScore(0)  ' Corporate
        ws.Cells(r, 15).Value = execScore(0)  ' Executive

        ' Consensus = weighted average
        Dim consensus As Double
        consensus = aggrScore(0) * relWeights(0) + _
                    balScore(0) * relWeights(1) + _
                    consScore(0) * relWeights(2) + _
                    licScore(0) * relWeights(3) + _
                    corpScore(0) * relWeights(4) + _
                    execScore(0) * relWeights(5)

        ws.Cells(r, 8).Value = consensus
    Next r

    ' Format
    ws.Range("H2:H" & (rowsToGenerate + 1)).NumberFormat = "0.00%"
    ws.Range("I2:I" & (rowsToGenerate + 1)).NumberFormat = "0.00"
    ws.Range("J2:O" & (rowsToGenerate + 1)).NumberFormat = "0.00%"

    ' Sort by consensus
    SortSheetByScore ws, rowsToGenerate

    FormatHeaderRow ws

    ' Color headers
    ws.Range("H1").Interior.Color = RGB(128, 128, 128)
    ws.Range("I1").Interior.Color = RGB(255, 215, 0)
    ws.Range("J1").Interior.Color = RGB(255, 99, 71)
    ws.Range("K1").Interior.Color = RGB(255, 165, 0)
    ws.Range("L1").Interior.Color = RGB(100, 149, 237)
    ws.Range("M1").Interior.Color = RGB(144, 238, 144)
    ws.Range("N1").Interior.Color = RGB(221, 160, 221)
    ws.Range("O1").Interior.Color = RGB(135, 206, 235)

    ws.Columns("A:O").AutoFit
End Sub

Private Sub SortSheetByScore(ByVal ws As Worksheet, ByVal rowCount As Long)
    ' Sort by column H (Score/Consensus) descending
    ws.Sort.SortFields.Clear
    ws.Sort.SortFields.Add2 Key:=ws.Range("H2:H" & (rowCount + 1)), _
        SortOn:=xlSortOnValues, Order:=xlDescending, DataOption:=xlSortNormal

    With ws.Sort
        .SetRange ws.Range("A1:" & ws.Cells(1, ws.Columns.Count).End(xlToLeft).Address & (rowCount + 1))
        .Header = xlYes
        .Apply
    End With

    ' Update rank numbers
    Dim r As Long
    For r = 2 To rowCount + 1
        ws.Cells(r, 1).Value = r - 1
    Next r
End Sub

'===============================================================================
' RECALCULATION (for weight changes)
'===============================================================================

Private Sub RecalculateProfileSheet(ByVal sheetName As String, ByVal weightCol As Integer, _
                                     ByRef weights As Object, ByVal dataRows As Long)
    Dim ws As Worksheet
    On Error Resume Next
    Set ws = ThisWorkbook.Sheets(sheetName)
    On Error GoTo 0

    If ws Is Nothing Then Exit Sub

    Dim rawWs As Worksheet
    Set rawWs = ThisWorkbook.Sheets(RAW_DATA_SHEET)

    ' Get profile name from weight column
    Dim profileName As String
    Select Case weightCol
        Case WEIGHT_COL_AGGRESSIVE: profileName = "Aggressive"
        Case WEIGHT_COL_BALANCED: profileName = "Balanced"
        Case WEIGHT_COL_CONSERVATIVE: profileName = "Conservative"
        Case WEIGHT_COL_LICENSING: profileName = "Licensing"
        Case WEIGHT_COL_CORPORATE: profileName = "Corporate"
        Case WEIGHT_COL_EXECUTIVE: profileName = "Executive"
    End Select

    Dim metricWeights() As Double
    metricWeights = weights(profileName)

    Dim rowCount As Long
    rowCount = ws.Cells(ws.Rows.Count, 2).End(xlUp).Row - 1  ' Exclude header

    Dim r As Long
    For r = 2 To rowCount + 1
        ' Find corresponding row in RawData by patent ID
        Dim patentId As String
        patentId = ws.Cells(r, 2).Value

        Dim srcRow As Long
        srcRow = FindPatentRow(rawWs, patentId, dataRows)

        If srcRow > 0 Then
            Dim scoreResult As Variant
            scoreResult = CalculateScore(rawWs, srcRow, metricWeights)

            ws.Cells(r, 8).Value = scoreResult(0)   ' Final Score
            ws.Cells(r, 9).Value = scoreResult(2)   ' Year Mult
            ws.Cells(r, 10).Value = scoreResult(1)  ' Base Score
        End If
    Next r

    ' Re-sort
    SortSheetByScore ws, rowCount
End Sub

Private Sub RecalculateConsensusSheet(ByRef weights As Object, ByVal dataRows As Long)
    Dim ws As Worksheet
    On Error Resume Next
    Set ws = ThisWorkbook.Sheets("Score_Consensus")
    On Error GoTo 0

    If ws Is Nothing Then Exit Sub

    Dim rawWs As Worksheet
    Set rawWs = ThisWorkbook.Sheets(RAW_DATA_SHEET)

    ' Get all profile weights
    Dim aggrWeights() As Double, balWeights() As Double, consWeights() As Double
    Dim licWeights() As Double, corpWeights() As Double, execWeights() As Double
    aggrWeights = weights("Aggressive")
    balWeights = weights("Balanced")
    consWeights = weights("Conservative")
    licWeights = weights("Licensing")
    corpWeights = weights("Corporate")
    execWeights = weights("Executive")

    Dim relWeights() As Double
    relWeights = weights("RelativeWeights")

    Dim rowCount As Long
    rowCount = ws.Cells(ws.Rows.Count, 2).End(xlUp).Row - 1

    Dim r As Long
    For r = 2 To rowCount + 1
        Dim patentId As String
        patentId = ws.Cells(r, 2).Value

        Dim srcRow As Long
        srcRow = FindPatentRow(rawWs, patentId, dataRows)

        If srcRow > 0 Then
            Dim aggrScore As Variant, balScore As Variant, consScore As Variant
            Dim licScore As Variant, corpScore As Variant, execScore As Variant

            aggrScore = CalculateScore(rawWs, srcRow, aggrWeights)
            balScore = CalculateScore(rawWs, srcRow, balWeights)
            consScore = CalculateScore(rawWs, srcRow, consWeights)
            licScore = CalculateScore(rawWs, srcRow, licWeights)
            corpScore = CalculateScore(rawWs, srcRow, corpWeights)
            execScore = CalculateScore(rawWs, srcRow, execWeights)

            ws.Cells(r, 9).Value = aggrScore(2)
            ws.Cells(r, 10).Value = aggrScore(0)
            ws.Cells(r, 11).Value = balScore(0)
            ws.Cells(r, 12).Value = consScore(0)
            ws.Cells(r, 13).Value = licScore(0)
            ws.Cells(r, 14).Value = corpScore(0)
            ws.Cells(r, 15).Value = execScore(0)

            Dim consensus As Double
            consensus = aggrScore(0) * relWeights(0) + _
                        balScore(0) * relWeights(1) + _
                        consScore(0) * relWeights(2) + _
                        licScore(0) * relWeights(3) + _
                        corpScore(0) * relWeights(4) + _
                        execScore(0) * relWeights(5)

            ws.Cells(r, 8).Value = consensus
        End If
    Next r

    ' Re-sort
    SortSheetByScore ws, rowCount
End Sub

Private Function FindPatentRow(ByVal ws As Worksheet, ByVal patentId As String, ByVal maxRow As Long) As Long
    ' Find row in RawData by patent ID (column B)
    Dim r As Long
    For r = 2 To maxRow + 1
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

Public Sub GenerateCompetitorSummary()
    '
    ' Generates CompetitorSummary worksheet showing:
    ' - Competitor name
    ' - Patent count in top rated list
    ' - Average rank, Min rank, Max rank, Median rank
    ' - Total competitor citations across all patents
    ' - Average competitor citations per patent
    '
    Application.ScreenUpdating = False
    Application.Calculation = xlCalculationManual

    On Error GoTo ErrorHandler

    Dim compCount As Long
    compCount = GenerateCompetitorSummaryInternal()

    If compCount >= 0 Then
        MsgBox "CompetitorSummary worksheet generated!" & vbCrLf & _
               compCount & " unique competitors found.", vbInformation
    End If

Cleanup:
    Application.Calculation = xlCalculationAutomatic
    Application.ScreenUpdating = True
    Exit Sub

ErrorHandler:
    MsgBox "Error generating competitor summary: " & Err.Description, vbCritical
    Resume Cleanup
End Sub

Private Function GenerateCompetitorSummaryInternal() As Long
    '
    ' Internal version that returns competitor count (-1 on error)
    ' Called from both public GenerateCompetitorSummary and ImportAllData
    '
    GenerateCompetitorSummaryInternal = -1

    ' Get data from Score_Consensus sheet
    Dim wsSrc As Worksheet
    On Error Resume Next
    Set wsSrc = ThisWorkbook.Sheets("Score_Consensus")
    On Error GoTo 0

    If wsSrc Is Nothing Then Exit Function

    Dim lastRow As Long
    lastRow = wsSrc.Cells(wsSrc.Rows.Count, 2).End(xlUp).Row

    If lastRow < 2 Then Exit Function

    ' Dictionary to track competitor stats
    Dim compStats As Object
    Set compStats = CreateObject("Scripting.Dictionary")

    ' Parse competitor data from each patent
    Dim r As Long, i As Long
    Dim competitors As String
    Dim compArray() As String
    Dim compName As String
    Dim rank As Long
    Dim compCites As Long

    For r = 2 To lastRow
        rank = wsSrc.Cells(r, 1).Value      ' Column A = Rank
        competitors = wsSrc.Cells(r, 6).Value ' Column F = Competitors
        compCites = Val(wsSrc.Cells(r, 5).Value) ' Column E = Comp Cites

        If Len(Trim(competitors)) > 0 Then
            ' Parse competitors (semicolon separated)
            compArray = Split(competitors, ";")
            For i = LBound(compArray) To UBound(compArray)
                compName = Trim(compArray(i))
                If Len(compName) > 0 Then
                    If Not compStats.Exists(compName) Then
                        ' Initialize: count, sumRank, minRank, maxRank, ranks(array as string), totalCites
                        compStats.Add compName, Array(0, 0, 9999, 0, "", 0)
                    End If

                    Dim stats As Variant
                    stats = compStats(compName)
                    stats(0) = stats(0) + 1  ' count
                    stats(1) = stats(1) + rank  ' sumRank
                    If rank < stats(2) Then stats(2) = rank  ' minRank
                    If rank > stats(3) Then stats(3) = rank  ' maxRank
                    If Len(stats(4)) > 0 Then
                        stats(4) = stats(4) & "," & CStr(rank)
                    Else
                        stats(4) = CStr(rank)
                    End If
                    stats(5) = stats(5) + compCites  ' totalCites (aggregate for this competitor)
                    compStats(compName) = stats
                End If
            Next i
        End If
    Next r

    ' Create summary worksheet
    Dim wsSummary As Worksheet
    Set wsSummary = GetOrCreateSheet("CompetitorSummary")
    wsSummary.Cells.Clear

    ' Title and description
    wsSummary.Range("A1").Value = "COMPETITOR SUMMARY - TOP RATED PATENTS"
    wsSummary.Range("A1").Font.Bold = True
    wsSummary.Range("A1").Font.Size = 16
    wsSummary.Range("A2").Value = "Shows how each competitor is represented in the current top rated ranking"

    ' Headers
    wsSummary.Range("A4").Value = "Competitor"
    wsSummary.Range("B4").Value = "Patent Count"
    wsSummary.Range("C4").Value = "Avg Rank"
    wsSummary.Range("D4").Value = "Min Rank"
    wsSummary.Range("E4").Value = "Max Rank"
    wsSummary.Range("F4").Value = "Median Rank"
    wsSummary.Range("G4").Value = "Aggregated Cites"
    wsSummary.Range("H4").Value = "Avg Cites/Entry"
    FormatHeaderRow wsSummary, 4

    ' Sort competitors by patent count descending
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

    ' Simple bubble sort by count descending
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

    ' Output sorted data
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

        ' Calculate median rank
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

    ' Add conditional formatting to Patent Count column
    Dim rngCount As Range
    Set rngCount = wsSummary.Range("B5:B" & (outRow - 1))
    rngCount.FormatConditions.AddDatabar
    rngCount.FormatConditions(rngCount.FormatConditions.Count).BarColor.Color = RGB(99, 142, 198)

    ' Summary stats at bottom
    outRow = outRow + 2
    wsSummary.Cells(outRow, 1).Value = "SUMMARY"
    wsSummary.Cells(outRow, 1).Font.Bold = True
    outRow = outRow + 1
    wsSummary.Cells(outRow, 1).Value = "Total unique competitors:"
    wsSummary.Cells(outRow, 2).Value = compStats.Count
    outRow = outRow + 1
    wsSummary.Cells(outRow, 1).Value = "Patents with citations:"
    wsSummary.Cells(outRow, 2).Value = "=COUNTIF(Score_Consensus!E:E,"">0"")"

    GenerateCompetitorSummaryInternal = compStats.Count
End Function

Private Function CalculateMedian(ByVal ranksStr As String) As Double
    ' Calculate median from comma-separated rank string
    If Len(ranksStr) = 0 Then
        CalculateMedian = 0
        Exit Function
    End If

    Dim rankArray() As String
    rankArray = Split(ranksStr, ",")

    Dim n As Long
    n = UBound(rankArray) + 1

    ' Convert to numbers and sort
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

    ' Calculate median
    If n Mod 2 = 1 Then
        CalculateMedian = ranks(n \ 2)
    Else
        CalculateMedian = (ranks(n \ 2 - 1) + ranks(n \ 2)) / 2
    End If
End Function

'===============================================================================
' UTILITY FUNCTIONS
'===============================================================================

Public Sub ClearAllDataSheets()
    Dim sheetNames As Variant
    sheetNames = Array(RAW_DATA_SHEET, "Score_IPLit_Aggr", "Score_IPLit_Bal", "Score_IPLit_Cons", _
                       "Score_Licensing", "Score_Corporate", "Score_Executive", "Score_Consensus", _
                       "CompetitorSummary", "AffiliateSummary", "SectorSummary", "SuperSectorSummary")

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

Private Function GetRowCount(ByVal sheetName As String) As Long
    On Error Resume Next
    Dim ws As Worksheet
    Set ws = ThisWorkbook.Sheets(sheetName)

    If ws Is Nothing Then
        GetRowCount = 0
    Else
        GetRowCount = ws.Cells(ws.Rows.Count, 1).End(xlUp).Row
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
        .Interior.Color = RGB(26, 26, 46)
        .Font.Color = RGB(255, 255, 255)
    End With
End Sub

'===============================================================================
' AFFILIATE SUMMARY
'===============================================================================

Public Sub GenerateAffiliateSummary()
    '
    ' Generates AffiliateSummary worksheet showing portfolio breakdown by affiliate
    '
    Application.ScreenUpdating = False
    Application.Calculation = xlCalculationManual

    On Error GoTo ErrorHandler

    Dim affCount As Long
    affCount = GenerateAffiliateSummaryInternal()

    If affCount >= 0 Then
        MsgBox "AffiliateSummary generated with " & affCount & " affiliates.", vbInformation
    End If

Cleanup:
    Application.Calculation = xlCalculationAutomatic
    Application.ScreenUpdating = True
    Exit Sub

ErrorHandler:
    MsgBox "Error generating affiliate summary: " & Err.Description, vbCritical
    Resume Cleanup
End Sub

Private Function GenerateAffiliateSummaryInternal() As Long
    '
    ' Internal: Generates AffiliateSummary tab showing portfolio breakdown by affiliate (assignee)
    ' Returns count of affiliates (-1 on error)
    '
    GenerateAffiliateSummaryInternal = -1

    ' Get source data from RawData (preferred) or Score_Consensus
    Dim wsSrc As Worksheet
    On Error Resume Next
    Set wsSrc = ThisWorkbook.Sheets(RAW_DATA_SHEET)
    On Error GoTo 0

    If wsSrc Is Nothing Then
        On Error Resume Next
        Set wsSrc = ThisWorkbook.Sheets("Score_Consensus")
        On Error GoTo 0
    End If

    If wsSrc Is Nothing Then Exit Function

    Dim lastRow As Long
    lastRow = wsSrc.Cells(wsSrc.Rows.Count, 2).End(xlUp).Row
    If lastRow < 2 Then Exit Function

    ' Dictionary to track affiliate stats
    Dim affiliateStats As Object
    Set affiliateStats = CreateObject("Scripting.Dictionary")

    ' Parse data - assuming columns: patent_id(B), assignee(E), years(D or F), comp_cites(E or H), sector(K or G)
    Dim r As Long
    Dim colAssignee As Integer, colYears As Integer, colCompCites As Integer, colSector As Integer

    ' Try to find columns by header
    colAssignee = FindColumnByHeader(wsSrc, "assignee")
    If colAssignee = 0 Then colAssignee = COL_ASSIGNEE

    colYears = FindColumnByHeader(wsSrc, "years_remaining")
    If colYears = 0 Then colYears = COL_YEARS_REMAINING

    colCompCites = FindColumnByHeader(wsSrc, "competitor_citations")
    If colCompCites = 0 Then colCompCites = COL_COMPETITOR_CITATIONS

    colSector = FindColumnByHeader(wsSrc, "sector")
    If colSector = 0 Then colSector = COL_SECTOR

    For r = 2 To lastRow
        Dim affiliate As String
        affiliate = Trim(CStr(wsSrc.Cells(r, colAssignee).Value))
        If Len(affiliate) = 0 Then affiliate = "Unknown"

        ' Normalize common affiliate names
        affiliate = NormalizeAffiliateName(affiliate)

        Dim years As Double
        years = Val(wsSrc.Cells(r, colYears).Value)

        Dim compCites As Long
        compCites = Val(wsSrc.Cells(r, colCompCites).Value)

        Dim sector As String
        sector = CStr(wsSrc.Cells(r, colSector).Value)

        Dim patentId As String
        patentId = CStr(wsSrc.Cells(r, COL_PATENT_ID).Value)

        If Not affiliateStats.Exists(affiliate) Then
            ' Structure: count, activeCount, totalYears, totalCites, topPatentId, topPatentCites, sectors(string)
            affiliateStats.Add affiliate, Array(0, 0, 0, 0, "", 0, "")
        End If

        Dim stats As Variant
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
    wsSummary.Range("A1").Value = "AFFILIATE SUMMARY - PORTFOLIO BREAKDOWN"
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

Private Function NormalizeAffiliateName(ByVal assignee As String) As String
    ' Normalize common Broadcom affiliate names
    Dim lowerAssignee As String
    lowerAssignee = LCase(assignee)

    If InStr(lowerAssignee, "broadcom") > 0 Then
        NormalizeAffiliateName = "Broadcom"
    ElseIf InStr(lowerAssignee, "avago") > 0 Then
        NormalizeAffiliateName = "Avago Technologies"
    ElseIf InStr(lowerAssignee, "symantec") > 0 Or InStr(lowerAssignee, "nortonlifelock") > 0 Then
        NormalizeAffiliateName = "Symantec Enterprise"
    ElseIf InStr(lowerAssignee, "vmware") > 0 Then
        NormalizeAffiliateName = "VMware"
    ElseIf InStr(lowerAssignee, "ca, inc") > 0 Or InStr(lowerAssignee, "ca technologies") > 0 Or InStr(lowerAssignee, "computer associates") > 0 Then
        NormalizeAffiliateName = "CA Technologies"
    ElseIf InStr(lowerAssignee, "lsi") > 0 Then
        NormalizeAffiliateName = "LSI Corporation"
    ElseIf InStr(lowerAssignee, "brocade") > 0 Then
        NormalizeAffiliateName = "Brocade Communications"
    ElseIf InStr(lowerAssignee, "blue coat") > 0 Then
        NormalizeAffiliateName = "Blue Coat Systems"
    ElseIf InStr(lowerAssignee, "carbon black") > 0 Then
        NormalizeAffiliateName = "Carbon Black"
    Else
        NormalizeAffiliateName = assignee
    End If
End Function

Private Function FindColumnByHeader(ByVal ws As Worksheet, ByVal headerName As String) As Integer
    Dim lastCol As Integer
    lastCol = ws.Cells(1, ws.Columns.Count).End(xlToLeft).Column

    Dim c As Integer
    For c = 1 To lastCol
        If LCase(Trim(CStr(ws.Cells(1, c).Value))) = LCase(headerName) Then
            FindColumnByHeader = c
            Exit Function
        End If
    Next c

    FindColumnByHeader = 0
End Function

'===============================================================================
' SECTOR SUMMARY
'===============================================================================

Public Sub GenerateSectorSummary()
    '
    ' Generates SectorSummary worksheet showing portfolio breakdown by sector
    '
    Application.ScreenUpdating = False
    Application.Calculation = xlCalculationManual

    On Error GoTo ErrorHandler

    Dim secCount As Long
    secCount = GenerateSectorSummaryInternal()

    If secCount >= 0 Then
        MsgBox "SectorSummary generated with " & secCount & " sectors.", vbInformation
    End If

Cleanup:
    Application.Calculation = xlCalculationAutomatic
    Application.ScreenUpdating = True
    Exit Sub

ErrorHandler:
    MsgBox "Error generating sector summary: " & Err.Description, vbCritical
    Resume Cleanup
End Sub

Private Function GenerateSectorSummaryInternal() As Long
    '
    ' Internal: Generates SectorSummary tab showing portfolio breakdown by sector
    ' Returns count of sectors (-1 on error)
    '
    GenerateSectorSummaryInternal = -1

    ' Declare all variables at top of function to avoid duplicate declaration errors
    Dim wsSrc As Worksheet
    Dim wsSummary As Worksheet
    Dim lastRow As Long, r As Long, n As Long, i As Long, j As Long, outRow As Long
    Dim colSector As Integer, colYears As Integer, colCompCites As Integer
    Dim colAssignee As Integer, colCompetitors As Integer
    Dim sector As String, competitors As String, assignee As String, patentId As String
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

    If wsSrc Is Nothing Then
        On Error Resume Next
        Set wsSrc = ThisWorkbook.Sheets("Score_Consensus")
        On Error GoTo 0
    End If

    If wsSrc Is Nothing Then Exit Function

    lastRow = wsSrc.Cells(wsSrc.Rows.Count, 2).End(xlUp).Row
    If lastRow < 2 Then Exit Function

    ' Dictionary to track sector stats
    Set sectorStats = CreateObject("Scripting.Dictionary")

    ' Find columns
    colSector = FindColumnByHeader(wsSrc, "sector")
    If colSector = 0 Then colSector = COL_SECTOR

    colYears = FindColumnByHeader(wsSrc, "years_remaining")
    If colYears = 0 Then colYears = COL_YEARS_REMAINING

    colCompCites = FindColumnByHeader(wsSrc, "competitor_citations")
    If colCompCites = 0 Then colCompCites = COL_COMPETITOR_CITATIONS

    colAssignee = FindColumnByHeader(wsSrc, "assignee")
    If colAssignee = 0 Then colAssignee = COL_ASSIGNEE

    colCompetitors = FindColumnByHeader(wsSrc, "competitors")
    If colCompetitors = 0 Then colCompetitors = COL_COMPETITORS

    For r = 2 To lastRow
        sector = Trim(CStr(wsSrc.Cells(r, colSector).Value))
        If Len(sector) = 0 Then sector = "unassigned"

        years = Val(wsSrc.Cells(r, colYears).Value)

        compCites = Val(wsSrc.Cells(r, colCompCites).Value)

        competitors = CStr(wsSrc.Cells(r, colCompetitors).Value)

        assignee = NormalizeAffiliateName(CStr(wsSrc.Cells(r, colAssignee).Value))

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
        If Len(assignee) > 0 And InStr(stats(7), assignee) = 0 Then
            If Len(stats(7)) > 0 Then
                stats(7) = stats(7) & "; " & assignee
            Else
                stats(7) = assignee
            End If
        End If

        sectorStats(sector) = stats
    Next r

    ' Create summary worksheet
    Set wsSummary = GetOrCreateSheet("SectorSummary")
    wsSummary.Cells.Clear

    ' Title
    wsSummary.Range("A1").Value = "SECTOR SUMMARY - TECHNOLOGY BREAKDOWN"
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
' GENERATE ALL SUMMARIES
'===============================================================================

Public Sub GenerateAllSummaries()
    '
    ' Regenerates all four summary tabs (Competitor, Affiliate, Sector, SuperSector)
    '
    Application.ScreenUpdating = False
    Application.Calculation = xlCalculationManual

    On Error GoTo ErrorHandler

    Dim compCount As Long, affCount As Long, secCount As Long, superCount As Long
    compCount = GenerateCompetitorSummaryInternal()
    affCount = GenerateAffiliateSummaryInternal()
    secCount = GenerateSectorSummaryInternal()
    superCount = GenerateSuperSectorSummaryInternal()

    MsgBox "All summaries regenerated:" & vbCrLf & vbCrLf & _
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
' SUPER-SECTOR SUMMARY
'===============================================================================

' Super-sector mapping (sector -> super-sector)
' This is a simplified version - the TypeScript export generates the full mapping
Private Function GetSuperSector(ByVal sector As String) As String
    Dim lowerSector As String
    lowerSector = LCase(sector)

    ' SECURITY
    If InStr(lowerSector, "threat") > 0 Or InStr(lowerSector, "auth") > 0 Or _
       InStr(lowerSector, "crypto") > 0 Or InStr(lowerSector, "security") > 0 Or _
       InStr(lowerSector, "secure") > 0 Or InStr(lowerSector, "protection") > 0 Or _
       InStr(lowerSector, "pii") > 0 Then
        GetSuperSector = "SECURITY"
    ' NETWORK
    ElseIf InStr(lowerSector, "network-") > 0 And InStr(lowerSector, "threat") = 0 And _
           InStr(lowerSector, "auth") = 0 And InStr(lowerSector, "crypto") = 0 And _
           InStr(lowerSector, "secure") = 0 Then
        GetSuperSector = "NETWORK"
    ' VIDEO
    ElseIf InStr(lowerSector, "video") > 0 Or InStr(lowerSector, "stream") > 0 Or _
           InStr(lowerSector, "event-live") > 0 Then
        GetSuperSector = "VIDEO"
    ' WIRELESS
    ElseIf InStr(lowerSector, "wireless") > 0 Or InStr(lowerSector, "rf-") > 0 Or _
           InStr(lowerSector, "bluetooth") > 0 Then
        GetSuperSector = "WIRELESS"
    ' COMPUTING
    ElseIf InStr(lowerSector, "computing") > 0 And InStr(lowerSector, "security") = 0 And _
           InStr(lowerSector, "protection") = 0 And InStr(lowerSector, "auth") = 0 Then
        GetSuperSector = "COMPUTING"
    ElseIf InStr(lowerSector, "fintech") > 0 Or InStr(lowerSector, "retrieval") > 0 Then
        GetSuperSector = "COMPUTING"
    ' AI/ML
    ElseIf InStr(lowerSector, "ai-ml") > 0 Then
        GetSuperSector = "AI_ML"
    ' IMAGING
    ElseIf InStr(lowerSector, "image") > 0 Or InStr(lowerSector, "3d") > 0 Or _
           InStr(lowerSector, "stereo") > 0 Or InStr(lowerSector, "depth") > 0 Or _
           InStr(lowerSector, "camera") > 0 Or InStr(lowerSector, "pose") > 0 Then
        GetSuperSector = "IMAGING"
    Else
        GetSuperSector = "OTHER"
    End If
End Function

Private Function GetSuperSectorDisplayName(ByVal superSector As String) As String
    Select Case superSector
        Case "SECURITY": GetSuperSectorDisplayName = "Security"
        Case "NETWORK": GetSuperSectorDisplayName = "Network Infrastructure"
        Case "VIDEO": GetSuperSectorDisplayName = "Video & Media"
        Case "WIRELESS": GetSuperSectorDisplayName = "Wireless & RF"
        Case "COMPUTING": GetSuperSectorDisplayName = "Computing & Cloud"
        Case "AI_ML": GetSuperSectorDisplayName = "AI & Machine Learning"
        Case "IMAGING": GetSuperSectorDisplayName = "Imaging & 3D"
        Case Else: GetSuperSectorDisplayName = "Other"
    End Select
End Function

Private Function GetTopItems(ByRef dict As Object, ByVal topN As Integer) As String
    '
    ' Returns top N items from dictionary sorted by value (descending)
    ' Returns semicolon-separated string of keys
    '
    If dict Is Nothing Or dict.Count = 0 Then
        GetTopItems = ""
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

    GetTopItems = result
End Function

Private Function GenerateSuperSectorSummaryInternal() As Long
    GenerateSuperSectorSummaryInternal = -1

    ' Get source data
    Dim wsSrc As Worksheet
    On Error Resume Next
    Set wsSrc = ThisWorkbook.Sheets(RAW_DATA_SHEET)
    On Error GoTo 0

    If wsSrc Is Nothing Then
        On Error Resume Next
        Set wsSrc = ThisWorkbook.Sheets("Score_Consensus")
        On Error GoTo 0
    End If

    If wsSrc Is Nothing Then Exit Function

    Dim lastRow As Long
    lastRow = wsSrc.Cells(wsSrc.Rows.Count, 2).End(xlUp).Row
    If lastRow < 2 Then Exit Function

    ' Find columns
    Dim colSector As Integer, colYears As Integer, colCompCites As Integer

    colSector = FindColumnByHeader(wsSrc, "sector")
    If colSector = 0 Then colSector = COL_SECTOR

    colYears = FindColumnByHeader(wsSrc, "years_remaining")
    If colYears = 0 Then colYears = COL_YEARS_REMAINING

    colCompCites = FindColumnByHeader(wsSrc, "competitor_citations")
    If colCompCites = 0 Then colCompCites = COL_COMPETITOR_CITATIONS

    ' Dictionary for super-sector stats
    Dim superStats As Object
    Set superStats = CreateObject("Scripting.Dictionary")

    Dim r As Long
    For r = 2 To lastRow
        Dim sector As String
        sector = Trim(CStr(wsSrc.Cells(r, colSector).Value))
        If Len(sector) = 0 Then sector = "unassigned"

        Dim superSector As String
        superSector = GetSuperSector(sector)

        Dim years As Double
        years = Val(wsSrc.Cells(r, colYears).Value)

        Dim compCites As Long
        compCites = Val(wsSrc.Cells(r, colCompCites).Value)

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
    wsSummary.Range("A1").Value = "SUPER-SECTOR SUMMARY - TECHNOLOGY DOMAINS"
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
        topSectors = GetTopItems(secDict2, 3)

        wsSummary.Cells(outRow, 1).Value = superSector
        wsSummary.Cells(outRow, 2).Value = GetSuperSectorDisplayName(superSector)
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
