import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { WorkspaceFileAccess } from './workspaceFileAccess.js';

function encodePayload(payload: unknown): string {
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64');
}

async function runPowerShellJson<T>(
  script: string,
  payload: unknown,
): Promise<T> {
  const encodedPayload = encodePayload(payload);
  const fullScript = [
    '$ErrorActionPreference = "Stop"',
    '$payload = [System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String("' +
      encodedPayload +
      '")) | ConvertFrom-Json',
    script,
  ].join('\n');

  const scriptDirectoryPath = await mkdtemp(
    path.join(tmpdir(), 'full-access-windows-system-'),
  );
  const scriptFilePath = path.join(scriptDirectoryPath, 'system-control.ps1');
  await writeFile(scriptFilePath, fullScript, 'utf8');

  try {
    return await new Promise<T>((resolve, reject) => {
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

      child.stdout.on('data', (chunk) => {
        stdout += chunk.toString('utf8');
      });
      child.stderr.on('data', (chunk) => {
        stderr += chunk.toString('utf8');
      });

      child.once('error', (error) => reject(error));
      child.once('close', (exitCode) => {
        if (exitCode !== 0) {
          reject(
            new Error(
              `PowerShell system control failed with exit code ${String(exitCode)}: ${stderr || stdout}`,
            ),
          );
          return;
        }

        const trimmedOutput = stdout.trim();
        if (!trimmedOutput) {
          reject(new Error('PowerShell system control returned no output.'));
          return;
        }

        try {
          resolve(JSON.parse(trimmedOutput) as T);
        } catch (error) {
          reject(
            new Error(
              `Failed to parse PowerShell system control output: ${trimmedOutput}\n${String(error)}`,
            ),
          );
        }
      });

      child.stdin.end();
    });
  } finally {
    await rm(scriptDirectoryPath, { recursive: true, force: true });
  }
}

function sleep(delayMs: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, delayMs);
  });
}

export class WindowsSystemControl {
  constructor(private readonly workspaceFileAccess: WorkspaceFileAccess) {}

  async wait(delayMs: number): Promise<{ waitedMs: number }> {
    await sleep(delayMs);
    return { waitedMs: delayMs };
  }

  async readClipboard(): Promise<{ text: string | null }> {
    return await runPowerShellJson<{ text: string | null }>(
      [
        'Add-Type -AssemblyName System.Windows.Forms',
        '$text = if ([System.Windows.Forms.Clipboard]::ContainsText()) { [System.Windows.Forms.Clipboard]::GetText() } else { $null }',
        '[pscustomobject]@{ text = $text } | ConvertTo-Json -Compress',
      ].join('\n'),
      {},
    );
  }

  async writeClipboard(text: string): Promise<{ textLength: number }> {
    return await runPowerShellJson<{ textLength: number }>(
      [
        'Add-Type -AssemblyName System.Windows.Forms',
        '[System.Windows.Forms.Clipboard]::SetText($payload.text)',
        '[pscustomobject]@{ textLength = $payload.text.Length } | ConvertTo-Json -Compress',
      ].join('\n'),
      { text },
    );
  }

  async listProcesses(options?: {
    nameContains?: string;
    maxResults?: number;
  }): Promise<unknown[]> {
    return await runPowerShellJson<unknown[]>(
      [
        '$maxResults = if ($payload.maxResults) { [Math]::Max(1, [int]$payload.maxResults) } else { 100 }',
        '$nameContains = if ($payload.nameContains) { "$($payload.nameContains)".ToLowerInvariant() } else { $null }',
        '$result = Get-Process | Where-Object {',
        '  if (-not $nameContains) { return $true }',
        '  $_.ProcessName.ToLowerInvariant().Contains($nameContains)',
        '} | Sort-Object ProcessName, Id | Select-Object -First $maxResults | ForEach-Object {',
        '  [pscustomobject]@{',
        '    processId = $_.Id',
        '    processName = $_.ProcessName',
        '    mainWindowTitle = $_.MainWindowTitle',
        '    workingSetBytes = $_.WorkingSet64',
        '    cpuSeconds = $_.CPU',
        '  }',
        '}',
        '$result | ConvertTo-Json -Depth 6 -Compress',
      ].join('\n'),
      options ?? {},
    );
  }

  async stopProcess(
    processId: number,
    force = false,
  ): Promise<{ processId: number; force: boolean }> {
    return await runPowerShellJson<{ processId: number; force: boolean }>(
      [
        '$stopParameters = @{ Id = [int]$payload.processId; ErrorAction = "Stop" }',
        'if ($payload.force) { $stopParameters["Force"] = $true }',
        'Stop-Process @stopParameters',
        '[pscustomobject]@{ processId = [int]$payload.processId; force = [bool]$payload.force } | ConvertTo-Json -Compress',
      ].join('\n'),
      { processId, force },
    );
  }

  async launchApplication(options: {
    command: string;
    arguments?: string[];
    cwd?: string;
  }): Promise<{ pid: number | undefined; commandLine: string; cwd: string }> {
    const workingDirectory = options.cwd
      ? this.workspaceFileAccess.resolveWorkspacePath(options.cwd, false)
      : this.workspaceFileAccess.listWorkspaceRoots()[0]!;

    const child = spawn(options.command, options.arguments ?? [], {
      cwd: workingDirectory,
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    });
    child.unref();

    return {
      pid: child.pid,
      commandLine: [options.command, ...(options.arguments ?? [])].join(' ').trim(),
      cwd: workingDirectory,
    };
  }

  async showNotification(options: {
    title: string;
    message: string;
    durationMs?: number;
  }): Promise<{ shown: true; title: string; durationMs: number }> {
    return await runPowerShellJson<{
      shown: true;
      title: string;
      durationMs: number;
    }>(
      [
        'Add-Type -AssemblyName System.Windows.Forms',
        'Add-Type -AssemblyName System.Drawing',
        '$notifyIcon = New-Object System.Windows.Forms.NotifyIcon',
        '$notifyIcon.Icon = [System.Drawing.SystemIcons]::Information',
        '$notifyIcon.Visible = $true',
        '$notifyIcon.BalloonTipTitle = $payload.title',
        '$notifyIcon.BalloonTipText = $payload.message',
        '$durationMs = if ($payload.durationMs) { [Math]::Max(1000, [int]$payload.durationMs) } else { 3000 }',
        '$notifyIcon.ShowBalloonTip($durationMs)',
        'Start-Sleep -Milliseconds ($durationMs + 500)',
        '$notifyIcon.Dispose()',
        '[pscustomobject]@{ shown = $true; title = $payload.title; durationMs = $durationMs } | ConvertTo-Json -Compress',
      ].join('\n'),
      options,
    );
  }

  async getRegistryValue(options: {
    keyPath: string;
    valueName?: string;
  }): Promise<unknown> {
    return await runPowerShellJson<unknown>(
      [
        '$item = Get-Item -Path $payload.keyPath -ErrorAction Stop',
        'if ($payload.valueName) {',
        '  $property = Get-ItemProperty -Path $payload.keyPath -Name $payload.valueName -ErrorAction Stop',
        '  $value = $property.($payload.valueName)',
        '  [pscustomobject]@{ keyPath = $payload.keyPath; valueName = $payload.valueName; value = $value } | ConvertTo-Json -Depth 8 -Compress',
        '} else {',
        '  $properties = Get-ItemProperty -Path $payload.keyPath | Select-Object * -ExcludeProperty PSPath,PSParentPath,PSChildName,PSDrive,PSProvider',
        '  [pscustomobject]@{ keyPath = $payload.keyPath; values = $properties } | ConvertTo-Json -Depth 8 -Compress',
        '}',
      ].join('\n'),
      options,
    );
  }

  async setRegistryValue(options: {
    keyPath: string;
    valueName: string;
    value: string | number | boolean | string[];
    valueType?: 'String' | 'ExpandString' | 'Binary' | 'DWord' | 'QWord' | 'MultiString';
  }): Promise<unknown> {
    return await runPowerShellJson<unknown>(
      [
        '$valueType = if ($payload.valueType) { $payload.valueType } else { "String" }',
        'New-Item -Path $payload.keyPath -Force | Out-Null',
        'New-ItemProperty -Path $payload.keyPath -Name $payload.valueName -Value $payload.value -PropertyType $valueType -Force | Out-Null',
        '[pscustomobject]@{ keyPath = $payload.keyPath; valueName = $payload.valueName; valueType = $valueType } | ConvertTo-Json -Compress',
      ].join('\n'),
      options,
    );
  }

  async deleteRegistryValue(options: {
    keyPath: string;
    valueName: string;
  }): Promise<{ keyPath: string; valueName: string; deleted: true }> {
    return await runPowerShellJson<{
      keyPath: string;
      valueName: string;
      deleted: true;
    }>(
      [
        'Remove-ItemProperty -Path $payload.keyPath -Name $payload.valueName -ErrorAction Stop',
        '[pscustomobject]@{ keyPath = $payload.keyPath; valueName = $payload.valueName; deleted = $true } | ConvertTo-Json -Compress',
      ].join('\n'),
      options,
    );
  }
}
