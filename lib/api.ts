import type { Scope } from './model';
import { inExtension } from './settings';

export type Request =
  | { type: 'COUNT'; scope: Scope; windowId?: number }
  | { type: 'ASIDE'; scope: Scope; windowId?: number; copy?: boolean; withoutPreviews?: boolean }
  | { type: 'PREPARE_ASIDE'; scope: Scope; copy?: boolean }
  | { type: 'RESUME_ASIDE'; token: string }
  | { type: 'DISCARD_ASIDE'; token: string }
  | { type: 'RESTORE'; ids: string[]; remove: boolean; newWindow: boolean }
  | { type: 'OPEN'; id: string }
  | { type: 'DELETE'; ids: string[] }
  | { type: 'MOVE'; ids: string[]; destinationId: string }
  | { type: 'CLEAR' }
  | { type: 'DELETE_PREVIEWS' }
  | { type: 'CANCEL' }
  | { type: 'MANAGER' };

export async function request<T = unknown>(message: Request): Promise<T> {
  if (!inExtension)
    throw new Error('Load the unpacked extension in Chrome to save or restore browser tabs.');
  const response = await chrome.runtime.sendMessage(message);
  if (!response?.ok)
    throw new Error(response?.error || 'The extension could not finish this action.');
  return response.data as T;
}

export async function ensureCapturePermission(): Promise<boolean> {
  if (!inExtension) return false;
  const permission = { origins: ['<all_urls>'] };
  if (await chrome.permissions.contains(permission)) return true;
  return chrome.permissions.request(permission);
}
