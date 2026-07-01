; LibraryView 自定义 NSIS 脚本
; 目的：升级 / 重装时保留安装目录下的 config.json（书库路径、数据目录、阅读器等设置），
; 避免每次更新后设置被清空。数据库与封面在数据目录（安装目录之外），本就不受影响。

; 卸载/升级前替换默认的文件删除逻辑：先把 config.json 备份到临时目录，再删除安装目录。
!macro customRemoveFiles
  IfFileExists "$INSTDIR\config.json" 0 +2
    CopyFiles /SILENT "$INSTDIR\config.json" "$TEMP\LibraryView.config.bak"
  RMDir /r "$INSTDIR"
!macroend

; 安装完成后：若存在备份（来自升级前的卸载步骤），恢复 config.json。
!macro customInstall
  IfFileExists "$TEMP\LibraryView.config.bak" 0 +3
    CopyFiles /SILENT "$TEMP\LibraryView.config.bak" "$INSTDIR\config.json"
    Delete "$TEMP\LibraryView.config.bak"
!macroend
