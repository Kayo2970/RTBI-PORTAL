Set oShell = CreateObject("WScript.Shell")
oShell.Run "powershell -NoProfile -ExecutionPolicy Bypass -Command ""try { $p = (Get-NetTCPConnection -LocalPort 3030 -State Listen -ErrorAction Stop).OwningProcess; Stop-Process -Id $p -Force } catch {}; exit 0""", 0, True
MsgBox "RTBI Portal server (Port 3030) has been stopped.", 64, "RTBI Portal"

