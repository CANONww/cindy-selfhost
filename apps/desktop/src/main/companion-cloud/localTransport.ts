/**
 * 自建（local）模式的端点解析。
 *
 * 只服务主人一人、无账号体系：默认走本机四件套（房间服务 / WebDAV / 中转 / 静态登记）。
 * 官方实现保留：`mode: 'official'` 时一切照旧走 chatApiBaseUrl。
 *
 * 配置文件位置（可选）：<userData>/selfhost.json
 *   { "mode": "local", "roomBaseUrl": "http://127.0.0.1:47822",
 *     "webdavBaseUrl": "http://127.0.0.1:47821/", "relayUrl": "http://127.0.0.1:47820" }
 * 文件不存在时仍默认 local（本令要求），除非显式写 official。
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { app } from 'electron';

export type CompanionCloudMode = 'local' | 'official';

export interface SelfHostEndpoints {
  mode: CompanionCloudMode;
  roomBaseUrl: string;
  webdavBaseUrl: string;
  relayUrl: string;
}

const DEFAULTS: SelfHostEndpoints = {
  mode: 'local',
  roomBaseUrl: 'http://127.0.0.1:47822',
  webdavBaseUrl: 'http://127.0.0.1:47821/',
  relayUrl: 'http://127.0.0.1:47820',
};

/** 环境变量可覆盖（只影响本进程，便于联调）：XDT_SELFHOST=official 可切回官方实现。 */
export function selfHostEndpoints(): SelfHostEndpoints {
  if (process.env.XDT_SELFHOST === 'official') return { ...DEFAULTS, mode: 'official' };
  const file = path.join(app.getPath('userData'), 'selfhost.json');
  if (!existsSync(file)) return DEFAULTS;
  try {
    const raw = JSON.parse(readFileSync(file, 'utf8')) as Partial<SelfHostEndpoints>;
    return {
      mode: raw.mode === 'official' ? 'official' : 'local',
      roomBaseUrl: raw.roomBaseUrl || DEFAULTS.roomBaseUrl,
      webdavBaseUrl: raw.webdavBaseUrl || DEFAULTS.webdavBaseUrl,
      relayUrl: raw.relayUrl || DEFAULTS.relayUrl,
    };
  } catch {
    return DEFAULTS;
  }
}

export const isLocalMode = (): boolean => selfHostEndpoints().mode === 'local';
