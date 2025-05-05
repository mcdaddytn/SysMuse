Sub ProcessCitationRanges()
    Dim wsCite As Worksheet, wsDocs As Worksheet, wsOutput As Worksheet
    Dim lastCiteRow As Long, lastDocsRow As Long, outputRow As Long
    Dim cite1 As Long, cite2 As Long
    Dim docStart As Long, docEnd As Long
    Dim docList As String, docPrefix As String
    Dim outputName As String
    Dim delimiter As String
    Dim i As Long, j As Long
    
    ' Set references to sheets
    Set wsCite = ThisWorkbook.Sheets("CiteRanges")
    Set wsDocs = ThisWorkbook.Sheets("AllDocs")
    
    ' Fetch parameters from Params tab
    On Error Resume Next
    delimiter = ThisWorkbook.Sheets("Params").Range("B7").Value
    If delimiter = "" Then delimiter = "," ' Default delimiter
    On Error GoTo 0

    ' Determine last row in both sheets
    lastCiteRow = wsCite.Cells(wsCite.Rows.Count, 1).End(xlUp).Row
    lastDocsRow = wsDocs.Cells(wsDocs.Rows.Count, 1).End(xlUp).Row

    ' Generate timestamped output sheet name
    outputName = "OUTPUT_" & Format(Now, "MMDDYYYYHHMMSS")
    Set wsOutput = ThisWorkbook.Sheets.Add
    wsOutput.Name = outputName

    ' Write headers in the output sheet
    wsOutput.Cells(1, 1).Value = "Doc Cite Range" ' New column for full citation range
    wsOutput.Cells(1, 2).Value = "STATUS"
    wsOutput.Cells(1, 3).Value = "REASON"
    wsOutput.Cells(1, 4).Value = "DOCRANGE"
    
    outputRow = 2 ' Start writing output from row 2
    
    ' Loop through each citation range in CiteRanges tab
    For i = 2 To lastCiteRow
        docList = "" ' Reset doc list
        wsOutput.Cells(outputRow, 1).Value = wsCite.Cells(i, 1).Value ' Copy full citation range
        wsOutput.Cells(outputRow, 2).Value = "SUCCESS" ' Default status
        
        ' Extract and validate Cite1 and Cite2
        cite1 = 0: cite2 = 0
        On Error Resume Next
        cite1 = CLng(wsCite.Cells(i, 3).Value) ' Extract Cite1 (third column)
        cite2 = CLng(wsCite.Cells(i, 5).Value) ' Extract Cite2 (fifth column)
        On Error GoTo 0
        
        ' Validate Cite1 and Cite2
        If cite1 < 1 Or cite2 < 1 Or Len(wsCite.Cells(i, 3).Value) <> 7 Or Len(wsCite.Cells(i, 5).Value) <> 7 Then
            wsOutput.Cells(outputRow, 2).Value = "ERROR"
            wsOutput.Cells(outputRow, 3).Value = "Invalid citation format"
            outputRow = outputRow + 1
            GoTo NextIteration
        End If
        
        ' Ensure cite1 is less than or equal to cite2
        If cite1 > cite2 Then
            wsOutput.Cells(outputRow, 2).Value = "ERROR"
            wsOutput.Cells(outputRow, 3).Value = "Cite1 greater than Cite2"
            outputRow = outputRow + 1
            GoTo NextIteration
        End If
        
        ' Loop through AllDocs to find all matching document ranges
        For j = 2 To lastDocsRow
            docPrefix = wsDocs.Cells(j, 1).Value ' Document name
            docStart = CLng(Mid(docPrefix, Len(docPrefix) - 6, 7)) ' Extract numeric portion of BegDoc
            docEnd = CLng(Mid(wsDocs.Cells(j, 2).Value, Len(wsDocs.Cells(j, 2).Value) - 6, 7)) ' Extract numeric portion of EndDoc
            
            ' Check if document range contains any part of the citation range
            If (docStart <= cite2 And docEnd >= cite1) Then
                If docList = "" Then
                    docList = docPrefix
                Else
                    docList = docList & delimiter & docPrefix
                End If
            End If
        Next j
        
        ' If no documents were found, log an error
        If docList = "" Then
            wsOutput.Cells(outputRow, 2).Value = "ERROR"
            wsOutput.Cells(outputRow, 3).Value = "Page " & cite1 & " not found"
        Else
            wsOutput.Cells(outputRow, 4).Value = docList
        End If
        
        outputRow = outputRow + 1 ' Move to next row

NextIteration:
    Next i
    
    ' Auto-fit columns for better readability
    wsOutput.Columns("A:D").AutoFit

    ' Notify the user
    MsgBox "Processing complete! Output saved in tab: " & outputName, vbInformation, "Processing Done"
    
End Sub

