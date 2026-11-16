# Windows 免安装版使用指南

## 下载和启动

1. 到发布页的 **Assets** 选择 `TPlan-v4.2.0-Windows-x64-portable.zip`，约 368 MiB。[v4.2.0 发布页](https://github.com/fanzite629/T-plan-4/releases/tag/v4.2.0)
2. 在文件资源管理器中右键点击 ZIP，选择「全部解压缩」，解压到电脑本地目录。
3. 打开解压后的 `package-4.2`，双击 `T计划 v4.exe`。`app`、`runtime`、DLL 和 `licenses` 与 EXE 放在同一目录。也可以为 EXE 创建桌面快捷方式。

运行目标为 Windows 10/11 x64，要求 .NET Framework 4.8。固定版本 WebView2 已随包提供。

## 第一次使用

1. 首次打开先看到软件介绍：T计划把学习、项目和生活事项变成可执行的小任务，并结合课表记录专注时间。这是本机欢迎页，不需要注册账号。
2. 填写希望被称呼的名字（可留空），选择主要用途、专注时长、安排节奏、提醒方式和每日可投入时间；可跳过，也可随时在「设置 → 个人节奏」重新设置。[偏好设置说明](ONBOARDING.md)
3. 新任务未写时长时使用你的专注时长；长任务开始计时时按偏好分段。安排节奏会从每日额度中预留 10% / 20% / 35% 空闲；已有任务、课表、进行中的分段不会被偏好改写。
4. 导入课表前，在「课表 → 学期与节次」填写第 1 教学周的周一、总周数和每节课时间。拖入 DOCX、XLSX、PDF、图片或 CSV，核对预览后确认。截图和扫描 PDF 需要支持识图的模型。[课表导入指南](TIMETABLE.md)
5. 需要 AI 时，在「设置 → AI 模型」配置自己的服务地址、API 密钥和模型。基础任务、计时及课表规则识别无需配置 AI；模型服务可能收费，软件不附赠额度。

## 本次新增功能怎么用

- **重复任务**：按 N 打开快速添加，在「任务」中输入「每天晚上8点 阅读 20分钟」或「每周四 交实验报告 30分钟」，查看预览后点「添加」。自动排好未来 7 天；已开始的记录保留，未开始的过期次数在下一次到来时清掉。任务窗口可以修改规则或停止重复。
- **今天的空闲**：工作台显示 08:00–22:00 范围内课程和有时间任务之间至少 20 分钟的空档，点「排入」安排已有任务，或「+ 安排」新建任务。这是固定展示范围，不代表学校作息。
- **过期任务重排**：点击过期任务入口，查看按每日可安排额度给出的未来两周方案，再确认；已设置偏好时会先扣除预留空闲。
- **新版回看**：左侧「视图」组选择「回看」，切换本周、近 30 天或近 12 周，查看时长/完成图表、分区占比、任务排行及周统计。头像组点开后会散开显示入口，箭头可切回一列。
- **悬浮计时**：开始计时后打开置顶小窗；“—”收成仅含时间与暂停按钮的专注条，右侧按钮展开。拖动时间或空白处移动；返回按钮回主界面，“×”/Esc 仅收起小窗。关闭软件不会主动结束计时；不想累计关闭期间的时间时请先暂停。

## 从旧版升级与备份

1. 在旧版「设置 → 数据」导出 JSON 备份；如正在计时，更新后会按原计时起点继续，需要停下来时请自行暂停。
2. 关闭旧版，完整解压新 ZIP 到一个新文件夹，打开新的 `T计划 v4.exe`；不要只替换 EXE。把桌面快捷方式指向新 EXE。
3. 同一 Windows 用户下，课表、任务、偏好、计时及模型设置继续读取 `%LOCALAPPDATA%\TPlanV4\tplan.sqlite3`。首次使用页不会覆盖已有数据，也不会强制打断旧用户。
4. 程序包不含发布者的个人数据或密钥。换电脑需导入 JSON 并重新填写模型密钥；JSON 导出不包含密钥。浏览器与桌面数据不自动同步。

## 运行遇到问题

**提示缺少 `app` 或 WebView2 启动失败。** 确认已完整解压，EXE 与 `app`、`runtime` 和 DLL 仍在同一目录。Windows 10 上，固定版 WebView2 还要求应用容器对运行时目录具有读取和执行权限。相关说明见 [Microsoft WebView2 分发文档](https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/distribution#the-fixed-version-runtime-distribution-mode)。

如果在 Windows 10 上确认缺少上述权限，可在 `package-4.2` 内打开 PowerShell，按 Microsoft 文档为 `runtime` 目录授予读取和执行权限，然后重新打开程序。

```powershell
icacls .\runtime /grant '*S-1-15-2-2:(OI)(CI)(RX)'
icacls .\runtime /grant '*S-1-15-2-1:(OI)(CI)(RX)'
```

**Windows 显示未知发布者。** 当前 EXE 未签名。可从本仓库的正式发布页取得压缩包并核对 SHA-256。若仍无法启动，请在问题反馈中附上 Windows 版本和报错文字。[提交问题](https://github.com/fanzite629/T-plan-4/issues/new)

**核对下载文件。** 在 ZIP 所在目录打开 PowerShell，运行以下命令，并将 `Hash` 与 Releases 里的 `.zip.sha256` 对照。

```powershell
Get-FileHash -Algorithm SHA256 -LiteralPath '.\TPlan-v4.2.0-Windows-x64-portable.zip'
```

本发布包包含 Microsoft Defender SmartScreen。它会按 Microsoft 隐私声明和 Edge 隐私白皮书所述收集并发送用户信息给 Microsoft。随包运行的 WebView2 固定运行时适用 `licenses/WebView2-Fixed-Runtime-LICENSE.html` 中的条款。[Microsoft 隐私声明](https://aka.ms/privacy) · [SmartScreen 说明](https://learn.microsoft.com/en-us/microsoft-edge/privacy-whitepaper#smartscreen) · [运行时许可](../desktop/vendor/WebView2-Fixed-Runtime-LICENSE.html)
