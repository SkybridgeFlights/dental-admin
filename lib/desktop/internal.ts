function maskSecret(value: string) {
  const trimmed = String(value || '').trim();
  if (!trimmed) {
    return null;
  }
  if (trimmed.length <= 8) {
    return `${trimmed.slice(0, 2)}***`;
  }
  return `${trimmed.slice(0, 4)}***${trimmed.slice(-4)}`;
}

export function normalizeDesktopInternalKey(value: string | null | undefined) {
  let normalized = String(value || '').trim();
  if (!normalized) {
    return '';
  }

  for (let i = 0; i < 3; i += 1) {
    if (/^LICENSE_HMAC_SECRET=/i.test(normalized)) {
      normalized = normalized.replace(/^LICENSE_HMAC_SECRET=/i, '').trim();
      continue;
    }
    break;
  }

  return normalized;
}

function getExpectedInternalKey() {
  return normalizeDesktopInternalKey(process.env.LICENSE_HMAC_SECRET);
}

export function inspectDesktopInternalRequest(request: Request) {
  const expected = getExpectedInternalKey();
  const headerValue = request.headers.get('x-dentalpro-internal-key');
  const authHeader = request.headers.get('authorization');
  const provided = normalizeDesktopInternalKey(
    headerValue || authHeader?.replace(/^Bearer\s+/i, '') || '',
  );
  const source = headerValue ? 'x-dentalpro-internal-key' : authHeader ? 'authorization' : null;

  let reason = 'OK';
  if (!expected) {
    reason = 'EXPECTED_SECRET_MISSING';
  } else if (!provided) {
    reason = 'PROVIDED_SECRET_MISSING';
  } else if (provided !== expected) {
    reason = 'SECRET_MISMATCH';
  }

  return {
    ok: reason === 'OK',
    reason,
    source,
    expectedPreview: maskSecret(expected),
    providedPreview: maskSecret(provided),
    hasExpectedSecret: Boolean(expected),
    hasProvidedSecret: Boolean(provided),
    requestMeta: {
      method: request.method,
      url: request.url,
      origin: request.headers.get('origin'),
      referer: request.headers.get('referer'),
      userAgent: request.headers.get('user-agent'),
    },
  };
}

export function isDesktopInternalRequest(request: Request) {
  return inspectDesktopInternalRequest(request).ok;
}
