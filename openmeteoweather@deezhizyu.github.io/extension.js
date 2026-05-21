/*
 * Weather or Not extension for GNOME Shell 45+
 * Copyright 2023 Paulo Fino (somepaulo), 2022 Cleo Menezes Jr. (CleoMenezesJr), 2020 Jason Gray (JasonLG1979)
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <http://www.gnu.org/licenses/>.
 *
 * If this extension breaks your desktop you get to keep all of the pieces...
 */

import Clutter from "gi://Clutter";
import GLib from "gi://GLib";
import GObject from "gi://GObject";
import St from "gi://St";
import Soup from "gi://Soup";
import cairo from "cairo";

import * as Main from "resource:///org/gnome/shell/ui/main.js";
import * as PanelMenu from "resource:///org/gnome/shell/ui/panelMenu.js";
import * as Signals from "resource:///org/gnome/shell/misc/signals.js";
import { Extension } from "resource:///org/gnome/shell/extensions/extension.js";
import * as PopupMenu from "resource:///org/gnome/shell/ui/popupMenu.js";

import weatherCodeToSymbolicIconName from "./utils/weatherCodeConverter.js";

const ForecastGraph = GObject.registerClass(
  {
    GTypeName: "ForecastGraph",
  },
  class ForecastGraph extends St.DrawingArea {
    _init(params) {
      params = params || {};
      let topPad = params._topPad;
      let bottomPad = params._bottomPad;
      let graphHeight = params._graphHeight;
      let rangePadRatio = params._rangePadRatio;
      let topReservePx = params._topReservePx;
      let botReservePx = params._botReservePx;
      let stParams = {};
      for (let k in params) {
        if (!k.startsWith('_')) stParams[k] = params[k];
      }
      super._init(stParams);
      this._series = [];
      this._labels = [];
      this._xLabels = [];
      this._colWidth = 80;
      this._graphHeight = graphHeight !== undefined ? graphHeight : 140;
      this._leftPad = 32;
      this._rightPad = 6;
      this._topPad = topPad !== undefined ? topPad : 34;
      this._bottomPad = bottomPad !== undefined ? bottomPad : 28;
      this._rangePadRatio = rangePadRatio !== undefined ? rangePadRatio : 0.15;
      this._topReservePx = topReservePx !== undefined ? topReservePx : 0;
      this._botReservePx = botReservePx !== undefined ? botReservePx : 0;
    }

    setData(series, labels, xLabels, colWidth) {
      this._series = series || [];
      this._labels = labels || [];
      this._xLabels = xLabels || [];
      this._colWidth = colWidth || 80;
      let count = this._series[0] ? this._series[0].length : 0;
      let w = count * this._colWidth + this._leftPad + this._rightPad;
      this.set_size(Math.max(1, w), this._graphHeight);
      this.queue_repaint();
    }

    _yRange() {
      let all = [].concat(...this._series);
      let dmin = Math.min(...all), dmax = Math.max(...all);
      let dataRange = (dmax - dmin) || 1;
      let pad = Math.max(1, Math.ceil(dataRange * this._rangePadRatio));
      let yMin = Math.floor((dmin - pad) / 5) * 5;
      let yMax = Math.ceil((dmax + pad) / 5) * 5;
      let plotH = this._graphHeight - this._topPad - this._bottomPad;
      let topR = this._topReservePx;
      let botR = this._botReservePx;
      for (let iter = 0; iter < 6; iter++) {
        let range = (yMax - yMin) || 1;
        let topOff = plotH * (yMax - dmax) / range;
        let botOff = plotH * (dmin - yMin) / range;
        let changed = false;
        if (topR > 0 && topOff < topR) {
          let rr = topR / plotH;
          if (rr < 1) {
            let needYMax = (dmax - rr * yMin) / (1 - rr);
            let newYMax = Math.ceil(needYMax / 5) * 5;
            if (newYMax > yMax) { yMax = newYMax; changed = true; }
          }
        }
        if (botR > 0 && botOff < botR) {
          let rr = botR / plotH;
          if (rr < 1) {
            let needYMin = (dmin - rr * yMax) / (1 - rr);
            let newYMin = Math.floor(needYMin / 5) * 5;
            if (newYMin < yMin) { yMin = newYMin; changed = true; }
          }
        }
        if (!changed) break;
      }
      return { yMin, yMax, range: (yMax - yMin) || 1 };
    }

    getPointPositions(seriesIdx) {
      let series = this._series[seriesIdx];
      if (!series || !series.length) return [];
      let { yMin, range } = this._yRange();
      let count = series.length;
      let width = count * this._colWidth + this._leftPad + this._rightPad;
      let plotW = width - this._leftPad - this._rightPad;
      let plotH = this._graphHeight - this._topPad - this._bottomPad;
      let stepX = plotW / count;
      let out = [];
      for (let i = 0; i < count; i++) {
        out.push({
          x: this._leftPad + (i + 0.5) * stepX,
          y: this._topPad + plotH - ((series[i] - yMin) / range) * plotH,
        });
      }
      return out;
    }

    vfunc_repaint() {
      let cr = this.get_context();
      try {
        let [width, height] = this.get_surface_size();
        if (!this._series.length || !this._series[0].length) return;

        let themeNode = this.get_theme_node();
        let fg = themeNode.get_foreground_color();
        let r = fg.red / 255, g = fg.green / 255, b = fg.blue / 255;
        let baseA = fg.alpha / 255;

        let { yMin, yMax, range } = this._yRange();

        let count = this._series[0].length;
        let plotX = this._leftPad;
        let plotY = this._topPad;
        let plotW = width - this._leftPad - this._rightPad;
        let plotH = height - this._topPad - this._bottomPad;
        let stepX = plotW / count;

        cr.selectFontFace('Sans', 0, 0);
        cr.setFontSize(11);

        let gridSteps = Math.max(2, Math.min(5, Math.round(range / 5)));

        // Horizontal grid + y-axis labels
        cr.setLineWidth(1);
        for (let i = 0; i <= gridSteps; i++) {
          let y = plotY + (plotH * i / gridSteps);
          cr.setSourceRGBA(r, g, b, baseA * 0.12);
          cr.moveTo(plotX, y);
          cr.lineTo(plotX + plotW, y);
          cr.stroke();

          let v = Math.round(yMax - (range * i / gridSteps));
          let txt = `${v}°`;
          let ext = cr.textExtents(txt);
          cr.setSourceRGBA(r, g, b, baseA * 0.65);
          cr.moveTo(plotX - ext.width - 4, y + ext.height / 2);
          cr.showText(txt);
        }

        // Vertical grid at each column center
        cr.setSourceRGBA(r, g, b, baseA * 0.08);
        cr.setLineWidth(1);
        for (let i = 0; i < count; i++) {
          let x = plotX + (i + 0.5) * stepX;
          cr.moveTo(x, plotY);
          cr.lineTo(x, plotY + plotH);
        }
        cr.stroke();

        // Axes
        cr.setSourceRGBA(r, g, b, baseA * 0.5);
        cr.setLineWidth(1);
        cr.moveTo(plotX, plotY);
        cr.lineTo(plotX, plotY + plotH);
        cr.lineTo(plotX + plotW, plotY + plotH);
        cr.stroke();

        // X-axis labels (anchored to graph bottom)
        if (this._xLabels.length) {
          cr.setSourceRGBA(r, g, b, baseA * 0.75);
          cr.setFontSize(11);
          for (let i = 0; i < this._xLabels.length; i++) {
            let x = plotX + (i + 0.5) * stepX;
            let txt = String(this._xLabels[i]);
            let ext = cr.textExtents(txt);
            cr.moveTo(x - ext.width / 2, plotY + plotH + 14);
            cr.showText(txt);
          }
        }

        // Series
        for (let s = 0; s < this._series.length; s++) {
          let data = this._series[s];
          let alphaMul = (s === 0) ? 1.0 : 0.6;
          cr.setSourceRGBA(r, g, b, baseA * alphaMul);
          cr.setLineWidth(2);

          cr.newPath();
          for (let i = 0; i < data.length; i++) {
            let x = plotX + (i + 0.5) * stepX;
            let y = plotY + plotH - ((data[i] - yMin) / range) * plotH;
            if (i === 0) cr.moveTo(x, y); else cr.lineTo(x, y);
          }
          cr.stroke();

          for (let i = 0; i < data.length; i++) {
            let x = plotX + (i + 0.5) * stepX;
            let y = plotY + plotH - ((data[i] - yMin) / range) * plotH;
            cr.newSubPath();
            cr.arc(x, y, 2.5, 0, 2 * Math.PI);
            cr.fill();
          }

          let labelRow = this._labels[s];
          if (labelRow) {
            cr.setFontSize(12);
            for (let i = 0; i < data.length; i++) {
              let x = plotX + (i + 0.5) * stepX;
              let y = plotY + plotH - ((data[i] - yMin) / range) * plotH;
              let txt = String(labelRow[i]);
              let ext = cr.textExtents(txt);
              let ty = (s === 0) ? y - 14 : y + ext.height + 4;
              cr.moveTo(x - ext.width / 2, ty);
              cr.showText(txt);
            }
            cr.setFontSize(11);
          }
        }
      } catch (e) {
        logError(e);
      } finally {
        cr.$dispose();
      }
    }
  }
);

let pillBox, statusArea, weather, network, networkIcon;
let _spacer = null;
let _indicator = null;

class CustomWeatherClient extends Signals.EventEmitter {
  constructor() {
    super();

    this._soupSession = new Soup.Session();
    this._temperature = 0;
    this._weatherCode = 0;
    this._latitude = "";
    this._longitude = "";
    this._useFarenheit = false;
    this._isDay = true;
    
    this._humidity = 0;
    this._windSpeed = 0;
    this._apparentTemperature = 0;
    this._precipitation = 0;
    this._cloudCover = 0;
    this._uvIndex = 0;
    this._isLoading = false;
    this._hourlyForecast = [];
    this._dailyForecast = [];

    this._updateCooldownTimer = null;
    this._updateCooldown = 1000;
    this._firstUpdate = true;
  }

  _buildRequestString() {
    const params = {
      latitude: this._latitude,
      longitude: this._longitude,
      current: "temperature_2m,weather_code,is_day,relative_humidity_2m,apparent_temperature,wind_speed_10m,precipitation,cloud_cover,uv_index",
      hourly: "temperature_2m,weather_code,is_day",
      daily: "weather_code,temperature_2m_max,temperature_2m_min",
      wind_speed_unit: "kmh",
      timezone: "auto"
    };

    if (this._useFarenheit) {
      params.temperature_unit = "fahrenheit";
    }

    return `https://api.open-meteo.com/v1/forecast?${Object.keys(params)
      .map((key) => `${key}=${params[key]}`)
      .join("&")}`;
  }

  _fetchWeather() {
    if (!this._latitude || !this._longitude) {
      return;
    }

    this._isLoading = true;
    this.emit("changed");

    let request = Soup.Message.new("GET", this._buildRequestString());

    this._soupSession.send_and_read_async(
      request,
      GLib.PRIORITY_DEFAULT,
      null,
      (session, result) => {
        try {
          let bytes = session.send_and_read_finish(result);
          let decoder = new TextDecoder("utf-8");
          let text = decoder.decode(bytes.get_data());
          let data = JSON.parse(text);

          this._temperature = Math.round(data.current.temperature_2m);
          this._weatherCode = data.current.weather_code;
          this._isDay = Boolean(data.current.is_day);
          
          this._humidity = Math.round(data.current.relative_humidity_2m);
          this._apparentTemperature = Math.round(data.current.apparent_temperature);
          this._windSpeed = Math.round(data.current.wind_speed_10m);
          this._precipitation = data.current.precipitation || 0;
          this._cloudCover = Math.round(data.current.cloud_cover || 0);
          this._uvIndex = data.current.uv_index || 0;

          // Parse Hourly Forecast (next 12 hours)
          this._hourlyForecast = [];
          if (data.hourly && data.hourly.time) {
            let now = new Date();
            // Find current hour index
            let currentIndex = 0;
            for (let i = 0; i < data.hourly.time.length; i++) {
              let timeStr = data.hourly.time[i];
              let t = new Date(timeStr);
              if (t >= now) {
                currentIndex = i;
                break;
              }
            }
            
            for (let i = currentIndex; i < Math.min(currentIndex + 24, data.hourly.time.length); i++) {
              let timeStr = data.hourly.time[i];
              let t = new Date(timeStr);
              this._hourlyForecast.push({
                time: t.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
                temp: Math.round(data.hourly.temperature_2m[i]),
                weatherCode: data.hourly.weather_code[i].toString(),
                isDay: Boolean(data.hourly.is_day[i])
              });
            }
          }

          // Parse Daily Forecast (next 5 days)
          this._dailyForecast = [];
          if (data.daily && data.daily.time) {
            for (let i = 1; i < Math.min(6, data.daily.time.length); i++) {
              let dateStr = data.daily.time[i];
              let d = new Date(dateStr);
              this._dailyForecast.push({
                day: d.toLocaleDateString([], { weekday: 'short' }),
                minTemp: Math.round(data.daily.temperature_2m_min[i]),
                maxTemp: Math.round(data.daily.temperature_2m_max[i]),
                weatherCode: data.daily.weather_code[i].toString()
              });
            }
          }

          this._isLoading = false;
          this.emit("changed");
        } catch (e) {
          logError(e);
          this._isLoading = false;
          this.emit("changed");
        }
      },
    );
  }

  update() {
    if (this._firstUpdate) {
      this._firstUpdate = false;
      this._fetchWeather();

      return;
    }

    if (this._updateCooldownTimer) {
      clearTimeout(this._updateCooldownTimer);
    }

    this._updateCooldownTimer = setTimeout(
      () => this._fetchWeather(),
      this._updateCooldown,
    );
  }

  updateSettings(latitude, longitude, useFarenheit) {
    this._latitude = latitude;
    this._longitude = longitude;
    this._useFarenheit = useFarenheit;

    this.update();
  }

  get_temp() {
    return this._temperature.toString();
  }

  get_symbolic_icon_name() {
    return weatherCodeToSymbolicIconName(this._weatherCode, this._isDay);
  }

  get_humidity() {
    return this._humidity.toString() + "%";
  }

  get_wind_speed() {
    return this._windSpeed.toString() + " km/h";
  }

  get_apparent_temp() {
    return this._apparentTemperature.toString();
  }
  
  get_coordinates() {
    return `Lat: ${parseFloat(this._latitude).toFixed(4)}, Lon: ${parseFloat(this._longitude).toFixed(4)}`;
  }
  
  get_precipitation() {
    return this._precipitation.toString() + " mm";
  }

  get_cloud_cover() {
    return this._cloudCover.toString() + "%";
  }

  get_uv_index() {
    return this._uvIndex.toString();
  }

  get_hourly_forecast() {
    return this._hourlyForecast;
  }

  get_daily_forecast() {
    return this._dailyForecast;
  }

  is_loading() {
    return this._isLoading;
  }

  cleanup() {
    this._soupSession.abort();
  }
}

export default class OpenMeteoWeatherExtension extends Extension {
  constructor(metadata) {
    super(metadata);

    this._settingsHandlerIds = null;
    this._position = null;
    this._settings = null;
    this._weather = null;
  }

  enable() {
    statusArea = Main.panel.statusArea;

    weather = new CustomWeatherClient();
    this._weather = weather;

    network = Main.panel._network;
    networkIcon = network ? network._primaryIndicator : null;

    if (!_indicator) {
      _indicator = new WeatherIndicator(weather, networkIcon);
      _indicator.add_style_class_name("weatherornot");
      _indicator.connect("button-press-event", () => {});
    }

    if (!_spacer) {
      _spacer = new WeatherIndicator(weather, networkIcon);
      _spacer.add_style_class_name("weatherornot-spacer");
      _spacer.reactive = false;
    }

    this._settings = this.getSettings();

    this._settingsHandlerIds = [
      this._settings.connect(
        "changed::position",
        this._addIndicator.bind(this),
      ),
      this._settings.connect("changed::unit", this._updateSettings.bind(this)),
      this._settings.connect(
        "changed::latitude",
        this._updateSettings.bind(this),
      ),
      this._settings.connect(
        "changed::longitude",
        this._updateSettings.bind(this),
      ),
    ];

    this._updateSettings();
    this._addIndicator();
  }

  _updateSettings() {
    const latitude = this._settings.get_double("latitude");
    const longitude = this._settings.get_double("longitude");
    const useFarenheit = this._settings.get_enum("unit");

    this._weather.updateSettings(latitude, longitude, useFarenheit === 1);
  }

  _addIndicator() {
    const currentIndicator = statusArea["OpenMeteoWeather"];
    const currentSpacer = statusArea["Spacer"];

    if (currentIndicator) {
      statusArea["OpenMeteoWeather"] = null;
    }

    if (currentSpacer) {
      statusArea["Spacer"].visible = false;
      statusArea["Spacer"] = null;
    }

    this._position = this._settings.get_enum("position");

    switch (this._position) {
      case 0:
        Main.panel._addToPanelBox(
          "OpenMeteoWeather",
          _indicator,
          -1,
          Main.panel._leftBox,
        );
        break;
      case 1:
        Main.panel._addToPanelBox(
          "OpenMeteoWeather",
          _indicator,
          0,
          Main.panel._centerBox,
        );
        Main.panel._addToPanelBox("Spacer", _spacer, -1, Main.panel._centerBox);
        statusArea["Spacer"].visible = true;
        break;
      case 2:
        Main.panel._addToPanelBox(
          "OpenMeteoWeather",
          _indicator,
          0,
          Main.panel._centerBox,
        );
        break;
      case 3:
        Main.panel._addToPanelBox(
          "OpenMeteoWeather",
          _indicator,
          -1,
          Main.panel._centerBox,
        );
        break;
      case 4:
        Main.panel._addToPanelBox(
          "OpenMeteoWeather",
          _indicator,
          -1,
          Main.panel._centerBox,
        );
        Main.panel._addToPanelBox("Spacer", _spacer, 0, Main.panel._centerBox);
        statusArea["Spacer"].visible = true;
        break;
      case 5:
        Main.panel._addToPanelBox(
          "OpenMeteoWeather",
          _indicator,
          1,
          Main.panel._rightBox,
        );
    }
  }

  disable() {
    this._settingsHandlerIds.forEach((settingId) =>
      this._settings.disconnect(settingId),
    );

    this._settingsHandlerIds = null;
    this._settings = null;

    if (_spacer) {
      _spacer.destroy();
      _spacer = null;
    }

    if (_indicator) {
      _indicator.destroy();
      _indicator = null;
    }

    pillBox = null;
    weather = null;
  }
}

const WeatherIndicator = GObject.registerClass(
  {
    GTypeName: "WeatherIndicator",
  },
  class WeatherIndicator extends PanelMenu.Button {
    _init(weather, networkIcon) {
      super._init(0.5, "OpenMeteoWeather", false);
      this.y_align = Clutter.ActorAlign.CENTER;
      this.visible = false;
      this.menu.box.add_style_class_name('weather-popup-menu');

      this._weather = weather;
      this._networkIcon = networkIcon;

      this._signals = [];

      this._icon = new St.Icon({
        y_align: Clutter.ActorAlign.CENTER,
        style_class: "system-status-icon",
      });

      this._label = new St.Label({
        y_align: Clutter.ActorAlign.CENTER,
        style_class: "system-status-label",
      });

      let pillBox = new St.BoxLayout({
        y_align: Clutter.ActorAlign.CENTER,
        style_class: "panel-status-menu-box",
      });

      pillBox.add_child(this._icon);
      pillBox.add_child(this._label);

      this.add_child(pillBox);

      // Top Stats Section
      this._statsMenuItem = new PopupMenu.PopupBaseMenuItem({ reactive: false, can_focus: false });
      let mainStatsLayout = new St.BoxLayout({ vertical: false, style_class: 'weather-stats-main-box', x_expand: true });
      this._statsMenuItem.add_child(mainStatsLayout);

      let statsLayout = new St.BoxLayout({ vertical: true, style_class: 'weather-stats-box', x_expand: true });
      
      // Row 1: Feels like, Humidity
      let row1 = new St.BoxLayout({ vertical: false, style_class: 'weather-stats-row' });
      this._feelsLikeLabel = new St.Label({ style_class: 'weather-stat-label' });
      this._humidityLabel = new St.Label({ style_class: 'weather-stat-label' });
      row1.add_child(this._feelsLikeLabel);
      row1.add_child(this._humidityLabel);
      statsLayout.add_child(row1);

      // Row 2: Wind, Precipitation
      let row2 = new St.BoxLayout({ vertical: false, style_class: 'weather-stats-row' });
      this._windSpeedLabel = new St.Label({ style_class: 'weather-stat-label' });
      this._precipitationLabel = new St.Label({ style_class: 'weather-stat-label' });
      row2.add_child(this._windSpeedLabel);
      row2.add_child(this._precipitationLabel);
      statsLayout.add_child(row2);
      
      // Row 3: Cloud Cover, UV Index
      let row3 = new St.BoxLayout({ vertical: false, style_class: 'weather-stats-row' });
      this._cloudCoverLabel = new St.Label({ style_class: 'weather-stat-label' });
      this._uvIndexLabel = new St.Label({ style_class: 'weather-stat-label' });
      row3.add_child(this._cloudCoverLabel);
      row3.add_child(this._uvIndexLabel);
      statsLayout.add_child(row3);

      mainStatsLayout.add_child(statsLayout);

      let refreshContainer = new St.BoxLayout({ vertical: true, y_align: Clutter.ActorAlign.CENTER, x_align: Clutter.ActorAlign.END });
      let refreshButton = new St.Button({ style_class: 'weather-refresh-button-large', can_focus: true });
      refreshButton.add_child(new St.Icon({ icon_name: 'view-refresh-symbolic', style_class: 'weather-refresh-icon-large' }));
      refreshButton.connect('clicked', () => {
        this._weather.update();
      });
      refreshContainer.add_child(refreshButton);
      mainStatsLayout.add_child(refreshContainer);

      this.menu.addMenuItem(this._statsMenuItem);
      // Hourly Forecast
      let hourlyTitleItem = new PopupMenu.PopupBaseMenuItem({ reactive: false, can_focus: false });
      hourlyTitleItem.add_style_class_name('weather-section-title-item');
      let hourlyTitle = new St.Label({ text: "Next 24 Hours", style_class: 'weather-title-label' });
      hourlyTitleItem.add_child(hourlyTitle);
      this.menu.addMenuItem(hourlyTitleItem);
      
      this._hourlyScrollView = new St.ScrollView({
        style_class: 'weather-hourly-scrollview',
        hscrollbar_policy: St.PolicyType.EXTERNAL,
        vscrollbar_policy: St.PolicyType.NEVER,
        enable_mouse_scrolling: true,
        overlay_scrollbars: true,
      });
      this._hourlyGraph = new ForecastGraph({
        style_class: 'weather-graph weather-hourly-graph',
        _topPad: 10,
        _graphHeight: 180,
        _bottomPad: 22,
        _rangePadRatio: 0.1,
        _topReservePx: 48,
      });
      this._hourlyIconLayer = new Clutter.Actor({ layout_manager: new Clutter.FixedLayout(), x_align: Clutter.ActorAlign.FILL, y_align: Clutter.ActorAlign.FILL, x_expand: true, y_expand: true });
      let hourlyOverlay = new St.Widget({ layout_manager: new Clutter.BinLayout() });
      hourlyOverlay.add_child(this._hourlyGraph);
      hourlyOverlay.add_child(this._hourlyIconLayer);
      let hourlyScrollHost = new St.BoxLayout({ vertical: false });
      hourlyScrollHost.add_child(hourlyOverlay);
      this._hourlyScrollView.set_child(hourlyScrollHost);
      
      this._hourlyMenuItem = new PopupMenu.PopupBaseMenuItem({ reactive: true, can_focus: false });
      this._hourlyMenuItem.add_style_class_name('weather-graph-item');
      this._hourlyMenuItem.activate = () => {};
      this._hourlyMenuItem.add_child(this._hourlyScrollView);
      this.menu.addMenuItem(this._hourlyMenuItem);

      // Daily Forecast
      let dailyTitleItem = new PopupMenu.PopupBaseMenuItem({ reactive: false, can_focus: false });
      dailyTitleItem.add_style_class_name('weather-section-title-item');
      let dailyTitle = new St.Label({ text: "Next 5 Days", style_class: 'weather-title-label' });
      dailyTitleItem.add_child(dailyTitle);
      this.menu.addMenuItem(dailyTitleItem);

      this._dailyGraph = new ForecastGraph({
        style_class: 'weather-graph weather-daily-graph',
        _topPad: 10,
        _graphHeight: 180,
        _bottomPad: 22,
        _topReservePx: 18,
        _botReservePx: 22,
      });
      this._dailyIconLayer = new Clutter.Actor({ layout_manager: new Clutter.FixedLayout(), x_align: Clutter.ActorAlign.FILL, y_align: Clutter.ActorAlign.FILL, x_expand: true, y_expand: true });
      let dailyOverlay = new St.Widget({ layout_manager: new Clutter.BinLayout(), style_class: 'weather-daily-overlay' });
      dailyOverlay.add_child(this._dailyGraph);
      dailyOverlay.add_child(this._dailyIconLayer);
      this._dailyMenuItem = new PopupMenu.PopupBaseMenuItem({ reactive: true, can_focus: false });
      this._dailyMenuItem.add_style_class_name('weather-graph-item');
      this._dailyMenuItem.activate = () => {};
      this._dailyMenuItem.add_child(dailyOverlay);
      this.menu.addMenuItem(this._dailyMenuItem);

      this._pushSignal(
        this._weather,
        "changed",
        this._onWeatherInfoUpdate.bind(this),
      );

      this._pushSignal(this, "destroy", this._onDestroy.bind(this));

      if (this._networkIcon) {
        this._pushSignal(
          this._networkIcon,
          "notify::icon-name",
          this._onNetworkIconNotifyEvents.bind(this),
        );
        this._pushSignal(
          this._networkIcon,
          "notify::visible",
          this._onNetworkIconNotifyEvents.bind(this),
        );
        if (this._networkIcon.visible) {
          this._weather.update();
          this._StartLongTermUpdateTimeout();
        }
      } else {
        this._weather.update();
        this._StartLongTermUpdateTimeout();
      }
    }

    _pushSignal(obj, signalName, callback) {
      this._signals.push({
        obj: obj,
        signalId: obj.connect(signalName, callback),
      });
    }

    _onWeatherInfoUpdate(weather) {
      if (weather.is_loading()) {
        this._icon.icon_name = "process-working-symbolic";
        this._label.text = "Loading...";
      } else {
        this._icon.icon_name = weather.get_symbolic_icon_name();
        this._label.text = weather.get_temp();
        
        // Update popup menu text
        this._feelsLikeLabel.clutter_text.set_markup(`<b>Feels like:</b> ${weather.get_apparent_temp()}°`);
        this._humidityLabel.clutter_text.set_markup(`<b>Humidity:</b> ${weather.get_humidity()}`);
        this._windSpeedLabel.clutter_text.set_markup(`<b>Wind:</b> ${weather.get_wind_speed()}`);
        this._precipitationLabel.clutter_text.set_markup(`<b>Precip:</b> ${weather.get_precipitation()}`);
        this._cloudCoverLabel.clutter_text.set_markup(`<b>Clouds:</b> ${weather.get_cloud_cover()}`);
        this._uvIndexLabel.clutter_text.set_markup(`<b>UV Index:</b> ${weather.get_uv_index()}`);
        
        // Update Hourly Forecast
        let hourly = weather.get_hourly_forecast();
        let hourlyTemps = hourly.map(f => f.temp);
        let hourlyValueLabels = hourly.map(f => `${f.temp}°`);
        let hourlyXLabels = hourly.map(f => f.time);
        this._hourlyGraph.setData([hourlyTemps], [hourlyValueLabels], hourlyXLabels, 80);
        let hPos = this._hourlyGraph.getPointPositions(0);
        this._placeIcons(
          this._hourlyIconLayer,
          hourly,
          f => weatherCodeToSymbolicIconName(f.weatherCode, f.isDay),
          i => ({ x: hPos[i].x, y: hPos[i].y - 36 }),
        );

        // Update Daily Forecast
        let daily = weather.get_daily_forecast();
        let dailyMax = daily.map(f => f.maxTemp);
        let dailyMin = daily.map(f => f.minTemp);
        let dailyLabelsMax = daily.map(f => `${f.maxTemp}°`);
        let dailyLabelsMin = daily.map(f => `${f.minTemp}°`);
        let dailyXLabels = daily.map(f => f.day);
        this._dailyGraph.setData([dailyMax, dailyMin], [dailyLabelsMax, dailyLabelsMin], dailyXLabels, 66);
        let dMaxPos = this._dailyGraph.getPointPositions(0);
        let dMinPos = this._dailyGraph.getPointPositions(1);
        this._placeIcons(
          this._dailyIconLayer,
          daily,
          f => weatherCodeToSymbolicIconName(f.weatherCode, true),
          i => ({ x: dMaxPos[i].x, y: (dMaxPos[i].y + dMinPos[i].y) / 2 }),
        );
      }

      this.visible = !!(this._icon.icon_name && this._label.text);
    }

    _placeIcons(layer, forecasts, iconNameFor, positionFn) {
      layer.remove_all_children();
      let iconSize = 20;
      for (let i = 0; i < forecasts.length; i++) {
        let pos = positionFn(i);
        if (!pos) continue;
        let icon = new St.Icon({
          icon_name: iconNameFor(forecasts[i]),
          icon_size: iconSize,
          style_class: 'weather-point-icon',
        });
        icon.set_size(iconSize, iconSize);
        icon.set_position(Math.round(pos.x - iconSize / 2), Math.round(pos.y - iconSize / 2));
        layer.add_child(icon);
      }
    }

    _onNetworkIconNotifyEvents(networkIcon) {
      if (networkIcon.visible && !this.visible) {
        this._weather.update();
        this._StartLongTermUpdateTimeout();
      } else if (!networkIcon.visible) {
        this._cancelLongTermUpdateTimeout();
        this.visible = false;
      }
    }

    _StartLongTermUpdateTimeout() {
      this._cancelLongTermUpdateTimeout();

      this._weatherUpdateTimeout = GLib.timeout_add_seconds(
        GLib.PRIORITY_LOW,
        3600,
        () => {
          this._weather.update();
          return GLib.SOURCE_CONTINUE;
        },
      );
    }

    _cancelLongTermUpdateTimeout() {
      if (this._weatherUpdateTimeout) {
        GLib.source_remove(this._weatherUpdateTimeout);
      }

      this._weatherUpdateTimeout = null;
    }

    _onDestroy() {
      this._cancelLongTermUpdateTimeout();
      this._signals.forEach((signal) => signal.obj.disconnect(signal.signalId));
      this._signals = null;
      this._weather.cleanup();
      this._weather = null;
      this._networkIcon = null;
    }
  },
);
