$chat = Get-NetTCPConnection -LocalPort 8080 -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty OwningProcess
if ($chat) { Stop-Process -Id $chat -Force; Write-Output "killed old chat PID $chat" } else { Write-Output 'no chat on 8080' }
$node = (Get-Command node).Source
$chatDir = Join-Path $PSScriptRoot '..\apps\chat'
Start-Process $node -ArgumentList 'node_modules/tsx/dist/cli.mjs','src/server.ts' -WorkingDirectory $chatDir -WindowStyle Hidden
Start-Sleep -Seconds 3
$listen = Get-NetTCPConnection -LocalPort 8080 -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
if ($listen) { Write-Output "chat listening, PID $($listen.OwningProcess)" } else { Write-Output 'chat NOT listening' }
