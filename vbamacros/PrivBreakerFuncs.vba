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

    MsgBox "Email parsing completed.", vbInformation
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
        ws.Cells(i, 1).Value = key
        i = i + 1
    Next key
End Sub


