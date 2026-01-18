Attribute VB_Name = "PatentAnalysisMacros"
'===============================================================================
' Patent Portfolio Analysis - VBA Macros
'===============================================================================
' Version: 3.0 (V3 Stakeholder Voting Profiles)
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
'   - Multiplicative 4-factor model: Market × Legal × Enforcement × Timeline
'   - Each factor has adjustable metric weights
'   - Year multiplier applied to final score
'   - Consensus = average of all 6 profile scores
'
' Worksheet Structure:
'   - RawData: Imported patent metrics (from CSV)
'   - UserWeights: 6 stakeholder profiles with adjustable weights
'   - Score_IPLit_Aggressive: Scoring sheet for IP Litigator (Aggressive)
'   - Score_IPLit_Balanced: Scoring sheet for IP Litigator (Balanced)
'   - Score_IPLit_Conservative: Scoring sheet for IP Litigator (Conservative)
'   - Score_Licensing: Scoring sheet for Licensing Specialist
'   - Score_Corporate: Scoring sheet for Corporate/M&A
'   - Score_Executive: Scoring sheet for Executive/Portfolio
'   - Score_Consensus: Combined view with all profiles
'
' Usage:
'   1. Run ImportTop250() - auto-finds today's TOP250-YYYY-MM-DD.csv
'   2. Modify weights in UserWeights sheet
'   3. Scores update automatically via formulas
'
' File Convention:
'   - Export: npx tsx scripts/calculate-and-export-v3.ts
'   - File: excel/TOP250-YYYY-MM-DD.csv (uses today's date)
'   - Fallback: excel/TOP250-LATEST.csv
'
' Author: Generated for IP Portfolio Analysis Platform
' Last Updated: 2026-01-18 (V3 stakeholder profiles)
'===============================================================================

Option Explicit

' Configuration Constants
Private Const DEFAULT_TOP_N As Integer = 250
Private Const DATA_START_ROW As Integer = 2
Private Const WEIGHTS_SHEET As String = "UserWeights"
Private Const RAW_DATA_SHEET As String = "RawData"

' File naming convention
Private Const FILE_PREFIX As String = "TOP250-"
Private Const FILE_LATEST As String = "TOP250-LATEST.csv"

' V3 CSV Column mappings (must match calculate-and-export-v3.ts output)
' Note: CSV has rank in col A, but we skip it during import relevance
Private Const COL_RANK As String = "A"
Private Const COL_PATENT_ID As String = "B"
Private Const COL_TITLE As String = "C"
Private Const COL_GRANT_DATE As String = "D"
Private Const COL_ASSIGNEE As String = "E"
Private Const COL_YEARS_REMAINING As String = "F"
Private Const COL_FORWARD_CITATIONS As String = "G"
Private Const COL_COMPETITOR_CITATIONS As String = "H"
Private Const COL_COMPETITOR_COUNT As String = "I"
Private Const COL_COMPETITORS As String = "J"
Private Const COL_SECTOR As String = "K"
Private Const COL_SECTOR_NAME As String = "L"
' LLM scores (1-5 scale)
Private Const COL_ELIGIBILITY As String = "M"
Private Const COL_VALIDITY As String = "N"
Private Const COL_CLAIM_BREADTH As String = "O"
Private Const COL_ENFORCEMENT As String = "P"
Private Const COL_DESIGN_AROUND As String = "Q"
Private Const COL_MARKET_RELEVANCE As String = "R"
Private Const COL_IPR_RISK As String = "S"
Private Const COL_PROSECUTION_QUALITY As String = "T"
' V3 signals
Private Const COL_IMPLEMENTATION_TYPE As String = "U"
Private Const COL_STANDARDS_RELEVANCE As String = "V"
' Pre-computed scores (for reference, we recalculate dynamically)
Private Const COL_SCORE_CONSENSUS As String = "W"

' Profile identifiers
Private Const PROFILE_AGGRESSIVE As String = "IPLit_Aggressive"
Private Const PROFILE_BALANCED As String = "IPLit_Balanced"
Private Const PROFILE_CONSERVATIVE As String = "IPLit_Conservative"
Private Const PROFILE_LICENSING As String = "Licensing"
Private Const PROFILE_CORPORATE As String = "Corporate"
Private Const PROFILE_EXECUTIVE As String = "Executive"

'===============================================================================
' PUBLIC ENTRY POINTS
'===============================================================================

Public Sub ImportTop250()
    '
    ' MAIN ENTRY POINT: Import today's Top 250 for Excel analysis
    '
    ' File search order:
    '   1. excel/TOP250-YYYY-MM-DD.csv (today's date)
    '   2. excel/TOP250-LATEST.csv (fallback)
    '   3. Manual file selection
    '
    Dim csvPath As String
    Dim dateStr As String

    ' Try today's file first
    dateStr = Format(Date, "yyyy-mm-dd")
    csvPath = FindTop250File(dateStr)

    If csvPath = "" Then
        MsgBox "Could not find TOP250 file for today (" & dateStr & ")." & vbCrLf & vbCrLf & _
               "Run this command first:" & vbCrLf & _
               "npx tsx scripts/calculate-and-export-v3.ts" & vbCrLf & vbCrLf & _
               "Click OK to select a file manually.", vbExclamation
        csvPath = SelectFile("Select Top 250 CSV", "CSV Files (*.csv),*.csv")
    End If

    If csvPath <> "" Then
        ImportTop250FromFile csvPath
    End If
End Sub

Private Function FindTop250File(ByVal dateStr As String) As String
    '
    ' Finds the Top 250 CSV file using naming convention
    '
    Dim basePath As String
    Dim tryPath As String

    ' Get the workbook's directory or current directory
    If ThisWorkbook.Path <> "" Then
        basePath = ThisWorkbook.Path & "\"
    Else
        basePath = CurDir & "\"
    End If

    ' Try 1: TOP250-YYYY-MM-DD.csv in same directory (excel/)
    tryPath = basePath & FILE_PREFIX & dateStr & ".csv"
    If FileExists(tryPath) Then
        FindTop250File = tryPath
        Exit Function
    End If

    ' Try 2: Go up and into excel/ directory
    tryPath = basePath & "..\excel\" & FILE_PREFIX & dateStr & ".csv"
    If FileExists(tryPath) Then
        FindTop250File = tryPath
        Exit Function
    End If

    ' Try 3: TOP250-LATEST.csv fallback in same directory
    tryPath = basePath & FILE_LATEST
    If FileExists(tryPath) Then
        FindTop250File = tryPath
        Exit Function
    End If

    ' Try 4: TOP250-LATEST.csv in excel/ subdirectory
    tryPath = basePath & "..\excel\" & FILE_LATEST
    If FileExists(tryPath) Then
        FindTop250File = tryPath
        Exit Function
    End If

    FindTop250File = ""
End Function

Private Function FileExists(ByVal filePath As String) As Boolean
    On Error Resume Next
    FileExists = (Dir(filePath) <> "")
    On Error GoTo 0
End Function

Private Sub ImportTop250FromFile(ByVal csvPath As String)
    '
    ' Imports the Top 250 CSV and sets up worksheets
    '
    Application.ScreenUpdating = False
    Application.Calculation = xlCalculationManual

    On Error GoTo ErrorHandler

    ' Clear existing data
    ClearAllDataSheets

    ' Import CSV
    ImportCSVToSheet csvPath, RAW_DATA_SHEET

    Dim rowCount As Long
    rowCount = GetRowCount(RAW_DATA_SHEET)

    ' Verify it's the filtered top 250
    If rowCount > 260 Then
        MsgBox "WARNING: File has " & rowCount & " patents." & vbCrLf & _
               "Expected ~250. You may have imported the wrong file.", vbExclamation
    End If

    ' Create weights sheet and scoring worksheets
    CreateUserWeightsSheet
    GenerateAllScoringWorksheets DEFAULT_TOP_N

    MsgBox "Imported " & rowCount & " patents from:" & vbCrLf & csvPath & vbCrLf & vbCrLf & _
           "6 stakeholder profiles created. Adjust weights in UserWeights sheet.", vbInformation

    Application.Calculation = xlCalculationAutomatic
    Application.ScreenUpdating = True
    Exit Sub

ErrorHandler:
    Application.Calculation = xlCalculationAutomatic
    Application.ScreenUpdating = True
    MsgBox "Error during import: " & Err.Description, vbCritical
End Sub

Public Sub ImportAllData()
    ' Legacy wrapper - redirects to new function
    ImportTop250
End Sub

Public Sub RefreshScoring()
    ' Regenerate scoring worksheets (keeps weights)
    Dim dataRows As Long
    dataRows = GetRowCount(RAW_DATA_SHEET)
    If dataRows > 1 Then
        GenerateAllScoringWorksheets DEFAULT_TOP_N
    Else
        MsgBox "No data in RawData sheet. Run ImportTop250 first.", vbExclamation
    End If
End Sub

'===============================================================================
' IMPORT FUNCTIONS
'===============================================================================

Private Sub ImportCSVToSheet(ByVal filePath As String, ByVal sheetName As String)
    '
    ' Imports a CSV file into the specified worksheet
    '
    Dim ws As Worksheet

    ' Create or clear the sheet
    Set ws = GetOrCreateSheet(sheetName)
    ws.Cells.Clear

    ' Import using QueryTable for better handling of quoted fields
    With ws.QueryTables.Add(Connection:="TEXT;" & filePath, Destination:=ws.Range("A1"))
        .TextFileParseType = xlDelimited
        .TextFileCommaDelimiter = True
        .TextFileTextQualifier = xlTextQualifierDoubleQuote
        .TextFileConsecutiveDelimiter = False
        .Refresh BackgroundQuery:=False
        .Delete  ' Remove the query table after import
    End With

    ' Format the header row
    FormatHeaderRow ws
End Sub

'===============================================================================
' USER WEIGHTS SHEET CREATION (V3 - 6 Profiles)
'===============================================================================

Private Sub CreateUserWeightsSheet()
    '
    ' Creates the UserWeights sheet with 6 stakeholder profiles
    '
    Dim ws As Worksheet
    Set ws = GetOrCreateSheet(WEIGHTS_SHEET)
    ws.Cells.Clear

    ' === Section 1: Header ===
    ws.Range("A1").Value = "V3 STAKEHOLDER VOTING PROFILES"
    ws.Range("A1").Font.Bold = True
    ws.Range("A1").Font.Size = 16
    ws.Range("A2").Value = "Adjust weights below. Scores recalculate automatically."

    ' === Section 2: Metric Weights by Profile ===
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

    ' Metric weights (rows 7-16) - 10 metrics
    ' Format: Metric Name, Aggr, Bal, Cons, Lic, Corp, Exec, Description
    Dim metrics As Variant
    metrics = Array( _
        Array("competitor_citations", 0.20, 0.22, 0.15, 0.18, 0.20, 0.22, "Citations from tracked competitors"), _
        Array("competitor_count", 0.08, 0.06, 0.08, 0.12, 0.08, 0.08, "Number of competitors citing"), _
        Array("forward_citations", 0.05, 0.04, 0.08, 0.10, 0.10, 0.08, "Total forward citations (tech leadership)"), _
        Array("eligibility_score", 0.12, 0.10, 0.12, 0.10, 0.08, 0.10, "Section 101 eligibility (1-5)"), _
        Array("validity_score", 0.12, 0.10, 0.14, 0.10, 0.10, 0.10, "Prior art strength (1-5)"), _
        Array("claim_breadth", 0.06, 0.08, 0.08, 0.12, 0.12, 0.10, "Claim scope breadth (1-5)"), _
        Array("enforcement_clarity", 0.14, 0.12, 0.10, 0.08, 0.08, 0.10, "Infringement detectability (1-5)"), _
        Array("design_around_difficulty", 0.10, 0.10, 0.08, 0.10, 0.12, 0.10, "Design-around difficulty (1-5)"), _
        Array("ipr_risk_score", 0.06, 0.10, 0.10, 0.05, 0.06, 0.06, "IPR/PTAB risk (5=clean, 1=high)"), _
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

    ' Total row (row 17)
    ws.Range("A17").Value = "TOTAL"
    ws.Range("A17").Font.Bold = True
    ws.Range("B17").Formula = "=SUM(B7:B16)"
    ws.Range("C17").Formula = "=SUM(C7:C16)"
    ws.Range("D17").Formula = "=SUM(D7:D16)"
    ws.Range("E17").Formula = "=SUM(E7:E16)"
    ws.Range("F17").Formula = "=SUM(F7:F16)"
    ws.Range("G17").Formula = "=SUM(G7:G16)"

    ' Format weights as percentages
    ws.Range("B7:G17").NumberFormat = "0%"

    ' === Section 3: Year Multiplier Info ===
    ws.Range("A19").Value = "YEAR MULTIPLIER"
    ws.Range("A19").Font.Bold = True
    ws.Range("A20").Value = "Formula: 0.3 + 0.7 * (years/15)^0.8"
    ws.Range("A21").Value = "Applied multiplicatively to base score"
    ws.Range("A22").Value = "Years < 3 filtered out in export"

    ' === Section 4: Profile Relative Weights (for Consensus) ===
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
    ws.Range("C28").Value = "Mixed portfolio, hourly + success"

    ws.Range("A29").Value = "IP Litigator (Conservative)"
    ws.Range("B29").Value = 0.167
    ws.Range("C29").Value = "Defense-side, risk-averse"

    ws.Range("A30").Value = "Licensing Specialist"
    ws.Range("B30").Value = 0.167
    ws.Range("C30").Value = "Portfolio value, market signals"

    ws.Range("A31").Value = "Corporate/M&A"
    ws.Range("B31").Value = 0.166
    ws.Range("C31").Value = "Strategic alignment, deal signals"

    ws.Range("A32").Value = "Executive/Portfolio"
    ws.Range("B32").Value = 0.166
    ws.Range("C32").Value = "C-Suite, balanced view"

    ws.Range("A33").Value = "TOTAL"
    ws.Range("A33").Font.Bold = True
    ws.Range("B33").Formula = "=SUM(B27:B32)"

    ws.Range("B27:B33").NumberFormat = "0.0%"

    ' === Create Named Ranges ===
    CreateNamedRangesV3 ws

    ' === Format ===
    FormatHeaderRow ws, 6
    FormatHeaderRow ws, 26
    ws.Columns("A:H").AutoFit

    ' Color coding for profiles
    ws.Range("B6").Interior.Color = RGB(255, 99, 71)   ' Aggressive - tomato
    ws.Range("C6").Interior.Color = RGB(255, 165, 0)   ' Balanced - orange
    ws.Range("D6").Interior.Color = RGB(100, 149, 237) ' Conservative - cornflower
    ws.Range("E6").Interior.Color = RGB(144, 238, 144) ' Licensing - light green
    ws.Range("F6").Interior.Color = RGB(221, 160, 221) ' Corporate - plum
    ws.Range("G6").Interior.Color = RGB(135, 206, 235) ' Executive - sky blue
End Sub

Private Sub CreateNamedRangesV3(ByVal ws As Worksheet)
    '
    ' Creates named ranges for V3 formulas to reference
    '
    Dim wb As Workbook
    Set wb = ThisWorkbook

    ' Delete existing named ranges if they exist
    On Error Resume Next
    wb.Names("W_Aggressive").Delete
    wb.Names("W_Balanced").Delete
    wb.Names("W_Conservative").Delete
    wb.Names("W_Licensing").Delete
    wb.Names("W_Corporate").Delete
    wb.Names("W_Executive").Delete
    wb.Names("RelW_Aggressive").Delete
    wb.Names("RelW_Balanced").Delete
    wb.Names("RelW_Conservative").Delete
    wb.Names("RelW_Licensing").Delete
    wb.Names("RelW_Corporate").Delete
    wb.Names("RelW_Executive").Delete
    On Error GoTo 0

    ' Metric weight ranges (rows 7-16, 10 metrics)
    wb.Names.Add Name:="W_Aggressive", RefersTo:="=" & WEIGHTS_SHEET & "!$B$7:$B$16"
    wb.Names.Add Name:="W_Balanced", RefersTo:="=" & WEIGHTS_SHEET & "!$C$7:$C$16"
    wb.Names.Add Name:="W_Conservative", RefersTo:="=" & WEIGHTS_SHEET & "!$D$7:$D$16"
    wb.Names.Add Name:="W_Licensing", RefersTo:="=" & WEIGHTS_SHEET & "!$E$7:$E$16"
    wb.Names.Add Name:="W_Corporate", RefersTo:="=" & WEIGHTS_SHEET & "!$F$7:$F$16"
    wb.Names.Add Name:="W_Executive", RefersTo:="=" & WEIGHTS_SHEET & "!$G$7:$G$16"

    ' Relative weights for consensus (rows 27-32)
    wb.Names.Add Name:="RelW_Aggressive", RefersTo:="=" & WEIGHTS_SHEET & "!$B$27"
    wb.Names.Add Name:="RelW_Balanced", RefersTo:="=" & WEIGHTS_SHEET & "!$B$28"
    wb.Names.Add Name:="RelW_Conservative", RefersTo:="=" & WEIGHTS_SHEET & "!$B$29"
    wb.Names.Add Name:="RelW_Licensing", RefersTo:="=" & WEIGHTS_SHEET & "!$B$30"
    wb.Names.Add Name:="RelW_Corporate", RefersTo:="=" & WEIGHTS_SHEET & "!$B$31"
    wb.Names.Add Name:="RelW_Executive", RefersTo:="=" & WEIGHTS_SHEET & "!$B$32"
End Sub

'===============================================================================
' SCORING WORKSHEET GENERATION (V3 - 6 Profiles + Consensus)
'===============================================================================

Public Sub GenerateAllScoringWorksheets(ByVal topN As Integer)
    '
    ' Generates all 7 scoring worksheets (6 profiles + consensus)
    '
    Application.ScreenUpdating = False
    Application.Calculation = xlCalculationManual

    Dim dataRows As Long
    dataRows = GetRowCount(RAW_DATA_SHEET)

    If dataRows < 2 Then
        MsgBox "No data in RawData sheet. Please import data first.", vbExclamation
        Exit Sub
    End If

    ' Generate individual profile scoring sheets
    GenerateProfileScoringSheet "Score_IPLit_Aggr", "B", RGB(255, 99, 71), topN, dataRows
    GenerateProfileScoringSheet "Score_IPLit_Bal", "C", RGB(255, 165, 0), topN, dataRows
    GenerateProfileScoringSheet "Score_IPLit_Cons", "D", RGB(100, 149, 237), topN, dataRows
    GenerateProfileScoringSheet "Score_Licensing", "E", RGB(144, 238, 144), topN, dataRows
    GenerateProfileScoringSheet "Score_Corporate", "F", RGB(221, 160, 221), topN, dataRows
    GenerateProfileScoringSheet "Score_Executive", "G", RGB(135, 206, 235), topN, dataRows

    ' Generate consensus scoring sheet
    GenerateConsensusScoringSheet "Score_Consensus", topN, dataRows

    Application.Calculation = xlCalculationAutomatic
    Application.ScreenUpdating = True

    MsgBox "Generated 7 scoring worksheets (6 profiles + consensus) for " & topN & " patents.", vbInformation
End Sub

Private Sub GenerateProfileScoringSheet(ByVal sheetName As String, ByVal weightCol As String, _
                                         ByVal profileColor As Long, ByVal topN As Integer, ByVal dataRows As Long)
    '
    ' Generates a scoring worksheet for a specific stakeholder profile
    '
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

    Dim r As Long
    Dim srcSheet As String
    srcSheet = RAW_DATA_SHEET

    For r = 2 To rowsToGenerate + 1
        Dim srcRow As Long
        srcRow = r

        ws.Cells(r, 1).Value = r - 1  ' Rank
        ws.Cells(r, 2).Formula = "=" & srcSheet & "!" & COL_PATENT_ID & srcRow
        ws.Cells(r, 3).Formula = "=" & srcSheet & "!" & COL_TITLE & srcRow
        ws.Cells(r, 4).Formula = "=" & srcSheet & "!" & COL_YEARS_REMAINING & srcRow
        ws.Cells(r, 5).Formula = "=" & srcSheet & "!" & COL_COMPETITOR_CITATIONS & srcRow
        ws.Cells(r, 6).Formula = "=" & srcSheet & "!" & COL_COMPETITORS & srcRow
        ws.Cells(r, 7).Formula = "=" & srcSheet & "!" & COL_SECTOR & srcRow

        ' Year Multiplier: 0.3 + 0.7 * MIN(1, (years/15)^0.8)
        ws.Cells(r, 9).Formula = "=0.3+0.7*MIN(1,POWER(MAX(0," & srcSheet & "!" & COL_YEARS_REMAINING & srcRow & ")/15,0.8))"

        ' Base Score: Weighted sum of 10 normalized metrics
        ' Metrics: comp_cites, comp_count, fwd_cites, elig, valid, breadth, enforce, design, ipr, pros
        ws.Cells(r, 10).Formula = "=" & _
            "MIN(1," & srcSheet & "!" & COL_COMPETITOR_CITATIONS & srcRow & "/30)*" & WEIGHTS_SHEET & "!$" & weightCol & "$7+" & _
            "MIN(1," & srcSheet & "!" & COL_COMPETITOR_COUNT & srcRow & "/10)*" & WEIGHTS_SHEET & "!$" & weightCol & "$8+" & _
            "MIN(1,SQRT(" & srcSheet & "!" & COL_FORWARD_CITATIONS & srcRow & ")/20)*" & WEIGHTS_SHEET & "!$" & weightCol & "$9+" & _
            "IF(" & srcSheet & "!" & COL_ELIGIBILITY & srcRow & "="""",0.6," & srcSheet & "!" & COL_ELIGIBILITY & srcRow & "/5)*" & WEIGHTS_SHEET & "!$" & weightCol & "$10+" & _
            "IF(" & srcSheet & "!" & COL_VALIDITY & srcRow & "="""",0.6," & srcSheet & "!" & COL_VALIDITY & srcRow & "/5)*" & WEIGHTS_SHEET & "!$" & weightCol & "$11+" & _
            "IF(" & srcSheet & "!" & COL_CLAIM_BREADTH & srcRow & "="""",0.6," & srcSheet & "!" & COL_CLAIM_BREADTH & srcRow & "/5)*" & WEIGHTS_SHEET & "!$" & weightCol & "$12+" & _
            "IF(" & srcSheet & "!" & COL_ENFORCEMENT & srcRow & "="""",0.6," & srcSheet & "!" & COL_ENFORCEMENT & srcRow & "/5)*" & WEIGHTS_SHEET & "!$" & weightCol & "$13+" & _
            "IF(" & srcSheet & "!" & COL_DESIGN_AROUND & srcRow & "="""",0.6," & srcSheet & "!" & COL_DESIGN_AROUND & srcRow & "/5)*" & WEIGHTS_SHEET & "!$" & weightCol & "$14+" & _
            "IF(" & srcSheet & "!" & COL_IPR_RISK & srcRow & "="""",0.8," & srcSheet & "!" & COL_IPR_RISK & srcRow & "/5)*" & WEIGHTS_SHEET & "!$" & weightCol & "$15+" & _
            "IF(" & srcSheet & "!" & COL_PROSECUTION_QUALITY & srcRow & "="""",0.6," & srcSheet & "!" & COL_PROSECUTION_QUALITY & srcRow & "/5)*" & WEIGHTS_SHEET & "!$" & weightCol & "$16"

        ' Final Score = BaseScore * YearMult
        ws.Cells(r, 8).Formula = "=J" & r & "*I" & r
    Next r

    ' Format
    ws.Range("H2:H" & (rowsToGenerate + 1)).NumberFormat = "0.00%"
    ws.Range("I2:I" & (rowsToGenerate + 1)).NumberFormat = "0.00"
    ws.Range("J2:J" & (rowsToGenerate + 1)).NumberFormat = "0.00%"

    ' Sort by score descending
    ws.Sort.SortFields.Clear
    ws.Sort.SortFields.Add2 Key:=ws.Range("H2:H" & (rowsToGenerate + 1)), _
        SortOn:=xlSortOnValues, Order:=xlDescending, DataOption:=xlSortNormal
    With ws.Sort
        .SetRange ws.Range("A1:J" & (rowsToGenerate + 1))
        .Header = xlYes
        .Apply
    End With

    ' Update rank numbers after sort
    For r = 2 To rowsToGenerate + 1
        ws.Cells(r, 1).Value = r - 1
    Next r

    FormatHeaderRow ws
    ws.Range("H1").Interior.Color = profileColor
    ws.Columns("A:J").AutoFit
End Sub

Private Sub GenerateConsensusScoringSheet(ByVal sheetName As String, ByVal topN As Integer, ByVal dataRows As Long)
    '
    ' Generates the consensus scoring sheet with all 6 profile scores
    '
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

    Dim r As Long
    Dim srcSheet As String
    srcSheet = RAW_DATA_SHEET

    For r = 2 To rowsToGenerate + 1
        Dim srcRow As Long
        srcRow = r

        ws.Cells(r, 1).Value = r - 1  ' Rank
        ws.Cells(r, 2).Formula = "=" & srcSheet & "!" & COL_PATENT_ID & srcRow
        ws.Cells(r, 3).Formula = "=" & srcSheet & "!" & COL_TITLE & srcRow
        ws.Cells(r, 4).Formula = "=" & srcSheet & "!" & COL_YEARS_REMAINING & srcRow
        ws.Cells(r, 5).Formula = "=" & srcSheet & "!" & COL_COMPETITOR_CITATIONS & srcRow
        ws.Cells(r, 6).Formula = "=" & srcSheet & "!" & COL_COMPETITORS & srcRow
        ws.Cells(r, 7).Formula = "=" & srcSheet & "!" & COL_SECTOR & srcRow

        ' Year Multiplier
        ws.Cells(r, 9).Formula = "=0.3+0.7*MIN(1,POWER(MAX(0," & srcSheet & "!" & COL_YEARS_REMAINING & srcRow & ")/15,0.8))"

        ' Individual profile scores (each is BaseScore * YearMult)
        ' IPLit Aggressive (col B weights)
        ws.Cells(r, 10).Formula = "=(" & BuildBaseScoreFormula(srcSheet, srcRow, "B") & ")*I" & r
        ' IPLit Balanced (col C weights)
        ws.Cells(r, 11).Formula = "=(" & BuildBaseScoreFormula(srcSheet, srcRow, "C") & ")*I" & r
        ' IPLit Conservative (col D weights)
        ws.Cells(r, 12).Formula = "=(" & BuildBaseScoreFormula(srcSheet, srcRow, "D") & ")*I" & r
        ' Licensing (col E weights)
        ws.Cells(r, 13).Formula = "=(" & BuildBaseScoreFormula(srcSheet, srcRow, "E") & ")*I" & r
        ' Corporate (col F weights)
        ws.Cells(r, 14).Formula = "=(" & BuildBaseScoreFormula(srcSheet, srcRow, "F") & ")*I" & r
        ' Executive (col G weights)
        ws.Cells(r, 15).Formula = "=(" & BuildBaseScoreFormula(srcSheet, srcRow, "G") & ")*I" & r

        ' Consensus = weighted average of all 6 profiles
        ws.Cells(r, 8).Formula = "=" & _
            "J" & r & "*RelW_Aggressive+" & _
            "K" & r & "*RelW_Balanced+" & _
            "L" & r & "*RelW_Conservative+" & _
            "M" & r & "*RelW_Licensing+" & _
            "N" & r & "*RelW_Corporate+" & _
            "O" & r & "*RelW_Executive"
    Next r

    ' Format
    ws.Range("H2:H" & (rowsToGenerate + 1)).NumberFormat = "0.00%"
    ws.Range("I2:I" & (rowsToGenerate + 1)).NumberFormat = "0.00"
    ws.Range("J2:O" & (rowsToGenerate + 1)).NumberFormat = "0.00%"

    ' Sort by consensus score descending
    ws.Sort.SortFields.Clear
    ws.Sort.SortFields.Add2 Key:=ws.Range("H2:H" & (rowsToGenerate + 1)), _
        SortOn:=xlSortOnValues, Order:=xlDescending, DataOption:=xlSortNormal
    With ws.Sort
        .SetRange ws.Range("A1:O" & (rowsToGenerate + 1))
        .Header = xlYes
        .Apply
    End With

    ' Update rank numbers
    For r = 2 To rowsToGenerate + 1
        ws.Cells(r, 1).Value = r - 1
    Next r

    FormatHeaderRow ws

    ' Color headers
    ws.Range("H1").Interior.Color = RGB(128, 128, 128)   ' Consensus - gray
    ws.Range("I1").Interior.Color = RGB(255, 215, 0)     ' YearMult - gold
    ws.Range("J1").Interior.Color = RGB(255, 99, 71)     ' Aggressive - tomato
    ws.Range("K1").Interior.Color = RGB(255, 165, 0)     ' Balanced - orange
    ws.Range("L1").Interior.Color = RGB(100, 149, 237)   ' Conservative - cornflower
    ws.Range("M1").Interior.Color = RGB(144, 238, 144)   ' Licensing - light green
    ws.Range("N1").Interior.Color = RGB(221, 160, 221)   ' Corporate - plum
    ws.Range("O1").Interior.Color = RGB(135, 206, 235)   ' Executive - sky blue

    ws.Columns("A:O").AutoFit
End Sub

Private Function BuildBaseScoreFormula(ByVal srcSheet As String, ByVal srcRow As Long, ByVal weightCol As String) As String
    '
    ' Builds the base score formula for a given weight column
    '
    BuildBaseScoreFormula = _
        "MIN(1," & srcSheet & "!" & COL_COMPETITOR_CITATIONS & srcRow & "/30)*" & WEIGHTS_SHEET & "!$" & weightCol & "$7+" & _
        "MIN(1," & srcSheet & "!" & COL_COMPETITOR_COUNT & srcRow & "/10)*" & WEIGHTS_SHEET & "!$" & weightCol & "$8+" & _
        "MIN(1,SQRT(" & srcSheet & "!" & COL_FORWARD_CITATIONS & srcRow & ")/20)*" & WEIGHTS_SHEET & "!$" & weightCol & "$9+" & _
        "IF(" & srcSheet & "!" & COL_ELIGIBILITY & srcRow & "="""",0.6," & srcSheet & "!" & COL_ELIGIBILITY & srcRow & "/5)*" & WEIGHTS_SHEET & "!$" & weightCol & "$10+" & _
        "IF(" & srcSheet & "!" & COL_VALIDITY & srcRow & "="""",0.6," & srcSheet & "!" & COL_VALIDITY & srcRow & "/5)*" & WEIGHTS_SHEET & "!$" & weightCol & "$11+" & _
        "IF(" & srcSheet & "!" & COL_CLAIM_BREADTH & srcRow & "="""",0.6," & srcSheet & "!" & COL_CLAIM_BREADTH & srcRow & "/5)*" & WEIGHTS_SHEET & "!$" & weightCol & "$12+" & _
        "IF(" & srcSheet & "!" & COL_ENFORCEMENT & srcRow & "="""",0.6," & srcSheet & "!" & COL_ENFORCEMENT & srcRow & "/5)*" & WEIGHTS_SHEET & "!$" & weightCol & "$13+" & _
        "IF(" & srcSheet & "!" & COL_DESIGN_AROUND & srcRow & "="""",0.6," & srcSheet & "!" & COL_DESIGN_AROUND & srcRow & "/5)*" & WEIGHTS_SHEET & "!$" & weightCol & "$14+" & _
        "IF(" & srcSheet & "!" & COL_IPR_RISK & srcRow & "="""",0.8," & srcSheet & "!" & COL_IPR_RISK & srcRow & "/5)*" & WEIGHTS_SHEET & "!$" & weightCol & "$15+" & _
        "IF(" & srcSheet & "!" & COL_PROSECUTION_QUALITY & srcRow & "="""",0.6," & srcSheet & "!" & COL_PROSECUTION_QUALITY & srcRow & "/5)*" & WEIGHTS_SHEET & "!$" & weightCol & "$16"
End Function

'===============================================================================
' CLEAR/RESET FUNCTIONS
'===============================================================================

Public Sub ClearAllDataSheets()
    '
    ' Clears all data from worksheets
    '
    Dim sheetNames As Variant
    sheetNames = Array(RAW_DATA_SHEET, "Score_IPLit_Aggr", "Score_IPLit_Bal", "Score_IPLit_Cons", _
                       "Score_Licensing", "Score_Corporate", "Score_Executive", "Score_Consensus")

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

Public Sub DeleteAllGeneratedSheets()
    '
    ' Deletes all generated worksheets (use with caution)
    '
    Dim sheetNames As Variant
    sheetNames = Array("Score_IPLit_Aggr", "Score_IPLit_Bal", "Score_IPLit_Cons", _
                       "Score_Licensing", "Score_Corporate", "Score_Executive", "Score_Consensus")

    Application.DisplayAlerts = False

    Dim i As Integer
    For i = 0 To UBound(sheetNames)
        On Error Resume Next
        ThisWorkbook.Sheets(sheetNames(i)).Delete
        On Error GoTo 0
    Next i

    Application.DisplayAlerts = True

    MsgBox "Generated sheets deleted.", vbInformation
End Sub

'===============================================================================
' HELPER FUNCTIONS
'===============================================================================

Private Function GetOrCreateSheet(ByVal sheetName As String) As Worksheet
    '
    ' Gets existing sheet or creates new one
    '
    On Error Resume Next
    Set GetOrCreateSheet = ThisWorkbook.Sheets(sheetName)
    On Error GoTo 0

    If GetOrCreateSheet Is Nothing Then
        Set GetOrCreateSheet = ThisWorkbook.Sheets.Add(After:=ThisWorkbook.Sheets(ThisWorkbook.Sheets.Count))
        GetOrCreateSheet.Name = sheetName
    End If
End Function

Private Function GetRowCount(ByVal sheetName As String) As Long
    '
    ' Returns the number of rows with data in a sheet
    '
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
    '
    ' Opens file dialog for manual file selection
    '
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
    '
    ' Formats the header row with standard styling
    '
    With ws.Rows(headerRow)
        .Font.Bold = True
        .Interior.Color = RGB(26, 26, 46)  ' Dark blue
        .Font.Color = RGB(255, 255, 255)   ' White text
    End With
End Sub
