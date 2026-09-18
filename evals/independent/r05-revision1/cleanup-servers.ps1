$ErrorActionPreference='Stop'
$independentRoot=Split-Path $PSScriptRoot -Parent
$map=@{4187='baseline';4188='r01';4189='r01-revision1';4190='r01-revision1-final';4191='r02';4192='r03';4193='r03-revision1';4194='r03-revision2';4195='r04';4196='r04-revision1';4197='r05';4198='r05';4199='r05-revision1'}
$client=[System.Net.Http.HttpClient]::new()
$result=foreach($port in ($map.Keys | Sort-Object)){
  $listener=Get-NetTCPConnection -LocalAddress '127.0.0.1' -LocalPort $port -State Listen -ErrorAction SilentlyContinue
  if(!$listener){@{port=$port;status='already_stopped'};continue}
  $process=Get-CimInstance Win32_Process -Filter "ProcessId = $($listener.OwningProcess)"
  $bytes=$client.GetByteArrayAsync("http://127.0.0.1:$port/game.js").GetAwaiter().GetResult()
  $hash=[Convert]::ToHexString([System.Security.Cryptography.SHA256]::HashData($bytes)).ToLower()
  $expected=(Get-FileHash -LiteralPath (Join-Path $independentRoot "$($map[$port])/site/game.js") -Algorithm SHA256).Hash.ToLower()
  if($hash -ne $expected -or $process.CommandLine -notmatch 'node.exe.*(server|evidence-server)\.cjs') {throw "Ownership verification failed for port $port"}
  Stop-Process -Id $listener.OwningProcess
  @{port=$port;pid=$listener.OwningProcess;status='stopped';snapshot=$map[$port];verifiedGameSha256=$hash}
}
$client.Dispose()
@{humanStatus='not_run';stopped=@($result);retainedPreview='http://127.0.0.1:4200/index.html'} | ConvertTo-Json -Depth 5 | Set-Content (Join-Path $PSScriptRoot 'server-cleanup.json')
