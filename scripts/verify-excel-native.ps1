$ErrorActionPreference='Stop'
$path=(Resolve-Path '.artifacts\benchmark-audit.xlsx').Path
$copy=Join-Path (Split-Path $path) ("benchmark-audit-recalculated-" + [guid]::NewGuid().ToString('N') + '.xlsx')
Copy-Item -LiteralPath $path -Destination $copy -Force
$excel=New-Object -ComObject Excel.Application
$excel.Visible=$false
$excel.DisplayAlerts=$false
try {
 $book=$excel.Workbooks.Open($copy)
 $excel.CalculateFullRebuild()
 $summary=$book.Worksheets.Item('Executive Summary')
 $expected=@{6=399800;7=7996;9=7246;10=750;11=4004}
 foreach($row in $expected.Keys){if([decimal]$summary.Cells.Item($row,2).Value2 -ne [decimal]$expected[$row]){throw "Excel recalculation row $row mismatch"}}
 $trail=$book.Worksheets.Item('Full Transaction Audit Trail')
 $before=[decimal]$summary.Cells.Item(5,2).Value2
 $last=$trail.UsedRange.Rows.Count+1
 $trail.Cells.Item($last,1).Value2='MUTATION-TEST'
 $trail.Cells.Item($last,11).Value2=123.45
 $excel.CalculateFullRebuild()
 if([decimal]$summary.Cells.Item(5,2).Value2 -ne ($before+[decimal]123.45)){throw 'Dynamic SUM failed added-row mutation'}
 $trail.Rows.Item($last).Delete() | Out-Null
 $excel.CalculateFullRebuild()
 $book.Save()
 $book.Close($false)
 Write-Output 'Native Excel PASS: full recalculation exact launch totals; new-row SUM mutation updates automatically.'
} finally {
 try { $excel.Quit() } catch { }
 try { [Runtime.InteropServices.Marshal]::ReleaseComObject($excel) | Out-Null } catch { }
}
