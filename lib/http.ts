import { NextResponse } from 'next/server';

export class HttpError extends Error {
  constructor(public status: number, message: string, public extra: Record<string, unknown> = {}) {
    super(message);
  }
}

/** Wrap a route handler so every failure becomes a clean JSON {error,...} the UI can show. */
export function handle<A extends unknown[]>(fn: (...args: A) => Promise<unknown>) {
  return async (...args: A) => {
    try {
      const out = await fn(...args);
      return out instanceof Response ? out : NextResponse.json(out);
    } catch (e) {
      if (e instanceof HttpError) return NextResponse.json({ error: e.message, ...e.extra }, { status: e.status });
      console.error(e);
      return NextResponse.json({ error: e instanceof Error ? e.message : 'Unexpected error' }, { status: 500 });
    }
  };
}
