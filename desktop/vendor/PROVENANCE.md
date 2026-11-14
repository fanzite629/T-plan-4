# Microsoft WebView2 构建输入来源

记录时间：2026-09-07 21:38（Asia/Shanghai）。本记录中的下载仅用于构建输入；未安装或修改系统 WebView2，未从已安装的 Evergreen 目录复制 Runtime。

## WebView2 SDK

- NuGet 包：`Microsoft.Web.WebView2` **1.0.4191.47**。
- 官方包来源：<https://www.nuget.org/api/v2/package/Microsoft.Web.WebView2/1.0.4191.47>。
- 本地包：`Microsoft.Web.WebView2.1.0.4191.47.nupkg`，9,259,926 字节。
- 包 SHA-256（已重新读取本地文件计算）：`F492BBF547D0DA329553B6727435B677579B1E9F91CC9E4A1AD029366D5F23D0`。
- 解包目录：`sdk/`；`sdk/Microsoft.Web.WebView2.nuspec` 已核对包名、版本及 Microsoft 作者字段。
- SDK 许可：[SDK-LICENSE.txt](SDK-LICENSE.txt)；附带通知：[SDK-NOTICE.txt](SDK-NOTICE.txt)。原件下载后位于 `sdk/LICENSE.txt` 和 `sdk/NOTICE.txt`。二进制分发需随材料保留其版权说明、许可条件和免责声明，不得暗示 Microsoft 背书。
- SDK 与 Fixed Runtime 是不同构建输入；本应用使用 SDK 的 .NET Framework Core/WinForms 程序集和 x64 `WebView2Loader.dll`，不能仅携带 Runtime CAB。

## Fixed Version Runtime

- 产品：Microsoft Edge WebView2 Runtime (Fixed Version)
- 版本：**152.0.4191.62**
- 架构：**x64**（已读取 `msedgewebview2.exe` 的 PE Machine：`0x8664`）
- 官方下载页面：<https://developer.microsoft.com/en-us/microsoft-edge/webview2/>
- 选择依据：下载页面响应内嵌的 Fixed Version 下载数据提供的 152 系列 x64 包；没有猜测 URL，也没有使用第三方镜像。本机系统 Evergreen 的 152.0.4191.66 不作为 Fixed Version 的版本依据。
- 直接下载 URL：<https://msedge.sf.dl.delivery.mp.microsoft.com/filestreamingservice/files/0a4a34d9-ccaa-4cef-98b4-58cb313fbfeb/Microsoft.WebView2.FixedVersionRuntime.152.0.4191.62.x64.cab>
- CAB 相对位置：`runtime/Microsoft.WebView2.FixedVersionRuntime.152.0.4191.62.x64.cab`
- CAB 大小：**371,877,369 字节**（约 354.65 MiB）
- CAB SHA-256（本地下载后计算，非上游另行发布的校验值）：`2DC7D817DDCE4D036F33684425C218F1CA2D073911136E5D3F8CE9B2340569B5`

使用 Windows `C:\Windows\System32\expand.exe` 解包，返回码为 0；保留完整目录结构，未删减 Runtime 文件。解包日志：`runtime/expand-152.0.4191.62-x64.log`。

```powershell
expand.exe "runtime\Microsoft.WebView2.FixedVersionRuntime.152.0.4191.62.x64.cab" -F:* "runtime"
```

真正的 Runtime 根目录：

```text
desktop/vendor/runtime/Microsoft.WebView2.FixedVersionRuntime.152.0.4191.62.x64
```

宿主的 `browserExecutableFolder` / `BrowserExecutableFolder` 必须指向含 `msedgewebview2.exe` 的上述目录。发布构建复制该目录中的全部文件，**不复制上一层 CAB 或解包日志**。

验证结果：

- 解包文件数：**548**；文件大小合计：**837,201,247 字节**（约 798.42 MiB）。
- `msedgewebview2.exe` 大小：4,824,392 字节。
- EXE FileVersion：`152.0.4191.62`。
- EXE SHA-256：`0F75BA7DA899408D4C4474D58358BDBEE732705FC090161CBF08E8783520572D`。
- Windows Authenticode：`Valid`；签名主体为 `CN=Microsoft Corporation, O=Microsoft Corporation, L=Redmond, S=Washington, C=US`。
- 本步骤不启动宿主或 Runtime；应用启动、实际内核选择、离线请求行为与干净电脑运行情况由后续打包验收验证。

## 官方许可

许可标题：**MICROSOFT SOFTWARE LICENSE TERMS — MICROSOFT EDGE WEBVIEW2 RUNTIME (FIXED VERSION)**。

- 原文副本：[WebView2-Fixed-Runtime-LICENSE.html](WebView2-Fixed-Runtime-LICENSE.html)
- 官方许可接口：<https://developer.microsoft.com/microsoft-edge/api/eula/webview2?fixed=true>
- 发现方式：官网下载页面的 `BlockWebView2` 下载控件在 `ensureEula` 中使用此接口；读取返回 JSON 的 `fixedHtml`，响应状态 200，语言 `en-us`。
- 页面控件脚本：<https://edgecdn-embza6g8cacagcbn.z01.azurefd.net/shared/edgeweb/_nuxt/CXzXwfXG.js>
- 保存的 HTML SHA-256：`13ABE52770BE9206CD86A6F4564C2923813D4FBAEF8913D6A8704E4EC5C51B03`。

以下为便于构建审查的条款索引，不能替代许可原文：第 2 节说明随应用分发对象代码的权利及要求，包括应用提供自身主要功能、下游条款保护、直接从 Microsoft 获取分发代码等条件；保留 Runtime 中原有第三方许可文件。第 4、8 节说明数据处理与 SmartScreen 默认开启情况：如果未禁用 SmartScreen，必须提供相应用户告知。应用的严格离线要求仍需由宿主配置和实际网络行为验收落实；下载并固定 Runtime 版本本身不等于已经验证所有网络请求为零。

Runtime 自带 `show_third_party_software_licenses.bat`、`Trust Protection Lists/Mu/LICENSE`、`Trust Protection Lists/Sigma/LICENSE`、`WidevineCdm/LICENSE`，均原样保留；未执行该批处理。

## 官方分发注意点

来源：<https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/distribution#the-fixed-version-runtime-distribution-mode>

- Fixed Version 随应用提供全部解包文件，并在 WebView2 初始化前指定其目录；不依赖已有系统 Evergreen 注册信息，不自行更新。后续 Runtime 更新须随应用重新发布。
- Windows 10 上，Fixed Version 120 及以上的未打包 Win32 应用，需给**实际部署的 Runtime 目录**增加以下两个应用容器组的读取和执行权限。普通 Inno Setup 安装的 WinForms 程序仍应按未打包 Win32 场景处理。本次未修改 ACL；由安装/启动步骤在最终目标目录实现并验证。

```powershell
icacls "<实际部署的 Fixed Runtime 目录>" /grant "*S-1-15-2-2:(OI)(CI)(RX)"
icacls "<实际部署的 Fixed Runtime 目录>" /grant "*S-1-15-2-1:(OI)(CI)(RX)"
```

- 上述特殊 ACL 要求不适用于 Windows 11；不要为此移除现有文件夹权限或给用户数据目录扩权。
- Fixed Version 不支持从网络位置/UNC 路径运行。
- 宿主仍需同时发布匹配 x64 的 `WebView2Loader.dll` 和所需 .NET WebView2 Core/WinForms 程序集；Runtime CAB 不替代 SDK。
- 下载/解包成功不能代替 Windows 10、Windows 11、目标 .NET Framework 条件和干净机器上的应用验收。
