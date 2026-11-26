using System;
using System.Windows;

namespace ControleSamsung;

public partial class App : Application
{
    public App()
    {
        // The transient tray panel applies its own system Acrylic backdrop.
        AppContext.SetSwitch("Switch.System.Windows.Appearance.DisableFluentThemeWindowBackdrop", true);
        System.Windows.Forms.Application.EnableVisualStyles();
    }
}
