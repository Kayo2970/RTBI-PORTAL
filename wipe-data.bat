@echo off
title RTBI Portal - Wipe Data & Memory
cls
echo ===================================================
echo     RTBI PORTAL - WIPE ALL DATA ^& MEMORY
echo ===================================================
echo.
echo WARNING: This will permanently delete all database
echo collections, members, events, tasks, uploads, and
echo reset the portal for fresh setup.
echo.
set /p CONFIRM="Are you sure you want to proceed? (Y/N): "
if /i not "%CONFIRM%"=="Y" (
    echo.
    echo Operation cancelled. No data was modified.
    pause
    exit /b
)

echo.
echo Wiping data directory...
node scripts\wipe-data.js
echo.
echo Done!
pause

