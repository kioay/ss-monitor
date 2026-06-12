import { spawn } from "node:child_process";
import path from "node:path";
import type { RiskBacktestStatus } from "../src/shared";

let currentStatus: RiskBacktestStatus = {
  status: "idle",
  message: "等待风险回测"
};
let inFlight: Promise<RiskBacktestStatus> | undefined;

export function getRiskBacktestStatus() {
  return currentStatus;
}

export async function ensureRiskBacktest() {
  if (currentStatus.status === "passed") return currentStatus;
  if (!inFlight) {
    inFlight = runRiskBacktest().finally(() => {
      inFlight = undefined;
    });
  }
  return inFlight;
}

function runRiskBacktest() {
  const startedAt = new Date();
  currentStatus = {
    status: "running",
    startedAt: startedAt.toISOString(),
    message: "回测中"
  };

  return new Promise<RiskBacktestStatus>((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    const child = spawn(npmCommand(), ["run", "test:risk-backtest"], {
      cwd: path.resolve("."),
      windowsHide: true,
      env: { ...process.env }
    });

    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf-8");
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf-8");
    });
    child.on("error", (error) => {
      const failed = failedStatus(startedAt, `风险回测启动失败：${error.message}`, stdout, stderr);
      currentStatus = failed;
      reject(new Error(failed.message));
    });
    child.on("exit", (code) => {
      if (code === 0) {
        const finishedAt = new Date();
        const passed: RiskBacktestStatus = {
          status: "passed",
          startedAt: startedAt.toISOString(),
          finishedAt: finishedAt.toISOString(),
          durationMs: finishedAt.getTime() - startedAt.getTime(),
          caseCount: parseCaseCount(stdout),
          message: "风险回测通过"
        };
        currentStatus = passed;
        resolve(passed);
        return;
      }

      const failed = failedStatus(startedAt, `风险回测失败：${compactBacktestOutput(stderr || stdout) || `退出码 ${code}`}`, stdout, stderr);
      currentStatus = failed;
      reject(new Error(failed.message));
    });
  });
}

function failedStatus(startedAt: Date, message: string, stdout: string, stderr: string): RiskBacktestStatus {
  const finishedAt = new Date();
  return {
    status: "failed",
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    durationMs: finishedAt.getTime() - startedAt.getTime(),
    caseCount: parseCaseCount(stdout),
    message,
    details: compactBacktestOutput(stderr || stdout)
  };
}

function npmCommand() {
  return process.platform === "win32" ? "npm.cmd" : "npm";
}

function parseCaseCount(output: string) {
  const match = output.match(/Risk backtest passed:\s*(\d+)\s*cases/i) || output.match(/Risk backtest failed:\s*\d+\/(\d+)\s*cases/i);
  return match ? Number(match[1]) : undefined;
}

function compactBacktestOutput(output: string) {
  return output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(-10)
    .join(" | ")
    .slice(0, 600);
}
