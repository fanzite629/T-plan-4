using System;
using System.Collections.Generic;
using System.Drawing;
using System.IO;
using System.Reflection;
using System.Web.Script.Serialization;
using System.Windows.Forms;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

internal sealed class MainWindow : Form
{
    const string Origin = "https://tplan-v4.local";
    readonly WebView2 web = new WebView2();
    readonly Database database;
    readonly string root, qa;
    readonly HttpGateway gateway = new HttpGateway();
    readonly JavaScriptSerializer json = new JavaScriptSerializer { MaxJsonLength = 16000000 };
    readonly Timer watchdog = new Timer();
    TimerWindow mini;
    Dictionary<string, object> snapshot;
    bool closing;
    bool qaMiniPassed;
    internal MainWindow(string dataRoot, Database db, string testRoot)
    {
        root = dataRoot; database = db; qa = testRoot;
        Text = qa == null ? "T计划 v4" : "T计划 v4 · 自动验收（独立测试数据）";
        Size = new Size(1280, 860); MinimumSize = new Size(860, 600); StartPosition = FormStartPosition.CenterScreen;
        using (var stream = Assembly.GetExecutingAssembly().GetManifestResourceStream("icon")) Icon = new Icon(stream);
        web.Dock = DockStyle.Fill; Controls.Add(web); Shown += Initialize;
        FormClosing += delegate { closing = true; watchdog.Stop(); gateway.Dispose(); if (mini != null) { mini.Dispose(); mini = null; } };
        FormClosed += delegate { watchdog.Dispose(); web.Dispose(); };
        watchdog.Interval = 45000;
        watchdog.Tick += delegate { Fail(new TimeoutException("页面自检超时")); };
    }
    static bool IsApp(string url) { Uri uri; return Uri.TryCreate(url, UriKind.Absolute, out uri) && uri.GetLeftPart(UriPartial.Authority) == Origin && uri.AbsolutePath == "/index.html"; }
    async void Initialize(object sender, EventArgs args)
    {
        try {
            string directory = AppDomain.CurrentDomain.BaseDirectory;
            if (!File.Exists(Path.Combine(directory, "app", "index.html"))) throw new IOException("缺少 app 文件夹，请完整解压软件压缩包。");
            var env = await CoreWebView2Environment.CreateAsync(Path.Combine(directory, "runtime"), Path.Combine(root, "Profile"), new CoreWebView2EnvironmentOptions { Language = "zh-CN" });
            if (closing) return;
            await web.EnsureCoreWebView2Async(env);
            if (closing) return;
            var core = web.CoreWebView2;
            core.Settings.AreHostObjectsAllowed = true;
            core.Settings.IsWebMessageEnabled = true;
            core.Settings.IsPasswordAutosaveEnabled = false;
            core.Settings.IsGeneralAutofillEnabled = false;
            core.Settings.AreDevToolsEnabled = qa != null;
            core.AddHostObjectToScript("database", database);
            core.SetVirtualHostNameToFolderMapping("tplan-v4.local", Path.Combine(directory, "app"), CoreWebView2HostResourceAccessKind.DenyCors);
            core.NavigationStarting += delegate(object s, CoreWebView2NavigationStartingEventArgs e) { if (!IsApp(e.Uri)) e.Cancel = true; };
            core.FrameNavigationStarting += delegate(object s, CoreWebView2NavigationStartingEventArgs e) { e.Cancel = true; };
            core.NewWindowRequested += delegate(object s, CoreWebView2NewWindowRequestedEventArgs e) { e.Handled = true; };
            core.PermissionRequested += delegate(object s, CoreWebView2PermissionRequestedEventArgs e) { e.State = CoreWebView2PermissionState.Deny; };
            core.DownloadStarting += delegate(object s, CoreWebView2DownloadStartingEventArgs e) {
                using (var dialog = new SaveFileDialog { FileName = Path.GetFileName(e.ResultFilePath), Filter = "JSON 数据备份|*.json|所有文件|*.*" }) {
                    if (dialog.ShowDialog(this) == DialogResult.OK) e.ResultFilePath = dialog.FileName; else e.Cancel = true;
                    e.Handled = true;
                }
            };
            core.WebMessageReceived += OnMessage;
            core.ProcessFailed += delegate { Fail(new IOException("页面进程异常退出，请重新打开软件。")); };
            core.NavigationCompleted += async delegate(object s, CoreWebView2NavigationCompletedEventArgs e) {
                if (!e.IsSuccess) { Fail(new IOException("页面加载失败：" + e.WebErrorStatus)); return; }
                if (qa != null && !closing) {
                    using (var reader = new StreamReader(Assembly.GetExecutingAssembly().GetManifestResourceStream("qa-timetable"))) await core.ExecuteScriptAsync(reader.ReadToEnd());
                    using (var reader = new StreamReader(Assembly.GetExecutingAssembly().GetManifestResourceStream("qa"))) await core.ExecuteScriptAsync(reader.ReadToEnd());
                }
            };
            if (qa != null) watchdog.Start();
            core.Navigate(Origin + "/index.html");
        } catch (Exception ex) { Fail(ex); }
    }
    void Fail(Exception ex)
    {
        if (closing) return;
        if (qa != null) { File.WriteAllText(Path.Combine(qa, "failure.txt"), ex.ToString()); Environment.ExitCode = 1; }
        else MessageBox.Show(this, ex.Message, "T计划 v4");
        Close();
    }
    void Reply(object value) { if (!closing && web.CoreWebView2 != null) web.CoreWebView2.PostWebMessageAsJson(json.Serialize(value)); }
    static string Value(Dictionary<string, object> data, string key) { object value; return data.TryGetValue(key, out value) ? Convert.ToString(value) : ""; }
    async void OnMessage(object sender, CoreWebView2WebMessageReceivedEventArgs e)
    {
        if (closing || !IsApp(e.Source)) return;
        Dictionary<string, object> data;
        try { data = json.Deserialize<Dictionary<string, object>>(e.WebMessageAsJson); } catch { return; }
        if (data == null) return;
        string kind = Value(data, "kind"), id = Value(data, "id");
        if (kind == "http-request" || kind == "http-cancel") {
            if (id.Length == 0 || id.Length > 100) return;
            if (kind == "http-cancel") { gateway.Cancel(id); return; }
            try {
                object headers; data.TryGetValue("headers", out headers);
                Reply(await gateway.Send(id, Value(data, "url"), Value(data, "method"), headers as Dictionary<string, object>, Value(data, "body")));
            } catch (Exception ex) { Reply(new { kind = "http-response", id = id, error = ex is InvalidOperationException ? ex.Message : "请求失败，请检查设置后重试。" }); }
        } else if (kind == "timer-state") {
            object raw; data.TryGetValue("view", out raw); snapshot = raw as Dictionary<string, object>;
            if (mini != null) { if (snapshot == null) mini.Hide(); else mini.UpdateView(snapshot); }
        } else if (kind == "timer-open") {
            if (snapshot == null) return;
            if (mini == null) {
                mini = new TimerWindow(command => Reply(new { kind = "timer-command", command = command }), delegate { Show(); WindowState = FormWindowState.Normal; Activate(); });
                mini.Icon = Icon;
                Rectangle screen = Screen.FromControl(this).WorkingArea;
                mini.Location = new Point(screen.Right - mini.Width - 20, screen.Top + 60);
            }
            mini.UpdateView(snapshot); mini.Show(); mini.Activate();
        } else if (kind == "qa-check-mini" && qa != null) {
            qaMiniPassed = mini != null && mini.Visible && mini.TopMost && snapshot != null;
            if (qaMiniPassed) mini.SelfTestPause();
        } else if (kind == "qa-result" && qa != null) {
            object success; data.TryGetValue("ok", out success);
            data["nativeMiniPassed"] = qaMiniPassed;
            data["miniHiddenAfterFinish"] = mini != null && !mini.Visible;
            bool passed = Object.Equals(success, true) && qaMiniPassed && mini != null && !mini.Visible;
            data["ok"] = passed;
            File.WriteAllText(Path.Combine(qa, "result.json"), json.Serialize(data));
            Environment.ExitCode = passed ? 0 : 1;
            Close();
        }
    }
}
