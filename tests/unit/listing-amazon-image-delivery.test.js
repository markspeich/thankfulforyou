import { expect, it, vi } from "vitest";
import { createAmazonImageDelivery, hasAmazonImageDeliveryConfig } from "../../api/_lib/listing-amazon-image-delivery.js";
it("rejects local and unrelated cloud hosts", () => {
 for (const url of ["http://127.0.0.1:57320", "https://evil.example", "https://mark.tailnet.ts.net"]) expect(hasAmazonImageDeliveryConfig({AMAZON_IMAGE_STORAGE_URL:url,AMAZON_IMAGE_STORAGE_SERVICE_ROLE_KEY:"key"})).toBe(false);
});
it("copies only approved owned bytes and returns signed cloud URLs", async () => {
 const bytes=Buffer.alloc(24);Buffer.from([137,80,78,71,13,10,26,10]).copy(bytes);bytes.writeUInt32BE(13,8);bytes.write("IHDR",12);bytes.writeUInt32BE(10,16);bytes.writeUInt32BE(10,20);
 const query={select:vi.fn().mockReturnThis(),eq:vi.fn().mockReturnThis(),in:vi.fn().mockResolvedValue({data:[{id:"a",selected:true,approved:true,storage_bucket:"local",storage_path:"a",mime_type:"image/png"}]})};
 const upload=vi.fn().mockResolvedValue({}); const createSignedUrl=vi.fn().mockResolvedValue({data:{signedUrl:"https://cloud.supabase.co/signed"}});
 const source={from:()=>query,storage:{from:()=>({download:vi.fn().mockResolvedValue({data:new Blob([bytes])})})}};
 const destination={storage:{from:()=>({upload,createSignedUrl})}};
 const delivery=createAmazonImageDelivery({source,destination});
 const draft={id:"draft",images:[{id:"a",selected:true,approved:true,url:"http://local"},{id:"b",selected:false}]};
 const result=await delivery.prepare({workspaceId:"workspace",draft});
 expect(query.eq.mock.calls).toEqual([["workspace_id","workspace"],["draft_id","draft"]]);
 expect(upload).toHaveBeenCalledOnce();expect(createSignedUrl.mock.calls[0][1]).toBe(604800);
 expect(result.images[0].url).toBe("https://cloud.supabase.co/signed");expect(draft.images[0].url).toBe("http://local");
 await expect(delivery.prepare({workspaceId:"workspace",draft:{...draft,images:[{id:"a",selected:true,approved:false}]}})).rejects.toThrow(/approve/);
});
