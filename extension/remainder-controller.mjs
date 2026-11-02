// Explicit state transitions. Polling cannot sign, prepare, or submit. Real signatures stay outside view state.
import { CONFIG as C, NETWORKS, check, unhex, packResponse, assertCurrent, parseUSDTAmount, safeError, isBlockUnavailable, maxAmount } from './remainder-codec.mjs';
import { SubmissionJournal } from './remainder-journal.mjs';
export class RemainderController {
 constructor({transport,getAssertion,verify,storage,lock,onChange=()=>{}}){
  this.config=transport.config||C;
  this.transport=transport;this.getAssertion=getAssertion;this.verify=verify;this.lock=lock;this.onChange=onChange;
  this.journal=new SubmissionJournal(storage,this.config);this.signed=null;this.generation=0;this.abort=null;
  this.view={snapshot:null,stale:true,draft:null,signedReady:false,busy:false,phase:'idle',pending:this.journal.pending(),result:null,status:'Reading public balances…'};
  if(this.view.pending){const to=this.view.pending.recipient||C.recipient;const pendingKind=this.view.pending.kind||'erc20',pendingToken=this.view.pending.token||NETWORKS[this.config.chainId].token;check(pendingKind===this.config.kind&&(pendingKind==='native'||pendingToken.toLowerCase()===this.config.token.toLowerCase()),'A pending transfer uses another asset. Select '+pendingKind+' '+pendingToken+' to check its receipt.');check(to.toLowerCase()===this.config.recipient.toLowerCase(),'This source has a pending transfer. Select its recipient '+to+' and check the receipt.');this.view.phase='pending';this.view.status='A previous submission exists. Checking its status without resubmitting.';}
 }
 emit(){this.view.revision=(this.view.revision||0)+1;this.onChange(this.view);}
 message(text){this.view.status=text;this.emit();}
 begin(phase){check(!this.view.busy,'Wait for the current action.');check(!this.view.pending,'Resolve the previous submission first.');this.view.busy=true;this.view.phase=phase;const id=++this.generation;this.emit();return id;}
 current(id){return id===this.generation;}
 end(id){if(this.current(id)){this.view.busy=false;this.abort=null;this.emit();}}
 eraseDraft(){this.signed=null;this.view.draft=null;this.view.signedReady=false;}
 changeAmount(){
  check(!this.view.pending&&!['checking-send','sending'].includes(this.view.phase),'Submission has started; its amount cannot be changed.');
  if(this.view.busy)this.cancel();
  this.eraseDraft();this.view.phase='idle';this.message('Settings changed. Prepare and sign a new operation.');
 }
 async refresh(){
  if(this.view.busy)return;
  try{const snapshot=await this.transport.readSnapshot();this.config=this.transport.config||this.config;this.view.snapshot=snapshot;this.view.stale=false;
   if(this.view.draft&&!this.view.pending){try{assertCurrent(this.view.draft,snapshot);}catch(error){this.eraseDraft();this.view.phase='idle';this.view.status=safeError(error);}}
   this.emit();return snapshot;
  }catch(error){this.view.stale=true;this.view.status='Balance refresh failed: '+safeError(error);this.emit();throw error;}
 }
 async prepare(disclosureApproved,amountText){
  check(disclosureApproved,'Approve disclosure of the unsigned draft for estimation.');
  parseUSDTAmount(amountText,this.view.snapshot?maxAmount(this.view.snapshot,this.config):undefined,this.config.decimals);
  const id=this.begin('preparing');this.eraseDraft();this.view.result=null;this.message('Checking the wallet, amount and gas estimate…');
  try{
   const snapshot=await this.transport.readSnapshot({full:true});if(!this.current(id))return;this.config=this.transport.config||this.config;
   this.view.snapshot=snapshot;this.view.stale=false;this.emit();
   check(snapshot.balance>0n,'Asset balance is zero.');
   check(snapshot.bnb+snapshot.deposit>=this.config.feeCapWei,'Insufficient native currency for the configured fee cap.');
   const amount=parseUSDTAmount(amountText,maxAmount(snapshot,this.config),this.config.decimals);
   const draft=await this.transport.prepare(snapshot,{disclosureApproved:true,amount});if(!this.current(id))return;
   assertCurrent(draft,snapshot);this.view.draft=draft;this.view.phase='draft';
   this.message('Simulation credited the selected amount. Review the transfer before signing.');return draft;
  }catch(error){if(this.current(id)){this.view.phase='idle';this.message('Preparation stopped: '+safeError(error));}throw error;}
  finally{this.end(id);}
 }
 async sign(consent){
  check(consent,'Confirm the amount, recipient and fee cap.');check(this.view.draft,'Prepare a transfer first.');
  const draft=this.view.draft,id=this.begin('signing');this.abort=new AbortController();this.signed=null;this.view.signedReady=false;
  this.message('Rechecking balances before requesting the passkey…');
  try{
   const snapshot=await this.transport.readSnapshot({full:true});if(!this.current(id))return;this.config=this.transport.config||this.config;
   this.view.snapshot=snapshot;this.view.stale=false;assertCurrent(draft,snapshot);
   this.message('Approve the displayed transfer in the standard Chrome passkey dialog.');
   const response=await this.getAssertion(unhex(draft.hash),this.abort.signal);if(!this.current(id))return;
   const result=await this.verify(response,unhex(draft.hash),draft.ownerHex);if(!this.current(id))return;
   check(result.signatureMatches,'Signature does not match the SWIFT owner key.');
   const signature=packResponse(response,unhex(draft.hash));
   this.signed={hash:draft.hash,signature};this.view.signedReady=true;this.view.phase='signed';
   this.message('Signature verified locally and kept in this tab. Review the amount and approve submission separately.');
  }catch(error){if(this.current(id)){this.signed=null;this.view.signedReady=false;this.view.phase='draft';this.message('Signing stopped: '+safeError(error));}throw error;}
  finally{this.end(id);}
 }
 cancel(){if(!['signing','preparing'].includes(this.view.phase)||!this.view.busy)return;
  this.generation++;this.abort?.abort();this.abort=null;this.view.busy=false;this.signed=null;this.view.signedReady=false;this.view.phase=this.view.draft?'draft':'idle';this.message('Request cancelled. No operation was submitted.');
 }
 async submit(consent){
  check(consent,'Approve sending the live signature to Pimlico separately.');
  check(this.signed&&this.view.draft&&this.signed.hash===this.view.draft.hash,'No verified signature for this operation.');
  const draft=this.view.draft,signature=this.signed.signature,id=this.begin('checking-send');
  this.message('Final balance and state checks before submission…');
  try{
   const snapshot=await this.transport.readSnapshot({full:true});if(!this.current(id))return;this.config=this.transport.config||this.config;
   this.view.snapshot=snapshot;this.view.stale=false;assertCurrent(draft,snapshot);
   await this.transport.checkFees(draft);if(!this.current(id))return;
   await this.lock(async()=>{
    const row=this.journal.reserve(draft);this.view.pending=row;this.view.phase='sending';this.message('Submitting the signed operation to Pimlico once…');
    try{
     await this.transport.submit(draft,signature,{submissionApproved:true});
     this.view.pending=this.journal.update(draft.hash,{status:'accepted'});this.view.phase='pending';
     this.message('Pimlico accepted the operation. Checking the receipt without resubmitting.');
    }catch(error){
     const status=isBlockUnavailable(error)?'uncertain':error?.code!==undefined?'rejected':'uncertain';
     this.view.pending=this.journal.update(draft.hash,{status});this.view.phase='pending';
     this.message((status==='rejected'?'Pimlico rejected the request: ':'Submission response is uncertain: ')+safeError(error)+'. Check status; resubmission is blocked.');
     throw error;
    }finally{this.signed=null;this.view.signedReady=false;}
   });
  }catch(error){if(this.current(id)&&!this.view.pending){this.eraseDraft();this.message('Submission stopped before disclosing the signature: '+safeError(error)+'. Prepare again.');this.view.phase='idle';}throw error;}
  finally{this.end(id);}
 }
 async checkReceipt(){
  const pending=this.view.pending;if(!pending||this.view.busy)return;
  try{
   const result=await this.transport.receipt(pending.hash,pending.amount,pending.nonce,pending.feeCapWei||(this.config.chainId===56?'108000000000000':this.config.feeCapWei.toString()));if(!result)return null;
   this.view.result=result;
   if(result.confirmed&&result.confirmations<12){this.view.result={...result,confirming:true};this.message('Operation included. Waiting for 12 confirmations without resubmitting.');this.emit();return result;}
   if(result.failed){this.journal.update(pending.hash,{status:'failed',tx:result.tx});this.view.pending=null;this.eraseDraft();this.view.phase='failed';this.message('Operation included but execution failed. Review the receipt; gas may have been charged.');}
   else{
    this.journal.update(pending.hash,{status:'confirmed',tx:result.tx,cost:result.cost,confirmations:result.confirmations});this.view.pending=null;this.eraseDraft();this.view.phase='confirmed';this.message('Transfer confirmed. Execution and fee were checked against the transaction receipt.');
   }
   this.emit();await this.refresh();return result;
  }catch(error){this.message('Receipt not yet verified: '+safeError(error)+'. No resubmission is attempted.');throw error;}
 }
}
