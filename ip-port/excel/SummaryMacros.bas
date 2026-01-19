'===============================================================================
' Summary Macros - AffiliateSummary and SectorSummary
'===============================================================================
' Version: 1.0
' Description: Generates AffiliateSummary and SectorSummary worksheets from
'              imported patent data. These summaries show portfolio breakdown
'              by affiliate (acquired companies) and technology sector.
'
' KEY MACROS:
'   - GenerateAffiliateSummary(): Create affiliate breakdown summary
'   - GenerateSectorSummary(): Create sector breakdown summary
'   - GenerateAllSummaries(): Generate both summaries at once
'
' REQUIRED DATA:
'   - RawData worksheet with patent data (from ImportTop250 or ATTORNEY-PORTFOLIO CSV)
'   - Expects columns: affiliate, sector, years_remaining, competitor_citations, competitors_citing
'
' OUTPUT:
'   - AffiliateSummary: Portfolio by acquired company
'   - SectorSummary: Portfolio by technology sector
'
' Author: Generated for IP Portfolio Analysis Platform
' Last Updated: 2026-01-19
'===============================================================================

Option Explicit

' Minimum years to be considered "active"
Private Const MIN_ACTIVE_YEARS As Double = 3

'===============================================================================
' PUBLIC ENTRY POINTS
'===============================================================================

Public Sub GenerateAllSummaries()
    '
    ' Generates both AffiliateSummary and SectorSummary worksheets
    '
    Application.ScreenUpdating = False
    Application.Calculation = xlCalculationManual

    On Error GoTo ErrorHandler

    Dim affCount As Long, secCount As Long
    affCount = GenerateAffiliateSummaryInternal()
    secCount = GenerateSectorSummaryInternal()

    If affCount >= 0 And secCount >= 0 Then
        MsgBox "Summaries generated!" & vbCrLf & vbCrLf & _
               "AffiliateSummary: " & affCount & " affiliates" & vbCrLf & _
               "SectorSummary: " & secCount & " sectors", vbInformation
    End If

Cleanup:
    Application.Calculation = xlCalculationAutomatic
    Application.ScreenUpdating = True
    Exit Sub

ErrorHandler:
    MsgBox "Error generating summaries: " & Err.Description, vbCritical
    Resume Cleanup
End Sub

Public Sub GenerateAffiliateSummary()
    '
    ' Generate AffiliateSummary worksheet from RawData
    '
    Application.ScreenUpdating = False
    Application.Calculation = xlCalculationManual

    On Error GoTo ErrorHandler

    Dim count As Long
    count = GenerateAffiliateSummaryInternal()

    If count >= 0 Then
        MsgBox "AffiliateSummary generated with " & count & " affiliates.", vbInformation
    End If

Cleanup:
    Application.Calculation = xlCalculationAutomatic
    Application.ScreenUpdating = True
    Exit Sub

ErrorHandler:
    MsgBox "Error generating affiliate summary: " & Err.Description, vbCritical
    Resume Cleanup
End Sub

Public Sub GenerateSectorSummary()
    '
    ' Generate SectorSummary worksheet from RawData
    '
    Application.ScreenUpdating = False
    Application.Calculation = xlCalculationManual

    On Error GoTo ErrorHandler

    Dim count As Long
    count = GenerateSectorSummaryInternal()

    If count >= 0 Then
        MsgBox "SectorSummary generated with " & count & " sectors.", vbInformation
    End If

Cleanup:
    Application.Calculation = xlCalculationAutomatic
    Application.ScreenUpdating = True
    Exit Sub

ErrorHandler:
    MsgBox "Error generating sector summary: " & Err.Description, vbCritical
    Resume Cleanup
End Sub

'===============================================================================
' INTERNAL IMPLEMENTATION - AFFILIATE SUMMARY
'===============================================================================

Private Function GenerateAffiliateSummaryInternal() As Long
    GenerateAffiliateSummaryInternal = -1

    ' Find source data - try RawData first, then Score_Consensus
    Dim wsSrc As Worksheet
    Dim colAffiliate As Integer, colYears As Integer
    Dim colCompCites As Integer, colCompetitors As Integer
    Dim colSector As Integer, colPatentId As Integer

    On Error Resume Next
    Set wsSrc = ThisWorkbook.Sheets("RawData")
    On Error GoTo 0

    If wsSrc Is Nothing Then
        ' Try Score_Consensus as fallback
        On Error Resume Next
        Set wsSrc = ThisWorkbook.Sheets("Score_Consensus")
        On Error GoTo 0
    End If

    If wsSrc Is Nothing Then
        MsgBox "No data found. Run ImportTop250 or import ATTORNEY-PORTFOLIO CSV first.", vbExclamation
        Exit Function
    End If

    ' Find column indices
    colPatentId = FindColumnIndex(wsSrc, "patent_id")
    If colPatentId = 0 Then colPatentId = 2 ' Default to B for Score_Consensus

    colAffiliate = FindColumnIndex(wsSrc, "affiliate")
    If colAffiliate = 0 Then
        ' Try assignee as fallback
        colAffiliate = FindColumnIndex(wsSrc, "assignee")
    End If

    colYears = FindColumnIndex(wsSrc, "years_remaining")
    If colYears = 0 Then colYears = FindColumnIndex(wsSrc, "years")

    colCompCites = FindColumnIndex(wsSrc, "competitor_citations")
    If colCompCites = 0 Then colCompCites = FindColumnIndex(wsSrc, "comp_cites")

    colCompetitors = FindColumnIndex(wsSrc, "competitors_citing")
    If colCompetitors = 0 Then colCompetitors = FindColumnIndex(wsSrc, "competitors")

    colSector = FindColumnIndex(wsSrc, "sector")

    Dim lastRow As Long
    lastRow = wsSrc.Cells(wsSrc.Rows.Count, colPatentId).End(xlUp).Row

    If lastRow < 2 Then
        MsgBox "No data found in source worksheet.", vbExclamation
        Exit Function
    End If

    ' Dictionary to track affiliate stats
    Dim affiliateStats As Object
    Set affiliateStats = CreateObject("Scripting.Dictionary")

    ' Process each row
    Dim r As Long
    For r = 2 To lastRow
        Dim affiliate As String
        affiliate = Trim(CStr(wsSrc.Cells(r, colAffiliate).Value))
        If Len(affiliate) = 0 Then affiliate = "Unknown"

        Dim years As Double
        years = Val(wsSrc.Cells(r, colYears).Value)

        Dim compCites As Long
        compCites = Val(wsSrc.Cells(r, colCompCites).Value)

        Dim competitors As String
        competitors = CStr(wsSrc.Cells(r, colCompetitors).Value)

        Dim sector As String
        If colSector > 0 Then sector = CStr(wsSrc.Cells(r, colSector).Value)

        Dim patentId As String
        patentId = CStr(wsSrc.Cells(r, colPatentId).Value)

        ' Initialize or update affiliate record
        If Not affiliateStats.Exists(affiliate) Then
            ' Structure: count, activeCount, expiredCount, totalYears, totalCites,
            '            topPatentId, topPatentCites, sectors(dict), competitors(dict)
            Dim stats(0 To 8) As Variant
            stats(0) = 0          ' count
            stats(1) = 0          ' activeCount
            stats(2) = 0          ' expiredCount
            stats(3) = 0          ' totalYears
            stats(4) = 0          ' totalCites
            stats(5) = ""         ' topPatentId
            stats(6) = 0          ' topPatentCites
            stats(7) = CreateObject("Scripting.Dictionary") ' sectors
            stats(8) = CreateObject("Scripting.Dictionary") ' competitors
            affiliateStats.Add affiliate, stats
        End If

        Dim s As Variant
        s = affiliateStats(affiliate)

        s(0) = s(0) + 1  ' count
        If years >= MIN_ACTIVE_YEARS Then
            s(1) = s(1) + 1  ' active
        ElseIf years < 0 Then
            s(2) = s(2) + 1  ' expired
        End If
        s(3) = s(3) + years  ' totalYears
        s(4) = s(4) + compCites  ' totalCites

        ' Track top patent
        If compCites > s(6) Then
            s(5) = patentId
            s(6) = compCites
        End If

        ' Track sectors
        If Len(sector) > 0 Then
            Dim secDict As Object
            Set secDict = s(7)
            If secDict.Exists(sector) Then
                secDict(sector) = secDict(sector) + 1
            Else
                secDict.Add sector, 1
            End If
        End If

        ' Track competitors
        If Len(competitors) > 0 Then
            Dim compArr() As String
            compArr = Split(competitors, ";")
            Dim i As Integer
            Dim compDict As Object
            Set compDict = s(8)
            For i = LBound(compArr) To UBound(compArr)
                Dim comp As String
                comp = Trim(compArr(i))
                If Len(comp) > 0 Then
                    If compDict.Exists(comp) Then
                        compDict(comp) = compDict(comp) + 1
                    Else
                        compDict.Add comp, 1
                    End If
                End If
            Next i
        End If

        affiliateStats(affiliate) = s
    Next r

    ' Create summary worksheet
    Dim wsSummary As Worksheet
    Set wsSummary = GetOrCreateSheet("AffiliateSummary")
    wsSummary.Cells.Clear

    ' Title
    wsSummary.Range("A1").Value = "AFFILIATE SUMMARY - PORTFOLIO BREAKDOWN"
    wsSummary.Range("A1").Font.Bold = True
    wsSummary.Range("A1").Font.Size = 16
    wsSummary.Range("A2").Value = "Shows patent distribution across portfolio affiliates (acquired companies)"

    ' Headers
    wsSummary.Range("A4").Value = "Affiliate"
    wsSummary.Range("B4").Value = "Total Patents"
    wsSummary.Range("C4").Value = "Active Patents"
    wsSummary.Range("D4").Value = "Expired Patents"
    wsSummary.Range("E4").Value = "Avg Years Remaining"
    wsSummary.Range("F4").Value = "Patents w/ Citations"
    wsSummary.Range("G4").Value = "Total Competitor Cites"
    wsSummary.Range("H4").Value = "Avg Competitor Cites"
    wsSummary.Range("I4").Value = "Top Cited Patent"
    wsSummary.Range("J4").Value = "Top Patent Cites"
    wsSummary.Range("K4").Value = "Top Competitors"
    wsSummary.Range("L4").Value = "Dominant Sectors"
    FormatHeaderRow wsSummary, 4

    ' Sort affiliates by count
    Dim affNames() As String
    Dim affCounts() As Long
    ReDim affNames(0 To affiliateStats.Count - 1)
    ReDim affCounts(0 To affiliateStats.Count - 1)

    Dim key As Variant
    Dim n As Long
    n = 0
    For Each key In affiliateStats.Keys
        affNames(n) = key
        s = affiliateStats(key)
        affCounts(n) = s(0)
        n = n + 1
    Next key

    ' Bubble sort descending
    Dim j As Long, tempName As String, tempCount As Long
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
        s = affiliateStats(affiliate)

        Dim patentCount As Long, activeCount As Long, expiredCount As Long
        Dim totalYears As Double, totalCites As Long

        patentCount = s(0)
        activeCount = s(1)
        expiredCount = s(2)
        totalYears = s(3)
        totalCites = s(4)

        ' Count patents with citations
        Dim withCitesCount As Long
        withCitesCount = 0
        Set compDict = s(8)
        ' Approximate: if any competitor exists, count it
        For Each key In compDict.Keys
            withCitesCount = withCitesCount + 1
            Exit For
        Next key

        ' Get top competitors
        Dim topComps As String
        topComps = GetTopItems(s(8), 5)

        ' Get dominant sectors
        Dim topSectors As String
        topSectors = GetTopItems(s(7), 3)

        wsSummary.Cells(outRow, 1).Value = affiliate
        wsSummary.Cells(outRow, 2).Value = patentCount
        wsSummary.Cells(outRow, 3).Value = activeCount
        wsSummary.Cells(outRow, 4).Value = expiredCount
        wsSummary.Cells(outRow, 5).Value = Round(totalYears / patentCount, 1)
        wsSummary.Cells(outRow, 6).Value = IIf(totalCites > 0, "Y", "N")
        wsSummary.Cells(outRow, 7).Value = totalCites
        wsSummary.Cells(outRow, 8).Value = Round(totalCites / patentCount, 1)
        wsSummary.Cells(outRow, 9).Value = s(5)
        wsSummary.Cells(outRow, 10).Value = s(6)
        wsSummary.Cells(outRow, 11).Value = topComps
        wsSummary.Cells(outRow, 12).Value = topSectors

        outRow = outRow + 1
    Next i

    ' Format
    wsSummary.Columns("A:L").AutoFit

    ' Add data bar to Total Patents column
    Dim rngCount As Range
    Set rngCount = wsSummary.Range("B5:B" & (outRow - 1))
    If rngCount.Rows.Count > 0 Then
        rngCount.FormatConditions.AddDatabar
        rngCount.FormatConditions(rngCount.FormatConditions.Count).BarColor.Color = RGB(86, 156, 214)
    End If

    GenerateAffiliateSummaryInternal = n
End Function

'===============================================================================
' INTERNAL IMPLEMENTATION - SECTOR SUMMARY
'===============================================================================

Private Function GenerateSectorSummaryInternal() As Long
    GenerateSectorSummaryInternal = -1

    ' Find source data
    Dim wsSrc As Worksheet
    Dim colSector As Integer, colYears As Integer
    Dim colCompCites As Integer, colCompetitors As Integer
    Dim colAffiliate As Integer, colPatentId As Integer

    On Error Resume Next
    Set wsSrc = ThisWorkbook.Sheets("RawData")
    On Error GoTo 0

    If wsSrc Is Nothing Then
        On Error Resume Next
        Set wsSrc = ThisWorkbook.Sheets("Score_Consensus")
        On Error GoTo 0
    End If

    If wsSrc Is Nothing Then
        MsgBox "No data found. Run ImportTop250 or import ATTORNEY-PORTFOLIO CSV first.", vbExclamation
        Exit Function
    End If

    ' Find column indices
    colPatentId = FindColumnIndex(wsSrc, "patent_id")
    If colPatentId = 0 Then colPatentId = 2

    colSector = FindColumnIndex(wsSrc, "sector")
    If colSector = 0 Then colSector = FindColumnIndex(wsSrc, "sector_name")

    colAffiliate = FindColumnIndex(wsSrc, "affiliate")
    If colAffiliate = 0 Then colAffiliate = FindColumnIndex(wsSrc, "assignee")

    colYears = FindColumnIndex(wsSrc, "years_remaining")
    If colYears = 0 Then colYears = FindColumnIndex(wsSrc, "years")

    colCompCites = FindColumnIndex(wsSrc, "competitor_citations")
    If colCompCites = 0 Then colCompCites = FindColumnIndex(wsSrc, "comp_cites")

    colCompetitors = FindColumnIndex(wsSrc, "competitors_citing")
    If colCompetitors = 0 Then colCompetitors = FindColumnIndex(wsSrc, "competitors")

    If colSector = 0 Then
        MsgBox "Sector column not found in data.", vbExclamation
        Exit Function
    End If

    Dim lastRow As Long
    lastRow = wsSrc.Cells(wsSrc.Rows.Count, colPatentId).End(xlUp).Row

    If lastRow < 2 Then Exit Function

    ' Dictionary for sector stats
    Dim sectorStats As Object
    Set sectorStats = CreateObject("Scripting.Dictionary")

    Dim r As Long
    For r = 2 To lastRow
        Dim sector As String
        sector = Trim(CStr(wsSrc.Cells(r, colSector).Value))
        If Len(sector) = 0 Then sector = "unassigned"

        Dim years As Double
        years = Val(wsSrc.Cells(r, colYears).Value)

        Dim compCites As Long
        compCites = Val(wsSrc.Cells(r, colCompCites).Value)

        Dim competitors As String
        competitors = CStr(wsSrc.Cells(r, colCompetitors).Value)

        Dim affiliate As String
        affiliate = CStr(wsSrc.Cells(r, colAffiliate).Value)

        Dim patentId As String
        patentId = CStr(wsSrc.Cells(r, colPatentId).Value)

        If Not sectorStats.Exists(sector) Then
            Dim stats(0 To 9) As Variant
            stats(0) = 0          ' count
            stats(1) = 0          ' activeCount
            stats(2) = 0          ' expiredCount
            stats(3) = 0          ' totalYears
            stats(4) = 0          ' totalCites
            stats(5) = ""         ' topPatentId
            stats(6) = 0          ' topPatentCites
            stats(7) = CreateObject("Scripting.Dictionary") ' affiliates
            stats(8) = CreateObject("Scripting.Dictionary") ' competitors
            stats(9) = 0          ' uniqueCompetitors
            sectorStats.Add sector, stats
        End If

        Dim s As Variant
        s = sectorStats(sector)

        s(0) = s(0) + 1
        If years >= MIN_ACTIVE_YEARS Then s(1) = s(1) + 1
        If years < 0 Then s(2) = s(2) + 1
        s(3) = s(3) + years
        s(4) = s(4) + compCites

        If compCites > s(6) Then
            s(5) = patentId
            s(6) = compCites
        End If

        ' Track affiliates
        If Len(affiliate) > 0 Then
            Dim affDict As Object
            Set affDict = s(7)
            If affDict.Exists(affiliate) Then
                affDict(affiliate) = affDict(affiliate) + 1
            Else
                affDict.Add affiliate, 1
            End If
        End If

        ' Track competitors
        If Len(competitors) > 0 Then
            Dim compArr() As String
            compArr = Split(competitors, ";")
            Dim i As Integer
            Dim compDict As Object
            Set compDict = s(8)
            For i = LBound(compArr) To UBound(compArr)
                Dim comp As String
                comp = Trim(compArr(i))
                If Len(comp) > 0 Then
                    If Not compDict.Exists(comp) Then
                        compDict.Add comp, 1
                    Else
                        compDict(comp) = compDict(comp) + 1
                    End If
                End If
            Next i
        End If

        sectorStats(sector) = s
    Next r

    ' Create summary worksheet
    Dim wsSummary As Worksheet
    Set wsSummary = GetOrCreateSheet("SectorSummary")
    wsSummary.Cells.Clear

    ' Title
    wsSummary.Range("A1").Value = "SECTOR SUMMARY - TECHNOLOGY BREAKDOWN"
    wsSummary.Range("A1").Font.Bold = True
    wsSummary.Range("A1").Font.Size = 16
    wsSummary.Range("A2").Value = "Shows patent distribution across technology sectors"

    ' Headers
    wsSummary.Range("A4").Value = "Sector"
    wsSummary.Range("B4").Value = "Total Patents"
    wsSummary.Range("C4").Value = "Active Patents"
    wsSummary.Range("D4").Value = "Expired Patents"
    wsSummary.Range("E4").Value = "Avg Years Remaining"
    wsSummary.Range("F4").Value = "Total Competitor Cites"
    wsSummary.Range("G4").Value = "Avg Competitor Cites"
    wsSummary.Range("H4").Value = "Unique Competitors"
    wsSummary.Range("I4").Value = "Top Cited Patent"
    wsSummary.Range("J4").Value = "Top Patent Cites"
    wsSummary.Range("K4").Value = "Top Competitors"
    wsSummary.Range("L4").Value = "Dominant Affiliates"
    FormatHeaderRow wsSummary, 4

    ' Sort sectors by count
    Dim secNames() As String
    Dim secCounts() As Long
    ReDim secNames(0 To sectorStats.Count - 1)
    ReDim secCounts(0 To sectorStats.Count - 1)

    Dim key As Variant
    Dim n As Long
    n = 0
    For Each key In sectorStats.Keys
        secNames(n) = key
        s = sectorStats(key)
        secCounts(n) = s(0)
        n = n + 1
    Next key

    ' Bubble sort
    Dim j As Long, tempName As String, tempCount As Long
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
    Dim outRow As Long
    outRow = 5

    For i = 0 To n - 1
        sector = secNames(i)
        s = sectorStats(sector)

        Dim patentCount As Long, activeCount As Long, expiredCount As Long
        Dim totalYears As Double, totalCites As Long

        patentCount = s(0)
        activeCount = s(1)
        expiredCount = s(2)
        totalYears = s(3)
        totalCites = s(4)

        Dim compDict As Object
        Set compDict = s(8)
        Dim uniqueComps As Long
        uniqueComps = compDict.Count

        Dim topComps As String
        topComps = GetTopItems(s(8), 5)

        Dim topAffs As String
        topAffs = GetTopItems(s(7), 3)

        wsSummary.Cells(outRow, 1).Value = sector
        wsSummary.Cells(outRow, 2).Value = patentCount
        wsSummary.Cells(outRow, 3).Value = activeCount
        wsSummary.Cells(outRow, 4).Value = expiredCount
        wsSummary.Cells(outRow, 5).Value = Round(totalYears / patentCount, 1)
        wsSummary.Cells(outRow, 6).Value = totalCites
        wsSummary.Cells(outRow, 7).Value = Round(totalCites / patentCount, 1)
        wsSummary.Cells(outRow, 8).Value = uniqueComps
        wsSummary.Cells(outRow, 9).Value = s(5)
        wsSummary.Cells(outRow, 10).Value = s(6)
        wsSummary.Cells(outRow, 11).Value = topComps
        wsSummary.Cells(outRow, 12).Value = topAffs

        outRow = outRow + 1
    Next i

    ' Format
    wsSummary.Columns("A:L").AutoFit

    ' Data bar
    Dim rngCount As Range
    Set rngCount = wsSummary.Range("B5:B" & (outRow - 1))
    If rngCount.Rows.Count > 0 Then
        rngCount.FormatConditions.AddDatabar
        rngCount.FormatConditions(rngCount.FormatConditions.Count).BarColor.Color = RGB(86, 156, 214)
    End If

    GenerateSectorSummaryInternal = n
End Function

'===============================================================================
' UTILITY FUNCTIONS
'===============================================================================

Private Function FindColumnIndex(ByVal ws As Worksheet, ByVal colName As String) As Integer
    Dim lastCol As Integer
    lastCol = ws.Cells(1, ws.Columns.Count).End(xlToLeft).Column

    Dim c As Integer
    For c = 1 To lastCol
        If LCase(Trim(CStr(ws.Cells(1, c).Value))) = LCase(colName) Then
            FindColumnIndex = c
            Exit Function
        End If
    Next c

    FindColumnIndex = 0
End Function

Private Function GetTopItems(ByVal dict As Object, ByVal topN As Integer) As String
    If dict.Count = 0 Then
        GetTopItems = ""
        Exit Function
    End If

    ' Get keys and values
    Dim keys() As String
    Dim vals() As Long
    ReDim keys(0 To dict.Count - 1)
    ReDim vals(0 To dict.Count - 1)

    Dim key As Variant
    Dim i As Integer
    i = 0
    For Each key In dict.Keys
        keys(i) = key
        vals(i) = dict(key)
        i = i + 1
    Next key

    ' Sort descending
    Dim j As Integer, tempKey As String, tempVal As Long
    For i = 0 To dict.Count - 2
        For j = i + 1 To dict.Count - 1
            If vals(j) > vals(i) Then
                tempKey = keys(i): tempVal = vals(i)
                keys(i) = keys(j): vals(i) = vals(j)
                keys(j) = tempKey: vals(j) = tempVal
            End If
        Next j
    Next i

    ' Build result string
    Dim result As String
    result = ""
    For i = 0 To Application.WorksheetFunction.Min(topN - 1, dict.Count - 1)
        If Len(result) > 0 Then result = result & "; "
        result = result & keys(i) & "(" & vals(i) & ")"
    Next i

    GetTopItems = result
End Function

Private Function GetOrCreateSheet(ByVal sheetName As String) As Worksheet
    On Error Resume Next
    Set GetOrCreateSheet = ThisWorkbook.Sheets(sheetName)
    On Error GoTo 0

    If GetOrCreateSheet Is Nothing Then
        Set GetOrCreateSheet = ThisWorkbook.Sheets.Add(After:=ThisWorkbook.Sheets(ThisWorkbook.Sheets.Count))
        GetOrCreateSheet.Name = sheetName
    End If
End Function

Private Sub FormatHeaderRow(ByVal ws As Worksheet, Optional ByVal headerRow As Integer = 1)
    With ws.Rows(headerRow)
        .Font.Bold = True
        .Interior.Color = RGB(26, 26, 46)
        .Font.Color = RGB(255, 255, 255)
    End With
End Sub
