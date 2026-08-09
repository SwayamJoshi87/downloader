using System;
using System.Diagnostics;
using System.IO;

class Program
{
    static int Main()
    {
        string baseDir = AppDomain.CurrentDomain.BaseDirectory;
        string node = Path.Combine(baseDir, "runtime", "node.exe");
        string appDir = Path.Combine(baseDir, "app");
        string server = Path.Combine(appDir, "server", "index.js");

        if (!File.Exists(node))
        {
            Console.Error.WriteLine("Missing bundled node.exe: " + node);
            return 1;
        }

        if (!File.Exists(server))
        {
            Console.Error.WriteLine("Missing server entrypoint: " + server);
            return 1;
        }

        var process = new Process();
        process.StartInfo.FileName = node;
        process.StartInfo.Arguments = "\"" + server + "\"";
        process.StartInfo.WorkingDirectory = appDir;
        process.StartInfo.UseShellExecute = false;

        Console.CancelKeyPress += (sender, eventArgs) =>
        {
            eventArgs.Cancel = true;
            try
            {
                if (!process.HasExited) process.Kill();
            }
            catch {}
        };

        process.Start();
        process.WaitForExit();
        return process.ExitCode;
    }
}
