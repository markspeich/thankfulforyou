import { mkdtempSync,mkdirSync,writeFileSync,rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect,it } from "vitest";
import { loadListingServiceEnv } from "../../tools/listing_service_env.mjs";
it("loads only named service keys without replacing Supabase or existing server configuration",()=>{
  const cwd=mkdtempSync(join(tmpdir(),"listing-env-"));
  try {
    mkdirSync(join(cwd,".local"));
    writeFileSync(join(cwd,".local","etsy.env"),"ETSY_REDIRECT_URI=https://test.ts.net/api/etsy-callback\nSUPABASE_URL=https://wrong.example\n");
    writeFileSync(join(cwd,".local","amazon-sp-api.sandbox.env"),"AMAZON_SP_API_ENVIRONMENT=sandbox\nAMAZON_SP_API_CLIENT_SECRET=local-secret\nSUPABASE_URL=https://wrong.example\n");
    writeFileSync(join(cwd,".local","listing-providers.env"),"LISTING_OPENAI_MODEL=model-test\nLISTING_OPENAI_IMAGE_MODEL=image-model-test\nLISTING_REMOVEBG_API_KEY=obsolete-provider-key\nPORT=9999\n");
    writeFileSync(join(cwd,".env.local"),"SUPABASE_URL=https://also-wrong.example\n");
    const env={SUPABASE_URL:"http://localhost:1234",AMAZON_SP_API_CLIENT_SECRET:"server-secret"};
    expect(loadListingServiceEnv({cwd,env})).toEqual({...env,ETSY_REDIRECT_URI:"https://test.ts.net/api/etsy-callback",AMAZON_SP_API_ENVIRONMENT:"sandbox",LISTING_OPENAI_MODEL:"model-test",LISTING_OPENAI_IMAGE_MODEL:"image-model-test"});
  } finally { rmSync(cwd,{recursive:true,force:true}); }
});

it("keeps production credentials separate from sandbox credentials",()=>{
 const cwd=mkdtempSync(join(tmpdir(),"listing-prod-env-"));
 try { mkdirSync(join(cwd,".local"));
 writeFileSync(join(cwd,".local","amazon-sp-api.production.env"),"AMAZON_SP_API_ENVIRONMENT=production\nAMAZON_SP_API_CLIENT_ID=prod\nAMAZON_SP_API_SELLER_ID=seller\n");
 const result=loadListingServiceEnv({cwd,env:{AMAZON_SP_API_ENVIRONMENT:"sandbox",AMAZON_SP_API_CLIENT_ID:"sandbox"}});
 expect(result.AMAZON_SP_API_CLIENT_ID).toBe("sandbox");expect(result.AMAZON_SP_API_ENVIRONMENT).toBe("sandbox");expect(result.AMAZON_PRODUCTION_CLIENT_ID).toBe("prod");expect(result.AMAZON_PRODUCTION_SELLER_ID).toBe("seller");
 }finally{rmSync(cwd,{recursive:true,force:true});}
});
