param(
  [Parameter(Mandatory = $true)][string]$InputFile,
  [ValidateSet('Word', 'WPS')][string]$Reader = 'Word',
  [string]$OutputDirectory = 'output/word-acceptance'
)
$ErrorActionPreference = 'Stop'
$source = (Resolve-Path -LiteralPath $InputFile).Path
$null = New-Item -ItemType Directory -Force -Path $OutputDirectory
$destination = (Resolve-Path -LiteralPath $OutputDirectory).Path
$stem = [IO.Path]::GetFileNameWithoutExtension($source) + '-' + $Reader + '-' + (Get-Date -Format 'yyyyMMdd-HHmmssfff')
$copy = Join-Path $destination ($stem + '.docx')
$pdf = Join-Path $destination ($stem + '.pdf')
# Work on a unique copy. Never save reader changes into the generated source.
Copy-Item -LiteralPath $source -Destination $copy
$application = $null
$document = $null
$ownedApplication = $false
try {
  $application = New-Object -ComObject $(if ($Reader -eq 'Word') { 'Word.Application' } else { 'KWPS.Application' })
  $ownedApplication = $application.Documents.Count -eq 0
  if ($ownedApplication) { $application.Visible = $false; $application.DisplayAlerts = 0 }
  $document = $application.Documents.Open($copy, $false, $false)
  # Two passes resolve forward REF fields after SEQ and pagination updates.
  for ($pass = 0; $pass -lt 2; $pass++) {
    $null = $document.Fields.Update()
    foreach ($toc in $document.TablesOfContents) { $toc.Update() }
    $document.Repaginate()
    foreach ($section in $document.Sections) {
      foreach ($header in $section.Headers) { if ($header.Exists) { $null = $header.Range.Fields.Update() } }
      foreach ($footer in $section.Footers) { if ($footer.Exists) { $null = $footer.Range.Fields.Update() } }
    }
  }
  $fields = @($document.Fields | ForEach-Object { @{ code = $_.Code.Text.Trim(); result = $_.Result.Text.Trim() } })
  $paragraphs = @($document.Paragraphs | ForEach-Object {
    if ($_.Range.ListFormat.ListString) { @{ text = $_.Range.Text.Trim(); number = $_.Range.ListFormat.ListString } }
  })
  $sections = @($document.Sections | ForEach-Object { @{ orientation = $_.PageSetup.Orientation; width = $_.PageSetup.PageWidth; height = $_.PageSetup.PageHeight } })
  $report = @{ reader = $Reader; version = $application.Version; source = $source; updatedDocx = $copy; pdf = $pdf;
    pages = $document.ComputeStatistics(2); footnotes = $document.Footnotes.Count; tables = $document.Tables.Count;
    toc = $document.TablesOfContents.Count; fields = $fields; numberedParagraphs = $paragraphs; sections = $sections }
  $document.Save()
  $document.ExportAsFixedFormat($pdf, 17)
  $report | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $destination ($stem + '.json')) -Encoding utf8
  $report | ConvertTo-Json -Depth 8
} finally {
  if ($document) { $document.Close(0); $null = [Runtime.InteropServices.Marshal]::FinalReleaseComObject($document) }
  if ($application) {
    if ($ownedApplication) { $application.Quit() }
    $null = [Runtime.InteropServices.Marshal]::FinalReleaseComObject($application)
  }
}
