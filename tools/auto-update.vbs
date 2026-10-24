' Pull the latest GenClip from GitHub silently (no console window).
' Run by the Windows scheduled task "GenClip Auto Update" (created by setup-team.bat).
' GenClip folder = parent of the "tools" folder that contains this script.
Set fso = CreateObject("Scripting.FileSystemObject")
dir = fso.GetParentFolderName(fso.GetParentFolderName(WScript.ScriptFullName))
CreateObject("WScript.Shell").Run "git -C """ & dir & """ pull --ff-only --quiet", 0, True
