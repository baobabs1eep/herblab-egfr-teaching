#!/usr/bin/env bash
set -euo pipefail
# Existing /opt/herblab installation; never copy repository environment files.
revision=${1:?请提供需要部署的完整提交编号}
[[ "$revision" =~ ^[0-9a-f]{7,40}$ ]] || { echo '提交编号不合法'; exit 1; }
app_dir=/opt/herblab
test -d "$app_dir/本地服务"
test -d "$app_dir/演示前端"
update_dir=$(mktemp -d /tmp/herblab-update.XXXXXX)
git clone https://github.com/baobabs1eep/herblab-egfr-teaching.git "$update_dir"
git -C "$update_dir" checkout --detach "$revision"
for file in server.cjs literature-import.cjs research.cjs sources.cjs candidate-check.cjs; do
  test -f "$update_dir/本地服务/$file"
  node --check "$update_dir/本地服务/$file"
done
for file in app.js research-ui.js sources-ui.js; do node --check "$update_dir/演示前端/$file"; done
backup_dir="/opt/herblab-backups/before-update-$(date +%Y%m%d-%H%M%S)-$$"
sudo install -d -m 700 "$backup_dir"
sudo cp -a "$app_dir/演示前端" "$app_dir/本地服务" "$backup_dir/"
rollback(){
  echo "部署未通过，恢复备份：$backup_dir"
  sudo cp -a "$backup_dir/演示前端/." "$app_dir/演示前端/"
  sudo cp -a "$backup_dir/本地服务/." "$app_dir/本地服务/"
  sudo systemctl restart herblab
}
trap 'rollback' ERR
sudo cp -a "$update_dir/演示前端/." "$app_dir/演示前端/"
sudo chown -R herblab:herblab "$app_dir/演示前端"
for file in server.cjs literature-import.cjs research.cjs sources.cjs candidate-check.cjs; do
  sudo install -o herblab -g herblab -m 644 "$update_dir/本地服务/$file" "$app_dir/本地服务/$file"
done
sudo systemctl restart herblab
healthy=false
for attempt in {1..10}; do
  if curl --fail --silent --show-error --max-time 10 https://43.129.169.13/api/health; then healthy=true; break; fi
  sleep 2
done
test "$healthy" = true
sudo systemctl is-active --quiet herblab
trap - ERR
printf '\n部署完成：%s\n备份：%s\n' "$revision" "$backup_dir"
