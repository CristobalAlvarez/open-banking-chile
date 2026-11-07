import * as fs from "fs";

/** Busca Chrome/Chromium en el sistema */
export function findChrome(customPath?: string): string | null {
  if (customPath && fs.existsSync(customPath)) return customPath;

  const candidates = [
    // Linux
    "/usr/bin/google-chrome-stable",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium-browser",
    "/usr/bin/chromium",
    "/snap/bin/chromium",
    "/snap/bin/chromium-browser",
    // macOS
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    // Windows (WSL)
    "/mnt/c/Program Files/Google/Chrome/Application/chrome.exe",
    "/mnt/c/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  ];

  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}
