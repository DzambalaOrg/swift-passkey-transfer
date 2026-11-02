import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {generateKeyPairSync,sign,createHash} from 'node:crypto';
import * as c from '../extension/remainder-codec.mjs';
import {createTransport} from '../extension/remainder-network.mjs';
import {RemainderController} from '../extension/remainder-controller.mjs';
import {SubmissionJournal} from '../extension/remainder-journal.mjs';
import {importOwner,verifyAssertion} from '../extension/verify.mjs';
const from='0x1111111111111111111111111111111111111111',to='0x2222222222222222222222222222222222222222';
const poly=c.makeContext(137,from,to),native=c.makeContext(137,from,to,{kind:'native'});
const {privateKey,publicKey}=generateKeyPairSync('ec',{namedCurve:'prime256v1'}),jwk=publicKey.export({format:'jwk'});
const ownerHex=Buffer.from(jwk.x,'base64url').toString('hex')+Buffer.from(jwk.y,'base64url').toString('hex');
const snapshot=(cfg=poly)=>({contextKey:c.contextKey(cfg),ownerHex,block:'0x10000',balance:100n*10n**BigInt(cfg.decimals),recipientBalance:0n,bnb:100n*10n**18n,recipientBNB:0n,deposit:0n,nonce:6n,readAt:Date.now(),fullyChecked:true,decimals:cfg.decimals});
const store=()=>{const m=new Map();return {getItem:k=>m.get(k)||null,setItem:(k,v)=>m.set(k,v),map:m};};
globalThis.fetch=()=>{throw Error('Live network forbidden in tests.');};
function harness(config=poly,storage=store()){
 let current=snapshot(config),prompts=0,sends=0;
 const transport={config,readSnapshot:async()=>structuredClone(current),prepare:async(s,{amount})=>({...c.createDraft(s,10000n,amount,config),simulation:{paid:'100'}}),checkFees:async()=>true,submit:async()=>{sends++;},receipt:async()=>null};
 const ctrl=new RemainderController({transport,storage,lock:async fn=>fn(),getAssertion:async challenge=>{prompts++;const json=Buffer.from(JSON.stringify({type:'webauthn.get',challenge:Buffer.from(challenge).toString('base64url'),origin:'chrome-extension://'+'a'.repeat(32),crossOrigin:false}));const auth=Buffer.alloc(37);createHash('sha256').update('trustwallet.com').digest().copy(auth);auth[32]=5;return {clientDataJSON:json,authenticatorData:auth,signature:sign('sha256',Buffer.concat([auth,createHash('sha256').update(json).digest()]),privateKey)};},verify:async(r,ch,owner)=>verifyAssertion(r,ch,'chrome-extension://'+'a'.repeat(32),await importOwner({x:owner.slice(0,64),y:owner.slice(64)}))});
 return {ctrl,transport,storage,setCurrent:s=>current=s,counts:()=>({prompts,sends})};
}
test('exact amount parsing, including zero decimals and uint256 bounds',()=>{
 assert.equal(c.parseAmount('1.000001',2000000n,6),1000001n);assert.equal(c.parseAmount('12',12n,0),12n);assert.equal(c.formatUnits(1234567n,6),'1.234567');
 for(const value of ['0','-1','1e3','1.0000001','Infinity','1.','  ','2'])assert.throws(()=>c.parseAmount(value,1000000n,6));
 assert.throws(()=>c.parseAmount('1.1',undefined,0));assert.throws(()=>c.parseAmount('1',undefined,37));assert.throws(()=>c.parseAmount('9'.repeat(78),undefined,0));
});
test('native Max reserves the unfunded part of the maximum fee',()=>{
 for(const deposit of [0n,native.feeCapWei/2n,native.feeCapWei,2n*native.feeCapWei]){const s={...snapshot(native),deposit};const max=c.maxAmount(s,native);assert.equal(max,s.bnb-(deposit<native.feeCapWei?native.feeCapWei-deposit:0n));c.createDraft(s,10000n,max,native);assert.throws(()=>c.createDraft(s,10000n,max+1n,native));}
 assert.equal(c.maxAmount({...snapshot(native),bnb:1n},native),0n);
});
test('independent ethers fixtures match transfer ABI, simulation, hash and multi-op decoding',async()=>{
 const fixtures=JSON.parse(await readFile(new URL('abi-fixtures.json',import.meta.url)));
 for(const f of fixtures){const cfg=c.makeContext(f.chain,from,to,{kind:f.kind});assert.equal(c.executeData(f.amount,cfg),f.op.callData);assert.equal(c.userOpHash(f.op,cfg),f.hash);assert.equal(c.simulationCallData(f.op,cfg),f.simulation);const decoded=c.decodeHandleOps(f.input);assert.deepEqual(decoded[0],f.op);assert.equal(decoded[1].nonce,'10');assert.notEqual(c.userOpHash(f.op,{...cfg,chainId:1}),f.hash);}
 assert.throws(()=>c.decodeHandleOps('0x1234'));
});
test('changing token, owner, amount, nonce, decimals or network rejects a draft',()=>{
 const s=snapshot(),d=c.createDraft(s,10000n,1n,poly);
 for(const update of [{contextKey:c.contextKey(native)},{nonce:7n},{balance:s.balance-1n},{ownerHex:'0'.repeat(128)},{decimals:18}])assert.throws(()=>c.assertCurrent(d,{...s,...update}));
 assert.throws(()=>c.assertDraft({...d,amount:'2'}));assert.throws(()=>c.assertDraft({...d,op:{...d.op,maxFeePerGas:'1'}}));
});
test('all three consent gates are independent; refresh cannot prompt or submit',async()=>{
 const h=harness();await h.ctrl.refresh();await assert.rejects(h.ctrl.prepare(false,'1'));await h.ctrl.prepare(true,'1');await assert.rejects(h.ctrl.sign(false));assert.deepEqual(h.counts(),{prompts:0,sends:0});await h.ctrl.sign(true);assert.equal(h.ctrl.view.signedReady,true);await h.ctrl.refresh();await assert.rejects(h.ctrl.submit(false));assert.deepEqual(h.counts(),{prompts:1,sends:0});await h.ctrl.submit(true);assert.deepEqual(h.counts(),{prompts:1,sends:1});await assert.rejects(h.ctrl.submit(true));assert.equal(h.counts().sends,1);assert.doesNotMatch(JSON.stringify([...h.storage.map]),/signature|clientData|authenticatorData|callData/);
});
test('owner change before passkey prompt fails closed; amount edit erases signature',async()=>{
 const h=harness();await h.ctrl.prepare(true,'1');h.setCurrent({...snapshot(),ownerHex:'0'.repeat(128)});await assert.rejects(h.ctrl.sign(true));assert.equal(h.counts().prompts,0);
 const g=harness();await g.ctrl.prepare(true,'1');await g.ctrl.sign(true);g.ctrl.changeAmount();assert.equal(g.ctrl.signed,null);assert.equal(g.ctrl.view.draft,null);
});
test('uncertain submission persists and is never automatically resubmitted',async()=>{
 const h=harness();await h.ctrl.prepare(true,'1');await h.ctrl.sign(true);let attempts=0;h.transport.submit=async()=>{attempts++;throw Error('block not found: 0x123');};await assert.rejects(h.ctrl.submit(true));assert.equal(h.ctrl.view.pending.status,'uncertain');assert.equal(h.ctrl.signed,null);const g=harness(poly,h.storage);await g.ctrl.refresh();await g.ctrl.checkReceipt();assert.equal(attempts,1);assert.ok(g.ctrl.view.pending);
});
test('journal isolates sources/chains but locks all assets and recipients of one source',async()=>{
 const h=harness();await h.ctrl.prepare(true,'1');await h.ctrl.sign(true);await h.ctrl.submit(true);
 assert.throws(()=>harness(native,h.storage),/another asset/);assert.throws(()=>harness(c.makeContext(137,from,'0x3333333333333333333333333333333333333333'),h.storage),/pending transfer/);
 assert.equal(new SubmissionJournal(h.storage,c.makeContext(56,from,to)).pending(),null);assert.equal(new SubmissionJournal(h.storage,c.makeContext(137,to,from)).pending(),null);
});
const response=result=>({ok:true,status:200,text:async()=>JSON.stringify({result})});
test('custom token metadata and native balance loading use fixed RPC hosts',async()=>{
 const token='0x3333333333333333333333333333333333333333',cfg=c.makeContext(56,from,'',{token});let decimals=9,calls=0;
 const fetcher=async(url,options)=>{calls++;assert.equal(url,cfg.rpc);const q=JSON.parse(options.body);let r;
 if(q.method==='eth_chainId')r='0x38';else if(q.method==='eth_getBlockByNumber')r={number:'0x10000',hash:'0x'+'ab'.repeat(32)};
 else if(q.method==='eth_getCode')r='0x01';else if(q.method==='eth_getBalance')r='0x64';else if(q.method==='eth_call'){const d=q.params[0].data;r='0x'+c.word(d===c.selector('decimals()')?decimals:d===c.selector('getNonce()')?1:100);if(d===c.selector('symbol()'))r='0x'+Buffer.from('SYNTH').toString('hex').padEnd(64,'0');}else throw Error(q.method);return response(r);};
 const t=createTransport(fetcher,{...cfg,rpc:'https://evil.invalid'});const s=await t.readSnapshot();assert.equal(t.config.decimals,9);assert.equal(t.config.tokenLabel,'SYNTH');assert.equal(s.balance,100n);assert.equal(s.recipientBalance,0n);decimals=37;await assert.rejects(t.readSnapshot(),/decimals/);
 const n=createTransport(fetcher,c.makeContext(56,from,'',{kind:'native'}));assert.equal((await n.readSnapshot()).balance,100n);assert.ok(calls>0);
});
test('read RPC retries block errors, but sendUserOperation is sent only once',async()=>{
 let calls=0;const t=createTransport(async()=>{calls++;return {ok:true,text:async()=>JSON.stringify({error:{code:-32001,message:'block not found'}})};},poly);
 await assert.rejects(t.chain('eth_getBalance',[from,'latest']));assert.equal(calls,3);calls=0;const d=c.createDraft(snapshot(),10000n,1n,poly);await assert.rejects(t.submit(d,'0x1234',{submissionApproved:true}));assert.equal(calls,1);calls=0;await assert.rejects(t.chain('eth_sendRawTransaction',[]));assert.equal(calls,0);
});
test('native receipt requires matching exact calldata, sender, hash and successful execution',async()=>{
 const f=JSON.parse(await readFile(new URL('abi-fixtures.json',import.meta.url))).find(f=>f.chain===137&&f.kind==='native');
 // Receipt verification must reject a transaction that lacks the approved operation before trusting a transfer.
 const topic=c.hashHex(new TextEncoder().encode('UserOperationEvent(bytes32,address,address,uint256,bool,uint256,uint256)'));
 const r={transactionHash:'0x'+'ab'.repeat(32),status:'0x1',blockNumber:'0x100',logs:[{address:native.entryPoint,topics:[topic,f.hash,'0x'+c.addressWord(from)],data:'0x'+c.word(9)+c.word(1)+c.word(100)+c.word(100),logIndex:'0x1'}]};
 const t=createTransport(async(url,o)=>{const q=JSON.parse(o.body);if(q.method==='eth_getUserOperationReceipt')return response({receipt:r});if(q.method==='eth_getTransactionReceipt')return response(r);if(q.method==='eth_getTransactionByHash')return response({to:native.entryPoint,input:f.input});throw Error('Stop before relying on unpinned code');},native);
 await assert.rejects(t.receipt(f.hash,'999',9),/calldata/);await assert.rejects(t.receipt(f.hash,f.amount,9),/Stop before/);
});

test('English UI loads an empty-default project, applies custom assets only on click, and invalidates stale signing',async()=>{
 const vm=await import('node:vm');const elements=new Map();function el(id){if(!elements.has(id))elements.set(id,{value:id==='network-select'?'137':id==='asset-kind'?'erc20':'',checked:false,disabled:false,hidden:false,textContent:'',listeners:{},addEventListener(k,fn){this.listeners[k]=fn;}});return elements.get(id);}
 let reads=0,prepared=0,prompts=0;const win={PublicKeyCredential:function(){},addEventListener(){}};win.top=win;
 const sandbox=vm.createContext({...c,createTransport:(f,cfg)=>({config:{...cfg,decimals:cfg.decimals??9,tokenLabel:'SYNTH'},readSnapshot:async()=>{reads++;return snapshot({...cfg,decimals:cfg.decimals??9});},prepare:async(s,{amount})=>{prepared++;return {...c.createDraft(s,10000n,amount,{...cfg,decimals:cfg.decimals??9}),simulation:{paid:'1'}};},receipt:async()=>null}),RemainderController,RP_ID:'trustwallet.com',importOwner,verifyAssertion,chrome:{runtime:{id:'a'.repeat(32)},permissions:{contains:async()=>true}},document:{hidden:false,getElementById:el,addEventListener(){}},window:win,isSecureContext:true,location:{protocol:'chrome-extension:',origin:'chrome-extension://'+'a'.repeat(32)},localStorage:store(),URL,fetch(){throw Error('Live fetch forbidden');},navigator:{credentials:{get:async()=>{prompts++;throw Error('No real prompt');}},locks:{request:async(n,o,fn)=>fn({})}},setInterval:()=>1,clearInterval(){}});
 const code=(await readFile(new URL('../extension/remainder.mjs',import.meta.url),'utf8')).replace(/^import .*;\n/gm,'');await vm.runInContext(`(async()=>{${code}\n})()`,sandbox);
 assert.equal(reads,0);el('source-input').value=from;await el('apply-settings').listeners.click();assert.equal(reads,1);
 el('recipient-input').value=to;el('recipient-input').listeners.input();el('token-input').value='0x3333333333333333333333333333333333333333';el('token-input').listeners.input();assert.equal(reads,1);assert.equal(el('prepare').disabled,true);
 await el('apply-settings').listeners.click();assert.equal(reads,2);el('amount-input').value='1.25';el('amount-input').listeners.input();el('estimate-consent').checked=true;el('estimate-consent').listeners.change();await el('prepare').listeners.click();assert.equal(prepared,1);assert.equal(el('review').hidden,false);
 el('asset-kind').value='native';el('asset-kind').listeners.change();assert.equal(el('review').hidden,true);assert.equal(el('send').disabled,true);assert.equal(el('token-field').hidden,true);assert.equal(reads,3); // preparation performed a full read
 await el('apply-settings').listeners.click();el('max-amount').listeners.click();assert.equal(el('amount-input').value,c.formatUnits(c.maxAmount(snapshot(native),native)));assert.equal(prompts,0);
 el('fee-select').value='1000000000000';el('fee-select').listeners.change();assert.equal(el('prepare').disabled,true);assert.equal(el('sign').disabled,true);assert.match(el('gas-note').textContent,/1.65 POL/);await el('apply-settings').listeners.click();el('max-amount').listeners.click();const higher=c.makeContext(137,from,to,{kind:'native',maxFee:1000000000000n});assert.equal(el('amount-input').value,c.formatUnits(c.maxAmount(snapshot(higher),higher)));assert.match(el('sign-consent-text').textContent,/1.65 POL/);
});

test('native receipt verifies a successful exact value transfer with pinned wallet runtime',async()=>{
 const f=JSON.parse(await readFile(new URL('abi-fixtures.json',import.meta.url))).find(f=>f.chain===137&&f.kind==='native');const {code}=JSON.parse(await readFile(new URL('wallet-runtime.json',import.meta.url)));assert.equal(c.hashHex(c.unhex(code)),native.walletCodeHash);
 const topic=c.hashHex(new TextEncoder().encode('UserOperationEvent(bytes32,address,address,uint256,bool,uint256,uint256)'));
 let success=1,contract=false;const tx='0x'+'ab'.repeat(32);
 const t=createTransport(async(url,o)=>{const q=JSON.parse(o.body),r={transactionHash:tx,status:'0x1',blockNumber:'0x100',logs:[{address:native.entryPoint,topics:[topic,f.hash,'0x'+c.addressWord(from)],data:'0x'+c.word(9)+c.word(success)+c.word(100)+c.word(100),logIndex:'0x1'}]};
 if(q.method==='eth_getUserOperationReceipt')return response({receipt:r});if(q.method==='eth_getTransactionReceipt')return response(r);if(q.method==='eth_getTransactionByHash')return response({to:native.entryPoint,input:f.input});if(q.method==='eth_getCode')return response(q.params[0]===from?code:contract?'0x01':'0x');if(q.method==='eth_blockNumber')return response('0x10c');throw Error(q.method);},native);
 assert.equal((await t.receipt(f.hash,f.amount,9)).transferVerified,true);contract=true;await assert.rejects(t.receipt(f.hash,f.amount,9),/contract recipient/);success=0;assert.equal((await t.receipt(f.hash,f.amount,9)).failed,true);
});
test('native unsigned simulation must credit the exact amount through the fixed balance probe',async()=>{
 const s=snapshot(native),d=c.createDraft(s,12500n,1n,native);let correct=true,submits=0;
 const t=createTransport(async(url,o)=>{const q=JSON.parse(o.body);if(q.method==='eth_supportedEntryPoints')return response([native.entryPoint]);if(q.method==='pimlico_getUserOperationGasPrice')return response({fast:{maxPriorityFeePerGas:'10000',maxFeePerGas:'10000'}});if(q.method==='eth_estimateUserOperationGas')return response({callGasLimit:'100',verificationGasLimit:'100',preVerificationGas:'100'});if(q.method==='eth_sendUserOperation'){submits++;throw Error('Forbidden');}
 if(q.method==='eth_call'){if(q.params[0].data.startsWith(c.selector('getUserOpHash((address,uint256,bytes,bytes,uint256,uint256,uint256,uint256,uint256,bytes,bytes))')))return response(d.hash);
 assert.equal(q.params[0].data,c.simulationCallData({...d.op,signature:await c.dummySignature()},native));
 const args=c.word(100)+c.word(100)+c.word(0)+c.word(0)+c.word(1)+c.word(192)+c.bytesTail('0x'+c.word(correct?1:2));
 return {ok:true,text:async()=>JSON.stringify({error:{code:3,message:'execution reverted',data:c.selector('ExecutionResult(uint256,uint256,uint48,uint48,bool,bytes)')+args}})};}throw Error(q.method);},native);
 assert.equal((await t.prepare(s,{disclosureApproved:true,amount:1n})).simulation.paid,'100');correct=false;await assert.rejects(t.prepare(s,{disclosureApproved:true,amount:1n}),/exact amount/);assert.equal(submits,0);
});

test('fee ceiling is allowlisted, binds the signature and changes native Max reserve',()=>{
 const raised=c.makeContext(137,from,to,{kind:'native',maxFee:1000000000000n});
 assert.equal(raised.feeCapWei,1650000000000000000n);assert.notEqual(c.contextKey(raised),c.contextKey(native));
 const old=c.createDraft(snapshot(native),10000n,1n,native),next=c.createDraft(snapshot(raised),10000n,1n,raised);
 assert.notEqual(old.hash,next.hash);assert.equal(BigInt(next.op.maxFeePerGas),raised.maxFee);assert.equal(c.maxAmount(snapshot(raised),raised),snapshot(raised).bnb-raised.feeCapWei);
 assert.throws(()=>c.assertCurrent(old,snapshot(raised)),/changed/);
 assert.throws(()=>c.makeContext(137,from,to,{maxFee:600000000000n}),/Unsupported gas price/);
 assert.throws(()=>c.makeContext(56,from,to,{maxFee:5000000000000n}),/Unsupported gas price/);
});
test('over-cap quotes give actionable numbers; raising the selected cap permits preparation without signing',async()=>{
 const raised=c.makeContext(137,from,to,{kind:'native',maxFee:1000000000000n});let requests=0,signatures=0;
 const fake=cfg=>createTransport(async(url,o)=>{requests++;const q=JSON.parse(o.body);
 if(q.method==='eth_supportedEntryPoints')return response([cfg.entryPoint]);
 if(q.method==='pimlico_getUserOperationGasPrice')return response({fast:{maxPriorityFeePerGas:'10000',maxFeePerGas:'600000000000'}});
 const draft=c.createDraft(snapshot(cfg),12500n,1n,cfg);
 if(q.method==='eth_call'&&q.params[0].data===c.hashCallData(draft.op))return response(draft.hash);
 if(q.method==='eth_estimateUserOperationGas'){assert.notEqual(q.params[0].signature,'0x');return response({callGasLimit:'100',verificationGasLimit:'100',preVerificationGas:'100'});}
 if(q.method==='eth_call'){const args=c.word(100)+c.word(100)+c.word(0)+c.word(0)+c.word(1)+c.word(192)+c.bytesTail('0x'+c.word(1));return {ok:true,text:async()=>JSON.stringify({error:{code:3,message:'execution reverted',data:c.selector('ExecutionResult(uint256,uint256,uint48,uint48,bool,bytes)')+args}})};}
 signatures++;throw Error('Unexpected submission');},cfg);
 await assert.rejects(fake(native).prepare(snapshot(native),{disclosureApproved:true,amount:1n}),/requires 750 Gwei; selected ceiling is 500 Gwei/);
 assert.equal(requests,2);const draft=await fake(raised).prepare(snapshot(raised),{disclosureApproved:true,amount:1n});assert.equal(draft.context.maxFee,1000000000000n);assert.equal(draft.op.signature,'0x');assert.equal(signatures,0);
});
