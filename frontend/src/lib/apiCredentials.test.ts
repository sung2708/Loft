import {beforeEach,afterEach,describe,it,expect,vi} from 'vitest';
const auth=vi.hoisted(()=>({getSession:vi.fn()}));
vi.mock('./supabase/client',()=>({getSupabase:()=>({auth})}));
import {api} from './api';
beforeEach(()=>{auth.getSession.mockReset()});
afterEach(()=>vi.unstubAllGlobals());
describe('room API credentials',()=>{
 it('uses the refreshed Supabase session for a long-lived room credential',async()=>{
  auth.getSession.mockResolvedValue({data:{session:{access_token:'refreshed'}},error:null});
  const fetch=vi.fn().mockResolvedValue(new Response(JSON.stringify({version:0,records:{}})));vi.stubGlobal('fetch',fetch);
  await api.board('room',{type:'user',token:'expired',roomId:'room',displayName:'Alice'});
  expect(new Headers(fetch.mock.calls[0][1].headers).get('Authorization')).toBe('Bearer refreshed');
 });
 it('never refreshes or replaces a room-scoped guest token',async()=>{
  const fetch=vi.fn().mockResolvedValue(new Response(JSON.stringify({version:0,records:{}})));vi.stubGlobal('fetch',fetch);
  await api.board('room',{type:'guest',token:'guest',roomId:'room',displayName:'Guest'});
  expect(auth.getSession).not.toHaveBeenCalled();
  expect(new Headers(fetch.mock.calls[0][1].headers).get('X-Guest-Token')).toBe('guest');
 });
 it('stops before sending an expired user token after sign out',async()=>{
  auth.getSession.mockResolvedValue({data:{session:null},error:null});const fetch=vi.fn();vi.stubGlobal('fetch',fetch);
  await expect(api.board('room',{type:'user',token:'expired',roomId:'room',displayName:'Alice'})).rejects.toMatchObject({status:401});
  expect(fetch).not.toHaveBeenCalled();
 });
});

it('uses a conditional board read and accepts an empty 304 response',async()=>{
 const fetch=vi.fn().mockResolvedValue(new Response(null,{status:304}));vi.stubGlobal('fetch',fetch);
 const snapshot=await api.board('room',{type:'guest',token:'guest',roomId:'room',displayName:'Guest'},undefined,7);
 expect(new Headers(fetch.mock.calls[0][1].headers).get('If-None-Match')).toBe('"board-7"');
 expect(snapshot).toBeUndefined();
});
