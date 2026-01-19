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
'
' Worksheet Structure:
'   - RawData: Imported patent metrics
'   - Weights: User-adjustable weights (3 sliders)
'   - SectorView: Ranked patents by sector with scores
'
' File Convention:
'   - Export: npx tsx scripts/export-within-sector-for-excel.ts
'   - File: excel/WITHIN-SECTOR-YYYY-MM-DD.csv
'   - Fallback: excel/WITHIN-SECTOR-LATEST.csv
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
    Dim basePath As String
    Dim datePath As String
    Dim fso As Object

    Set fso = CreateObject("Scripting.FileSystemObject")
    basePath = ThisWorkbook.Path & "\"

    ' Try today's date first
    datePath = basePath & "WITHIN-SECTOR-" & Format(Date, "yyyy-mm-dd") & ".csv"
    If fso.FileExists(datePath) Then
        FindCSVFile = datePath
        Exit Function
    End If

    ' Fall back to LATEST
    datePath = basePath & "WITHIN-SECTOR-LATEST.csv"
    If fso.FileExists(datePath) Then
        FindCSVFile = datePath
        Exit Function
    End If

    FindCSVFile = ""
End Function

Private Function GetOrCreateSheet(wb As Workbook, sheetName As String) As Worksheet
    Dim ws As Worksheet

    On Error Resume Next
    Set ws = wb.Worksheets(sheetName)
    On Error GoTo 0

    If ws Is Nothing Then
        Set ws = wb.Worksheets.Add(After:=wb.Worksheets(wb.Worksheets.Count))
        ws.Name = sheetName
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
