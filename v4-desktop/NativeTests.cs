using System;
using System.Collections.Generic;
using System.IO;
using System.Net;
using System.Net.Sockets;
using System.Text;
using System.Threading.Tasks;

static class NativeTests
{
    static void Check(bool ok, string message) { if (!ok) throw new Exception(message); Console.WriteLine("PASS " + message); }
    static int Main(string[] args) { try { Run(args[0]).GetAwaiter().GetResult(); return 0; } catch (Exception ex) { Console.WriteLine(ex); return 1; } }
    static async Task Run(string root)
    {
        Directory.CreateDirectory(root);
        string dbPath = Path.Combine(root, "native-test.sqlite3");
        using (var db = new Database(dbPath)) {
            db.Write("tplan.v4", "{\"title\":\"中文任务 ' quote\"}");
            db.WriteSecret("qa-unique-fake-secret");
            Check(db.ReadSecret() == "qa-unique-fake-secret", "DPAPI round trip");
            Check(!db.Read("secret").Contains("qa-unique-fake-secret"), "secret stored encrypted");
            bool refused = false; try { db.Write("tplan.v3", "bad"); } catch (ArgumentException) { refused = true; }
            Check(refused, "v3 key rejected");
        }
        using (var db = new Database(dbPath)) Check(db.Read("tplan.v4").Contains("中文任务 ' quote") && db.ReadSecret() == "qa-unique-fake-secret", "database and encrypted key survive reopening");
        using (var gateway = new HttpGateway()) {
            bool refused = false;
            try { await gateway.Send("bad", "file:///C:/x", "GET", null, null); } catch (InvalidOperationException) { refused = true; }
            Check(refused, "non HTTP endpoint rejected");
            refused = false;
            try { await gateway.Send("bad", "http://example.com/v1", "GET", null, null); } catch (InvalidOperationException) { refused = true; }
            Check(refused, "non-loopback cleartext endpoint rejected");
            var server = new TcpListener(IPAddress.Loopback, 0); server.Start();
            int port = ((IPEndPoint)server.LocalEndpoint).Port;
            var serve = Task.Run(async delegate {
                using (var client = await server.AcceptTcpClientAsync())
                using (var stream = client.GetStream()) {
                    var bytes = new List<byte>(); var buffer = new byte[1];
                    while (bytes.Count < 16000) {
                        int n = await stream.ReadAsync(buffer, 0, 1); if (n == 0) break; bytes.Add(buffer[0]);
                        if (bytes.Count > 3 && Encoding.ASCII.GetString(bytes.ToArray()).EndsWith("\r\n\r\n")) break;
                    }
                    string request = Encoding.ASCII.GetString(bytes.ToArray());
                    Check(request.Contains("Bearer fake-test-key"), "native HTTP forwards authorization");
                    byte[] response = Encoding.UTF8.GetBytes("HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: 22\r\nConnection: close\r\n\r\n{\"data\":[{\"id\":\"qa\"}]}");
                    await stream.WriteAsync(response, 0, response.Length);
                }
            });
            try {
                var result = await gateway.Send("ok", "http://127.0.0.1:" + port + "/models", "GET", new Dictionary<string, object> { { "Authorization", "Bearer fake-test-key" } }, null);
                await serve;
                Check((int)result["status"] == 200 && Convert.ToString(result["text"]).Contains("qa"), "native HTTP response returned");
            } finally { server.Stop(); }
        }
    }
}
