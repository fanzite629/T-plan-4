# T计划 v4.2.0 · Windows x64 免安装版

发布于 2026-11-16。桌面窗口和快捷方式名称仍为「T计划 v4」。

## 下载与使用

下载 [TPlan-v4.2.0-Windows-x64-portable.zip](https://github.com/fanzite629/T-plan-4/releases/download/v4.2.0/TPlan-v4.2.0-Windows-x64-portable.zip)（约 368 MiB），完整解压后打开 `package-4.2/T计划 v4.exe`。保留同目录的 app、runtime、DLL 和 licenses。无需安装 Node.js、Python 或另开服务器。

- [Windows 使用、升级和模型设置指南](https://github.com/fanzite629/T-plan-4/blob/main/docs/WINDOWS.md)
- [首次使用与偏好设置](https://github.com/fanzite629/T-plan-4/blob/main/docs/ONBOARDING.md)
- [悬浮窗操作说明](https://github.com/fanzite629/T-plan-4/blob/main/docs/FLOATING_TIMER.md)

## 本次更新

- 首次使用页面介绍软件、填写称呼并选择用途、专注时长、安排节奏和提醒，可跳过。旧用户从设置进入，已有数据不会被欢迎页覆盖。
- 偏好实际生效：新任务与重复任务的默认时长、长任务分段、每日可安排额度和模型上下文都会采用选择；已有任务、课表和计时分段保留。安静、仅结束、开始与结束三种提醒可选。
- 紧凑悬浮窗采用主界面配色，可最小化成专注条，暂停、继续、下一段和加时与主界面同步。
- 合并 `e569f3f` 所包含的重复任务、空闲时间、新版回看及侧栏头像组更新。快速添加支持任务、课程、考试和记账；过期任务先预览再重排。
- 重复任务例子：「每周四 交实验报告 30分钟」「每天晚上8点 阅读 20分钟」。按 N 打开快速添加，在预览中确认后保存。

## 旧版升级

先在「设置 → 数据」导出备份，关闭旧版，把新包解压到新文件夹并更新桌面快捷方式。同一 Windows 用户继续使用 `%LOCALAPPDATA%\TPlanV4\tplan.sqlite3`；原有课表、任务、偏好、模型设置与计时保留。运行中计时按原起点恢复，不想累计退出期间的时间请先暂停。

程序包和源码不含发布者的个人课表、任务、收支、聊天记录、数据库、备份或模型密钥。每个人自行配置模型；JSON 导出也不包含密钥，换电脑后需要重新填写。

## 验证记录

- **PASS**：76 项 Node 核心、偏好、课表、桌面桥接测试。
- **PASS**：48 项 WinForms 悬浮窗检查，覆盖紧凑模式、计时同步及高 DPI 布局。
- **PASS**：WebView2 原生桌面自检 78 条通过记录（66 项独立检查）；覆盖首次使用保存、跳过、重启、偏好默认时长、重复任务、空闲时间线、新版回看切换、统一记账、课表导入及浮窗同步。
- **PASS**：573 个包内文件按 SHA-256 清单核对，15 个网页资源与构建源码一致；ZIP 解压内容逐项核对。
- **PASS**：本机更新后原有课表、任务、计时及模型密钥保持完整。仅新增兼容字段（空的重复规则列表、侧栏分组默认值）；相关数据和原始验收输出只保存在本机。
- **PASS**：待发布源码及本地提交、发布包检查；排除数据库、用户目录、备份、测试输出，并在本机比对真实密钥及个人记录标识，未发现包含。
- **NOT RUN**：全新 Windows 10/11 机器兼容性、真实付费模型效果、系统通知横幅、实际扬声器播放及手机端。模型流程使用模拟响应，原生通知测试只检查分发。

Windows 10/11 x64，.NET Framework 4.8。固定 WebView2 随包提供；EXE 当前未签名。运行时许可及第三方说明随包保留。

## ZIP 校验

```text
627b3c4cbcc12a08c1038961853546e03efa357b92610fa1a4c08f1d72f79d40  TPlan-v4.2.0-Windows-x64-portable.zip
```

在 ZIP 所在目录执行 `Get-FileHash -Algorithm SHA256 -LiteralPath '.\TPlan-v4.2.0-Windows-x64-portable.zip'`，与上面或附件 `.sha256` 对照。包内另附 `SHA256SUMS.txt`。
