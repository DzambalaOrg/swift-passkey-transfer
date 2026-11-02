import { CONFIG, NETWORKS, FEE_OPTIONS, makeContext, contextKey, formatUnits, parseAmount, maxAmount, safeError } from './remainder-codec.mjs';
import { createTransport } from './remainder-network.mjs';
import { RemainderController } from './remainder-controller.mjs';
import { RP_ID, importOwner, verifyAssertion } from './verify.mjs';
const el=id=>document.getElementById(id),origin=`chrome-extension://${chrome.runtime.id}`;
let C=null,controller,ready=false,lastDraft=null,lastSigned=false,timer,inPoll=false,epoch=0;
el('source-input').value=CONFIG.wallet;el('recipient-input').value=CONFIG.recipient;
el('token-input').value=NETWORKS[137].token;
function setFeeOptions(){const n=NETWORKS[el('network-select').value];el('fee-select').innerHTML=FEE_OPTIONS[n.chainId].map(f=>'<option value="'+f+'">'+formatUnits(f,9)+' Gwei · max '+formatUnits((n.callGas+n.verificationGas+n.preGas)*f)+' '+n.nativeSymbol+'</option>').join('');el('fee-select').value=n.maxFee.toString();}
setFeeOptions();
const tokenAmount=n=>formatUnits(n,C.decimals),feeText=()=>formatUnits(C.feeCapWei)+' '+C.nativeSymbol;
function fieldsContext(){return makeContext(el('network-select').value,el('source-input').value,el('recipient-input').value,{kind:el('asset-kind').value,token:el('token-input').value,maxFee:el('fee-select').value});}
function updateLabels(){if(!C)return;
 el('network-label').textContent='SWIFT · '+C.name.toUpperCase()+' · v2.0.1';
 el('recipient-address').textContent=C.recipient;el('wallet-address').textContent=C.wallet;el('token-address').textContent=C.kind==='native'?C.nativeSymbol:C.token;
 el('asset-label').textContent=C.tokenLabel+' in SWIFT';
 el('native-wallet-label').textContent=C.nativeSymbol+' in SWIFT';el('native-recipient-label').textContent=C.nativeSymbol+' at recipient';el('native-deposit-symbol').textContent=C.nativeSymbol;
 el('token-caption').textContent=C.tokenLabel+' · '+(C.decimals??'unknown')+' decimals';
 el('gas-note').textContent='Maximum fee: '+feeText()+'. Fast gas quote +25%, within '+formatUnits(C.maxFee,9)+' Gwei. Inclusion time is not guaranteed.';
 el('sign-consent-text').textContent='I reviewed the amount, '+C.name+', recipient '+C.recipient+' and maximum fee '+feeText()+'. I authorize signing this exact operation.';
 el('send-consent-text').textContent='I authorize sending the live signature to Pimlico and submitting this transfer on '+C.name+' with maximum fee '+feeText()+'.';
 el('sources').textContent='Balances: '+C.rpc+'. Estimation and submission on request: '+C.bundler+'.';
}
function render(v){if(!C)return;C=controller?.config||C;updateLabels();
 const s=v.snapshot,d=v.draft,stale=v.stale||!s||Date.now()-s.readAt>45000;
 if(s){el('wallet-usdt').textContent=tokenAmount(s.balance);el('wallet-bnb').textContent=formatUnits(s.bnb);el('deposit').textContent=formatUnits(s.deposit);el('recipient-usdt').textContent=C.recipient?tokenAmount(s.recipientBalance):'—';el('recipient-bnb').textContent=C.recipient?formatUnits(s.recipientBNB):'—';el('updated').textContent=(stale?'Stale · ':'Updated ')+new Date(s.readAt).toLocaleTimeString('en-GB')+' · block '+BigInt(s.block);}
 const fresh=ready&&s&&!stale,free=ready&&!v.busy&&!v.pending;
 el('connection').textContent=fresh?'● '+C.name:'Balance not current';el('connection').className='badge '+(fresh?'live':'error');
 for(const id of ['network-select','asset-kind','fee-select','token-input','source-input','recipient-input','apply-settings'])el(id).disabled=v.busy||Boolean(v.pending);
 let valid=false;try{parseAmount(el('amount-input').value,s?maxAmount(s,C):undefined,C.decimals);valid=true;el('amount-hint').textContent='Spendable: '+(s?tokenAmount(maxAmount(s,C)):'—')+' '+C.tokenLabel;}catch(error){el('amount-hint').textContent=el('amount-input').value?safeError(error):'Enter a positive amount within the spendable balance.';}
 el('amount-input').disabled=!ready||v.busy||Boolean(v.pending);el('max-amount').disabled=!free||!fresh||maxAmount(s,C)===0n;
 el('prepare').disabled=!free||!fresh||!valid||!C.recipient||!el('estimate-consent').checked;
 el('refresh').disabled=!ready||v.busy;el('estimate-consent').disabled=!ready||v.busy||Boolean(v.pending);
 if(d!==lastDraft){el('sign-consent').checked=false;el('send-consent').checked=false;lastDraft=d;}
 if(v.signedReady!==lastSigned){el('send-consent').checked=false;lastSigned=v.signedReady;}
 el('sign-consent').disabled=!free||!fresh||!d||v.signedReady;el('sign').disabled=!free||!fresh||!d||v.signedReady||!el('sign-consent').checked;
 el('send-consent').disabled=!free||!fresh||!v.signedReady;el('send').disabled=!free||!fresh||!v.signedReady||!el('send-consent').checked;
 el('cancel').disabled=!v.busy||!['preparing','signing'].includes(v.phase);el('review').hidden=!d;el('review-cap').textContent=feeText();
 if(d){el('review-amount').textContent=tokenAmount(d.amount)+' '+C.tokenLabel;el('review-estimate').textContent=formatUnits(d.simulation.paid)+' '+C.nativeSymbol;el('technical').textContent=JSON.stringify({chainId:C.chainId,source:C.wallet,recipient:C.recipient,kind:C.kind,token:C.token,decimals:C.decimals,entryPoint:C.entryPoint,amountUnits:d.amount,feeCap:feeText(),userOpHash:d.hash,userOperation:d.op},null,2);}
 else el('technical').textContent=v.pending?JSON.stringify(v.pending,null,2):'No operation prepared.';
 el('status').textContent=v.status;el('check-receipt').hidden=!v.pending;el('check-receipt').disabled=v.busy;el('receipt').hidden=!v.result;
 if(v.result){const r=v.result;el('receipt-title').textContent=r.failed?'Execution failed':r.confirming?'Waiting for confirmations':'Transfer confirmed';el('receipt-detail').textContent=r.failed?'Review the receipt.':tokenAmount(r.amount)+' '+C.tokenLabel+' · fee '+formatUnits(r.cost)+' '+C.nativeSymbol+' · confirmations: '+r.confirmations;el('tx-link').href=C.explorer+r.tx;}
}
async function userAction(action){const active=controller;try{await action();}catch(error){if(controller===active&&controller&&!controller.view.pending)controller.message(safeError(error));else el('status').textContent=safeError(error);}}
function resetConsents(){for(const id of ['estimate-consent','sign-consent','send-consent'])el(id).checked=false;}
function settingsChanged(){if(controller?.view.pending)return;ready=false;resetConsents();controller?.changeAmount();el('connection').textContent='Settings changed';el('status').textContent='Click Update balance to apply the selected settings.';}
function requireApplied(){if(!ready||contextKey(fieldsContext())!==contextKey(C)){settingsChanged();throw Error('Load the selected settings before continuing.');}}
function requireSelectedDraft(){requireApplied();const d=controller?.view.draft;if(!d||parseAmount(el('amount-input').value,maxAmount(controller.view.snapshot,C),C.decimals).toString()!==d.amount||d.contextKey!==contextKey(C)){controller?.changeAmount();throw Error('Transfer fields changed. Prepare and sign again.');}}
async function applySettings(){
 if(controller?.view.busy||controller?.view.pending)throw Error('Resolve the current operation first.');
 const next=fieldsContext(),id=++epoch;ready=false;controller?.cancel();if(controller)controller.signed=null;resetConsents();el('amount-input').value='';C=next;lastDraft=null;lastSigned=false;updateLabels();
 for(const key of ['wallet-usdt','wallet-bnb','recipient-usdt','recipient-bnb','deposit'])el(key).textContent='—';el('updated').textContent='Loading…';
 const hosts=['https://trustwallet.com/*',new URL(C.rpc).origin+'/*','https://public.pimlico.io/*'];
 if(!await chrome.permissions.contains({origins:hosts}))throw Error('Allow the declared hosts in Chrome extension settings, then reload.');if(id!==epoch)return;
 const transport=createTransport(globalThis.fetch.bind(globalThis),C),lockName='swift-submit:'+C.chainId+':'+C.wallet.toLowerCase();
 const lock=callback=>navigator.locks.request(lockName,{ifAvailable:true},async handle=>{if(!handle)throw Error('Another tab is submitting from this wallet.');return callback();});
 const active=new RemainderController({transport,storage:localStorage,lock,onChange:v=>{if(controller===active&&id===epoch)render(v);},getAssertion:async(challenge,signal)=>{const c=await navigator.credentials.get({publicKey:{rpId:RP_ID,challenge,userVerification:'required',timeout:60000},mediation:'required',signal});if(!c||c.type!=='public-key')throw Error('No WebAuthn assertion.');return c.response;},verify:async(response,challenge,ownerHex)=>{if(!/^[0-9a-f]{128}$/.test(ownerHex||''))throw Error('No verified SWIFT owner key.');const key=await importOwner({x:ownerHex.slice(0,64),y:ownerHex.slice(64)});return verifyAssertion(response,challenge,origin,key);}});
 controller=active;ready=true;render(active.view);if(active.view.pending)await active.checkReceipt();await active.refresh();if(controller===active&&!active.view.pending)active.message('Balance loaded. Enter a recipient and amount, then prepare the transfer.');
}
el('network-select').addEventListener('change',()=>{el('token-input').value=NETWORKS[el('network-select').value].token;setFeeOptions();settingsChanged();});
el('fee-select').addEventListener('change',()=>{settingsChanged();try{const next=fieldsContext();el('gas-note').textContent='Selected maximum fee: '+formatUnits(next.feeCapWei)+' '+next.nativeSymbol+' ('+formatUnits(next.maxFee,9)+' Gwei). Click Update balance, then Max again to reserve this fee. No signature or transfer is retained.';}catch{}});
el('asset-kind').addEventListener('change',()=>{el('token-field').hidden=el('asset-kind').value==='native';settingsChanged();});
for(const id of ['source-input','recipient-input','token-input'])el(id).addEventListener('input',settingsChanged);
el('apply-settings').addEventListener('click',()=>userAction(applySettings));
for(const id of ['estimate-consent','sign-consent','send-consent'])el(id).addEventListener('change',()=>controller&&render(controller.view));
el('amount-input').addEventListener('input',()=>{resetConsents();if(controller)userAction(()=>controller.changeAmount());});
el('max-amount').addEventListener('click',()=>{if(ready&&controller?.view.snapshot&&!controller.view.busy&&!controller.view.pending){el('amount-input').value=tokenAmount(maxAmount(controller.view.snapshot,C));resetConsents();controller.changeAmount();}});
el('refresh').addEventListener('click',()=>userAction(()=>{requireApplied();return controller.refresh();}));
el('prepare').addEventListener('click',()=>userAction(()=>{requireApplied();return controller.prepare(el('estimate-consent').checked,el('amount-input').value);}));
el('sign').addEventListener('click',()=>userAction(()=>{requireSelectedDraft();return controller.sign(el('sign-consent').checked);}));
el('cancel').addEventListener('click',()=>controller?.cancel());
el('send').addEventListener('click',()=>userAction(()=>{requireSelectedDraft();return controller.submit(el('send-consent').checked);}));
el('check-receipt').addEventListener('click',()=>userAction(()=>controller.checkReceipt()));
try{if(!isSecureContext||location.protocol!=='chrome-extension:'||location.origin!==origin||window.top!==window)throw Error('Open this page from the installed Chrome extension.');if(!navigator.credentials||!window.PublicKeyCredential||!navigator.locks)throw Error('Chrome with WebAuthn and Web Locks is required.');if(CONFIG.wallet)await applySettings();
 timer=setInterval(async()=>{if(inPoll||document.hidden||!ready||controller.view.busy)return;inPoll=true;try{if(controller.view.pending)await controller.checkReceipt();else await controller.refresh();}catch{}finally{inPoll=false;}},15000);
}catch(error){ready=false;el('status').textContent=safeError(error);}
document.addEventListener('visibilitychange',()=>{if(controller&&ready&&!document.hidden&&!controller.view.busy)userAction(()=>controller.view.pending?controller.checkReceipt():controller.refresh());});
window.addEventListener('pagehide',()=>{clearInterval(timer);epoch++;controller?.cancel();if(controller){controller.signed=null;controller.view.signedReady=false;}});
