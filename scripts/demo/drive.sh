#!/bin/zsh
# 在 tmux 裡驅動 Claude Code：處理信任提示、逐字送出請求、等 agent 回合結束。
# vhs 只負責 attach 錄影；結束時打開 tmux 狀態列顯示 DEMO-DONE 讓 vhs 停止。
T=${DEMO_TMUX:-dbclidemo}
LOG=${DEMO_OUT:?}/drive.log
DONE='[A-Z][a-z]+ed for ([0-9]+m )?[0-9]+s'
PROMPT=${DEMO_PROMPT:?}

log() { print -r -- "$(date +%T) $*" >> $LOG }
# 不用 set -e：迴圈靠 grep 的非零結束碼判斷畫面狀態。
# 任何結束路徑都打開狀態列的 DEMO-DONE，讓 vhs 停止錄影而不是等到逾時。
finish() { tmux set -t $T status on; tmux set -t $T status-left 'DEMO-DONE' }
trap finish EXIT
screen() { tmux capture-pane -p -t $T }
count_done() { tmux capture-pane -p -S - -t $T | grep -cE "$DONE" }
wait_for() { local re=$1 limit=$2 t=0; until screen | grep -qE "$re"; do sleep 1; ((t++)); ((t > limit)) && { log "timeout: $re"; return 1 }; done }
type_slow() { for c in ${(s::)1}; do tmux send-keys -t $T -l -- "$c"; sleep 0.03; done }

until tmux list-clients -t $T 2>/dev/null | grep -q .; do sleep 0.5; done
log "client attached"
if wait_for 'trust this folder|accept edits on|auto mode on|shortcuts|for agents' 90 && screen | grep -q 'trust this folder'; then
  tmux send-keys -t $T Down; sleep 0.5; tmux send-keys -t $T Enter
  log "trusted folder"
fi
wait_for 'accept edits on|auto mode on|shortcuts|for agents' 90 || exit 1
sleep 2
type_slow "$PROMPT"; sleep 1.5; tmux send-keys -t $T Enter
log "prompt sent"

# auto mode 仍要求確認時，只替唯讀的 dbcli 指令選 Yes；其他提示一律中止錄影，
# 否則影片裡「agent 沒有替自己提高權限」可能在無人察覺下失真
t=0
until (( $(count_done) > 0 )); do
  if screen | grep -q 'Do you want to proceed?'; then
    if screen | grep -qE 'dbcli (schema|list|query|blacklist list)\b' && ! screen | grep -qE 'dbcli (init|update|insert|delete|blacklist (column|table) (add|remove))'; then
      sleep 1.5; tmux send-keys -t $T Enter; log "approved a read-only dbcli prompt"; sleep 2
    else
      log "unexpected permission prompt, aborting"; exit 1
    fi
  fi
  sleep 2; ((t+=2)); ((t > 1200)) && { log "turn timeout"; exit 1 }
done
log "turn done"
sleep 6
