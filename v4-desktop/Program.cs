using System;
using System.IO;
using System.Reflection;
using System.Security.Cryptography;
using System.Text;
using System.Windows.Forms;

[assembly: AssemblyTitle("T计划 v4")]
[assembly: AssemblyDescription("T计划 v4 Windows 免安装版")]
[assembly: AssemblyVersion("4.2.0.0")]
[assembly: AssemblyFileVersion("4.2.0.0")]

static class Program
{
    [STAThread] static void Main(string[] args)
    {
        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);
        string qa = null;
        try {
            string root = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "TPlanV4");
            if (args.Length == 2 && args[0] == "--self-test") {
                qa = Path.GetFullPath(args[1]);
                if (Directory.Exists(qa)) throw new IOException("测试目录必须是尚不存在的新目录。");
                root = qa;
            }
            Directory.CreateDirectory(root);
            string hash;
            using (var sha = SHA256.Create()) hash = BitConverter.ToString(sha.ComputeHash(Encoding.UTF8.GetBytes(Path.GetFullPath(root).ToUpperInvariant())));
            bool first;
            using (var mutex = new System.Threading.Mutex(true, "Local\\TPlanV4-" + hash, out first)) {
                if (!first) { MessageBox.Show("T计划 v4 已经打开，请从任务栏切换到软件。", "T计划 v4"); return; }
                using (var db = new Database(Path.Combine(root, "tplan.sqlite3")))
                    Application.Run(new MainWindow(root, db, qa));
            }
        } catch (Exception ex) {
            if (qa != null && Directory.Exists(qa)) File.WriteAllText(Path.Combine(qa, "failure.txt"), ex.ToString());
            else MessageBox.Show("T计划 v4 无法启动：\n" + ex.Message, "T计划 v4");
            Environment.ExitCode = 1;
        }
    }
}
