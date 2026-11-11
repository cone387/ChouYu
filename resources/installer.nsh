!include LogicLib.nsh

!ifndef BUILD_UNINSTALLER
Var ChouYuOriginalTemp
Var ChouYuOriginalTmp

!macro ChouYuRestoreInstallerEnvironment
  Push $0
  ${If} $ChouYuOriginalTemp == ""
    System::Call 'kernel32::SetEnvironmentVariableW(w "TEMP", p 0) i .r0'
  ${Else}
    System::Call 'kernel32::SetEnvironmentVariableW(w "TEMP", w "$ChouYuOriginalTemp") i .r0'
  ${EndIf}
  ${If} $ChouYuOriginalTmp == ""
    System::Call 'kernel32::SetEnvironmentVariableW(w "TMP", p 0) i .r0'
  ${Else}
    System::Call 'kernel32::SetEnvironmentVariableW(w "TMP", w "$ChouYuOriginalTmp") i .r0'
  ${EndIf}
  Pop $0
!macroend

!macro preInit
  !ifndef BUILD_UNINSTALLER
    Push $0
    Push $1
    ReadEnvStr $ChouYuOriginalTemp TEMP
    ReadEnvStr $ChouYuOriginalTmp TMP
    # The existing uninstaller moves files into its own TEMP/old-install.
    # Explicit extended-length paths work even with the legacy NSIS binary,
    # without changing Windows' LongPathsEnabled policy or the old install.
    StrCpy $0 "$TEMP"
    StrCpy $1 $0 4
    ${If} $1 != "\\?\"
      StrCpy $1 $0 2
      ${If} $1 == "\\"
        StrCpy $0 $0 "" 2
        StrCpy $0 "\\?\UNC\$0"
      ${Else}
        StrCpy $0 "\\?\$0"
      ${EndIf}
    ${EndIf}
    System::Call 'kernel32::SetEnvironmentVariableW(w "TEMP", w r0) i .r1'
    ${If} $1 != 0
      System::Call 'kernel32::SetEnvironmentVariableW(w "TMP", w r0) i .r1'
    ${EndIf}
    ${If} $1 == 0
      !insertmacro ChouYuRestoreInstallerEnvironment
      MessageBox MB_OK|MB_ICONSTOP "无法准备安装临时目录。请关闭安装程序后重试。" /SD IDOK
      SetErrorLevel 1
      Quit
    ${EndIf}
    Pop $1
    Pop $0
  !endif
!macroend

!macro customInstall
  # Do not pass installer-specific TEMP/TMP values to the launched application.
  !insertmacro ChouYuRestoreInstallerEnvironment
!macroend
!endif
