Sub ParseEmailFields()
    Dim ws As Worksheet
    Set ws = ActiveSheet

    Dim emailFields As Variant
    emailFields = Array("Email From", "Email To", "Email CC")

    Dim suffixes As Variant
    suffixes = Array(" NO", " AO", " DO")

    Dim headers As Object
    Set headers = CreateObject("Scripting.Dictionary")

    Dim col As Integer
    col = 1
    Do While ws.Cells(1, col).Value <> ""
        headers(ws.Cells(1, col).Value) = col
        col = col + 1
    Loop

    ' Delete derived columns if they already exist
    Dim i As Integer, j As Integer
    For i = LBound(emailFields) To UBound(emailFields)
        For j = LBound(suffixes) To UBound(suffixes)
            Dim derivedHeader As String
            derivedHeader = emailFields(i) & suffixes(j)
            If headers.exists(derivedHeader) Then
                ws.Columns(headers(derivedHeader)).Delete
                Set headers = CreateObject("Scripting.Dictionary")
                col = 1
                Do While ws.Cells(1, col).Value <> ""
                    headers(ws.Cells(1, col).Value) = col
                    col = col + 1
                Loop
            End If
        Next j
    Next i

    ' Add derived column headers
    Dim lastCol As Integer
    lastCol = ws.Cells(1, ws.Columns.Count).End(xlToLeft).Column
    For i = LBound(emailFields) To UBound(emailFields)
        For j = LBound(suffixes) To UBound(suffixes)
            ws.Cells(1, lastCol + 1).Value = emailFields(i) & suffixes(j)
            headers(emailFields(i) & suffixes(j)) = lastCol + 1
            lastCol = lastCol + 1
        Next j
    Next i

    ' Unique sets
    Dim uniqueNames As Object, uniqueAddresses As Object, uniqueDomains As Object
    Set uniqueNames = CreateObject("Scripting.Dictionary")
    Set uniqueAddresses = CreateObject("Scripting.Dictionary")
    Set uniqueDomains = CreateObject("Scripting.Dictionary")

    ' Row processing
    Dim row As Long
    row = 2
    Do While ws.Cells(row, 1).Value <> ""
        For i = LBound(emailFields) To UBound(emailFields)
            Dim fieldVal As String
            fieldVal = ws.Cells(row, headers(emailFields(i))).Value

            Dim parts As Variant
            parts = Split(fieldVal, ";")

            Dim names As String, addresses As String, domains As String
            names = "": addresses = "": domains = ""

            Dim part As Variant
            For Each part In parts
                part = Trim(part)
                If part = "" Then GoTo SkipPart

                Dim namePart As String, emailPart As String, domainPart As String
                namePart = "": emailPart = "": domainPart = ""

                If InStr(part, "[") > 0 And InStr(part, "]") > InStr(part, "[") Then
                    ' Bracketed format — name before [ ], email inside [ ]
                    namePart = Trim(Left(part, InStr(part, "[") - 1))
                    emailPart = Trim(Mid(part, InStr(part, "[") + 1, InStr(part, "]") - InStr(part, "[") - 1))
                ElseIf part Like "*<*>*" Then
                    ' Name <email> format
                    namePart = Trim(Left(part, InStr(part, "<") - 1))
                    emailPart = Mid(part, InStr(part, "<") + 1, InStr(part, ">") - InStr(part, "<") - 1)
                ElseIf InStr(part, "@") > 0 Then
                    emailPart = part
                ElseIf IsPhoneNumber(CStr(part)) Then
                    emailPart = part
                Else
                    ' Unstructured string
                    namePart = part
                    emailPart = ""
                End If

                If emailPart <> "" Then
                    emailPart = Trim(emailPart)
                    addresses = AppendDelimited(addresses, emailPart)
                    If Not uniqueAddresses.exists(emailPart) Then uniqueAddresses(emailPart) = 1

                    If InStr(emailPart, "@") > 0 Then
                        domainPart = Mid(emailPart, InStr(emailPart, "@") + 1)
                        domainPart = CleanDomain(domainPart)
                        domains = AppendDelimited(domains, domainPart)
                        If Not uniqueDomains.exists(domainPart) Then uniqueDomains(domainPart) = 1
                    End If
                End If

                If namePart <> "" And Not IsPhoneNumber(namePart) Then
                    namePart = Trim(namePart)
                    names = AppendDelimited(names, namePart)
                    If Not uniqueNames.exists(namePart) Then uniqueNames(namePart) = 1
                End If
SkipPart:
            Next part

            ' Write derived values
            ws.Cells(row, headers(emailFields(i) & " NO")).Value = names
            ws.Cells(row, headers(emailFields(i) & " AO")).Value = addresses
            ws.Cells(row, headers(emailFields(i) & " DO")).Value = domains
        Next i
        row = row + 1
    Loop

    ' Delete and recreate Unique worksheets
    On Error Resume Next
    Application.DisplayAlerts = False
    Worksheets("UniqueAddresses").Delete
    Worksheets("UniqueNames").Delete
    Worksheets("UniqueDomains").Delete
    Application.DisplayAlerts = True
    On Error GoTo 0

    ' Output to new sheets
    Dim wsA As Worksheet, wsN As Worksheet, wsD As Worksheet
    Set wsA = Worksheets.Add: wsA.Name = "UniqueAddresses"
    Set wsN = Worksheets.Add: wsN.Name = "UniqueNames"
    Set wsD = Worksheets.Add: wsD.Name = "UniqueDomains"

    WriteUniqueToSheet wsA, uniqueAddresses, "Email Address"
    WriteUniqueToSheet wsN, uniqueNames, "Name"
    WriteUniqueToSheet wsD, uniqueDomains, "Domain"

    'MsgBox "Email parsing completed.", vbInformation
End Sub

Function AppendDelimited(base As String, newVal As String) As String
    If base = "" Then
        AppendDelimited = newVal
    Else
        AppendDelimited = base & "; " & newVal
    End If
End Function

Function IsPhoneNumber(s As String) As Boolean
    Dim pattern As String
    pattern = "(\(?\+?\d{1,3}\)?[-\s.]?)?(\(?\d{3}\)?[-\s.]?)?\d{3}[-\s.]?\d{4}"
    IsPhoneNumber = (s Like "*#*") And (s Like "*[0-9]*") And _
        (s Like "*+1*" Or s Like "*(###)*" Or s Like "*###-###*" Or s Like "*### ### ####*")
End Function

Function CleanDomain(domain As String) As String
    domain = Trim(domain)
    domain = Replace(domain, "]", "")
    domain = Replace(domain, ">", "")
    CleanDomain = domain
End Function

Private Sub WriteUniqueToSheet(ws As Worksheet, dict As Object, header As String)
    ws.Cells(1, 1).Value = header
    Dim i As Long
    i = 2
    Dim key As Variant
    For Each key In dict.Keys
        ws.Cells(i, 1).Value = CStr(key)
        i = i + 1
    Next key
End Sub

Sub DetectPrivBreaks()
    Dim ws As Worksheet: Set ws = ActiveSheet
    Dim internalWS As Worksheet: Set internalWS = ThisWorkbook.Worksheets("Internal")
    
    ' Delete existing PrivBreak and PrivBreakReason columns
    Dim col As Integer, lastCol As Integer
    lastCol = ws.Cells(1, ws.Columns.Count).End(xlToLeft).Column
    For col = lastCol To 1 Step -1
        If ws.Cells(1, col).Value = "PrivBreak" Or ws.Cells(1, col).Value = "PrivBreakReason" Then
            ws.Columns(col).Delete
        End If
    Next col

    ' Recalculate headers
    lastCol = ws.Cells(1, ws.Columns.Count).End(xlToLeft).Column
    ws.Cells(1, lastCol + 1).Value = "PrivBreak"
    ws.Cells(1, lastCol + 2).Value = "PrivBreakReason"
    Dim colPrivBreak As Long: colPrivBreak = lastCol + 1
    Dim colPrivReason As Long: colPrivReason = lastCol + 2

    ' Load internal domains and emails
    Dim internalDomains As Object: Set internalDomains = CreateObject("Scripting.Dictionary")
    Dim internalEmails As Object: Set internalEmails = CreateObject("Scripting.Dictionary")
    
    Dim r As Long: r = 2
    Do While internalWS.Cells(r, 1).Value <> ""
        Dim dom As String: dom = Trim(LCase(internalWS.Cells(r, 1).Value))
        If dom <> "" Then internalDomains(dom) = 1
        If internalWS.Cells(r, 2).Value <> "" Then internalEmails(LCase(Trim(internalWS.Cells(r, 2).Value))) = 1
        r = r + 1
    Loop

    ' Build header map
    Dim headerMap As Object: Set headerMap = CreateObject("Scripting.Dictionary")
    For col = 1 To ws.Cells(1, ws.Columns.Count).End(xlToLeft).Column
        headerMap(ws.Cells(1, col).Value) = col
    Next col

    ' Check for optional CalcPriv column
    Dim hasCalcPriv As Boolean: hasCalcPriv = headerMap.exists("CalcPriv")

    Dim emailFields As Variant: emailFields = Array("Email From", "Email To", "Email CC")
    Dim row As Long: row = 2

    Do While ws.Cells(row, 1).Value <> ""
        Dim parentID As String: parentID = Trim(ws.Cells(row, headerMap("ParentID")).Value)
        Dim doCalc As Boolean: doCalc = True

        ' If CalcPriv exists, use its value to determine whether to calculate
        If hasCalcPriv Then
            Dim cpVal As Variant
            cpVal = ws.Cells(row, headerMap("CalcPriv")).Value
            If VarType(cpVal) = vbBoolean Then
                doCalc = cpVal
            ElseIf VarType(cpVal) = vbString Then
                doCalc = (LCase(cpVal) = "true")
            Else
                doCalc = False
            End If
        End If

        If parentID = "" And doCalc Then
            Dim reason As String: reason = ""
            Dim anyBreak As Boolean: anyBreak = False

            For Each field In emailFields
                Dim doCol As String: doCol = field & " DO"
                If headerMap.exists(doCol) Then
                    Dim domList As Variant
                    domList = Split(ws.Cells(row, headerMap(doCol)).Value, ";")
                    
                    Dim d As Variant
                    For Each d In domList
                        Dim domain As String: domain = Trim(LCase(d))
                        If domain = "" Then GoTo NextDomain

                        If Not internalDomains.exists(domain) Then
                            ' Check if ALL addresses with this domain are internal
                            Dim fullField As String
                            fullField = ws.Cells(row, headerMap(field & " AO")).Value
                            Dim emails As Variant: emails = Split(fullField, ";")
                            
                            Dim foundExternal As Boolean: foundExternal = False
                            Dim e As Variant
                            For Each e In emails
                                Dim email As String: email = Trim(LCase(e))
                                If InStr(email, "@" & domain) > 0 Then
                                    If Not internalEmails.exists(email) Then
                                        foundExternal = True
                                        Exit For
                                    End If
                                End If
                            Next e
                            
                            If foundExternal Then
                                anyBreak = True
                                'reason = reason & field & " domain not internal: " & domain & vbCrLf
                                reason = reason & field & " domain not internal: " & domain & vbTab
                            End If
                        End If
NextDomain:
                    Next d
                End If
            Next field

            If anyBreak Then
                ws.Cells(row, colPrivBreak).Value = True
                ws.Cells(row, colPrivReason).Value = reason
            Else
                ws.Cells(row, colPrivBreak).Value = False
                ws.Cells(row, colPrivReason).Value = ""
            End If
        End If
        row = row + 1
    Loop

    'MsgBox "PrivBreak analysis complete (with optional CalcPriv logic).", vbInformation
End Sub

Sub PropagatePrivBreaksFromParent()
    Dim ws As Worksheet: Set ws = ActiveSheet
    Dim headerMap As Object: Set headerMap = CreateObject("Scripting.Dictionary")

    Dim col As Long
    For col = 1 To ws.Cells(1, ws.Columns.Count).End(xlToLeft).Column
        headerMap(ws.Cells(1, col).Value) = col
    Next col

    ' Validate required columns
    If Not headerMap.exists("ParentID") Or Not headerMap.exists("PrivBreak") _
        Or Not headerMap.exists("PrivBreakReason") Or Not headerMap.exists("BegDoc") Then
        MsgBox "Required columns missing: BegDoc, ParentID, PrivBreak, PrivBreakReason.", vbExclamation
        Exit Sub
    End If

    Dim lastRow As Long
    lastRow = ws.Cells(ws.Rows.Count, 1).End(xlUp).row

    ' Step 1: Build a dictionary: BegDoc -> PrivBreak
    Dim privMap As Object: Set privMap = CreateObject("Scripting.Dictionary")
    Dim row As Long
    For row = 2 To lastRow
        Dim parentID As String: parentID = Trim(ws.Cells(row, headerMap("ParentID")).Value)
        If parentID = "" Then
            Dim begDoc As String: begDoc = Trim(ws.Cells(row, headerMap("BegDoc")).Value)
            Dim pbVal As Variant: pbVal = ws.Cells(row, headerMap("PrivBreak")).Value
            If begDoc <> "" Then
                privMap(begDoc) = pbVal
            End If
        End If
    Next row

    ' Step 2: Apply PrivBreak to rows with ParentID
    For row = 2 To lastRow
        Dim thisParentID As String: thisParentID = Trim(ws.Cells(row, headerMap("ParentID")).Value)
        If thisParentID <> "" Then
            If privMap.exists(thisParentID) Then
                Dim parentPB As Variant: parentPB = privMap(thisParentID)
                ws.Cells(row, headerMap("PrivBreak")).Value = parentPB
                If parentPB = True Or parentPB = "TRUE" Then
                    ws.Cells(row, headerMap("PrivBreakReason")).Value = "Inherited from parent: " & thisParentID
                Else
                    ws.Cells(row, headerMap("PrivBreakReason")).Value = ""
                End If
            Else
                ws.Cells(row, headerMap("PrivBreak")).Value = ""
                ws.Cells(row, headerMap("PrivBreakReason")).Value = "ParentID not found: " & thisParentID
            End If
        End If
    Next row

    'MsgBox "Fast PrivBreak propagation complete for child rows.", vbInformation
End Sub

Sub AddPrivBreakSummary()
    Dim ws As Worksheet: Set ws = ActiveSheet
    Dim headerMap As Object: Set headerMap = CreateObject("Scripting.Dictionary")
    
    Dim col As Long
    For col = 1 To ws.Cells(1, ws.Columns.Count).End(xlToLeft).Column
        headerMap(ws.Cells(1, col).Value) = col
    Next col
    
    If Not headerMap.exists("PrivBreak") Then
        MsgBox "PrivBreak column not found.", vbExclamation
        Exit Sub
    End If
    
    Dim lastRow As Long
    lastRow = ws.Cells(ws.Rows.Count, headerMap("PrivBreak")).End(xlUp).Row
    Dim summaryStartRow As Long: summaryStartRow = lastRow + 2 ' one blank row
    
    With ws
        .Cells(summaryStartRow, headerMap("PrivBreak") - 1).Value = "PrivBreakTrue"
        .Cells(summaryStartRow, headerMap("PrivBreak")).Formula = _
            "=COUNTIF(" & .Cells(2, headerMap("PrivBreak")).Address & ":" & _
            .Cells(lastRow, headerMap("PrivBreak")).Address & ", TRUE)"
        
        .Cells(summaryStartRow + 1, headerMap("PrivBreak") - 1).Value = "PrivBreakFalse"
        .Cells(summaryStartRow + 1, headerMap("PrivBreak")).Formula = _
            "=COUNTIF(" & .Cells(2, headerMap("PrivBreak")).Address & ":" & _
            .Cells(lastRow, headerMap("PrivBreak")).Address & ", FALSE)"
    End With

    MsgBox "PrivBreak completed and summary rows added.", vbInformation
End Sub

Sub RunAllPrivBreakSteps()
    Dim dataSheet As Worksheet
    Set dataSheet = ActiveSheet

    ' Parse email fields
    dataSheet.Activate
    ParseEmailFields

    ' Detect PrivBreaks
    dataSheet.Activate
    DetectPrivBreaks

    ' Propagate to children
    dataSheet.Activate
    PropagatePrivBreaksFromParent

    ' Add summary
    dataSheet.Activate
    AddPrivBreakSummary
End Sub
