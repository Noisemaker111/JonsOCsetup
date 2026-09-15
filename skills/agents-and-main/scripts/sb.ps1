param([Parameter(Mandatory=$true, Position=0)][ValidateSet('main','agents')][string]$Branch)
$ErrorActionPreference = 'Stop'
function Invoke-Git {
    $result = & git @args
    if ($LASTEXITCODE -ne 0) { throw "git $($args -join ' ') failed; no changes were discarded." }
    return $result
}
try {
    $root = Invoke-Git rev-parse --show-toplevel
    if (Invoke-Git -C $root status --porcelain) {
        throw 'This checkout has uncommitted changes. Commit or move them before switching.'
    }
    Invoke-Git -C $root fetch origin $Branch
    & git -C $root show-ref --verify --quiet "refs/heads/$Branch"
    if ($LASTEXITCODE -eq 0) {
        # Refuse divergent or ahead local branches before changing the checkout.
        & git -C $root merge-base --is-ancestor $Branch "origin/$Branch"
        if ($LASTEXITCODE -ne 0) { throw "Local $Branch has commits outside origin/$Branch; reconcile them explicitly." }
        Invoke-Git -C $root switch $Branch
    } else {
        Invoke-Git -C $root switch --track -c $Branch "origin/$Branch"
    }
    Invoke-Git -C $root merge --ff-only "origin/$Branch"
    Write-Output "Now on $Branch in $root"
} catch {
    Write-Error $_
    exit 1
}
