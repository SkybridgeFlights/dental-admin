function getExpectedInternalKey() {
  return String(process.env.LICENSE_HMAC_SECRET || '').trim();
}

export function isDesktopInternalRequest(request: Request) {
  const expected = getExpectedInternalKey();
  if (!expected) {
    return false;
  }

  const provided = String(
    request.headers.get('x-dentalpro-internal-key')
      || request.headers.get('authorization')?.replace(/^Bearer\s+/i, '')
      || '',
  ).trim();

  return Boolean(provided) && provided === expected;
}

