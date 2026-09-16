import {createAmazonImageDelivery} from './listing-amazon-image-delivery.js';
import {createHash} from 'node:crypto';
import {isIP} from 'node:net';
import {buildSandboxPayload,stableListingSku} from './listing-amazon-sandbox.js';
import {listingError,normalizeAmazonProductionDetails} from './listing-store.js';
import {createProductionAttemptStore} from './listing-amazon-production-store.js';
import {createAmazonProductionClient,hasAmazonProductionConfig} from './amazon-production-client.js';
const MARKETPLACE='ATVPDKIKX0DER';
export const PRODUCTION_NOTICE='Production creates a real product-only listing without price or inventory. Acceptance does not confirm the listing is inactive; check its Amazon status.';
export function isPublicImageUrl(value){try {const u=new URL(value);const host=u.hostname.replace(/^\[|\]$/g,'');return u.protocol==='https:'&&!u.username&&!u.password&&(!u.port||u.port==='443')&&!isIP(host)&&host.includes('.')&&!/(^|\.)(localhost|local|internal|test|ts\.net)$/.test(host);}catch{return false;}}
export function buildProductionPayload(draft){
 const {payload,issues}=buildSandboxPayload(draft);payload.productType='BADGE_HOLDER';
 const attr=value=>[{value,marketplace_id:MARKETPLACE}];
 Object.assign(payload.attributes,{country_of_origin:attr('US'),batteries_required:attr(false),supplier_declared_dg_hz_regulation:attr('not_applicable')});
 try {
  const details=normalizeAmazonProductionDetails(draft.amazonProductionDetails);
  const text=value=>[{value,language_tag:'en_US',marketplace_id:MARKETPLACE}];
  Object.assign(payload.attributes,{
   item_package_dimensions:[{length:{value:details.packageLengthInches,unit:'inches'},width:{value:details.packageWidthInches,unit:'inches'},height:{value:details.packageHeightInches,unit:'inches'},marketplace_id:MARKETPLACE}],
   item_package_weight:[{value:details.packageWeightOunces,unit:'ounces',marketplace_id:MARKETPLACE}],
   manufacturer:text(details.manufacturer),part_number:attr(details.partNumber),special_feature:text(details.specialFeature),
   closure:[{type:[{value:details.closureType,language_tag:'en_US'}],marketplace_id:MARKETPLACE}],
  });
 } catch { issues.push('Amazon production details are missing or invalid.'); }
 const images=(draft.images||[]).filter(i=>i.selected);
 if(images.some(i=>!isPublicImageUrl(i.url)))issues.push('Publish selected images to public HTTPS cloud storage before production preview. Local and Tailscale images cannot be downloaded by Amazon.');
 const contentAttributes=Object.fromEntries(Object.entries(payload.attributes).filter(([key])=>!key.includes('image_locator')));
 const hash=createHash('sha256').update(JSON.stringify({attributes:contentAttributes,revision:draft.revision,images:images.map(i=>({id:i.id,main:i.main}))})).digest('hex');
 return {payload,hash,issues};
}
export function createListingAmazonProductionService({attempts=createProductionAttemptStore(),client=null,configured=()=>hasAmazonProductionConfig(process.env),sellerId=()=>process.env.AMAZON_PRODUCTION_SELLER_ID,imageDelivery=createAmazonImageDelivery()}={}){
 const localIssues=draft=>buildProductionPayload(draft).issues.filter(issue=>!imageDelivery.configured()||!issue.startsWith('Publish selected images'));
 const api=()=>client||createAmazonProductionClient({env:process.env});
 async function describe({workspaceId,draft}){return {sku:stableListingSku(draft.id),notice:PRODUCTION_NOTICE,localIssues:localIssues(draft),attempts:await attempts.list({workspaceId,draftId:draft.id,sellerId:sellerId()})};}
 return {configured,describe,async run({workspaceId,draft,action,confirmed=false}){
  if(!configured())throw listingError(409,'Production Amazon credentials are not configured.');
  if(!['validate','submit','reconcile'].includes(action))throw listingError(400,'Unsupported production action.');
  if(action==='submit'&&confirmed!==true)throw listingError(400,'Confirm creation of a real Amazon product-only listing.');
  let {payload,hash}=buildProductionPayload(draft);
  const issues=localIssues(draft);
  if(action!=='reconcile'&&issues.length)throw listingError(422,issues.join(' '));
  const claim=await attempts.claim({workspaceId,draftId:draft.id,revision:draft.revision,action,hash,sellerId:sellerId()});
  let status='failed',remoteIssues=[],result={},submitStarted=false;
  try{
   const amazon=api(),sku=stableListingSku(draft.id);let response;
   if(action!=='reconcile'&&imageDelivery.configured()){
    const staged=buildProductionPayload(await imageDelivery.prepare({workspaceId,draft}));
    if(staged.issues.length)throw listingError(422,staged.issues.join(' '));
    payload=staged.payload;
   }
   if(action==='submit'){
    if(await amazon.get({sku}))throw listingError(409,'This SKU already exists on Amazon. Creation stopped to avoid overwriting it.');
    submitStarted=true;
    response=await amazon.submit({sku,payload});
   }else response=await(action==='validate'?amazon.preview({sku,payload}):amazon.get({sku}));
   remoteIssues=response?.issues||[];
   result={status:response?.status||null,sku:response?.sku||null,submissionId:response?.submissionId||null,requestId:response?.requestId||null};
   if(action==='reconcile'){
    const summary=response?.summaries?.find(s=>s.marketplaceId===MARKETPLACE);
    const states=summary?.status;
    status=!Array.isArray(states)?'unconfirmed':states.includes('BUYABLE')?'buyable':'inactive';
    result.listingStatuses=states||[];
    if(status==='unconfirmed')remoteIssues.push({code:'NOT_CONFIRMED',severity:'WARNING',message:'Amazon has not returned a US listing status. Check again later; do not resubmit.'});
    if(status==='buyable')remoteIssues.push({code:'BUYABLE',severity:'ERROR',message:'Amazon reports this SKU as buyable. Review it in Seller Central immediately.'});
   }else if(remoteIssues.some(i=>i.severity==='ERROR')||response?.status==='INVALID')status='invalid';
   else if(['ACCEPTED','VALID'].includes(response?.status))status=action==='validate'?'checked':'accepted';
   else {status=action==='submit'?'unknown':'failed';remoteIssues.push({code:'UNEXPECTED_STATUS',severity:'ERROR',message:'Unexpected Amazon response. Check status before attempting another submission.'});}
  }catch(error){status=submitStarted&&error.uncertain!==false?'unknown':'failed';remoteIssues=[{code:status==='unknown'?'UNCERTAIN_SUBMISSION':'PRODUCTION_REQUEST_FAILED',severity:'ERROR',message:error.expose?error.message:'Amazon production request failed. Check status before attempting another submission.'}];}
  await attempts.finish({workspaceId,id:claim.id,status,issues:remoteIssues,result});return describe({workspaceId,draft});
 }};
}
