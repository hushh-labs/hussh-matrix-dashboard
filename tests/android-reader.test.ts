import {describe,it,expect,vi,afterEach} from 'vitest';
const mocks=vi.hoisted(()=>({request:vi.fn(),getClient:vi.fn(async()=>({}))}));
vi.mock('google-auth-library',()=>({GoogleAuth:class{getClient=mocks.getClient;},Impersonated:class{request=mocks.request;}}));
import {googleReader} from '../src/server/android-reporting';
afterEach(()=>{vi.useRealTimers();mocks.request.mockReset();});
describe('Bounded Google reporting transport',()=>{
  it('rejects untrusted hosts, userinfo, protocol and ports before loading credentials',async()=>{
    const read=googleReader('reader@example.test',['readonly']);
    for(const url of ['https://evil.example/report','http://analyticsdata.googleapis.com/report','https://secret@analyticsdata.googleapis.com/report','https://analyticsdata.googleapis.com:8443/report'])await expect(read(url)).rejects.toThrow('Untrusted');
    expect(mocks.getClient).not.toHaveBeenCalled();
  });
  it('uses explicit bounds and suppresses provider error secrets without retrying a denied request',async()=>{
    mocks.request.mockRejectedValue({response:{status:403,data:{access_token:'fixture-secret'},config:{url:'https://provider/?secret=fixture-secret'}}});
    const read=googleReader('reader@example.test',['readonly']);
    const error=await read('https://analyticsdata.googleapis.com/report').catch(error=>error);
    expect(error.status).toBe(403);expect(error.message).not.toContain('fixture-secret');expect(error.response).toBeUndefined();expect(mocks.request).toHaveBeenCalledTimes(1);
    expect(mocks.request.mock.calls[0][0]).toMatchObject({timeout:10000,retry:false,maxRedirects:0,size:10485760});
  });
  it('honors a capped retry delay and makes at most two calls for rate limits',async()=>{
    vi.useFakeTimers();mocks.request.mockRejectedValue({response:{status:429,headers:{'retry-after':'600'},data:{secret:'fixture-secret'}}});
    const promise=googleReader('reader@example.test',['readonly'])('https://analyticsdata.googleapis.com/report').catch(error=>error);
    await vi.advanceTimersByTimeAsync(2999);expect(mocks.request).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);const error=await promise;
    expect(mocks.request).toHaveBeenCalledTimes(2);expect(error.status).toBe(429);expect(error.response).toBeUndefined();
  });
});
