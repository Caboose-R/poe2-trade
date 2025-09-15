@echo off
echo Installing PoE2 Trade dependencies...

echo.
echo Installing Node.js dependencies...
call npm install
if %errorlevel% neq 0 (
    echo Failed to install Node.js dependencies
    pause
    exit /b 1
)

echo.
echo Installing Python dependencies...
call pip install -r python/requirements.txt
if %errorlevel% neq 0 (
    echo Failed to install Python dependencies
    echo Trying with --user flag...
    call pip install --user -r python/requirements.txt
    if %errorlevel% neq 0 (
        echo Failed to install Python dependencies even with --user flag
        pause
        exit /b 1
    )
)

echo.
echo Installation completed successfully!
echo You can now run: npm run dev
pause
