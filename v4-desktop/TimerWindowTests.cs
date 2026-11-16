using System;
using System.Collections.Generic;
using System.Drawing;
using System.IO;
using System.Linq;
using System.Windows.Forms;

static class TimerWindowTests
{
    static int checks;
    static double Now() { return (DateTime.UtcNow - new DateTime(1970,1,1)).TotalMilliseconds; }
    static Dictionary<string,object> View(bool running, double ms, int step, int total)
    {
        return new Dictionary<string,object> { {"title","示例任务：阅读与练习（共 60 分钟）"}, {"step","示例步骤：阅读材料、完成练习并整理操作记录"}, {"index",step}, {"total",total}, {"running",running}, {"remainingMs",ms}, {"at",Now()} };
    }
    static Button Button(Form f, string name) { return f.Controls.OfType<Button>().Single(b => b.AccessibleName == name); }
    static void Check(bool ok, string name) { if(!ok) throw new Exception(name); Console.WriteLine("PASS " + name); checks++; }
    static bool Has(Form f, string text) { return f.Controls.OfType<Label>().Any(l=>l.Text==text); }
    [STAThread] static int Main(string[] args)
    {
        Application.EnableVisualStyles(); Application.SetCompatibleTextRenderingDefault(false);
        if (args.Length > 0 && args[0] == "--preview") { Preview(args[1]); return 0; }
        try {
            var commands = new List<string>(); int restored = 0;
            using(var f = new TimerWindow(commands.Add, delegate {restored++;})) {
                f.UpdateView(View(true, 2395000, 0, 5)); f.Show(); Application.DoEvents();
                Check(f.TopMost && !f.ShowInTaskbar && Has(f,"39:55"),"running card, pinned and readable countdown");
                var clock = f.Controls.OfType<Label>().Single(l=>l.Text=="39:55");
                using(var graphics=clock.CreateGraphics()) {
                    Size measured=TextRenderer.MeasureText(graphics,clock.Text,clock.Font);
                    Check(measured.Width<=clock.Width && measured.Height<=clock.Height,"countdown glyphs fit at actual monitor DPI");
                }
                Size fullSize=f.ClientSize;
                Button(f,"最小化为专注条").PerformClick(); Application.DoEvents();
                Check(f.Width<fullSize.Width && f.Height<fullSize.Height/3 && f.Controls.Cast<Control>().Count(c=>c.Visible)==3,"compact strip shows only clock, pause and expand");
                Check(commands.Count==0 && Has(f,"39:55"),"minimizing preserves running timer and sends no command");
                using(var graphics=clock.CreateGraphics()) {
                    Size measured=TextRenderer.MeasureText(graphics,clock.Text,clock.Font);
                    Check(measured.Width<=clock.Width && measured.Height<=clock.Height,"compact countdown fits at actual monitor DPI");
                }
                Button(f,"暂停").PerformClick(); Check(commands.Last()=="pause","compact pause routes to owner");
                f.UpdateView(View(false,2395000,0,5)); Application.DoEvents();
                System.Threading.Thread.Sleep(1100); Application.DoEvents();
                Check(Has(f,"39:55") && Has(f,"已暂停"),"paused display does not drift");
                Button(f,"继续").PerformClick(); Check(commands.Last()=="resume","compact resume routes to owner");
                Button(f,"展开计时卡片").PerformClick(); Application.DoEvents();
                Check(f.ClientSize==fullSize && Button(f,"下一段").Visible && Has(f,"39:55"),"expand restores complete card without resetting timer");
                Button(f,"+5 分钟").PerformClick(); Check(commands.Last()=="extend","extend routes to owner");
                Button(f,"下一段").PerformClick(); Check(commands.Last()=="next","next routes to owner");
                f.UpdateView(View(true,600000,4,5)); Application.DoEvents();
                Button(f,"完成").PerformClick(); Check(commands.Last()=="next","last step retains completion command");
                Button(f,"结束计时").PerformClick(); Check(commands.Last()=="stop","stop routes to owner");
                Button(f,"返回主界面").PerformClick(); Check(restored==1,"restore callback");
                int before=commands.Count; Button(f,"收起悬浮窗").PerformClick();
                Check(!f.Visible && commands.Count==before,"hide does not stop or mutate timer");
                f.Show(); f.UpdateView(View(false,-65000,0,1)); Application.DoEvents();
                Check(Has(f,"+01:05") && Has(f,"已超时 · 已暂停"),"paused overtime shown distinctly");
                var overdue=View(true,0,0,1); overdue["at"]=Now()-65000; f.UpdateView(overdue); Application.DoEvents();
                Check(Has(f,"已超时 · 可以收尾了"),"running overtime derives from owner timestamp");
                f.UpdateView(View(false, 1000 * 60 * 1000d, 999, 1000)); Application.DoEvents();
                Check(Has(f,"1000:00"),"long durations fit without wrapping");
                Check(f.Controls.OfType<Button>().Select(b=>b.TabIndex).Distinct().Count()==7,"all seven actions have independent keyboard stops");
                foreach(Control c in f.Controls) Check(f.ClientRectangle.Contains(c.Bounds),"native DPI layout contains "+c.GetType().Name);
                f.Scale(new SizeF(1.5f,1.5f)); f.UpdateView(View(false,2395000,0,5)); Application.DoEvents();
                foreach(Control c in f.Controls) Check(f.ClientRectangle.Contains(c.Bounds),"additional 150 percent layout simulation contains "+c.GetType().Name);
                f.Close(); Check(!f.Visible && commands.Count==before,"native close only hides card");
            }
            Console.WriteLine("PASS total="+checks); return 0;
        } catch(Exception e) {Console.WriteLine(e); return 1;}
    }
    static void Preview(string log)
    {
        var host=new Form {Text="悬浮窗验收 · 独立模拟数据",Size=new Size(430,270),StartPosition=FormStartPosition.CenterScreen};
        TimerWindow card=null; var view=View(true,2395000,0,5);
        var note=new Label {Text="模拟任务，不连接正式数据库。\n测试按钮会写入本地验收日志。",Dock=DockStyle.Top,Height=55};
        host.Controls.Add(note);
        Action update=delegate {view["at"]=Now(); card.UpdateView(view);};
        card=new TimerWindow(delegate(string cmd) {
            File.AppendAllText(log,cmd+Environment.NewLine);
            double left=Convert.ToDouble(view["remainingMs"])-(Convert.ToBoolean(view["running"])?Math.Max(0,Now()-Convert.ToDouble(view["at"])):0);
            view["remainingMs"]=left;
            if(cmd=="pause")view["running"]=false;
            if(cmd=="resume")view["running"]=true;
            if(cmd=="extend")view["remainingMs"]=left+300000;
            if(cmd=="next") {view["index"]=(Convert.ToInt32(view["index"])+1)%5; view["remainingMs"]=1500000;}
            if(cmd=="stop") {card.Hide(); return;}
            update();
        },delegate {File.AppendAllText(log,"restore"+Environment.NewLine);host.Activate();});
        card.ShowInTaskbar=true; // Expose only the test card to accessibility tooling.
        var open=new Button {Text="打开悬浮窗",Left=20,Top=70,Width=170};
        open.Click+=delegate {update();card.Show();card.Activate();};host.Controls.Add(open);
        var over=new Button {Text="显示超时",Left=210,Top=70,Width=170};
        over.Click+=delegate {view["remainingMs"]=-65000d;view["running"]=true;update();card.Show(); using(var g=card.CreateGraphics()) File.AppendAllText(log,"DPI="+g.DpiX+" Size="+card.ClientSize+" Auto="+card.AutoScaleDimensions+Environment.NewLine+string.Join(Environment.NewLine,card.Controls.Cast<Control>().Select(c=>c.GetType().Name+" bounds="+c.Bounds+" font="+c.Font.Size)));};host.Controls.Add(over);
        var scale=new Button {Text="150% 布局模拟",Left=20,Top=110,Width=170};
        scale.Click+=delegate {card.Scale(new SizeF(1.5f,1.5f));update();};host.Controls.Add(scale);
        host.Shown+=delegate {update();card.Location=new Point(host.Right+20,host.Top);card.Show(); using(var g=card.CreateGraphics()) File.AppendAllText(log,"DPI="+g.DpiX+" Size="+card.ClientSize+" Auto="+card.AutoScaleDimensions+Environment.NewLine+string.Join(Environment.NewLine,card.Controls.Cast<Control>().Select(c=>c.GetType().Name+" bounds="+c.Bounds+" font="+c.Font.Size)));};
        host.FormClosed+=delegate {card.Dispose();};Application.Run(host);
    }
}
