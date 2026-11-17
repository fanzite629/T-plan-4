# 首次使用与偏好设置验收（2026-11-16）

首次桌面验收基于 `04870255667418028b951512b0719213cb76cdd9`，叠加悬浮窗与偏好功能。本文记录该阶段的验证；正式发布的验证以对应版本发布说明为准。

## PASS

- `npm test`：69 项通过，包含偏好校验、跳过、数据保留、分段总时长、默认任务分钟、三种提醒策略、容量与模型请求上下文。
- Windows `--self-test`：72 条通过记录，去除多次重新加载的重复项后为 60 项检查。覆盖全新欢迎页、保存失败、跳过、重启持久化、自定义 37 分钟任务、昵称与用途、取消、已有暂停计时保留，以及原有任务/课表/附件/悬浮窗回归。
- 原生提醒分发：安静模式不发送，到时模式只发送一次，开始与结束模式在任务开始时发送。测试模式只计数，不播放测试声音。
- 实际 WebView2 截图检查：宽屏双栏与高缩放小窗口；小窗口可滚动，保存按钮保持可见。
- 包内 573 个文件通过 SHA-256 清单校验；15 个页面资源与当前源码逐一一致。
- `TimerWindow.cs` 与本次修改前完全相同，SHA-256 为 `529106B017727384D20726CAEB25A4FDB33F4F45C5F184E319630C4E7FA111D7`；原生悬浮窗暂停、下一段、加时及关闭回归通过。
- 桌面快捷方式已指向 `v4-desktop/package-onboarding-20261116/T计划 v4.exe`，正常启动并响应。
- 数据保留检查在本机进行，原有状态与模型密钥保持完整。具体记录、数量、日程和密钥均不随源码或发布包上传。

## 证据

- `v4-desktop/qa-output/onboarding-unit.txt`
- `v4-desktop/qa-output/onboarding-native-20261116-152724/result.json`
- 同目录 `onboarding-desktop.png`、`onboarding-first-use.png`
- `v4-desktop/qa-output/onboarding-package-verification.json`
- `v4-desktop/qa-output/onboarding-deployment.json`
- `v4-desktop/qa-output/onboarding-data-verification.json`

正式数据和桌面快捷方式备份仅保存在本机 `%LOCALAPPDATA%\TPlanV4\backups`。本机数据、备份、构建物和原始验收输出由 `.gitignore` 排除，不作为发布附件。

## 验证边界

- 模型请求采用模拟响应验证偏好确实进入请求；未调用用户付费模型，未评价真实模型的规划质量。
- 原生通知发送已验证，Windows 通知中心、免打扰下的横幅展示和实际扬声器播放未人工验收。
- 未做全新电脑安装、手机端或所有 Windows 版本兼容性测试。
- 段间休息为建议，不自动开始休息计时；现有任务和课表不会按新偏好批量重排。
