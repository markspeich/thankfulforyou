import { describe, expect, it, vi } from "vitest";
import { createAmazonProductionClient, hasAmazonProductionConfig } from "../../api/_lib/amazon-production-client.js";
const env = Object.fromEntries(["CLIENT_ID", "CLIENT_SECRET", "REFRESH_TOKEN", "SELLER_ID"].map(key => [`AMAZON_PRODUCTION_${key}`, `test-${key}`]));
const response = (body, status = 200) => new Response(JSON.stringify(body), {status});
const token = () => response({access_token:"token",expires_in:3600});
const payload = {productType:"BADGE_HOLDER",requirements:"LISTING_PRODUCT_ONLY",attributes:{item_name:[{value:"Badge"}]}};
const setup = (...responses) => {
  const fetchImpl = vi.fn().mockResolvedValueOnce(token());
  for (const result of responses) result instanceof Error ? fetchImpl.mockRejectedValueOnce(result) : fetchImpl.mockResolvedValueOnce(result);
  return {fetchImpl, client:createAmazonProductionClient({env,fetchImpl})};
};
describe("production listing client", () => {
  it('omits preview-only identifiers when creating a listing',async()=>{
    const {client,fetchImpl}=setup(response({status:'ACCEPTED',issues:[]}));
    await client.submit({sku:'TFY-1',payload});
    const query=new URL(fetchImpl.mock.calls[1][0]).searchParams;
    expect(query.get('includedData')).toBe('issues');
    expect(query.has('mode')).toBe(false);
  });
  it('reports HTTP status and safe Amazon error codes without raw response details',async()=>{
    const {client}=setup(response({errors:[{code:'InvalidInput',message:'secret-token'}]},400));
    await expect(client.submit({sku:'TFY-1',payload})).rejects.toMatchObject({message:'Amazon submission failed (HTTP 400; InvalidInput). Review the request and Amazon requirements before trying again.'});
  });
  it("requires isolated production credentials and seller ID", () => {
    expect(hasAmazonProductionConfig(env)).toBe(true);
    expect(hasAmazonProductionConfig({...env,AMAZON_PRODUCTION_SELLER_ID:""})).toBe(false);
    expect(hasAmazonProductionConfig({AMAZON_SP_API_CLIENT_ID:"sandbox"})).toBe(false);
  });
  it("uses fixed NA seller-specific preview and preserves issue attributes", async () => {
    const issues=[{code:"missing",message:"Required",severity:"ERROR",attributeNames:["color"]}];
    const {client,fetchImpl}=setup(response({status:"INVALID",submissionId:"abc",issues}));
    expect(await client.preview({sku:"TFY-1",payload})).toMatchObject({status:"INVALID",submissionId:"abc",issues,sku:"TFY-1"});
    const [url,options]=fetchImpl.mock.calls[1];
    expect(url).toContain("https://sellingpartnerapi-na.amazon.com/listings/2021-08-01/items/test-SELLER_ID/TFY-1?");
    expect(new URL(url).searchParams.get("mode")).toBe("VALIDATION_PREVIEW");
    expect(options).toMatchObject({method:"PUT",redirect:"error",body:JSON.stringify(payload)});
    expect(options.signal).toBeInstanceOf(AbortSignal);
  });
  it.each(["purchasable_offer","fulfillment_availability","list_price","merchant_shipping_group","condition_type"])("rejects commercial attribute %s before network",async key=>{
    const {client,fetchImpl}=setup();
    await expect(client.submit({sku:"TFY-1",payload:{...payload,attributes:{[key]:[]}}})).rejects.toMatchObject({statusCode:422});
    expect(fetchImpl).not.toHaveBeenCalled();
  });
  it.each([{...payload,requirements:"LISTING"},{...payload,productType:"PRODUCT"}])("rejects other submission types",async body=>{
    const {client,fetchImpl}=setup();
    await expect(client.submit({sku:"TFY-1",payload:body})).rejects.toMatchObject({statusCode:422});
    expect(fetchImpl).not.toHaveBeenCalled();
  });
  it.each([401,429,500])("does not retry submission HTTP %s",async status=>{
    const {client,fetchImpl}=setup(response({secret:"must not expose"},status));
    await expect(client.submit({sku:"TFY-1",payload})).rejects.toMatchObject({uncertain:status>=500});
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
  it("marks interrupted submission uncertain without leaking error or retrying",async()=>{
    const {client,fetchImpl}=setup(new Error("secret-token"));
    await expect(client.submit({sku:"TFY-1",payload})).rejects.toMatchObject({uncertain:true,message:expect.stringContaining("Check listing status")});
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
  it("returns null for absent listing and reuses token",async()=>{
    const summaries=[{status:["DISCOVERABLE"]}];
    const {client,fetchImpl}=setup(response({},404),response({sku:"TFY-1",summaries,attributes:payload.attributes,issues:[]}));
    expect(await client.get({sku:"TFY-1"})).toBeNull();
    expect(await client.get({sku:"TFY-1"})).toMatchObject({summaries,attributes:payload.attributes});
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(new URL(fetchImpl.mock.calls[1][0]).searchParams.get("includedData")).toBe("summaries,issues,attributes");
  });
  it("requests seller-specific product-only definitions",async()=>{
    const body={productType:"BADGE_HOLDER",requirements:"LISTING_PRODUCT_ONLY",schema:{link:{resource:"https://example.com/schema"}}};
    const schema={properties:{item_name:{},product_description:{},bullet_point:{},brand:{},country_of_origin:{},batteries_required:{},supplier_declared_dg_hz_regulation:{}}};
    const {client,fetchImpl}=setup(response(body),response(schema));
    expect(await client.definitions()).toEqual({productType:"BADGE_HOLDER",requirements:"LISTING_PRODUCT_ONLY",attributeNames:Object.keys(schema.properties)});
    const url=new URL(fetchImpl.mock.calls[1][0]);
    expect(url.pathname).toBe("/definitions/2020-09-01/productTypes/BADGE_HOLDER");
    expect(url.searchParams.get("sellerId")).toBe(env.AMAZON_PRODUCTION_SELLER_ID);
    expect(url.searchParams.get("requirements")).toBe("LISTING_PRODUCT_ONLY");
    expect(fetchImpl.mock.calls[2][0]).toBe("https://example.com/schema");
  });
  it("refuses a non-public schema link before retrieving it",async()=>{
    const body={productType:"BADGE_HOLDER",requirements:"LISTING_PRODUCT_ONLY",schema:{link:{resource:"https://127.0.0.1/schema"}}};
    const {client,fetchImpl}=setup(response(body));
    await expect(client.definitions()).rejects.toMatchObject({statusCode:502});
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
  it("rejects oversized response and marks outcome uncertain",async()=>{
    const {client}=setup(response({status:"ACCEPTED",padding:"x".repeat(1024*1024)}));
    await expect(client.submit({sku:"TFY-1",payload})).rejects.toMatchObject({uncertain:true});
  });
});
