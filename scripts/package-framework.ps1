param([string]$OutputDirectory = (Join-Path (Split-Path -Parent $PSScriptRoot) 'dist'))
$ErrorActionPreference = 'Stop'
$root = [IO.Path]::GetFullPath((Split-Path -Parent $PSScriptRoot))
$output = [IO.Path]::GetFullPath($OutputDirectory)
if (-not $output.StartsWith($root.TrimEnd('\') + '\', [StringComparison]::OrdinalIgnoreCase)) { throw "Output directory must be inside the repository: $output" }
if (Test-Path -LiteralPath $output) { Remove-Item -LiteralPath $output -Recurse -Force }
$bundle = Join-Path $output 'framework'
$rootFiles = Join-Path $bundle 'Root'
$package = Join-Path $bundle 'Package'
New-Item -ItemType Directory -Force -Path $rootFiles, (Join-Path $package 'Maintenance\Source'), (Join-Path $package 'Tools') | Out-Null

$compiler = 'C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe'
if (-not (Test-Path -LiteralPath $compiler)) { throw "The .NET Framework C# compiler is unavailable: $compiler" }
$launcherSource = Join-Path $root 'framework\Launcher\PortableLauncher.cs'
$launcherIcon = Join-Path $root 'framework\Launcher\ObsidianPortable.ico'
$launcherOutput = Join-Path $rootFiles 'Obsidian Portable.exe'
& $compiler /nologo /target:winexe /platform:anycpu /optimize+ /reference:System.Windows.Forms.dll /reference:System.Web.Extensions.dll "/win32icon:$launcherIcon" "/out:$launcherOutput" $launcherSource
if ($LASTEXITCODE -ne 0) { throw "Launcher compilation failed with exit code $LASTEXITCODE" }

Copy-Item -LiteralPath (Join-Path $root 'framework\framework-manifest.json') -Destination (Join-Path $bundle 'framework-manifest.json')
Copy-Item -LiteralPath (Join-Path $root 'framework\Maintenance\PortableMaintenance.ps1') -Destination (Join-Path $package 'Maintenance\PortableMaintenance.ps1')
Copy-Item -LiteralPath (Join-Path $root 'framework\Maintenance\PortableBootstrap.ps1') -Destination (Join-Path $package 'Maintenance\PortableBootstrap.ps1')
Copy-Item -LiteralPath $launcherSource -Destination (Join-Path $package 'Maintenance\Source\PortableLauncher.cs')
Copy-Item -LiteralPath $launcherIcon -Destination (Join-Path $package 'Maintenance\Source\ObsidianPortable.ico')
Copy-Item -LiteralPath (Join-Path $root 'third_party\7zip\7z.exe') -Destination (Join-Path $package 'Tools\7z.exe')
Copy-Item -LiteralPath (Join-Path $root 'third_party\7zip\7z.dll') -Destination (Join-Path $package 'Tools\7z.dll')
Copy-Item -LiteralPath (Join-Path $root 'third_party\7zip\LICENSE.txt') -Destination (Join-Path $package 'Tools\LICENSE-7ZIP.txt')

$frameworkVersion = (Get-Content -LiteralPath (Join-Path $root 'framework\framework-manifest.json') -Raw | ConvertFrom-Json).frameworkVersion
if ((Get-Item -LiteralPath $launcherOutput).VersionInfo.FileVersion -ne "${frameworkVersion}.0") { throw 'Compiled launcher version does not match the framework manifest.' }
& (Join-Path $root 'scripts\smoke-launcher.ps1') -FrameworkDirectory $bundle
$archive = Join-Path $output 'portable-framework.zip'
Compress-Archive -Path (Join-Path $bundle '*') -DestinationPath $archive -CompressionLevel Optimal
$hash = (Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLowerInvariant()
"$hash  portable-framework.zip" | Set-Content -LiteralPath (Join-Path $output 'portable-framework.sha256') -Encoding Ascii
Write-Host "Packaged framework $frameworkVersion at $archive"
