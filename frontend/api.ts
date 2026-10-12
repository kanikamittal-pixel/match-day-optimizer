'use client';

export class ApiError extends Error {
  constructor(message: string, public data: any = {}, public status = 0) {
    super(message);
  }
}

export async function api<T = any>(url: string, init?: RequestInit & { json?: unknown }): Promise<T> {
  const { json, ...rest } = init ?? {};
  const res = await fetch(url, {
    ...rest,
    headers: { ...(json !== undefined ? { 'content-type': 'application/json' } : {}), ...(rest.headers ?? {}) },
    body: json !== undefined ? JSON.stringify(json) : rest.body,
  });
  let data: any = {};
  try {
    data = await res.json();
  } catch {
    /* non-JSON error page */
  }
  if (res.status === 401 && typeof window !== 'undefined') window.location.href = '/login';
  if (!res.ok) throw new ApiError(data.error || `Request failed (${res.status})`, data, res.status);
  return data as T;
}

/** Downscale a screenshot to <= 1600px JPEG so 3 images fit Vercel's 4.5MB body limit. */
export async function imageToPayload(file: File, maxPx = 1600, quality = 0.82): Promise<{ mime: string; data: string }> {
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, maxPx / Math.max(bmp.width, bmp.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bmp.width * scale);
  canvas.height = Math.round(bmp.height * scale);
  canvas.getContext('2d')!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
  const url = canvas.toDataURL('image/jpeg', quality);
  return { mime: 'image/jpeg', data: url.split(',')[1] };
}

export const fmtDate = (iso?: string | null) =>
  iso ? new Date(iso).toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : 'Date TBC';
