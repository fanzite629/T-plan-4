using System;
using System.Collections.Generic;
using System.IO;
using System.Net;
using System.Net.Http;
using System.Text;
using System.Threading;
using System.Threading.Tasks;

public sealed class HttpGateway : IDisposable
{
    const int Limit = 12 * 1024 * 1024;
    readonly HttpClient client;
    readonly Dictionary<string, CancellationTokenSource> active = new Dictionary<string, CancellationTokenSource>();
    bool disposed;
    public HttpGateway()
    {
        ServicePointManager.SecurityProtocol |= SecurityProtocolType.Tls12;
        client = new HttpClient(new HttpClientHandler { AllowAutoRedirect = false, UseCookies = false, AutomaticDecompression = DecompressionMethods.GZip | DecompressionMethods.Deflate });
        client.Timeout = TimeSpan.FromSeconds(85);
        client.MaxResponseContentBufferSize = Limit;
    }
    public async Task<Dictionary<string, object>> Send(string id, string url, string method, Dictionary<string, object> headers, string body)
    {
        Uri uri;
        if (!Uri.TryCreate(url, UriKind.Absolute, out uri) || !String.IsNullOrEmpty(uri.UserInfo) || !(uri.Scheme == "https" || (uri.Scheme == "http" && uri.IsLoopback)))
            throw new InvalidOperationException("接口地址须为 HTTPS；本机模型可使用 localhost 的 HTTP 地址。");
        if (method != "GET" && method != "POST") throw new InvalidOperationException("不支持的请求方法。");
        if (body != null && Encoding.UTF8.GetByteCount(body) > Limit) throw new InvalidOperationException("请求内容过大，请减少图片或附件。");
        if (disposed || active.Count >= 4 || active.ContainsKey(id)) throw new InvalidOperationException("请求正在处理中，请稍后重试。");
        var cancel = new CancellationTokenSource();
        active.Add(id, cancel);
        try {
            using (var request = new HttpRequestMessage(new HttpMethod(method), uri)) {
                if (method == "POST") request.Content = new StringContent(body ?? "{}", Encoding.UTF8, "application/json");
                if (headers != null) foreach (var header in headers) {
                    string key = header.Key.ToLowerInvariant();
                    if (key == "authorization" || key == "x-api-key" || key == "anthropic-version" || key == "anthropic-dangerous-direct-browser-access" || key == "accept")
                        request.Headers.TryAddWithoutValidation(header.Key, Convert.ToString(header.Value));
                }
                using (var response = await client.SendAsync(request, HttpCompletionOption.ResponseContentRead, cancel.Token)) {
                    if (response.Content.Headers.ContentLength > Limit) throw new InvalidOperationException("模型响应过大。");
                    byte[] bytes = await response.Content.ReadAsByteArrayAsync();
                    if (bytes.Length > Limit) throw new InvalidOperationException("模型响应过大。");
                    return new Dictionary<string, object> { { "kind", "http-response" }, { "id", id }, { "status", (int)response.StatusCode }, { "text", Encoding.UTF8.GetString(bytes) } };
                }
            }
        } catch (TaskCanceledException) { throw new InvalidOperationException("请求已取消或超时，请重试。"); }
        catch (HttpRequestException) { throw new InvalidOperationException("无法连接模型服务，请检查接口地址和网络。"); }
        finally { active.Remove(id); cancel.Dispose(); }
    }
    public void Cancel(string id) { CancellationTokenSource value; if (active.TryGetValue(id, out value)) value.Cancel(); }
    public void Dispose() { disposed = true; foreach (var c in active.Values) c.Cancel(); client.Dispose(); }
}
