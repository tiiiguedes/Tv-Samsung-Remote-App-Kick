using System;
using System.IO;
using System.Net;
using System.Net.WebSockets;
using System.Text;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;

sealed class SamsungRemote : IDisposable
{
    const int Port = 8002;
    const string Endpoint = "/api/v2/channels/samsung.remote.control";
    const string AppEndpoint = "/api/v2";
    const int MaxMessageSize = 65536;
    const string PairingTimeoutMessage = "A TV não confirmou o pareamento. Se o aviso não aparecer, reinicie a TV e tente novamente.";
    static readonly string ClientQuery = "name=" + Uri.EscapeDataString(
        Convert.ToBase64String(Encoding.UTF8.GetBytes("Controle Samsung PC")));
    readonly ClientWebSocket socket = CreateSocket();
    readonly SemaphoreSlim sendLock = new SemaphoreSlim(1);
    readonly CancellationTokenSource lifetime = new CancellationTokenSource();
    readonly Uri address;
    int disposed;

    public IPAddress DeviceAddress { get; }

    public SamsungRemote(IPAddress ip, string token)
    {
        DeviceAddress = ip;
        string query = ClientQuery;
        if (!string.IsNullOrEmpty(token))
            query += "&token=" + Uri.EscapeDataString(token);

        address = new UriBuilder("wss", ip.ToString(), Port, Endpoint, "?" + query).Uri;
    }

    static ClientWebSocket CreateSocket()
    {
        var socket = new ClientWebSocket();
        socket.Options.Proxy = new WebProxy();
        // Samsung TVs present a self-signed certificate on the local control channel.
        socket.Options.RemoteCertificateValidationCallback = (_, certificate, _, _) => certificate != null;
        return socket;
    }

    public async Task<string> ConnectAsync(Action waitingForPermission)
    {
        try
        {
            using (var deadline = new CancellationTokenSource(TimeSpan.FromSeconds(6)))
                await socket.ConnectAsync(address, deadline.Token);
        }
        catch (Exception error)
        {
            if (!(error is WebSocketException || error is OperationCanceledException))
                throw;

            throw new IOException("Não foi possível acessar a TV. Confira o IP, a rede e se a TV está ligada.", error);
        }

        waitingForPermission();
        using (var deadline = new CancellationTokenSource(TimeSpan.FromSeconds(45)))
        {
            while (true)
            {
                JsonElement message;
                try
                {
                    message = await ReceiveAsync(socket, deadline.Token);
                }
                catch (Exception error)
                {
                    if (!deadline.IsCancellationRequested)
                        throw;

                    throw new TimeoutException(PairingTimeoutMessage, error);
                }

                string eventName = Field(message, "event");
                if (string.Equals(eventName, "ms.channel.timeOut", StringComparison.OrdinalIgnoreCase))
                    throw new TimeoutException(PairingTimeoutMessage);

                if (eventName == "ms.channel.unauthorized")
                    throw new UnauthorizedAccessException("A TV recusou a conexão. Confira as permissões na TV e tente novamente.");

                if (eventName == "ms.channel.connect")
                {
                    return message.TryGetProperty("data", out var data) ? Field(data, "token") : "";
                }
            }
        }
    }

    public Task SendKeyAsync(string key)
    {
        return SendAsync("ms.remote.control",
            new { Cmd = "Click", DataOfCmd = key, Option = "false", TypeOfRemote = "SendRemoteKey" });
    }

    public async Task LaunchAppAsync(string appId)
    {
        using var deadline = CancellationTokenSource.CreateLinkedTokenSource(lifetime.Token);
        deadline.CancelAfter(TimeSpan.FromSeconds(12));
        var cancellationToken = deadline.Token;
        using var apps = CreateSocket();
        var endpoint = new UriBuilder("wss", address.Host, Port, AppEndpoint, "?" + ClientQuery).Uri;
        await apps.ConnectAsync(endpoint, cancellationToken);

        while (true)
        {
            var message = await ReceiveAsync(apps, cancellationToken);
            string eventName = Field(message, "event");
            if (eventName == "ms.channel.connect")
                break;
            if (eventName == "ms.channel.unauthorized" ||
                string.Equals(eventName, "ms.channel.timeOut", StringComparison.OrdinalIgnoreCase))
                throw new IOException("A TV não disponibilizou o canal de aplicativos.");
        }

        await SendAppRequestAsync(apps, appId, "ms.application.start", appId, cancellationToken);
        for (int attempt = 0; attempt < 16; attempt++)
        {
            await Task.Delay(400, cancellationToken);
            string requestId = "app-status-" + attempt;
            await SendAppRequestAsync(apps, requestId, "ms.application.get", appId, cancellationToken);
            JsonElement reply;
            do
            {
                reply = await ReceiveAsync(apps, cancellationToken);
                if (Field(reply, "id") == appId &&
                    (reply.TryGetProperty("error", out var error) && error.ValueKind != JsonValueKind.Null ||
                     reply.TryGetProperty("result", out var launchResult) && launchResult.ValueKind == JsonValueKind.False))
                    throw new IOException("A TV recusou a abertura do aplicativo.");
            } while (Field(reply, "id") != requestId);

            if (reply.TryGetProperty("result", out var status) && status.ValueKind == JsonValueKind.Object &&
                status.TryGetProperty("visible", out var visible) && visible.ValueKind == JsonValueKind.True)
                return;
        }

        throw new TimeoutException("A TV não confirmou a abertura do aplicativo.");
    }

    static Task SendAppRequestAsync(ClientWebSocket channel, string requestId, string method, string appId,
        CancellationToken cancellationToken)
    {
        byte[] message = JsonSerializer.SerializeToUtf8Bytes(new { id = requestId, method, @params = new { id = appId } });
        return channel.SendAsync(new ArraySegment<byte>(message), WebSocketMessageType.Text, true, cancellationToken);
    }

    async Task SendAsync(string method, object parameters)
    {
        byte[] data = JsonSerializer.SerializeToUtf8Bytes(new { method, @params = parameters });
        await sendLock.WaitAsync();
        try
        {
            using (var deadline = new CancellationTokenSource(TimeSpan.FromSeconds(4)))
                await socket.SendAsync(new ArraySegment<byte>(data), WebSocketMessageType.Text, true, deadline.Token);
        }
        finally
        {
            sendLock.Release();
        }
    }

    public async Task ListenAsync()
    {
        while (true)
        {
            var message = await ReceiveAsync(socket, CancellationToken.None);
            string eventName = Field(message, "event");
            if (eventName == "ms.channel.unauthorized")
                throw new UnauthorizedAccessException("A TV revogou a autorização. Clique em Conectar para parear de novo.");

            if (eventName == "ms.error")
            {
                if (message.TryGetProperty("data", out var data) &&
                    string.Equals(Field(data, "message"), "No Authorized", StringComparison.OrdinalIgnoreCase))
                    throw new UnauthorizedAccessException("A TV revogou a autorização. Clique em Conectar para parear de novo.");
            }
        }
    }

    static async Task<JsonElement> ReceiveAsync(ClientWebSocket socket, CancellationToken cancellationToken)
    {
        var buffer = new ArraySegment<byte>(new byte[4096]);
        using (var message = new MemoryStream())
        {
            WebSocketReceiveResult frame;
            do
            {
                frame = await socket.ReceiveAsync(buffer, cancellationToken);
                if (frame.MessageType == WebSocketMessageType.Close)
                    throw new IOException("A TV encerrou a conexão. Clique em Conectar quando ela estiver ligada.");

                if (frame.MessageType != WebSocketMessageType.Text || message.Length + frame.Count > MaxMessageSize)
                    throw new IOException("A TV enviou uma resposta inesperada.");

                message.Write(buffer.Array, 0, frame.Count);
            } while (!frame.EndOfMessage);

            return JsonSerializer.Deserialize<JsonElement>(message.GetBuffer().AsSpan(0, (int)message.Length));
        }
    }

    static string Field(JsonElement data, string key)
    {
        if (data.ValueKind != JsonValueKind.Object || !data.TryGetProperty(key, out var value))
            return "";

        return value.ToString();
    }

    public void Dispose()
    {
        if (Interlocked.Exchange(ref disposed, 1) != 0)
            return;

        lifetime.Cancel();
        lifetime.Dispose();
        socket.Dispose();
    }
}
