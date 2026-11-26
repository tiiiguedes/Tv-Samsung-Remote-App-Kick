using System;
using System.ComponentModel;
using System.IO;
using System.Net;
using System.Net.Sockets;
using System.Net.WebSockets;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Interop;
using System.Windows.Threading;
using Forms = System.Windows.Forms;

namespace ControleSamsung;

public partial class RemoteWindow : Window
{
    readonly string settingsPath;
    readonly DispatcherTimer reconnectTimer = new() { Interval = TimeSpan.FromSeconds(10) };
    readonly DispatcherTimer dismissTimer = new() { Interval = TimeSpan.FromMilliseconds(170) };
    readonly System.Drawing.Icon trayIcon;
    readonly Forms.NotifyIcon tray;
    readonly Forms.ContextMenuStrip trayMenu = new();
    HwndSource windowSource;
    System.Drawing.Point? panelAnchor;
    DispatcherOperation pendingPosition;
    SamsungRemote remote;
    IPAddress reconnectAddress;
    string savedIp = "";
    string savedToken = "";
    bool exiting;
    bool closed;
    bool kickOperationInProgress;

    public RemoteWindow() : this(Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Controle Samsung PC", "tv.txt"))
    {
    }

    internal RemoteWindow(string settingsPath)
    {
        this.settingsPath = settingsPath;
        InitializeComponent();
        LoadPairing();
        ConnectionToggle.IsChecked = savedToken.Length == 0;
        if (savedIp.Length != 0)
            StatusLine.Text = "Clique em Conectar ou procure a TV novamente.";

        trayIcon = WindowsShell.CreateTrayIcon();
        trayMenu.Items.Add("Abrir controle", null, (_, _) => ShowPanel(Forms.Cursor.Position));
        trayMenu.Items.Add(new Forms.ToolStripSeparator());
        trayMenu.Items.Add("Sair", null, (_, _) =>
        {
            exiting = true;
            Close();
        });
        tray = new Forms.NotifyIcon
        {
            Text = "Controle Samsung",
            Icon = trayIcon,
            ContextMenuStrip = trayMenu,
            Visible = true
        };
        tray.MouseClick += TrayClicked;
        dismissTimer.Tick += (_, _) => HidePanel();
        reconnectTimer.Tick += async (_, _) =>
        {
            reconnectTimer.Stop();
            if (reconnectAddress != null)
                await OpenConnectionAsync(reconnectAddress, true);
        };
        Loaded += StartPanel;
        SizeChanged += (_, _) => QueuePanelPosition();
    }

    async void StartPanel(object sender, RoutedEventArgs args)
    {
        Loaded -= StartPanel;
        PositionPanel(null);
        if (savedToken.Length != 0 && TryTvAddress(savedIp, out var address))
        {
            reconnectAddress = address;
            await OpenConnectionAsync(address, true);
        }
    }

    protected override void OnSourceInitialized(EventArgs args)
    {
        base.OnSourceInitialized(args);
        windowSource = HwndSource.FromHwnd(new WindowInteropHelper(this).Handle);
        WindowsShell.ApplyBackdrop(this, windowSource);
    }

    protected override void OnActivated(EventArgs args)
    {
        base.OnActivated(args);
        dismissTimer.Stop();
        if (windowSource != null)
            WindowsShell.ApplyBackdrop(this, windowSource);
    }

    protected override void OnDeactivated(EventArgs args)
    {
        base.OnDeactivated(args);
        if (IsVisible && !TvSelector.IsDropDownOpen)
            dismissTimer.Start();
    }

    protected override void OnPreviewKeyDown(KeyEventArgs args)
    {
        if (args.Key == Key.Escape && !TvSelector.IsDropDownOpen)
        {
            HidePanel();
            args.Handled = true;
        }
        base.OnPreviewKeyDown(args);
    }

    protected override void OnClosing(CancelEventArgs args)
    {
        if (!exiting)
        {
            args.Cancel = true;
            Dispatcher.BeginInvoke(new Action(HidePanel));
        }
        base.OnClosing(args);
    }

    protected override void OnClosed(EventArgs args)
    {
        closed = true;
        dismissTimer.Stop();
        reconnectTimer.Stop();
        var active = remote;
        remote = null;
        active?.Dispose();
        tray.Dispose();
        trayMenu.Dispose();
        trayIcon.Dispose();
        base.OnClosed(args);
    }

    void TrayClicked(object sender, Forms.MouseEventArgs args)
    {
        if (args.Button != Forms.MouseButtons.Left)
            return;

        dismissTimer.Stop();
        if (IsVisible)
            HidePanel();
        else
            ShowPanel(Forms.Cursor.Position);
    }

    void ShowPanel(System.Drawing.Point anchor)
    {
        dismissTimer.Stop();
        panelAnchor = anchor;
        PositionPanel(anchor);
        Show();
        Activate();
    }

    void PositionPanel(System.Drawing.Point? anchor)
    {
        if (windowSource != null)
            WindowsShell.PositionPanel(this, windowSource, anchor);
    }

    void QueuePanelPosition()
    {
        if (!IsVisible || windowSource == null || pendingPosition?.Status == DispatcherOperationStatus.Pending)
            return;

        pendingPosition = Dispatcher.BeginInvoke(DispatcherPriority.Loaded, new Action(() =>
        {
            if (IsVisible)
                PositionPanel(panelAnchor);
        }));
    }

    void HideClicked(object sender, RoutedEventArgs args) => HidePanel();

    void HidePanel()
    {
        dismissTimer.Stop();
        TvSelector.IsDropDownOpen = false;
        Hide();
    }

    async void SearchClicked(object sender, RoutedEventArgs args)
    {
        TvSelector.IsEnabled = SearchButton.IsEnabled = ConnectButton.IsEnabled = false;
        StatusLine.Text = "Procurando TVs Samsung na rede…";
        TvDevice[] found;
        try
        {
            found = await TvDiscovery.FindAsync();
        }
        catch (SocketException)
        {
            if (!closed)
                StatusLine.Text = "A busca não conseguiu acessar a rede. Verifique a conexão do PC.";
            return;
        }
        finally
        {
            if (!closed)
                TvSelector.IsEnabled = SearchButton.IsEnabled = ConnectButton.IsEnabled = true;
        }

        if (closed)
            return;

        if (found.Length == 0)
        {
            StatusLine.Text = "Nenhuma TV encontrada. Confira se ela está ligada e na mesma rede do PC.";
            return;
        }

        TvSelector.ItemsSource = found;
        TvSelector.SelectedIndex = found.Length == 1 ? 0 : -1;
        if (found.Length == 1)
        {
            StatusLine.Text = "TV encontrada. Clique em Conectar.";
            return;
        }

        TvSelector.Text = "";
        StatusLine.Text = "Escolha sua TV na lista e clique em Conectar.";
        if (IsVisible)
        {
            TvSelector.Focus();
            TvSelector.IsDropDownOpen = true;
        }
    }

    async void ConnectClicked(object sender, RoutedEventArgs args)
    {
        if (remote != null || reconnectTimer.IsEnabled)
        {
            Disconnect("Controle desconectado.");
            return;
        }

        string input = TvSelector.Text.Trim();
        if (input.Length == 0 && TvSelector.Items.Count == 0)
        {
            SearchClicked(sender, args);
            return;
        }

        if (TvSelector.SelectedItem is TvDevice selection && input == selection.ToString())
            input = selection.Address.ToString();

        if (!TryTvAddress(input, out var address))
        {
            StatusLine.Text = "Escolha uma TV na lista ou informe o endereço IPv4 mostrado na TV.";
            TvSelector.Focus();
            return;
        }

        await OpenConnectionAsync(address, false);
    }

    static bool TryTvAddress(string input, out IPAddress address)
    {
        if (!IPAddress.TryParse(input, out address) || address.AddressFamily != AddressFamily.InterNetwork ||
            address.ToString() != input || IPAddress.IsLoopback(address))
            return false;

        byte firstOctet = address.GetAddressBytes()[0];
        return firstOctet > 0 && firstOctet < 224;
    }

    async Task OpenConnectionAsync(IPAddress address, bool automatic)
    {
        string input = address.ToString();
        string token = input == savedIp ? savedToken : "";
        var active = new SamsungRemote(address, token);
        remote = active;
        TvSelector.IsEnabled = SearchButton.IsEnabled = false;
        ConnectButton.Content = "Cancelar";
        StatusLine.Text = "Conectando à TV…";

        try
        {
            string newToken = await active.ConnectAsync(() =>
            {
                if (remote == active)
                    StatusLine.Text = "Se aparecer um pedido na TV, selecione Permitir.";
            });
            if (remote != active)
                return;

            ConnectButton.Content = "Desconectar";
            StatusLine.Text = "TV conectada.";
            RemoteButtons.IsEnabled = true;
            AppButtons.IsEnabled = !kickOperationInProgress;
            if (!automatic)
                ConnectionToggle.IsChecked = false;
            string pairingToken = string.IsNullOrEmpty(newToken) ? token : newToken;
            reconnectAddress = pairingToken.Length == 0 ? null : address;
            if (!SavePairing(input, pairingToken))
                StatusLine.Text = "TV conectada. Não foi possível salvar o pareamento neste PC.";
            await active.ListenAsync();
        }
        catch (UnauthorizedAccessException error)
        {
            if (remote != active)
                return;

            if (savedIp == input)
                SavePairing(input, "");
            Disconnect(error.Message);
        }
        catch (Exception error)
        {
            if (remote != active)
                return;

            bool knownError = error is IOException or TimeoutException;
            bool retry = (automatic || RemoteButtons.IsEnabled) &&
                (knownError || error is WebSocketException or OperationCanceledException);
            Disconnect(knownError ? error.Message : "A conexão foi interrompida. Tente conectar novamente.", retry);
        }
    }

    async void KeyClicked(object sender, RoutedEventArgs args) =>
        await SendAsync(active => active.SendKeyAsync((string)((Button)sender).Tag));

    async void KickClicked(object sender, RoutedEventArgs args) => await RunKickAsync(install: false);

    async void InstallKickClicked(object sender, RoutedEventArgs args) => await RunKickAsync(install: true);

    async Task RunKickAsync(bool install)
    {
        var active = remote;
        if (active == null || !AppButtons.IsEnabled || kickOperationInProgress)
            return;

        kickOperationInProgress = true;
        AppButtons.IsEnabled = false;
        StatusLine.Text = install
            ? "Instalando Kick… Se solicitado, entre na sua conta Samsung no navegador do PC."
            : "Abrindo Kick na TV…";
        try
        {
            string message;
            if (install)
            {
                var result = await KickTvApp.InstallAsync(active.DeviceAddress);
                message = result == KickInstallResult.WaitingForTvStore
                    ? "Pacote enviado à TV. Confirme a instalação no TV-Store."
                    : "Kick instalado na TV. Clique em Kick para abrir.";
            }
            else
            {
                await KickTvApp.LaunchAsync(active.DeviceAddress);
                message = "Kick aberto na TV.";
            }

            if (remote == active)
                StatusLine.Text = message;
        }
        catch (IOException error)
        {
            if (remote == active)
                StatusLine.Text = $"Não foi possível {(install ? "instalar" : "abrir")} Kick. {error.Message}";
        }
        finally
        {
            kickOperationInProgress = false;
            if (!closed)
                AppButtons.IsEnabled = RemoteButtons.IsEnabled;
        }
    }

    async void AppClicked(object sender, RoutedEventArgs args)
    {
        var active = remote;
        if (active == null || !AppButtons.IsEnabled)
            return;

        var button = (Button)sender;
        string appName = (string)button.Content;
        AppButtons.IsEnabled = false;
        StatusLine.Text = $"Abrindo {appName}…";
        try
        {
            await active.LaunchAppAsync((string)button.Tag);

            if (remote == active)
                StatusLine.Text = $"{appName} aberto na TV.";
        }
        catch (Exception error) when (error is IOException or WebSocketException or JsonException or
                                      TimeoutException or OperationCanceledException)
        {
            if (remote == active)
                StatusLine.Text = error is TimeoutException or OperationCanceledException
                    ? $"A TV não confirmou a abertura de {appName}."
                    : $"Não foi possível abrir {appName} na TV.";
        }
        finally
        {
            if (remote == active)
                AppButtons.IsEnabled = true;
        }
    }

    async Task SendAsync(Func<SamsungRemote, Task> command)
    {
        var active = remote;
        if (active == null)
            return;

        try
        {
            await command(active);
        }
        catch (Exception)
        {
            if (remote == active)
                Disconnect("A conexão foi interrompida. Tente conectar novamente.", true);
        }
    }

    void Disconnect(string message, bool retry = false)
    {
        reconnectTimer.Stop();
        var active = remote;
        remote = null;
        active?.Dispose();
        RemoteButtons.IsEnabled = AppButtons.IsEnabled = false;
        if (retry && reconnectAddress != null)
        {
            StatusLine.Text = "Aguardando a TV para reconectar automaticamente.";
            ConnectButton.Content = "Cancelar";
            reconnectTimer.Start();
            return;
        }

        reconnectAddress = null;
        TvSelector.IsEnabled = SearchButton.IsEnabled = true;
        ConnectButton.Content = "Conectar";
        StatusLine.Text = message;
        ConnectionToggle.IsChecked = true;
    }

    void LoadPairing()
    {
        try
        {
            string[] saved = File.ReadAllLines(settingsPath);
            if (saved.Length != 2)
                return;

            savedIp = saved[0];
            TvSelector.Text = savedIp;
            if (saved[1].Length != 0)
                savedToken = Encoding.UTF8.GetString(ProtectedData.Unprotect(
                    Convert.FromBase64String(saved[1]), null, DataProtectionScope.CurrentUser));
        }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException or CryptographicException or FormatException)
        {
            // The TV can authorize the program again if local settings cannot be loaded.
        }
    }

    bool SavePairing(string address, string token)
    {
        savedIp = address;
        savedToken = token;
        string temp = settingsPath + "." + Guid.NewGuid().ToString("N");
        try
        {
            Directory.CreateDirectory(Path.GetDirectoryName(settingsPath));
            string secret = token.Length == 0 ? "" : Convert.ToBase64String(
                ProtectedData.Protect(Encoding.UTF8.GetBytes(token), null, DataProtectionScope.CurrentUser));
            File.WriteAllLines(temp, new[] { address, secret });
            File.Move(temp, settingsPath, true);
            return true;
        }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException or CryptographicException)
        {
            try { File.Delete(temp); }
            catch (IOException) { }
            catch (UnauthorizedAccessException) { }
            return false;
        }
    }
}
