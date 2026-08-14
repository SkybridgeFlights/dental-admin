import { authenticateDeviceRequest } from '@/lib/device/authenticate';

// Desktop callers authenticate with the per-device random credential issued
// inside the signed licence. There is deliberately no application-wide secret:
// anything shipped in Electron must be treated as public/extractable.
export async function authenticateDesktopRequest(request: Request) {
  return authenticateDeviceRequest(request, request.headers.get('x-device-id') || '');
}
