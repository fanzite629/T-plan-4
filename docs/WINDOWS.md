# Windows 免安装版使用指南

## 下载和启动

1. 到发布页的 **Assets** 选择 `TPlan-v4.1.0-Windows-x64-portable.zip`，约 368 MiB。[v4.1.0 发布页](https://github.com/fanzite629/T-plan-4/releases/tag/v4.1.0)
2. 在文件资源管理器中右键点击 ZIP，选择「全部解压缩」，解压到电脑本地目录。
3. 打开解压后的 `package-4.1`，双击 `T计划 v4.exe`。`app`、`runtime`、DLL 和 `licenses` 与 EXE 放在同一目录。也可以为 EXE 创建桌面快捷方式。

运行目标为 Windows 10/11 x64，要求 .NET Framework 4.8。固定版本 WebView2 已随包提供。

## 第一次使用

- 点击「新建任务」，填写要做的事。任务可分段计时，计时开始后可以打开置顶小窗。
- 导入课表前，在「课表 → 学期与节次」填写第 1 教学周的周一、总周数和每节课时间。拖入 Excel、Word、PDF、图片或 CSV，核对预览后再确认。截图和扫描 PDF 需要支持识图的模型。[课表导入指南](TIMETABLE.md)
- 需要 AI 功能时，在「设置 → AI 模型」填写自己的服务地址、API 密钥和模型，然后测试连接。任务、计时及课表的规则识别可以离线使用。
- 任务和课表保存在 `%LOCALAPPDATA%\TPlanV4\tplan.sqlite3`。换电脑时，可在「设置 → 数据」导出并导入 JSON，再填写模型密钥。升级前建议先导出备份。

## 运行遇到问题

**提示缺少 `app` 或 WebView2 启动失败。** 确认已完整解压，EXE 与 `app`、`runtime` 和 DLL 仍在同一目录。Windows 10 上，固定版 WebView2 还要求应用容器对运行时目录具有读取和执行权限。相关说明见 [Microsoft WebView2 分发文档](https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/distribution#the-fixed-version-runtime-distribution-mode)。

如果在 Windows 10 上确认缺少上述权限，可在 `package-4.1` 内打开 PowerShell，按 Microsoft 文档为 `runtime` 目录授予读取和执行权限，然后重新打开程序。

```powershell
icacls .\runtime /grant '*S-1-15-2-2:(OI)(CI)(RX)'
icacls .\runtime /grant '*S-1-15-2-1:(OI)(CI)(RX)'
```

**Windows 显示未知发布者。** 当前 EXE 未签名。可从本仓库的正式发布页取得压缩包并核对 SHA-256。若仍无法启动，请在问题反馈中附上 Windows 版本和报错文字。[提交问题](https://github.com/fanzite629/T-plan-4/issues/new)

**核对下载文件。** 在 ZIP 所在目录打开 PowerShell，运行以下命令，并将 `Hash` 与 Releases 里的 `.zip.sha256` 对照。

```powershell
Get-FileHash -Algorithm SHA256 -LiteralPath '.\TPlan-v4.1.0-Windows-x64-portable.zip'
```

本发布包包含 Microsoft Defender SmartScreen。它会按 Microsoft 隐私声明和 Edge 隐私白皮书所述收集并发送用户信息给 Microsoft。随包运行的 WebView2 固定运行时适用 `licenses/WebView2-Fixed-Runtime-LICENSE.html` 中的条款。[Microsoft 隐私声明](https://aka.ms/privacy) · [SmartScreen 说明](https://learn.microsoft.com/en-us/microsoft-edge/privacy-whitepaper#smartscreen) · [运行时许可](../desktop/vendor/WebView2-Fixed-Runtime-LICENSE.html)
