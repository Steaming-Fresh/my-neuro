[CmdletBinding()]
param(
    [switch]$Force
)

$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$referenceRoot = Join-Path $repoRoot "reference-projects"

$projects = @(
    @{
        Name = "N.E.K.O"
        Url = "https://github.com/Project-N-E-K-O/N.E.K.O.git"
        Branch = "main"
    }
)

function Invoke-Git {
    param(
        [Parameter(Mandatory = $true)]
        [string]$RepositoryPath,
        [Parameter(ValueFromRemainingArguments = $true)]
        [string[]]$Arguments
    )

    & git "-c" "safe.directory=$RepositoryPath" "-C" $RepositoryPath @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "git command failed for ${RepositoryPath}: git $($Arguments -join ' ')"
    }
}

New-Item -ItemType Directory -Force -Path $referenceRoot | Out-Null

foreach ($project in $projects) {
    $targetPath = Join-Path $referenceRoot $project.Name

    if (Test-Path $targetPath) {
        $hasGitDir = Test-Path (Join-Path $targetPath ".git")

        if ($Force) {
            Remove-Item -Recurse -Force $targetPath
        } else {
            if (-not $hasGitDir) {
                Write-Host "Keeping existing snapshot for $($project.Name) in $targetPath"
                continue
            }
            Write-Host "Updating $($project.Name) in $targetPath"
            Invoke-Git -RepositoryPath $targetPath fetch --depth 1 origin $project.Branch
            Invoke-Git -RepositoryPath $targetPath checkout --force "origin/$($project.Branch)"
            continue
        }
    }

    Write-Host "Cloning $($project.Name) into $targetPath"
    & git clone --depth 1 --filter=blob:none --single-branch --branch $project.Branch --no-tags $project.Url $targetPath
    if ($LASTEXITCODE -ne 0) {
        throw "clone failed for $($project.Name)"
    }
}

Write-Host "Reference projects are ready."
