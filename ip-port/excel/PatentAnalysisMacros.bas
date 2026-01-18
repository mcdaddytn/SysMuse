Attribute VB_Name = "PatentAnalysisMacros"
'===============================================================================
' Patent Portfolio Analysis - VBA Macros
'===============================================================================
' Version: 2.0 (V2 Scoring)
' Description: Macros for importing patent data, generating scoring worksheets,
'              and managing user weight profiles for dynamic patent scoring.
'
' V2 SCORING CHANGES:
'   - Non-linear year normalization: (years/15)^1.5
'   - Multiplicative year factor: Score = BaseScore × YearMultiplier
'   - YearMultiplier = 0.3 + 0.7 × (years/15)^0.8
'   - Years not included in weighted sum (applied multiplicatively instead)
'
' Worksheet Structure:
'   - RawData: Imported patent metrics (from CSV)
'   - UserWeights: User weight profiles and relative weights
'   - Score_Aggressive: Top N patents scored with aggressive weights
'   - Score_Moderate: Top N patents scored with moderate weights
'   - Score_Conservative: Top N patents scored with conservative weights
'   - Score_Combined: Top N patents with weighted average across users
'
' Usage:
'   1. Run ImportAllData() or ImportAllDataWithPrefix("prefix")
'   2. Modify weights in UserWeights sheet
'   3. Scores update automatically via formulas
'
' Author: Generated for IP Portfolio Analysis Platform
' Last Updated: 2026-01-17 (V2 scoring update)
'===============================================================================

Option Explicit

' Configuration Constants
Private Const DEFAULT_TOP_N As Integer = 250
Private Const DATA_START_ROW As Integer = 2
Private Const WEIGHTS_SHEET As String = "UserWeights"
Private Const RAW_DATA_SHEET As String = "RawData"

' File naming convention (V3)
' TOP250-YYYY-MM-DD.csv  - Filtered top 250 for vendor work (IMPORT THIS)
' TOP250-LATEST.csv      - Fallback copy of most recent export
Private Const FILE_PREFIX As String = "TOP250-"
Private Const FILE_LATEST As String = "TOP250-LATEST.csv"

' Column mappings for RawData sheet (must match CSV export - 44 columns)
' Core patent data (A-J)
Private Const COL_PATENT_ID As String = "A"
Private Const COL_TITLE As String = "B"
Private Const COL_GRANT_DATE As String = "C"
Private Const COL_ASSIGNEE As String = "D"
Private Const COL_YEARS_REMAINING As String = "E"
Private Const COL_FORWARD_CITATIONS As String = "F"
Private Const COL_COMPETITOR_CITATIONS As String = "G"
Private Const COL_COMPETITORS_CITING As String = "H"
Private Const COL_SECTOR As String = "I"
Private Const COL_CPC_CODES As String = "J"
' LLM scores (K-U)
Private Const COL_ELIGIBILITY As String = "K"
Private Const COL_VALIDITY As String = "L"
Private Const COL_CLAIM_BREADTH As String = "M"
Private Const COL_CLAIM_CLARITY As String = "N"
Private Const COL_ENFORCEMENT As String = "O"
Private Const COL_DESIGN_AROUND As String = "P"
Private Const COL_EVIDENCE_ACCESS As String = "Q"
Private Const COL_MARKET_RELEVANCE As String = "R"
Private Const COL_TREND_ALIGNMENT As String = "S"
Private Const COL_INVESTIGATION_PRIORITY As String = "T"
Private Const COL_LLM_CONFIDENCE As String = "U"
' V3 cross-sector signals (V-AE)
Private Const COL_IMPLEMENTATION_TYPE As String = "V"
Private Const COL_STANDARDS_RELEVANCE As String = "W"
' IPR risk (AF-AI)
Private Const COL_IPR_RISK_SCORE As String = "AF"
Private Const COL_IPR_RISK_CATEGORY As String = "AG"
' Prosecution history (AJ-AN)
Private Const COL_PROS_QUALITY_SCORE As String = "AJ"
Private Const COL_PROS_QUALITY_CATEGORY As String = "AK"
Private Const COL_OFFICE_ACTIONS As String = "AL"
Private Const COL_RCE_COUNT As String = "AM"

'===============================================================================
' PUBLIC ENTRY POINTS - No-Argument Wrappers
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
    ' These files contain ONLY the filtered top 250 patents with 3+ years remaining.
    ' DO NOT import patents-raw-metrics-*.csv (contains expired patents)
    '
    Dim csvPath As String
    Dim dateStr As String

    ' Try today's file first
    dateStr = Format(Date, "yyyy-mm-dd")
    csvPath = FindTop250File(dateStr)

    If csvPath = "" Then
        MsgBox "Could not find TOP250 file for today (" & dateStr & ")." & vbCrLf & vbCrLf & _
               "Run this command first:" & vbCrLf & _
               "npx tsx scripts/export-top250-for-excel.ts" & vbCrLf & vbCrLf & _
               "Click OK to select a file manually.", vbExclamation
        csvPath = SelectFile("Select Top 250 CSV (NOT raw-metrics!)", "CSV Files (*.csv),*.csv")
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

    ' Try 1: excel/TOP250-YYYY-MM-DD.csv
    tryPath = basePath & "TOP250-" & dateStr & ".csv"
    If FileExists(tryPath) Then
        FindTop250File = tryPath
        Exit Function
    End If

    ' Try 2: TOP250-YYYY-MM-DD.csv in same directory
    tryPath = basePath & "..\excel\TOP250-" & dateStr & ".csv"
    If FileExists(tryPath) Then
        FindTop250File = tryPath
        Exit Function
    End If

    ' Try 3: TOP250-LATEST.csv fallback
    tryPath = basePath & "TOP250-LATEST.csv"
    If FileExists(tryPath) Then
        FindTop250File = tryPath
        Exit Function
    End If

    tryPath = basePath & "..\excel\TOP250-LATEST.csv"
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
               "Expected ~250. You may have imported the wrong file." & vbCrLf & vbCrLf & _
               "Use TOP250-*.csv, NOT patents-raw-metrics-*.csv", vbExclamation
    End If

    ' Create weights sheet and scoring worksheets
    CreateUserWeightsSheet
    GenerateScoringWorksheets DEFAULT_TOP_N

    MsgBox "Imported " & rowCount & " patents from:" & vbCrLf & csvPath, vbInformation

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

Public Sub GenerateAllWorksheets()
    ' No-argument wrapper for worksheet generation
    GenerateScoringWorksheets DEFAULT_TOP_N
End Sub

Public Sub ClearAllData()
    ' No-argument wrapper for clearing data
    ClearAllDataSheets
End Sub

Public Sub RefreshAll()
    ' Full refresh: clear, import, generate
    Dim prefix As String
    prefix = "patents-raw-metrics-2026-01-17"  ' <-- Change this for new imports

    ClearAllDataSheets
    ImportAllDataWithPrefix prefix
    GenerateScoringWorksheets DEFAULT_TOP_N
End Sub

'===============================================================================
' IMPORT FUNCTIONS
'===============================================================================

Public Sub ImportAllDataWithPrefix(ByVal filePrefix As String)
    '
    ' Imports raw metrics CSV and user weights JSON
    '
    ' Parameters:
    '   filePrefix - Common prefix for data files (e.g., "patents-raw-metrics-2026-01-17")
    '
    Application.ScreenUpdating = False
    Application.Calculation = xlCalculationManual

    On Error GoTo ErrorHandler

    ' Import raw metrics CSV
    Dim csvPath As String
    csvPath = GetImportFilePath(filePrefix & ".csv")

    If csvPath <> "" Then
        ImportCSVToSheet csvPath, RAW_DATA_SHEET
        MsgBox "Imported " & GetRowCount(RAW_DATA_SHEET) & " patents from CSV.", vbInformation
    Else
        MsgBox "CSV file not found. Please select the file manually.", vbExclamation
        csvPath = SelectFile("Select Patent Metrics CSV", "CSV Files (*.csv),*.csv")
        If csvPath <> "" Then
            ImportCSVToSheet csvPath, RAW_DATA_SHEET
        End If
    End If

    ' Create or update user weights sheet
    CreateUserWeightsSheet

    ' Generate scoring worksheets
    GenerateScoringWorksheets DEFAULT_TOP_N

    Application.Calculation = xlCalculationAutomatic
    Application.ScreenUpdating = True
    Exit Sub

ErrorHandler:
    Application.Calculation = xlCalculationAutomatic
    Application.ScreenUpdating = True
    MsgBox "Error during import: " & Err.Description, vbCritical
End Sub

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
' USER WEIGHTS SHEET CREATION
'===============================================================================

Private Sub CreateUserWeightsSheet()
    '
    ' Creates the UserWeights sheet with default profiles
    '
    Dim ws As Worksheet
    Set ws = GetOrCreateSheet(WEIGHTS_SHEET)
    ws.Cells.Clear

    ' === Section 1: Metric Weights by User Profile ===
    ws.Range("A1").Value = "METRIC WEIGHTS BY USER PROFILE"
    ws.Range("A1").Font.Bold = True
    ws.Range("A1").Font.Size = 14

    ' Headers
    ws.Range("A3").Value = "Metric"
    ws.Range("B3").Value = "Aggressive"
    ws.Range("C3").Value = "Moderate"
    ws.Range("D3").Value = "Conservative"
    ws.Range("E3").Value = "Description"

    ' Metric weights (rows 4-12) - 9 metrics (years applied multiplicatively in V2)
    ' V2 NOTE: years_remaining is NOT in this list - applied as multiplier to final score
    Dim metrics As Variant
    metrics = Array( _
        Array("competitor_citations", 0.22, 0.17, 0.11, "Citations from tracked competitors"), _
        Array("forward_citations", 0.06, 0.11, 0.11, "Total forward citations"), _
        Array("eligibility_score", 0.17, 0.17, 0.11, "101 patent eligibility (LLM)"), _
        Array("validity_score", 0.11, 0.17, 0.22, "Prior art strength (LLM)"), _
        Array("claim_breadth", 0.06, 0.11, 0.17, "Claim scope (LLM)"), _
        Array("enforcement_clarity", 0.17, 0.11, 0.06, "Infringement detectability (LLM)"), _
        Array("design_around_difficulty", 0.06, 0.06, 0.11, "Difficulty to design around (LLM)"), _
        Array("ipr_risk_score", 0.05, 0.05, 0.05, "IPR/PTAB risk (5=clean, 1=high risk)"), _
        Array("prosecution_quality_score", 0.1, 0.05, 0.06, "Prosecution history quality (5=clean)") _
    )

    Dim i As Integer
    For i = 0 To UBound(metrics)
        ws.Range("A" & (4 + i)).Value = metrics(i)(0)
        ws.Range("B" & (4 + i)).Value = metrics(i)(1)
        ws.Range("C" & (4 + i)).Value = metrics(i)(2)
        ws.Range("D" & (4 + i)).Value = metrics(i)(3)
        ws.Range("E" & (4 + i)).Value = metrics(i)(4)
    Next i

    ' Total row (now row 13 with 9 metrics - V2)
    ws.Range("A13").Value = "TOTAL"
    ws.Range("A13").Font.Bold = True
    ws.Range("B13").Formula = "=SUM(B4:B12)"
    ws.Range("C13").Formula = "=SUM(C4:C12)"
    ws.Range("D13").Formula = "=SUM(D4:D12)"

    ' Format weights as percentages
    ws.Range("B4:D13").NumberFormat = "0%"

    ' V2: Year Multiplier Info (row 15)
    ws.Range("A15").Value = "YEAR MULTIPLIER (V2)"
    ws.Range("A15").Font.Bold = True
    ws.Range("A16").Value = "Formula: 0.3 + 0.7 × (years/15)^0.8"
    ws.Range("A17").Value = "Applied multiplicatively to base score"

    ' === Section 2: User Relative Weights ===
    ws.Range("A19").Value = "USER RELATIVE WEIGHTS"
    ws.Range("A19").Font.Bold = True
    ws.Range("A19").Font.Size = 14

    ws.Range("A21").Value = "User Profile"
    ws.Range("B21").Value = "Relative Weight"
    ws.Range("C21").Value = "Description"

    ws.Range("A22").Value = "Aggressive"
    ws.Range("B22").Value = 0.33
    ws.Range("C22").Value = "Litigation-focused strategy"

    ws.Range("A23").Value = "Moderate"
    ws.Range("B23").Value = 0.34
    ws.Range("C23").Value = "Balanced approach"

    ws.Range("A24").Value = "Conservative"
    ws.Range("B24").Value = 0.33
    ws.Range("C24").Value = "Defensive posture"

    ws.Range("A25").Value = "TOTAL"
    ws.Range("A25").Font.Bold = True
    ws.Range("B25").Formula = "=SUM(B22:B24)"

    ws.Range("B22:B25").NumberFormat = "0%"

    ' === Create Named Ranges ===
    CreateNamedRanges ws

    ' === Format ===
    FormatHeaderRow ws, 3
    FormatHeaderRow ws, 21
    ws.Columns("A:E").AutoFit

    ' Color coding for user profiles
    ws.Range("B3").Interior.Color = RGB(255, 107, 107)  ' Aggressive - red
    ws.Range("C3").Interior.Color = RGB(78, 205, 196)   ' Moderate - teal
    ws.Range("D3").Interior.Color = RGB(69, 183, 209)   ' Conservative - blue
End Sub

Private Sub CreateNamedRanges(ByVal ws As Worksheet)
    '
    ' Creates named ranges for formulas to reference
    '
    Dim wb As Workbook
    Set wb = ThisWorkbook

    ' Delete existing named ranges if they exist
    On Error Resume Next
    wb.Names("W_Aggressive").Delete
    wb.Names("W_Moderate").Delete
    wb.Names("W_Conservative").Delete
    wb.Names("RelWeight_Aggressive").Delete
    wb.Names("RelWeight_Moderate").Delete
    wb.Names("RelWeight_Conservative").Delete
    On Error GoTo 0

    ' Metric weight ranges (for each user profile) - V2: 9 metrics (rows 4-12)
    wb.Names.Add Name:="W_Aggressive", RefersTo:="=" & WEIGHTS_SHEET & "!$B$4:$B$12"
    wb.Names.Add Name:="W_Moderate", RefersTo:="=" & WEIGHTS_SHEET & "!$C$4:$C$12"
    wb.Names.Add Name:="W_Conservative", RefersTo:="=" & WEIGHTS_SHEET & "!$D$4:$D$12"

    ' Relative weights for combined view (V2: rows 22-24)
    wb.Names.Add Name:="RelWeight_Aggressive", RefersTo:="=" & WEIGHTS_SHEET & "!$B$22"
    wb.Names.Add Name:="RelWeight_Moderate", RefersTo:="=" & WEIGHTS_SHEET & "!$B$23"
    wb.Names.Add Name:="RelWeight_Conservative", RefersTo:="=" & WEIGHTS_SHEET & "!$B$24"
End Sub

'===============================================================================
' SCORING WORKSHEET GENERATION
'===============================================================================

Public Sub GenerateScoringWorksheets(ByVal topN As Integer)
    '
    ' Generates all scoring worksheets with formulas
    '
    Application.ScreenUpdating = False
    Application.Calculation = xlCalculationManual

    ' Get row count from raw data
    Dim dataRows As Long
    dataRows = GetRowCount(RAW_DATA_SHEET)

    If dataRows < 2 Then
        MsgBox "No data in RawData sheet. Please import data first.", vbExclamation
        Exit Sub
    End If

    ' Generate individual user scoring sheets
    GenerateUserScoringSheet "Score_Aggressive", "Aggressive", topN, dataRows
    GenerateUserScoringSheet "Score_Moderate", "Moderate", topN, dataRows
    GenerateUserScoringSheet "Score_Conservative", "Conservative", topN, dataRows

    ' Generate combined scoring sheet
    GenerateCombinedScoringSheet "Score_Combined", topN, dataRows

    Application.Calculation = xlCalculationAutomatic
    Application.ScreenUpdating = True

    MsgBox "Generated scoring worksheets for top " & topN & " patents.", vbInformation
End Sub

Private Sub GenerateUserScoringSheet(ByVal sheetName As String, ByVal userProfile As String, _
                                      ByVal topN As Integer, ByVal dataRows As Long)
    '
    ' Generates a scoring worksheet for a specific user profile
    '
    Dim ws As Worksheet
    Set ws = GetOrCreateSheet(sheetName)
    ws.Cells.Clear

    ' Headers (V2: 9 metrics + year multiplier)
    ws.Range("A1").Value = "Rank"
    ws.Range("B1").Value = "Patent ID"
    ws.Range("C1").Value = "Title"
    ws.Range("D1").Value = "Grant Date"
    ws.Range("E1").Value = "Years Rem"
    ws.Range("F1").Value = "Fwd Cites"
    ws.Range("G1").Value = "Comp Cites"
    ws.Range("H1").Value = "Competitors"
    ws.Range("I1").Value = "Sector"
    ws.Range("J1").Value = "V2 Score"
    ws.Range("K1").Value = "YearMult"
    ws.Range("L1").Value = "BaseScore"
    ws.Range("M1").Value = "Norm_CompCites"
    ws.Range("N1").Value = "Norm_FwdCites"
    ws.Range("O1").Value = "Norm_Elig"
    ws.Range("P1").Value = "Norm_Valid"
    ws.Range("Q1").Value = "Norm_Breadth"
    ws.Range("R1").Value = "Norm_Enforce"
    ws.Range("S1").Value = "Norm_Design"
    ws.Range("T1").Value = "IPR_Risk"
    ws.Range("U1").Value = "Pros_Quality"

    ' Determine how many rows to generate (min of topN and available data)
    Dim rowsToGenerate As Long
    rowsToGenerate = Application.WorksheetFunction.Min(topN, dataRows - 1)

    ' Weight reference based on user profile
    Dim weightCol As String
    Select Case userProfile
        Case "Aggressive": weightCol = "B"
        Case "Moderate": weightCol = "C"
        Case "Conservative": weightCol = "D"
    End Select

    ' Generate formulas for each row
    Dim r As Long
    For r = 2 To rowsToGenerate + 1
        ' Rank
        ws.Cells(r, 1).Value = r - 1

        ' Use LARGE to find the r-1 largest score, then INDEX/MATCH to get data
        ' First, we need to calculate scores in a helper area or use array formulas
        ' For simplicity, we'll reference RawData directly and calculate inline

        ' Patent ID - use INDEX/MATCH based on score rank
        ws.Cells(r, 2).Formula = "=INDEX(" & RAW_DATA_SHEET & "!A:A,MATCH(LARGE(ScoreHelper_" & userProfile & "," & (r - 1) & "),ScoreHelper_" & userProfile & ",0))"

        ' For now, create a simpler version that copies data with score calculation
        ' We'll use a different approach: calculate score in RawData, then sort
    Next r

    ' Alternative approach: Generate scoring formulas directly referencing RawData
    ' This is more maintainable and updates dynamically
    GenerateScoringFormulas ws, userProfile, weightCol, rowsToGenerate

    FormatHeaderRow ws
    ws.Columns("A:U").AutoFit

    ' Color the score column header based on profile
    Select Case userProfile
        Case "Aggressive": ws.Range("J1").Interior.Color = RGB(255, 107, 107)
        Case "Moderate": ws.Range("J1").Interior.Color = RGB(78, 205, 196)
        Case "Conservative": ws.Range("J1").Interior.Color = RGB(69, 183, 209)
    End Select
End Sub

Private Sub GenerateScoringFormulas(ByVal ws As Worksheet, ByVal userProfile As String, _
                                     ByVal weightCol As String, ByVal rowCount As Long)
    '
    ' Generates the actual scoring formulas for a user profile sheet
    ' Uses a sorted approach: first calculates all scores, then ranks
    '
    Dim r As Long
    Dim srcSheet As String
    srcSheet = RAW_DATA_SHEET

    ' First pass: Copy data and add score formula for first rowCount patents
    ' In production, you'd want to sort by score - for now we'll add the score column

    For r = 2 To rowCount + 1
        Dim srcRow As Long
        srcRow = r  ' For unsorted, just use same row; sorted version would use MATCH

        ' Direct references to RawData
        ws.Cells(r, 1).Value = r - 1  ' Rank (will be recalculated after sort)
        ws.Cells(r, 2).Formula = "=" & srcSheet & "!A" & srcRow  ' Patent ID
        ws.Cells(r, 3).Formula = "=" & srcSheet & "!B" & srcRow  ' Title
        ws.Cells(r, 4).Formula = "=" & srcSheet & "!C" & srcRow  ' Grant Date
        ws.Cells(r, 5).Formula = "=" & srcSheet & "!E" & srcRow  ' Years Remaining
        ws.Cells(r, 6).Formula = "=" & srcSheet & "!F" & srcRow  ' Forward Citations
        ws.Cells(r, 7).Formula = "=" & srcSheet & "!G" & srcRow  ' Competitor Citations
        ws.Cells(r, 8).Formula = "=" & srcSheet & "!H" & srcRow  ' Competitors Citing
        ws.Cells(r, 9).Formula = "=" & srcSheet & "!I" & srcRow  ' Sector

        ' V2: Year Multiplier (column K) - formula: 0.3 + 0.7 * MIN(1,(years/15)^0.8)
        ws.Cells(r, 11).Formula = "=0.3+0.7*MIN(1,POWER(MAX(0," & srcSheet & "!E" & srcRow & ")/15,0.8))"

        ' Normalized values (columns M-U for 9 metrics - V2, no years in weighted sum)
        ws.Cells(r, 13).Formula = "=MIN(1," & srcSheet & "!G" & srcRow & "/20)"  ' Norm Comp Cites
        ws.Cells(r, 14).Formula = "=MIN(1,SQRT(" & srcSheet & "!F" & srcRow & ")/30)"  ' Norm Fwd Cites
        ws.Cells(r, 15).Formula = "=IF(" & srcSheet & "!K" & srcRow & "=""""," & "0," & srcSheet & "!K" & srcRow & "/5)"  ' Norm Eligibility
        ws.Cells(r, 16).Formula = "=IF(" & srcSheet & "!L" & srcRow & "=""""," & "0," & srcSheet & "!L" & srcRow & "/5)"  ' Norm Validity
        ws.Cells(r, 17).Formula = "=IF(" & srcSheet & "!M" & srcRow & "=""""," & "0," & srcSheet & "!M" & srcRow & "/5)"  ' Norm Breadth
        ws.Cells(r, 18).Formula = "=IF(" & srcSheet & "!O" & srcRow & "=""""," & "0," & srcSheet & "!O" & srcRow & "/5)"  ' Norm Enforcement (col O)
        ws.Cells(r, 19).Formula = "=IF(" & srcSheet & "!P" & srcRow & "=""""," & "0," & srcSheet & "!P" & srcRow & "/5)"  ' Norm Design Around (col P)
        ws.Cells(r, 20).Formula = "=IF(" & srcSheet & "!AF" & srcRow & "=""""," & "0," & srcSheet & "!AF" & srcRow & "/5)"  ' IPR Risk Score (col AF)
        ws.Cells(r, 21).Formula = "=IF(" & srcSheet & "!AJ" & srcRow & "=""""," & "0," & srcSheet & "!AJ" & srcRow & "/5)"  ' Prosecution Quality (col AJ)

        ' V2: Base Score (column L) - weighted sum of 9 metrics (rows 4-12 in UserWeights)
        ws.Cells(r, 12).Formula = "=" & _
            "M" & r & "*" & WEIGHTS_SHEET & "!$" & weightCol & "$4+" & _
            "N" & r & "*" & WEIGHTS_SHEET & "!$" & weightCol & "$5+" & _
            "O" & r & "*" & WEIGHTS_SHEET & "!$" & weightCol & "$6+" & _
            "P" & r & "*" & WEIGHTS_SHEET & "!$" & weightCol & "$7+" & _
            "Q" & r & "*" & WEIGHTS_SHEET & "!$" & weightCol & "$8+" & _
            "R" & r & "*" & WEIGHTS_SHEET & "!$" & weightCol & "$9+" & _
            "S" & r & "*" & WEIGHTS_SHEET & "!$" & weightCol & "$10+" & _
            "T" & r & "*" & WEIGHTS_SHEET & "!$" & weightCol & "$11+" & _
            "U" & r & "*" & WEIGHTS_SHEET & "!$" & weightCol & "$12"

        ' V2: Final Score (column J) = BaseScore * YearMultiplier
        ws.Cells(r, 10).Formula = "=L" & r & "*K" & r
    Next r

    ' Format score columns (V2)
    ws.Range("J2:J" & (rowCount + 1)).NumberFormat = "0.00%"
    ws.Range("K2:K" & (rowCount + 1)).NumberFormat = "0.00"  ' Year Multiplier
    ws.Range("L2:L" & (rowCount + 1)).NumberFormat = "0.00%"  ' Base Score
    ws.Range("M2:U" & (rowCount + 1)).NumberFormat = "0.00"

    ' Sort by V2 score descending
    ws.Sort.SortFields.Clear
    ws.Sort.SortFields.Add2 Key:=ws.Range("J2:J" & (rowCount + 1)), _
        SortOn:=xlSortOnValues, Order:=xlDescending, DataOption:=xlSortNormal
    With ws.Sort
        .SetRange ws.Range("A1:U" & (rowCount + 1))
        .Header = xlYes
        .Apply
    End With

    ' Update rank numbers after sort
    For r = 2 To rowCount + 1
        ws.Cells(r, 1).Value = r - 1
    Next r
End Sub

Private Sub GenerateCombinedScoringSheet(ByVal sheetName As String, ByVal topN As Integer, ByVal dataRows As Long)
    '
    ' Generates the combined scoring sheet using weighted average of all user profiles
    '
    Dim ws As Worksheet
    Set ws = GetOrCreateSheet(sheetName)
    ws.Cells.Clear

    ' Headers (V2)
    ws.Range("A1").Value = "Rank"
    ws.Range("B1").Value = "Patent ID"
    ws.Range("C1").Value = "Title"
    ws.Range("D1").Value = "Grant Date"
    ws.Range("E1").Value = "Years Rem"
    ws.Range("F1").Value = "Fwd Cites"
    ws.Range("G1").Value = "Comp Cites"
    ws.Range("H1").Value = "Competitors"
    ws.Range("I1").Value = "Sector"
    ws.Range("J1").Value = "V2 Combined"
    ws.Range("K1").Value = "YearMult"
    ws.Range("L1").Value = "Aggressive"
    ws.Range("M1").Value = "Moderate"
    ws.Range("N1").Value = "Conservative"

    Dim rowsToGenerate As Long
    rowsToGenerate = Application.WorksheetFunction.Min(topN, dataRows - 1)

    Dim r As Long
    Dim srcSheet As String
    srcSheet = RAW_DATA_SHEET

    For r = 2 To rowsToGenerate + 1
        Dim srcRow As Long
        srcRow = r

        ws.Cells(r, 1).Value = r - 1  ' Rank
        ws.Cells(r, 2).Formula = "=" & srcSheet & "!A" & srcRow
        ws.Cells(r, 3).Formula = "=" & srcSheet & "!B" & srcRow
        ws.Cells(r, 4).Formula = "=" & srcSheet & "!C" & srcRow
        ws.Cells(r, 5).Formula = "=" & srcSheet & "!E" & srcRow
        ws.Cells(r, 6).Formula = "=" & srcSheet & "!F" & srcRow
        ws.Cells(r, 7).Formula = "=" & srcSheet & "!G" & srcRow
        ws.Cells(r, 8).Formula = "=" & srcSheet & "!H" & srcRow
        ws.Cells(r, 9).Formula = "=" & srcSheet & "!I" & srcRow

        ' V2: Year Multiplier (column K) - formula: 0.3 + 0.7 * MIN(1,(years/15)^0.8)
        ws.Cells(r, 11).Formula = "=0.3+0.7*MIN(1,POWER(MAX(0," & srcSheet & "!E" & srcRow & ")/15,0.8))"

        ' V2: Individual user BASE scores (9 metrics, rows 4-12 in UserWeights)
        ' Aggressive Base Score
        ws.Cells(r, 12).Formula = "=(" & _
            "MIN(1," & srcSheet & "!G" & srcRow & "/20)*" & WEIGHTS_SHEET & "!$B$4+" & _
            "MIN(1,SQRT(" & srcSheet & "!F" & srcRow & ")/30)*" & WEIGHTS_SHEET & "!$B$5+" & _
            "IF(" & srcSheet & "!K" & srcRow & "="""",0," & srcSheet & "!K" & srcRow & "/5)*" & WEIGHTS_SHEET & "!$B$6+" & _
            "IF(" & srcSheet & "!L" & srcRow & "="""",0," & srcSheet & "!L" & srcRow & "/5)*" & WEIGHTS_SHEET & "!$B$7+" & _
            "IF(" & srcSheet & "!M" & srcRow & "="""",0," & srcSheet & "!M" & srcRow & "/5)*" & WEIGHTS_SHEET & "!$B$8+" & _
            "IF(" & srcSheet & "!O" & srcRow & "="""",0," & srcSheet & "!O" & srcRow & "/5)*" & WEIGHTS_SHEET & "!$B$9+" & _
            "IF(" & srcSheet & "!P" & srcRow & "="""",0," & srcSheet & "!P" & srcRow & "/5)*" & WEIGHTS_SHEET & "!$B$10+" & _
            "IF(" & srcSheet & "!AF" & srcRow & "="""",0," & srcSheet & "!AF" & srcRow & "/5)*" & WEIGHTS_SHEET & "!$B$11+" & _
            "IF(" & srcSheet & "!AJ" & srcRow & "="""",0," & srcSheet & "!AJ" & srcRow & "/5)*" & WEIGHTS_SHEET & "!$B$12)*K" & r

        ' Moderate Base Score × YearMult
        ws.Cells(r, 13).Formula = "=(" & _
            "MIN(1," & srcSheet & "!G" & srcRow & "/20)*" & WEIGHTS_SHEET & "!$C$4+" & _
            "MIN(1,SQRT(" & srcSheet & "!F" & srcRow & ")/30)*" & WEIGHTS_SHEET & "!$C$5+" & _
            "IF(" & srcSheet & "!K" & srcRow & "="""",0," & srcSheet & "!K" & srcRow & "/5)*" & WEIGHTS_SHEET & "!$C$6+" & _
            "IF(" & srcSheet & "!L" & srcRow & "="""",0," & srcSheet & "!L" & srcRow & "/5)*" & WEIGHTS_SHEET & "!$C$7+" & _
            "IF(" & srcSheet & "!M" & srcRow & "="""",0," & srcSheet & "!M" & srcRow & "/5)*" & WEIGHTS_SHEET & "!$C$8+" & _
            "IF(" & srcSheet & "!O" & srcRow & "="""",0," & srcSheet & "!O" & srcRow & "/5)*" & WEIGHTS_SHEET & "!$C$9+" & _
            "IF(" & srcSheet & "!P" & srcRow & "="""",0," & srcSheet & "!P" & srcRow & "/5)*" & WEIGHTS_SHEET & "!$C$10+" & _
            "IF(" & srcSheet & "!AF" & srcRow & "="""",0," & srcSheet & "!AF" & srcRow & "/5)*" & WEIGHTS_SHEET & "!$C$11+" & _
            "IF(" & srcSheet & "!AJ" & srcRow & "="""",0," & srcSheet & "!AJ" & srcRow & "/5)*" & WEIGHTS_SHEET & "!$C$12)*K" & r

        ' Conservative Base Score × YearMult
        ws.Cells(r, 14).Formula = "=(" & _
            "MIN(1," & srcSheet & "!G" & srcRow & "/20)*" & WEIGHTS_SHEET & "!$D$4+" & _
            "MIN(1,SQRT(" & srcSheet & "!F" & srcRow & ")/30)*" & WEIGHTS_SHEET & "!$D$5+" & _
            "IF(" & srcSheet & "!K" & srcRow & "="""",0," & srcSheet & "!K" & srcRow & "/5)*" & WEIGHTS_SHEET & "!$D$6+" & _
            "IF(" & srcSheet & "!L" & srcRow & "="""",0," & srcSheet & "!L" & srcRow & "/5)*" & WEIGHTS_SHEET & "!$D$7+" & _
            "IF(" & srcSheet & "!M" & srcRow & "="""",0," & srcSheet & "!M" & srcRow & "/5)*" & WEIGHTS_SHEET & "!$D$8+" & _
            "IF(" & srcSheet & "!O" & srcRow & "="""",0," & srcSheet & "!O" & srcRow & "/5)*" & WEIGHTS_SHEET & "!$D$9+" & _
            "IF(" & srcSheet & "!P" & srcRow & "="""",0," & srcSheet & "!P" & srcRow & "/5)*" & WEIGHTS_SHEET & "!$D$10+" & _
            "IF(" & srcSheet & "!AF" & srcRow & "="""",0," & srcSheet & "!AF" & srcRow & "/5)*" & WEIGHTS_SHEET & "!$D$11+" & _
            "IF(" & srcSheet & "!AJ" & srcRow & "="""",0," & srcSheet & "!AJ" & srcRow & "/5)*" & WEIGHTS_SHEET & "!$D$12)*K" & r

        ' V2: Combined Score (weighted average of V2 scores) - uses relative weights from rows 22-24
        ws.Cells(r, 10).Formula = "=" & _
            "L" & r & "*" & WEIGHTS_SHEET & "!$B$22+" & _
            "M" & r & "*" & WEIGHTS_SHEET & "!$B$23+" & _
            "N" & r & "*" & WEIGHTS_SHEET & "!$B$24"
    Next r

    ' Format score columns (V2)
    ws.Range("J2:J" & (rowsToGenerate + 1)).NumberFormat = "0.00%"
    ws.Range("K2:K" & (rowsToGenerate + 1)).NumberFormat = "0.00"  ' Year Multiplier
    ws.Range("L2:N" & (rowsToGenerate + 1)).NumberFormat = "0.00%"

    ' Sort by V2 combined score descending
    ws.Sort.SortFields.Clear
    ws.Sort.SortFields.Add2 Key:=ws.Range("J2:J" & (rowsToGenerate + 1)), _
        SortOn:=xlSortOnValues, Order:=xlDescending, DataOption:=xlSortNormal
    With ws.Sort
        .SetRange ws.Range("A1:N" & (rowsToGenerate + 1))
        .Header = xlYes
        .Apply
    End With

    ' Update rank numbers
    For r = 2 To rowsToGenerate + 1
        ws.Cells(r, 1).Value = r - 1
    Next r

    FormatHeaderRow ws
    ws.Columns("A:N").AutoFit

    ' Color score headers (V2)
    ws.Range("J1").Interior.Color = RGB(128, 128, 128)  ' Combined - gray
    ws.Range("K1").Interior.Color = RGB(255, 215, 0)    ' Year Multiplier - gold
    ws.Range("L1").Interior.Color = RGB(255, 107, 107)  ' Aggressive - red
    ws.Range("M1").Interior.Color = RGB(78, 205, 196)   ' Moderate - teal
    ws.Range("N1").Interior.Color = RGB(69, 183, 209)   ' Conservative - blue
End Sub

'===============================================================================
' CLEAR/RESET FUNCTIONS
'===============================================================================

Public Sub ClearAllDataSheets()
    '
    ' Clears all data from worksheets (keeps structure)
    '
    Dim sheetNames As Variant
    sheetNames = Array(RAW_DATA_SHEET, "Score_Aggressive", "Score_Moderate", "Score_Conservative", "Score_Combined")

    Dim i As Integer
    For i = 0 To UBound(sheetNames)
        On Error Resume Next
        Dim ws As Worksheet
        Set ws = ThisWorkbook.Sheets(sheetNames(i))
        If Not ws Is Nothing Then
            ws.Cells.Clear
        End If
        On Error GoTo 0
    Next i

    MsgBox "All data sheets cleared.", vbInformation
End Sub

Public Sub DeleteAllGeneratedSheets()
    '
    ' Deletes all generated worksheets (use with caution)
    '
    Dim sheetNames As Variant
    sheetNames = Array("Score_Aggressive", "Score_Moderate", "Score_Conservative", "Score_Combined")

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

Private Function GetImportFilePath(ByVal fileName As String) As String
    '
    ' Constructs the expected file path for imports
    ' Looks in same directory as workbook, then output subdirectory
    '
    Dim basePath As String
    basePath = ThisWorkbook.Path

    ' Try same directory
    If Dir(basePath & "\" & fileName) <> "" Then
        GetImportFilePath = basePath & "\" & fileName
        Exit Function
    End If

    ' Try output subdirectory
    If Dir(basePath & "\output\" & fileName) <> "" Then
        GetImportFilePath = basePath & "\output\" & fileName
        Exit Function
    End If

    GetImportFilePath = ""
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
