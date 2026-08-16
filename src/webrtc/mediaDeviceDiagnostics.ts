// src/webrtc/mediaDeviceDiagnostics.ts
// Diagnostic helper for media devices (Camera, Microphone, Screen Share).
// Handles permission states, device enumeration, secure context checks, and actionable error mapping.

export interface MediaDeviceInfoSummary {
  hasVideoInput: boolean;
  hasAudioInput: boolean;
  videoDeviceCount: number;
  audioDeviceCount: number;
  devices: { deviceId: string; kind: MediaDeviceKind; label: string }[];
}

export interface MediaDiagnosticError {
  type: 'permission_denied' | 'device_not_found' | 'device_busy' | 'overconstrained' | 'insecure_context' | 'unsupported' | 'unknown';
  title: string;
  message: string;
  actionableHint: string;
  originalErrorName?: string;
}

/** Check if the browser environment supports media capture APIs */
export function checkMediaSupport(): { supported: boolean; reason?: string } {
  if (typeof window === 'undefined') {
    return { supported: false, reason: 'Media capture is only available in browser environments.' };
  }

  if (!window.isSecureContext) {
    return {
      supported: false,
      reason: 'Camera and microphone access requires a Secure Context (HTTPS or http://localhost:3000).',
    };
  }

  if (!navigator.mediaDevices || typeof navigator.mediaDevices.getUserMedia !== 'function') {
    return {
      supported: false,
      reason: 'Your browser does not support the WebRTC MediaDevices API.',
    };
  }

  return { supported: true };
}

/** Enumerate connected audio/video hardware devices */
export async function inspectAvailableMediaDevices(): Promise<MediaDeviceInfoSummary> {
  const summary: MediaDeviceInfoSummary = {
    hasVideoInput: false,
    hasAudioInput: false,
    videoDeviceCount: 0,
    audioDeviceCount: 0,
    devices: [],
  };

  if (!navigator.mediaDevices?.enumerateDevices) {
    return summary;
  }

  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    for (const dev of devices) {
      summary.devices.push({
        deviceId: dev.deviceId,
        kind: dev.kind,
        label: dev.label || `${dev.kind} (${dev.deviceId.slice(0, 5)}...)`,
      });

      if (dev.kind === 'videoinput') {
        summary.hasVideoInput = true;
        summary.videoDeviceCount++;
      } else if (dev.kind === 'audioinput') {
        summary.hasAudioInput = true;
        summary.audioDeviceCount++;
      }
    }
  } catch (err) {
    console.warn('[Diagnostics] Failed enumerating media devices:', err);
  }

  return summary;
}

/** Log complete media environment diagnostics */
export async function logMediaEnvironmentDiagnostics(action: string, requestedConstraints?: any): Promise<void> {
  if (typeof window === 'undefined') return;

  console.group(`[CAMERA] Diagnostics (${action})`);
  console.log('secureContext:', window.isSecureContext);
  console.log('origin:', window.location?.origin);
  console.log('mediaDevicesAvailable:', Boolean(navigator.mediaDevices));
  console.log('getUserMedia function:', typeof navigator.mediaDevices?.getUserMedia);
  console.log('requestedConstraints:', requestedConstraints);
  console.groupEnd();

  if (navigator.mediaDevices?.enumerateDevices) {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const videoInputs = devices.filter((d) => d.kind === 'videoinput');
      const audioInputs = devices.filter((d) => d.kind === 'audioinput');
      const audioOutputs = devices.filter((d) => d.kind === 'audiooutput');
      console.group(
        `[DEVICES] Total devices: ${devices.length} (videoinput count: ${videoInputs.length}, audioinput count: ${audioInputs.length}, audiooutput count: ${audioOutputs.length})`
      );
      videoInputs.forEach((d, idx) => {
        console.log(`  videoinput [${idx}] label="${d.label}" | deviceId="${d.deviceId}" | groupId="${d.groupId}"`);
      });
      console.groupEnd();
    } catch (e) {
      console.warn('[DEVICES] Failed enumerating devices:', e);
    }
  }
}

/**
 * Full raw device enumeration dump. Logs every device (kind, deviceId,
 * groupId, label) plus the mediaDevices API surface. Used to distinguish:
 *   A. no physical camera        -> 0 videoinput AND 0 audioinput of that type
 *   B. permission denied         -> Chrome hides videoinput from enumeration
 *   C. device temporarily gone   -> 0 videoinput, appears later on devicechange
 *   D. our code stopped camera   -> track stopped, but DEVICE STILL ENUMERATES
 */
export async function logFullDeviceEnumeration(phase: string): Promise<{
  total: number;
  videoInputs: number;
  audioInputs: number;
  audioOutputs: number;
}> {
  const result = { total: 0, videoInputs: 0, audioInputs: 0, audioOutputs: 0 };

  if (typeof navigator === 'undefined' || !navigator.mediaDevices?.enumerateDevices) {
    console.log(`[DEVICES] ${phase}: enumerateDevices unavailable`);
    return result;
  }

  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    result.total = devices.length;
    result.videoInputs = devices.filter((d) => d.kind === 'videoinput').length;
    result.audioInputs = devices.filter((d) => d.kind === 'audioinput').length;
    result.audioOutputs = devices.filter((d) => d.kind === 'audiooutput').length;

    console.group(`[DEVICES] ${phase}: total=${result.total} videoinput=${result.videoInputs} audioinput=${result.audioInputs} audiooutput=${result.audioOutputs}`);
    console.table(
      devices.map((d) => ({
        kind: d.kind,
        deviceId: d.deviceId,
        groupId: d.groupId,
        label: d.label || '(label masked — permission never granted)',
      }))
    );
    console.log('navigator.mediaDevices:', navigator.mediaDevices);
    console.log('navigator.mediaDevices.getUserMedia:', typeof navigator.mediaDevices?.getUserMedia);
    console.log('navigator.mediaDevices.getDisplayMedia:', typeof navigator.mediaDevices?.getDisplayMedia);
    console.groupEnd();
  } catch (e) {
    console.warn(`[DEVICES] ${phase}: enumeration failed:`, e);
  }

  return result;
}

/**
 * Query the camera permission state where the browser supports it.
 * Returns 'granted' | 'prompt' | 'denied', or null when unavailable.
 * Chromium behavior: when the permission is DENIED, enumerateDevices()
 * returns zero videoinput devices and getUserMedia rejects with
 * NotFoundError (NOT NotAllowedError). This mapping is the key evidence
 * for distinguishing permission-denied from missing hardware.
 */
export async function queryCameraPermissionState(): Promise<string | null> {
  if (typeof navigator === 'undefined' || !navigator.permissions?.query) {
    console.log('[PERMISSIONS] navigator.permissions.query not available');
    return null;
  }
  try {
    const status = await (navigator.permissions as any).query({ name: 'camera' });
    console.log('[CAMERA DEBUG] camera permission state:', status.state);
    return status.state as string;
  } catch (e) {
    console.log('[CAMERA DEBUG] camera permission query unavailable:', e);
    return null;
  }
}

/** Non-blocking camera/mic permission-state query for diagnostics. Never throws, never required. */
export async function logMediaPermissions(): Promise<void> {
  if (typeof navigator === 'undefined' || !navigator.permissions?.query) {
    console.log('[PERMISSIONS] navigator.permissions.query not available');
    return;
  }
  try {
    for (const name of ['camera', 'microphone'] as const) {
      // 'camera' / 'microphone' are not in TS lib.dom PermissionName types
      const status = await (navigator.permissions as any).query({ name });
      console.log(`[PERMISSIONS] ${name}:`, status.state);
    }
  } catch {
    console.log('[PERMISSIONS] query not supported for camera/microphone in this browser');
  }
}

/** Convert raw getUserMedia / getDisplayMedia errors into actionable user diagnostics */
export function diagnoseMediaError(
  err: unknown,
  deviceType: 'camera' | 'microphone' | 'screen'
): MediaDiagnosticError {
  const error =
    err instanceof DOMException
      ? err
      : err instanceof Error
        ? err
        : new Error(String(err));

  const errorName = error.name;
  const errorMessage = error.message;
  const constraint = (error as DOMException & { constraint?: string }).constraint;

  console.error('[Diagnostics] Camera error name:', error.name);
  console.error('[Diagnostics] Camera error message:', error.message);

  if (error.name === 'OverconstrainedError') {
    console.error('[Diagnostics] Failed constraint:', constraint);
  }

  const friendlyMessage: Record<string, string> = {
    NotAllowedError: 'Camera permission was denied or blocked.',
    NotFoundError: 'No camera device was found.',
    NotReadableError: 'Camera is already in use by another app or tab.',
    AbortError: 'Camera timed out starting or is locked by another application.',
    OverconstrainedError: 'Requested camera settings are not supported by this device.',
    SecurityError: 'Camera blocked because the page is not in a secure context.',
  };

  console.error(
    '[Diagnostics] Interpreted cause:',
    friendlyMessage[error.name] ?? 'Unknown camera error.'
  );

  console.error('[CAMERA RAW ERROR]', {
    name: error.name,
    message: error.message,
    constraint,
    stack: (error as any).stack,
  });

  if (typeof window !== 'undefined') {
    console.log('[CAMERA ENV]', {
      secure: window.isSecureContext,
      origin: window.location?.origin,
      mediaDevices: !!navigator.mediaDevices,
    });
  }

  if (typeof navigator !== 'undefined' && navigator.mediaDevices?.enumerateDevices) {
    navigator.mediaDevices
      .enumerateDevices()
      .then((devices) => {
        console.log(
          '[CAMERA DEVICES]',
          devices.map((d) => ({
            kind: d.kind,
            label: d.label || '(empty/masked)',
            deviceId: d.deviceId ? `${d.deviceId.slice(0, 8)}...` : '',
            groupId: d.groupId ? `${d.groupId.slice(0, 8)}...` : '',
          }))
        );
      })
      .catch((e) => console.warn('[CAMERA DEVICES enumeration error]:', e));
  }

  // 1. Permission Denied
  if (
    errorName === 'NotAllowedError' ||
    errorName === 'PermissionDeniedError' ||
    errorName === 'PermissionDismissedError'
  ) {
    const devLabel = deviceType === 'camera' ? 'Camera' : deviceType === 'microphone' ? 'Microphone' : 'Screen Share';
    return {
      type: 'permission_denied',
      title: `${devLabel} Permission Blocked`,
      message: `${devLabel} permission was denied. Allow ${devLabel.toLowerCase()} access for localhost in Chrome site settings.`,
      actionableHint:
        'Click the Site Settings / Tune icon in Chrome\'s address bar (left of localhost:3000), set Camera & Microphone to "Allow", then click Try Again.',
      originalErrorName: errorName,
    };
  }

  // 2. Device Not Found
  if (
    errorName === 'NotFoundError' ||
    errorName === 'DevicesNotFoundError'
  ) {
    if (deviceType === 'camera') {
      return {
        type: 'device_not_found',
        title: 'No Camera Detected',
        message:
          'No camera detected. Check OS-level camera permissions for this browser, or that a camera is connected/passed through if running in a VM or remote session.',
        actionableHint:
          'Check OS-level camera permissions for this browser, or ensure a camera is connected/passed through. Once detected, this warning will clear automatically.',
        originalErrorName: errorName,
      };
    }
    return {
      type: 'device_not_found',
      title: 'No Microphone Device Available',
      message: 'No microphone device was found on your system.',
      actionableHint:
        'Check that your microphone is connected, unmuted, and Windows Audio Privacy settings permit browser access.',
      originalErrorName: errorName,
    };
  }

  // 3. Device Busy / Locked by another app / Timeout
  if (
    errorName === 'NotReadableError' ||
    errorName === 'TrackStartError' ||
    errorName === 'SourceUnavailableError' ||
    errorName === 'AbortError' ||
    errorMessage.toLowerCase().includes('timeout')
  ) {
    return {
      type: 'device_busy',
      title: `${deviceType === 'camera' ? 'Camera' : 'Microphone'} Busy or Timed Out`,
      message: `The ${deviceType} timed out starting or is currently locked by another application.`,
      actionableHint:
        'Please close Zoom, Microsoft Teams, Discord, OBS Studio, Windows Camera, or other browser tabs that may be using the camera, or try unplugging and reconnecting it.',
      originalErrorName: errorName,
    };
  }

  // 4. Overconstrained
  if (errorName === 'OverconstrainedError' || errorName === 'ConstraintNotSatisfiedError') {
    return {
      type: 'overconstrained',
      title: 'Resolution Setting Unsupported',
      message: `The camera does not satisfy the constraint "${constraint || 'unknown'}".`,
      actionableHint: 'The application will automatically retry with basic unconstrained settings.',
      originalErrorName: errorName,
    };
  }

  // 5. Insecure context / SecurityError
  if (errorName === 'SecurityError') {
    return {
      type: 'insecure_context',
      title: 'Secure Context Required',
      message: 'Camera and microphone access is restricted by browser security policies.',
      actionableHint: 'Ensure you are accessing PraConnect on http://localhost:3000 or an HTTPS URL.',
      originalErrorName: errorName,
    };
  }

  // 6. AbortError
  if (errorName === 'AbortError') {
    return {
      type: 'unknown',
      title: 'Camera Initialization Interrupted',
      message: 'The camera capture process was interrupted before completing.',
      actionableHint: 'Please click Try Again to restart camera initialization.',
      originalErrorName: errorName,
    };
  }

  // Default fallback
  return {
    type: 'unknown',
    title: `Could Not Access ${deviceType === 'camera' ? 'Camera' : 'Microphone'}`,
    message: errorMessage || 'An unexpected error occurred while accessing media device.',
    actionableHint: 'Please refresh the page or check your browser device permissions.',
    originalErrorName: errorName,
  };
}
