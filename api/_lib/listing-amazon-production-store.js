import {createSupabaseAdminClient} from './supabase-admin.js';
import {listingError} from './listing-store.js';
export function createProductionAttemptStore({supabase=createSupabaseAdminClient()}={}){return {
 async list({workspaceId,draftId,sellerId}){const {data,error}=await supabase.from('listing_amazon_production_attempts').select('id,revision,sku,action,status,issues,result,created_at').eq('workspace_id',workspaceId).eq('draft_id',draftId).eq('seller_id',sellerId).order('created_at',{ascending:false}).limit(30);if(error)throw error;return (data||[]).map(r=>({...r,revision:Number(r.revision),createdAt:r.created_at}));},
 async claim({workspaceId,draftId,revision,action,hash,sellerId}){const {data,error}=await supabase.rpc('claim_listing_amazon_production',{p_workspace_id:workspaceId,p_draft_id:draftId,p_revision:revision,p_action:action,p_payload_hash:hash,p_seller_id:sellerId});if(error){if(['P0001','23505'].includes(error.code))throw listingError(409,error.code==='P0001'?error.message:'A production operation is already running.');throw error;}return {id:data};},
 async finish({workspaceId,id,status,issues,result}){const {error}=await supabase.from('listing_amazon_production_attempts').update({status,issues,result,completed_at:new Date().toISOString()}).eq('workspace_id',workspaceId).eq('id',id).eq('status','running');if(error)throw error;}
};}
