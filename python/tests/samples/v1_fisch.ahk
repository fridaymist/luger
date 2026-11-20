#NoEnv
#SingleInstance Force
SendMode Input
SetTimer, CheckShake, 100
toggle := false
speed = 50

; Toggle the auto fisher
F1::
toggle := !toggle
if (toggle) {
    ToolTip, Auto fisher ON
    SetTimer, Cast, 1500
} else {
    ToolTip
    SetTimer, Cast, Off
}
return

Cast:
Click, down
Sleep, %speed%
Click, up
Loop, 5
{
    PixelSearch, px, py, 100, 100, 400, 300, 0xFFFFFF, 10, Fast RGB
    if ErrorLevel = 0
        MouseClick, left, %px%, %py%
    Sleep 20
}
return

CheckShake:
PixelGetColor, color, 500, 500, RGB
if (color = 0x00FF00 && toggle)
    Send, {Enter}
return

#IfWinActive ahk_exe RobloxPlayerBeta.exe
^!e::Send, e{Space 2}
F2::ExitApp
q::w
