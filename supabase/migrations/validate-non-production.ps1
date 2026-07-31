[CmdletBinding()]
param(
    [Parameter(Mandatory)]
    [ValidateNotNullOrEmpty()]
    [string]$NonProductionDatabaseUrl,

    [Parameter(Mandatory)]
    [switch]$ConfirmNonProduction
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

if (-not $ConfirmNonProduction) {
    throw 'Pass -ConfirmNonProduction only for a disposable non-production database.'
}

if ($NonProductionDatabaseUrl -match '(?i)(?<!non[-_])\b(?:prod|production)\b') {
    throw 'The supplied database URL appears to identify production. Use a disposable non-production database.'
}

$directory = $PSScriptRoot
$migrations = @(
    '001_add_expense_metadata.sql',
    '002_corrections_and_rpcs.sql',
    '003_accuracy_and_trend_rpcs.sql',
    '004_planning_schema.sql'
)
$missing = $migrations | Where-Object { -not (Test-Path (Join-Path $directory $_)) }
if ($missing) {
    throw "Required migration artifact(s) are missing: $($missing -join ', '). No database connection was opened."
}

$psql = Get-Command psql -ErrorAction SilentlyContinue
if (-not $psql) {
    throw 'PostgreSQL psql is required to run the non-production validation.'
}

$fixture = Join-Path $directory 'legacy_expenses_fixture.sql'
$checks = Join-Path $directory 'validate_expansion_migrations.sql'
$previousDatabase = $env:PGDATABASE
$env:PGDATABASE = $NonProductionDatabaseUrl

try {
    & $psql.Source --no-psqlrc --set ON_ERROR_STOP=1 --file $fixture
    foreach ($pass in 1..2) {
        foreach ($migration in $migrations) {
            & $psql.Source --no-psqlrc --set ON_ERROR_STOP=1 --file (Join-Path $directory $migration)
        }
    }
    & $psql.Source --no-psqlrc --set ON_ERROR_STOP=1 --file $checks
}
finally {
    $env:PGDATABASE = $previousDatabase
}
