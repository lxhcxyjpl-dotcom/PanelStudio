param(
  [Parameter(Mandatory)][string]$Samples,
  [Parameter(Mandatory)][string]$Output,
  [switch]$RestoreLabelFonts
)
$ErrorActionPreference = 'Stop'
$source = (Resolve-Path -LiteralPath $Samples).Path
$destination = [IO.Path]::GetFullPath($Output)
if (Test-Path -LiteralPath $destination) { throw 'Choose a new output directory to preserve previous Illustrator results.' }
[IO.Directory]::CreateDirectory($destination) | Out-Null
$cases = Get-Content -LiteralPath (Join-Path $source 'manifest.json') -Encoding UTF8 -Raw | ConvertFrom-Json
$template = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'check-document.jsx') -Encoding UTF8 -Raw
$helper = if ($RestoreLabelFonts) { Get-Content -LiteralPath (Join-Path $PSScriptRoot 'label-faces.jsxinc') -Encoding UTF8 -Raw } else { '' }
$template = $template.Replace('__FONT_HELPER__', $helper).Replace('__RESTORE_FACES__', $RestoreLabelFonts.IsPresent.ToString().ToLowerInvariant())
$app = New-Object -ComObject Illustrator.Application
$records = @()
foreach ($sample in $cases) {
  if ($sample.name -notmatch '^[a-zA-Z0-9-]+$') { throw 'Invalid sample name.' }
  $inputFile = Join-Path $source ($sample.name + '.svg')
  $script = $template.Replace('__SPEC__', (ConvertTo-Json $sample -Depth 12 -Compress))
  $script = $script.Replace('__INPUT__', (ConvertTo-Json ($inputFile.Replace('\','/')) -Compress))
  $script = $script.Replace('__OUTPUT__', (ConvertTo-Json ($destination.Replace('\','/')) -Compress))
  $record = $app.DoJavaScript($script) | ConvertFrom-Json
  $records += $record
  $record | ConvertTo-Json -Depth 12 | Set-Content -Encoding UTF8 -LiteralPath (Join-Path $destination ($sample.name + '.json'))
  $passed = @($record.checks | Where-Object { $_.pass }).Count
  Write-Output ($sample.name + ' ' + $passed + '/' + $record.checks.Count)
}
$report = [ordered]@{ version = $app.Version; restoreLabelFonts = $RestoreLabelFonts.IsPresent; windows = [Environment]::OSVersion.Version.ToString(); generatedUtc = [DateTime]::UtcNow.ToString('o'); records = $records }
$report | ConvertTo-Json -Depth 14 | Set-Content -Encoding UTF8 -LiteralPath (Join-Path $destination 'report.json')
if (@($records.checks | Where-Object { -not $_.pass }).Count) { exit 1 }
