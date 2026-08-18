@echo off
echo === tilas01 Release Integrity Verifier ===
if "%~1"=="" (
    echo Usage: verify-integrity.bat ^<binary-file^>
    exit /b 1
)

set BINARY=%~1
set SHA_FILE=%BINARY%.sha256
set ASC_FILE=%BINARY%.asc
set PUB_KEY=tilas01-public-key.asc

if not exist "%BINARY%" (
    echo Error: Missing binary file.
    exit /b 1
)
if not exist "%SHA_FILE%" (
    echo [i] Missing .sha256 file. Attempting to download...
    curl -sLO "https://github.com/tilas01/Unix-SIT/releases/latest/download/%SHA_FILE%"
)
if not exist "%ASC_FILE%" (
    echo [i] Missing .asc file. Attempting to download...
    curl -sLO "https://github.com/tilas01/Unix-SIT/releases/latest/download/%ASC_FILE%"
)

if not exist "%SHA_FILE%" (
    echo [ERROR] Failed to download or find "%SHA_FILE%".
    exit /b 1
)

echo [1/2] Verifying SHA-256 Hash...
certutil -hashfile "%BINARY%" SHA256 > temp_hash.txt
findstr /v "hash" temp_hash.txt | findstr /v "CertUtil" > computed_hash.txt
set /p COMPUTED=<computed_hash.txt
set COMPUTED=%COMPUTED: =%

set /p EXPECTED=<"%SHA_FILE%"
for /f "tokens=1" %%a in ("%EXPECTED%") do set EXPECTED=%%a

del temp_hash.txt computed_hash.txt

if /i "%COMPUTED%"=="%EXPECTED%" (
    echo [OK] Hash matches successfully.
) else (
    echo [ERROR] HASH VERIFICATION FAILED! Do not run this binary.
    echo Computed: %COMPUTED%
    echo Expected: %EXPECTED%
    exit /b 1
)

if exist "%ASC_FILE%" (
    echo.
    echo [2/2] Verifying GPG Signature...
    if not exist "%PUB_KEY%" (
        echo Public key not found locally. Downloading official key from GitHub...
        curl -sL "https://raw.githubusercontent.com/tilas01/Unix-SIT/main/tilas01-public-key.asc" -o "%PUB_KEY%"
    )
    set GPG_INSTALLED_BY_SCRIPT=0
    where gpg >nul 2>nul
    if %ERRORLEVEL% neq 0 (
        echo [!] GPG not found. Auto-installing GnuPG via winget...
        winget install GnuPG.GnuPG --silent --accept-package-agreements --accept-source-agreements
        set GPG_INSTALLED_BY_SCRIPT=1
        :: Add standard install path to temporary PATH just in case it doesn't refresh
        set PATH=%PATH%;C:\Program Files (x86)\GnuPG\bin
    )

    gpg --import "%PUB_KEY%" 2>NUL
    gpg --verify "%ASC_FILE%" "%BINARY%"
    if %ERRORLEVEL% neq 0 (
        echo [ERROR] GPG SIGNATURE VERIFICATION FAILED! Do not run this binary.
        if "%GPG_INSTALLED_BY_SCRIPT%"=="1" (
            echo Cleaning up GnuPG...
            winget uninstall GnuPG.GnuPG --silent
        )
        exit /b 1
    )
    echo [OK] GPG Signature matches successfully.

    if "%GPG_INSTALLED_BY_SCRIPT%"=="1" (
        echo [i] Auto-deleting GnuPG tool to maintain clean system...
        winget uninstall GnuPG.GnuPG --silent
    )
) else (
    echo.
    echo [2/2] Skipping GPG check ^(missing .asc file^).
)

echo.
echo Integrity check passed. You may safely run the binary.
