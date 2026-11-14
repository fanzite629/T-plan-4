# 第三方组件与许可

## PDF.js

- 版本：3.11.174。
- 用途：本机 PDF 文字提取与课表页面图像渲染。
- 仓库文件：`v4/vendor/pdfjs/pdf.min.js`、`pdf.worker.min.js`。
- 许可：[Apache License 2.0 原文](v4/vendor/pdfjs/LICENSE)。分发时应保留该文件及组件版权信息。
- 上游：[mozilla/pdf.js](https://github.com/mozilla/pdf.js)。

## Microsoft WebView2

- SDK：`Microsoft.Web.WebView2` 1.0.4191.47。
- Fixed Version Runtime：152.0.4191.62 x64。
- 二进制不提交到源码仓库；构建时从记录的官方来源获取或使用已有的完整依赖目录。
- SDK 许可和通知在下载后位于 `desktop/vendor/sdk/LICENSE.txt` 与 `NOTICE.txt`。
- 便于获取依赖前阅读的副本：[SDK LICENSE](desktop/vendor/SDK-LICENSE.txt)、[SDK NOTICE](desktop/vendor/SDK-NOTICE.txt)。
- Fixed Runtime 许可原文：[本地副本](desktop/vendor/WebView2-Fixed-Runtime-LICENSE.html)。
- 来源、历史校验值和分发说明：[PROVENANCE.md](desktop/vendor/PROVENANCE.md)。

构建脚本会复制 SDK 许可和 Fixed Runtime 许可到发布目录，保留运行时目录内附带的第三方许可。不要删减运行时文件或把本项目表述为 Microsoft 官方产品。

## 大学生工作台（功能设计参考）

`references/workstation-student/` 收录 @赛博老爸的大学生工作台 v1.1。原作者署名与许可随项目保留。原许可允许个人学习和免费分享，商业使用须取得作者书面授权。[上游仓库](https://github.com/cyberdaddyleo/workstation-student) · [原许可](references/workstation-student/LICENSE) · [参考说明](references/WORKSTATION_STUDENT.md)

## 操作系统组件

桌面宿主使用 Windows 的 .NET Framework、DPAPI 和 `winsqlite3.dll`。这些系统组件不作为项目源码复制或再实现。

## 项目自有代码

本次源码整理不新增 MIT、Apache-2.0 等项目级授权。项目自有代码的许可由权利人另行决定；第三方组件不会因本仓库公开而改变许可条件。
