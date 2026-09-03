# 只杀 web 相关的 node 进程(next dev / dev-web.mjs / pnpm dev),不动 chat/indexer/Kimi 运行时
$targets = @(29216, 31184, 32284, 38320, 41780, 40916)
foreach ($pid_ in $targets) {
  $p = Get-Process -Id $pid_ -ErrorAction SilentlyContinue
  if ($p) { Stop-Process -Id $pid_ -Force -ErrorAction SilentlyContinue; Write-Output "killed $pid_" }
}
Start-Sleep -Seconds 2
$left = Get-Process node -ErrorAction SilentlyContinue | Where-Object { $_.Id -in $targets }
if ($left) { Write-Output "still alive: $($left.Id -join ',')" } else { Write-Output "web processes cleared" }
