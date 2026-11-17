using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Runtime.InteropServices;
using System.Windows.Forms;

// The main window owns timer state; this card only displays it and sends commands.
internal sealed class TimerWindow : Form
{
    const int CardWidth = 300, CardHeight = 252;
    // Match the light theme tokens in v4/styles.css.
    static readonly Color Paper = Color.White, Ink = Color.FromArgb(23, 24, 28);
    static readonly Color TextColor = Color.FromArgb(36, 38, 43), Muted = Color.FromArgb(107, 111, 122);
    static readonly Color Soft = Color.FromArgb(236, 238, 243), Line = Color.FromArgb(228, 230, 236);
    static readonly Color Accent = Color.FromArgb(232, 130, 90), Ok = Color.FromArgb(47, 143, 99);
    readonly Label title = new Label(), step = new Label(), time = new Label();
    readonly Label brand = new Label(), status = new Label(), segment = new Label(), caption = new Label();
    readonly CardButton pause = new CardButton { Outlined = true }, next = new CardButton { Primary = true }, compactToggle = new CardButton();
    readonly Timer ticker = new Timer();
    readonly ToolTip tips = new ToolTip { InitialDelay = 450, AutoPopDelay = 15000, ShowAlways = true };
    readonly Action<string> command;
    bool running, roundedBySystem, compact;
    Dictionary<Control, Rectangle> expandedBounds;
    Size expandedSize;
    int index, total = 1;
    double remaining, received;
    [DllImport("user32.dll")] static extern bool ReleaseCapture();
    [DllImport("user32.dll")] static extern IntPtr SendMessage(IntPtr hwnd, int message, IntPtr wParam, IntPtr lParam);
    [DllImport("dwmapi.dll")] static extern int DwmSetWindowAttribute(IntPtr hwnd, int attribute, ref int value, int size);
    static double Now() { return (DateTime.UtcNow - new DateTime(1970, 1, 1)).TotalMilliseconds; }

    internal TimerWindow(Action<string> send, Action restore)
    {
        SuspendLayout(); command = send;
        Text = "T计划 v4 · 悬浮计时"; TopMost = true; ShowInTaskbar = false;

        FormBorderStyle = FormBorderStyle.None; StartPosition = FormStartPosition.Manual;
        ClientSize = new Size(CardWidth, CardHeight); BackColor = Paper; ForeColor = Ink;
        Font = new Font("Microsoft YaHei UI", 9); DoubleBuffered = true; KeyPreview = true;
        SetupLabel(brand, "T 计划", 46, 11, 65, 24, 9.5f, FontStyle.Bold);
        SetupLabel(status, "专注中", 128, 11, 60, 24, 8.5f, FontStyle.Regular);
        SetupLabel(title, "", 16, 44, 268, 36, 10.5f, FontStyle.Bold);
        title.TextAlign = ContentAlignment.TopLeft;
        SetupLabel(segment, "", 16, 80, 66, 22, 8.5f, FontStyle.Bold); segment.ForeColor = Muted;
        SetupLabel(step, "", 85, 80, 199, 22, 9, FontStyle.Regular); step.ForeColor = Muted;
        SetupLabel(time, "00:00", 16, 102, 268, 64, 32, FontStyle.Bold);
        time.Font.Dispose(); time.Font = new Font("Segoe UI", 32, FontStyle.Bold);
        time.TextAlign = ContentAlignment.MiddleCenter;
        SetupLabel(caption, "剩余时间", 16, 166, 268, 18, 8.5f, FontStyle.Regular);
        caption.ForeColor = Muted; caption.TextAlign = ContentAlignment.MiddleCenter;
        ConfigureButton(pause, "暂停", "pause", 16, 198, 102, 32, 0);
        pause.Click += delegate { command(running ? "pause" : "resume"); };
        ConfigureButton(next, "下一段", "next", 124, 198, 78, 32, 1);
        next.Click += delegate { command("next"); };
        var extend = new CardButton { Quiet = true };
        ConfigureButton(extend, "+5 分钟", "", 208, 198, 76, 32, 2);
        extend.Click += delegate { command("extend"); };
        tips.SetToolTip(extend, "给当前这一段增加 5 分钟");
        var stop = new CardButton { Quiet = true };
        ConfigureButton(stop, "结束计时", "", 100, 232, 100, 18, 3);
        stop.Click += delegate { command("stop"); };
        var back = new CardButton();
        ConfigureButton(compactToggle, "", "minimize", 198, 9, 28, 28, 4);
        compactToggle.AccessibleName = "最小化为专注条";
        compactToggle.Click += delegate { ToggleCompact(); };
        tips.SetToolTip(compactToggle, "最小化为专注条");
        ConfigureButton(back, "", "back", 230, 9, 28, 28, 5); back.AccessibleName = "返回主界面";
        back.Click += delegate { restore(); }; tips.SetToolTip(back, "返回主界面");
        var close = new CardButton { Quiet = true };
        ConfigureButton(close, "", "close", 262, 9, 28, 28, 6); close.AccessibleName = "收起悬浮窗";
        close.Click += delegate { Hide(); }; tips.SetToolTip(close, "收起悬浮窗，计时继续（Esc）");
        Controls.AddRange(new Control[] { brand, status, title, segment, step, time, caption, pause, next, extend, stop, compactToggle, back, close });
        foreach (var label in new[] { brand, status, title, segment, step, time, caption }) label.MouseDown += DragCard;
        MouseDown += DragCard; tips.SetToolTip(brand, "拖动空白处可移动悬浮窗");
        KeyDown += delegate(object s, KeyEventArgs e) { if (e.KeyCode == Keys.Escape) { Hide(); e.Handled = true; e.SuppressKeyPress = true; } };
        FormClosing += delegate(object s, FormClosingEventArgs e) { if (e.CloseReason == CloseReason.UserClosing) { e.Cancel = true; Hide(); } };
        ticker.Interval = 250; ticker.Tick += delegate { if (Visible) RefreshClock(); }; ticker.Start();
        VisibleChanged += delegate { if (Visible) RefreshClock(); };
        AutoScaleDimensions = new SizeF(96, 96); AutoScaleMode = AutoScaleMode.Dpi; ResumeLayout(false);
    }
    void ToggleCompact()
    {
        SuspendLayout();
        if (!compact) {
            expandedSize = ClientSize; expandedBounds = new Dictionary<Control, Rectangle>();
            foreach (Control control in Controls) expandedBounds.Add(control, control.Bounds);
            compact = true;
            float scale = expandedSize.Width / (float)CardWidth;
            foreach (Control control in Controls) control.Visible = control == time || control == pause || control == compactToggle;
            ClientSize = new Size((int)(232 * scale), (int)(64 * scale));
            time.SetBounds((int)(22 * scale), (int)(9 * scale), (int)(115 * scale), (int)(46 * scale));
            pause.SetBounds((int)(144 * scale), (int)(14 * scale), (int)(36 * scale), (int)(36 * scale));
            compactToggle.SetBounds((int)(186 * scale), (int)(14 * scale), (int)(36 * scale), (int)(36 * scale));
        } else {
            compact = false; ClientSize = expandedSize;
            foreach (Control control in Controls) { control.Bounds = expandedBounds[control]; control.Visible = true; }
        }
        pause.Text = compact ? "" : running ? "暂停" : "继续";
        compactToggle.Glyph = compact ? "expand" : "minimize";
        compactToggle.AccessibleName = compact ? "展开计时卡片" : "最小化为专注条";
        tips.SetToolTip(compactToggle, compactToggle.AccessibleName);
        // Keep the expanded controls reachable even when the strip was dragged to an edge.
        Rectangle work = Screen.FromControl(this).WorkingArea;
        Location = new Point(Math.Max(work.Left, Math.Min(Left, work.Right - Width)), Math.Max(work.Top, Math.Min(Top, work.Bottom - Height)));
        ResumeLayout(false); RefreshClock(); Invalidate(true);
    }
    void SetupLabel(Label label, string text, int x, int y, int width, int height, float size, FontStyle style)
    {
        label.Text = text; label.SetBounds(x, y, width, height); label.AutoSize = false;
        label.AutoEllipsis = true; label.UseMnemonic = false; label.Font = new Font("Microsoft YaHei UI", size, style);
        label.TextAlign = ContentAlignment.MiddleLeft; label.BackColor = Paper; label.ForeColor = TextColor;
    }
    static void ConfigureButton(CardButton button, string text, string glyph, int x, int y, int width, int height, int tabIndex)
    {
        button.Text = text; button.Glyph = glyph; button.SetBounds(x, y, width, height);
        button.TabIndex = tabIndex; button.AccessibleName = text; button.Cursor = Cursors.Hand;
    }
    void DragCard(object sender, MouseEventArgs e)
    {
        if (e.Button != MouseButtons.Left) return;
        ReleaseCapture(); SendMessage(Handle, 0xA1, new IntPtr(2), IntPtr.Zero);
    }
    protected override void OnHandleCreated(EventArgs e)
    {
        base.OnHandleCreated(e);
        try {
            int preference = 2; // Windows 11 smooth corners; rounded region on Windows 10.
            roundedBySystem = DwmSetWindowAttribute(Handle, 33, ref preference, 4) == 0;
        } catch (DllNotFoundException) { } catch (EntryPointNotFoundException) { }
        UpdateCorners();
    }
    protected override void OnSizeChanged(EventArgs e) { base.OnSizeChanged(e); UpdateCorners(); Invalidate(); }
    void UpdateCorners()
    {
        if (!IsHandleCreated || roundedBySystem) return;
        using (var shape = Rounded(new RectangleF(0, 0, Width, Height), 18 * Width / (compact ? 232f : CardWidth))) {
            Region old = Region; Region = new Region(shape); if (old != null) old.Dispose();
        }
    }
    internal static GraphicsPath Rounded(RectangleF box, float radius)
    {
        var path = new GraphicsPath(); float d = Math.Min(radius * 2, Math.Min(box.Width, box.Height));
        path.AddArc(box.X, box.Y, d, d, 180, 90); path.AddArc(box.Right - d, box.Y, d, d, 270, 90);
        path.AddArc(box.Right - d, box.Bottom - d, d, d, 0, 90); path.AddArc(box.X, box.Bottom - d, d, d, 90, 90);
        path.CloseFigure(); return path;
    }
    protected override void OnPaint(PaintEventArgs e)
    {
        base.OnPaint(e); var g = e.Graphics; g.SmoothingMode = SmoothingMode.AntiAlias;
        float scale = ClientSize.Width / (compact ? 232f : CardWidth); g.ScaleTransform(scale, scale);
        using (var outline = Rounded(new RectangleF(.5f, .5f, compact ? 231 : CardWidth - 1, compact ? 63 : CardHeight - 1), roundedBySystem ? 8 : 18))
        using (var pen = new Pen(Ink, 1.5f)) g.DrawPath(pen, outline);
        if (compact) {
            using (var dot = new SolidBrush(running ? Ok : Muted)) g.FillEllipse(dot, 12, 30, 4, 4);
            return;
        }
        using (var logo = Rounded(new RectangleF(16, 12, 22, 22), 7))
        using (var brush = new SolidBrush(Accent)) g.FillPath(brush, logo);
        using (var font = new Font("Segoe UI", 11, FontStyle.Bold, GraphicsUnit.Pixel))
        using (var brush = new SolidBrush(Color.White))
        using (var format = new StringFormat { Alignment = StringAlignment.Center, LineAlignment = StringAlignment.Center })
            g.DrawString("T", font, brush, new RectangleF(16, 12, 22, 22), format);
        using (var dot = new SolidBrush(running ? Ok : Muted)) g.FillEllipse(dot, 118, 21, 5, 5);
        // Segment progress, not a time percentage. Exact count remains in the label.
        int count = Math.Min(total, 16); float gap = 4, width = (268 - gap * (count - 1)) / count;
        for (int n = 0; n < count; n++) {
            float position = index * count / (float)total;
            Color color = n < Math.Floor(position) ? Ok : n == (int)position ? Ink : Soft;
            using (var shape = Rounded(new RectangleF(16 + n * (width + gap), 189, width, 3), 1.5f))
            using (var brush = new SolidBrush(color)) g.FillPath(brush, shape);
        }
    }
    internal void UpdateView(Dictionary<string, object> view)
    {
        string newTitle = Convert.ToString(view["title"]), newStep = Convert.ToString(view["step"]);
        if (title.Text != newTitle) { title.Text = newTitle; tips.SetToolTip(title, newTitle); }
        if (step.Text != newStep) { step.Text = newStep; tips.SetToolTip(step, newStep); }
        total = Math.Max(1, Convert.ToInt32(view["total"]));
        index = Math.Max(0, Math.Min(total - 1, Convert.ToInt32(view["index"])));
        segment.Text = "第 " + (index + 1) + " / " + total + " 段"; tips.SetToolTip(segment, segment.Text);
        running = Convert.ToBoolean(view["running"]);
        remaining = Convert.ToDouble(view["remainingMs"]); received = Convert.ToDouble(view["at"]);
        pause.Text = compact ? "" : running ? "暂停" : "继续"; pause.AccessibleName = running ? "暂停" : "继续"; pause.Glyph = running ? "pause" : "play";
        tips.SetToolTip(pause, pause.AccessibleName);
        tips.SetToolTip(time, newTitle + "\n" + segment.Text + " · " + newStep);
        next.Text = index + 1 == total ? "完成" : "下一段"; next.AccessibleName = next.Text;
        RefreshClock(); Invalidate();
    }
    void RefreshClock()
    {
        double value = remaining - (running ? Math.Max(0, Now() - received) : 0);
        long seconds = (long)Math.Ceiling(Math.Abs(value) / 1000);
        string text = (value < 0 ? "+" : "") + (seconds / 60).ToString("00") + ":" + (seconds % 60).ToString("00");
        if (time.Text != text) time.Text = text;
        {
            float size = compact ? (text.Length > 7 ? 17 : text.Length > 6 ? 20 : 24) : text.Length > 7 ? 25 : text.Length > 6 ? 29 : 32;
            // Point fonts already scale with the display DPI; multiplying again clips digits.
            if (Math.Abs(time.Font.Size - size) > .1f) {
                Font old = time.Font; time.Font = new Font("Segoe UI", size, FontStyle.Bold); old.Dispose();
            }
        }
        time.ForeColor = value < 0 ? Accent : running ? TextColor : Color.FromArgb(154, 158, 170);
        caption.Text = value < 0 ? (running ? "已超时 · 可以收尾了" : "已超时 · 已暂停") : running ? "剩余时间" : "已暂停 · 按继续回来";
        status.Text = running ? "专注中" : "已暂停"; status.ForeColor = running ? Ok : Muted;
    }
    internal void SelfTestPause() { if (!compact) compactToggle.PerformClick(); pause.PerformClick(); }
    protected override void Dispose(bool disposing) { if (disposing) { ticker.Dispose(); tips.Dispose(); } base.Dispose(disposing); }

    // A real Button retains keyboard activation and accessibility.
    sealed class CardButton : Button
    {
        internal bool Primary, Quiet, Outlined;
        string glyph; bool hover, pressed;
        internal string Glyph { get { return glyph; } set { glyph = value; Invalidate(); } }
        internal CardButton()
        {
            SetStyle(ControlStyles.UserPaint | ControlStyles.AllPaintingInWmPaint | ControlStyles.OptimizedDoubleBuffer | ControlStyles.ResizeRedraw, true);
            FlatStyle = FlatStyle.Flat; FlatAppearance.BorderSize = 0; UseVisualStyleBackColor = false; BackColor = Paper;
        }
        protected override void OnMouseEnter(EventArgs e) { hover = true; Invalidate(); base.OnMouseEnter(e); }
        protected override void OnMouseLeave(EventArgs e) { hover = pressed = false; Invalidate(); base.OnMouseLeave(e); }
        protected override void OnMouseDown(MouseEventArgs e) { pressed = e.Button == MouseButtons.Left; Invalidate(); base.OnMouseDown(e); }
        protected override void OnMouseUp(MouseEventArgs e) { pressed = false; Invalidate(); base.OnMouseUp(e); }
        protected override void OnPaint(PaintEventArgs e)
        {
            var g = e.Graphics; g.Clear(Paper); g.SmoothingMode = SmoothingMode.AntiAlias; float scale = g.DpiX / 96f;
            Color fill = Primary ? pressed ? Color.FromArgb(10, 11, 14) : hover ? Color.FromArgb(53, 54, 61) : Ink
                : pressed ? Line : hover ? Soft : Quiet || Outlined ? Paper : Soft;
            Color color = Primary ? Color.White : Quiet ? Muted : Ink;
            using (var path = Rounded(new RectangleF(scale, scale, Width - 2 * scale, Height - 2 * scale), Height / 2f))
            using (var brush = new SolidBrush(fill)) g.FillPath(brush, path);
            if (Outlined) {
                using (var path = Rounded(new RectangleF(scale, scale, Width - 2 * scale, Height - 2 * scale), Height / 2f))
                using (var pen = new Pen(Ink, 1.5f * scale)) g.DrawPath(pen, path);
            }
            int icon = string.IsNullOrEmpty(glyph) ? 0 : (int)(14 * scale), gap = icon > 0 && Text.Length > 0 ? (int)(6 * scale) : 0;
            int tw = Text.Length == 0 ? 0 : TextRenderer.MeasureText(g, Text, Font, Size.Empty, TextFormatFlags.NoPadding).Width;
            int x = (Width - tw - icon - gap) / 2;
            if (icon > 0) {
                var saved = g.Save(); g.TranslateTransform(x, (Height - icon) / 2f); g.ScaleTransform(icon / 14f, icon / 14f);
                using (var pen = new Pen(color, 1.5f) { StartCap = LineCap.Round, EndCap = LineCap.Round, LineJoin = LineJoin.Round })
                using (var brush = new SolidBrush(color)) {
                    if (glyph == "pause") { g.FillRectangle(brush, 3, 2, 2.5f, 10); g.FillRectangle(brush, 8.5f, 2, 2.5f, 10); }
                    if (glyph == "play" || glyph == "next") g.FillPolygon(brush, new[] { new PointF(3, 2), new PointF(10, 7), new PointF(3, 12) });
                    if (glyph == "next") g.DrawLine(pen, 12, 2, 12, 12);
                    if (glyph == "close") { g.DrawLine(pen, 3, 3, 11, 11); g.DrawLine(pen, 3, 11, 11, 3); }
                    if (glyph == "minimize") g.DrawLine(pen, 3, 7, 11, 7);
                    if (glyph == "expand") { g.DrawLines(pen, new[] { new Point(8, 2), new Point(12, 2), new Point(12, 6) }); g.DrawLine(pen, 12, 2, 8, 6); g.DrawLines(pen, new[] { new Point(6, 12), new Point(2, 12), new Point(2, 8) }); g.DrawLine(pen, 2, 12, 6, 8); }
                    if (glyph == "back") { g.DrawLines(pen, new[] { new Point(9, 2), new Point(2, 2), new Point(2, 9) }); g.DrawLine(pen, 2, 2, 11, 11); g.DrawLines(pen, new[] { new Point(6, 12), new Point(12, 12), new Point(12, 6) }); }
                }
                g.Restore(saved);
            }
            if (tw > 0) TextRenderer.DrawText(g, Text, Font, new Rectangle(x + icon + gap, 0, tw + 1, Height), color, TextFormatFlags.VerticalCenter | TextFormatFlags.SingleLine | TextFormatFlags.NoPadding);
            if (Focused && ShowFocusCues) {
                using (var path = Rounded(new RectangleF(2, 2, Width - 5, Height - 5), 10 * scale))
                using (var pen = new Pen(Accent, 1.5f * scale)) g.DrawPath(pen, path);
            }
        }
    }
}
