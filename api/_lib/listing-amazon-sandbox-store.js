import { createSupabaseAdminClient } from "./supabase-admin.js";
import { listingError } from "./listing-store.js";

export function createSandboxAttemptStore({ supabase = createSupabaseAdminClient() } = {}) {
  return {
    async list({ workspaceId, draftId }) {
      const { data, error } = await supabase.from("listing_amazon_sandbox_attempts").select("id,revision,sku,action,status,issues,result,created_at").eq("workspace_id",workspaceId).eq("draft_id",draftId).order("created_at",{ascending:false}).limit(30);
      if(error) throw error;
      return (data || []).map(row=>({id:row.id,revision:Number(row.revision),sku:row.sku,action:row.action,status:row.status,issues:row.issues,result:row.result,createdAt:row.created_at}));
    },
    async claim({workspaceId,draftId,revision,action,hash}) {
      const { data,error }=await supabase.rpc("claim_listing_amazon_sandbox",{p_workspace_id:workspaceId,p_draft_id:draftId,p_revision:revision,p_action:action,p_payload_hash:hash});
      if(error) { if(error.code === "P0001" || error.code === "23505") throw listingError(409,error.code === "P0001" ? error.message : "A sandbox test is already running."); throw error; }
      return {id:data};
    },
    async finish({workspaceId,id,status,issues=[],result={}}) {
      const {error}=await supabase.from("listing_amazon_sandbox_attempts").update({status,issues,result,completed_at:new Date().toISOString()}).eq("workspace_id",workspaceId).eq("id",id).eq("status","running");
      if(error) throw error;
    },
  };
}
