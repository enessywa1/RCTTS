const API_BASE = '';

function handleRes(res: Response) {
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
}

export async function getList(collection: string) {
  const res = await fetch(`${API_BASE}/api/${collection}`);
  return handleRes(res);
}

export async function createDoc(collection: string, payload: any) {
  const res = await fetch(`${API_BASE}/api/${collection}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
  return handleRes(res);
}

export async function updateDocApi(collection: string, id: string, payload: any) {
  const res = await fetch(`${API_BASE}/api/${collection}/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
  return handleRes(res);
}

export async function deleteDocApi(collection: string, id: string) {
  const res = await fetch(`${API_BASE}/api/${collection}/${id}`, { method: 'DELETE' });
  return handleRes(res);
}

export function subscribe(collection: string, onEvent: (ev: { event: string; payload: any }) => void) {
  const src = new EventSource(`/api/stream?topic=${encodeURIComponent(collection)}`);
  src.onmessage = (e) => {
    // default message handler (ping)
  };
  src.addEventListener('create', (e: MessageEvent) => {
    try { onEvent({ event: 'create', payload: JSON.parse((e as any).data).payload }); } catch (err) { console.error(err); }
  });
  src.addEventListener('update', (e: MessageEvent) => {
    try { onEvent({ event: 'update', payload: JSON.parse((e as any).data).payload }); } catch (err) { console.error(err); }
  });
  src.addEventListener('delete', (e: MessageEvent) => {
    try { onEvent({ event: 'delete', payload: JSON.parse((e as any).data).payload }); } catch (err) { console.error(err); }
  });
  src.addEventListener('ping', () => {});
  return () => src.close();
}

const api = { getList, createDoc, updateDocApi, deleteDocApi, subscribe };
export default api;
