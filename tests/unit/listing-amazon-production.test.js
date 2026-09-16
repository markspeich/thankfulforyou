import { describe,it,expect,vi } from 'vitest';
import { buildProductionPayload,createListingAmazonProductionService } from '../../api/_lib/listing-amazon-production.js';
const draft={id:'abc',revision:1,title:'Title',description:'Description',bullets:['a','b','c','d','e'],copyApproved:true,amazonProductionDetails:{packageLengthInches:3,packageWidthInches:2,packageHeightInches:1,packageWeightOunces:1.1,manufacturer:'Thankful For You',partNumber:'TFY-4357670739',specialFeature:'Personalized',closureType:'Clip'},images:[{id:'img',url:'https://images.example.com/a.jpg',selected:true,main:true,approved:true}]};
const definitions={productType:'BADGE_HOLDER',requirements:'LISTING_PRODUCT_ONLY',attributeNames:Object.keys(buildProductionPayload(draft).payload.attributes)};
function setup(client={},imageDelivery={configured:()=>true,prepare:vi.fn(async({draft})=>draft)}){const attempts={list:vi.fn(async()=>[]),claim:vi.fn(async()=>({id:'attempt'})),finish:vi.fn(async()=>{})};return {attempts,imageDelivery,service:createListingAmazonProductionService({attempts,client:{definitions:vi.fn(async()=>definitions),...client},configured:()=>true,sellerId:()=> 'seller',imageDelivery})};}
describe('production listing workflow',()=>{
 it('maps saved package facts for every listing',()=>{
  const attributes=buildProductionPayload({...draft,etsyListingId:'different',amazonProductionDetails:{packageLengthInches:3,packageWidthInches:2,packageHeightInches:1,packageWeightOunces:1.1,manufacturer:'Thankful For You',partNumber:'TFY-4357670739',specialFeature:'Personalized',closureType:'Clip'}}).payload.attributes;
  expect(attributes.item_package_weight[0]).toMatchObject({value:1.1,unit:'ounces'});
  expect(attributes.item_package_dimensions[0]).toMatchObject({length:{value:3,unit:'inches'},width:{value:2,unit:'inches'},height:{value:1,unit:'inches'}});
  expect(attributes.part_number[0].value).toBe('TFY-4357670739');
  expect(attributes.manufacturer[0].value).toBe('Thankful For You');
  expect(attributes.special_feature[0].value).toBe('Personalized');
  expect(attributes.closure[0].type[0].value).toBe('Clip');
 });
 it('blocks production validation when saved package facts are missing',()=>{
  expect(buildProductionPayload({...draft,amazonProductionDetails:{}}).issues.join(' ')).toMatch(/production details/i);
 });
 it('binds the production content hash to saved production details',()=>{
  const changed={...draft,amazonProductionDetails:{...draft.amazonProductionDetails,partNumber:'TFY-OTHER'}};
  expect(buildProductionPayload(changed).hash).not.toBe(buildProductionPayload(draft).hash);
 });
 it('builds product-only payload without offer or price',()=>{const result=buildProductionPayload(draft);expect(result.issues).toEqual([]);expect(result.payload.productType).toBe('BADGE_HOLDER');expect(result.payload.requirements).toBe('LISTING_PRODUCT_ONLY');expect(result.payload.attributes.country_of_origin[0].value).toBe('US');expect(JSON.stringify(result.payload)).not.toContain('purchasable_offer');});
 it.each(['http://localhost/a','https://127.0.0.1/a','https://10.1.2.3/a','https://mark.tail123.ts.net/a','https://[::1]/a'])('rejects private image URL %s',(url)=>{expect(buildProductionPayload({...draft,images:[{...draft.images[0],url}]}).issues.join(' ')).toMatch(/public/i);});
 it.each(['validate','submit'])('blocks %s before claiming or calling Amazon when cloud image delivery is unconfigured',async action=>{
  const client={definitions:vi.fn(),preview:vi.fn(),get:vi.fn(),submit:vi.fn()};const imageDelivery={configured:()=>false,prepare:vi.fn()};const {service,attempts}=setup(client,imageDelivery);
  await expect(service.run({workspaceId:'w',draft,action,confirmed:action==='submit'})).rejects.toThrow(/cloud image storage/i);
  expect(attempts.claim).not.toHaveBeenCalled();expect(client.definitions).not.toHaveBeenCalled();expect(client.preview).not.toHaveBeenCalled();expect(client.get).not.toHaveBeenCalled();expect(client.submit).not.toHaveBeenCalled();
 });
 it('records a claimed validation failure without previewing when image staging fails',async()=>{
  const client={definitions:vi.fn(),preview:vi.fn()};const imageDelivery={configured:()=>true,prepare:vi.fn(async()=>{throw new Error('cloud secret');})};const {service,attempts}=setup(client,imageDelivery);
  await service.run({workspaceId:'w',draft,action:'validate'});
  expect(attempts.claim).toHaveBeenCalledOnce();expect(attempts.finish.mock.calls[0][0].status).toBe('failed');expect(client.definitions).not.toHaveBeenCalled();expect(client.preview).not.toHaveBeenCalled();
 });
 it('verifies seller product definitions before previewing production payloads',async()=>{
  const client={definitions:vi.fn(async()=>definitions),preview:vi.fn(async()=>({status:'VALID',issues:[]}))};const {service,attempts}=setup(client);
  await service.run({workspaceId:'w',draft,action:'validate'});
  expect(client.definitions).toHaveBeenCalledOnce();expect(client.preview).toHaveBeenCalledOnce();expect(attempts.claim).toHaveBeenCalledOnce();
 });
 it.each(['validate','submit'])('stages images exactly once before %s',async action=>{
  const imageDelivery={configured:()=>true,prepare:vi.fn(async({draft})=>draft)};
  const client=action==='validate'?{preview:vi.fn(async()=>({status:'VALID',issues:[]}))}:{get:vi.fn(async()=>null),submit:vi.fn(async()=>({status:'ACCEPTED',issues:[]}))};
  const {service}=setup(client,imageDelivery);
  await service.run({workspaceId:'w',draft,action,confirmed:action==='submit'});
  expect(imageDelivery.prepare).toHaveBeenCalledOnce();
 });
 it('uses the claim to keep concurrent validation to one staging and Amazon path',async()=>{
  let releaseStage;const stageGate=new Promise(resolve=>{releaseStage=resolve});let signalFirstStage;const firstStage=new Promise(resolve=>{signalFirstStage=resolve});
  let claimCount=0;const attempts={list:vi.fn(async()=>[]),claim:vi.fn(async()=>{claimCount+=1;if(claimCount===2)throw new Error('claim conflict');return {id:'attempt'}}),finish:vi.fn(async()=>{})};
  const imageDelivery={configured:()=>true,prepare:vi.fn(async({draft})=>{signalFirstStage();await stageGate;return draft})};
  const client={definitions:vi.fn(async()=>definitions),preview:vi.fn(async()=>({status:'VALID',issues:[]}))};
  const service=createListingAmazonProductionService({attempts,client,configured:()=>true,sellerId:()=> 'seller',imageDelivery});
  const first=service.run({workspaceId:'w',draft,action:'validate'});await firstStage;
  const second=service.run({workspaceId:'w',draft,action:'validate'});releaseStage();
  await expect(first).resolves.toBeDefined();await expect(second).rejects.toThrow(/claim conflict/);
  expect(attempts.claim).toHaveBeenCalledTimes(2);expect(imageDelivery.prepare).toHaveBeenCalledOnce();expect(client.definitions).toHaveBeenCalledOnce();expect(client.preview).toHaveBeenCalledOnce();
 });
 it.each([null,{}, {productType:'OTHER',requirements:'LISTING_PRODUCT_ONLY',attributeNames:definitions.attributeNames}, {productType:'BADGE_HOLDER',requirements:'LISTING_PRODUCT_ONLY',attributeNames:[]}])('blocks production preview when product definitions are unusable',async response=>{
  const client={definitions:vi.fn(async()=>response),preview:vi.fn()};const {service,attempts}=setup(client);
  await service.run({workspaceId:'w',draft,action:'validate'});
  expect(attempts.claim).toHaveBeenCalledOnce();expect(attempts.finish.mock.calls[0][0].status).toBe('failed');expect(client.preview).not.toHaveBeenCalled();
 });
 it('records a claimed submit failure without submitting when product definitions cannot be retrieved',async()=>{
  const client={definitions:vi.fn(async()=>{throw new Error('provider secret');}),get:vi.fn(),submit:vi.fn()};const {service,attempts}=setup(client);
  await service.run({workspaceId:'w',draft,action:'submit',confirmed:true});
  expect(attempts.claim).toHaveBeenCalledOnce();expect(attempts.finish.mock.calls[0][0].status).toBe('failed');expect(client.get).not.toHaveBeenCalled();expect(client.submit).not.toHaveBeenCalled();
 });
 it('requires explicit submission confirmation',async()=>{const {service,attempts}=setup({});await expect(service.run({workspaceId:'w',draft,action:'submit'})).rejects.toThrow(/confirm/i);expect(attempts.claim).not.toHaveBeenCalled();});
 it('never overwrites an existing SKU',async()=>{const client={get:vi.fn(async()=>({summaries:[]})),submit:vi.fn()};const {service,attempts}=setup(client);await service.run({workspaceId:'w',draft,action:'submit',confirmed:true});expect(client.submit).not.toHaveBeenCalled();expect(attempts.finish.mock.calls[0][0].status).toBe('failed');});
 it('keeps accepted separate from inactive',async()=>{const {service,attempts}=setup({get:async()=>null,submit:async()=>({status:'ACCEPTED'})});await service.run({workspaceId:'w',draft,action:'submit',confirmed:true});expect(attempts.finish.mock.calls[0][0].status).toBe('accepted');});
 it('does not confirm missing listing inactive',async()=>{const {service,attempts}=setup({get:async()=>null});await service.run({workspaceId:'w',draft,action:'reconcile'});expect(attempts.finish.mock.calls[0][0].status).toBe('unconfirmed');});
 it('flags buyable listings',async()=>{const {service,attempts}=setup({get:async()=>({summaries:[{marketplaceId:'ATVPDKIKX0DER',status:['BUYABLE']} ]})});await service.run({workspaceId:'w',draft,action:'reconcile'});expect(attempts.finish.mock.calls[0][0].status).toBe('buyable');});
 it('keeps preview identity stable across expiring delivery URLs',()=>{expect(buildProductionPayload(draft).hash).toBe(buildProductionPayload({...draft,images:[{...draft.images[0],url:'https://images.example.com/a.jpg?token=another'}]}).hash);});
 it('treats unexpected errors after submitting as uncertain',async()=>{const {service,attempts}=setup({get:async()=>null,submit:async()=>{throw new Error('network')}});await service.run({workspaceId:'w',draft,action:'submit',confirmed:true});expect(attempts.finish.mock.calls[0][0].status).toBe('unknown');});
});
