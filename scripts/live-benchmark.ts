import { createApp } from '../server/app';
import { createSession } from '../server/auth/session';
import { db } from '../server/db/index';

async function main() {
  const app = createApp();
  const user = db.prepare('SELECT id, email, role FROM users WHERE role = ? LIMIT 1').get('admin') as any;
  console.log('Testing with admin user:', user.email);
  const token = await createSession(user.id);

  let roomId: string | undefined;

  try {
    // 1. Create a room
    const createRoomRes = await app.request('/api/rooms', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Cookie': 'praconnect-session=' + token },
      body: JSON.stringify({ name: 'Live Reproduction Room' })
    });
    const roomData = (await createRoomRes.json()) as any;
    roomId = roomData.room.id;
    console.log('Created room:', roomId, 'status:', createRoomRes.status);

    // 2. Fetch Media Library items
    const mediaListRes = await app.request('/api/media?q=EP4', {
      headers: { 'Cookie': 'praconnect-session=' + token }
    });
    const mediaListData = (await mediaListRes.json()) as any;
    const targetItem = mediaListData.items[0];
    console.log('Target ready item:', targetItem.id, targetItem.title, 'sizeBytes:', targetItem.sizeBytes);

    // 3. Measure Room Selection endpoint timing & payload
    const t0 = performance.now();
    const selectRes = await app.request(`/api/rooms/${roomId}/media/library`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Cookie': 'praconnect-session=' + token },
      body: JSON.stringify({ mediaId: targetItem.id })
    });
    const selectElapsed = performance.now() - t0;
    const selectData = (await selectRes.json()) as any;
    console.log('POST /media/library response status:', selectRes.status, 'in', selectElapsed.toFixed(2), 'ms');
    console.log('Room currentMedia stored:', selectData.room?.currentMedia);

    // 4. Measure initial video byte range request (first 1MB chunk)
    const t1 = performance.now();
    const streamRes = await app.request(`/api/media/${targetItem.id}/download`, {
      headers: { 'Cookie': 'praconnect-session=' + token, 'Range': 'bytes=0-1048575' }
    });
    const streamElapsed = performance.now() - t1;
    const streamBuffer = await streamRes.arrayBuffer();
    console.log('GET /download initial chunk status:', streamRes.status, 'in', streamElapsed.toFixed(2), 'ms');
    console.log('Headers:', {
      'accept-ranges': streamRes.headers.get('accept-ranges'),
      'content-range': streamRes.headers.get('content-range'),
      'content-length': streamRes.headers.get('content-length'),
      'content-type': streamRes.headers.get('content-type'),
    });
    console.log('Received chunk bytes:', streamBuffer.byteLength);

    // 5. Measure mid-file seek range request (at 500MB offset)
    const t2 = performance.now();
    const seekRes = await app.request(`/api/media/${targetItem.id}/download`, {
      headers: { 'Cookie': 'praconnect-session=' + token, 'Range': 'bytes=500000000-501048575' }
    });
    const seekElapsed = performance.now() - t2;
    const seekBuffer = await seekRes.arrayBuffer();
    console.log('GET /download seek chunk status:', seekRes.status, 'in', seekElapsed.toFixed(2), 'ms');
    console.log('Seek headers:', {
      'content-range': seekRes.headers.get('content-range'),
      'content-length': seekRes.headers.get('content-length'),
    });
    console.log('Seek received bytes:', seekBuffer.byteLength);
  } finally {
    if (roomId) {
      db.prepare('DELETE FROM roomHistoryMembers WHERE historyId IN (SELECT id FROM roomHistory WHERE roomId = ?)').run(roomId);
      db.prepare('DELETE FROM roomHistory WHERE roomId = ?').run(roomId);
      db.prepare('DELETE FROM roomMembers WHERE roomId = ?').run(roomId);
      db.prepare('DELETE FROM roomEvents WHERE roomId = ?').run(roomId);
      db.prepare('DELETE FROM rooms WHERE id = ?').run(roomId);
    }
  }
}

main().catch(console.error);
