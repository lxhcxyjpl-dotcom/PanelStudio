param([Parameter(Mandatory)][string]$Ballot)
$ErrorActionPreference = 'Stop'
$source = (Resolve-Path -LiteralPath $Ballot).Path
$cases = Get-Content -Raw -LiteralPath (Join-Path $source 'illustrator-input.json') -Encoding UTF8 | ConvertFrom-Json
$template = Get-Content -Raw -LiteralPath (Join-Path $PSScriptRoot 'verify-illustrator.jsx') -Encoding UTF8
$run = Join-Path (Split-Path $source -Parent) ('illustrator/' + [Guid]::NewGuid().ToString('N'))
[IO.Directory]::CreateDirectory($run) | Out-Null
$app = New-Object -ComObject Illustrator.Application
$results = @()
foreach ($case in $cases) {
  if ($case.file -notmatch '^Q[0-9]+-[AB]\.svg$') { throw 'Unknown sample file name' }
  $copy = Join-Path $run $case.file
  Copy-Item -LiteralPath (Join-Path $source ('media/' + $case.file)) -Destination $copy
  $script = $template.Replace('__INPUT__', (ConvertTo-Json $copy.Replace('\','/') -Compress)).Replace('__SPEC__', (ConvertTo-Json $case -Depth 8 -Compress))
  $fields = ($app.DoJavaScript($script)).Split('|')
  $culture = [Globalization.CultureInfo]::InvariantCulture
  $canvasError = [double]::Parse($fields[2],$culture)
  $frameError = [double]::Parse($fields[4],$culture)
  $pass = [int]$fields[1] -eq 1 -and $canvasError -le 0.1 -and [int]$fields[3] -eq $case.boxes.Count -and $frameError -le 0.1 -and $fields[5] -eq 'true'
  $results += [ordered]@{ file=$case.file; version=$fields[0]; artboards=[int]$fields[1]; canvasMaxErrorMm=$canvasError; independentObjects=[int]$fields[3]; embeddedRasters=[int]$fields[6]; frameMaxErrorMm=$frameError; individuallyMovable=($fields[5] -eq 'true'); pass=$pass }
}
$results | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $run 'report.json') -Encoding UTF8
Write-Output (Join-Path $run 'report.json')
if (@($results | Where-Object { -not $_.pass }).Count) { exit 1 }
