using System;
using System.ComponentModel;
using System.Diagnostics;
using System.IO;
using System.Net;
using System.Text;
using System.Text.Json;
using System.Threading.Tasks;

namespace ControleSamsung;

enum KickInstallResult
{
    Installed,
    WaitingForTvStore
}

static class KickTvApp
{
    const string AppId = "TvKickPC01.Player";
    const string PackageName = "TvKick.wgt";

    public static async Task<KickInstallResult> InstallAsync(IPAddress address)
    {
        string package = Path.Combine(AppContext.BaseDirectory, PackageName);
        if (!File.Exists(package))
            throw new IOException($"Coloque {PackageName} ao lado do executável do controle.");

        var result = await RunAsync(address, "install", package, "--own-id");
        if (ReadString(result, "via") == "tvstore" && ReadString(result, "state") == "waiting")
            return KickInstallResult.WaitingForTvStore;
        if (ReadString(result, "appId") != AppId)
            throw new IOException($"O instalador retornou um identificador diferente de {AppId}.");

        return KickInstallResult.Installed;
    }

    public static async Task LaunchAsync(IPAddress address) =>
        await RunAsync(address, "launch", AppId);

    static async Task<JsonElement> RunAsync(IPAddress address, params string[] arguments)
    {
        string installer = Path.Combine(AppContext.BaseDirectory, ".kick-install", "installer", "apps2samsung-cli.exe");
        if (!File.Exists(installer))
            throw new IOException("O Apps2Samsung CLI está ausente da pasta .kick-install/installer do controle.");

        var start = new ProcessStartInfo(installer)
        {
            UseShellExecute = false,
            CreateNoWindow = true,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            StandardOutputEncoding = Encoding.UTF8,
            WorkingDirectory = AppContext.BaseDirectory
        };
        foreach (string argument in arguments)
            start.ArgumentList.Add(argument);
        start.ArgumentList.Add("--tv");
        start.ArgumentList.Add(address.ToString());
        start.ArgumentList.Add("--json");

        using var process = new Process { StartInfo = start };
        try
        {
            if (!process.Start())
                throw new IOException("O Apps2Samsung CLI não iniciou.");
        }
        catch (Win32Exception error)
        {
            throw new IOException("O Windows não conseguiu iniciar o Apps2Samsung CLI.", error);
        }

        var outputTask = process.StandardOutput.ReadToEndAsync();
        await Task.WhenAll(process.WaitForExitAsync(), outputTask, process.StandardError.BaseStream.CopyToAsync(Stream.Null));
        try
        {
            using var document = JsonDocument.Parse(await outputTask);
            var response = document.RootElement;
            if (process.ExitCode == 0 && response.ValueKind == JsonValueKind.Object &&
                response.TryGetProperty("ok", out var ok) && ok.ValueKind == JsonValueKind.True)
                return response.Clone();

            if (response.ValueKind == JsonValueKind.Object &&
                response.TryGetProperty("details", out var details) && details.ValueKind == JsonValueKind.Object &&
                details.TryGetProperty("checks", out var checks) && checks.ValueKind == JsonValueKind.Array &&
                checks.GetArrayLength() > 0 && ReadString(checks[0], "message") is { Length: > 0 } check)
                throw new IOException(check);

            throw new IOException(ReadString(response, "error") ?? $"Apps2Samsung CLI retornou o código {process.ExitCode}.");
        }
        catch (JsonException error)
        {
            throw new IOException($"O Apps2Samsung CLI retornou uma resposta inválida (código {process.ExitCode}).", error);
        }
    }

    static string ReadString(JsonElement value, string name) =>
        value.ValueKind == JsonValueKind.Object && value.TryGetProperty(name, out var field) &&
        field.ValueKind == JsonValueKind.String ? field.GetString() : null;
}
