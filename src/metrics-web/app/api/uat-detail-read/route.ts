import { uatPassive } from '../../../lib/uat-passive';
export async function POST(request:Request) {return uatPassive(request,'read');}
