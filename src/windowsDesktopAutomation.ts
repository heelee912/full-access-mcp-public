import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  createDefaultChatGptMcpApprovalContract,
  type ChatGptMcpApprovalContract,
} from './chatGptMcpApproval.js';
import {
  getChromeRemoteDebuggingAllowButtonLabels as getChromeRemoteDebuggingAllowButtonLabelsOnly,
  getChromeRemoteDebuggingPromptFragments as getChromeRemoteDebuggingPromptFragmentsOnly,
} from './chromeRemoteDebuggingApproval.js';
import { WorkspaceFileAccess } from './workspaceFileAccess.js';

function encodePayload(payload: unknown): string {
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64');
}

function buildPowerShellPrelude(options?: {
  loadUiAutomation?: boolean;
  loadDrawing?: boolean;
}): string {
  const loadUiAutomation = options?.loadUiAutomation ?? false;
  const loadDrawing = options?.loadDrawing ?? false;

  return [
    '$ErrorActionPreference = "Stop"',
    loadUiAutomation ? 'Add-Type -AssemblyName UIAutomationClient' : '',
    loadDrawing ? 'Add-Type -AssemblyName System.Windows.Forms' : '',
    loadDrawing ? 'Add-Type -AssemblyName System.Drawing' : '',
    'Add-Type @"',
    'using System;',
    'using System.Runtime.InteropServices;',
    'public static class NativeDesktopAutomation {',
    '  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();',
    '  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);',
    '  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);',
    '  [DllImport("user32.dll")] public static extern bool GetCursorPos(out POINT point);',
    '  [DllImport("user32.dll")] public static extern void mouse_event(uint dwFlags, uint dx, uint dy, uint dwData, UIntPtr dwExtraInfo);',
    '}',
    'public struct POINT { public int X; public int Y; }',
    '"@',
    'function ConvertTo-WindowObject($Process) {',
    '  [pscustomobject]@{',
    '    handle = [int64]$Process.MainWindowHandle',
    '    title = $Process.MainWindowTitle',
    '    processId = $Process.Id',
    '    processName = $Process.ProcessName',
    '    isForeground = ([NativeDesktopAutomation]::GetForegroundWindow().ToInt64() -eq [int64]$Process.MainWindowHandle)',
    '  }',
    '}',
    'function Get-WindowCollection {',
    '  Get-Process | Where-Object { $_.MainWindowHandle -ne 0 } | ForEach-Object { ConvertTo-WindowObject $_ }',
    '}',
    'function Resolve-WindowHandle($Payload) {',
    '  if ($Payload.handle) { return [System.IntPtr]::new([int64]$Payload.handle) }',
    '  $matches = @(Get-WindowCollection | Where-Object {',
    '    if ($Payload.titleContains) { $_.title -like "*$($Payload.titleContains)*" } else { $true }',
    '  })',
    '  if ($matches.Count -eq 0) { throw "No matching window found." }',
    '  $index = 0',
    '  if ($Payload.index -ne $null) { $index = [int]$Payload.index }',
    '  if ($index -ge $matches.Count) { throw "Requested window index is out of range." }',
    '  [System.IntPtr]::new([int64]$matches[$index].handle)',
    '}',
    'function Activate-WindowHandle($Handle) {',
    '  $windowInfo = @(Get-WindowCollection | Where-Object { [int64]$_.handle -eq $Handle.ToInt64() } | Select-Object -First 1)',
    '  if ($windowInfo) {',
    '    $shell = New-Object -ComObject WScript.Shell',
    '    if ($windowInfo.processId) { [void]$shell.AppActivate([int]$windowInfo.processId) }',
    '    Start-Sleep -Milliseconds 80',
    '    $shell.SendKeys("%")',
    '    Start-Sleep -Milliseconds 80',
    '  }',
    '  [void][NativeDesktopAutomation]::SetForegroundWindow($Handle)',
    '  Start-Sleep -Milliseconds 120',
    '}',
    'function ConvertTo-SafeInt($Value) {',
    '  if ($null -eq $Value) { return $null }',
    '  if ([double]::IsNaN([double]$Value) -or [double]::IsInfinity([double]$Value)) { return $null }',
    '  if ($Value -gt [int]::MaxValue) { return [int]::MaxValue }',
    '  if ($Value -lt [int]::MinValue) { return [int]::MinValue }',
    '  return [int][math]::Round([double]$Value)',
    '}',
    'function ConvertTo-BoundsObject($Bounds) {',
    '  [pscustomobject]@{',
    '    left = ConvertTo-SafeInt $Bounds.Left',
    '    top = ConvertTo-SafeInt $Bounds.Top',
    '    width = ConvertTo-SafeInt $Bounds.Width',
    '    height = ConvertTo-SafeInt $Bounds.Height',
    '  }',
    '}',
  ]
    .filter(Boolean)
    .join('\n');
}

async function runPowerShellJson<T>(
  script: string,
  payload: unknown,
  options?: {
    timeoutMs?: number;
  },
): Promise<T> {
  const encodedPayload = encodePayload(payload);
  const fullScript = [
    `$payload = [System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String("${encodedPayload}")) | ConvertFrom-Json`,
    script,
  ].join('\n');

  const scriptDirectoryPath = await mkdtemp(
    path.join(tmpdir(), 'full-access-desktop-automation-'),
  );
  const scriptFilePath = path.join(scriptDirectoryPath, 'automation.ps1');
  await writeFile(scriptFilePath, fullScript, 'utf8');

  try {
    return await new Promise<T>((resolve, reject) => {
      const timeoutMs = Math.max(0, options?.timeoutMs ?? 15_000);
      const child = spawn(
        'powershell',
      [
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy',
        'Bypass',
        '-STA',
        '-File',
        scriptFilePath,
      ],
      {
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
      },
    );

    let stdout = '';
    let stderr = '';
    let settled = false;
    let timeoutHandle: NodeJS.Timeout | undefined;

    const finalize = (callback: () => void) => {
      if (settled) {
        return;
      }

      settled = true;
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
      }
      callback();
    };

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString('utf8');
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString('utf8');
    });

    if (timeoutMs > 0) {
      timeoutHandle = setTimeout(() => {
        try {
          child.kill();
        } catch {
          // Ignore child termination errors and surface the timeout below.
        }

        finalize(() => {
          reject(
            new Error(
              `PowerShell automation timed out after ${String(timeoutMs)}ms.`,
            ),
          );
        });
      }, timeoutMs);
      timeoutHandle.unref?.();
    }

    child.once('error', (error) =>
      finalize(() => {
        reject(error);
      }),
    );
    child.once('close', (exitCode) => {
      if (settled) {
        return;
      }

      if (exitCode !== 0) {
        finalize(() => {
          reject(
            new Error(
              `PowerShell automation failed with exit code ${String(exitCode)}: ${stderr || stdout}`,
            ),
          );
        });
        return;
      }

      const trimmedOutput = stdout.trim();
      if (!trimmedOutput) {
        finalize(() => {
          reject(
            new Error(
              `PowerShell automation returned no output. ${stderr}\n--- script ---\n${fullScript}`,
            ),
          );
        });
        return;
      }

      try {
        finalize(() => {
          resolve(JSON.parse(trimmedOutput) as T);
        });
      } catch (error) {
        finalize(() => {
          reject(
            new Error(
              `Failed to parse PowerShell JSON output: ${trimmedOutput}\n${String(error)}`,
            ),
          );
        });
      }
    });

      child.stdin.end();
    });
  } finally {
    await rm(scriptDirectoryPath, { recursive: true, force: true });
  }
}

export function escapeSendKeysText(text: string): string {
  return text.replace(/[+^%~(){}\[\]]/g, (matchedCharacter) => {
    if (matchedCharacter === '{') {
      return '{{}';
    }

    if (matchedCharacter === '}') {
      return '{}}';
    }

    return `{${matchedCharacter}}`;
  });
}

type ChromeWindowPromptApprovalOptions = {
  promptFragments: string[];
  allowButtonLabels: string[];
  primaryActionPatterns?: string[];
  rejectButtonPatterns?: string[];
  ignoredButtonPatterns?: string[];
  requireAppNamePatterns?: string[];
  contextPatterns?: string[];
  rememberOptionPatterns?: string[];
  autoRemember?: boolean;
  timeoutMs?: number;
  pollIntervalMs?: number;
  expectedPromptPatterns?: string[];
  expectedPrimaryActionPatterns?: string[];
};

type ChromeWindowPromptApprovalResult = {
  foundPrompt?: boolean;
  approved?: boolean;
  remembered?: boolean;
  buttonName?: string | null;
  rememberName?: string | null;
  window?: unknown;
  candidateButtons?: string[];
};

export class WindowsDesktopAutomation {
  private chatGptMcpApprovalContract: ChatGptMcpApprovalContract =
    createDefaultChatGptMcpApprovalContract();

  constructor(private readonly workspaceFileAccess: WorkspaceFileAccess) {}

  setChatGptMcpApprovalContract(
    approvalContract: ChatGptMcpApprovalContract,
  ): void {
    this.chatGptMcpApprovalContract = approvalContract;
  }

  private async approveChromeWindowPrompt(
    options: ChromeWindowPromptApprovalOptions,
  ): Promise<ChromeWindowPromptApprovalResult> {
    const timeoutMs = Math.max(0, options.timeoutMs ?? 0);
    const pollIntervalMs = Math.max(50, options.pollIntervalMs ?? 250);
    const scriptExecutionTimeoutMs = Math.max(
      1_500,
      Math.min(timeoutMs > 0 ? timeoutMs + 1_000 : 3_000, 10_000),
    );
    const deadline = Date.now() + timeoutMs;
    const payload = {
      ...options,
      expectedPromptPatterns: options.expectedPromptPatterns ?? [],
      expectedPrimaryActionPatterns: options.expectedPrimaryActionPatterns ?? [],
    };
    let lastResult: ChromeWindowPromptApprovalResult = {
      foundPrompt: false,
      approved: false,
      remembered: false,
      buttonName: null,
      rememberName: null,
      window: null,
      candidateButtons: [],
    };

    do {
      lastResult = await runPowerShellJson<ChromeWindowPromptApprovalResult>(
      [
        buildPowerShellPrelude({ loadUiAutomation: true }),
        '$promptFragments = @($payload.promptFragments | ForEach-Object { "$_".ToLowerInvariant() })',
        '$allowLabels = @($payload.allowButtonLabels | ForEach-Object { "$_".ToLowerInvariant() })',
        '$primaryActionPatterns = @($payload.primaryActionPatterns | ForEach-Object { "$_".ToLowerInvariant() })',
        '$rejectButtonPatterns = @($payload.rejectButtonPatterns | ForEach-Object { "$_".ToLowerInvariant() })',
        '$ignoredButtonPatterns = @($payload.ignoredButtonPatterns | ForEach-Object { "$_".ToLowerInvariant() })',
        '$appNamePatterns = @($payload.requireAppNamePatterns | ForEach-Object { "$_".ToLowerInvariant() })',
        '$contextPatterns = @($payload.contextPatterns | ForEach-Object { "$_".ToLowerInvariant() })',
        '$rememberPatterns = @($payload.rememberOptionPatterns | ForEach-Object { "$_".ToLowerInvariant() })',
        '$expectedPromptPatterns = @($payload.expectedPromptPatterns | ForEach-Object { "$_".ToLowerInvariant() })',
        '$expectedPrimaryActionPatterns = @($payload.expectedPrimaryActionPatterns | ForEach-Object { "$_".ToLowerInvariant() })',
        '$autoRemember = [bool]$payload.autoRemember',
        '$chromeWindows = @(Get-WindowCollection | Where-Object { $_.processName -eq "chrome" })',
        '$result = [pscustomobject]@{ foundPrompt = $false; approved = $false; remembered = $false; buttonName = $null; rememberName = $null; window = $null; candidateButtons = @() }',
        'function Matches-NormalizedFragment([string]$Text, [string[]]$Fragments) {',
        '  if ([string]::IsNullOrWhiteSpace($Text)) { return $false }',
        '  $normalizedText = $Text.ToLowerInvariant()',
        '  foreach ($fragment in $Fragments) {',
        '    if ([string]::IsNullOrWhiteSpace($fragment)) { continue }',
        '    if ($normalizedText.Contains($fragment)) { return $true }',
        '  }',
        '  return $false',
        '}',
        'function Normalize-UiText([string]$Text) {',
        '  if ([string]::IsNullOrWhiteSpace($Text)) { return "" }',
        '  return (($Text -replace "\\s+", " ").Trim()).ToLowerInvariant()',
        '}',
        'function Compact-UiText([string]$Text) {',
        '  return [regex]::Replace((Normalize-UiText $Text), "[^\\p{L}\\p{N}]+", "")',
        '}',
        'function Matches-ActionPattern([string]$Text, [string[]]$Patterns) {',
        '  if ([string]::IsNullOrWhiteSpace($Text)) { return $false }',
        '  $normalizedText = Normalize-UiText $Text',
        '  $compactText = Compact-UiText $Text',
        '  foreach ($pattern in $Patterns) {',
        '    if ([string]::IsNullOrWhiteSpace($pattern)) { continue }',
        '    $normalizedPattern = Normalize-UiText $pattern',
        '    $compactPattern = Compact-UiText $pattern',
        '    if ($normalizedText -eq $normalizedPattern) { return $true }',
        '    if (-not [string]::IsNullOrWhiteSpace($compactPattern) -and $compactText -eq $compactPattern) { return $true }',
        '  }',
        '  return $false',
        '}',
        'function Is-IgnoredButtonName([string]$Name) {',
        '  if ([string]::IsNullOrWhiteSpace($Name)) { return $false }',
        '  $normalizedName = $Name.ToLowerInvariant()',
        '  foreach ($pattern in $ignoredButtonPatterns) {',
        '    if (-not [string]::IsNullOrWhiteSpace($pattern) -and $normalizedName.Contains($pattern)) { return $true }',
        '  }',
        '  return $false',
        '}',
        'function Is-RejectButtonName([string]$Name) {',
        '  if ([string]::IsNullOrWhiteSpace($Name)) { return $false }',
        '  return Matches-ActionPattern $Name $rejectButtonPatterns',
        '}',
        'function Try-InvokeAutomationElement($Element) {',
        '  $invokePattern = $null',
        '  $togglePattern = $null',
        '  $selectionPattern = $null',
        '  $legacyPattern = $null',
        '  if ($Element.TryGetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern, [ref]$invokePattern)) {',
        '    $invokePattern.Invoke()',
        '    return $true',
        '  }',
        '  if ($Element.TryGetCurrentPattern([System.Windows.Automation.TogglePattern]::Pattern, [ref]$togglePattern)) {',
        '    if ($togglePattern.Current.ToggleState -ne [System.Windows.Automation.ToggleState]::On) {',
        '      $togglePattern.Toggle()',
        '    }',
        '    return $true',
        '  }',
        '  if ($Element.TryGetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern, [ref]$selectionPattern)) {',
        '    $selectionPattern.Select()',
        '    return $true',
        '  }',
        '  if ($Element.TryGetCurrentPattern([System.Windows.Automation.LegacyIAccessiblePattern]::Pattern, [ref]$legacyPattern)) {',
        '    $legacyPattern.DoDefaultAction()',
        '    return $true',
        '  }',
        '  return $false',
        '}',
        'function Get-SafeCurrent($Element) {',
        '  try {',
        '    return $Element.Current',
        '  } catch {',
        '    return $null',
        '  }',
        '}',
        'function Get-AutomationScanItems($Root, [int]$MaxNodes) {',
        '  $items = New-Object System.Collections.Generic.List[object]',
        '  $queue = New-Object System.Collections.Queue',
        '  $queue.Enqueue($Root)',
        '  while ($queue.Count -gt 0 -and $items.Count -lt $MaxNodes) {',
        '    $element = $queue.Dequeue()',
        '    $current = Get-SafeCurrent $element',
        '    if ($null -eq $current) { continue }',
        '    $items.Add([pscustomobject]@{',
        '      Element = $element',
        '      Name = $current.Name',
        '      ControlType = $current.ControlType.ProgrammaticName',
        '      IsEnabled = $current.IsEnabled',
        '      Bounds = $current.BoundingRectangle',
        '    }) | Out-Null',
        '    try {',
        '      $children = $element.FindAll([System.Windows.Automation.TreeScope]::Children, [System.Windows.Automation.Condition]::TrueCondition)',
        '    } catch {',
        '      continue',
        '    }',
        '    for ($childIndex = 0; $childIndex -lt $children.Count; $childIndex++) {',
        '      try {',
        '        $queue.Enqueue($children.Item($childIndex))',
        '      } catch {',
        '      }',
        '    }',
        '  }',
        '  return $items',
        '}',
        'function Get-ButtonScore([string]$Name) {',
        '  if ([string]::IsNullOrWhiteSpace($Name)) { return -1 }',
        '  $normalizedName = $Name.ToLowerInvariant()',
        '  if (Is-IgnoredButtonName $Name) { return -1 }',
        '  if (Is-RejectButtonName $Name) { return -1 }',
        '  if ($expectedPrimaryActionPatterns.Count -gt 0 -and -not (Matches-ActionPattern $Name $expectedPrimaryActionPatterns)) { return -1 }',
        '  if ($allowLabels -contains $normalizedName) { return 1000 }',
        '  if (Matches-ActionPattern $Name $primaryActionPatterns) { return 500 }',
        '  return -1',
        '}',
        'function Shares-ButtonRow($CandidateBounds, $RejectBounds) {',
        '  if ($null -eq $CandidateBounds -or $null -eq $RejectBounds) { return $false }',
        '  $candidateTop = ConvertTo-SafeInt $CandidateBounds.Top',
        '  $candidateBottom = ConvertTo-SafeInt $CandidateBounds.Bottom',
        '  $rejectTop = ConvertTo-SafeInt $RejectBounds.Top',
        '  $rejectBottom = ConvertTo-SafeInt $RejectBounds.Bottom',
        '  if ($null -eq $candidateTop -or $null -eq $candidateBottom -or $null -eq $rejectTop -or $null -eq $rejectBottom) { return $false }',
        '  $candidateCenter = [int](($candidateTop + $candidateBottom) / 2)',
        '  $rejectCenter = [int](($rejectTop + $rejectBottom) / 2)',
        '  if ([Math]::Abs($candidateCenter - $rejectCenter) -le 24) { return $true }',
        '  if ($candidateTop -le $rejectBottom -and $candidateBottom -ge $rejectTop) { return $true }',
        '  return $false',
        '}',
        'function Is-ToRightOfReject($CandidateBounds, $RejectBounds) {',
        '  if ($null -eq $CandidateBounds -or $null -eq $RejectBounds) { return $false }',
        '  $candidateLeft = ConvertTo-SafeInt $CandidateBounds.Left',
        '  $rejectRight = ConvertTo-SafeInt $RejectBounds.Right',
        '  if ($null -eq $candidateLeft -or $null -eq $rejectRight) { return $false }',
        '  return $candidateLeft -ge $rejectRight',
        '}',
        'foreach ($window in $chromeWindows) {',
        '  try {',
        '    $windowHandle = [System.IntPtr]::new([int64]$window.handle)',
        '    $root = [System.Windows.Automation.AutomationElement]::FromHandle($windowHandle)',
        '    if ($null -eq $root) { continue }',
        '    $scanItems = Get-AutomationScanItems $root 500',
        '  } catch {',
        '    continue',
        '  }',
        '  if ($null -eq $scanItems -or $scanItems.Count -eq 0) { continue }',
        '  $promptDetected = $false',
        '  $expectedPromptDetected = ($expectedPromptPatterns.Count -eq 0)',
        '  $appDetected = ($appNamePatterns.Count -eq 0)',
        '  $contextDetected = ($contextPatterns.Count -eq 0)',
        '  $positiveButtonDetected = $false',
        '  $expectedPositiveButtonDetected = ($expectedPrimaryActionPatterns.Count -eq 0)',
        '  $negativeButtonDetected = $false',
        '  foreach ($scanItem in $scanItems) {',
        '    $name = $scanItem.Name',
        '    if ([string]::IsNullOrWhiteSpace($name)) { continue }',
        '    if (-not $promptDetected -and (Matches-NormalizedFragment $name $promptFragments)) { $promptDetected = $true }',
        '    if (-not $expectedPromptDetected -and (Matches-NormalizedFragment $name $expectedPromptPatterns)) { $expectedPromptDetected = $true }',
        '    if (-not $appDetected -and (Matches-NormalizedFragment $name $appNamePatterns)) { $appDetected = $true }',
        '    if (-not $contextDetected -and (Matches-NormalizedFragment $name $contextPatterns)) { $contextDetected = $true }',
        '    if ($scanItem.ControlType -like "*Button*") {',
        '      if (-not $positiveButtonDetected -and (Get-ButtonScore $name) -ge 0) { $positiveButtonDetected = $true }',
        '      if (-not $expectedPositiveButtonDetected -and (Matches-ActionPattern $name $expectedPrimaryActionPatterns)) { $expectedPositiveButtonDetected = $true }',
        '      if (-not $negativeButtonDetected -and (Matches-ActionPattern $name $rejectButtonPatterns)) { $negativeButtonDetected = $true }',
        '    }',
        '    if (($promptDetected -or ($positiveButtonDetected -and $negativeButtonDetected)) -and $expectedPromptDetected -and $expectedPositiveButtonDetected -and $appDetected -and $contextDetected) { break }',
        '  }',
        '  if (-not (($promptDetected -or ($positiveButtonDetected -and $negativeButtonDetected)) -and $expectedPromptDetected -and $expectedPositiveButtonDetected -and $appDetected -and $contextDetected)) { continue }',
        '  $result.foundPrompt = $true',
        '  $result.window = $window',
        '  $rejectButtons = @($scanItems | Where-Object { $_.IsEnabled -and $_.ControlType -like "*Button*" -and -not [string]::IsNullOrWhiteSpace($_.Name) -and (Is-RejectButtonName $_.Name) })',
        '  if ($autoRemember -and $rememberPatterns.Count -gt 0) {',
        '    foreach ($scanItem in $scanItems) {',
        '      $element = $scanItem.Element',
        '      if (-not $scanItem.IsEnabled) { continue }',
        '      if ([string]::IsNullOrWhiteSpace($scanItem.Name)) { continue }',
        '      if (-not (Matches-NormalizedFragment $scanItem.Name $rememberPatterns)) { continue }',
        '      if ($scanItem.ControlType -notlike "*Button*" -and $scanItem.ControlType -notlike "*CheckBox*" -and $scanItem.ControlType -notlike "*Text*") { continue }',
        '      if (-not (Try-InvokeAutomationElement $element)) { continue }',
        '      $result.remembered = $true',
        '      $result.rememberName = $scanItem.Name',
        '      Start-Sleep -Milliseconds 75',
        '      break',
        '    }',
        '  }',
        '  $bestButton = $null',
        '  $bestButtonScore = -1',
        '  $bestButtonRight = -2147483648',
        '  foreach ($scanItem in $scanItems) {',
        '    $element = $scanItem.Element',
        '    if (-not $scanItem.IsEnabled) { continue }',
        '    if ([string]::IsNullOrWhiteSpace($scanItem.Name)) { continue }',
        '    if ($scanItem.ControlType -notlike "*Button*") { continue }',
        '    $score = Get-ButtonScore $scanItem.Name',
        '    if ($score -lt 0 -and $rejectButtons.Count -gt 0) {',
        '      foreach ($rejectButton in $rejectButtons) {',
        '        if ((Shares-ButtonRow $scanItem.Bounds $rejectButton.Bounds) -and (Is-ToRightOfReject $scanItem.Bounds $rejectButton.Bounds)) {',
        '          $score = 250',
        '          break',
        '        }',
        '      }',
        '    }',
        '    if ($score -lt 0) { continue }',
        '    $result.candidateButtons += $scanItem.Name',
        '    $rightEdge = ConvertTo-SafeInt $scanItem.Bounds.Right',
        '    if ($null -eq $rightEdge) { $rightEdge = -2147483648 }',
        '    if ($score -gt $bestButtonScore -or ($score -eq $bestButtonScore -and $rightEdge -gt $bestButtonRight)) {',
        '      $bestButton = $element',
        '      $bestButtonScore = $score',
        '      $bestButtonRight = $rightEdge',
        '    }',
        '  }',
        '  if ($null -ne $bestButton) {',
        '    try {',
        '      $bestCurrent = $bestButton.Current',
        '      if (Try-InvokeAutomationElement $bestButton) {',
        '        $result.approved = $true',
        '        $result.buttonName = $bestCurrent.Name',
        '      }',
        '    } catch {',
        '    }',
        '  }',
        '  break',
        '}',
        '$result | ConvertTo-Json -Depth 8 -Compress',
      ].join('\n'),
      payload,
      {
        timeoutMs: scriptExecutionTimeoutMs,
      },
      );

      if (lastResult.approved || lastResult.foundPrompt || timeoutMs === 0) {
        return lastResult;
      }

      if (Date.now() >= deadline) {
        return lastResult;
      }

      await new Promise((resolve) => {
        setTimeout(resolve, pollIntervalMs);
      });
    } while (Date.now() <= deadline);

    return lastResult;
  }

  async listWindows(includeUntitled = false): Promise<unknown[]> {
    return await runPowerShellJson<unknown[]>(
      [
        buildPowerShellPrelude(),
        '$result = @(Get-WindowCollection | Where-Object { $payload.includeUntitled -or -not [string]::IsNullOrWhiteSpace($_.title) })',
        '$result | ConvertTo-Json -Depth 8 -Compress',
      ].join('\n'),
      { includeUntitled },
    );
  }

  async getForegroundWindow(): Promise<unknown> {
    return await runPowerShellJson<unknown>(
      [
        buildPowerShellPrelude(),
        '$handle = [NativeDesktopAutomation]::GetForegroundWindow()',
        '$result = @(Get-WindowCollection | Where-Object { [int64]$_.handle -eq $handle.ToInt64() } | Select-Object -First 1)',
        'if (-not $result) { $result = [pscustomobject]@{ handle = $handle.ToInt64(); title = ""; processId = 0; processName = ""; isForeground = $true } }',
        '$result | ConvertTo-Json -Depth 8 -Compress',
      ].join('\n'),
      {},
    );
  }

  async activateWindow(options: {
    handle?: string;
    titleContains?: string;
    index?: number;
  }): Promise<unknown> {
    return await runPowerShellJson<unknown>(
      [
        buildPowerShellPrelude(),
        '$handle = Resolve-WindowHandle $payload',
        'Activate-WindowHandle $handle',
        '$result = @(Get-WindowCollection | Where-Object { [int64]$_.handle -eq $handle.ToInt64() } | Select-Object -First 1)',
        'if (-not $result) { $result = [pscustomobject]@{ handle = $handle.ToInt64(); title = ""; processId = 0; processName = ""; isForeground = $true } }',
        '$result | ConvertTo-Json -Depth 8 -Compress',
      ].join('\n'),
      options,
    );
  }

  async sendKeys(options: {
    keys: string;
    handle?: string;
    titleContains?: string;
    index?: number;
    waitMs?: number;
  }): Promise<unknown> {
    return await runPowerShellJson<unknown>(
      [
        buildPowerShellPrelude({ loadDrawing: true }),
        'if ($payload.handle -or $payload.titleContains) {',
        '  $targetHandle = Resolve-WindowHandle $payload',
        '  Activate-WindowHandle $targetHandle',
        '}',
        '[System.Windows.Forms.SendKeys]::SendWait($payload.keys)',
        'if ($payload.waitMs) { Start-Sleep -Milliseconds ([int]$payload.waitMs) }',
        '$result = [pscustomobject]@{ ok = $true; keys = $payload.keys }',
        '$result | ConvertTo-Json -Depth 5 -Compress',
      ].join('\n'),
      options,
    );
  }

  async typeText(options: {
    text: string;
    handle?: string;
    titleContains?: string;
    index?: number;
    waitMs?: number;
  }): Promise<unknown> {
    return await runPowerShellJson<unknown>(
      [
        buildPowerShellPrelude({ loadDrawing: true }),
        'if ($payload.handle -or $payload.titleContains) {',
        '  $targetHandle = Resolve-WindowHandle $payload',
        '  Activate-WindowHandle $targetHandle',
        '}',
        '$hadClipboardText = [System.Windows.Forms.Clipboard]::ContainsText()',
        '$previousClipboardText = if ($hadClipboardText) { [System.Windows.Forms.Clipboard]::GetText() } else { $null }',
        '[System.Windows.Forms.Clipboard]::SetText($payload.text)',
        '[System.Windows.Forms.SendKeys]::SendWait("^v")',
        'if ($payload.waitMs) { Start-Sleep -Milliseconds ([int]$payload.waitMs) }',
        'if ($hadClipboardText) { [System.Windows.Forms.Clipboard]::SetText($previousClipboardText) } else { [System.Windows.Forms.Clipboard]::Clear() }',
        '$result = [pscustomobject]@{ ok = $true; pastedTextLength = $payload.text.Length }',
        '$result | ConvertTo-Json -Depth 5 -Compress',
      ].join('\n'),
      options,
    );
  }

  async typeTextAndSubmit(options: {
    text: string;
    submitKeys?: string;
    handle?: string;
    titleContains?: string;
    index?: number;
    waitMs?: number;
    submitWaitMs?: number;
  }): Promise<unknown> {
    return await runPowerShellJson<unknown>(
      [
        buildPowerShellPrelude({ loadDrawing: true }),
        'if ($payload.handle -or $payload.titleContains) {',
        '  $targetHandle = Resolve-WindowHandle $payload',
        '  Activate-WindowHandle $targetHandle',
        '}',
        '$submitKeys = if ([string]::IsNullOrWhiteSpace($payload.submitKeys)) { "{ENTER}" } else { [string]$payload.submitKeys }',
        '$waitMs = if ($payload.waitMs) { [int]$payload.waitMs } else { 120 }',
        '$submitWaitMs = if ($payload.submitWaitMs) { [int]$payload.submitWaitMs } else { 180 }',
        '$hadClipboardText = [System.Windows.Forms.Clipboard]::ContainsText()',
        '$previousClipboardText = if ($hadClipboardText) { [System.Windows.Forms.Clipboard]::GetText() } else { $null }',
        '[System.Windows.Forms.Clipboard]::SetText($payload.text)',
        '[System.Windows.Forms.SendKeys]::SendWait("^v")',
        'if ($waitMs -gt 0) { Start-Sleep -Milliseconds $waitMs }',
        '[System.Windows.Forms.SendKeys]::SendWait($submitKeys)',
        'if ($submitWaitMs -gt 0) { Start-Sleep -Milliseconds $submitWaitMs }',
        'if ($hadClipboardText) { [System.Windows.Forms.Clipboard]::SetText($previousClipboardText) } else { [System.Windows.Forms.Clipboard]::Clear() }',
        '$result = [pscustomobject]@{ ok = $true; pastedTextLength = $payload.text.Length; submitKeys = $submitKeys }',
        '$result | ConvertTo-Json -Depth 5 -Compress',
      ].join('\n'),
      options,
    );
  }

  async clickScreen(options: {
    x: number;
    y: number;
    button?: 'left' | 'right';
    doubleClick?: boolean;
  }): Promise<unknown> {
    return await runPowerShellJson<unknown>(
      [
        buildPowerShellPrelude(),
        '$button = if ($payload.button) { $payload.button } else { "left" }',
        '$downFlag = if ($button -eq "right") { 0x0008 } else { 0x0002 }',
        '$upFlag = if ($button -eq "right") { 0x0010 } else { 0x0004 }',
        '[void][NativeDesktopAutomation]::SetCursorPos([int]$payload.x, [int]$payload.y)',
        'Start-Sleep -Milliseconds 50',
        '[NativeDesktopAutomation]::mouse_event($downFlag, 0, 0, 0, [UIntPtr]::Zero)',
        '[NativeDesktopAutomation]::mouse_event($upFlag, 0, 0, 0, [UIntPtr]::Zero)',
        'if ($payload.doubleClick) {',
        '  Start-Sleep -Milliseconds 80',
        '  [NativeDesktopAutomation]::mouse_event($downFlag, 0, 0, 0, [UIntPtr]::Zero)',
        '  [NativeDesktopAutomation]::mouse_event($upFlag, 0, 0, 0, [UIntPtr]::Zero)',
        '}',
        '$result = [pscustomobject]@{ ok = $true; x = [int]$payload.x; y = [int]$payload.y; button = $button; doubleClick = [bool]$payload.doubleClick }',
        '$result | ConvertTo-Json -Depth 5 -Compress',
      ].join('\n'),
      options,
    );
  }

  async moveCursor(options: { x: number; y: number }): Promise<unknown> {
    return await runPowerShellJson<unknown>(
      [
        buildPowerShellPrelude(),
        '[void][NativeDesktopAutomation]::SetCursorPos([int]$payload.x, [int]$payload.y)',
        '$result = [pscustomobject]@{ ok = $true; x = [int]$payload.x; y = [int]$payload.y }',
        '$result | ConvertTo-Json -Depth 5 -Compress',
      ].join('\n'),
      options,
    );
  }

  async scrollScreen(options: {
    delta: number;
    x?: number;
    y?: number;
  }): Promise<unknown> {
    return await runPowerShellJson<unknown>(
      [
        buildPowerShellPrelude(),
        'if ($payload.x -ne $null -and $payload.y -ne $null) {',
        '  [void][NativeDesktopAutomation]::SetCursorPos([int]$payload.x, [int]$payload.y)',
        '  Start-Sleep -Milliseconds 30',
        '}',
        '[NativeDesktopAutomation]::mouse_event(0x0800, 0, 0, [uint32][int]$payload.delta, [UIntPtr]::Zero)',
        '$point = New-Object POINT',
        '[void][NativeDesktopAutomation]::GetCursorPos([ref]$point)',
        '$result = [pscustomobject]@{ ok = $true; delta = [int]$payload.delta; x = $point.X; y = $point.Y }',
        '$result | ConvertTo-Json -Depth 5 -Compress',
      ].join('\n'),
      options,
    );
  }

  async dragCursor(options: {
    startX: number;
    startY: number;
    endX: number;
    endY: number;
    button?: 'left' | 'right';
    steps?: number;
    stepDelayMs?: number;
  }): Promise<unknown> {
    return await runPowerShellJson<unknown>(
      [
        buildPowerShellPrelude(),
        '$button = if ($payload.button) { $payload.button } else { "left" }',
        '$downFlag = if ($button -eq "right") { 0x0008 } else { 0x0002 }',
        '$upFlag = if ($button -eq "right") { 0x0010 } else { 0x0004 }',
        '$steps = if ($payload.steps) { [Math]::Max(1, [int]$payload.steps) } else { 12 }',
        '$stepDelayMs = if ($payload.stepDelayMs) { [Math]::Max(0, [int]$payload.stepDelayMs) } else { 16 }',
        '[void][NativeDesktopAutomation]::SetCursorPos([int]$payload.startX, [int]$payload.startY)',
        'Start-Sleep -Milliseconds 40',
        '[NativeDesktopAutomation]::mouse_event($downFlag, 0, 0, 0, [UIntPtr]::Zero)',
        'for ($step = 1; $step -le $steps; $step++) {',
        '  $nextX = [int][Math]::Round($payload.startX + (($payload.endX - $payload.startX) * $step / $steps))',
        '  $nextY = [int][Math]::Round($payload.startY + (($payload.endY - $payload.startY) * $step / $steps))',
        '  [void][NativeDesktopAutomation]::SetCursorPos($nextX, $nextY)',
        '  if ($stepDelayMs -gt 0) { Start-Sleep -Milliseconds $stepDelayMs }',
        '}',
        '[NativeDesktopAutomation]::mouse_event($upFlag, 0, 0, 0, [UIntPtr]::Zero)',
        '$result = [pscustomobject]@{ ok = $true; button = $button; startX = [int]$payload.startX; startY = [int]$payload.startY; endX = [int]$payload.endX; endY = [int]$payload.endY }',
        '$result | ConvertTo-Json -Depth 5 -Compress',
      ].join('\n'),
      options,
    );
  }

  async getCursorPosition(): Promise<unknown> {
    return await runPowerShellJson<unknown>(
      [
        buildPowerShellPrelude(),
        '$point = New-Object POINT',
        '[void][NativeDesktopAutomation]::GetCursorPos([ref]$point)',
        '$result = [pscustomobject]@{ x = $point.X; y = $point.Y }',
        '$result | ConvertTo-Json -Compress',
      ].join('\n'),
      {},
    );
  }

  async captureScreen(requestedPath: string): Promise<unknown> {
    const resolvedPath = this.workspaceFileAccess.resolveWorkspacePath(
      requestedPath,
      true,
    );

    return await runPowerShellJson<unknown>(
      [
        buildPowerShellPrelude({ loadDrawing: true }),
        '$directory = [System.IO.Path]::GetDirectoryName($payload.path)',
        'if (-not [string]::IsNullOrWhiteSpace($directory)) { [System.IO.Directory]::CreateDirectory($directory) | Out-Null }',
        '$bounds = [System.Windows.Forms.SystemInformation]::VirtualScreen',
        '$bitmap = New-Object System.Drawing.Bitmap $bounds.Width, $bounds.Height',
        '$graphics = [System.Drawing.Graphics]::FromImage($bitmap)',
        '$graphics.CopyFromScreen($bounds.Left, $bounds.Top, 0, 0, $bitmap.Size)',
        '$bitmap.Save($payload.path, [System.Drawing.Imaging.ImageFormat]::Png)',
        '$graphics.Dispose()',
        '$bitmap.Dispose()',
        '$result = [pscustomobject]@{ path = $payload.path; width = $bounds.Width; height = $bounds.Height }',
        '$result | ConvertTo-Json -Depth 5 -Compress',
      ].join('\n'),
      { path: resolvedPath },
    );
  }

  async inspectElements(options: {
    handle?: string;
    titleContains?: string;
    index?: number;
    maxDepth?: number;
    maxNodes?: number;
  }): Promise<unknown> {
    return await runPowerShellJson<unknown>(
      [
        buildPowerShellPrelude({ loadUiAutomation: true }),
        '$windowHandle = if ($payload.handle -or $payload.titleContains) { Resolve-WindowHandle $payload } else { [NativeDesktopAutomation]::GetForegroundWindow() }',
        '$root = [System.Windows.Automation.AutomationElement]::FromHandle($windowHandle)',
        'if ($null -eq $root) { throw "Unable to inspect UI Automation tree for the selected window." }',
        '$queue = New-Object System.Collections.Queue',
        '$queue.Enqueue([pscustomobject]@{ Element = $root; Depth = 0 })',
        '$results = New-Object System.Collections.Generic.List[object]',
        '$maxDepth = if ($payload.maxDepth) { [int]$payload.maxDepth } else { 3 }',
        '$maxNodes = if ($payload.maxNodes) { [int]$payload.maxNodes } else { 120 }',
        'while ($queue.Count -gt 0 -and $results.Count -lt $maxNodes) {',
        '  $item = $queue.Dequeue()',
        '  $element = $item.Element',
        '  $depth = [int]$item.Depth',
        '  $current = $element.Current',
        '  $bounds = ConvertTo-BoundsObject $current.BoundingRectangle',
        '  $results.Add([pscustomobject]@{',
        '    depth = $depth',
        '    name = $current.Name',
        '    automationId = $current.AutomationId',
        '    className = $current.ClassName',
        '    controlType = $current.ControlType.ProgrammaticName',
        '    isEnabled = $current.IsEnabled',
        '    hasKeyboardFocus = $current.HasKeyboardFocus',
        '    bounds = $bounds',
        '  }) | Out-Null',
        '  if ($depth -ge $maxDepth) { continue }',
        '  $children = $element.FindAll([System.Windows.Automation.TreeScope]::Children, [System.Windows.Automation.Condition]::TrueCondition)',
        '  for ($childIndex = 0; $childIndex -lt $children.Count; $childIndex++) {',
        '    $queue.Enqueue([pscustomobject]@{ Element = $children.Item($childIndex); Depth = $depth + 1 })',
        '  }',
        '}',
        '$windowInfo = @(Get-WindowCollection | Where-Object { [int64]$_.handle -eq $windowHandle.ToInt64() } | Select-Object -First 1)',
        'if (-not $windowInfo) { $windowInfo = [pscustomobject]@{ handle = $windowHandle.ToInt64(); title = ""; processId = 0; processName = ""; isForeground = $true } }',
        '$result = [pscustomobject]@{ window = $windowInfo; elements = $results }',
        '$result | ConvertTo-Json -Depth 8 -Compress',
      ].join('\n'),
      options,
    );
  }

  async invokeElement(options: {
    handle?: string;
    titleContains?: string;
    index?: number;
    automationId?: string;
    nameContains?: string;
    controlType?: string;
    elementIndex?: number;
  }): Promise<unknown> {
    return await runPowerShellJson<unknown>(
      [
        buildPowerShellPrelude({ loadUiAutomation: true }),
        '$windowHandle = if ($payload.handle -or $payload.titleContains) { Resolve-WindowHandle $payload } else { [NativeDesktopAutomation]::GetForegroundWindow() }',
        '$root = [System.Windows.Automation.AutomationElement]::FromHandle($windowHandle)',
        '$all = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)',
        '$matches = New-Object System.Collections.Generic.List[object]',
        'for ($i = 0; $i -lt $all.Count; $i++) {',
        '  $element = $all.Item($i)',
        '  $current = $element.Current',
        '  if ($payload.automationId -and $current.AutomationId -ne $payload.automationId) { continue }',
        '  if ($payload.nameContains -and ($current.Name -notlike "*$($payload.nameContains)*")) { continue }',
        '  if ($payload.controlType -and ($current.ControlType.ProgrammaticName -notlike "*$($payload.controlType)*")) { continue }',
        '  $matches.Add($element) | Out-Null',
        '}',
        'if ($matches.Count -eq 0) { throw "No matching automation element found." }',
        '$elementIndex = if ($payload.elementIndex -ne $null) { [int]$payload.elementIndex } else { 0 }',
        'if ($elementIndex -ge $matches.Count) { throw "Requested automation element index is out of range." }',
        '$target = $matches[$elementIndex]',
        '$invokePattern = $null',
        '$selectionPattern = $null',
        '$expandPattern = $null',
        '$legacyPattern = $null',
        'if ($target.TryGetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern, [ref]$invokePattern)) { $invokePattern.Invoke() }',
        'elseif ($target.TryGetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern, [ref]$selectionPattern)) { $selectionPattern.Select() }',
        'elseif ($target.TryGetCurrentPattern([System.Windows.Automation.ExpandCollapsePattern]::Pattern, [ref]$expandPattern)) { $expandPattern.Expand() }',
        'elseif ($target.TryGetCurrentPattern([System.Windows.Automation.LegacyIAccessiblePattern]::Pattern, [ref]$legacyPattern)) { $legacyPattern.DoDefaultAction() }',
        'else { throw "Matched element does not expose an invokable pattern." }',
        '$current = $target.Current',
        '$result = [pscustomobject]@{ name = $current.Name; automationId = $current.AutomationId; controlType = $current.ControlType.ProgrammaticName }',
        '$result | ConvertTo-Json -Depth 6 -Compress',
      ].join('\n'),
      options,
    );
  }

  async setElementValue(options: {
    handle?: string;
    titleContains?: string;
    index?: number;
    automationId?: string;
    nameContains?: string;
    controlType?: string;
    elementIndex?: number;
    value: string;
  }): Promise<unknown> {
    return await runPowerShellJson<unknown>(
      [
        buildPowerShellPrelude({ loadUiAutomation: true, loadDrawing: true }),
        '$windowHandle = if ($payload.handle -or $payload.titleContains) { Resolve-WindowHandle $payload } else { [NativeDesktopAutomation]::GetForegroundWindow() }',
        '$root = [System.Windows.Automation.AutomationElement]::FromHandle($windowHandle)',
        '$all = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)',
        '$matches = New-Object System.Collections.Generic.List[object]',
        'for ($i = 0; $i -lt $all.Count; $i++) {',
        '  $element = $all.Item($i)',
        '  $current = $element.Current',
        '  if ($payload.automationId -and $current.AutomationId -ne $payload.automationId) { continue }',
        '  if ($payload.nameContains -and ($current.Name -notlike "*$($payload.nameContains)*")) { continue }',
        '  if ($payload.controlType -and ($current.ControlType.ProgrammaticName -notlike "*$($payload.controlType)*")) { continue }',
        '  $matches.Add($element) | Out-Null',
        '}',
        'if ($matches.Count -eq 0) { throw "No matching automation element found." }',
        '$elementIndex = if ($payload.elementIndex -ne $null) { [int]$payload.elementIndex } else { 0 }',
        'if ($elementIndex -ge $matches.Count) { throw "Requested automation element index is out of range." }',
        '$target = $matches[$elementIndex]',
        '$valuePattern = $null',
        'if ($target.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern, [ref]$valuePattern)) {',
        '  $valuePattern.SetValue($payload.value)',
        '} else {',
        '  $target.SetFocus()',
        '  Start-Sleep -Milliseconds 120',
        '  $hadClipboardText = [System.Windows.Forms.Clipboard]::ContainsText()',
        '  $previousClipboardText = if ($hadClipboardText) { [System.Windows.Forms.Clipboard]::GetText() } else { $null }',
        '  [System.Windows.Forms.Clipboard]::SetText($payload.value)',
        '  [System.Windows.Forms.SendKeys]::SendWait("^a")',
        '  Start-Sleep -Milliseconds 50',
        '  [System.Windows.Forms.SendKeys]::SendWait("^v")',
        '  if ($hadClipboardText) { [System.Windows.Forms.Clipboard]::SetText($previousClipboardText) }',
        '}',
        '$current = $target.Current',
        '$result = [pscustomobject]@{ name = $current.Name; automationId = $current.AutomationId; valueLength = $payload.value.Length }',
        '$result | ConvertTo-Json -Depth 6 -Compress',
      ].join('\n'),
      options,
    );
  }

  async approveChromeRemoteDebuggingPrompt(): Promise<unknown> {
    return await this.approveChromeWindowPrompt({
      promptFragments: getChromeRemoteDebuggingPromptFragmentsOnly(),
      allowButtonLabels: getChromeRemoteDebuggingAllowButtonLabelsOnly(),
    });
  }

  async approveChatGptMcpPrompt(): Promise<unknown> {
    const approvalContract = this.chatGptMcpApprovalContract;

    return await this.approveChromeWindowPrompt({
      promptFragments: approvalContract.appNamePatterns,
      allowButtonLabels: [],
      primaryActionPatterns: approvalContract.primaryActionPatterns,
      rejectButtonPatterns: approvalContract.rejectActionPatterns,
      ignoredButtonPatterns: approvalContract.ignoredActionPatterns,
      requireAppNamePatterns: approvalContract.appNamePatterns,
      contextPatterns: approvalContract.contextPatterns,
      rememberOptionPatterns: approvalContract.rememberOptionPatterns,
      autoRemember: true,
      expectedPrimaryActionPatterns: approvalContract.primaryActionPatterns,
    });
  }
}
