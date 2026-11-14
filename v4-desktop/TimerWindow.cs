using System;
using System.Collections.Generic;
using System.Drawing;
using System.Windows.Forms;

internal sealed class TimerWindow : Form
{
    readonly Label title = new Label(), step = new Label(), time = new Label();
    readonly Button pause = new Button(), next = new Button();
    readonly Timer ticker = new Timer();
    readonly Action<string> command;
    bool running;
    double remaining, received;
    static double Now() { return (DateTime.UtcNow - new DateTime(1970, 1, 1)).TotalMilliseconds; }
    internal TimerWindow(Action<string> send, Action restore)
    {
        command = send;
        Text = "T计划 v4 · 悬浮计时"; TopMost = true; ShowInTaskbar = false;
        FormBorderStyle = FormBorderStyle.FixedToolWindow;
        StartPosition = FormStartPosition.Manual;
        ClientSize = new Size(360, 235); BackColor = Color.FromArgb(250, 250, 247);
        Font = new Font("Microsoft YaHei UI", 9);
        title.SetBounds(16, 12, 328, 24); title.AutoEllipsis = true;
        step.SetBounds(16, 38, 328, 24); step.AutoEllipsis = true;
        time.SetBounds(16, 68, 328, 66); time.Font = new Font("Consolas", 34, FontStyle.Bold); time.TextAlign = ContentAlignment.MiddleCenter;
        pause.SetBounds(16, 145, 100, 34); pause.Click += delegate { command(running ? "pause" : "resume"); };
        next.SetBounds(128, 145, 100, 34); next.Click += delegate { command("next"); };
        var extend = new Button { Text = "+5 分钟" }; extend.SetBounds(240, 145, 104, 34); extend.Click += delegate { command("extend"); };
        var back = new Button { Text = "返回主界面" }; back.SetBounds(16, 190, 156, 30); back.Click += delegate { restore(); };
        var stop = new Button { Text = "结束计时" }; stop.SetBounds(188, 190, 156, 30); stop.Click += delegate { command("stop"); };
        Controls.AddRange(new Control[] { title, step, time, pause, next, extend, back, stop });
        FormClosing += delegate(object s, FormClosingEventArgs e) { if (e.CloseReason == CloseReason.UserClosing) { e.Cancel = true; Hide(); } };
        ticker.Interval = 250; ticker.Tick += delegate { RefreshClock(); }; ticker.Start();
    }
    internal void UpdateView(Dictionary<string, object> view)
    {
        title.Text = Convert.ToString(view["title"]);
        step.Text = "第 " + (Convert.ToInt32(view["index"]) + 1) + "/" + view["total"] + " 段 · " + view["step"];
        running = Convert.ToBoolean(view["running"]);
        remaining = Convert.ToDouble(view["remainingMs"]); received = Convert.ToDouble(view["at"]);
        pause.Text = running ? "暂停" : "继续";
        next.Text = Convert.ToInt32(view["index"]) + 1 == Convert.ToInt32(view["total"]) ? "完成" : "下一段";
        RefreshClock();
    }
    void RefreshClock()
    {
        double value = remaining - (running ? Math.Max(0, Now() - received) : 0);
        long seconds = (long)Math.Ceiling(Math.Abs(value) / 1000);
        time.Text = (value < 0 ? "+" : "") + (seconds / 60).ToString("00") + ":" + (seconds % 60).ToString("00");
        time.ForeColor = value < 0 ? Color.FromArgb(180, 72, 38) : Color.FromArgb(36, 44, 37);
    }
    internal void SelfTestPause() { pause.PerformClick(); }
    protected override void Dispose(bool disposing) { if (disposing) ticker.Dispose(); base.Dispose(disposing); }
}
