Set oShell = CreateObject("WScript.Shell")
Set oFSO = CreateObject("Scripting.FileSystemObject")
sAppDir = oFSO.GetParentFolderName(WScript.ScriptFullName)

' Check if node_modules exists
If Not oFSO.FolderExists(sAppDir & "\node_modules") Then
    oShell.Run "cmd.exe /c cd /d """ & sAppDir & """ && npm install", 0, True
End If

' Start Next.js dev server hidden (0 = hidden window)
oShell.Run "cmd.exe /c cd /d """ & sAppDir & """ && npm run dev", 0, False

' Wait until port 3030 is responding
Set oHttp = CreateObject("MSXML2.ServerXMLHTTP.6.0")
bReady = False
For i = 1 To 45
    WScript.Sleep 1000
    On Error Resume Next
    oHttp.Open "GET", "http://localhost:3030", False
    oHttp.setTimeouts 500, 500, 500, 500
    oHttp.Send
    If Err.Number = 0 Then
        If oHttp.Status > 0 Then
            bReady = True
            Exit For
        End If
    End If
    Err.Clear
    On Error GoTo 0
Next

' Open in default browser
oShell.Run "http://localhost:3030"
