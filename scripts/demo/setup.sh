#!/bin/sh
# 準備錄影環境：啟動測試用 Postgres、灌入示範資料、在示範目錄建立 query-only 連線並設定黑名單。
# 這一步在錄影開始前執行，畫面上不會出現帳密或設定指令。
set -eu
REPO=$(cd "$(dirname "$0")/../.." && pwd)
DEMO_DIR=${DEMO_DIR:-$HOME/dbcli-demo}
# 下面會 rm -rf 這個目錄；只接受名稱看得出是示範目錄的路徑
case $(basename "$DEMO_DIR") in dbcli-demo*) ;; *) echo "refusing DEMO_DIR=$DEMO_DIR" >&2; exit 1 ;; esac
COMPOSE="docker compose -f $REPO/docker-compose.test.yml"

# 用獨立的 dbcli_demo 資料庫：整合測試共用 dbcli_test，留下的表不該出現在影片裡
$COMPOSE up -d --wait postgres
$COMPOSE exec -T postgres psql -q -U dbcli -d postgres -v ON_ERROR_STOP=1 \
  -c 'DROP DATABASE IF EXISTS dbcli_demo' -c 'CREATE DATABASE dbcli_demo'
$COMPOSE exec -T postgres psql -q -U dbcli -d dbcli_demo -v ON_ERROR_STOP=1 < "$REPO/scripts/demo/seed.sql"

rm -rf "$DEMO_DIR"
mkdir -p "$DEMO_DIR"
cd "$DEMO_DIR"
dbcli init --system postgresql --host localhost --port 5433 --user dbcli \
  --password testpass --name dbcli_demo --permission query-only --no-interactive --force
dbcli blacklist column add customers.password_hash
echo "demo ready in $DEMO_DIR"
