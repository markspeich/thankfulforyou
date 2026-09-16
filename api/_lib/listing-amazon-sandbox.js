import { createHash } from "node:crypto";
import { listingError } from "./listing-store.js";
import { createSandboxAttemptStore } from "./listing-amazon-sandbox-store.js";
import { createAmazonSandboxClient, hasAmazonSandboxConfig } from "./amazon-sandbox-client.js";

const MARKETPLACE="ATVPDKIKX0DER";
export const SANDBOX_NOTICE="Sandbox responses are canned test results. They do not validate your product type, exemption, images, or create a real inactive listing. Production submission is disabled.";
export function stableListingSku(id) { return "TFY-"+String(id).replaceAll("-",""); }
export function buildSandboxPayload(draft) {
  const issues=[];
  if(!draft.title?.trim()) issues.push("Enter a title.");
  if(!draft.description?.trim()) issues.push("Enter a description.");
  if(draft.bullets?.length !== 5 || draft.bullets.some(v=>!v?.trim())) issues.push("Complete all five bullet points.");
  if(!draft.copyApproved) issues.push("Approve the saved copy.");
  const images=(draft.images||[]).filter(i=>i.selected);
  const main=images.filter(i=>i.main);
  if(main.length!==1) issues.push("Choose one main image.");
  if(images.some(i=>!i.approved)) issues.push("Approve every selected image.");
  if(images.length>9) issues.push("Select at most nine gallery images.");
  if(images.some(i=>!/^https?:\/\//i.test(i.url||""))) issues.push("Selected images need stored delivery URLs.");
  const text=(value)=>({value,language_tag:"en_US",marketplace_id:MARKETPLACE});
  const attributes={item_name:[text(draft.title||"")],product_description:[text(draft.description||"")],bullet_point:(draft.bullets||[]).map(text),brand:[text("Generic")],supplier_declared_has_product_identifier_exemption:[{value:true,marketplace_id:MARKETPLACE}]};
  const ordered=[...main,...images.filter(i=>!i.main)];
  ordered.forEach((image,index)=> { attributes[index===0?"main_product_image_locator":"other_product_image_locator_"+index]=[{media_location:image.url,marketplace_id:MARKETPLACE}]; });
  const payload={productType:"PRODUCT",requirements:"LISTING_PRODUCT_ONLY",attributes};
  // Content identity excludes expiring storage signatures; the saved revision binds the exact reviewed assets.
  const hash=createHash("sha256").update(JSON.stringify({title:draft.title,description:draft.description,bullets:draft.bullets,images:ordered.map(i=>i.id),productType:"PRODUCT",requirements:"LISTING_PRODUCT_ONLY"})).digest("hex");
  return {payload,hash,issues};
}

export function createListingAmazonSandboxService({ attempts=createSandboxAttemptStore(), client=null, configured=()=>hasAmazonSandboxConfig(process.env) }={}) {
  const getClient=()=>client || createAmazonSandboxClient({env:process.env});
  async function describe({workspaceId,draft}) {
    return {sku:stableListingSku(draft.id),attempts:await attempts.list({workspaceId,draftId:draft.id}),notice:SANDBOX_NOTICE,localIssues:buildSandboxPayload(draft).issues};
  }
  return {
    configured,
    describe,
    async run({workspaceId,draft,action}) {
      if(!configured()) throw listingError(409,"Amazon sandbox credentials are not configured.");
      if(!["validate","submit","reconcile"].includes(action)) throw listingError(400,"Unsupported sandbox action.");
      const {payload,hash,issues}=buildSandboxPayload(draft);
      if(action!=="reconcile" && issues.length) throw listingError(422,issues.join(" "));
      const claim=await attempts.claim({workspaceId,draftId:draft.id,revision:draft.revision,action,hash});
      let status, result={}, remoteIssues=[];
      try {
        const api=getClient(); const sku=stableListingSku(draft.id);
        const response=await (action==="validate"?api.preview({sku,payload}):action==="submit"?api.submit({sku,payload}):api.get({sku}));
        remoteIssues=response.issues||[];
        result={status:response.status||null,sku:response.sku||null,submissionId:response.submissionId||null,requestId:response.requestId||null};
        if(action==="reconcile") {
          status="unconfirmed";
          remoteIssues=[...remoteIssues,{code:"STATIC_SANDBOX",severity:"WARNING",message:"The static sandbox cannot confirm this draft's persisted state. An unrelated canned SKU must not be treated as reconciliation."}];
        } else if(remoteIssues.some(i=>i.severity==="ERROR") || response.status==="INVALID") status="invalid";
        else if(["ACCEPTED","VALID"].includes(response.status)) status=action==="validate"?"checked":"accepted";
        else { status=action==="submit"?"unknown":"failed"; remoteIssues=[{code:"UNEXPECTED_STATUS",severity:"ERROR",message:"Amazon returned an unexpected sandbox status."}]; }
      } catch(error) {
        status=action==="submit" && error.uncertain?"unknown":"failed";
        remoteIssues=[{code:status==="unknown"?"UNCERTAIN_SUBMISSION":"SANDBOX_REQUEST_FAILED",severity:"ERROR",message:error.expose?error.message:"The sandbox request failed. Please retry a preview or check submission status."}];
      }
      await attempts.finish({workspaceId,id:claim.id,status,issues:remoteIssues,result});
      return describe({workspaceId,draft});
    },
  };
}
