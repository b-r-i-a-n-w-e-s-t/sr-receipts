/**
 * NVDA on the Windows Guest Rig: the desktop the daemon serves, behind a seam
 * the tests fake.
 *
 * Two things here are about the desktop rather than the reader, and they are
 * here because they only work from inside the interactive session: listing the
 * windows on screen, and bringing the browser's window to the front. A
 * PowerShell started over SSH sees no window titles at all, and
 * SetForegroundWindow from a background process is refused unless the process
 * has just sent input, which is what the Alt press before it is for. Neither
 * can take the foreground from an elevated window; the rule in
 * `docs/operating-the-rig.md` about minimizing elevated windows stands.
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import { nvda } from "@guidepup/guidepup";
import { stamp } from "./stamp.ts";
import { powershell as runPowerShell } from "./system.ts";

/**
 * `capture: true` keeps whole announcements; Guidepup's default `"initial"`
 * truncates at the first phrase. The speech viewer override stops NVDA's own
 * viewer window from opening and taking focus away from the browser.
 */
export const NVDA_OPTIONS = {
  capture: true,
  settings: { speechViewer: { showSpeechViewerAtStartup: false } },
} as const;

/** The browser the daemon launches: the Edge Windows ships, which is the one native browser Playwright can drive on ARM64. */
export const EDGE = ["ProgramFiles(x86)", "ProgramFiles", "LOCALAPPDATA"]
  .map((variable) => join(process.env[variable] ?? "", "Microsoft", "Edge", "Application", "msedge.exe"))
  .find((path) => existsSync(path)) ?? "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";

/**
 * The part of Guidepup's `nvda` this file drives. Narrower than Guidepup's own
 * type on purpose: it is the whole seam the unit tests substitute.
 */
export interface GuidepupNvda {
  readonly keyboardCommands: Readonly<Record<string, unknown>>;
  start(options?: unknown): Promise<void>;
  stop(): Promise<void>;
  perform(command: unknown): Promise<void>;
  press(key: string): Promise<void>;
  next(): Promise<void>;
  previous(): Promise<void>;
  lastSpokenPhrase(): Promise<string>;
  spokenPhraseLog(): Promise<string[]>;
  clearSpokenPhraseLog(): Promise<void>;
  capture<T>(action: () => Promise<T>, options?: unknown): Promise<{ spokenPhrase: string; result: T }>;
}

/** Everything the daemon and the guard ask of the desktop. Its methods are called unbound. */
export interface NvdaDesktop {
  start(): Promise<void>;
  stop(): Promise<void>;
  /** One of NVDA's commands by Guidepup's name for it; what it made NVDA say, "" for silence. */
  perform(command: string): Promise<string>;
  press(key: string): Promise<string>;
  /** The characters of `text` as keys, `delayMs` apart, inside one speech window; everything said. */
  type(text: string, delayMs: number): Promise<string>;
  next(): Promise<string>;
  previous(): Promise<string>;
  spokenPhraseLog(): Promise<string[]>;
  clearSpokenPhraseLog(): Promise<void>;
  /** Open the speech window; resolves once the listener is attached. */
  captureBegin(): Promise<void>;
  /** Close it and return what was said inside it. */
  captureEnd(): Promise<string>;
  /** Every window title on the desktop, for a guard that failed. */
  windows(): Promise<string[]>;
  /** Bring the browser's window to the front; returns what is in front afterwards. */
  activateBrowser(): Promise<string>;
  /**
   * The Environment Stamp, taken once and kept. It costs several PowerShell
   * starts, and what it names is fixed for the daemon's life: the browser
   * server's Edge is the one launched at startup even if Edge updates on disk.
   */
  environment(): Promise<string[]>;
}

const PS_WINDOWS = `Get-Process | Where-Object { $_.MainWindowTitle } | ForEach-Object { "$($_.ProcessName): $($_.MainWindowTitle)" }`;

const activationScript = (processName: string): string => `
Add-Type -AssemblyName System.Windows.Forms
Add-Type -Namespace X -Name W -MemberDefinition '[DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h); [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int n); [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow(); [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr h, System.Text.StringBuilder s, int n);'
$browser = Get-Process ${processName} -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
if (-not $browser) { Write-Output 'no ${processName} window'; exit 0 }
[System.Windows.Forms.SendKeys]::SendWait('%')
[X.W]::ShowWindow($browser.MainWindowHandle, 9) | Out-Null
[X.W]::SetForegroundWindow($browser.MainWindowHandle) | Out-Null
Start-Sleep -Milliseconds 300
$sb = New-Object System.Text.StringBuilder 512
[X.W]::GetWindowText([X.W]::GetForegroundWindow(), $sb, 512) | Out-Null
Write-Output $sb.ToString()
`;

/** What SendKeys reads as an instruction rather than a character; braces make each one literal. */
const SENDKEYS_SPECIAL = new Set("+^%~(){}[]");

/**
 * Typing a text at a set pace, in one PowerShell, so the gap between keys is
 * the sleep and not a process start. The keys go through Windows' own input
 * queue to whatever is in front, which is how NVDA hears a character typed:
 * Guidepup's `press` would wait out the speech after every key, and its
 * `type` starts a script host per character.
 *
 * The script carries character codes and no text, so nothing typed can be
 * read as PowerShell, and no quoting survives or fails to survive the command
 * line.
 */
export function typingScript(text: string, delayMs: number): string {
  const keys = Array.from(text, (character) => {
    const code = character.codePointAt(0) ?? 0;
    if (code < 0x20 || code === 0x7f) {
      throw new Error(`type takes characters, and U+${code.toString(16).toUpperCase().padStart(4, "0")} is not one; use press for a key such as Enter or Tab`);
    }
    const sent = SENDKEYS_SPECIAL.has(character) ? `{${character}}` : character;
    return `(-join [char[]](${Array.from({ length: sent.length }, (_, at) => sent.charCodeAt(at)).join(",")}))`;
  });
  return `
Add-Type -AssemblyName System.Windows.Forms
$keys = @(${keys.join(", ")})
for ($i = 0; $i -lt $keys.Count; $i++) {
  if ($i -gt 0 -and ${delayMs} -gt 0) { Start-Sleep -Milliseconds ${delayMs} }
  [System.Windows.Forms.SendKeys]::SendWait($keys[$i])
}
`;
}

export interface NvdaDesktopOptions {
  reader?: GuidepupNvda;
  powershell?: (script: string) => Promise<string>;
  /** The browser's process name, for activation. */
  browserProcess?: string;
  environment?: () => Promise<string[]>;
}

export function createNvdaDesktop({
  reader = nvda as unknown as GuidepupNvda,
  powershell = runPowerShell,
  browserProcess = "msedge",
  environment = stamp,
}: NvdaDesktopOptions = {}): NvdaDesktop {
  // Speech reaches Guidepup's log only inside one of its own actions, one
  // entry per action, so an action's answer is the log's last entry.
  const spokenBy = async (action: () => Promise<void>): Promise<string> => {
    await action();
    return await reader.lastSpokenPhrase();
  };

  let stamped: Promise<string[]> | undefined;
  let pending: { finish: () => void; result: Promise<{ spokenPhrase: string }> } | null = null;

  return {
    start: () => reader.start(NVDA_OPTIONS),
    stop: () => reader.stop(),

    perform(command) {
      const keyCommand = reader.keyboardCommands[command];
      if (!keyCommand) throw new Error(`unknown NVDA keyboard command: ${command}`);
      return spokenBy(() => reader.perform(keyCommand));
    },
    press: (key) => spokenBy(() => reader.press(key)),
    async type(text, delayMs) {
      // Guidepup would queue this behind the open window, which only a later
      // request can close.
      if (pending) throw new Error("a capture is open; type cannot run inside it");
      const script = typingScript(text, delayMs);
      // Guidepup's own window: it attaches the listener, runs the action, and
      // waits for the speech after it to end.
      const { spokenPhrase } = await reader.capture(async () => void (await powershell(script)), { capture: true });
      return spokenPhrase;
    },
    next: () => spokenBy(() => reader.next()),
    previous: () => spokenBy(() => reader.previous()),
    spokenPhraseLog: async () => [...(await reader.spokenPhraseLog())],
    clearSpokenPhraseLog: () => reader.clearSpokenPhraseLog(),

    async captureBegin() {
      if (pending) throw new Error("a capture is already open");
      let ready!: () => void;
      let finish!: () => void;
      const readyPromise = new Promise<void>((resolve) => (ready = resolve));
      const finishPromise = new Promise<void>((resolve) => (finish = resolve));
      // Guidepup attaches its speech listener, then runs the action. The
      // action signals that moment and waits for captureEnd, so returning from
      // here means a page action sent next is inside the window.
      const result = reader.capture(async () => {
        ready();
        await finishPromise;
      }, { capture: true });
      // A capture that rejects before it is ended would otherwise be an
      // unhandled rejection; the caller sees it from captureEnd.
      result.catch(() => undefined);
      pending = { finish, result };
      await readyPromise;
    },
    async captureEnd() {
      if (!pending) throw new Error("no capture is open");
      const { finish, result } = pending;
      pending = null;
      finish();
      return (await result).spokenPhrase;
    },

    windows: async () => (await powershell(PS_WINDOWS)).split(/\r?\n/).filter(Boolean),
    activateBrowser: () => powershell(activationScript(browserProcess)),
    environment: () => (stamped ??= environment()),
  };
}
