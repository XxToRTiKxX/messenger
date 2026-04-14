type LogLevel = 'debug' | 'info' | 'warn' | 'error';

type LoggerOptions = {
  app: 'app' | 'auth' | 'admin' | string;
  endpoint: string;
};

type LogPayload = {
  level: LogLevel;
  event: string;
  message: string;
  details?: unknown;
  app: string;
  href: string;
  userAgent: string;
  timestamp: string;
};

type WindowWithLoggerState = Window & {
  __frontendLoggerState?: {
    initializedApps: Set<string>;
  };
};

const MAX_MESSAGE_LENGTH = 600;
const MAX_DETAILS_LENGTH = 3500;

export function initClientLogger(options: LoggerOptions): void {
  const windowWithState = window as WindowWithLoggerState;
  if (!windowWithState.__frontendLoggerState) {
    windowWithState.__frontendLoggerState = { initializedApps: new Set<string>() };
  }

  const key = `${options.app}:${options.endpoint}`;
  if (windowWithState.__frontendLoggerState.initializedApps.has(key)) {
    return;
  }
  windowWithState.__frontendLoggerState.initializedApps.add(key);

  const app = options.app;
  const endpoint = options.endpoint;
  const nativeFetch = window.fetch.bind(window);

  const send = (level: LogLevel, event: string, message: string, details?: unknown): void => {
    const payload: LogPayload = {
      level,
      event: trimText(event, 80),
      message: trimText(message, MAX_MESSAGE_LENGTH),
      details: trimDetails(details),
      app,
      href: window.location.href,
      userAgent: navigator.userAgent,
      timestamp: new Date().toISOString()
    };

    const body = JSON.stringify(payload);
    if (body.length > MAX_DETAILS_LENGTH + 1000) {
      payload.details = trimText('payload_too_large', 64);
    }

    void nativeFetch(endpoint, {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json'
      },
      body: JSON.stringify(payload),
      keepalive: true
    }).catch(() => {
      // Logging must never break page behavior.
    });
  };

  window.addEventListener('error', (event) => {
    send(
      'error',
      'window_error',
      event.message || 'Unknown window error',
      {
        filename: event.filename || null,
        lineno: event.lineno || null,
        colno: event.colno || null
      }
    );
  });

  window.addEventListener('unhandledrejection', (event) => {
    const reason = event.reason;
    const message =
      reason instanceof Error
        ? reason.message
        : typeof reason === 'string'
          ? reason
          : 'Unhandled promise rejection';
    send('error', 'unhandled_rejection', message, {
      stack: reason instanceof Error ? reason.stack || null : null
    });
  });

  const originalConsoleError = console.error.bind(console);
  console.error = (...args: unknown[]): void => {
    send('error', 'console_error', formatConsoleMessage(args), { args: sanitizeValue(args) });
    originalConsoleError(...args);
  };

  const originalConsoleWarn = console.warn.bind(console);
  console.warn = (...args: unknown[]): void => {
    send('warn', 'console_warn', formatConsoleMessage(args), { args: sanitizeValue(args) });
    originalConsoleWarn(...args);
  };

  window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = getRequestUrl(input);
    if (url.includes(endpoint)) {
      return nativeFetch(input, init);
    }

    const method = (init?.method || getRequestMethod(input) || 'GET').toUpperCase();
    const startedAt = performance.now();

    try {
      const response = await nativeFetch(input, init);
      if (!response.ok) {
        send('warn', 'fetch_non_ok', `HTTP ${response.status} on ${method} ${url}`, {
          status: response.status,
          method,
          url,
          durationMs: Math.round(performance.now() - startedAt)
        });
      }
      return response;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Fetch failed';
      send('error', 'fetch_failed', `${method} ${url}: ${message}`, {
        method,
        url,
        error: sanitizeValue(error),
        durationMs: Math.round(performance.now() - startedAt)
      });
      throw error;
    }
  };

  send('info', 'frontend_boot', `Frontend logger initialized for ${app}`);
}

function getRequestUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

function getRequestMethod(input: RequestInfo | URL): string | undefined {
  if (typeof input === 'string' || input instanceof URL) return undefined;
  return input.method;
}

function formatConsoleMessage(args: unknown[]): string {
  const serialized = args
    .map((arg) => {
      if (typeof arg === 'string') return arg;
      if (arg instanceof Error) return arg.message;
      return safeJsonStringify(arg);
    })
    .join(' ');
  return trimText(serialized || 'Console message', MAX_MESSAGE_LENGTH);
}

function trimText(value: string, maxLength: number): string {
  if (!value) return '';
  if (value.length <= maxLength) return value;
  return `${value.slice(0, Math.max(0, maxLength - 3))}...`;
}

function trimDetails(value: unknown): unknown {
  if (value == null) return value;
  const serialized = safeJsonStringify(value);
  if (serialized.length <= MAX_DETAILS_LENGTH) return JSON.parse(serialized);
  return {
    truncated: true,
    value: trimText(serialized, MAX_DETAILS_LENGTH)
  };
}

function sanitizeValue(value: unknown): unknown {
  if (value == null) return value;
  if (typeof value === 'string') return trimText(value, MAX_MESSAGE_LENGTH);
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (value instanceof Error) {
    return {
      name: value.name,
      message: trimText(value.message || 'Error', MAX_MESSAGE_LENGTH),
      stack: trimText(value.stack || '', MAX_DETAILS_LENGTH)
    };
  }
  try {
    return JSON.parse(trimText(safeJsonStringify(value), MAX_DETAILS_LENGTH));
  } catch {
    return trimText(String(value), MAX_DETAILS_LENGTH);
  }
}

function safeJsonStringify(value: unknown): string {
  const seen = new WeakSet<object>();
  const serialized = JSON.stringify(value, (_key, currentValue) => {
    if (typeof currentValue === 'object' && currentValue !== null) {
      if (seen.has(currentValue)) return '[Circular]';
      seen.add(currentValue);
    }
    if (typeof currentValue === 'bigint') return currentValue.toString();
    if (typeof currentValue === 'function') return `[Function ${currentValue.name || 'anonymous'}]`;
    return currentValue;
  });
  return serialized ?? 'null';
}
