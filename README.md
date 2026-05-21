<img src="https://gitlab.gnome.org/GNOME/gnome-weather/-/raw/main/data/icons/org.gnome.Weather.svg">

# GNOME Shell Extension - OpenMeteo Weather
### Fork of the [Weather or Not](https://github.com/somepaulo/GNOME-Shell-extension-Weather-or-Not) extension that uses Open-meteo API

[![License: GPL v3](https://img.shields.io/badge/License-GPL%20v3-blue.svg)](https://www.gnu.org/licenses/gpl-3.0)

A simple extension for GNOME Shell 45+ that adds an icon showing the current weather conditions and temperature to the panel. The indicator position can be adjusted in preferences.

______

![OpenMeteoWeather screenshot](sample.png)

## Installation

Make sure you have GNOME Weather installed and a default location set in it.

Clone this fork and copy the extension folder:

```bash
git clone https://github.com/gnshb/gnome-shell-openmeteoweather-extension.git
cd gnome-shell-openmeteoweather-extension
cp -r openmeteoweather@deezhizyu.github.io ~/.local/share/gnome-shell/extensions/
```

Then reload GNOME Shell:

- Wayland: log out and log back in.
- X11: press `Alt+F2`, type `r`, press Enter.

Enable the extension:

```bash
gnome-extensions enable openmeteoweather@deezhizyu.github.io
```

You can also enable it from Extensions, Extension Manager, or GNOME Shell Extensions.

#### Credits
- [Weather or Not](https://github.com/somepaulo/GNOME-Shell-extension-Weather-or-Not)
- [Open-meteo API](https://open-meteo.com/)
- Gnome extension build workflow from [Vitals](https://github.com/corecoding/Vitals)
