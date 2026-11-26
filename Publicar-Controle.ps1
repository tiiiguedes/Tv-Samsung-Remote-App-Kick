$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
$cliDir = Join-Path $root '.kick-install/installer'
$cli = Join-Path $cliDir 'apps2samsung-cli.exe'
$version = '3.3.1'
$archiveHash = '286FC1FCD3C82A3F39A0CFF90C5699818300ADD981BBC44B77E2D1A04289B351'

if (!(Test-Path -LiteralPath $cli -PathType Leaf)) {
    $archive = Join-Path ([IO.Path]::GetTempPath()) ("apps2samsung-" + [guid]::NewGuid() + ".zip")
    try {
        $release = "https://github.com/Apps2Samsung/Apps2Samsung/releases/download/v$version"
        Invoke-WebRequest "$release/Apps2Samsung.Cli-v$version-win-x64.zip" -OutFile $archive -UseBasicParsing
        if ((Get-FileHash -LiteralPath $archive).Hash -ne $archiveHash) {
            throw 'O arquivo do Apps2Samsung diverge do SHA-256 esperado.'
        }
        Expand-Archive -LiteralPath $archive -DestinationPath $cliDir -Force
    } finally {
        if (Test-Path -LiteralPath $archive) { Remove-Item -LiteralPath $archive }
    }
}

Add-Type -AssemblyName System.IO.Compression.FileSystem
$package = Join-Path $root 'TvKick.wgt'
$temporary = "$package.$([guid]::NewGuid()).tmp"
try {
    [IO.Compression.ZipFile]::CreateFromDirectory((Join-Path $root 'TvKick'), $temporary)
    Copy-Item -LiteralPath $temporary -Destination $package -Force
} finally {
    if (Test-Path -LiteralPath $temporary) { Remove-Item -LiteralPath $temporary }
}

$output = Join-Path $root 'dist'
dotnet publish (Join-Path $root 'ControleSamsung.csproj') -c Release -r win-x64 --self-contained true -p:PublishSingleFile=true -p:EnableCompressionInSingleFile=true -p:IncludeNativeLibrariesForSelfExtract=true -o $output
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
Write-Host "Controle pronto em $output\ControleSamsung-Fluent.exe"
