// src/api/profile.ts
// Frontend API client for authenticated profile statistics.
// Statistics are computed server-side from durable room history, so they
// survive the 5-minute active-room cleanup.

import { RoomHistoryStats } from '../types';

export interface ProfileStatsResponse {
  stats?: RoomHistoryStats;
  error?: { code: string; message: string };
}

/** Fetch the authenticated user's authoritative room statistics. */
export async function fetchProfileStatsApi(): Promise<ProfileStatsResponse> {
  try {
    const res = await fetch('/api/profile/stats', {
      method: 'GET',
      credentials: 'include',
    });
    if (!res.ok) {
      return { error: { code: 'STATS_FAILED', message: 'Failed to fetch profile statistics.' } };
    }
    const data = await res.json().catch(() => ({}));
    return { stats: data.stats };
  } catch {
    return { error: { code: 'NETWORK_ERROR', message: 'Network connection failed.' } };
  }
}