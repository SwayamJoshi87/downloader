import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const releaseDir = path.join(root, 'release');
const buildDir = path.join(releaseDir, 'build');
const appDir = path.join(buildDir, 'app');
const runtimeDir = path.join(buildDir, 'runtime');
const winDir = path.join(releaseDir, 'win');
const exePath = path.join(winDir, 'FitGirl Downloader.exe');
const singleExePath = path.join(releaseDir, 'FitGirl Downloader Single.exe');

function run(command, args, options = {}) {
  console.log(`[package] ${command} ${args.join(' ')}`);
  execFileSync(command, args, { stdio: 'inherit', shell: true, ...options });
}

function runDirect(command, args, options = {}) {
  console.log(`[package] ${command} ${args.join(' ')}`);
  execFileSync(command, args, { stdio: 'inherit', shell: false, ...options });
}

function copyDir(from, to) {
  if (!fs.existsSync(from)) {
    throw new Error(`Missing required path: ${from}`);
  }
  fs.cpSync(from, to, { recursive: true, force: true });
}

function findCsc() {
  const candidates = [
    'C:\\Windows\\Microsoft.NET\\Framework64\\v4.0.30319\\csc.exe',
    'C:\\Windows\\Microsoft.NET\\Framework\\v4.0.30319\\csc.exe',
  ];
  const found = candidates.find((candidate) => fs.existsSync(candidate));
  if (!found) {
    throw new Error('Could not find csc.exe. Install .NET Framework developer tools or the .NET SDK to build the single-file executable.');
  }
  return found;
}


function write(filePath, contents) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, contents);
}

function clean() {
  fs.rmSync(buildDir, { recursive: true, force: true });
  fs.rmSync(winDir, { recursive: true, force: true });
  fs.rmSync(singleExePath, { force: true });
  fs.mkdirSync(appDir, { recursive: true });
  fs.mkdirSync(runtimeDir, { recursive: true });
  fs.mkdirSync(winDir, { recursive: true });
}

function copyRuntimeDependencies() {
  const modulesDir = path.join(appDir, 'node_modules');
  for (const moduleName of ['base-x', 'bs58']) {
    copyDir(path.join(root, 'node_modules', moduleName), path.join(modulesDir, moduleName));
  }

  const nodeExe = process.execPath;
  fs.copyFileSync(nodeExe, path.join(runtimeDir, 'node.exe'));
}

function stagePortableApp() {
  copyDir(path.join(root, 'dist'), path.join(appDir, 'dist'));
  copyDir(path.join(root, 'resources'), path.join(appDir, 'resources'));
  copyRuntimeDependencies();

  write(
    path.join(buildDir, 'FitGirl Downloader.cmd'),
    [
      '@echo off',
      'setlocal',
      'cd /d "%~dp0app"',
      '"%~dp0runtime\\node.exe" "server\\index.js"',
      'if errorlevel 1 pause',
      '',
    ].join('\r\n')
  );
}

function createLauncher() {
  const launcherSource = path.join(buildDir, 'Launcher.cs');
  write(
    launcherSource,
    [
      'using System;',
      'using System.Diagnostics;',
      'using System.IO;',
      '',
      'class Program',
      '{',
      '    static int Main()',
      '    {',
      '        string baseDir = AppDomain.CurrentDomain.BaseDirectory;',
      '        string node = Path.Combine(baseDir, "runtime", "node.exe");',
      '        string appDir = Path.Combine(baseDir, "app");',
      '        string server = Path.Combine(appDir, "server", "index.js");',
      '',
      '        if (!File.Exists(node))',
      '        {',
      '            Console.Error.WriteLine("Missing bundled node.exe: " + node);',
      '            return 1;',
      '        }',
      '',
      '        if (!File.Exists(server))',
      '        {',
      '            Console.Error.WriteLine("Missing server entrypoint: " + server);',
      '            return 1;',
      '        }',
      '',
      '        var process = new Process();',
      '        process.StartInfo.FileName = node;',
      '        process.StartInfo.Arguments = "\\"" + server + "\\"";',
      '        process.StartInfo.WorkingDirectory = appDir;',
      '        process.StartInfo.UseShellExecute = false;',
      '',
      '        Console.CancelKeyPress += (sender, eventArgs) =>',
      '        {',
      '            eventArgs.Cancel = true;',
      '            try',
      '            {',
      '                if (!process.HasExited) process.Kill();',
      '            }',
      '            catch {}',
      '        };',
      '',
      '        process.Start();',
      '        process.WaitForExit();',
      '        return process.ExitCode;',
      '    }',
      '}',
      '',
    ].join('\r\n')
  );

  run('powershell.exe', [
    '-NoProfile',
    '-ExecutionPolicy',
    'Bypass',
    '-Command',
    `$code = Get-Content -LiteralPath '${launcherSource}' -Raw; Add-Type -TypeDefinition $code -OutputAssembly '${exePath}' -OutputType ConsoleApplication`,
  ]);
}

function stageWindowsRelease() {
  copyDir(appDir, path.join(winDir, 'app'));
  copyDir(runtimeDir, path.join(winDir, 'runtime'));
  fs.copyFileSync(path.join(buildDir, 'FitGirl Downloader.cmd'), path.join(winDir, 'FitGirl Downloader.cmd'));
  createLauncher();
}

function createSingleFileLauncher() {
  const payloadRoot = path.join(buildDir, 'single-payload');
  const payloadZip = path.join(buildDir, 'single-payload.zip');
  const launcherSource = path.join(buildDir, 'SingleLauncher.cs');

  fs.rmSync(payloadRoot, { recursive: true, force: true });
  fs.rmSync(payloadZip, { force: true });
  fs.mkdirSync(payloadRoot, { recursive: true });

  copyDir(appDir, path.join(payloadRoot, 'app'));
  copyDir(runtimeDir, path.join(payloadRoot, 'runtime'));
  fs.copyFileSync(path.join(buildDir, 'FitGirl Downloader.cmd'), path.join(payloadRoot, 'FitGirl Downloader.cmd'));

  run('powershell.exe', [
    '-NoProfile',
    '-ExecutionPolicy',
    'Bypass',
    '-Command',
    `Compress-Archive -Path '${path.join(payloadRoot, '*')}' -DestinationPath '${payloadZip}' -Force`,
  ]);

  write(
    launcherSource,
    [
      'using System;',
      'using System.Diagnostics;',
      'using System.IO;',
      'using System.IO.Compression;',
      'using System.Reflection;',
      '',
      'class Program',
      '{',
      '    static int Main()',
      '    {',
      '        string baseExtractDir = Path.Combine(Path.GetTempPath(), "FitGirlDownloader");',
      '        string versionDir = Path.Combine(baseExtractDir, "app-" + File.GetLastWriteTimeUtc(Assembly.GetExecutingAssembly().Location).Ticks.ToString());',
      '        string marker = Path.Combine(versionDir, ".extracted");',
      '',
      '        try',
      '        {',
      '            Directory.CreateDirectory(baseExtractDir);',
      '            if (!File.Exists(marker))',
      '            {',
      '                if (Directory.Exists(versionDir)) Directory.Delete(versionDir, true);',
      '                Directory.CreateDirectory(versionDir);',
      '                string zipPath = Path.Combine(versionDir, "payload.zip");',
      '                using (Stream input = Assembly.GetExecutingAssembly().GetManifestResourceStream("payload.zip"))',
      '                {',
      '                    if (input == null) throw new Exception("Embedded payload.zip was not found.");',
      '                    using (FileStream output = File.Create(zipPath)) input.CopyTo(output);',
      '                }',
      '                ZipFile.ExtractToDirectory(zipPath, versionDir);',
      '                File.Delete(zipPath);',
      '                File.WriteAllText(marker, DateTime.UtcNow.ToString("O"));',
      '                CleanupOldExtracts(baseExtractDir, versionDir);',
      '            }',
      '',
      '            string appDir = Path.Combine(versionDir, "app");',
      '            string node = Path.Combine(versionDir, "runtime", "node.exe");',
      '            string server = Path.Combine(appDir, "server", "index.js");',
      '',
      '            if (!File.Exists(node)) throw new FileNotFoundException("Missing bundled node.exe", node);',
      '            if (!File.Exists(server)) throw new FileNotFoundException("Missing server entrypoint", server);',
      '',
      '            var process = new Process();',
      '            process.StartInfo.FileName = node;',
      '            process.StartInfo.Arguments = "\\"" + server + "\\"";',
      '            process.StartInfo.WorkingDirectory = appDir;',
      '            process.StartInfo.UseShellExecute = false;',
      '',
      '            Console.CancelKeyPress += (sender, eventArgs) =>',
      '            {',
      '                eventArgs.Cancel = true;',
      '                try { if (!process.HasExited) process.Kill(); } catch {}',
      '            };',
      '',
      '            process.Start();',
      '            process.WaitForExit();',
      '            return process.ExitCode;',
      '        }',
      '        catch (Exception ex)',
      '        {',
      '            Console.Error.WriteLine(ex.ToString());',
      '            Console.Error.WriteLine();',
      '            Console.Error.WriteLine("Press any key to close.");',
      '            Console.ReadKey(true);',
      '            return 1;',
      '        }',
      '    }',
      '',
      '    static void CleanupOldExtracts(string baseExtractDir, string keepDir)',
      '    {',
      '        try',
      '        {',
      '            foreach (string dir in Directory.GetDirectories(baseExtractDir, "app-*"))',
      '            {',
      '                if (!String.Equals(dir, keepDir, StringComparison.OrdinalIgnoreCase))',
      '                {',
      '                    try { Directory.Delete(dir, true); } catch {}',
      '                }',
      '            }',
      '        }',
      '        catch {}',
      '    }',
      '}',
      '',
    ].join('\r\n')
  );

  runDirect(findCsc(), [
    '/nologo',
    '/target:exe',
    `/out:${singleExePath}`,
    `/resource:${payloadZip},payload.zip`,
    '/reference:System.IO.Compression.dll',
    '/reference:System.IO.Compression.FileSystem.dll',
    launcherSource,
  ]);
}

clean();
run('npm.cmd', ['run', 'build']);
run('npx.cmd', ['tsc', '-p', 'tsconfig.server.json']);
stagePortableApp();
stageWindowsRelease();
createSingleFileLauncher();

console.log(`[package] Created ${exePath}`);
console.log(`[package] Created ${singleExePath}`);
