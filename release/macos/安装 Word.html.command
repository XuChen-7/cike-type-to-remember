#!/bin/zsh

set -euo pipefail

script_dir="${0:A:h}"
payload_dir="$script_dir/.payload"
version="$(/usr/bin/sed -n '1p' "$payload_dir/VERSION")"
user_home="${JIANJI_USER_HOME:-$HOME}"
support_dir="$user_home/Library/Application Support/词刻"
program_dir="$support_dir/program"
runtime_dir="$support_dir/runtime"
data_dir="$support_dir/data"
backup_root="$support_dir/backups"
legacy_site="$support_dir/site"
desktop_dir="$user_home/Desktop"
shortcut="$desktop_dir/Word.html.webloc"
launch_agents_dir="$user_home/Library/LaunchAgents"
launch_agent="$launch_agents_dir/com.jianji.local.plist"
label="com.jianji.local"
uid="$(/usr/bin/id -u)"

show_dialog() {
  if [[ "${JIANJI_NONINTERACTIVE:-0}" != "1" ]]; then
    /usr/bin/osascript -e "display dialog \"$1\" buttons {\"好\"} default button 1 with title \"Word.html\"" >/dev/null 2>&1 || true
  fi
}

fail() {
  show_dialog "$1"
  print -u2 -- "$1"
  exit 1
}

[[ "$(/usr/bin/uname -m)" == "arm64" ]] || fail "这个安装包支持 Apple Silicon Mac（M1、M2、M3、M4、M5 及 Pro/Max/Ultra）。"
[[ -n "$version" ]] || fail "安装包不完整：找不到版本号。"
[[ -d "$payload_dir/program/dist/server" && -d "$payload_dir/program/dist/client" ]] || fail "安装包不完整：找不到网页程序。"
[[ -x "$payload_dir/runtime/node" ]] || fail "安装包不完整：找不到本地运行环境。"

install_mode="安装"
if [[ -e "$support_dir/version" || -d "$program_dir" || -d "$legacy_site" ]]; then
  install_mode="升级"
fi

if [[ "${JIANJI_SKIP_LAUNCH_AGENT:-0}" != "1" ]]; then
  /bin/launchctl bootout "gui/$uid" "$launch_agent" >/dev/null 2>&1 || true
fi

legacy_pid_file="$support_dir/词刻服务.pid"
if [[ -f "$legacy_pid_file" ]]; then
  legacy_pid="$(/usr/bin/sed -n '1p' "$legacy_pid_file")"
  if [[ "$legacy_pid" =~ '^[0-9]+$' ]]; then
    legacy_command="$(/bin/ps -p "$legacy_pid" -o command= 2>/dev/null || true)"
    if [[ "$legacy_command" == *"$legacy_site"* ]]; then
      /bin/kill "$legacy_pid" >/dev/null 2>&1 || true
    fi
  fi
fi

/bin/mkdir -p "$support_dir" "$data_dir" "$backup_root" "$desktop_dir" "$launch_agents_dir"

timestamp="$(/bin/date '+%Y%m%d-%H%M%S')"
if [[ -d "$data_dir" && -n "$(/bin/ls -A "$data_dir" 2>/dev/null || true)" ]]; then
  backup_dir="$backup_root/$timestamp-v$version-data"
  /usr/bin/ditto "$data_dir" "$backup_dir" || fail "升级前的数据备份失败，已停止升级。"
fi
if [[ -d "$legacy_site/.wrangler" && ! -L "$legacy_site/.wrangler" ]]; then
  legacy_backup="$backup_root/$timestamp-v$version-legacy-wrangler"
  /usr/bin/ditto "$legacy_site/.wrangler" "$legacy_backup" || fail "旧版词库备份失败，已停止升级。"
fi

database_path="$data_dir/vocab.sqlite"
if [[ ! -f "$database_path" && -d "$legacy_site/.wrangler/state/v3/d1/miniflare-D1DatabaseObject" ]]; then
  legacy_databases=("$legacy_site"/.wrangler/state/v3/d1/miniflare-D1DatabaseObject/*.sqlite(N))
  for candidate in "${legacy_databases[@]}"; do
    if /usr/bin/sqlite3 "$candidate" '.tables' 2>/dev/null | /usr/bin/grep -q 'workspaces'; then
      /usr/bin/sqlite3 "$candidate" ".backup '$database_path'" || fail "旧版词库迁移失败，已停止升级。"
      break
    fi
  done
fi

/bin/rm -rf "$program_dir" "$runtime_dir"
/usr/bin/ditto "$payload_dir/program" "$program_dir"
/usr/bin/ditto "$payload_dir/runtime" "$runtime_dir"
/bin/chmod 755 "$runtime_dir/node"
/bin/echo "$version" > "$support_dir/version"

/usr/bin/ditto "$payload_dir/Word.html.webloc" "$shortcut"

/usr/bin/plutil -create xml1 "$launch_agent"
/usr/libexec/PlistBuddy -c "Add :Label string $label" "$launch_agent"
/usr/libexec/PlistBuddy -c 'Add :ProgramArguments array' "$launch_agent"
/usr/libexec/PlistBuddy -c "Add :ProgramArguments:0 string $runtime_dir/node" "$launch_agent"
/usr/libexec/PlistBuddy -c 'Add :ProgramArguments:1 string --import' "$launch_agent"
/usr/libexec/PlistBuddy -c "Add :ProgramArguments:2 string $runtime_dir/register-loader.mjs" "$launch_agent"
/usr/libexec/PlistBuddy -c "Add :ProgramArguments:3 string $runtime_dir/local-server.mjs" "$launch_agent"
/usr/libexec/PlistBuddy -c 'Add :EnvironmentVariables dict' "$launch_agent"
/usr/libexec/PlistBuddy -c "Add :EnvironmentVariables:JIANJI_SUPPORT_DIR string $support_dir" "$launch_agent"
/usr/libexec/PlistBuddy -c "Add :EnvironmentVariables:JIANJI_PROGRAM_DIR string $program_dir" "$launch_agent"
/usr/libexec/PlistBuddy -c "Add :EnvironmentVariables:JIANJI_DATA_DIR string $data_dir" "$launch_agent"
/usr/libexec/PlistBuddy -c 'Add :EnvironmentVariables:JIANJI_HOST string 127.0.0.1' "$launch_agent"
/usr/libexec/PlistBuddy -c 'Add :EnvironmentVariables:JIANJI_PORT string 3000' "$launch_agent"
/usr/libexec/PlistBuddy -c "Add :StandardOutPath string $support_dir/Word.html运行日志.log" "$launch_agent"
/usr/libexec/PlistBuddy -c "Add :StandardErrorPath string $support_dir/Word.html运行日志.log" "$launch_agent"
/usr/libexec/PlistBuddy -c 'Add :RunAtLoad bool true' "$launch_agent"
/usr/libexec/PlistBuddy -c 'Add :KeepAlive bool true' "$launch_agent"
/usr/libexec/PlistBuddy -c 'Add :ProcessType string Interactive' "$launch_agent"
/usr/bin/plutil -lint "$launch_agent" >/dev/null || fail "本地启动配置创建失败。"

if [[ "${JIANJI_SKIP_LAUNCH_AGENT:-0}" != "1" ]]; then
  /bin/launchctl bootstrap "gui/$uid" "$launch_agent" >/dev/null 2>&1 || fail "本地服务未能注册，请重新运行安装程序。"
  /bin/launchctl kickstart -k "gui/$uid/$label" >/dev/null 2>&1 || true
fi

if [[ -L "$desktop_dir/词刻.app" ]]; then /bin/rm "$desktop_dir/词刻.app"; fi
if [[ -f "$desktop_dir/键记.webloc" ]]; then /bin/rm "$desktop_dir/键记.webloc"; fi

if [[ "${JIANJI_SKIP_OPEN:-0}" != "1" ]]; then
  show_dialog "Word.html v$version ${install_mode}完成！已有科目、词条和练习记录均已保留。"
  /bin/sleep 1
  /usr/bin/open 'http://127.0.0.1:3000/'
fi

print "Word.html v$version ${install_mode}完成。"
