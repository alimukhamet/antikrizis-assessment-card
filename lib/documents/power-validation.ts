import approved from './approved-representatives.server.json';
import {representativeAllowed,type Representative} from './policy';
import type {PowerParties} from './power-of-attorney';
/** Matching authorized reference records does not verify execution, revocation or legal scope. */
export function checkPowerRepresentative(power:PowerParties|undefined){
 const findings=representativeAllowed(power?.representative||null,approved as Representative[]);
 return {representativeMatched:findings.length===0,authorityVerified:false,findings:findings.map(f=>f.code)};
}
