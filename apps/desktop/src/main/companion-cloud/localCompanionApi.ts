/**
 * CompanionApi 的本地实现：把同一条 route 语义直接打到家里的房间服务
 * （~/cindy-selfhost/room-service），资料层走 WebDAV。
 *
 * 与官方实现的差别只有传输：请求目标、鉴权（本地无账号，不带 token）。
 * 错误形状与 chatServer 的实现保持一致——message 即错误码，带 status / details，
 * 这样 chatRejection / isUnreachable 这些既有判断无需改动。
 */
import type { CompanionApi } from './types.js';
import { selfHostEndpoints } from './localTransport.js';

interface LocalApiOptions {
  baseUrl?: string;
  timeoutMs?: number;
}

export interface LocalCompanionApi extends CompanionApi {
  readonly baseUrl: string;
}

export function createLocalCompanionApi(options: LocalApiOptions = {}): LocalCompanionApi {
  const baseUrl = (options.baseUrl ?? selfHostEndpoints().roomBaseUrl).replace(/\/+$/, '');
  const timeoutMs = options.timeoutMs ?? 15_000;

  const api = async function localApi<T>(route: string, method = 'GET', data?: unknown, actorId?: string): Promise<T> {
    const url = `${baseUrl}${route.startsWith('/') ? route : `/${route}`}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, {
        method,
        signal: controller.signal,
        headers: {
          'content-type': 'application/json',
          ...(actorId ? { 'x-chat-actor': actorId } : {}),
        },
        ...(data === undefined ? {} : { body: JSON.stringify(data) }),
      });
      const text = await response.text();
      const parsed = text ? safeJson(text) : null;
      if (response.status >= 200 && response.status < 300) return parsed as T;
      // 与聊天服务一致：把业务码放进 message，并保留 status / details。
      const error = parsed && typeof parsed === 'object' && (parsed as { error?: { code?: string; details?: unknown } }).error;
      const code = error?.code ?? (response.status === 404 ? 'NOT_FOUND' : `HTTP_${response.status}`);
      const failure = new Error(code) as Error & { status?: number; details?: unknown };
      failure.status = response.status;
      if (error?.details !== undefined) failure.details = error.details;
      throw failure;
    } catch (cause) {
      if (cause instanceof Error && (cause as { status?: number }).status !== undefined) throw cause;
      const failure = new Error(cause instanceof Error && cause.name === 'AbortError' ? 'REQUEST_TIMEOUT' : 'CHAT_ENDPOINT_UNAVAILABLE');
      throw failure;
    } finally {
      clearTimeout(timer);
    }
  } as LocalCompanionApi;

  Object.defineProperty(api, 'baseUrl', { value: baseUrl, enumerable: true });
  return api;
}

function safeJson(text: string): unknown {
  try { return JSON.parse(text); } catch { return null; }
}

/** 资料层：WebDAV 的读写（伙伴资料 / memories / skills）。 */
export interface WebdavClient {
  readonly baseUrl: string;
  list(path: string): Promise<string[]>;
  readText(path: string): Promise<string>;
  writeText(path: string, body: string): Promise<void>;
  remove(path: string): Promise<void>;
}

export function createWebdavClient(options: { baseUrl?: string; authorization?: string } = {}): WebdavClient {
  const base = (options.baseUrl ?? selfHostEndpoints().webdavBaseUrl).replace(/\/?$/, '/');
  const headers = () => ({
    ...(options.authorization ? { authorization: options.authorization } : {}),
  });
  const url = (p: string) => `${base}${p.replace(/^\/+/, '')}`;

  return {
    baseUrl: base,
    async list(path) {
      const response = await fetch(url(path), { method: 'PROPFIND', headers: { ...headers(), depth: '1' } });
      if (!response.ok && response.status !== 207) throw new Error(`WEBDAV_LIST_FAILED_${response.status}`);
      const xml = await response.text();
      return [...xml.matchAll(/<D:href>([^<]+)<\/D:href>/g)].map(m => decodeURIComponent(m[1]!)).filter(href => !href.endsWith('/'));
    },
    async readText(path) {
      const response = await fetch(url(path), { headers: headers() });
      if (!response.ok) throw new Error(`WEBDAV_READ_FAILED_${response.status}`);
      return await response.text();
    },
    async writeText(path, body) {
      const response = await fetch(url(path), { method: 'PUT', headers: { ...headers(), 'content-type': 'text/plain; charset=utf-8' }, body });
      if (!response.ok && response.status !== 201 && response.status !== 204) throw new Error(`WEBDAV_WRITE_FAILED_${response.status}`);
    },
    async remove(path) {
      const response = await fetch(url(path), { method: 'DELETE', headers: headers() });
      if (!response.ok && response.status !== 204 && response.status !== 404) throw new Error(`WEBDAV_DELETE_FAILED_${response.status}`);
    },
  };
}
