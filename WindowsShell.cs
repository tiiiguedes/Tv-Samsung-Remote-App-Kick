using System;
using System.Runtime.InteropServices;
using System.Windows;
using System.Windows.Interop;
using System.Windows.Media;
using Microsoft.Win32;
using Drawing = System.Drawing;
using Forms = System.Windows.Forms;

namespace ControleSamsung;

static class WindowsShell
{
    const int UseImmersiveDarkMode = 20;
    const int WindowCornerPreference = 33;
    const int WindowBorderColor = 34;
    const int SystemBackdropType = 38;
    const int RoundCorners = 2;
    const int DesktopAcrylic = 3;
    const int NoBackdrop = 1;
    const int NoBorder = unchecked((int)0xFFFFFFFE);
    const int DefaultBorder = unchecked((int)0xFFFFFFFF);
    const int AccentPolicyAttribute = 19;
    const int AcrylicAccent = 4;
    const uint TranslucentShellTint = 0x25323232;
    static readonly SetCompositionAttribute setCompositionAttribute = LoadCompositionAttribute();
    static readonly (string Key, byte Alpha)[] tileBrushes =
    {
        ("ButtonBackground", 16),
        ("ButtonBackgroundPointerOver", 34),
        ("ButtonBackgroundPressed", 12),
        ("ButtonBackgroundDisabled", 8),
        ("ButtonBorderBrush", 27)
    };

    public static void ApplyBackdrop(Window window, HwndSource source)
    {
        IntPtr handle = source.Handle;
        bool dark = Registry.GetValue(@"HKEY_CURRENT_USER\Software\Microsoft\Windows\CurrentVersion\Themes\Personalize",
            "AppsUseLightTheme", 1) is 0;
        SetDwmAttribute(handle, UseImmersiveDarkMode, dark ? 1 : 0);
        SetDwmAttribute(handle, WindowCornerPreference, RoundCorners);

        var frame = new Margins { Left = -1, Right = -1, Top = -1, Bottom = -1 };
        SetDwmAttribute(handle, SystemBackdropType, NoBackdrop);
        bool glass = !SystemParameters.HighContrast &&
            DwmExtendFrameIntoClientArea(handle, ref frame) == 0 &&
            (SetAccentPolicy(handle, AcrylicAccent, TranslucentShellTint) ||
             SetDwmAttribute(handle, SystemBackdropType, DesktopAcrylic) == 0);

        SetDwmAttribute(handle, WindowBorderColor, glass ? NoBorder : DefaultBorder);
        SetTileBrushes(window, glass, dark);
        SetRemotePalette(window, glass, dark);
        if (glass)
        {
            source.CompositionTarget.BackgroundColor = Colors.Transparent;
            window.Background = System.Windows.Media.Brushes.Transparent;
            return;
        }

        SetAccentPolicy(handle, 0, 0);
        frame = default;
        DwmExtendFrameIntoClientArea(handle, ref frame);
        window.ClearValue(Window.BackgroundProperty);
        source.CompositionTarget.BackgroundColor = window.Background is SolidColorBrush background
            ? background.Color : SystemColors.WindowColor;
    }

    public static void PositionPanel(Window window, HwndSource source, System.Drawing.Point? anchor)
    {
        var display = anchor.HasValue ? Forms.Screen.FromPoint(anchor.Value) : Forms.Screen.PrimaryScreen;
        var work = display.WorkingArea;
        double scale = source.CompositionTarget.TransformToDevice.M22;
        int gap = (int)Math.Round(12 * scale);
        window.MaxHeight = Math.Max(100, (work.Height - 2 * gap) / scale);
        window.UpdateLayout();
        if (!GetWindowRect(source.Handle, out var bounds))
            return;

        int width = bounds.Right - bounds.Left;
        int height = bounds.Bottom - bounds.Top;
        var location = PanelLocation(display.Bounds, work, new Drawing.Size(width, height), anchor, gap);
        const uint keepSizeAndZOrder = 0x0001 | 0x0004 | 0x0010;
        SetWindowPos(source.Handle, IntPtr.Zero, location.X, location.Y, 0, 0, keepSizeAndZOrder);
    }

    internal static Drawing.Point PanelLocation(Drawing.Rectangle display, Drawing.Rectangle work,
        Drawing.Size panel, Drawing.Point? anchor, int gap)
    {
        int x = anchor.HasValue ? anchor.Value.X - panel.Width / 2 : work.Right - panel.Width - gap;
        int y = work.Bottom - panel.Height - gap;
        if (work.Top > display.Top && work.Bottom == display.Bottom)
            y = work.Top + gap;
        else if (work.Left > display.Left || work.Right < display.Right)
        {
            x = work.Left > display.Left ? work.Left + gap : work.Right - panel.Width - gap;
            if (anchor.HasValue)
                y = anchor.Value.Y - panel.Height / 2;
        }

        int gapX = Math.Min(gap, Math.Max(0, (work.Width - panel.Width) / 2));
        int gapY = Math.Min(gap, Math.Max(0, (work.Height - panel.Height) / 2));
        int left = work.Left + gapX;
        int top = work.Top + gapY;
        return new Drawing.Point(
            Math.Clamp(x, left, Math.Max(left, work.Right - panel.Width - gapX)),
            Math.Clamp(y, top, Math.Max(top, work.Bottom - panel.Height - gapY)));
    }

    static void SetTileBrushes(Window window, bool glass, bool dark)
    {
        byte channel = dark ? (byte)255 : (byte)0;
        foreach (var (key, alpha) in tileBrushes)
        {
            if (!glass)
            {
                window.Resources.Remove(key);
                continue;
            }

            var brush = new SolidColorBrush(Color.FromArgb(alpha, channel, channel, channel));
            brush.Freeze();
            window.Resources[key] = brush;
        }
    }

    static void SetRemotePalette(Window window, bool glass, bool dark)
    {
        var resources = window.Resources;
        if (SystemParameters.HighContrast)
        {
            resources["RemoteCardFill"] = resources["RemoteDialFill"] =
                resources["RemoteKeyFill"] = SystemColors.WindowBrush;
            resources["RemoteCardStroke"] = resources["RemoteDialStroke"] =
                resources["RemoteKeyStroke"] = resources["RemotePowerInk"] = SystemColors.WindowTextBrush;
            resources["RemoteKeyHover"] = resources["RemoteKeyPressed"] = SystemColors.ControlBrush;
            return;
        }

        byte cardAlpha = glass ? (byte)206 : (byte)255;
        resources["RemoteCardFill"] = new SolidColorBrush(dark
            ? Color.FromArgb(cardAlpha, 29, 28, 33) : Color.FromArgb(cardAlpha, 247, 246, 250));
        resources["RemoteCardStroke"] = new SolidColorBrush(dark ? Color.FromArgb(29, 255, 255, 255) : Color.FromArgb(24, 0, 0, 0));
        resources["RemoteDialStroke"] = new SolidColorBrush(dark ? Color.FromRgb(16, 15, 19) : Color.FromRgb(207, 202, 216));
        resources["RemoteKeyStroke"] = new SolidColorBrush(dark ? Color.FromRgb(54, 51, 62) : Color.FromRgb(208, 203, 218));
        resources["RemoteDialFill"] = new LinearGradientBrush(
            dark ? Color.FromRgb(54, 51, 61) : Color.FromRgb(252, 250, 255),
            dark ? Color.FromRgb(33, 31, 38) : Color.FromRgb(227, 223, 235), 125);
        resources["RemoteKeyFill"] = new LinearGradientBrush(
            dark ? Color.FromRgb(47, 45, 54) : Color.FromRgb(255, 254, 255),
            dark ? Color.FromRgb(24, 23, 28) : Color.FromRgb(232, 228, 239), 90);
        resources["RemoteKeyHover"] = new SolidColorBrush(dark ? Color.FromRgb(68, 63, 78) : Color.FromRgb(220, 214, 234));
        resources["RemoteKeyPressed"] = new SolidColorBrush(dark ? Color.FromRgb(85, 75, 101) : Color.FromRgb(205, 194, 226));
        resources["RemotePowerInk"] = new SolidColorBrush(dark ? Color.FromRgb(255, 101, 133) : Color.FromRgb(177, 24, 62));
    }

    static SetCompositionAttribute LoadCompositionAttribute()
    {
        if (NativeLibrary.TryLoad("user32.dll", typeof(WindowsShell).Assembly, DllImportSearchPath.System32, out var user32) &&
            NativeLibrary.TryGetExport(user32, "SetWindowCompositionAttribute", out var export))
            return Marshal.GetDelegateForFunctionPointer<SetCompositionAttribute>(export);

        return null;
    }

    static bool SetAccentPolicy(IntPtr handle, int state, uint tint)
    {
        if (setCompositionAttribute == null)
            return false;

        // SystemBackdropType has no tint setting. Keep the default system acrylic as a fallback.
        int size = Marshal.SizeOf<AccentPolicy>();
        IntPtr pointer = Marshal.AllocHGlobal(size);
        try
        {
            Marshal.StructureToPtr(new AccentPolicy { State = state, Tint = tint }, pointer, false);
            var data = new CompositionData { Attribute = AccentPolicyAttribute, Value = pointer, Size = (nuint)size };
            return setCompositionAttribute(handle, ref data);
        }
        finally
        {
            Marshal.FreeHGlobal(pointer);
        }
    }

    public static Drawing.Icon CreateTrayIcon()
    {
        using var bitmap = new Drawing.Bitmap(32, 32, Drawing.Imaging.PixelFormat.Format32bppArgb);
        using (var graphics = Drawing.Graphics.FromImage(bitmap))
        using (var tile = new Drawing.SolidBrush(Drawing.Color.FromArgb(182, 157, 249)))
        using (var stroke = new Drawing.Pen(Drawing.Color.FromArgb(38, 26, 60), 2))
        {
            graphics.SmoothingMode = Drawing.Drawing2D.SmoothingMode.AntiAlias;
            graphics.FillEllipse(tile, 1, 1, 30, 30);
            graphics.DrawRectangle(stroke, 7, 8, 18, 13);
            graphics.DrawLine(stroke, 12, 25, 20, 25);
        }

        IntPtr handle = bitmap.GetHicon();
        try
        {
            using var borrowed = Drawing.Icon.FromHandle(handle);
            return (Drawing.Icon)borrowed.Clone();
        }
        finally
        {
            DestroyIcon(handle);
        }
    }

    static int SetDwmAttribute(IntPtr handle, int attribute, int value) =>
        DwmSetWindowAttribute(handle, attribute, ref value, sizeof(int));

    [StructLayout(LayoutKind.Sequential)]
    struct Margins { public int Left, Right, Top, Bottom; }

    [StructLayout(LayoutKind.Sequential)]
    struct Bounds { public int Left, Top, Right, Bottom; }

    [StructLayout(LayoutKind.Sequential)]
    struct AccentPolicy { public int State, Flags; public uint Tint; public int Animation; }

    [StructLayout(LayoutKind.Sequential)]
    struct CompositionData { public int Attribute; public IntPtr Value; public nuint Size; }

    [UnmanagedFunctionPointer(CallingConvention.Winapi)]
    [return: MarshalAs(UnmanagedType.Bool)]
    delegate bool SetCompositionAttribute(IntPtr handle, ref CompositionData data);

    [DllImport("dwmapi.dll")]
    static extern int DwmExtendFrameIntoClientArea(IntPtr handle, ref Margins margins);

    [DllImport("dwmapi.dll")]
    static extern int DwmSetWindowAttribute(IntPtr handle, int attribute, ref int value, int size);

    [DllImport("user32.dll")]
    static extern bool GetWindowRect(IntPtr handle, out Bounds bounds);

    [DllImport("user32.dll")]
    static extern bool SetWindowPos(IntPtr handle, IntPtr after, int x, int y, int width, int height, uint flags);

    [DllImport("user32.dll")]
    static extern bool DestroyIcon(IntPtr handle);
}
