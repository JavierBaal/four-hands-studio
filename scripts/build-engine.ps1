# Four Hands Studio: builds the native audio engine on Windows and checks that it plays.
# Needs Build Tools for Visual Studio 2022 with "Desktop development with C++" (it includes CMake).
# Usage, from the repository root:  powershell -ExecutionPolicy Bypass -File scripts\build-engine.ps1
# Leaves "Four Hands Engine.exe" in engine\build\FourHandsEngine_artefacts\Release, where the app looks for it.
$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
$source = Join-Path $repo 'engine'
# A short build folder outside the repository: JUCE has long paths.
$build = Join-Path $env:LOCALAPPDATA 'FourHandsEngine\build'
$target = Join-Path $source 'build\FourHandsEngine_artefacts\Release'

try {
  Write-Host "`n== Build tools ==" -ForegroundColor Cyan
  $vswhere = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio\Installer\vswhere.exe'
  if (-not (Test-Path $vswhere)) { throw "Visual Studio Build Tools not found. Install 'Build Tools for Visual Studio 2022' with 'Desktop development with C++' (https://visualstudio.microsoft.com/visual-cpp-build-tools/)." }
  $vs = & $vswhere -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
  if (-not $vs) { throw "Visual Studio is installed, but without the C++ compiler. Open the Visual Studio Installer and add 'Desktop development with C++'." }
  Write-Host "Visual Studio: $vs"
  $cmake = Join-Path $vs 'Common7\IDE\CommonExtensions\Microsoft\CMake\CMake\bin\cmake.exe'
  if (-not (Test-Path $cmake)) {
    $found = Get-Command cmake -ErrorAction SilentlyContinue
    if ($found) { $cmake = $found.Source } else { throw "CMake not found. In the Visual Studio Installer, add 'C++ CMake tools for Windows'." }
  }
  & $cmake --version | Select-Object -First 1 | Out-Host

  Write-Host "`n== Configuring (the first time downloads JUCE: a few minutes) ==" -ForegroundColor Cyan
  & $cmake -S $source -B $build -G "Visual Studio 17 2022" -A x64 -DFH_TEST_PLUGIN=ON
  if ($LASTEXITCODE -ne 0) { throw "Configuring (cmake) failed." }

  Write-Host "`n== Building (the first time takes 5 to 15 minutes) ==" -ForegroundColor Cyan
  $t0 = Get-Date
  & $cmake --build $build --config Release --parallel
  if ($LASTEXITCODE -ne 0) { throw "The build failed." }
  Write-Host ("Built in {0:N0} s" -f ((Get-Date) - $t0).TotalSeconds)

  Write-Host "`n== Copying the engine to $target ==" -ForegroundColor Cyan
  $exe = Join-Path $build 'FourHandsEngine_artefacts\Release\Four Hands Engine.exe'
  if (-not (Test-Path $exe)) { throw "The built engine is not at $exe." }
  New-Item -ItemType Directory -Force -Path $target | Out-Null
  Copy-Item $exe $target -Force
  $tests = Join-Path $target 'test-plugins'
  New-Item -ItemType Directory -Force -Path $tests | Out-Null
  $synth = Join-Path $build 'test-synth\FourHandsTestSynth_artefacts\Release\VST3\Four Hands Test Synth.vst3'
  if (Test-Path $synth) { Copy-Item $synth $tests -Recurse -Force }

  Write-Host "`n== Self test: load the test instrument and play a note ==" -ForegroundColor Cyan
  $out = Join-Path $env:TEMP 'fourhands-engine-selftest.txt'
  $p = Start-Process -FilePath (Join-Path $target 'Four Hands Engine.exe') -ArgumentList @('--selftest', "`"$tests`"") -Wait -PassThru -RedirectStandardOutput $out -WindowStyle Hidden
  if (Test-Path $out) { Get-Content $out | Out-Host }
  if ($p.ExitCode -ne 0) { throw "The self test failed (exit code $($p.ExitCode))." }

  Write-Host "`nDone: the engine is built and plays. Open Four Hands with 'npm run app'." -ForegroundColor Green
} catch {
  Write-Host "`nERROR: $_" -ForegroundColor Red
  exit 1
}
