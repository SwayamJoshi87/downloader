using System;
using System.Diagnostics;
using System.IO;
using System.IO.Compression;
using System.Reflection;

class Program
{
    static int Main()
    {
        string baseExtractDir = Path.Combine(Path.GetTempPath(), "FitGirlDownloader");
        string versionDir = Path.Combine(baseExtractDir, "app-" + File.GetLastWriteTimeUtc(Assembly.GetExecutingAssembly().Location).Ticks.ToString());
        string marker = Path.Combine(versionDir, ".extracted");

        try
        {
            Directory.CreateDirectory(baseExtractDir);
            if (!File.Exists(marker))
            {
                if (Directory.Exists(versionDir)) Directory.Delete(versionDir, true);
                Directory.CreateDirectory(versionDir);
                string zipPath = Path.Combine(versionDir, "payload.zip");
                using (Stream input = Assembly.GetExecutingAssembly().GetManifestResourceStream("payload.zip"))
                {
                    if (input == null) throw new Exception("Embedded payload.zip was not found.");
                    using (FileStream output = File.Create(zipPath)) input.CopyTo(output);
                }
                ZipFile.ExtractToDirectory(zipPath, versionDir);
                File.Delete(zipPath);
                File.WriteAllText(marker, DateTime.UtcNow.ToString("O"));
                CleanupOldExtracts(baseExtractDir, versionDir);
            }

            string appDir = Path.Combine(versionDir, "app");
            string node = Path.Combine(versionDir, "runtime", "node.exe");
            string server = Path.Combine(appDir, "server", "index.js");

            if (!File.Exists(node)) throw new FileNotFoundException("Missing bundled node.exe", node);
            if (!File.Exists(server)) throw new FileNotFoundException("Missing server entrypoint", server);

            var process = new Process();
            process.StartInfo.FileName = node;
            process.StartInfo.Arguments = "\"" + server + "\"";
            process.StartInfo.WorkingDirectory = appDir;
            process.StartInfo.UseShellExecute = false;

            Console.CancelKeyPress += (sender, eventArgs) =>
            {
                eventArgs.Cancel = true;
                try { if (!process.HasExited) process.Kill(); } catch {}
            };

            process.Start();
            process.WaitForExit();
            return process.ExitCode;
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine(ex.ToString());
            Console.Error.WriteLine();
            Console.Error.WriteLine("Press any key to close.");
            Console.ReadKey(true);
            return 1;
        }
    }

    static void CleanupOldExtracts(string baseExtractDir, string keepDir)
    {
        try
        {
            foreach (string dir in Directory.GetDirectories(baseExtractDir, "app-*"))
            {
                if (!String.Equals(dir, keepDir, StringComparison.OrdinalIgnoreCase))
                {
                    try { Directory.Delete(dir, true); } catch {}
                }
            }
        }
        catch {}
    }
}
