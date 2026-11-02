// Minimal ABI for the fixed Barz/EntryPoint-v0.6/USDT flow. All integers use BigInt.
import { DEFAULTS } from './defaults.mjs';
import { keccak_256 } from './vendor/noble/sha3.mjs';
import { derToRaw, hex, b64url } from './verify.mjs';
export const CONFIG = Object.freeze({
  kind:'erc20', chainId: 56, name: 'BNB Smart Chain', nativeSymbol: 'BNB', tokenLabel: 'USDT', decimals: 18, rpc: 'https://bsc-rpc.publicnode.com', bundler: 'https://public.pimlico.io/v2/56/rpc', explorer: 'https://bscscan.com/tx/', wallet: DEFAULTS.source,
  recipient: DEFAULTS.recipient,
  token: '0x55d398326f99059fF775485246999027B3197955',
  entryPoint: '0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789',
  balanceProbe: '0xcA11bde05977b3631167028862bE2a173976CA11', probeCodeHash:'0xd5c15df687b16f2ff992fc8d767b4216323184a2bbc6ee2f9c398c318e770891',
  facet: '0xeE1AF8E967eC04C84711842796A5E714D2FD33e6',
  walletCodeHash: '0xe152e0d0626438840037db419d2e66fa32002f1ee719b1dbe2892314bc67b6de',
  facetCodeHash: '0x0e02cce4ace56018fd70d12c98215fd27e92fc6d7fc8562f06f8524b0e080062',
  entryCodeHash: '0xc93c806e738300b5357ecdc2e971d6438d34d8e4e17b99b758b1f9cac91c8e70',
  accountFacet: '0xFde53272dcd7938d16E031A6989753c321728332',
  accountCodeHash: '0x38115bfd536bacc88df5ca50668ffe8c13642430da991a4ea34a56263c38a230',
  feeCapWei: 330000000000000n, maxFee: 200000000n, callGas: 300000n, verificationGas: 1200000n, preGas: 150000n
});
export const NETWORKS=Object.freeze({
 56: CONFIG,
 137: Object.freeze({...CONFIG,chainId:137,name:'Polygon PoS',nativeSymbol:'POL',tokenLabel:'USDT / USDT0',decimals:6,
  rpc:'https://polygon-bor-rpc.publicnode.com',bundler:'https://public.pimlico.io/v2/137/rpc',explorer:'https://polygonscan.com/tx/',
  token:'0xc2132D05D31c914a87C6611C10748AEb04B58e8F',maxFee:500000000000n,feeCapWei:825000000000000000n})
});
export function normalizeAddress(value){
 check(typeof value==='string'&&/^0x[0-9a-fA-F]{40}$/.test(value.trim()),'Enter a full 0x address with 40 hexadecimal characters.');
 const raw=value.trim().slice(2),lower=raw.toLowerCase(),digest=hashHex(new TextEncoder().encode(lower)).slice(2);
 const checked='0x'+[...lower].map((x,i)=>parseInt(digest[i],16)>=8?x.toUpperCase():x).join('');
 check(raw===lower||raw===raw.toUpperCase()||'0x'+raw===checked,'Invalid address checksum.');
 check(BigInt('0x'+lower)!==0n,'Zero address is not allowed.');return checked;
}
export const FEE_OPTIONS=Object.freeze({56:Object.freeze([200000000n,500000000n,1000000000n]),137:Object.freeze([500000000000n,1000000000000n,2000000000000n,5000000000000n])});
export function makeContext(chainId=137,wallet=CONFIG.wallet,recipient=CONFIG.recipient,asset={}){
 const n=NETWORKS[Number(chainId)];check(n,'Only Polygon and BSC are supported.');
 const maxFee=BigInt(asset.maxFee??n.maxFee);check(FEE_OPTIONS[n.chainId].includes(maxFee),'Unsupported gas price ceiling.');
 const feeCapWei=(n.callGas+n.verificationGas+n.preGas)*maxFee;
 const from=normalizeAddress(wallet),to=recipient?.trim()?normalizeAddress(recipient):'';check(!to||from!==to,'Source and recipient must be different.');
 const kind=asset.kind||'erc20';check(['erc20','native'].includes(kind),'Unsupported asset type.');
 const token=kind==='native'?'':normalizeAddress(asset.token||n.token);
 const known=kind==='erc20'&&token.toLowerCase()===n.token.toLowerCase();
 const decimals=kind==='native'?18:asset.decimals??(known?n.decimals:null);
 check(decimals===null||(Number.isInteger(decimals)&&decimals>=0&&decimals<=36),'Token decimals must be between 0 and 36.');
 const symbol=kind==='native'?n.nativeSymbol:String(asset.symbol||asset.tokenLabel||(known?n.tokenLabel:'TOKEN')).replace(/[\x00-\x1f\x7f]/g,'').slice(0,40)||'TOKEN';
 return Object.freeze({...n,maxFee,feeCapWei,wallet:from,recipient:to,kind,token,decimals,tokenLabel:symbol});
}
export const contextKey=c=>String(c.chainId)+':'+c.wallet.toLowerCase()+':'+c.recipient.toLowerCase()+':'+(c.kind||'erc20')+':'+(c.token||'').toLowerCase()+':'+String(c.maxFee);
export function maxAmount(snapshot,C){
 if(C.kind!=='native')return snapshot.balance;
 const reserve=C.feeCapWei>snapshot.deposit?C.feeCapWei-snapshot.deposit:0n;
 return snapshot.bnb>reserve?snapshot.bnb-reserve:0n;
}
export function check(ok,message){ if(!ok) throw new Error(message); }
export function unhex(value){ check(typeof value==='string' && /^0x(?:[0-9a-fA-F]{2})*$/.test(value),'Invalid hexadecimal data.');return Uint8Array.from(value.slice(2).match(/../g)||[],b=>parseInt(b,16)); }
export const hashHex = bytes => '0x'+hex(keccak_256(bytes));
export const selector = text => hashHex(new TextEncoder().encode(text)).slice(0,10);
export function word(n){const v=BigInt(n);check(v>=0n && v<(1n<<256n),'Invalid uint256.');return v.toString(16).padStart(64,'0');}
export function addressWord(a){check(/^0x[0-9a-fA-F]{40}$/.test(a),'Invalid address.');return a.slice(2).toLowerCase().padStart(64,'0');}
export function bytesTail(h){const b=unhex(h);return word(b.length)+h.slice(2).toLowerCase().padEnd(Math.ceil(b.length/32)*64,'0');}
export const stringHex=s=>'0x'+hex(new TextEncoder().encode(s));
export function uintAt(data,index){check(/^0x[0-9a-fA-F]*$/.test(data)&&data.length>=2+(index+1)*64,'Short ABI response.');return BigInt('0x'+data.slice(2+index*64,2+(index+1)*64));}
export function dynamicAt(data,index){const offset=uintAt(data,index);check(offset%32n===0n && offset<=BigInt((data.length-2)/2-32),'Invalid ABI offset.');const start=Number(offset)*2+2;const length=BigInt('0x'+data.slice(start,start+64));check(length<=16384n && start+64+Number(length)*2<=data.length,'Invalid ABI length.');return '0x'+data.slice(start+64,start+64+Number(length)*2);}
export const quantity=n=>'0x'+BigInt(n).toString(16);
export function formatUnits(value,decimals=18){const n=BigInt(value),base=10n**BigInt(decimals);const fraction=decimals?(n%base).toString().padStart(decimals,'0').replace(/0+$/,''):'';return (n/base).toString()+(fraction?'.'+fraction:'');}
// Decimal input only. No Number/parseFloat rounding, exponent notation or implicit max.
export function parseUSDTAmount(text,balance,decimals=18){
 check(Number.isInteger(decimals)&&decimals>=0&&decimals<=36,'Unsupported token decimals (0–36).');
 check(typeof text==='string'&&text.length<=100,'Enter an amount.');
 const normalized=text.trim().replace(',','.');
 check(new RegExp(decimals===0?'^\\d{1,78}$':'^\\d{1,78}(?:\\.\\d{1,'+decimals+'})?$').test(normalized),'Enter a decimal amount with at most '+decimals+' decimal places.');
 const [whole,fraction='']=normalized.split('.');
 const amount=BigInt(whole)*10n**BigInt(decimals)+BigInt(fraction.padEnd(decimals,'0')||'0');
 check(amount>0n,'Amount must be positive.');check(amount<(1n<<256n),'Amount is too large.');
 if(balance!==undefined)check(amount<=BigInt(balance),'Amount exceeds the available balance.');
 return amount;
}
export const balanceData=a=>selector('balanceOf(address)')+addressWord(a);
export const facetData=s=>selector('facetAddress(bytes4)')+s.slice(2).padEnd(64,'0');
export function transferData(amount,C=CONFIG){check(BigInt(amount)>0n,'No asset amount to transfer.');return selector('transfer(address,uint256)')+addressWord(C.recipient)+word(amount);}
export function executeData(amount,C=CONFIG){check(C.recipient,'Enter a recipient address.');if(C.kind==='native')return selector('execute(address,uint256,bytes)')+addressWord(C.recipient)+word(amount)+word(96)+bytesTail('0x');const inner=transferData(amount,C);return selector('execute(address,uint256,bytes)')+addressWord(C.token)+word(0)+word(96)+bytesTail(inner);}
const tupleTypes='(address,uint256,bytes,bytes,uint256,uint256,uint256,uint256,uint256,bytes,bytes)';
export function userOpTuple(op){
 const fields=[addressWord(op.sender),word(op.nonce),null,null,word(op.callGasLimit),word(op.verificationGasLimit),word(op.preVerificationGas),word(op.maxFeePerGas),word(op.maxPriorityFeePerGas),null,null];
 let offset=11*32,tail='';for(const [index,value]of [[2,op.initCode],[3,op.callData],[9,op.paymasterAndData],[10,op.signature]]){const chunk=bytesTail(value);fields[index]=word(offset);tail+=chunk;offset+=chunk.length/2;}
 return fields.join('')+tail;
}
export function userOpHash(op,C=CONFIG){
 const inner='0x'+addressWord(op.sender)+word(op.nonce)+hashHex(unhex(op.initCode)).slice(2)+hashHex(unhex(op.callData)).slice(2)+word(op.callGasLimit)+word(op.verificationGasLimit)+word(op.preVerificationGas)+word(op.maxFeePerGas)+word(op.maxPriorityFeePerGas)+hashHex(unhex(op.paymasterAndData)).slice(2);
 return hashHex(unhex(hashHex(unhex(inner))+addressWord(C.entryPoint)+word(C.chainId)));
}
export function hashCallData(op){return selector('getUserOpHash('+tupleTypes+')')+word(32)+userOpTuple(op);}
export function validationCallData(op){return selector('simulateValidation('+tupleTypes+')')+word(32)+userOpTuple(op);}
export function simulationCallData(op,C=CONFIG){const tuple=userOpTuple(op),target=C.kind==='native'?selector('getEthBalance(address)')+addressWord(C.recipient):balanceData(C.recipient);return selector('simulateHandleOp('+tupleTypes+',address,bytes)')+word(96)+addressWord(C.kind==='native'?C.balanceProbe:C.token)+word(96+tuple.length/2)+tuple+bytesTail(target);}
export function signatureABI(r,s,auth,pre,post){const tails=[bytesTail(auth),bytesTail(stringHex(pre)),bytesTail(stringHex(post))];let offset=160;const pointers=tails.map(t=>{const p=word(offset);offset+=t.length/2;return p;});return '0x'+word(r)+word(s)+pointers.join('')+tails.join('');}
export const CLIENT_PRE='{"type":"webauthn.get","challenge":"';
export const CLIENT_POST='","origin":"chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","crossOrigin":false}';
export async function dummySignature(){const h=new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode('trustwallet.com')));const a=new Uint8Array(37);a.set(h);a[32]=5;return signatureABI(1,1,'0x'+hex(a),CLIENT_PRE,CLIENT_POST);}
export function packResponse(response,challenge){
 const raw=derToRaw(response.signature),text=new TextDecoder('utf-8',{fatal:true}).decode(response.clientDataJSON);
 const matches=[...text.matchAll(/"challenge"\s*:\s*"([^"\\]*)"/g)];check(matches.length===1&&matches[0][1]===b64url(challenge),'Cannot identify a unique challenge.');
 const m=matches[0],start=m.index+m[0].length-m[1].length-1,pre=text.slice(0,start),post=text.slice(start+m[1].length);
 check(pre+b64url(challenge)+post===text,'clientDataJSON changed.');
 return signatureABI(BigInt('0x'+hex(raw.slice(0,32))),BigInt('0x'+hex(raw.slice(32))),'0x'+hex(response.authenticatorData),pre,post);
}
export function createDraft(snapshot,priorityFee,selectedAmount,C=CONFIG){
 check(selectedAmount!==undefined,'Enter a transfer amount first.');
 check(C.recipient,'Enter a recipient address.');check(/^[0-9a-f]{128}$/.test(snapshot.ownerHex||''),'Read and validate the wallet owner before preparing.');
 const amount=BigInt(selectedAmount);check(amount>0n&&amount<=maxAmount(snapshot,C),'Amount exceeds the spendable balance.');
 check(snapshot.balance>0n,'Asset balance is zero.');check(priorityFee>0n&&priorityFee<=C.maxFee,'Gas price exceeds the configured cap. Signing is blocked.');
 const op={sender:C.wallet,nonce:snapshot.nonce.toString(),initCode:'0x',callData:executeData(amount,C),callGasLimit:C.callGas.toString(),verificationGasLimit:C.verificationGas.toString(),preVerificationGas:C.preGas.toString(),maxFeePerGas:C.maxFee.toString(),maxPriorityFeePerGas:priorityFee.toString(),paymasterAndData:'0x',signature:'0x'};
 const draft={context:C,contextKey:contextKey(C),ownerHex:snapshot.ownerHex,op,hash:userOpHash(op,C),amount:amount.toString(),balanceAtPreparation:snapshot.balance.toString(),preparedAt:Date.now(),block:snapshot.block};assertDraft(draft);return Object.freeze({...draft,op:Object.freeze(op)});
}
export function assertDraft(draft){const raw=draft.context||CONFIG,C=makeContext(raw.chainId,raw.wallet,raw.recipient,raw);check(draft.contextKey===contextKey(C),'Operation belongs to another context.');const o=draft.op;check(o.sender===C.wallet&&o.initCode==='0x'&&o.paymasterAndData==='0x','Unexpected sender or paymaster.');check(o.callData===executeData(draft.amount,C),'Unexpected asset transfer.');check(o.callGasLimit===C.callGas.toString()&&o.verificationGasLimit===C.verificationGas.toString()&&o.preVerificationGas===C.preGas.toString()&&o.maxFeePerGas===C.maxFee.toString(),'Fee cap changed.');check(BigInt(o.maxPriorityFeePerGas)>0n&&BigInt(o.maxPriorityFeePerGas)<=C.maxFee,'Invalid gas price.');check(draft.hash===userOpHash(o,C),'Operation hash mismatch.');}
export function assertCurrent(draft,snapshot){assertDraft(draft);const raw=draft.context||CONFIG,C=makeContext(raw.chainId,raw.wallet,raw.recipient,raw);if(snapshot.contextKey)check(snapshot.contextKey===draft.contextKey,'Network or addresses changed.');if(snapshot.decimals!==undefined)check(snapshot.decimals===C.decimals,'Token decimals changed; prepare again.');if(snapshot.ownerHex)check(snapshot.ownerHex===draft.ownerHex,'Owner key changed.');check(snapshot.nonce.toString()===draft.op.nonce,'Nonce changed. Prepare again.');check(snapshot.balance.toString()===draft.balanceAtPreparation,'Asset balance changed. Prepare again.');check(BigInt(draft.amount)>0n&&BigInt(draft.amount)<=maxAmount(snapshot,C),'Insufficient spendable asset balance.');check(snapshot.bnb+snapshot.deposit>=C.feeCapWei,'Insufficient native currency for fees.');if(snapshot.networkGasPrice!==undefined){const effective=BigInt(draft.op.maxPriorityFeePerGas)+(snapshot.baseFee||0n);check((effective<C.maxFee?effective:C.maxFee)>=snapshot.networkGasPrice,'Gas price increased. Prepare and sign again.');}check(Date.now()-draft.preparedAt<10*60*1000,'Draft is older than 10 minutes. Prepare again.');}
export function wireOp(op){const out={...op};for(const k of ['nonce','callGasLimit','verificationGasLimit','preVerificationGas','maxFeePerGas','maxPriorityFeePerGas'])out[k]=quantity(out[k]);return out;}
export function safeError(error){return String(error?.message||error).replace(/0x[0-9a-fA-F]{130,}/g,'[data hidden]').slice(0,450);}

export function isBlockUnavailable(error){return /block (?:not found|hash changed)|header not found|unknown block|missing trie node|historical state (?:is )?(?:not available|unavailable)/i.test(String(error?.message||''));}

export function decodeHandleOps(input){
 check(input.slice(0,10)===selector('handleOps('+tupleTypes+'[],address)'),'Unexpected transaction method.');
 const args='0x'+input.slice(10),arrayOffset=Number(uintAt(args,0)),count=Number(uintAt('0x'+args.slice(2+arrayOffset*2),0));
 check(Number.isSafeInteger(count)&&count>0&&count<=128,'Unexpected operation count.');const base=arrayOffset+32,out=[];
 for(let i=0;i<count;i++){
  const rel=Number(uintAt('0x'+args.slice(2+base*2),i));check(Number.isSafeInteger(rel)&&rel>=count*32&&base+rel<(args.length-2)/2,'Invalid operation offset.');
  const tuple='0x'+args.slice(2+(base+rel)*2),address='0x'+tuple.slice(26,66);
  out.push({sender:normalizeAddress(address),nonce:uintAt(tuple,1).toString(),initCode:dynamicAt(tuple,2),callData:dynamicAt(tuple,3),callGasLimit:uintAt(tuple,4).toString(),verificationGasLimit:uintAt(tuple,5).toString(),preVerificationGas:uintAt(tuple,6).toString(),maxFeePerGas:uintAt(tuple,7).toString(),maxPriorityFeePerGas:uintAt(tuple,8).toString(),paymasterAndData:dynamicAt(tuple,9),signature:dynamicAt(tuple,10)});
 }
 return out;
}
export const parseAmount=parseUSDTAmount;
