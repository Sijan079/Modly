$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$personalSkillRoot = Join-Path ([Environment]::GetFolderPath('UserProfile')) '.agents/skills'
$skillNames = @('minecraft-modding', 'minecraft-testing', 'design-taste-frontend')
$entries = foreach ($skillName in $skillNames) {
    $skillPath = Join-Path $personalSkillRoot "$skillName/SKILL.md"
    if (-not (Test-Path -LiteralPath $skillPath)) {
        throw "Expected global skill missing: $skillPath"
    }
    "{path='$($skillPath.Replace('\', '/'))',enabled=false}"
}
$skillOverride = 'skills.config=[' + ($entries -join ',') + ']'
& codex -C $repoRoot -c $skillOverride @args
exit $LASTEXITCODE
