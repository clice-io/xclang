# xclang: its bin\ out of PATH again.
$env:PATH = ($env:PATH -split ';' | Where-Object { $_ -ne "$env:CONDA_PREFIX\opt\xclang\bin" }) -join ';'
