const si = require('systeminformation');
const http = require('node:http');
const { runPSJson } = require('./ps');

// Virtual / remote-desktop display adapters that are not real GPUs.
const FAKE_ADAPTER = /(idd|virtual|basic display|basic render|parsec|anyviewer|remote|citrix|vmware|hyper-v|spacedesk|oray|sunlogin|todesk|displaylink|usb mobile monitor|mirage|splashtop|teamviewer)/i;
const LAPTOP_CHASSIS = [8, 9, 10, 11, 14, 30, 31, 32];

const WIN_SCRIPT = String.raw`
$ErrorActionPreference='SilentlyContinue'
$r=@{}
$r.isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
$r.mem = @(Get-CimInstance Win32_PhysicalMemory | ForEach-Object { @{ slot=[string]$_.DeviceLocator; cap=[double]$_.Capacity; rated=[int]$_.Speed; conf=[int]$_.ConfiguredClockSpeed; mfr=[string]$_.Manufacturer; part=([string]$_.PartNumber).Trim() } })
$r.memSlots = [int](Get-CimInstance Win32_PhysicalMemoryArray | Measure-Object MemoryDevices -Sum).Sum
$os = Get-CimInstance Win32_OperatingSystem
$r.os = @{ caption=[string]$os.Caption; installDate=$os.InstallDate.ToString('o'); lastBoot=$os.LastBootUpTime.ToString('o') }
$r.chassis = @((Get-CimInstance Win32_SystemEnclosure).ChassisTypes | ForEach-Object { [int]$_ })
$c = Get-CimInstance Win32_Processor | Select-Object -First 1
$r.cpu = @{ name=([string]$c.Name).Trim(); base=[int]$c.MaxClockSpeed; cores=[int]$c.NumberOfCores; threads=[int]$c.NumberOfLogicalProcessors; socket=[string]$c.SocketDesignation; virt=[bool]$c.VirtualizationFirmwareEnabled }
$b = Get-CimInstance Win32_BIOS
$r.bios = @{ vendor=[string]$b.Manufacturer; version=[string]$b.SMBIOSBIOSVersion; date=$(if($b.ReleaseDate){$b.ReleaseDate.ToString('o')}else{$null}) }
$bb = Get-CimInstance Win32_BaseBoard
$r.board = @{ mfr=[string]$bb.Manufacturer; product=[string]$bb.Product }
$r.disks = @()
Get-PhysicalDisk | ForEach-Object {
  $d = $_; $rc = $null
  try { $rc = $d | Get-StorageReliabilityCounter -ErrorAction Stop } catch {}
  $r.disks += @{ id=[string]$d.DeviceId; name=[string]$d.FriendlyName; media=[string]$d.MediaType; bus=[string]$d.BusType; health=[string]$d.HealthStatus; size=[double]$d.Size; poh=$rc.PowerOnHours; wear=$rc.Wear; temp=$rc.Temperature; readUnc=$rc.ReadErrorsUncorrected; writeUnc=$rc.WriteErrorsUncorrected; hasCounters=($rc -ne $null) }
}
$r.bootDisk = [string](Get-Partition -DriveLetter ($env:SystemDrive.TrimEnd(':')) | Select-Object -First 1).DiskNumber
$lic = Get-CimInstance SoftwareLicensingProduct -Filter "ApplicationID='55c92734-d682-4d71-983e-d6ec3f16059f' AND PartialProductKey IS NOT NULL" -Property LicenseStatus,Description,ProductKeyChannel,KeyManagementServiceMachine,Name | Select-Object -First 1
$r.license = @{ status=[int]$lic.LicenseStatus; desc=[string]$lic.Description; kms=[string]$lic.KeyManagementServiceMachine; channel=[string]$lic.ProductKeyChannel; found=($lic -ne $null) }
$r.monitors = @(Get-CimInstance -Namespace root/wmi WmiMonitorID | ForEach-Object { @{ inst=[string]$_.InstanceName; name=(($_.UserFriendlyName | Where-Object {$_ -ne 0} | ForEach-Object {[char]$_}) -join ''); year=[int]$_.YearOfManufacture } })
$r.thermal = @()
if ($r.isAdmin) { $r.thermal = @(Get-CimInstance -Namespace root/wmi MSAcpi_ThermalZoneTemperature | ForEach-Object { [math]::Round(($_.CurrentTemperature/10)-273.15,1) }) }
Add-Type -TypeDefinition @"
using System; using System.Runtime.InteropServices; using System.Collections.Generic;
public class IicDisp {
 [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)]
 public struct DEVMODE { [MarshalAs(UnmanagedType.ByValTStr, SizeConst=32)] public string dmDeviceName; public short dmSpecVersion; public short dmDriverVersion; public short dmSize; public short dmDriverExtra; public int dmFields; public int dmPositionX; public int dmPositionY; public int dmDisplayOrientation; public int dmDisplayFixedOutput; public short dmColor; public short dmDuplex; public short dmYResolution; public short dmTTOption; public short dmCollate; [MarshalAs(UnmanagedType.ByValTStr, SizeConst=32)] public string dmFormName; public short dmLogPixels; public int dmBitsPerPel; public int dmPelsWidth; public int dmPelsHeight; public int dmDisplayFlags; public int dmDisplayFrequency; public int dmICMMethod; public int dmICMIntent; public int dmMediaType; public int dmDitherType; public int dmReserved1; public int dmReserved2; public int dmPanningWidth; public int dmPanningHeight; }
 [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)]
 public struct DISPLAY_DEVICE { public int cb; [MarshalAs(UnmanagedType.ByValTStr, SizeConst=32)] public string DeviceName; [MarshalAs(UnmanagedType.ByValTStr, SizeConst=128)] public string DeviceString; public int StateFlags; [MarshalAs(UnmanagedType.ByValTStr, SizeConst=128)] public string DeviceID; [MarshalAs(UnmanagedType.ByValTStr, SizeConst=128)] public string DeviceKey; }
 [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern bool EnumDisplaySettingsW(string name, int mode, ref DEVMODE dm);
 [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern bool EnumDisplayDevicesW(string dev, uint i, ref DISPLAY_DEVICE dd, uint flags);
 public static List<string> Scan() {
  var res = new List<string>();
  for (uint i = 0; i < 16; i++) {
   var dd = new DISPLAY_DEVICE(); dd.cb = Marshal.SizeOf(dd);
   if (!EnumDisplayDevicesW(null, i, ref dd, 0)) break;
   if ((dd.StateFlags & 1) == 0) continue;
   var cur = new DEVMODE(); cur.dmSize = (short)Marshal.SizeOf(cur);
   EnumDisplaySettingsW(dd.DeviceName, -1, ref cur);
   int maxSame = 0, maxAny = 0, maxW = 0, maxH = 0;
   for (int j = 0; j < 5000; j++) {
    var m = new DEVMODE(); m.dmSize = (short)Marshal.SizeOf(m);
    if (!EnumDisplaySettingsW(dd.DeviceName, j, ref m)) break;
    if (m.dmDisplayFrequency > maxAny) maxAny = m.dmDisplayFrequency;
    if (m.dmPelsWidth == cur.dmPelsWidth && m.dmPelsHeight == cur.dmPelsHeight && m.dmDisplayFrequency > maxSame) maxSame = m.dmDisplayFrequency;
    if ((long)m.dmPelsWidth * m.dmPelsHeight > (long)maxW * maxH) { maxW = m.dmPelsWidth; maxH = m.dmPelsHeight; }
   }
   res.Add(dd.DeviceName + "|" + dd.DeviceString + "|" + cur.dmPelsWidth + "|" + cur.dmPelsHeight + "|" + cur.dmDisplayFrequency + "|" + maxSame + "|" + maxAny + "|" + maxW + "|" + maxH);
  }
  return res;
 }
}
"@
$r.modes = @([IicDisp]::Scan() | ForEach-Object { $p = $_.Split('|'); @{ dev=$p[0]; adapter=$p[1]; w=[int]$p[2]; h=[int]$p[3]; hz=[int]$p[4]; maxHz=[int]$p[5]; maxHzAny=[int]$p[6]; nativeW=[int]$p[7]; nativeH=[int]$p[8] } })
$r | ConvertTo-Json -Depth 5 -Compress
`;

const gb = (b) => Math.round((b / 1073741824) * 10) / 10;

function checkInternet() {
  return new Promise((resolve) => {
    const t0 = Date.now();
    // Same endpoint Windows itself uses to decide "connected to the internet".
    const req = http.get('http://www.msftconnecttest.com/connecttest.txt', { timeout: 5000 }, (res) => {
      res.resume();
      res.on('end', () => resolve({ online: res.statusCode === 200, latencyMs: Date.now() - t0 }));
    });
    req.on('timeout', () => {
      req.destroy();
      resolve({ online: false });
    });
    req.on('error', () => resolve({ online: false }));
  });
}

async function collectSystemInfo() {
  const [cpu, mem, memLayout, diskLayout, fsSize, graphics, battery, sys, osInfo, net, temp, win, internet] = await Promise.all([
    si.cpu(), si.mem(), si.memLayout(), si.diskLayout(), si.fsSize(), si.graphics(), si.battery(), si.system(),
    si.osInfo(), si.networkInterfaces(), si.cpuTemperature(), runPSJson(WIN_SCRIPT, { timeoutMs: 45000 }), checkInternet(),
  ]);
  const w = win || {};

  const isLaptop = (w.chassis || []).some((c) => LAPTOP_CHASSIS.includes(c)) || battery.hasBattery;

  // ---- CPU
  const cpuName = (w.cpu?.name || `${cpu.manufacturer} ${cpu.brand}`).replace(/\(R\)|\(TM\)|™|®/gi, '').replace(/ CPU @ .*$| @ .*$/i, '').replace(/ with Radeon.*$/i, '').replace(/\s+/g, ' ').trim();
  const mobileSuffix = /\d{4,5}(U|H|HS|HX|HK|G|GE|T|Y)\b/i.test(cpuName) || /Ryzen (AI|Z)/i.test(cpuName);
  const cpuInfo = {
    name: cpuName,
    vendor: cpu.manufacturer,
    cores: w.cpu?.cores || cpu.physicalCores,
    threads: w.cpu?.threads || cpu.cores,
    baseGHz: w.cpu?.base ? w.cpu.base / 1000 : cpu.speed,
    socket: w.cpu?.socket || cpu.socket,
    // Overclockable: Intel K/KF/KS chips, all desktop Ryzen.
    unlocked: /\d{4,5}K[FS]?\b/i.test(cpuName) || (/Ryzen/i.test(cpuName) && !mobileSuffix),
    virtualization: w.cpu?.virt ?? null,
  };

  // ---- RAM
  const rawSticks = w.mem && w.mem.length
    ? w.mem
    : memLayout.map((m) => ({ cap: m.size, rated: m.clockSpeed, conf: m.clockSpeed, mfr: m.manufacturer, part: m.partNum, slot: m.bank }));
  const sticks = rawSticks
    .filter((s) => s.cap > 0)
    .map((s, i) => ({
      sizeGB: gb(s.cap),
      ratedMHz: s.rated || null,
      runningMHz: s.conf || s.rated || null,
      maker: (s.mfr || '').trim(),
      part: (s.part || '').trim(),
      slot: s.slot,
      type: memLayout[i]?.type || '',
      formFactor: memLayout[i]?.formFactor || '',
    }));
  const ram = {
    totalGB: gb(mem.total),
    installedGB: Math.round(sticks.reduce((a, s) => a + s.sizeGB, 0)) || gb(mem.total),
    sticks,
    slots: w.memSlots || null,
    type: sticks[0]?.type || '',
    singleStick: sticks.length === 1,
    mixed: new Set(sticks.map((s) => `${s.sizeGB}-${s.ratedMHz}`)).size > 1,
  };

  // ---- GPU
  const gpus = graphics.controllers
    .filter((g) => !FAKE_ADAPTER.test(`${g.vendor} ${g.model}`))
    .map((g) => {
      const name = (g.name || g.model || '').replace(/\(R\)|\(TM\)/gi, '').replace(/\s+/g, ' ').trim();
      const discrete = /nvidia|geforce|quadro|rtx|radeon rx|radeon pro|arc a\d|arc b\d/i.test(name) || (g.vramDynamic === false && !/intel.*(uhd|iris|hd graphics)/i.test(name));
      return {
        name,
        vendor: g.vendor,
        vramGB: g.vram ? Math.round((g.vram / 1024) * 10) / 10 : null,
        discrete,
        driver: g.driverVersion || null,
        tempC: g.temperatureGpu ?? null,
      };
    })
    .sort((a, b) => Number(b.discrete) - Number(a.discrete) || (b.vramGB || 0) - (a.vramGB || 0));

  // ---- Displays
  const displays = graphics.displays
    .map((d) => {
      const mode = (w.modes || []).find((m) => (m.dev || '').toLowerCase() === (d.deviceName || '').toLowerCase());
      const idKey = (d.displayId || '').toLowerCase().split('\\').slice(0, 2).join('\\');
      const mon = idKey ? (w.monitors || []).find((m) => (m.inst || '').toLowerCase().startsWith(idKey)) : null;
      const monName = (mon?.name || '').replace(/[\u0000-\u001f]/g, '').trim();
      // Windows' own display-mode list is the truth; systeminformation's refresh rate can be stale.
      const hz = mode?.hz || d.currentRefreshRate;
      return {
        name: monName || (d.builtin ? 'Built-in screen' : d.model && d.model !== 'Default Monitor' ? d.model : 'External monitor'),
        builtin: d.builtin,
        connection: d.connection,
        width: mode?.w || d.currentResX,
        height: mode?.h || d.currentResY,
        nativeWidth: mode?.nativeW || d.resolutionX,
        nativeHeight: mode?.nativeH || d.resolutionY,
        hz,
        maxHz: mode ? Math.max(mode.maxHz || 0, hz || 0) : hz,
        maxHzAnyRes: mode?.maxHzAny || null,
        adapter: mode?.adapter || null,
        year: mon?.year || null,
        sizeInch: d.sizeX && d.sizeY ? Math.round((Math.sqrt(d.sizeX ** 2 + d.sizeY ** 2) / 2.54) * 10) / 10 : null,
        main: d.main,
      };
    })
    .filter((d) => d.width);

  // ---- Storage
  const disks = diskLayout.map((d, i) => {
    const wd = (w.disks || []).find((x) => String(x.id) === String(i)) || (w.disks || []).find((x) => x.name === d.name) || {};
    const iface = `${d.interfaceType || ''} ${wd.bus || ''}`;
    const usb = /usb/i.test(iface);
    const kind = usb ? 'USB drive'
      : /nvme/i.test(iface) ? 'NVMe SSD'
      : d.type === 'SSD' || wd.media === 'SSD' ? 'SATA SSD'
      : d.type === 'HD' || wd.media === 'HDD' ? 'Hard drive (HDD)'
      : 'Unknown';
    return {
      name: (d.name || wd.name || 'Drive').trim(),
      kind,
      sizeGB: Math.round(d.size / 1e9),
      usb,
      smart: d.smartStatus,
      health: wd.health || null,
      powerOnHours: wd.poh ?? null,
      wearPct: wd.wear ?? null,
      tempC: wd.temp || d.temperature || null,
      readErrors: wd.readUnc ?? null,
      writeErrors: wd.writeUnc ?? null,
      hasCounters: !!wd.hasCounters,
      firmware: d.firmwareRevision,
      isBoot: w.bootDisk != null && w.bootDisk !== '' && String(w.bootDisk) === String(wd.id ?? i),
    };
  });
  const volumes = fsSize
    .filter((v) => v.size > 0 && /^[A-Z]:/i.test(v.mount))
    .map((v) => ({ mount: v.mount, sizeGB: Math.round(v.size / 1e9), freeGB: Math.round(v.available / 1e9), usedPct: Math.round(v.use) }));

  // ---- Battery
  const bat = battery.hasBattery
    ? {
        has: true,
        designedWh: battery.designedCapacity ? Math.round(battery.designedCapacity / 100) / 10 : null,
        maxWh: battery.maxCapacity ? Math.round(battery.maxCapacity / 100) / 10 : null,
        healthPct: battery.designedCapacity && battery.maxCapacity ? Math.min(100, Math.round((battery.maxCapacity / battery.designedCapacity) * 100)) : null,
        cycles: battery.cycleCount || null,
        percent: battery.percent,
        charging: battery.isCharging,
        plugged: battery.acConnected,
        model: battery.model,
      }
    : { has: false };

  // ---- Windows
  const lic = w.license || {};
  const kmsMachine = (lic.kms || '').trim();
  const caption = w.os?.caption || osInfo.distro || '';
  const now = Date.now();
  const winInfo = {
    name: caption,
    build: osInfo.build,
    arch: osInfo.arch,
    installDate: w.os?.installDate || null,
    installedDaysAgo: w.os?.installDate ? Math.floor((now - Date.parse(w.os.installDate)) / 86400000) : null,
    uptimeHours: w.os?.lastBoot ? Math.round((now - Date.parse(w.os.lastBoot)) / 3600000) : null,
    activated: lic.found ? lic.status === 1 : null,
    channel: lic.channel || '',
    // Home/Pro activated through a volume-licence (KMS) server, or a localhost KMS, is the
    // fingerprint of pirate activators. Real KMS is only normal for company Enterprise/Education PCs.
    sketchyActivation:
      (/VOLUME_KMSCLIENT/i.test(lic.desc || '') && /home|pro/i.test(caption) && !/enterprise|education/i.test(caption)) ||
      /^(127\.|localhost|0\.0\.0\.0)/i.test(kmsMachine),
  };

  // ---- Network
  const adapters = net.filter((n) => !n.virtual && !n.internal && !/(loopback|vethernet|vmware|virtualbox|bluetooth|tap-|wintun|wan miniport|zerotier|tailscale|hamachi)/i.test(n.ifaceName || n.iface));
  const isWifi = (n) => n.type === 'wireless' || /wi-?fi|wireless|wlan|802\.11/i.test(n.ifaceName || n.iface);
  const network = {
    wifi: adapters.some(isWifi),
    ethernet: adapters.some((n) => !isWifi(n) && /ethernet|gbe|lan|realtek|intel.*i2\d\d|killer e/i.test(n.ifaceName || n.iface)),
    adapters: adapters.map((n) => ({ name: n.ifaceName || n.iface, wifi: isWifi(n), up: n.operstate === 'up', speedMbps: n.speed })),
    ...internet,
  };

  const temps = {
    cpuC: temp.main ?? (w.thermal && w.thermal.length ? Math.max(...w.thermal) : null),
  };

  return {
    isAdmin: !!w.isAdmin,
    psOk: !!win,
    system: { maker: sys.manufacturer, model: sys.model, isLaptop, virtual: sys.virtual, board: w.board || null, bios: w.bios || null },
    cpu: cpuInfo,
    ram,
    gpus,
    displays,
    disks,
    volumes,
    battery: bat,
    windows: winInfo,
    network,
    temps,
  };
}

async function listUsb() {
  try {
    const list = await si.usb();
    return list
      .filter((d) => d.name && !/hub|root|host controller|composite/i.test(d.name))
      .map((d) => ({ id: `${d.id}|${d.deviceId || ''}|${d.name}`, name: d.name, type: d.type }));
  } catch {
    return [];
  }
}

async function gpuTemps() {
  try {
    const g = await si.graphics();
    return g.controllers.filter((c) => c.temperatureGpu != null).map((c) => ({ name: c.name || c.model, tempC: c.temperatureGpu }));
  } catch {
    return [];
  }
}

module.exports = { collectSystemInfo, listUsb, gpuTemps };
