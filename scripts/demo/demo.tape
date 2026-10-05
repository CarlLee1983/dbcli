# vhs 只錄畫面：attach 到 drive.sh 正在驅動的 tmux session，畫面出現 DEMO-DONE 時結束。
Output raw.mp4
Set Shell zsh
Set Width 1280
Set Height 760
Set FontSize 17
Set Padding 24
Set Theme "Catppuccin Mocha"

Hide
Type "clear && tmux attach -t dbclidemo"
Enter
Wait+Screen@90s /accept edits on|auto mode on|shortcuts|for agents/
Sleep 1s
Show
Wait+Screen@30m /DEMO-DONE/
