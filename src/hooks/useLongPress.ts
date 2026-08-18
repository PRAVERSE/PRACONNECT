// src/hooks/useLongPress.ts
// Mobile long-press detection built on the framework-free tracker from
// src/utils/contextMenu. Returns touch handlers plus a click-suppression
// capture handler so the long press does not also trigger the row click.

import { useCallback, useEffect, useRef } from 'react';
import type { TouchEvent, MouseEvent } from 'react';
import { createLongPressTracker } from '../utils/contextMenu';
import type { LongPressTracker } from '../utils/contextMenu';

export interface UseLongPressOptions {
  /** Hold duration before the press fires (ms). */
  delay?: number;
  /** Movement tolerance before the hold is treated as a scroll (px). */
  tolerance?: number;
}

export interface LongPressHandlers {
  onTouchStart: (e: TouchEvent<HTMLElement>) => void;
  onTouchMove: (e: TouchEvent<HTMLElement>) => void;
  onTouchEnd: (e: TouchEvent<HTMLElement>) => void;
  onTouchCancel: (e: TouchEvent<HTMLElement>) => void;
  /** Fires on the next click after a long press and swallows it. */
  onClickCapture: (e: MouseEvent<HTMLElement>) => void;
}

export function useLongPress(onLongPress: (x: number, y: number) => void, options?: UseLongPressOptions): LongPressHandlers {
  const callbackRef = useRef(onLongPress);
  useEffect(() => {
    callbackRef.current = onLongPress;
  }, [onLongPress]);

  const trackerRef = useRef<LongPressTracker | null>(null);
  if (trackerRef.current === null) {
    trackerRef.current = createLongPressTracker({
      delay: options?.delay,
      tolerance: options?.tolerance,
      onTrigger: (x, y) => callbackRef.current(x, y),
    });
  }

  const suppressClickRef = useRef(false);

  const onTouchStart = useCallback((e: TouchEvent<HTMLElement>) => {
    const touch = e.touches[0];
    if (!touch) return;
    trackerRef.current?.onStart(touch.clientX, touch.clientY);
  }, []);

  const onTouchMove = useCallback((e: TouchEvent<HTMLElement>) => {
    const touch = e.touches[0];
    if (!touch) return;
    trackerRef.current?.onMove(touch.clientX, touch.clientY);
  }, []);

  const onTouchEnd = useCallback(() => {
    const result = trackerRef.current?.onEnd();
    if (result?.triggered) suppressClickRef.current = true;
  }, []);

  const onTouchCancel = useCallback(() => {
    trackerRef.current?.onCancel();
  }, []);

  const onClickCapture = useCallback((e: MouseEvent<HTMLElement>) => {
    if (suppressClickRef.current) {
      suppressClickRef.current = false;
      e.preventDefault();
      e.stopPropagation();
    }
  }, []);

  return { onTouchStart, onTouchMove, onTouchEnd, onTouchCancel, onClickCapture };
}