// Two fixed HTTPS endpoints. No caller-supplied URLs or transaction methods on the chain RPC.
import { importOwner } from './verify.mjs';
import { CONFIG as DEFAULT, makeContext, contextKey, check, unhex, hashHex, selector, word, addressWord, balanceData, facetData, uintAt, dynamicAt, hashCallData, validationCallData, simulationCallData, dummySignature, createDraft, assertDraft, wireOp, quantity, formatUnits, safeError, isBlockUnavailable, maxAmount, decodeHandleOps, userOpHash, executeData } from './remainder-codec.mjs';
export const CHAIN=DEFAULT.rpc;
export const BUNDLER=DEFAULT.bundler;
export class RPCError extends Error {constructor(error){super(safeError(error));this.code=error?.code;this.data=error?.data;}}
export function createTransport(fetcher=globalThis.fetch.bind(globalThis),context=DEFAULT) {
 let C=makeContext(context.chainId,context.wallet,context.recipient,context);const CHAIN=C.rpc,BUNDLER=C.bundler;
 let id=0;
 async function requestOnce(url,method,params){
  const allowed=url===CHAIN?['eth_chainId','eth_getBlockByNumber','eth_blockNumber','eth_getBalance','eth_getCode','eth_getStorageAt','eth_call','eth_gasPrice','eth_getTransactionReceipt','eth_getTransactionByHash']
   :url===BUNDLER?['eth_supportedEntryPoints','pimlico_getUserOperationGasPrice','eth_estimateUserOperationGas','eth_getUserOperationReceipt','eth_sendUserOperation']:[];
  check(allowed.includes(method),'Network method is not allowed.');
  const response=await fetcher(url,{method:'POST',credentials:'omit',cache:'no-store',redirect:'error',referrerPolicy:'no-referrer',headers:{'Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:++id,method,params}),signal:AbortSignal.timeout(20000)});
  check(response.ok,'Service unavailable ('+response.status+')');
  const text=await response.text();check(text.length<=2000000,'Service response is too large.');
  let json;try{json=JSON.parse(text);}catch{throw Error('Malformed service response.');}
  if(json.error)throw new RPCError(json.error);check(Object.hasOwn(json,'result'),'Missing RPC result.');return json.result;
 }
 // Retrying is restricted to public read methods. Bundler submission is NEVER retried.
 async function rpc(url,method,params){
  for(let attempt=0;;attempt++){
   try{return await requestOnce(url,method,params);}
   catch(error){if(url!==CHAIN||!isBlockUnavailable(error)||attempt>=2)throw error;await new Promise(resolve=>setTimeout(resolve,200*(attempt+1)));}
  }
 }
 const chain=(m,p)=>rpc(CHAIN,m,p),bundler=(m,p)=>rpc(BUNDLER,m,p);
 const call=(to,data,block)=>chain('eth_call',[{to,data},block]);
 async function assetData(address,block){
  if(!address)return '0x'+word(0);
  if(C.kind==='native')return '0x'+word(BigInt(await chain('eth_getBalance',[address,block])));
  return call(C.token,balanceData(address),block);
 }
 async function readMetadata(block){
  if(C.kind==='native')return;
  check(await chain('eth_getCode',[C.token,block])!=='0x','No token contract at this address.');
  const decimals=Number(uintAt(await call(C.token,selector('decimals()'),block),0));check(Number.isInteger(decimals)&&decimals>=0&&decimals<=36,'Unsupported token decimals (0–36).');
  let symbol='TOKEN';try{const encoded=await call(C.token,selector('symbol()'),block);const data=encoded.length===66?encoded:dynamicAt(encoded,0);symbol=new TextDecoder('utf-8',{fatal:true}).decode(unhex(data)).replace(/\0/g,'')||symbol;}catch{}
  C=makeContext(C.chainId,C.wallet,C.recipient,{...C,decimals,symbol});
 }
 async function readSnapshotAtDepth(full,depth){
  check(await chain('eth_chainId',[])===quantity(C.chainId),'RPC is connected to another chain.');
  const head=await chain('eth_getBlockByNumber',['latest',false]);check(head?.number,'No fresh block.');
  const block='0x'+(BigInt(head.number)-BigInt(depth)).toString(16);
  const anchor=await chain('eth_getBlockByNumber',[block,false]);if(!anchor?.hash)throw new RPCError({code:-32001,message:'block not found: '+block});
  check(await chain('eth_getCode',[C.wallet,block])!=='0x','On network '+C.name+' no deployed SWIFT was found at the source address.');
  await readMetadata(block);
  const jobs=[assetData(C.wallet,block),assetData(C.recipient,block),chain('eth_getBalance',[C.wallet,block]),C.recipient?chain('eth_getBalance',[C.recipient,block]):Promise.resolve('0x0'),call(C.entryPoint,balanceData(C.wallet),block),call(C.wallet,selector('getNonce()'),block)];
  const result=await Promise.allSettled(jobs);for(const r of result)if(r.status==='rejected')throw r.reason;
  const a=result.map(r=>r.value);
  const snap={contextKey:contextKey(C),decimals:C.decimals,block,blockHash:anchor.hash,balance:uintAt(a[0],0),recipientBalance:uintAt(a[1],0),bnb:BigInt(a[2]),recipientBNB:BigInt(a[3]),deposit:uintAt(a[4],0),nonce:uintAt(a[5],0),readAt:Date.now()};
  if(full){
   const lockSlot=hashHex(unhex('0x'+word(0)+word(3)));
   const restrictionsSlot=hashHex(unhex(selector('verifyRestrictions(address,address,uint256,bytes)')+'0'.repeat(56)+hashHex(new TextEncoder().encode('trustwallet.barz.diamond.storage')).slice(2)));
   const calls=[call(C.wallet,selector('owner()'),block),call(C.wallet,selector('entryPoint()'),block),call(C.wallet,facetData('0x1626ba7e'),block),call(C.wallet,facetData('0x8dd50121'),block),call(C.wallet,facetData(selector('execute(address,uint256,bytes)')),block),chain('eth_getCode',[C.wallet,block]),chain('eth_getCode',[C.facet,block]),chain('eth_getCode',[C.entryPoint,block]),chain('eth_getCode',[C.accountFacet,block]),C.recipient?chain('eth_getCode',[C.recipient,block]):Promise.resolve('0x'),chain('eth_getStorageAt',[C.wallet,lockSlot,block]),chain('eth_getStorageAt',[C.wallet,restrictionsSlot,block]),chain('eth_getStorageAt',[C.wallet,'0x1',block]),chain('eth_getBlockByNumber',[block,false]),chain('eth_gasPrice',[]),C.kind==='native'?chain('eth_getCode',[C.balanceProbe,block]):Promise.resolve('0x')];
   const settled=await Promise.allSettled(calls);for(const r of settled)if(r.status==='rejected')throw r.reason;
   const v=settled.map(r=>r.value),sameAddress=(value,expected)=>value.slice(-40).toLowerCase()===expected.slice(2).toLowerCase();
   const ownerHex=dynamicAt(v[0],0).slice(2);check(/^[0-9a-f]{128}$/.test(ownerHex),'No P-256 SWIFT owner key found.');
   await importOwner({x:ownerHex.slice(0,64),y:ownerHex.slice(64)});snap.ownerHex=ownerHex;
   snap.tokenSymbol=C.tokenLabel;
   if(C.kind==='native'){check(v[9]==='0x','Native transfers currently require an EOA recipient.');check(hashHex(unhex(v[15]))===C.probeCodeHash,'Unexpected native balance probe code.');}
   check(sameAddress(v[1],C.entryPoint)&&sameAddress(v[2],C.facet)&&sameAddress(v[3],C.facet)&&sameAddress(v[4],C.accountFacet),'Wallet configuration changed.');
   check(hashHex(unhex(v[5]))===C.walletCodeHash&&hashHex(unhex(v[6]))===C.facetCodeHash&&hashHex(unhex(v[7]))===C.entryCodeHash&&hashHex(unhex(v[8]))===C.accountCodeHash,'Wallet code changed.');
   snap.recipientIsContract=v[9]!=='0x';
   if(!v[13]?.timestamp)throw new RPCError({code:-32001,message:'block not found: '+block});
   if(v[13].hash!==anchor.hash)throw new RPCError({code:-32001,message:'block hash changed: '+block});
   check((BigInt(v[10])&((1n<<64n)-1n))<=BigInt(v[13].timestamp),'Wallet is locked.');
   check(BigInt(v[11])===0n,'Wallet restrictions are active.');
   check(((BigInt(v[12])>>8n)&0xffffffffn)===0x8dd50121n,'Signature verification method changed.');
   check(BigInt(v[14])<=C.maxFee,'Network gas price exceeds the configured cap.');
   snap.blockHash=v[13].hash;snap.networkGasPrice=BigInt(v[14]);snap.baseFee=BigInt(v[13].baseFeePerGas||'0x0');snap.fullyChecked=true;
  }
  return snap;
 }
 async function readSnapshot({full=false}={}){
  let last;
  for(const depth of [8,32,64]){
   try{
    const snap=await readSnapshotAtDepth(full,depth);
    if(full){
     const latest=await Promise.allSettled([call(C.wallet,selector('getNonce()'),'latest'),assetData(C.wallet,'latest'),call(C.wallet,selector('owner()'),'latest')]);
     for(const result of latest)if(result.status==='rejected')throw result.reason;
     check(uintAt(latest[0].value,0)===snap.nonce&&uintAt(latest[1].value,0)===snap.balance&&dynamicAt(latest[2].value,0).slice(2)===snap.ownerHex,'RPC state is still synchronizing. Wait a few seconds and refresh balances.');
    }
    return snap;
   }catch(error){if(!isBlockUnavailable(error))throw error;last=error;}
  }
  throw new RPCError({code:last?.code||-32001,message:'Public RPC cannot find the block. State is unverified; this does not prove transfer failure. Check submission status.'});
 }
 async function prepare(snapshot,{disclosureApproved=false,amount}={}){
  check(disclosureApproved,'Approve disclosure of the unsigned draft to Pimlico for estimation.');
  check(snapshot.fullyChecked,'A fresh full wallet check is required.');check(amount!==undefined&&BigInt(amount)>0n&&BigInt(amount)<=maxAmount(snapshot,C),'Enter an amount within the spendable balance.');
  const supported=await bundler('eth_supportedEntryPoints',[]);check(Array.isArray(supported)&&supported.some(a=>a.toLowerCase()===C.entryPoint.toLowerCase()),'Pimlico does not support this EntryPoint.');
  const quote=await bundler('pimlico_getUserOperationGasPrice',[]);const speed=quote?.fast;check(speed?.maxPriorityFeePerGas&&speed?.maxFeePerGas,'No gas price estimate.');
  const priority=(BigInt(speed.maxPriorityFeePerGas)*125n+99n)/100n,bufferedFee=(BigInt(speed.maxFeePerGas)*125n+99n)/100n;
  check(bufferedFee<=C.maxFee&&priority<=C.maxFee,'Fast quote +25% requires '+formatUnits(bufferedFee>priority?bufferedFee:priority,9)+' Gwei; selected ceiling is '+formatUnits(C.maxFee,9)+' Gwei (maximum '+formatUnits(C.feeCapWei)+' '+C.nativeSymbol+'). Choose a higher gas price ceiling if acceptable, click Update balance, then Max and Prepare again. No signature requested.');
  const draft=createDraft(snapshot,priority,amount,C),dummy=await dummySignature(),op={...draft.op,signature:dummy};
  const remoteHash=await call(C.entryPoint,hashCallData(draft.op),snapshot.block);check(remoteHash.toLowerCase()===draft.hash,'EntryPoint hash mismatch.');
  const estimate=await bundler('eth_estimateUserOperationGas',[wireOp(op),C.entryPoint]);
  check(BigInt(estimate.callGasLimit)<=C.callGas&&BigInt(estimate.verificationGasLimit)<=C.verificationGas&&BigInt(estimate.preVerificationGas)<=C.preGas,'Gas estimate exceeds the configured limits. Signing is blocked.');
  let simulation;
  try{await call(C.entryPoint,simulationCallData(op,C),snapshot.block);throw Error('Unexpected simulation response.');}
  catch(error){
   if(!(error instanceof RPCError))throw error;let data=error.data;if(data&&typeof data==='object')data=data.data||data.result;
   check(typeof data==='string','Missing simulation result.');
   if(data.slice(0,10)===selector('FailedOp(uint256,string)')){const reason=new TextDecoder().decode(unhex(dynamicAt('0x'+data.slice(10),1)));throw Error('EntryPoint: '+reason);}
   check(data.slice(0,10)===selector('ExecutionResult(uint256,uint256,uint48,uint48,bool,bytes)'),'EntryPoint simulation rejected.');
   const args='0x'+data.slice(10);check(uintAt(args,4)===1n,'Cannot verify the post-simulation balance.');
   check(uintAt(dynamicAt(args,5),0)===snapshot.recipientBalance+BigInt(draft.amount),'Simulation did not credit the exact amount to the recipient.');
   check(uintAt(args,1)<=C.feeCapWei,'Simulated cost exceeds the cap.');
   simulation={paid:uintAt(args,1).toString(),gas:uintAt(args,0).toString()};
  }
  return Object.freeze({...draft,estimate:Object.freeze(estimate),simulation:Object.freeze(simulation)});
 }
 async function checkFees(draft){
  assertDraft(draft);check(draft.contextKey===contextKey(C),'Operation belongs to another context.');
  const quote=await bundler('pimlico_getUserOperationGasPrice',[]),fast=quote?.fast;
  check(fast?.maxFeePerGas&&fast?.maxPriorityFeePerGas,'No fresh fast gas quote.');
  check(BigInt(draft.op.maxFeePerGas)>=BigInt(fast.maxFeePerGas)&&BigInt(draft.op.maxPriorityFeePerGas)>=BigInt(fast.maxPriorityFeePerGas),'Gas price increased after signing. Prepare and sign again; nothing was submitted.');
  return true;
 }
 // This is the only network path that can receive a real signature. The UI calls it only after final send consent.
 async function submit(draft,signature,{submissionApproved=false}={}){
  check(submissionApproved,'Submission was not approved.');assertDraft(draft);check(draft.contextKey===contextKey(C),'Operation belongs to another context.');
  check(/^0x[0-9a-fA-F]+$/.test(signature)&&signature.length>2&&signature.length<32768,'No verified signature.');
  const result=await bundler('eth_sendUserOperation',[wireOp({...draft.op,signature}),C.entryPoint]);
  check(typeof result==='string'&&result.toLowerCase()===draft.hash,'Uncertain submission response. Do not resubmit.');return result;
 }
 async function receipt(hash,amount,nonce,feeCap=C.feeCapWei){
  check(/^0x[0-9a-f]{64}$/.test(hash),'Invalid receipt hash.');
  const bundled=await bundler('eth_getUserOperationReceipt',[hash]);if(!bundled)return null;
  const tx=bundled.receipt?.transactionHash;check(/^0x[0-9a-fA-F]{64}$/.test(tx||''),'Missing transaction hash.');
  const r=await chain('eth_getTransactionReceipt',[tx]);if(!r)return null;
  check(r.status==='0x1','Outer transaction failed.');
  const eventTopic=hashHex(new TextEncoder().encode('UserOperationEvent(bytes32,address,address,uint256,bool,uint256,uint256)'));
  const transferTopic=hashHex(new TextEncoder().encode('Transfer(address,address,uint256)'));
  let event=null,previous=-1;
  for(const l of r.logs){if(l.address.toLowerCase()!==C.entryPoint.toLowerCase()||l.topics[0]!==eventTopic)continue;if(l.topics[1]===hash){event=l;break;}previous=parseInt(l.logIndex);}
  check(event&&event.topics[2].slice(-40)===C.wallet.slice(2).toLowerCase(),'Operation event was not found.');
  check(uintAt(event.data,0)===BigInt(nonce),'Receipt nonce mismatch.');
  if(uintAt(event.data,1)!==1n)return {failed:true,tx,block:parseInt(r.blockNumber)};
  let transferVerified=false;
  if(C.kind==='erc20'){
  const transfers=r.logs.filter(l=>l.address.toLowerCase()===C.token.toLowerCase()&&parseInt(l.logIndex)>previous&&parseInt(l.logIndex)<parseInt(event.logIndex)&&l.topics[0]===transferTopic&&l.topics[1]?.slice(-40)===C.wallet.slice(2).toLowerCase()&&l.topics[2]?.slice(-40)===C.recipient.slice(2).toLowerCase());
  check(transfers.length===1&&uintAt(transfers[0].data,0)===BigInt(amount),'Transfer event amount mismatch.');transferVerified=true;
  }else{
   const txData=await chain('eth_getTransactionByHash',[tx]);check(txData&&txData.to?.toLowerCase()===C.entryPoint.toLowerCase(),'Unexpected transaction destination.');
   const matches=decodeHandleOps(txData.input).filter(op=>userOpHash(op,C)===hash);
   check(matches.length===1&&matches[0].sender===C.wallet&&matches[0].callData===executeData(amount,C),'Native operation calldata does not match the approved transfer.');
   check(await chain('eth_getCode',[C.recipient,r.blockNumber])==='0x','Cannot verify a native transfer to a contract recipient.');
   check(hashHex(unhex(await chain('eth_getCode',[C.wallet,r.blockNumber])))===C.walletCodeHash,'Unexpected wallet code at the receipt block.');
   transferVerified=true;
  }

  const cost=uintAt(event.data,2);check(cost<=BigInt(feeCap),'Receipt fee exceeds the cap.');
  const latest=BigInt(await chain('eth_blockNumber',[]));
  return {confirmed:true,tx,block:parseInt(r.blockNumber),confirmations:Number(latest-BigInt(r.blockNumber)+1n),cost:cost.toString(),amount:String(amount),assetKind:C.kind,transferVerified};
 }
 return {get config(){return C;},readSnapshot,prepare,checkFees,submit,receipt,call,chain};
}
