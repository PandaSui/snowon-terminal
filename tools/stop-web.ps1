# 停掉 3000 端口的 web dev 整棵进程树(next dev 有子进程)
$root = Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty OwningProcess
if ($root) {
  # 找父进程链(dev-web.mjs / bash)
  $ids = @($root)
  $p = Get-CimInstance Win32_Process -Filter "ProcessId=$root" -ErrorAction SilentlyContinue
  while ($p -and $p.ParentProcessId -and $p.Name -match 'node') {
    $ids += $p.ParentProcessId
    $p = Get-CimInstance Win32_Process -Filter "ProcessId=$($p.ParentProcessId)" -ErrorAction SilentlyContinue
  }
  # next 的子进程(命令行含 next 的 node)
  $children = Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue | Where-Object { $_.CommandLine -match 'next' }
  foreach ($c in $children) { $ids += $c.ProcessId }
  $ids | Sort-Object -Unique | ForEach-Object { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue; Write-Output "killed $_" }
} else { Write-Output 'no listener on 3000' }
