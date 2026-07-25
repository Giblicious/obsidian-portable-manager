using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Reflection;
using System.Web.Script.Serialization;
using System.Windows.Forms;

[assembly: AssemblyTitle("Obsidian Portable")]
[assembly: AssemblyDescription("Drive-independent launcher for a portable Obsidian workspace")]
[assembly: AssemblyCompany("Giblicious")]
[assembly: AssemblyProduct("Obsidian Portable Launcher")]
[assembly: AssemblyCopyright("Copyright (c) 2026 Giblicious")]
[assembly: AssemblyVersion("0.1.0.0")]
[assembly: AssemblyFileVersion("0.1.0.0")]

internal static class PortableLauncher
{
    private const string ConfigRelativePath = @"Apps\Portables\ObsidianPortable\portable.ini";

    [STAThread]
    private static int Main(string[] args)
    {
        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);
        try
        {
            string driveRoot = Path.GetPathRoot(AppDomain.CurrentDomain.BaseDirectory);
            if (String.IsNullOrEmpty(driveRoot)) throw new InvalidOperationException("The portable drive root could not be determined.");
            Dictionary<string, string> config = ReadConfig(Path.Combine(driveRoot, ConfigRelativePath));
            string appExe = ResolveUnderRoot(driveRoot, Require(config, "App"));
            string dataDir = ResolveUnderRoot(driveRoot, Require(config, "Data"));
            string vaultDir = ResolveUnderRoot(driveRoot, Require(config, "Vault"));
            string vaultId = Require(config, "VaultId");
            ValidateLayout(appExe, vaultDir, vaultId);

            if (HasArgument(args, "--check")) return 0;
            Directory.CreateDirectory(dataDir);
            RepairVaultRegistry(dataDir, vaultDir, vaultId);
            if (HasArgument(args, "--repair-only")) return 0;

            ProcessStartInfo start = new ProcessStartInfo {
                FileName = appExe,
                WorkingDirectory = Path.GetDirectoryName(appExe),
                Arguments = "--user-data-dir=\"" + dataDir + "\"",
                UseShellExecute = true
            };
            Process.Start(start);
            return 0;
        }
        catch (Exception ex)
        {
            MessageBox.Show(ex.Message + "\r\n\r\nSee README - Obsidian Portable.txt on the flash drive.", "Obsidian Portable could not start", MessageBoxButtons.OK, MessageBoxIcon.Error);
            return 1;
        }
    }

    private static bool HasArgument(string[] args, string value) { foreach (string arg in args) if (String.Equals(arg, value, StringComparison.OrdinalIgnoreCase)) return true; return false; }

    private static Dictionary<string, string> ReadConfig(string configPath)
    {
        if (!File.Exists(configPath)) throw new FileNotFoundException("Portable configuration is missing:", configPath);
        Dictionary<string, string> result = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        foreach (string rawLine in File.ReadAllLines(configPath))
        {
            string line = rawLine.Trim();
            if (line.Length == 0 || line.StartsWith("#") || line.StartsWith(";")) continue;
            int separator = line.IndexOf('=');
            if (separator > 0) result[line.Substring(0, separator).Trim()] = line.Substring(separator + 1).Trim();
        }
        return result;
    }

    private static string Require(Dictionary<string, string> config, string key)
    {
        string value;
        if (!config.TryGetValue(key, out value) || String.IsNullOrWhiteSpace(value)) throw new InvalidDataException("portable.ini is missing the " + key + " setting.");
        return value;
    }

    private static string ResolveUnderRoot(string root, string relative)
    {
        if (Path.IsPathRooted(relative)) throw new InvalidDataException("portable.ini paths must be drive-relative: " + relative);
        string fullRoot = Path.GetFullPath(root).TrimEnd(Path.DirectorySeparatorChar) + Path.DirectorySeparatorChar;
        string fullPath = Path.GetFullPath(Path.Combine(root, relative));
        if (!fullPath.StartsWith(fullRoot, StringComparison.OrdinalIgnoreCase)) throw new InvalidDataException("A portable.ini path points outside the flash drive: " + relative);
        return fullPath;
    }

    private static void ValidateLayout(string appExe, string vaultDir, string vaultId)
    {
        if (!File.Exists(appExe)) throw new FileNotFoundException("The portable Obsidian runtime is missing:", appExe);
        ushort actualMachine = ReadPeMachine(appExe); ushort expectedMachine = ExpectedPeMachine();
        if (expectedMachine != 0 && actualMachine != expectedMachine) throw new InvalidDataException(String.Format("The portable runtime has the wrong CPU architecture. Expected 0x{0:X4}; found 0x{1:X4}. Open Obsidian Portable Manager to repair it.", expectedMachine, actualMachine));
        if (!Directory.Exists(vaultDir)) throw new DirectoryNotFoundException("The configured vault is missing: " + vaultDir);
        if (vaultId.Length != 16) throw new InvalidDataException("VaultId must contain exactly 16 characters.");
    }

    private static ushort ReadPeMachine(string path)
    {
        using (FileStream stream = File.OpenRead(path)) using (BinaryReader reader = new BinaryReader(stream))
        { stream.Position = 0x3C; int peOffset = reader.ReadInt32(); stream.Position = peOffset; if (reader.ReadUInt32() != 0x00004550) throw new InvalidDataException("The runtime does not have a valid PE header."); return reader.ReadUInt16(); }
    }

    private static ushort ExpectedPeMachine()
    {
        string architecture = Environment.GetEnvironmentVariable("PROCESSOR_ARCHITECTURE") ?? "";
        if (architecture.Equals("AMD64", StringComparison.OrdinalIgnoreCase)) return 0x8664;
        if (architecture.Equals("ARM64", StringComparison.OrdinalIgnoreCase)) return 0xAA64;
        if (architecture.Equals("x86", StringComparison.OrdinalIgnoreCase)) return 0x014C;
        return 0;
    }

    private static void RepairVaultRegistry(string dataDir, string vaultDir, string vaultId)
    {
        string registryPath = Path.Combine(dataDir, "obsidian.json"); Dictionary<string, object> root = new Dictionary<string, object>();
        if (File.Exists(registryPath))
        {
            try { Dictionary<string, object> parsed = new JavaScriptSerializer().DeserializeObject(File.ReadAllText(registryPath)) as Dictionary<string, object>; if (parsed != null) root = parsed; }
            catch (Exception ex) { throw new InvalidDataException("The portable vault registry is not valid JSON: " + registryPath, ex); }
        }
        Dictionary<string, object> entry = new Dictionary<string, object>(); entry["path"] = vaultDir; entry["ts"] = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(); entry["open"] = true;
        Dictionary<string, object> vaults = new Dictionary<string, object>(); vaults[vaultId] = entry; root["vaults"] = vaults;
        Directory.CreateDirectory(dataDir); string temporary = registryPath + ".new"; File.WriteAllText(temporary, new JavaScriptSerializer().Serialize(root));
        if (File.Exists(registryPath)) { File.Copy(registryPath, registryPath + ".bak", true); File.Copy(temporary, registryPath, true); File.Delete(temporary); } else File.Move(temporary, registryPath);
    }
}
