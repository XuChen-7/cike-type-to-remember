#!/bin/zsh

set -euo pipefail

if [[ $# -ne 1 ]]; then
  print -u2 "Usage: build-macos-release.zsh <version>"
  exit 64
fi

version="$1"
if [[ ! "$version" =~ '^[0-9]+\.[0-9]+\.[0-9]+$' ]]; then
  print -u2 "Version must use X.Y.Z format."
  exit 64
fi

project_root="${0:A:h:h}"
template_root="$project_root/release/macos"
work_root="$project_root/.release-work"
package_root="$work_root/词刻本地版_Apple芯片"
installer_app="$package_root/安装词刻.app"
resources_dir="$installer_app/Contents/Resources"
payload_dir="$resources_dir/payload"
payload_site="$payload_dir/site"
launcher_app="$payload_dir/词刻.app"
artifact_dir="$project_root/artifacts"
artifact_name="词刻本地版_Apple芯片_v$version.zip"
artifact_path="$artifact_dir/$artifact_name"
checksum_path="$artifact_path.sha256"
node_bin="${CIKE_NODE_BIN:-$(command -v node)}"

[[ "$(/usr/bin/uname -m)" == "arm64" ]] || { print -u2 "Release builds require an Apple Silicon Mac."; exit 69; }
[[ -x "$node_bin" ]] || { print -u2 "Node.js is missing."; exit 69; }
/usr/bin/file "$node_bin" | /usr/bin/grep -q 'arm64' || { print -u2 "Node.js must contain an arm64 executable."; exit 69; }
[[ -d "$project_root/node_modules" ]] || { print -u2 "node_modules is missing; run npm ci first."; exit 69; }
[[ -f "$template_root/AppIcon.icns" ]] || { print -u2 "Release icon is missing."; exit 66; }

cd "$project_root"
npm run build

/bin/rm -rf "$work_root"
/bin/mkdir -p "$package_root" "$payload_dir/runtime" "$artifact_dir"
/usr/bin/ditto "$template_root/installer" "$installer_app"
/usr/bin/ditto "$template_root/launcher" "$launcher_app"
/usr/bin/ditto "$template_root/AppIcon.icns" "$resources_dir/AppIcon.icns"
/usr/bin/ditto "$template_root/AppIcon.icns" "$launcher_app/Contents/Resources/AppIcon.icns"
/usr/bin/ditto "$template_root/使用说明.txt" "$package_root/使用说明.txt"
/bin/echo "$version" > "$resources_dir/VERSION"

/usr/bin/rsync -a \
  --exclude='/.git' \
  --exclude='/.wrangler' \
  --exclude='/.next' \
  --exclude='/.vinext' \
  --exclude='/dist' \
  --exclude='/artifacts' \
  --exclude='/.release-work' \
  --exclude='/release' \
  --exclude='/release-notes' \
  --exclude='/scripts' \
  --exclude='/README.md' \
  --exclude='/.cike-local-server.log' \
  --exclude='/.cike-local-server.pid' \
  --exclude='/tsconfig.tsbuildinfo' \
  --exclude='/.env' \
  --exclude='/.env.*' \
  "$project_root/" "$payload_site/"

if [[ -f "$payload_site/.openai/hosting.json" ]]; then
  /usr/bin/plutil -remove project_id "$payload_site/.openai/hosting.json" >/dev/null 2>&1 || true
fi

/usr/bin/ditto "$node_bin" "$payload_dir/runtime/node"
/bin/chmod 755 "$installer_app/Contents/MacOS/installer" "$launcher_app/Contents/MacOS/launcher" "$payload_dir/runtime/node"

/usr/libexec/PlistBuddy -c "Set :CFBundleShortVersionString $version" "$installer_app/Contents/Info.plist"
/usr/libexec/PlistBuddy -c "Set :CFBundleVersion $version" "$installer_app/Contents/Info.plist"
/usr/libexec/PlistBuddy -c "Set :CFBundleShortVersionString $version" "$launcher_app/Contents/Info.plist"
/usr/libexec/PlistBuddy -c "Set :CFBundleVersion $version" "$launcher_app/Contents/Info.plist"

/usr/bin/codesign --force --deep --sign - "$launcher_app"
/usr/bin/codesign --force --deep --sign - "$installer_app"
/usr/bin/codesign --verify --deep --strict "$installer_app"

/bin/rm -f "$artifact_path" "$checksum_path"
/usr/bin/ditto -c -k --sequesterRsrc --keepParent "$package_root" "$artifact_path"
/usr/bin/unzip -tq "$artifact_path"

private_files="$(/usr/bin/zipinfo -1 "$artifact_path" | /usr/bin/grep -E '/(\.wrangler|\.git|\.env)(/|$)|\.cike-local-server\.(log|pid)$|tsconfig\.tsbuildinfo$' || true)"
if [[ -n "$private_files" ]]; then
  print -u2 "Release contains forbidden local files:"
  print -u2 -- "$private_files"
  exit 70
fi

cd "$artifact_dir"
/usr/bin/shasum -a 256 "$artifact_name" > "$artifact_name.sha256"

print "Release ready: $artifact_path"
print "Checksum: $checksum_path"
