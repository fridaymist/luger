#Requires AutoHotkey v2.0
#SingleInstance Force
global running := false
cps := 12

myGui := Gui(, "Clicker")
myGui.Add("Text",, "Clicks per second")
myGui.Add("Slider", "vCps Range1-50", 12)
myGui.Add("Button", "w120", "Start").OnEvent("Click", StartClicking)
myGui.Show()

StartClicking(*) {
    global running
    running := !running
    while running {
        Click
        Sleep 1000 // cps
    }
}

F6:: {
    StartClicking()
}

F7:: {
    if PixelSearch(&fx, &fy, 0, 0, 200, 200, 0xFF0000, 5) {
        MouseMove fx, fy
        Send "{e down}"
        Sleep 200
        Send "{e up}"
    }
    Loop 3 {
        Send "Hello " . A_Index . "{Enter}"
    } Until A_Index >= 2
}
