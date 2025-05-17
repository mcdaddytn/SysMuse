' === Generic macro: accepts parameters ===
Sub ImportCSVsWithSuffixes(rootFileName As String, suffixes As Variant, Optional joinChar As String = "_")
    Dim fso As Object
    Set fso = CreateObject("Scripting.FileSystemObject")
    
    Dim importPath As String
    importPath = Application.ThisWorkbook.Path & Application.PathSeparator  ' Use same folder as workbook

    ' Strip extension from rootFileName
    Dim baseName As String
    baseName = Left(rootFileName, InStrRev(rootFileName, ".") - 1)
    Dim fileExt As String
    fileExt = Mid(rootFileName, InStrRev(rootFileName, ".") + 1)
    
    Dim suffix As Variant
    For Each suffix In suffixes
        Dim fullFileName As String
        fullFileName = baseName & joinChar & suffix & "." & fileExt
        
        Dim fullPath As String
        fullPath = importPath & fullFileName
        
        If fso.FileExists(fullPath) Then
            ImportCSVToSheet fullPath, CStr(suffix)
        Else
            MsgBox "File not found: " & fullPath, vbExclamation
        End If
    Next suffix
End Sub

' === Helper macro: import one file into a sheet ===
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

' === No-argument version using your example ===
Sub ImportExampleCSVs()
    Dim suffixes As Variant
    'suffixes = Array("ic", "iu", "fr", "cpc")
    suffixes = Array("ic", "iu", "fr", "cpc", "cr", "bc", "aal", "wkb", "pam", "nan", "mas", "cwc")
    
    Dim rootFile As String
    rootFile = "exported_data_nested_aggregation.csv"
    
    Call ImportCSVsWithSuffixes(rootFile, suffixes, "_")
End Sub
