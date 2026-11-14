# T-plan v4 · T计划

一个以对话为入口的个人规划工具：把学习、项目和生活事项拆成可以开始执行的小任务，通过分段计时记录实际投入，并将课表作为规划时的已占用时间。

本仓库收录 **v4 系列当前的 v4.1.0 源码**，包含浏览器页面、Windows x64 免安装桌面程序、课表导入、自动化测试和构建资源。桌面窗口名称仍为「T计划 v4」。

## 下载 Windows 免安装版

**[下载 T计划 v4.1.0 Windows x64 ZIP](https://github.com/fanzite629/T-plan-4/releases/download/v4.1.0/TPlan-v4.1.0-Windows-x64-portable.zip)** · [发布说明与 SHA-256](https://github.com/fanzite629/T-plan-4/releases/tag/v4.1.0)

1. 下载 `TPlan-v4.1.0-Windows-x64-portable.zip`，右键选择「全部解压缩」到本机文件夹。
2. 打开解压后的 `package-4.1` 文件夹，双击 `T计划 v4.exe`。请保留同目录的 `app`、`runtime`、DLL 和许可文件。
3. 首次打开即可新建任务和开始计时。导入课表时，先在「课表 → 学期与节次」保存学校作息，再拖入文件并核对预览。配置 AI 模型后可使用对话规划和模型识别。

适用于 Windows 10/11 x64，要求 .NET Framework 4.8。ZIP 已包含 WebView2 运行组件，解压后即可启动。详细设置和常见问题见 [Windows 免安装版使用指南](docs/WINDOWS.md)。

## 功能

| 功能 | 当前实现 |
| --- | --- |
| 对话规划 | 支持任务、目标、习惯提议；确认后才写入安排，写入和删除可撤销；等待回答时可停止 |
| 分段计时 | 暂停、继续、加时、下一段、完成；Windows 原生置顶计时小窗 |
| 课表 | 学期与节次设置、周视图、当天课程、单双周、分段周次和指定日期；有开始时间的任务一并显示 |
| 考试与截止 | 记录考试、报名和作业截止日期，任务栏顶部显示倒计时和下一节课 |
| 复习卡片 | 一问一答，按 1、2、4、7、15、30 天间隔复习；可手动添加或由助手根据材料出题 |
| 课程分区 | 为课表里的课程建分区，任务、考试日期、卡片和对话按课程放在一起 |
| 提醒 | 上课和有开始时间的任务提前提醒（程序需开着；系统通知取决于浏览器或系统是否允许） |
| 课表导入 | 拖入 PDF、图片、DOCX、XLSX、CSV；本地规则或已配置的模型识别；预览、修改后确认 |
| 导入管理 | 缺失字段提示、重复跳过、时间冲突检查、课程编辑、单次取消、撤销最近导入 |
| 模型接入 | DeepSeek、OpenAI、Anthropic、豆包、Kimi 预设；可配置兼容接口地址和模型 |
| 文件与回看 | 聊天附件解析、图片输入、可核对的回看记录、可查看和删除的记忆 |
| 本地数据 | 浏览器 localStorage；Windows SQLite 存储；JSON 导入导出 |

没有配置模型时，基础任务管理、计时和课表规则模式仍可使用。聊天的本地模式只能按输入行创建任务并等分时长，不具有模型推理能力。

## 快速运行网页

```powershell
git clone https://github.com/fanzite629/T-plan-4.git
cd T-plan-4
Start-Process .\v4\index.html
```

使用 Chrome 或 Edge 打开页面，无需前端编译或 `npm install`。若浏览器对本地文件、PDF worker 或模型跨域请求有限制，可以用本地静态服务器预览；桌面版通过原生 HTTP 请求连接模型。

```powershell
# 可选：已有 Python 时，在仓库根目录启动静态预览
python -m http.server 8080 --bind 127.0.0.1
# 浏览器打开 http://127.0.0.1:8080/v4/
```

## 从源码构建 Windows 版

运行目标为 Windows 10/11 x64 和 .NET Framework 4.8。构建结果包含固定版本 WebView2；使用者无需安装 Node.js、Python 或启动服务器。

需要自行编译时，在仓库根目录执行以下命令。

```powershell
# 第一次构建：阅读第三方许可后，从固定的官方地址获取依赖
powershell -NoProfile -ExecutionPolicy Bypass -File .\tools\Get-WebView2.ps1

# 编译、复制完整运行时，并生成 ZIP 与校验清单
powershell -NoProfile -ExecutionPolicy Bypass -File .\v4-desktop\build.ps1 -Zip
```

默认运行入口为 `v4-desktop/package-4.1/T计划 v4.exe`；ZIP 位于 `v4-desktop/release/`。须保留同目录中的 `app/`、`runtime/`、DLL 和许可证文件。免安装指程序文件无需安装，个人数据仍保存在当前 Windows 用户目录。

固定依赖较大，下载需要网络。已有完整 WebView2 构建依赖时，可通过 `-VendorRoot '你的依赖目录'` 重用。具体步骤和校验要求见 [开发与构建](docs/DEVELOPMENT.md)。

## 使用课表

1. 打开左侧「课表」，在「学期与节次」保存第 1 教学周的周一、总周数和学校每节课的上课时间。
2. 拖入文件，选择「规则优先」「仅规则」或「已配置模型」。
3. 核对课程名称、星期、周次、节次或具体钟点；处理缺项与冲突，再点击确认导入。

学校时间只需设置一次，后续按节次的课程自动套用。课表不会猜测未提供的作息或节假日；图片与扫描 PDF 需要支持图像输入的模型。详细格式、限制和示例见 [课表导入指南](docs/TIMETABLE.md)。

## 数据与模型配置

- 浏览器版数据位于当前浏览器来源的 localStorage，状态键为 `tplan.v4`；浏览器模式下 API 密钥也是本地存储，不具备桌面 DPAPI 加密。
- Windows 数据位于 `%LOCALAPPDATA%\TPlanV4\tplan.sqlite3`。服务商密钥由当前 Windows 用户的 DPAPI 加密，JSON 数据导出不包含密钥。
- 浏览器与桌面、不同网页来源之间的数据不会自动同步。迁移时使用「设置 → 数据」导出和导入，换电脑后重新填写模型密钥。
- 模型功能会把相关对话、规划上下文以及所选附件内容发送到配置的服务。仅规则课表识别在本机执行，不包含 OCR。
- v4.1 数据格式为 version 2，可读取旧 v4 数据；升级保存后，旧 v4.0 会拒绝读取较新格式。升级前先导出备份。

## 源码结构

```text
v4/                    网页入口、样式、JavaScript、规则测试、PDF.js
v4-desktop/            C# 桌面程序、构建、自检和平台桥接测试
desktop/               桌面构建共用的 manifest、.config 与依赖来源记录
v3-desktop/            v4 仍使用的图标源文件及转换脚本（仅资源）
tools/                 固定版本 WebView2 依赖获取脚本
docs/                  架构、构建、课表和验证文档
references/            第三方功能设计参考资料
```

`desktop/` 与 `v3-desktop/` 只保留 v4 构建实际引用的资源，不需要另行克隆旧版本。

## 测试

安装 Node.js 20 或更新版本后，在仓库根目录运行；无 npm 依赖需要安装：

```powershell
npm test
# 等价命令
node --test v4/core.test.cjs v4/timetable.test.cjs v4-desktop/platform.test.cjs
```

C# 原生测试与 WebView2 界面自检见 [开发与构建](docs/DEVELOPMENT.md)。检查结果和未验证范围见 [验证记录](docs/VALIDATION.md)。

## 文档

- [开发与构建](docs/DEVELOPMENT.md)
- [Windows 免安装版使用指南](docs/WINDOWS.md)
- [模块与数据流](docs/ARCHITECTURE.md)
- [课表导入指南](docs/TIMETABLE.md)
- [验证记录](docs/VALIDATION.md)
- [版本变更](CHANGELOG.md)
- [第三方组件与许可](THIRD_PARTY_NOTICES.md)
- [Windows 使用说明](v4-desktop/使用说明.txt)

## 功能设计参考

「大学生工作台」由 @赛博老爸开发。这里收录原项目的页面、文档和截图，供 T计划 的课表、学科资料、专注计时等功能设计参考。[参考项目使用说明](references/WORKSTATION_STUDENT.md)

## 当前限制

复杂合并单元格、一格多门课、特殊 PDF 字体和视觉识别结果仍需人工核对。旧 `.doc` / `.xls` 文件需先转换为 `.docx` / `.xlsx`。尚未完成全新 Windows 10/11 机器的兼容性验收；真实模型的识别准确率不由模拟测试保证。

本仓库未为项目自有代码另行声明开源许可证；公开源码不等于已经授予任意再分发许可。第三方组件适用各自许可，原文随对应组件保留。
