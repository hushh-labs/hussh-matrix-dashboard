import {expect,it,vi} from 'vitest';
import {readUatManualBody} from '../src/server/reports/uat-manual-body';
it('accepts complete bounded JSON',async()=>{expect(await readUatManualBody(new Request('https://x',{method:'POST',body:'{"ok":true}'}),new AbortController().signal)).toEqual({ok:true});});
it('rejects a delayed body before it can start downstream work',async()=>{
 let finish!:()=>void;const body=new ReadableStream({start(controller){finish=()=>{try{controller.enqueue(new TextEncoder().encode('{}'));controller.close();}catch{}};}});
 const request=new Request('https://x',{method:'POST',body,duplex:'half'} as RequestInit),controller=new AbortController(),call=vi.fn();
 const pending=readUatManualBody(request,controller.signal).then(call);controller.abort();await expect(pending).rejects.toThrow();finish();expect(call).not.toHaveBeenCalled();
});
