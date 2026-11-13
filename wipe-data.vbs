Set oShell = CreateObject("WScript.Shell")
Set oFSO = CreateObject("Scripting.FileSystemObject")
sAppDir = oFSO.GetParentFolderName(WScript.ScriptFullName)

nRes = MsgBox("Are you sure you want to completely wipe all application memory and database collections?" & vbCrLf & vbCrLf & "This will delete all stored members, tasks, events, and uploads so you can start fresh.", 36, "RTBI Portal - Wipe Data")

If nRes = 6 Then ' Yes
    oShell.Run "cmd.exe /c cd /d """ & sAppDir & """ && node scripts\wipe-data.js", 0, True
    MsgBox "All application data and memory have been wiped clean." & vbCrLf & "The portal is ready for fresh setup.", 64, "RTBI Portal"
End If
