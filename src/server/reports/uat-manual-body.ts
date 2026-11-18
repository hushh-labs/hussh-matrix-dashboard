import { ReportError } from './contracts';
import { withinDeadline } from './deadline';

/** Bounded manual input; an incomplete or late stream cannot start an RPC. */
export async function readUatManualBody(request:Request,signal:AbortSignal):Promise<unknown> {
 if(Number(request.headers.get('content-length'))>2048)throw new ReportError('invalid');
 const reader=request.body?.getReader();if(!reader)throw new ReportError('invalid');let text='',bytes=0;const decoder=new TextDecoder();
 try {while(true){signal.throwIfAborted();const part=await withinDeadline(reader.read(),signal);if(part.done)break;bytes+=part.value.byteLength;if(bytes>2048)throw new ReportError('invalid');text+=decoder.decode(part.value,{stream:true});}}
 finally {void reader.cancel().catch(()=>{});}
 signal.throwIfAborted();try{return JSON.parse(text+decoder.decode());}catch{throw new ReportError('invalid');}
}
