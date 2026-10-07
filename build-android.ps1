$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
$env:JAVA_HOME = 'E:\toolchain\jdk17'
$env:ANDROID_HOME = 'E:\toolchain\android-sdk'
$env:GRADLE_USER_HOME = 'D:\gradle'
$gradleExe = 'D:\gradle\wrapper\dists\gradle-8.11.1-bin\eac4u065zwes5phgltp5f9b9e\gradle-8.11.1\bin\gradle.bat'

& npm.cmd run build
if ($LASTEXITCODE) { throw 'Web build failed' }

& $gradleExe --no-daemon clean assembleDebug
if ($LASTEXITCODE) { throw 'Android build failed' }

Write-Output 'APK: app\build\outputs\apk\debug\app-debug.apk'
