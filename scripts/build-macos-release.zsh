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
cache_root="$project_root/.release-cache"
package_root="$work_root/键记本地版_Apple芯片"
payload_dir="$package_root/.payload"
program_dir="$payload_dir/program"
runtime_dir="$payload_dir/runtime"
artifact_dir="$project_root/artifacts"
artifact_name="Cike-macOS-Apple-Silicon-v$version.zip"
artifact_path="$artifact_dir/$artifact_name"
checksum_path="$artifact_path.sha256"
node_version="${JIANJI_NODE_VERSION:-24.14.1}"
node_archive="node-v$node_version-darwin-arm64.tar.gz"
node_url="https://nodejs.org/dist/v$node_version/$node_archive"
checksum_url="https://nodejs.org/dist/v$node_version/SHASUMS256.txt"
cached_archive="$cache_root/$node_archive"
cached_checksums="$cache_root/SHASUMS256-v$node_version.txt"

[[ "$(/usr/bin/uname -m)" == "arm64" ]] || { print -u2 "Release builds require an arm64 Apple Silicon Mac."; exit 69; }
[[ -d "$project_root/node_modules" ]] || { print -u2 "node_modules is missing; run npm ci first."; exit 69; }
[[ -f "$template_root/安装键记.command" ]] || { print -u2 "Installer template is missing."; exit 66; }
[[ -f "$template_root/键记.webloc" ]] || { print -u2 "Shortcut template is missing."; exit 66; }
[[ -f "$template_root/runtime/local-server.mjs" ]] || { print -u2 "Local server runtime is missing."; exit 66; }

/bin/mkdir -p "$cache_root" "$artifact_dir"
if [[ ! -f "$cached_archive" ]]; then
  /usr/bin/curl --fail --location --retry 3 --output "$cached_archive" "$node_url"
fi
if [[ ! -f "$cached_checksums" ]]; then
  /usr/bin/curl --fail --location --retry 3 --output "$cached_checksums" "$checksum_url"
fi

expected_checksum="$(/usr/bin/awk -v file="$node_archive" '$2 == file { print $1 }' "$cached_checksums")"
actual_checksum="$(/usr/bin/shasum -a 256 "$cached_archive" | /usr/bin/awk '{ print $1 }')"
[[ -n "$expected_checksum" && "$expected_checksum" == "$actual_checksum" ]] || { print -u2 "Official Node.js checksum verification failed."; exit 70; }

cd "$project_root"
npm run build

/bin/rm -rf "$work_root"
/bin/mkdir -p "$package_root" "$program_dir" "$runtime_dir" "$artifact_dir" "$work_root/node"
/usr/bin/tar -xzf "$cached_archive" -C "$work_root/node"
official_node="$work_root/node/node-v$node_version-darwin-arm64/bin/node"
[[ -x "$official_node" ]] || { print -u2 "Official Node.js executable is missing."; exit 70; }
/usr/bin/file "$official_node" | /usr/bin/grep -q 'arm64' || { print -u2 "Official Node.js executable is not arm64."; exit 70; }
publisher_id="$(/usr/bin/codesign -dv --verbose=4 "$official_node" 2>&1 | /usr/bin/awk -F= '/^TeamIdentifier=/{ print $2 }')"
[[ "$publisher_id" == "HX7739G8FX" ]] || { print -u2 "Official Node.js publisher identity is missing or unexpected."; exit 70; }

/usr/bin/ditto "$project_root/dist" "$program_dir/dist"
/usr/bin/ditto "$template_root/runtime" "$runtime_dir"
/usr/bin/ditto "$official_node" "$runtime_dir/node"
/usr/bin/ditto "$template_root/安装键记.command" "$package_root/安装键记.command"
/usr/bin/ditto "$template_root/键记.webloc" "$payload_dir/键记.webloc"
/usr/bin/ditto "$template_root/使用说明.txt" "$package_root/使用说明.txt"
/bin/echo "$version" > "$payload_dir/VERSION"
/bin/chmod 755 "$package_root/安装键记.command" "$runtime_dir/node"

# Preserve the user-selected artwork as the Finder icon for the desktop shortcut.
iconset_dir="$work_root/AppIcon.iconset"
/usr/bin/iconutil -c iconset "$template_root/AppIcon.icns" -o "$iconset_dir"
/usr/bin/sips -i "$iconset_dir/icon_512x512@2x.png" >/dev/null
/usr/bin/xcrun DeRez -only icns "$iconset_dir/icon_512x512@2x.png" > "$work_root/shortcut-icon.rsrc"
/usr/bin/xcrun Rez -append "$work_root/shortcut-icon.rsrc" -o "$payload_dir/键记.webloc"
/usr/bin/xcrun SetFile -a C "$payload_dir/键记.webloc"

/bin/rm -f "$artifact_path" "$checksum_path"
/usr/bin/ditto -c -k --sequesterRsrc --keepParent "$package_root" "$artifact_path"
/usr/bin/unzip -tq "$artifact_path"

forbidden_files="$(/usr/bin/zipinfo -1 "$artifact_path" | /usr/bin/grep -E '/(node_modules|\.wrangler|\.git|\.env)(/|$)|\.node$|workerd$|tailwindcss-oxide|rolldown-binding|\.log$|\.pid$' || true)"
if [[ -n "$forbidden_files" ]]; then
  print -u2 "Release contains forbidden development or native files:"
  print -u2 -- "$forbidden_files"
  exit 70
fi

cd "$artifact_dir"
/usr/bin/shasum -a 256 "$artifact_name" > "$artifact_name.sha256"

print "Release ready: $artifact_path"
print "Checksum: $checksum_path"
