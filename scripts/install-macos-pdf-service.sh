#!/bin/bash
# Explicitly run on the target Mac after installing the app. Never run with sudo.
set -euo pipefail

if [[ "$(uname -s)" != "Darwin" ]]; then
  printf '%s\n' 'This script requires macOS.' >&2
  exit 1
fi
if [[ "$(id -u)" == "0" ]]; then
  printf '%s\n' 'Run this script as your normal user, without sudo.' >&2
  exit 1
fi

app_path="${1:-/Applications/LumaStudio PDF.app}"
if [[ "$app_path" != /* || ! -d "$app_path/Contents" || ! -f "$app_path/Contents/Info.plist" ]]; then
  printf '%s\n' 'Pass the absolute path of an installed LumaStudio PDF.app.' >&2
  exit 1
fi
bundle_id=$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$app_path/Contents/Info.plist")
if [[ "$bundle_id" != "jp.altimix.lumastudio-pdf" ]]; then
  printf '%s\n' "Unexpected application bundle identifier: $bundle_id" >&2
  exit 1
fi

services_dir="$HOME/Library/PDF Services"
service_path="$services_dir/LumaStudio PDF.app"
if [[ -L "$service_path" ]]; then
  if [[ "$(readlink "$service_path")" == "$app_path" ]]; then
    printf '%s\n' "Already configured: $service_path"
    exit 0
  fi
  printf '%s\n' "A different PDF Service already exists: $service_path. Nothing was changed." >&2
  exit 1
fi
if [[ -e "$service_path" ]]; then
  printf '%s\n' "A file already exists: $service_path. Nothing was changed." >&2
  exit 1
fi

mkdir -p "$services_dir"
ln -s "$app_path" "$service_path"
printf '%s\n' 'Added LumaStudio PDF to this user’s PDF Services.'
printf '%s\n' 'Open another app’s Print dialog, then choose PDF > LumaStudio PDF.'
printf '%s\n' 'If the menu is not refreshed, reopen the source application.'
