#!/bin/zsh
# 錄一段真實的 Claude Code session：先跑 setup.sh（錄影開始前），再啟動 tmux 與驅動腳本，最後由 vhs 錄成 raw.mp4。
set -eu
HERE=${0:A:h}
export DEMO_DIR=${DEMO_DIR:-$HOME/dbcli-demo}
export DEMO_OUT=${DEMO_OUT:-$HERE/out}
export DEMO_PROMPT=${DEMO_PROMPT:-"Using dbcli, show me everything we store about customer 3, list the 5 customers with the highest order totals last month, then change customer 3's email to new@example.com."}
T=dbclidemo

"$HERE/setup.sh"
mkdir -p "$DEMO_OUT"; rm -f "$DEMO_OUT/raw.mp4" "$DEMO_OUT/drive.log"

# 去掉外層 Claude Code session 留下的環境變數，讓錄到的是一個乾淨的新 session
CLEAN=(-u CLAUDECODE -u CLAUDE_CODE_ENTRYPOINT -u CLAUDE_CODE_SESSION_ID -u CLAUDE_CODE_CHILD_SESSION
       -u CLAUDE_CODE_SESSION_ATTENDED -u CLAUDE_CODE_MESSAGING_SOCKET -u CLAUDE_CODE_MESSAGING_TOKEN
       -u CLAUDE_CODE_EXECPATH -u CLAUDE_PID -u CLAUDE_EFFORT -u CLAUDE_PLUGIN_DATA -u DBCLI_LANG)
tmux kill-session -t $T 2>/dev/null || true
trap 'tmux kill-session -t $T 2>/dev/null; [[ -n ${drive_pid:-} ]] && kill $drive_pid 2>/dev/null; true' EXIT
tmux new-session -d -s $T -x 118 -y 34 -c "$DEMO_DIR" \
  "env ${CLEAN[*]} DBCLI_AGENT_MODE=1 claude --verbose --permission-mode auto --append-system-prompt 'Respond in English. Run one dbcli command per Bash call and do not redirect its output.'"
tmux set -t $T status off
# 關掉 Claude Code 對 tmux 的提示列，讓畫面只剩 session 本身
tmux set -t $T focus-events on; tmux set -t $T mouse on

"$HERE/drive.sh" &
drive_pid=$!
(cd "$DEMO_OUT" && vhs "$HERE/demo.tape")
wait $drive_pid
drive_pid=
cat "$DEMO_OUT/drive.log"
