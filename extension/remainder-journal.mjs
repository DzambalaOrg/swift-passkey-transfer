// Only public attempt metadata persists. Never a signature, assertion or UserOperation calldata.
import { check, CONFIG as C, contextKey } from './remainder-codec.mjs';
const KEY='swift-usdt-remainder-attempts-v1';
export class SubmissionJournal {
 constructor(storage,config=C){this.storage=storage;this.config=config;this.key=config.chainId===C.chainId&&config.wallet.toLowerCase()===C.wallet.toLowerCase()?KEY:KEY+':'+config.chainId+':'+config.wallet.toLowerCase();}
 all(){
  const text=this.storage.getItem(this.key);if(!text)return [];
  check(text.length<=20000,'Submission journal is corrupt. Check status manually.');
  let rows;try{rows=JSON.parse(text);}catch{throw Error('Cannot read the submission journal.');}
  check(Array.isArray(rows)&&rows.length<=20,'Invalid submission journal.');
  for(const r of rows)check(/^0x[0-9a-f]{64}$/.test(r.hash)&&/^[1-9][0-9]{0,77}$/.test(r.amount)&&/^[0-9]{1,78}$/.test(r.nonce)&&['attempted','accepted','uncertain','rejected','confirmed','failed'].includes(r.status),'Invalid submission journal entry.');
  return rows;
 }
 write(rows){this.storage.setItem(this.key,JSON.stringify(rows));}
 unresolved(rows=this.all()){const completed=rows.filter(r=>['confirmed','failed'].includes(r.status)).reduce((n,r)=>BigInt(r.nonce)>n?BigInt(r.nonce):n,-1n);return rows.filter(r=>['attempted','accepted','uncertain','rejected'].includes(r.status)&&BigInt(r.nonce)>completed);}
 reserve(draft){
  check(draft.contextKey===contextKey(this.config),'Operation belongs to another context.');
  const rows=this.all();check(this.unresolved(rows).length===0,'A pending submission exists. Check its receipt first.');check(!rows.some(r=>r.hash===draft.hash),'This operation was already submitted. Check its status first.');
  const row={hash:draft.hash,amount:String(draft.amount),nonce:String(draft.op.nonce),kind:this.config.kind,token:this.config.token,decimals:this.config.decimals,symbol:this.config.tokenLabel,feeCapWei:this.config.feeCapWei.toString(),chainId:this.config.chainId,wallet:this.config.wallet,recipient:this.config.recipient,status:'attempted',createdAt:new Date().toISOString()};
  this.write([...rows.slice(-19),row]);return row;
 }
 update(hash,update){const rows=this.all(),index=rows.findIndex(r=>r.hash===hash);check(index>=0,'Missing submission journal entry.');
  const allowed={};for(const key of ['status','tx','confirmations','cost'])if(Object.hasOwn(update,key))allowed[key]=update[key];
  rows[index]={...rows[index],...allowed};this.write(rows);return rows[index];
 }
 pending(){return this.unresolved().at(-1)||null;}
}
