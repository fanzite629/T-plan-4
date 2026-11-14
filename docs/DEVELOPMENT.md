# 开发与构建

所有命令从仓库根目录执行。网页源码没有 npm 运行依赖；根目录的 `package.json` 仅提供测试命令，不是旧版项目的 LogicFlow 构建配置。

## 环境

| 用途 | 环境 |
| --- | --- |
| 网页运行 | Chrome / Edge；直接打开 `v4/index.html` 或使用静态服务器 |
| 规则和桥接测试 | Node.js 20 或更新版本；不需要 `npm install` |
| Windows 构建 | Windows x64、.NET Framework 4.8、Windows PowerShell 5.1 |
| 编译器 | `%WINDIR%\Microsoft.NET\Framework64\v4.0.30319\csc.exe` |
| WebView2 SDK | 1.0.4191.47，使用 `net462` 程序集和 x64 Loader |
| Fixed Runtime | 152.0.4191.62 x64，完整目录随程序分发 |

本项目使用系统 C# 编译器直接编译，不要求安装 Visual Studio，也没有 `.csproj` 或 `dotnet build` 流程。最终使用者运行免安装版不需要 Node.js。

## 获取固定构建依赖

先阅读 [第三方许可](../THIRD_PARTY_NOTICES.md) 和 [依赖来源](../desktop/vendor/PROVENANCE.md)，再运行：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\tools\Get-WebView2.ps1
```

脚本从固定的官方 URL 下载 SDK NUPKG 和 Runtime CAB，核对记录的 SHA-256 后解包；已有完整目录时复用，并检查 SDK 版本与运行时主程序校验值。它不会静默选择最新版本，也不会自动安装系统 Evergreen Runtime。下载内容约 381 MB，解包后需要更多磁盘空间。

```text
desktop/vendor/
  sdk/
    lib/net462/Microsoft.Web.WebView2.Core.dll
    lib/net462/Microsoft.Web.WebView2.WinForms.dll
    runtimes/win-x64/native/WebView2Loader.dll
    LICENSE.txt
    NOTICE.txt
  runtime/
    Microsoft.WebView2.FixedVersionRuntime.152.0.4191.62.x64/
      msedgewebview2.exe
      ...完整运行时文件...
```

如果官方历史下载链接失效，保留报错并依据来源文档准备同版本文件；不要绕过哈希检查或混用 SDK/Runtime 目录。升级运行时需要同步修改下载脚本、构建脚本、来源记录并重新验证。

## 编译和打包

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\v4-desktop\build.ps1 -Zip
```

已有依赖目录时：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\v4-desktop\build.ps1 `
  -VendorRoot 'D:\BuildDependencies\WebView2' `
  -OutputDirectory '.\v4-desktop\package-local' -Zip
```

输出包含 EXE、SDK DLL、`app/` 页面、`runtime/` 完整运行时、`licenses/`、使用说明及 `SHA256SUMS.txt`。`-Zip` 额外生成 `v4-desktop/release/` 下的 ZIP 和 ZIP 自身 SHA-256 文件。默认解压顶层目录为 `package-4.1/`。

构建脚本会复制到指定输出目录；发布构建应使用新目录，避免旧输出中的残留文件进入压缩包。不要把输出目录设为源码根目录。构建不会清理或修改个人数据目录。

## 自动化验证

### JavaScript

```powershell
npm test
```

覆盖任务与计时规则、规划协议、课表日期展开、导入预览、去重/冲突、旧状态兼容和桌面消息桥接。

### C# 原生

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\v4-desktop\test-native.ps1
# 可追加 -VendorRoot '已有的依赖目录'
```

测试在新建的 `v4-desktop/qa-output/native-*/` 目录编译与写入合成数据，验证 SQLite、DPAPI 和本机 HTTP；不调用外部模型，不读取用户个人数据库。

### WebView2 实际界面

构建后在 PowerShell 中运行：

```powershell
$testDir = Join-Path (Get-Location) ('v4-desktop\qa-output\ui-' + (Get-Date -Format 'yyyyMMdd-HHmmss-fff'))
$exe = Join-Path (Get-Location) 'v4-desktop\package-4.1\T计划 v4.exe'
$process = Start-Process -FilePath $exe -ArgumentList @('--self-test', ('"' + $testDir + '"')) -PassThru -Wait
Get-Content -LiteralPath (Join-Path $testDir 'result.json')
```

测试目录必须尚不存在。自检使用独立 SQLite、浏览器配置和假密钥，完成后退出；成功结果应为 `ok: true`。失败时检查 `failure.txt`、进程退出码或缺失的 `result.json`。程序内含约 45 秒看门狗。

自检覆盖原生计时小窗、页面重载、合成 Office/PDF/CSV 导入和图片模型桥接；图像模型使用模拟响应，不能据此声称真实识别准确率。

## 数据和发布注意事项

- 当前正常运行数据：`%LOCALAPPDATA%\TPlanV4\`；测试必须使用独立目录。
- 不提交 `.env`、API 密钥、SQLite、浏览器 Profile、导出备份或个人附件。
- `sdk/`、`runtime/`、下载缓存、打包目录和 ZIP 已加入 `.gitignore`。
- 固定运行时不会自动更新；安全更新需要随应用重新发布。
- Windows 10 的 Fixed Runtime 权限要求见原始来源文档。构建和启动不自动修改系统 ACL。
- 当前未提供商业代码签名，也未完成全新 Windows 10/11 机器验证。
