#requires -Version 5.1
#requires -RunAsAdministrator
<#
.SYNOPSIS
Adds an optional Windows printer named LumaStudio PDF.
.DESCRIPTION
Reuses an already installed Microsoft Print To PDF driver and a fixed Local Port.
No driver downloads, default-printer changes, or existing printer removals.
Run explicitly in an elevated PowerShell window. Supports -WhatIf.
#>
[CmdletBinding(SupportsShouldProcess = $true)]
param(
    [string]$InboxPath = (Join-Path ([Environment]::GetFolderPath('MyDocuments')) 'LumaStudio PDF\Print Inbox'),
    [string]$PrinterName = 'LumaStudio PDF'
)

$ErrorActionPreference = 'Stop'
if ($env:OS -ne 'Windows_NT') { throw 'This script requires Windows.' }
Import-Module PrintManagement -ErrorAction Stop

$resolvedInbox = [IO.Path]::GetFullPath($InboxPath)
if ($resolvedInbox.StartsWith('\\') -or -not [IO.Path]::IsPathRooted($resolvedInbox)) {
    throw 'Use an absolute local folder for InboxPath.'
}
$portName = Join-Path $resolvedInbox 'incoming.pdf'
$driver = Get-PrinterDriver -Name 'Microsoft Print To PDF' -ErrorAction SilentlyContinue
if (-not $driver) {
    throw 'Microsoft Print To PDF is not installed. Enable Microsoft Print to PDF in Windows optional features, then rerun this script.'
}

$existing = Get-Printer -Name $PrinterName -ErrorAction SilentlyContinue
if ($existing) {
    if ($existing.DriverName -ne $driver.Name -or $existing.PortName -ne $portName) {
        throw "A different printer already uses the name '$PrinterName'. Nothing was changed. Inspect its driver and port before continuing."
    }
    Write-Output "Already configured: $PrinterName -> $portName"
    return
}

if (-not (Test-Path -LiteralPath $resolvedInbox -PathType Container)) {
    if ($PSCmdlet.ShouldProcess($resolvedInbox, 'Create print inbox folder')) {
        New-Item -ItemType Directory -Path $resolvedInbox -Force | Out-Null
    }
}

$port = Get-PrinterPort -Name $portName -ErrorAction SilentlyContinue
if ($port -and $port.PortMonitor -ne 'Local Monitor' -and $port.PortMonitor -ne 'Local Port') {
    throw "The requested port exists with an unexpected port monitor: $($port.PortMonitor). Nothing was changed."
}
if (-not $port -and $PSCmdlet.ShouldProcess($portName, 'Create a fixed-file Local Port')) {
    Add-PrinterPort -Name $portName
}
if ($PSCmdlet.ShouldProcess($PrinterName, 'Add printer using existing Microsoft Print To PDF driver')) {
    Add-Printer -Name $PrinterName -DriverName $driver.Name -PortName $portName
    $created = Get-Printer -Name $PrinterName
    if ($created.DriverName -ne $driver.Name -or $created.PortName -ne $portName) {
        throw 'Printer configuration could not be verified.'
    }
    Write-Output "Created: $($created.Name) -> $($created.PortName)"
    Write-Output 'Keep LumaStudio PDF running. Print one job at a time and wait until each PDF appears in the editor.'
    Write-Output 'The fixed incoming.pdf file is overwritten by the next print job. Save your edited PDF under a different name.'
}
