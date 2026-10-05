#!/bin/zsh
# 依 cuts.txt 把 out/raw.mp4 剪成發佈用影片：加速段與停格段都疊上標籤，避免觀眾把剪輯誤認成原速。
# 輸出 webm、mp4、poster 與 README 縮圖到 docs/assets/demo/。
set -eu
HERE=${0:A:h}
REPO=${HERE:h:h}
RAW=${1:-$HERE/out/raw.mp4}
CUTS=${2:-$HERE/cuts.txt}
POSTER_AT=${POSTER_AT:-37}   # 拒絕訊息已出現在畫面上的時間點
DEST=$REPO/docs/assets/demo
FMT="fps=25,format=yuv420p,setsar=1"
LABEL_POS="W-w-20:H-h-10"

inputs=(-i "$RAW" -i "$HERE/labels/speed2.png" -i "$HERE/labels/speed4.png" -i "$HERE/labels/paused.png")
typeset -A label=(2 1 4 2)
graph=() parts=() n=0
while read -r start end mode dur; do
  [[ -z $start || $start == \#* ]] && continue
  n=$((n + 1))
  case $mode in
    1) graph+="[0:v]trim=$start:$end,setpts=PTS-STARTPTS,${FMT}[s$n]" ;;
    pause)
      graph+="[0:v]trim=$start:$((start + 0.04)),setpts=PTS-STARTPTS,${FMT},tpad=stop_mode=clone:stop_duration=${dur}[p$n]"
      graph+="[p$n][3:v]overlay=${LABEL_POS}[s$n]" ;;
    *)
      [[ -n ${label[$mode]:-} ]] || { print -u2 "no label image for speed $mode"; exit 1 }
      graph+="[0:v]trim=$start:$end,setpts=(PTS-STARTPTS)/${mode}[r$n]"
      graph+="[r$n][${label[$mode]}:v]overlay=${LABEL_POS},${FMT}[s$n]" ;;
  esac
  parts+="[s$n]"
done < "$CUTS"
graph+="${(j::)parts}concat=n=$n:v=1[v]"

mkdir -p "$DEST"
work=$(mktemp -d); trap 'rm -rf $work' EXIT
script=$work/graph.txt
print -r -- "${(j:;:)graph}" > $script
ffmpeg -loglevel error -y "${inputs[@]}" -/filter_complex $script -map '[v]' -an \
  -c:v libx264 -preset slow -crf 26 -pix_fmt yuv420p -movflags +faststart "$DEST/dbcli-agent-demo.mp4"
ffmpeg -loglevel error -y -i "$DEST/dbcli-agent-demo.mp4" -c:v libvpx-vp9 -b:v 0 -crf 40 -row-mt 1 -an "$DEST/dbcli-agent-demo.webm"

frame=$work/poster.png
ffmpeg -loglevel error -y -ss $POSTER_AT -i "$RAW" -frames:v 1 "$frame"
cwebp -quiet -q 80 "$frame" -o "$DEST/dbcli-agent-demo-poster.webp"
ffmpeg -loglevel error -y -i "$frame" -i "$HERE/labels/play.png" \
  -filter_complex "[0:v]scale=960:-1[b];[b][1:v]overlay=(W-w)/2:(H-h)/2" "${frame%.png}-thumb.png"
cwebp -quiet -q 80 "${frame%.png}-thumb.png" -o "$DEST/dbcli-agent-demo-thumb.webp"

for f in "$DEST"/dbcli-agent-demo.{mp4,webm}; do
  print "$f: $(ffprobe -v error -show_entries format=duration -of csv=p=0 $f)s, $(( $(wc -c < $f) / 1024 )) KB"
done
