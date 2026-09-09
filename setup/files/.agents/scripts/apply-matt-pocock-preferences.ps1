$ErrorActionPreference = 'Stop'
$skillsRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../skills'))
$utf8 = New-Object System.Text.UTF8Encoding($false)
$descriptions = [ordered]@{
    'ask-matt' = 'Select a fitting engineering or learning workflow when the next approach is unclear. Use as an internal routing reference under the user global proactive preferences.'
    'setup-matt-pocock-skills' = 'Configure a project tracker, triage vocabulary, and domain docs when a tracker-dependent workflow needs them and existing project instructions do not already provide them.'
    'grill-me' = 'Clarify meaningful unresolved choices in an idea or design through a stateless interview. Use when no codebase documentation needs to be maintained.'
    'grill-with-docs' = 'Clarify unresolved codebase or product decisions while recording agreed domain terms and consequential ADRs. Use before planning when meaningful decisions remain open.'
    'wayfinder' = 'Map decision questions for a large, foggy effort that cannot be settled in one session. Use for unresolved multi-session planning, not a small or already-decided change.'
    'to-spec' = 'Synthesize settled decisions into a durable spec when the work needs a handoff or multiple implementation sessions. Confirm any still-unagreed test seams.'
    'to-tickets' = 'Split a settled spec into independently verifiable implementation tickets with blocking relationships when multiple sessions are warranted.'
    'implement' = 'Carry out authorized, sufficiently decided feature work or tickets using agreed test seams, proportionate checks, and review. Continue naturally once decisions are settled.'
    'triage' = 'Evaluate incoming issues or requests, verify claims, and move them through the configured triage roles when managing a backlog.'
    'improve-codebase-architecture' = 'Investigate architectural friction in the requested area or survey codebase health when that is the task. Discuss selected improvements before expanding implementation scope.'
    'handoff' = 'Preserve the context needed when work transfers to another agent, directory, person, or separate session.'
    'teach' = 'Build a persistent learning workspace when the user wants to learn a topic over multiple sessions. Ordinary inline explanations do not require a teaching workspace.'
    'to-questionnaire' = 'Draft a questionnaire when a decision depends on knowledge held by another person. Establish the recipient and needed answers; sending is a separate authorized action.'
    'wait-what' = 'Re-explain confusing output when the user signals they are lost, or the conversation shows a missing premise. Use concrete examples and familiar language.'
}
$changedSkills = 0
$changedPolicies = 0
foreach ($entry in $descriptions.GetEnumerator()) {
    $path = Join-Path $skillsRoot ($entry.Key + '/SKILL.md')
    $original = [IO.File]::ReadAllText($path)
    $match = [regex]::Match($original,'\A---\r?\n(?<front>.*?)\r?\n---(?<body>[\s\S]*)\z',[Text.RegularExpressions.RegexOptions]::Singleline)
    if (!$match.Success) { throw "Invalid skill frontmatter: $path" }
    $front = $match.Groups['front'].Value
    if ($front -notmatch '(?m)^description:') { throw "Missing description: $path" }
    $front = [regex]::Replace($front,'(?m)^disable-model-invocation:[ \t]*true[ \t]*\r?\n?','')
    $front = [regex]::Replace($front,'(?m)^description:.*$',('description: "' + $entry.Value + '"'))
    $updated = "---`n" + $front.TrimEnd("`r","`n") + "`n---" + $match.Groups['body'].Value
    if ($updated -ne $original) { [IO.File]::WriteAllText($path,$updated,$utf8); $changedSkills++ }
    $policyPath = Join-Path $skillsRoot ($entry.Key + '/agents/openai.yaml')
    if (Test-Path -LiteralPath $policyPath) {
        $policy = [IO.File]::ReadAllText($policyPath)
        $newPolicy = [regex]::Replace($policy,'(?m)^(\s*allow_implicit_invocation:\s*)false\s*$','${1}true')
        if ($newPolicy -ne $policy) { [IO.File]::WriteAllText($policyPath,$newPolicy,$utf8); $changedPolicies++ }
    }
}
[pscustomobject]@{AdaptedSkills=$descriptions.Count;SkillFilesChanged=$changedSkills;PoliciesChanged=$changedPolicies} | ConvertTo-Json
