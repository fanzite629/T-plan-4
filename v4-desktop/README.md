# T计划 v4.2 Windows 免安装版

完整步骤见 [开发与构建](../docs/DEVELOPMENT.md)，仓库整理后的实测结果见 [验证记录](../docs/VALIDATION.md)。

WinForms + .NET Framework 4.8 + WebView2，Windows x64。界面直接打包 `../v4`，不启动 HTTP 服务器，不修改 v3。

构建：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\tools\Get-WebView2.ps1
.\v4-desktop\build.ps1 -VendorRoot '你的 WebView2 vendor 目录' -Zip
```

依赖获取脚本默认写入 `desktop/vendor`；使用默认位置时，构建命令可以省略 `-VendorRoot`。两个命令均从仓库根目录执行。

依赖的固定版本及来源见 `../desktop/vendor/PROVENANCE.md`。构建使用系统 Framework64 C# 编译器，输出 `package-4.2/`（可用 `-OutputDirectory` 指定新目录），发布 ZIP 位于 `release/`。ZIP 不包含个人数据。用户使用说明随包提供。

- 数据：`%LOCALAPPDATA%\TPlanV4\tplan.sqlite3`，使用独立 `tplan.v4` 键；API 密钥按服务商保存在 DPAPI 加密值中。
- 网页：WebView2 虚拟主机映射到 `app/`；只允许主界面导航。原生 HTTP 仅接受 HTTPS 或回环地址 HTTP，不跟随重定向，不记录密钥。
- 计时：原生置顶圆角卡片，与前端状态同步；点击顶部“—”可缩为仅显示时间、暂停/继续与展开按钮的专注条。主窗口关闭时退出。详见[悬浮计时窗使用说明](../docs/FLOATING_TIMER.md)。
- 附件：继续使用网页的本机文件解析，按任意路径自动读取不开放。
- 首次使用：欢迎页设置称呼、用途、专注时长、安排节奏与提醒；已有用户从工作台入口或「设置 → 我的节奏」进入。详见[偏好如何生效](../docs/ONBOARDING.md)。保存不改变现有课表、任务、计时与悬浮窗。
- 无外部 AI 调用的自检：`T计划 v4.exe --self-test 一个尚不存在的测试目录`。写入独立测试数据，运行后自动退出，查看 `result.json` 或 `failure.txt`。
- 课表：`../v4/js/timetable.js` 负责规则与日期展开，`timetable-ui.js` 负责导入预览和周视图，`files.js` 保留 Office 单元格结构并将 PDF 页面渲染给识图模型。沿用当前配置的模型，不引入第二套凭据。
- 数据格式升级为 version 2，兼容读取旧 v4 数据；首次正常保存后，旧 v4.0 会拒绝打开新版数据以防覆盖。升级前应备份数据库或导出 JSON。
- 核心测试：`npm test`。桌面自检也覆盖欢迎页与偏好持久化、原生提醒分发、真实 deflate DOCX/XLSX、PDF 渲染、CSV 拖放导入、图片模型桥接（模拟响应）以及重新加载。

实现依据：[Microsoft 本地内容映射文档](https://learn.microsoft.com/en-us/dotnet/api/microsoft.web.webview2.core.corewebview2.setvirtualhostnametofoldermapping)、[运行时分发文档](https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/distribution)。固定运行时、DLL、第三方许可必须完整随包保留。Windows 10 应用容器读取权限需求见官方分发文档；构建和启动不自动更改 ACL。
